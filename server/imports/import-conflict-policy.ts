/**
 * Import Conflict Policy — Rules for detecting and resolving conflicts
 * between Excel imports and frontend edits.
 *
 * Business rules:
 * 1. Imports MUST be incremental (only new/changed rows, never full replace)
 * 2. Conflicts with frontend edits MUST be detected before commit
 * 3. Users MUST make an explicit keep/overwrite decision per conflict
 * 4. All conflict decisions MUST be audit-logged
 *
 * As of PR2C the conflict-detection backbone is the 3-way merge engine
 * in `server/lib/import/merge-engine.ts`. The classic two-way
 * `detectConflicts()` function is preserved as a backwards-compatible
 * wrapper but now consumes the merge engine internally so its output
 * carries snapshot values for richer wizard rendering.
 */

import {
  mergeRow,
  type FieldValue,
  type RowMergeResult as MergeRowResult,
} from "../lib/import/merge-engine";
import type { DiffSection } from "@shared/excel-vs-app/contract";

// ---------------------------------------------------------------------------
// File-wins policy (owner decision 2026-06 — "Excel always wins")
// ---------------------------------------------------------------------------
//
// EVERY import section treats the uploaded workbook as the SINGLE SOURCE OF
// TRUTH. A re-import always overwrites in-app edits to the tracked
// faithful-mirror fields (amounts, dates, invoice/PO numbers, date-colour
// confirmations for finance; task dates, owner, %, status for the plan): the
// edits are not recorded as manual_overrides and a lingering edit is reverted
// to the file value on the next import. This guarantees the app "never goes
// off the trackers".
//
// Originally (2026-06, first pass) only REVENUE / EXPENDITURE were file-wins
// and PLAN stayed app-editable. The owner then extended the rule to PLAN as
// well ("Excel wins everywhere") — so all three sections are now file-wins.
// App-owned columns that are not tracked merge fields (cosStatusOverride,
// noRevenueLinked, task links) are never touched by the merge engine, so they
// are unaffected either way.

export const FILE_WINS_SECTIONS: ReadonlySet<DiffSection> = new Set<DiffSection>([
  "REVENUE",
  "EXPENDITURE",
  "PLAN",
]);

/** True when the workbook is authoritative for the section (file always wins). */
export function sectionIsFileWins(section: DiffSection): boolean {
  return FILE_WINS_SECTIONS.has(section);
}

// ---------------------------------------------------------------------------
// "Never prompt" policy (owner decision 2026-06 — file / folder / auto imports)
// ---------------------------------------------------------------------------
//
// When true, the commit handler and the scheduler auto-satisfy every
// operator-decision gate in the file's favour instead of returning a 4xx that
// asks the operator to choose:
//   - field conflicts (3-way merge)      → file wins (no v2ConflictResolutions)
//   - previously-deleted "resurrections" → restore_and_apply (Excel has it)
//   - duplicate project candidates       → attach to closest match ≥0.75, else new
//   - manual-edit warnings               → acknowledged (Excel overwrites)
//   - recency (older / equal-date file)  → committed (manual uploads always win)
//
// Structural backstops that FAIL the file with a reason (not a prompt) are
// deliberately kept: the >80% soft-close "wipe" guard and unparseable BLOCKER
// issues. Default ON; set IMPORT_FILE_ALWAYS_WINS=false to restore the
// interactive per-conflict wizard.
export const IMPORT_FILE_ALWAYS_WINS: boolean =
  process.env.IMPORT_FILE_ALWAYS_WINS !== "false";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConflictResolution = "keep_existing" | "overwrite_with_import";

export interface ImportConflict {
  /** Row identifier in the import (line number, idempotency key, etc.) */
  importRowId: string;
  /** Existing row ID in the database */
  existingRowId: number;
  /** Table being imported into */
  table: "normalized_cost_lines" | "normalized_revenue_lines" | "work_items";
  /** Fields that differ between import and existing */
  conflictingFields: ConflictField[];
  /** When the existing row was last modified */
  existingUpdatedAt: Date;
  /** When the import was processed */
  importProcessedAt: Date;
}

export interface ConflictField {
  fieldName: string;
  /**
   * The value at the time of the previous import — the 3-way "common
   * ancestor". Optional so callers using the legacy two-way path keep
   * working (the field is undefined when no snapshot is available).
   */
  snapshotValue?: FieldValue;
  existingValue: string | number | null;
  importValue: string | number | null;
}

export interface ConflictDecision {
  conflict: ImportConflict;
  resolution: ConflictResolution;
  decidedBy: number; // user ID
  decidedAt: Date;
  reason?: string;
}

export interface ImportBatchResult {
  /** Rows inserted without conflict */
  inserted: number;
  /** Rows updated without conflict (existing row unchanged since import snapshot) */
  updated: number;
  /** Rows skipped (identical to existing) */
  skipped: number;
  /** Rows with conflicts requiring user decision */
  conflicts: ImportConflict[];
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/**
 * Detect conflicts between import rows and existing database rows.
 *
 * A conflict exists when:
 * - The import row matches an existing row (by idempotency key or natural key)
 * - The existing row has been modified AFTER the import snapshot was taken
 * - At least one field value differs
 *
 * Internally this delegates to the 3-way merge engine — when the existing
 * row carries an `importSnapshot`, the engine's `mergeRow()` is used to
 * produce a richer result (snapshot/db/file) and only true 3-way
 * conflicts are surfaced. When no snapshot is present (legacy path) the
 * engine still produces a sound 2-way result by treating the snapshot as
 * equal to the current DB row.
 *
 * @param importRows - Rows from the Excel import
 * @param existingRows - Matching rows from the database
 * @param snapshotTimestamp - When the import snapshot was captured
 * @param matchFields - Fields used to match rows (natural key)
 * @param compareFields - Fields to compare for conflicts
 */
export function detectConflicts(
  importRows: Record<string, unknown>[],
  existingRows: Array<{ id: number; updatedAt: Date; [key: string]: unknown }>,
  snapshotTimestamp: Date,
  matchFields: string[],
  compareFields: string[],
  table: ImportConflict["table"],
): ImportConflict[] {
  const conflicts: ImportConflict[] = [];

  for (const importRow of importRows) {
    const matchKey = matchFields.map(f => String(importRow[f] ?? "")).join("|");

    const existing = existingRows.find(row => {
      const existingKey = matchFields.map(f => String(row[f] ?? "")).join("|");
      return existingKey === matchKey;
    });

    if (!existing) continue; // New row, no conflict
    if (existing.updatedAt <= snapshotTimestamp) continue; // Not modified since snapshot

    // Coerce DB-row values into the merge engine's FieldValue domain. The
    // engine accepts string | number | boolean | null | undefined; anything
    // else (Date, Buffer, …) is stringified so equality remains meaningful.
    const fileRow: Record<string, FieldValue> = {};
    const existingRowMerge: Record<string, FieldValue> & { id: number } = { id: existing.id };
    const importSnapshotRaw = (existing as { importSnapshot?: unknown }).importSnapshot;
    const importSnapshot = isPlainSnapshot(importSnapshotRaw) ? importSnapshotRaw : null;

    for (const field of compareFields) {
      fileRow[field] = coerceFieldValue(importRow[field]);
      existingRowMerge[field] = coerceFieldValue(existing[field]);
    }

    const merge: MergeRowResult = mergeRow({
      // detectConflicts has no row-hash plumbing in legacy callers; use the
      // synthetic match key as a stable-within-batch identifier.
      rowHash: `legacy::${matchKey}`,
      fileRow,
      existingRow: existingRowMerge,
      importSnapshot,
      fields: compareFields,
    });

    if (!merge.hasConflicts) continue;

    const conflictingFields: ConflictField[] = merge.conflicts.map(c => ({
      fieldName: c.fieldName,
      snapshotValue: c.snapshotValue,
      existingValue: toScalar(c.existingValue),
      importValue: toScalar(c.importValue),
    }));

    conflicts.push({
      importRowId: typeof importRow.idempotencyKey === "string"
        ? importRow.idempotencyKey
        : matchKey,
      existingRowId: existing.id,
      table,
      conflictingFields,
      existingUpdatedAt: existing.updatedAt,
      importProcessedAt: new Date(),
    });
  }

  return conflicts;
}

function coerceFieldValue(v: unknown): FieldValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function toScalar(v: FieldValue): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  return v;
}

function isPlainSnapshot(v: unknown): v is Record<string, FieldValue> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

export interface ConflictAuditEntry {
  importRunId: number;
  table: string;
  existingRowId: number;
  resolution: ConflictResolution;
  conflictingFields: ConflictField[];
  decidedBy: number;
  decidedAt: Date;
  reason?: string;
}

/**
 * Build audit log entries from conflict decisions.
 */
export function buildConflictAuditEntries(
  importRunId: number,
  decisions: ConflictDecision[],
): ConflictAuditEntry[] {
  return decisions.map(d => ({
    importRunId,
    table: d.conflict.table,
    existingRowId: d.conflict.existingRowId,
    resolution: d.resolution,
    conflictingFields: d.conflict.conflictingFields,
    decidedBy: d.decidedBy,
    decidedAt: d.decidedAt,
    reason: d.reason,
  }));
}

// ---------------------------------------------------------------------------
// Incremental import validation
// ---------------------------------------------------------------------------

/**
 * Validate that an import batch is incremental (not a full replace).
 * A full replace is detected when the number of rows being soft-closed
 * exceeds the threshold relative to the project's existing rows.
 */
export function validateIncrementalImport(
  existingRowCount: number,
  rowsToSoftClose: number,
  threshold: number = 0.8,
): { isIncremental: boolean; reason?: string } {
  if (existingRowCount === 0) {
    return { isIncremental: true };
  }

  const closeRatio = rowsToSoftClose / existingRowCount;
  if (closeRatio > threshold) {
    return {
      isIncremental: false,
      reason: `Import would soft-close ${rowsToSoftClose}/${existingRowCount} rows (${(closeRatio * 100).toFixed(0)}%), which exceeds the ${(threshold * 100).toFixed(0)}% threshold for incremental imports. Use full re-import workflow instead.`,
    };
  }

  return { isIncremental: true };
}
