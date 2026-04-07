/**
 * Import Conflict Policy — Rules for detecting and resolving conflicts
 * between Excel imports and frontend edits.
 *
 * Business rules:
 * 1. Imports MUST be incremental (only new/changed rows, never full replace)
 * 2. Conflicts with frontend edits MUST be detected before commit
 * 3. Users MUST make an explicit keep/overwrite decision per conflict
 * 4. All conflict decisions MUST be audit-logged
 */

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
 * @param importRows - Rows from the Excel import
 * @param existingRows - Matching rows from the database
 * @param snapshotTimestamp - When the import snapshot was captured
 * @param matchFields - Fields used to match rows (natural key)
 * @param compareFields - Fields to compare for conflicts
 */
export function detectConflicts(
  importRows: Record<string, any>[],
  existingRows: Array<{ id: number; updatedAt: Date; [key: string]: any }>,
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

    const conflictingFields: ConflictField[] = [];
    for (const field of compareFields) {
      const importVal = importRow[field] ?? null;
      const existingVal = existing[field] ?? null;
      if (String(importVal) !== String(existingVal)) {
        conflictingFields.push({
          fieldName: field,
          existingValue: existingVal,
          importValue: importVal,
        });
      }
    }

    if (conflictingFields.length > 0) {
      conflicts.push({
        importRowId: importRow.idempotencyKey ?? matchKey,
        existingRowId: existing.id,
        table,
        conflictingFields,
        existingUpdatedAt: existing.updatedAt,
        importProcessedAt: new Date(),
      });
    }
  }

  return conflicts;
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
