/**
 * Smart Import v2 — Incremental Commit Executor
 *
 * Replaces v1 "soft-close all + re-insert all rows" with targeted writes:
 *   NEW rows       → INSERT into canonical table
 *   CHANGED rows   → UPDATE-in-place (or soft-close + re-insert for temporal tables)
 *   UNCHANGED rows → no-op (row keeps its id, no churn)
 *   MISSING rows   → kept (not deleted); flagged in audit
 *
 * Canonical write targets (from spine alignment audit):
 *   PLAN        → work_items (source=SMART_IMPORT, workstream=PM)
 *   REVENUE     → normalized_revenue_lines (effectiveTo IS NULL)
 *   EXPENDITURE → normalized_cost_lines (effectiveTo IS NULL)
 *
 * PR2C — stable hash-based identity + 3-way merge:
 *   Each section writer also (a) computes a deterministic `row_hash` from
 *   each incoming row's identity columns, (b) looks up the existing active
 *   row by `(project_id, row_hash)`, (c) runs the 3-way merge engine
 *   against the existing row's `import_snapshot` to decide per-field
 *   outcomes, and (d) writes the merged values plus refreshed snapshot +
 *   manualOverrides map. Rows with no material change after the merge
 *   are skipped entirely (re-importing an unchanged workbook is a no-op).
 *   Rows whose hash is no longer seen on the file side are soft-closed.
 *   See server/lib/import/{row-hasher,merge-engine}.ts for the primitives.
 */

import type { MatchedRow, SectionType } from "./row-matcher";
import type { RowMergeResult, FieldMerge, MergeCase } from "./conflict-engine";
import type { PlannerResult } from "./planner";
import { CANONICAL_SOURCES } from "./planner";
import { normalizeCostLineStatus, normalizeRevenueLineStatus } from "./utils";
import {
  hashPlanRow,
  hashRevenueRow,
  hashExpenditureRow,
} from "./row-hasher";
import {
  mergeRow as mergeRowEngine,
  applyResolutions,
  updateManualOverrides,
  type FieldValue,
  type RowMergeResult as EngineRowMergeResult,
  type ConflictResolution as EngineConflictResolution,
  type ManualOverridesMap,
} from "./merge-engine";
import { threeWayMergeEnabled } from "./feature-flags";
import {
  PLAN_TRACKED_FIELDS,
  REVENUE_TRACKED_FIELDS,
  EXPENDITURE_TRACKED_FIELDS,
} from "@shared/excel-vs-app/contract";

/**
 * Gated wrapper around `mergeRowEngine`. When the kill switch
 * `USE_THREE_WAY_MERGE=false` is set in the env, this short-circuits
 * to a "no material change, no conflicts" stub that lets the section
 * writer fall back to its pre-merge-engine behaviour. The row_hash +
 * import_snapshot capture upstream of this call still happens, so the
 * flag can be flipped back on without backfilling. The existing
 * `conflict-engine.ts` continues to run earlier in the pipeline
 * regardless of this flag — see docs/smart-import-v2-spec.md.
 */
function gatedMergeRowEngine(
  input: Parameters<typeof mergeRowEngine>[0],
): EngineRowMergeResult {
  if (!threeWayMergeEnabled()) {
    return {
      rowHash: input.rowHash,
      existingId: input.existingRow?.id ?? null,
      outcomes: {},
      conflicts: [],
      hasConflicts: false,
      hasMaterialChanges: !!input.existingRow,
    };
  }
  return mergeRowEngine(input);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommitCounts {
  inserted: number;
  updated: number;
  unchanged: number;
  missing: number;
  conflictsResolved: number;
}

export interface RowWarning {
  /** 1-indexed source row in the workbook (when known) */
  sourceRow: number | null;
  /** sheet name from the workbook */
  sourceSheet: string | null;
  /** the canonical external_ref the executor attempted to write */
  ref: string | null;
  /** short reason: 'unique_violation' | 'write_failed' | 'collision_skipped' */
  reason: string;
  /** human-readable error/cause */
  cause: string;
}

export interface SectionCommitResult {
  canonicalSource: string;
  counts: CommitCounts;
  /** IDs of rows that were inserted */
  insertedIds: number[];
  /** IDs of rows that were updated */
  updatedIds: number[];
  /** Per-row failures that did NOT abort the sheet (savepoint-rolled-back). */
  warnings?: RowWarning[];
  /**
   * 3-way-merge conflicts detected for this section. When present, the
   * caller is expected to surface them via the existing HTTP-409
   * conflicts envelope so the wizard can collect resolutions.
   */
  mergeConflicts?: MergeConflictEntry[];
}

export interface IncrementalCommitResult {
  sections: {
    PLAN: SectionCommitResult | null;
    REVENUE: SectionCommitResult | null;
    EXPENDITURE: SectionCommitResult | null;
  };
  totalInserted: number;
  totalUpdated: number;
  totalUnchanged: number;
  totalMissing: number;
}

// ---------------------------------------------------------------------------
// PR2C — hash-based merge-engine bookkeeping
// ---------------------------------------------------------------------------

/**
 * Per-section merge-field lists used by the 3-way merge engine.
 *
 * As of 2026-04-30 these are aliases of the canonical lists exported
 * from `shared/excel-vs-app/contract.ts`. Local aliases stay so
 * existing callers in this file don't need a second rename pass.
 * Adding a tracked field is done in the contract — these update
 * automatically.
 */
const PLAN_MERGE_FIELDS = PLAN_TRACKED_FIELDS;
const REVENUE_MERGE_FIELDS = REVENUE_TRACKED_FIELDS;
const EXPENDITURE_MERGE_FIELDS = EXPENDITURE_TRACKED_FIELDS;

/** Per-row hash-based merge outcome surfaced by the executor.
 *
 * `rowKey` / `displayLabel` / `section` mirror the wizard-shape produced by
 * the existing `conflict-engine.ts`, so the route can fold both engines'
 * output into the same `v2_conflicts_detected` 409 envelope. `rowKey` is the
 * matcher's `rowUid` (or `businessKey.key` fallback) — the same key the
 * existing engine uses, and the same one `v2ConflictResolutions` maps to. */
export interface MergeConflictEntry {
  rowKey: string;
  displayLabel: string;
  section: "PLAN" | "REVENUE" | "EXPENDITURE";
  rowHash: string;
  existingRowId: number;
  fieldName: string;
  snapshotValue: FieldValue;
  existingValue: FieldValue;
  importValue: FieldValue;
}

/** Wizard-shape conflict row, grouped by `rowKey` so a single row can carry
 * multiple field-level conflicts. Matches the shape that
 * `smart-import-routes.ts` returns from `runImportPlanner` — the wizard
 * consumer is unchanged. */
export interface WizardConflictRow {
  rowKey: string;
  displayLabel: string;
  section: "PLAN" | "REVENUE" | "EXPENDITURE";
  canonicalSource: string;
  fields: Array<{
    fieldName: string;
    baselineValue: FieldValue;
    currentAppValue: FieldValue;
    uploadedValue: FieldValue;
    mergeCase: "BOTH_CHANGED";
  }>;
}

/** Translate the per-field merge-engine entries into the wizard's grouped
 * row shape. Deduplicates by `(rowKey, fieldName)` so a field reported twice
 * (e.g. by both engines) collapses to a single decision prompt. */
export function mergeConflictsToWizardRows(
  entries: MergeConflictEntry[],
): WizardConflictRow[] {
  const byRow = new Map<string, WizardConflictRow>();
  const seenField = new Set<string>();
  for (const e of entries) {
    const dedupKey = `${e.rowKey}::${e.fieldName}`;
    if (seenField.has(dedupKey)) continue;
    seenField.add(dedupKey);

    let row = byRow.get(e.rowKey);
    if (!row) {
      row = {
        rowKey: e.rowKey,
        displayLabel: e.displayLabel,
        section: e.section,
        canonicalSource: e.section,
        fields: [],
      };
      byRow.set(e.rowKey, row);
    }
    row.fields.push({
      fieldName: e.fieldName,
      baselineValue: e.snapshotValue,
      currentAppValue: e.existingValue,
      uploadedValue: e.importValue,
      mergeCase: "BOTH_CHANGED",
    });
  }
  return Array.from(byRow.values());
}

/** Coerce a DB row's value into the merge engine's narrow domain. */
function toFieldValue(v: unknown): FieldValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** Build a `Record<string, FieldValue>` from a possibly-typed row, honouring
 * the canonical merge-field list. Missing fields become `null`. */
function buildMergeRow(
  source: Record<string, unknown> | null | undefined,
  fields: readonly string[],
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  if (!source) {
    for (const f of fields) out[f] = null;
    return out;
  }
  for (const f of fields) {
    out[f] = toFieldValue(source[f]);
  }
  return out;
}

/** Coerce a JSONB column into a typed snapshot map (or null when absent). */
function readSnapshot(v: unknown): Record<string, FieldValue> | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, FieldValue> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    out[k] = toFieldValue(raw);
  }
  return out;
}

/** Coerce a JSONB column into a typed manual-overrides map (or null when absent). */
function readManualOverrides(v: unknown): ManualOverridesMap | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || Array.isArray(v)) return null;
  // Trust the shape the merge engine writes — readers are themselves the
  // merge engine, which tolerates partially-shaped entries.
  return v as ManualOverridesMap;
}

/** Build a fresh snapshot from a file row's compare-field values. The
 * snapshot is the "common ancestor" that subsequent imports compare against. */
function buildSnapshot(
  fileRow: Record<string, unknown>,
  fields: readonly string[],
): Record<string, FieldValue> {
  const snap: Record<string, FieldValue> = {};
  for (const f of fields) {
    snap[f] = toFieldValue(fileRow[f]);
  }
  return snap;
}

/**
 * Translate a wizard-side conflict-decisions map (keyed by `rowKey::field`)
 * into the merge-engine's resolution objects for a specific row hash.
 * The wizard already sends `keep_app` / `accept_file` decisions per
 * (rowKey, field) — we map those onto the engine's `keep_existing` /
 * `accept_import` vocabulary. Unknown decisions fall through; the engine
 * `applyResolutions` call below uses `defaultToKeepExisting=true` so the
 * row is written using the existing (manual) value when the wizard didn't
 * surface a decision for that field.
 */
function buildEngineResolutions(
  rowKey: string,
  conflictDecisions: Record<string, "keep_app" | "accept_file">,
  conflictFields: ReadonlyArray<{ fieldName: string }>,
): EngineConflictResolution[] {
  const out: EngineConflictResolution[] = [];
  for (const c of conflictFields) {
    const decision = conflictDecisions[`${rowKey}::${c.fieldName}`];
    if (decision === "keep_app") {
      out.push({ fieldName: c.fieldName, resolution: "keep_existing" });
    } else if (decision === "accept_file") {
      out.push({ fieldName: c.fieldName, resolution: "accept_import" });
    }
  }
  return out;
}

interface ResolvedMergeWrite {
  /** Final field values after the merge + resolutions. */
  values: Record<string, FieldValue>;
  /** Refreshed import_snapshot to persist on the row. */
  snapshot: Record<string, FieldValue>;
  /** Refreshed manual_overrides to persist on the row. */
  manualOverrides: ManualOverridesMap;
  /** True when the merge produced any accept_file (i.e. the row's effective
   *  value is materially changing). For temporal tables this is the trigger
   *  to soft-close + insert; for in-place tables it triggers a real UPDATE. */
  hasMaterialChanges: boolean;
  /** How many CONFLICT outcomes the engine produced (for accounting). */
  conflictCount: number;
}

/**
 * Apply the resolutions from the merge-engine result and produce the final
 * values to write, plus the refreshed snapshot and manualOverrides. This is
 * the single source of truth for "what does this row look like after the
 * 3-way merge?" so all three section writers stay aligned.
 */
function resolveMergeResult(
  merge: EngineRowMergeResult,
  fileRow: Record<string, unknown>,
  resolutions: EngineConflictResolution[],
  fields: readonly string[],
  decidedBy: number | null,
  existingManualOverrides: ManualOverridesMap | null,
  now: Date,
): ResolvedMergeWrite {
  const values = applyResolutions(merge, resolutions, /* defaultToKeepExisting */ true);
  const manualOverrides = updateManualOverrides(
    existingManualOverrides,
    merge,
    resolutions,
    decidedBy,
    now,
  );
  const snapshot = buildSnapshot(fileRow, fields);
  const conflictCount = merge.conflicts.length;
  return {
    values,
    snapshot,
    manualOverrides,
    hasMaterialChanges: merge.hasMaterialChanges,
    conflictCount,
  };
}

// ---------------------------------------------------------------------------
// Field resolution — apply merge decisions to build final row values
// ---------------------------------------------------------------------------

/**
 * Given the file row, existing DB row, and the conflict merge results,
 * produce the final field values that should be written.
 *
 * For each compare field:
 *   UNCHANGED        → skip (don't include in update)
 *   AUTO_ACCEPT_FILE → use file value
 *   KEEP_APP         → skip (keep existing)
 *   CONFLICT         → use the resolved decision value
 */
export function resolveFieldValues(
  fileRow: Record<string, any>,
  existingRow: Record<string, any>,
  mergeResult: RowMergeResult | null,
  conflictDecisions: Record<string, "keep_app" | "accept_file">,
  compareFields: string[],
): Record<string, any> {
  const updates: Record<string, any> = {};

  if (!mergeResult) {
    // No merge result (baseline) — use all file values
    for (const field of compareFields) {
      if (fileRow[field] !== undefined) {
        updates[field] = fileRow[field];
      }
    }
    return updates;
  }

  const fieldMap = new Map<string, FieldMerge>();
  for (const fm of mergeResult.fields) {
    fieldMap.set(fm.fieldName, fm);
  }

  for (const field of compareFields) {
    const fm = fieldMap.get(field);
    if (!fm) {
      // Field not in merge result — use file value if different
      if (fileRow[field] !== undefined && fileRow[field] !== existingRow[field]) {
        updates[field] = fileRow[field];
      }
      continue;
    }

    switch (fm.mergeCase) {
      case "UNCHANGED":
        // No-op — leave existing value
        break;
      case "AUTO_ACCEPT_FILE":
        updates[field] = fileRow[field] ?? null;
        break;
      case "KEEP_APP":
        // No-op — existing row already has the app value
        break;
      case "CONFLICT": {
        const decisionKey = `${mergeResult.rowKey}::${field}`;
        const decision = conflictDecisions[decisionKey];
        if (decision === "accept_file") {
          updates[field] = fileRow[field] ?? null;
        }
        // else keep_app → no-op
        break;
      }
    }
  }

  return updates;
}

// ---------------------------------------------------------------------------
// PLAN section writer
// ---------------------------------------------------------------------------

export interface PlanWriteContext {
  tx: any;
  projectId: number;
  projectName: string;
  runId: number;
  userId: number | null;
  matchedRows: MatchedRow[];
  mergeResults: Map<string, RowMergeResult>;
  conflictDecisions: Record<string, "keep_app" | "accept_file">;
  workItemsTable: any;
  workItemDependenciesTable: any;
  workItemAssignmentsTable: any;
}

export async function writePlanIncremental(ctx: PlanWriteContext): Promise<SectionCommitResult> {
  const { tx, projectId, projectName, runId, userId, matchedRows, mergeResults, conflictDecisions } = ctx;
  const { workItemsTable: workItems } = ctx;
  const { eq, and, sql: sqlTag, isNull, inArray } = await import("drizzle-orm");
  const { users } = await import("@shared/schema");

  // Build a name/email → userId lookup map for owner resolution.
  // Keyed by lowercase name and lowercase email so both match styles work.
  // Populated once per import run; re-imports of the same workbook hit the
  // map rather than the DB.
  const userByKey = new Map<string, number>();
  const userRows = await tx
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.isActive, true), isNull(users.deletedAt)));
  for (const u of userRows as Array<{ id: number; name: string; email: string }>) {
    userByKey.set(u.email.toLowerCase(), u.id);
    // name goes in last so email wins on collision
    userByKey.set(u.name.toLowerCase(), u.id);
  }
  function resolveOwnerUserId(ownerText: unknown): number | null {
    if (!ownerText || typeof ownerText !== "string") return null;
    return userByKey.get(ownerText.trim().toLowerCase()) ?? null;
  }

  const counts: CommitCounts = { inserted: 0, updated: 0, unchanged: 0, missing: 0, conflictsResolved: 0 };
  const insertedIds: number[] = [];
  const updatedIds: number[] = [];
  const warnings: RowWarning[] = [];
  const mergeConflicts: MergeConflictEntry[] = [];

  const PLAN_UPDATE_FIELDS = [
    "startDate", "endDate", "durationDays",
    "actualStartDate", "actualEndDate", "actualDurationDays",
    "owner", "status", "pctComplete", "expectedPctComplete",
    "comment", "isMilestone", "parentTaskNo",
  ];

  // Map from work_items column names → normalizer field names
  const WI_FIELD_MAP: Record<string, string> = {
    startDate: "startDate", endDate: "endDate", duration: "durationDays",
    actualStart: "actualStartDate", actualEnd: "actualEndDate", actualDuration: "actualDurationDays",
    ownerName: "owner", status: "status", percentComplete: "pctComplete",
    expectedPctComplete: "expectedPctComplete", description: "comment",
    isMilestone: "isMilestone", outlineNumber: "parentTaskNo",
  };

  // PR2C — translate a normalizer fileRow into the merge-engine's field
  // domain. The engine compares against `work_items` columns (e.g.
  // `ownerName`, `outlineNumber`), but the fileRow uses normalizer field
  // names (e.g. `owner`, `parentTaskNo`). Project the file row through
  // WI_FIELD_MAP so both sides of the merge speak the same vocabulary.
  function planFileRowForMerge(fileRow: Record<string, unknown>): Record<string, FieldValue> {
    const out: Record<string, FieldValue> = {};
    for (const [wiCol, normField] of Object.entries(WI_FIELD_MAP)) {
      out[wiCol] = toFieldValue(fileRow[normField]);
    }
    // PR2A passthrough fields match column names 1:1.
    for (const f of ["lead", "resource1", "resource2", "trackerComments", "workDays"]) {
      out[f] = toFieldValue(fileRow[f]);
    }
    return out;
  }

  // Set of row-hashes seen in this import (any classification). End-of-pass
  // cleanup soft-deletes active rows in this project whose hash isn't here.
  const seenRowHashes = new Set<string>();
  const commitNow = new Date();

  /**
   * Look up an existing active row by `(projectId, rowHash)`. The partial
   * index `work_items_row_hash_active_idx` makes this O(log n).
   */
  async function lookupActiveByHash(rowHash: string): Promise<Record<string, unknown> | null> {
    const rows = await tx
      .select()
      .from(workItems)
      .where(and(
        eq(workItems.projectId, projectId),
        eq(workItems.rowHash, rowHash),
        isNull(workItems.deletedAt),
      ))
      .limit(1);
    return rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
  }

  // Identity is owned by the row matcher. Every MatchedRow arrives with a
  // stable `rowUid` (unique within this import's section) and — for PLAN —
  // a `canonicalExternalRef` that the executor writes to
  // `work_items.external_ref`. The executor never rewrites identity based
  // on file position; it only writes what the matcher computed.
  //
  // NEW rows in a duplicate-key group arrive with a temporary
  // `...#new-<fileIdx>` suffix that is unique-within-this-run but not yet
  // tied to a DB row. After insert we fix those up to `#pk<id>` so the
  // identity survives future commits deterministically.
  const fallbackRef = (bkKey: string) => `PID-${projectId}::PLAN::BK::${bkKey}`;
  const swapRowUidInRef = (ref: string, oldRowUid: string, newRowUid: string) =>
    ref.endsWith(oldRowUid) ? `${ref.slice(0, ref.length - oldRowUid.length)}${newRowUid}` : ref;

  /**
   * Resolve a safe external_ref to write for a given row. If the preferred
   * ref is already owned by a different active work_items row, fall back to
   * a `#pk<ownId>` variant which is guaranteed unique (the row's own id
   * cannot collide with anyone else's). Returns `null` if no safe ref
   * could be computed without the caller's own id.
   */
  async function resolveSafeRef(preferred: string, ownId: number | null, bkKey: string): Promise<string> {
    const rowsWithRef = await tx
      .select({ id: workItems.id })
      .from(workItems)
      .where(and(eq(workItems.externalRef, preferred), sqlTag`${workItems.deletedAt} IS NULL`))
      .limit(1);
    if (rowsWithRef.length === 0) return preferred;
    const holderId = rowsWithRef[0].id;
    if (ownId != null && holderId === ownId) return preferred;
    if (ownId != null) return `${fallbackRef(bkKey)}#pk${ownId}`;
    // No own id yet (pre-insert) — we have no safe alternative to offer
    // the caller, so surface an error. This path should only be reachable
    // after a buggy matcher emits two NEW rows with identical rowUids.
    throw Object.assign(new Error(`external_ref collision on ${preferred} with no self-id fallback`), {
      code: "EXTREF_COLLISION",
      preferred,
      holderId,
    });
  }

  // Per-row SAVEPOINT wrapping (Layer 2 of the long-term fix):
  // Each PLAN row gets its own savepoint so that a single bad row
  // (unique-constraint, check-constraint, NOT NULL violation, etc.) does NOT
  // abort the surrounding sheet commit. Failures are captured as warnings
  // and surfaced to the route response; the rest of the sheet still writes.
  // S001's matcher dedup pass should make collision warnings rare in
  // practice, but this is defence-in-depth against any future regression.
  for (let rowIdx = 0; rowIdx < matchedRows.length; rowIdx++) {
    const mr = matchedRows[rowIdx];

    if (mr.classification === "MISSING_FROM_UPLOAD") {
      counts.missing++;
      // Policy: missing rows are handled by the end-of-pass hash-cleanup
      // sweep below, which soft-closes any active row whose hash is no
      // longer in the workbook. We do NOT mark `seenRowHashes` for these.
      continue;
    }

    const rowUid = mr.rowUid ?? mr.businessKey.key;
    const canonicalRef = mr.canonicalExternalRef ?? fallbackRef(rowUid);

    // PR2C — compute the deterministic row hash from the file row's
    // identity columns. This is independent of file position and stable
    // across re-imports of the same logical row. Always recorded in
    // `seenRowHashes` so the end-of-pass cleanup knows the row is still
    // present, even when it would otherwise be skipped (UNCHANGED, etc.).
    const fileRow = (mr.fileRow ?? {}) as Record<string, unknown>;
    const rowHash = mr.fileRow ? hashPlanRow({
      projectId,
      wbsCode: typeof fileRow.taskNo === "string" ? fileRow.taskNo : null,
      title: typeof fileRow.taskName === "string" ? fileRow.taskName : null,
    }) : null;

    if (rowHash) {
      // Hash collision (or duplicate-line) protection: if we've already
      // seen this hash earlier in the import, surface a WARNING and skip.
      // Better to flag a false-positive than silently overwrite.
      if (seenRowHashes.has(rowHash)) {
        warnings.push({
          sourceRow: typeof fileRow.sourceRow === "number" ? fileRow.sourceRow : null,
          sourceSheet: typeof fileRow.sourceSheet === "string" ? fileRow.sourceSheet : null,
          ref: canonicalRef,
          reason: "duplicate_row_hash",
          cause: `Duplicate row hash within this import for PLAN row ${rowIdx} — second occurrence skipped to avoid silent overwrite.`,
        });
        console.warn(
          `[SmartImport] PLAN duplicate row_hash within file (rowIdx=${rowIdx}, hash=${rowHash}); skipping second occurrence.`,
        );
        continue;
      }
      seenRowHashes.add(rowHash);
    }

    if (mr.classification === "UNCHANGED") {
      counts.unchanged++;
      continue;
    }

    // Savepoint name must be a valid SQL identifier; rowIdx is a number so
    // string-interpolation is safe.
    const savepointName = `wi_plan_${rowIdx}`;
    let savepointActive = false;
    try {
      await tx.execute(sqlTag.raw(`SAVEPOINT ${savepointName}`));
      savepointActive = true;

      // PR2C — match the existing active row by hash first. Falls back to
      // the matcher's existingRowId (legacy bridge) so a row that pre-dates
      // hash-based identity still gets upgraded on this import without
      // creating a duplicate.
      let hashMatchedRow: Record<string, unknown> | null = rowHash
        ? await lookupActiveByHash(rowHash)
        : null;
      if (!hashMatchedRow && mr.existingRowId != null && mr.existingRow) {
        hashMatchedRow = mr.existingRow as Record<string, unknown>;
      }

      const planMergeFileRow = planFileRowForMerge(fileRow);
      const importSnapshotRaw = hashMatchedRow ? hashMatchedRow.importSnapshot : null;
      const importSnapshot = readSnapshot(importSnapshotRaw);
      const existingManualOverrides = readManualOverrides(
        hashMatchedRow ? hashMatchedRow.manualOverrides : null,
      );

      const existingForMerge = hashMatchedRow
        ? ({
            id: typeof hashMatchedRow.id === "number" ? hashMatchedRow.id : 0,
            ...buildMergeRow(hashMatchedRow, PLAN_MERGE_FIELDS),
          } as Record<string, FieldValue> & { id: number })
        : null;

      const merge = gatedMergeRowEngine({
        rowHash: rowHash ?? `legacy::plan::${rowUid}`,
        fileRow: planMergeFileRow,
        existingRow: existingForMerge,
        importSnapshot,
        fields: [...PLAN_MERGE_FIELDS],
      });

      // Conflicts that the wizard hasn't already resolved block the row
      // write. Collect them and continue with the next row.
      const engineResolutions = buildEngineResolutions(rowUid, conflictDecisions, merge.conflicts);
      const resolvedFieldNames = new Set(engineResolutions.map(r => r.fieldName));
      const unresolvedConflicts = merge.conflicts.filter(c => !resolvedFieldNames.has(c.fieldName));

      if (unresolvedConflicts.length > 0 && existingForMerge) {
        const rowLabel = mr.businessKey.rowLabel ?? rowUid;
        for (const c of unresolvedConflicts) {
          mergeConflicts.push({
            rowKey: rowUid,
            displayLabel: rowLabel,
            section: "PLAN",
            rowHash: rowHash ?? "",
            existingRowId: existingForMerge.id,
            fieldName: c.fieldName,
            snapshotValue: c.snapshotValue,
            existingValue: c.existingValue,
            importValue: c.importValue,
          });
        }
        // Skip this row — the caller will surface conflicts via 409 and
        // re-invoke commit with resolutions. Keep the savepoint released
        // so the rest of the sheet still writes.
        if (savepointActive) {
          await tx.execute(sqlTag.raw(`RELEASE SAVEPOINT ${savepointName}`));
          savepointActive = false;
        }
        continue;
      }

      const resolved = existingForMerge
        ? resolveMergeResult(
            merge,
            planMergeFileRow,
            engineResolutions,
            PLAN_MERGE_FIELDS,
            userId,
            existingManualOverrides,
            commitNow,
          )
        : null;

      if (resolved) {
        counts.conflictsResolved += resolved.conflictCount;
      }

      if (mr.classification === "NEW") {
        const wbsCode = typeof fileRow.taskNo === "string" ? fileRow.taskNo : null;

        // Defensive: if some other active row still carries the canonical ref
        // (e.g. a race, or a legacy row not yet normalized), UPDATE-in-place
        // rather than insert a colliding row. This should be a rare path
        // now that the matcher owns identity.
        const existingByRef = await tx
          .select({ id: workItems.id })
          .from(workItems)
          .where(and(
            eq(workItems.externalRef, canonicalRef),
            sqlTag`${workItems.deletedAt} IS NULL`,
          ))
          .limit(1);

        if (existingByRef.length > 0) {
          const existingId = existingByRef[0].id;
          // PR2C — rebuild snapshot/overrides for this update path. We may
          // not have run the merge against this row (matcher-side identity
          // diverged from hash-side identity); use file values for the
          // snapshot and reset overrides since this row is being treated
          // as freshly imported.
          const freshSnapshot = buildSnapshot(planMergeFileRow, PLAN_MERGE_FIELDS);
          await tx.update(workItems).set({
            updatedAt: commitNow,
            importRunId: runId,
            title: fileRow.taskName,
            description: fileRow.comment || null,
            status: fileRow.status || "Not Started",
            startDate: fileRow.startDate || fileRow.actualStartDate || null,
            endDate: fileRow.endDate || fileRow.actualEndDate || null,
            duration: fileRow.durationDays || fileRow.actualDurationDays || null,
            actualStart: fileRow.actualStartDate || null,
            actualEnd: fileRow.actualEndDate || null,
            actualDuration: fileRow.actualDurationDays || null,
            percentComplete: fileRow.pctComplete != null ? Number(fileRow.pctComplete) : 0,
            expectedPctComplete: fileRow.expectedPctComplete != null ? Number(fileRow.expectedPctComplete) : null,
            wbsCode,
            outlineNumber: wbsCode,
            indentLevel: fileRow.indentLevel ?? 0,
            isMilestone: fileRow.isMilestone ?? false,
            phase: fileRow.phase || null,
            ownerUserId: resolveOwnerUserId(fileRow.owner),
            ownerName: fileRow.owner || null,
            sourceRow: fileRow.sourceRow || null,
            sourceSheet: fileRow.sourceSheet || null,
            subProjectName: fileRow.subProjectName || null,
            externalRef: canonicalRef,
            // PR2A tracker columns (see normalizer.ts).
            lead: fileRow.lead ?? null,
            resource1: fileRow.resource1 ?? null,
            resource2: fileRow.resource2 ?? null,
            trackerComments: fileRow.trackerComments ?? null,
            workDays: fileRow.workDays ?? null,
            // PR2C — stable identity + 3-way-merge bookkeeping.
            rowHash,
            importSnapshot: freshSnapshot,
            manualOverrides: null,
          }).where(eq(workItems.id, existingId));
          updatedIds.push(existingId);
          counts.updated++;
          if (savepointActive) {
            await tx.execute(sqlTag.raw(`RELEASE SAVEPOINT ${savepointName}`));
            savepointActive = false;
          }
          continue;
        }

        const insertValues = {
          clientId: null,
          projectId,
          workstream: "PM" as any,
          type: fileRow.isMilestone ? "milestone" : "task",
          source: "SMART_IMPORT" as any,
          title: fileRow.taskName,
          description: fileRow.comment || null,
          status: fileRow.status || "Not Started",
          priority: null,
          startDate: fileRow.startDate || fileRow.actualStartDate || null,
          endDate: fileRow.endDate || fileRow.actualEndDate || null,
          duration: fileRow.durationDays || fileRow.actualDurationDays || null,
          actualStart: fileRow.actualStartDate || null,
          actualEnd: fileRow.actualEndDate || null,
          actualDuration: fileRow.actualDurationDays || null,
          percentComplete: fileRow.pctComplete != null ? Number(fileRow.pctComplete) : 0,
          expectedPctComplete: fileRow.expectedPctComplete != null ? Number(fileRow.expectedPctComplete) : null,
          wbsCode,
          outlineNumber: wbsCode,
          indentLevel: fileRow.indentLevel ?? 0,
          isMilestone: fileRow.isMilestone ?? false,
          phase: fileRow.phase || null,
          parentId: null,
          ownerUserId: resolveOwnerUserId(fileRow.owner),
          ownerName: fileRow.owner || null,
          isShared: false,
          externalRef: canonicalRef,
          sourceRow: fileRow.sourceRow || null,
          sourceSheet: fileRow.sourceSheet || null,
          importRunId: runId,
          subProjectName: fileRow.subProjectName || null,
          createdBy: userId || 1,
          // PR2A tracker columns (see normalizer.ts).
          lead: fileRow.lead ?? null,
          resource1: fileRow.resource1 ?? null,
          resource2: fileRow.resource2 ?? null,
          trackerComments: fileRow.trackerComments ?? null,
          workDays: fileRow.workDays ?? null,
          // PR2C — stable identity + 3-way-merge bookkeeping.
          rowHash,
          importSnapshot: buildSnapshot(planMergeFileRow, PLAN_MERGE_FIELDS),
          manualOverrides: null,
        };

        const [inserted] = await tx
          .insert(workItems)
          .values(insertValues)
          .returning({ id: workItems.id });

        // Post-insert fixup: if this was a duplicate-group NEW, the matcher
        // stamped a temporary `#new-<fileIdx>` rowUid. Rewrite the row's
        // external_ref to the permanent `#pk<insertedId>` form so the
        // identity survives future commits deterministically.
        if (mr.inDuplicateGroup) {
          const permanentRowUid = `${mr.businessKey.key}#pk${inserted.id}`;
          const permanentRef = swapRowUidInRef(canonicalRef, rowUid, permanentRowUid);
          await tx.update(workItems)
            .set({ externalRef: permanentRef })
            .where(eq(workItems.id, inserted.id));
        }

        insertedIds.push(inserted.id);
        counts.inserted++;
      } else if (mr.classification === "CHANGED" || mr.classification === "CONFLICT_PLACEHOLDER") {
        const existingId = mr.existingRowId!;

        // Normalize legacy externalRefs whenever the row's current value
        // drifts from the canonical form (old `#idxN` suffix, missing
        // suffix after a dup-group promotion, etc.).
        const existingRef = mr.existingRow?.externalRef ?? null;
        const needsRefNormalize = existingRef !== canonicalRef;
        const existingRowHashOnDb = mr.existingRow?.rowHash ?? null;
        const needsHashUpgrade = rowHash != null && existingRowHashOnDb !== rowHash;

        // PR2C — when the merge produced no material change AND the
        // externalRef + rowHash are already canonical, this row is a
        // no-op. Re-importing the same workbook should be silent.
        if (resolved && !resolved.hasMaterialChanges && !needsRefNormalize && !needsHashUpgrade) {
          counts.unchanged++;
          if (savepointActive) {
            await tx.execute(sqlTag.raw(`RELEASE SAVEPOINT ${savepointName}`));
            savepointActive = false;
          }
          continue;
        }

        // Build the column-typed update payload from the resolved merge.
        const wiUpdates: Record<string, unknown> = {
          updatedAt: commitNow,
          importRunId: runId,
        };
        if (resolved) {
          for (const f of PLAN_MERGE_FIELDS) {
            wiUpdates[f] = resolved.values[f] ?? null;
          }
        }
        if (needsRefNormalize) {
          // Self-id fallback: if the canonical ref would collide with
          // another active row, fall back to `#pk<ownId>` which is
          // guaranteed unique. Protects against buggy matcher output or
          // unexpected legacy state.
          wiUpdates.externalRef = await resolveSafeRef(canonicalRef, existingId, mr.businessKey.key);
        }
        // PR2C — always refresh hash + snapshot + overrides on a real
        // update so the next import has a clean common ancestor.
        wiUpdates.rowHash = rowHash;
        if (resolved) {
          wiUpdates.importSnapshot = resolved.snapshot;
          wiUpdates.manualOverrides = Object.keys(resolved.manualOverrides).length > 0
            ? resolved.manualOverrides
            : null;
        }
        // Refresh ownerUserId from the incoming owner text on every update.
        wiUpdates.ownerUserId = resolveOwnerUserId(typeof fileRow.owner === "string" ? fileRow.owner : null);

        await tx.update(workItems).set(wiUpdates).where(eq(workItems.id, existingId));
        updatedIds.push(existingId);
        counts.updated++;
      }

      // Successful end of the writeable-row block — release the savepoint.
      if (savepointActive) {
        await tx.execute(sqlTag.raw(`RELEASE SAVEPOINT ${savepointName}`));
        savepointActive = false;
      }
    } catch (rowErr: any) {
      // Roll back this row's writes only — the rest of the sheet continues.
      if (savepointActive) {
        try { await tx.execute(sqlTag.raw(`ROLLBACK TO SAVEPOINT ${savepointName}`)); } catch { /* tx may already be poisoned */ }
        try { await tx.execute(sqlTag.raw(`RELEASE SAVEPOINT ${savepointName}`)); } catch { /* idempotent best-effort */ }
        savepointActive = false;
      }
      const fileRowErr = (mr.fileRow as any) ?? {};
      const code = rowErr?.code ?? rowErr?.cause?.code;
      const reason = code === "23505"
        ? "unique_violation"
        : code === "23503"
          ? "fk_violation"
          : code === "23502"
            ? "not_null_violation"
            : "write_failed";
      warnings.push({
        sourceRow: fileRowErr?.sourceRow ?? null,
        sourceSheet: fileRowErr?.sourceSheet ?? null,
        ref: canonicalRef ?? null,
        reason,
        cause: rowErr instanceof Error ? rowErr.message : String(rowErr),
      });
      console.warn(
        `[SmartImport] PLAN row ${rowIdx} (sourceRow=${fileRowErr?.sourceRow ?? "?"}) write failed; savepoint rolled back, sheet continues:`,
        { ref: canonicalRef, code, message: rowErr?.message ?? String(rowErr) },
      );
    }
  }

  // PR2C — end-of-pass cleanup. Soft-delete any active row in this project
  // whose row_hash is not in the seenRowHashes set (i.e. the workbook no
  // longer mentions it). This replaces the previous "missing rows are
  // kept indefinitely" policy with a precise hash-based sweep that only
  // closes rows the import deliberately removed.
  if (seenRowHashes.size > 0) {
    const activeRows = await tx
      .select({ id: workItems.id, rowHash: workItems.rowHash })
      .from(workItems)
      .where(and(
        eq(workItems.projectId, projectId),
        eq(workItems.source, "SMART_IMPORT"),
        isNull(workItems.deletedAt),
      ));
    const stale: number[] = [];
    for (const r of activeRows as Array<{ id: number; rowHash: string | null }>) {
      // Legacy rows without a hash haven't been re-imported yet — they're
      // bridged via the matcher path and will pick up a hash on the next
      // import. Don't soft-close them here, that would silently lose
      // the row before its hash gets a chance to refresh.
      if (!r.rowHash) continue;
      if (!seenRowHashes.has(r.rowHash)) stale.push(r.id);
    }
    if (stale.length > 0) {
      await tx.update(workItems)
        .set({ deletedAt: commitNow })
        .where(inArray(workItems.id, stale));
    }
  }

  // ── parentId pass ──
  // Walk all active SMART_IMPORT rows for this project ordered by
  // outlineNumber and set parentId to the nearest row whose outlineNumber
  // is a strict prefix. This is idempotent: re-importing recomputes from
  // scratch so hierarchy is always derived from the current outline numbers.
  if (seenRowHashes.size > 0) {
    const planRows = await tx
      .select({ id: workItems.id, outlineNumber: workItems.outlineNumber, parentId: workItems.parentId })
      .from(workItems)
      .where(and(
        eq(workItems.projectId, projectId),
        eq(workItems.source, "SMART_IMPORT"),
        isNull(workItems.deletedAt),
      ));

    // Sort by outline number so parents always appear before children.
    // Comparison treats each segment as a number so "2.10" sorts after "2.9".
    function parseOutline(s: string): number[] {
      return s.split(".").map(n => parseInt(n, 10) || 0);
    }
    function cmpOutline(a: string, b: string): number {
      const pa = parseOutline(a), pb = parseOutline(b);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    }
    const sorted = (planRows as Array<{ id: number; outlineNumber: string | null; parentId: number | null }>)
      .filter(r => r.outlineNumber)
      .sort((a, b) => cmpOutline(a.outlineNumber!, b.outlineNumber!));

    // Build outline → id map as we walk (parents always come first after sort).
    const outlineToId = new Map<string, number>();
    for (const row of sorted) {
      const outline = row.outlineNumber!;
      const lastDot = outline.lastIndexOf(".");
      const parentOutline = lastDot >= 0 ? outline.slice(0, lastDot) : null;
      const resolvedParentId = parentOutline ? (outlineToId.get(parentOutline) ?? null) : null;
      // Only write when parentId has changed to avoid unnecessary UPDATE churn.
      if (resolvedParentId !== row.parentId) {
        await tx.update(workItems)
          .set({ parentId: resolvedParentId })
          .where(eq(workItems.id, row.id));
      }
      outlineToId.set(outline, row.id);
    }
  }

  return { canonicalSource: CANONICAL_SOURCES.PLAN, counts, insertedIds, updatedIds, warnings, mergeConflicts };
}

// ---------------------------------------------------------------------------
// REVENUE section writer
// ---------------------------------------------------------------------------

export interface TemporalWriteContext {
  tx: any;
  projectId: number;
  projectName: string;
  runId: number;
  userId: number | null;
  matchedRows: MatchedRow[];
  mergeResults: Map<string, RowMergeResult>;
  conflictDecisions: Record<string, "keep_app" | "accept_file">;
  commitTimestamp: Date;
}

export async function writeRevenueIncremental(ctx: TemporalWriteContext): Promise<SectionCommitResult> {
  const { tx, projectId, projectName, runId, userId, matchedRows, mergeResults, conflictDecisions, commitTimestamp } = ctx;
  const { eq, and, isNull, inArray, sql: _sqlTag } = await import("drizzle-orm");
  const { normalizedRevenueLines } = await import("@shared/schema");
  const {
    applyQbPrecedence,
    lookupQbLink,
    writeQbVariances,
    repointQbLinks,
    isQbPrecedenceEnabled,
  } = await import("./qb-precedence");
  const qbPrecedenceOn = await isQbPrecedenceEnabled();

  const counts: CommitCounts = { inserted: 0, updated: 0, unchanged: 0, missing: 0, conflictsResolved: 0 };
  const insertedIds: number[] = [];
  const updatedIds: number[] = [];
  const warnings: RowWarning[] = [];
  const mergeConflicts: MergeConflictEntry[] = [];

  const COMPARE_FIELDS = [
    "amountExVat", "vat", "milestonePercent", "invoiceNumber", "invoiceDate",
    "expectedPaymentDate", "paidDate", "inBankDate", "status",
  ];

  // PR2C — set of row-hashes seen in this import (any classification). The
  // end-of-pass cleanup soft-closes active rows in this project whose hash
  // isn't here. UNCHANGED rows still register their hash so the sweep
  // doesn't kill them.
  const seenRowHashes = new Set<string>();

  /** Look up the existing active row by `(projectId, rowHash)`. */
  async function lookupActiveByHash(rowHash: string): Promise<Record<string, unknown> | null> {
    const rows = await tx
      .select()
      .from(normalizedRevenueLines)
      .where(and(
        eq(normalizedRevenueLines.projectId, projectId),
        eq(normalizedRevenueLines.rowHash, rowHash),
        isNull(normalizedRevenueLines.effectiveTo),
      ))
      .limit(1);
    return rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
  }

  // Admin-override carry-forward: see expenditure section for rationale.
  type RevPredecessor = {
    milestoneName: string | null;
    description: string | null;
    amountExVat: any;
    adminDateOverride: any;
    adminDateOverrideReason: string | null;
    adminDateOverrideBy: any;
    adminDateOverrideAt: any;
  };
  const closedRevPreds: RevPredecessor[] = [];
  const consumedRevIdxs = new Set<number>();
  function normStrR(s: any): string {
    return (s == null ? "" : String(s)).trim().toLowerCase();
  }
  function normAmtR(v: any): string {
    if (v == null || v === "") return "";
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return String(v).trim();
    return n.toFixed(2);
  }
  function findRevPredecessor(f: Record<string, any>): RevPredecessor | null {
    const fa = normAmtR(f.amountExVat);
    const fm = normStrR(f.milestoneName);
    const fd = normStrR(f.description);
    for (let i = 0; i < closedRevPreds.length; i++) {
      if (consumedRevIdxs.has(i)) continue;
      const p = closedRevPreds[i];
      if (
        normStrR(p.milestoneName) === fm &&
        normStrR(p.description) === fd &&
        normAmtR(p.amountExVat) === fa
      ) {
        consumedRevIdxs.add(i);
        return p;
      }
    }
    return null;
  }

  // Per-row QB variances accumulated during this commit; flushed once at end.
  type PendingVariance = { appEntityId: number; variances: any[] };
  const qbVariancePending: PendingVariance[] = [];

  // PRE-PASS: process MISSING_FROM_UPLOAD rows first so the predecessor
  // pool is fully populated before any NEW row is inserted. matchRows()
  // emits NEW/CHANGED/UNCHANGED in file-row order and MISSING last, so
  // without this pre-pass findRevPredecessor() would always come up empty
  // for key-shift cases (the most common admin-override loss path).
  for (const mr of matchedRows) {
    if (mr.classification !== "MISSING_FROM_UPLOAD") continue;
    counts.missing++;
    if (mr.existingRowId == null) continue;

    // QB precedence: if the row is QB-linked, the workbook's silence on it
    // does NOT justify removal — QB still considers the document to exist.
    // Suppress the soft-close and log a "missing_preserved" variance so the
    // operator can see what happened.
    if (qbPrecedenceOn) {
      const link = await lookupQbLink({ tx, appEntityType: "revenue_line", appEntityId: mr.existingRowId });
      if (link) {
        qbVariancePending.push({
          appEntityId: mr.existingRowId,
          variances: [{
            field: "row",
            workbookValue: "missing",
            qbValue: link.qbDocNumber ?? link.qbEntityId,
            resolution: "missing_preserved",
            notes: `Row preserved because QB link ${link.id} is active`,
            qbLinkId: link.id,
            qbDocId: null,
            qbRealmId: link.qbRealmId,
          }],
        });
        // PR2C — mark the preserved row's hash as seen so the end-of-pass
        // hash-cleanup sweep doesn't soft-close it.
        const preservedHash = mr.existingRow?.rowHash;
        if (typeof preservedHash === "string" && preservedHash) {
          seenRowHashes.add(preservedHash);
        }
        continue;
      }
    }

    await tx.update(normalizedRevenueLines)
      .set({ effectiveTo: commitTimestamp })
      .where(eq(normalizedRevenueLines.id, mr.existingRowId));
    const er = (mr.existingRow ?? {}) as any;
    if (er.adminDateOverride) {
      closedRevPreds.push({
        milestoneName: er.milestoneName ?? null,
        description: er.description ?? null,
        amountExVat: er.amountExVat,
        adminDateOverride: er.adminDateOverride ?? null,
        adminDateOverrideReason: er.adminDateOverrideReason ?? null,
        adminDateOverrideBy: er.adminDateOverrideBy ?? null,
        adminDateOverrideAt: er.adminDateOverrideAt ?? null,
      });
    }
  }

  for (const mr of matchedRows) {
    if (mr.classification === "MISSING_FROM_UPLOAD") {
      // Already handled in pre-pass above.
      continue;
    }

    const f = (mr.fileRow ?? {}) as Record<string, unknown>;
    const rowHash = mr.fileRow ? hashRevenueRow({
      projectId,
      milestoneNo: typeof f.milestoneNo === "string" ? f.milestoneNo : null,
      milestoneName: typeof f.milestoneName === "string" ? f.milestoneName : null,
      amountExVat: (typeof f.amountExVat === "string" || typeof f.amountExVat === "number")
        ? f.amountExVat as string | number
        : null,
    }) : null;

    if (rowHash) {
      if (seenRowHashes.has(rowHash)) {
        warnings.push({
          sourceRow: typeof f.sourceRow === "number" ? f.sourceRow : null,
          sourceSheet: typeof f.sourceSheet === "string" ? f.sourceSheet : null,
          ref: null,
          reason: "duplicate_row_hash",
          cause: `Duplicate row hash within this import for REVENUE row — second occurrence skipped to avoid silent overwrite.`,
        });
        console.warn(
          `[SmartImport] REVENUE duplicate row_hash within file (hash=${rowHash}); skipping second occurrence.`,
        );
        continue;
      }
      seenRowHashes.add(rowHash);
    }

    if (mr.classification === "UNCHANGED") {
      counts.unchanged++;
      continue;
    }

    // PR2C — match the existing active row by hash first; fall back to the
    // matcher's existingRow as a one-time bridge for legacy rows.
    let hashMatchedRow: Record<string, unknown> | null = rowHash
      ? await lookupActiveByHash(rowHash)
      : null;
    if (!hashMatchedRow && mr.existingRowId != null && mr.existingRow) {
      hashMatchedRow = mr.existingRow as Record<string, unknown>;
    }

    const revFileForMerge = buildMergeRow(f, REVENUE_MERGE_FIELDS);
    const importSnapshot = readSnapshot(hashMatchedRow ? hashMatchedRow.importSnapshot : null);
    const existingManualOverrides = readManualOverrides(
      hashMatchedRow ? hashMatchedRow.manualOverrides : null,
    );
    const existingForMerge = hashMatchedRow
      ? ({
          id: typeof hashMatchedRow.id === "number" ? hashMatchedRow.id : 0,
          ...buildMergeRow(hashMatchedRow, REVENUE_MERGE_FIELDS),
        } as Record<string, FieldValue> & { id: number })
      : null;

    const merge = gatedMergeRowEngine({
      rowHash: rowHash ?? `legacy::revenue::${mr.businessKey.key}`,
      fileRow: revFileForMerge,
      existingRow: existingForMerge,
      importSnapshot,
      fields: [...REVENUE_MERGE_FIELDS],
    });

    const rowUid = mr.rowUid ?? mr.businessKey.key;
    const engineResolutions = buildEngineResolutions(rowUid, conflictDecisions, merge.conflicts);
    const resolvedFieldNames = new Set(engineResolutions.map(r => r.fieldName));
    const unresolvedConflicts = merge.conflicts.filter(c => !resolvedFieldNames.has(c.fieldName));

    if (unresolvedConflicts.length > 0 && existingForMerge) {
      const rowLabel = mr.businessKey.rowLabel ?? rowUid;
      for (const c of unresolvedConflicts) {
        mergeConflicts.push({
          rowKey: rowUid,
          displayLabel: rowLabel,
          section: "REVENUE",
          rowHash: rowHash ?? "",
          existingRowId: existingForMerge.id,
          fieldName: c.fieldName,
          snapshotValue: c.snapshotValue,
          existingValue: c.existingValue,
          importValue: c.importValue,
        });
      }
      continue;
    }

    if (mr.classification === "NEW") {
      const carriedRev = findRevPredecessor(f as Record<string, any>);
      // PR2C — if a hash-matched active row exists, treat this NEW
      // classification as "the matcher missed it" and route through the
      // CHANGED/UPDATE path below to avoid creating a duplicate row.
      if (existingForMerge) {
        // Fall through to the CHANGED block by re-classifying locally.
      } else {
        const insertSnapshot = buildSnapshot(revFileForMerge, REVENUE_MERGE_FIELDS);
        const [inserted] = await tx.insert(normalizedRevenueLines).values({
          projectId,
          projectName,
          description: f.description || f.milestoneName,
          milestoneName: f.milestoneName,
          milestoneNo: f.milestoneNo || null,
          milestonePercent: f.milestonePercent || null,
          amountExVat: f.amountExVat,
          vat: f.vat,
          invoiceNumber: f.invoiceNumber,
          invoiceDate: f.invoiceDate,
          invoiceDateFontColor: f.invoiceDateFontColor || null,
          invoiceDateConfirmed: f.invoiceDateConfirmed || false,
          expectedPaymentDate: f.expectedPaymentDate,
          paidDate: f.paidDate,
          paidDateFontColor: f.paidDateFontColor || null,
          paidDateConfirmed: f.paidDateConfirmed || false,
          inBankDate: f.inBankDate,
          status: normalizeRevenueLineStatus(f.status),
          sourceSheet: f.sourceSheet,
          sourceRow: f.sourceRow,
          importRunId: runId,
          turnaroundDays: f.turnaroundDays,
          subProjectName: f.subProjectName || null,
          // PR2A tracker column.
          milestoneNotes: f.milestoneNotes ?? null,
          effectiveFrom: commitTimestamp,
          effectiveTo: null,
          snapshotRunId: runId,
          // Carry forward admin overrides from a soft-closed predecessor row
          // (key-shift case — see expenditure section for full rationale).
          adminDateOverride: carriedRev?.adminDateOverride ?? null,
          adminDateOverrideReason: carriedRev?.adminDateOverrideReason ?? null,
          adminDateOverrideBy: carriedRev?.adminDateOverrideBy ?? null,
          adminDateOverrideAt: carriedRev?.adminDateOverrideAt ?? null,
          // PR2C — stable identity + 3-way-merge bookkeeping.
          rowHash,
          importSnapshot: insertSnapshot,
          manualOverrides: null,
        }).returning();
        insertedIds.push(inserted.id);
        counts.inserted++;
        continue;
      }
    }

    if (mr.classification === "CHANGED" || mr.classification === "CONFLICT_PLACEHOLDER" || mr.classification === "NEW") {
      // CHANGED, CONFLICT_PLACEHOLDER, OR a NEW that resolved into an
      // existing hash match (see fall-through above).
      if (!existingForMerge) {
        // Defensive — should not happen; CHANGED implies existing row.
        continue;
      }
      const existingId = existingForMerge.id;
      const existingRow = (hashMatchedRow ?? mr.existingRow ?? {}) as Record<string, any>;
      const fileRow = f;

      // Resolve the merge to compute final field values + new snapshot/overrides.
      const resolved = resolveMergeResult(
        merge,
        revFileForMerge,
        engineResolutions,
        REVENUE_MERGE_FIELDS,
        userId,
        existingManualOverrides,
        commitTimestamp,
      );
      counts.conflictsResolved += resolved.conflictCount;

      // QB precedence: for QB-linked rows, lock amount/VAT/invoice-number/
      // dates to the QB-canonical values. Mutate resolved.values so the
      // insert below picks up the locked values automatically.
      let qbVariancesForRow: any[] = [];
      let qbLinkedRow = false;
      if (qbPrecedenceOn) {
        const proposed: Record<string, any> = {
          amountExVat: resolved.values.amountExVat ?? existingRow.amountExVat,
          vat: resolved.values.vat ?? existingRow.vat,
          invoiceNumber: resolved.values.invoiceNumber ?? existingRow.invoiceNumber,
          invoiceDate: resolved.values.invoiceDate ?? existingRow.invoiceDate,
          paidDate: resolved.values.paidDate ?? existingRow.paidDate,
          inBankDate: resolved.values.inBankDate ?? existingRow.inBankDate,
        };
        const qbResult = await applyQbPrecedence({
          tx,
          appEntityType: "revenue_line",
          appEntityId: existingId,
          proposedValues: proposed,
        });
        if (qbResult.isLinked) {
          qbLinkedRow = true;
          for (const fld of qbResult.lockedFields) {
            if (qbResult.finalValues[fld] !== undefined) {
              resolved.values[fld] = qbResult.finalValues[fld] as FieldValue;
            }
          }
          qbVariancesForRow = qbResult.variances;
        }
      }

      const existingHashOnDb = existingRow.rowHash ?? null;
      const needsHashUpgrade = rowHash != null && existingHashOnDb !== rowHash;

      // PR2C — idempotency. If the merge produced no material change AND
      // QB has nothing to add AND the existing row already carries the
      // canonical hash, this re-import is a no-op for this row.
      if (!resolved.hasMaterialChanges && qbVariancesForRow.length === 0 && !needsHashUpgrade) {
        counts.unchanged++;
        continue;
      }

      // Soft-close the existing row and insert a replacement. We only
      // reach here when the merge has real changes to apply.
      await tx.update(normalizedRevenueLines)
        .set({ effectiveTo: commitTimestamp })
        .where(eq(normalizedRevenueLines.id, existingId));

      const insertManualOverrides = Object.keys(resolved.manualOverrides).length > 0
        ? resolved.manualOverrides
        : null;
      const [inserted] = await tx.insert(normalizedRevenueLines).values({
        projectId,
        projectName,
        description: existingRow.description,
        milestoneName: existingRow.milestoneName,
        milestoneNo: fileRow.milestoneNo || existingRow.milestoneNo || null,
        milestonePercent: resolved.values.milestonePercent ?? existingRow.milestonePercent ?? null,
        amountExVat: resolved.values.amountExVat ?? existingRow.amountExVat,
        vat: resolved.values.vat ?? existingRow.vat,
        invoiceNumber: resolved.values.invoiceNumber ?? existingRow.invoiceNumber,
        invoiceDate: resolved.values.invoiceDate ?? existingRow.invoiceDate,
        invoiceDateFontColor: fileRow.invoiceDateFontColor ?? existingRow.invoiceDateFontColor,
        invoiceDateConfirmed: resolved.values.invoiceDateConfirmed ?? existingRow.invoiceDateConfirmed,
        expectedPaymentDate: resolved.values.expectedPaymentDate ?? existingRow.expectedPaymentDate,
        paidDate: resolved.values.paidDate ?? existingRow.paidDate,
        paidDateFontColor: fileRow.paidDateFontColor ?? existingRow.paidDateFontColor,
        paidDateConfirmed: resolved.values.paidDateConfirmed ?? existingRow.paidDateConfirmed,
        inBankDate: resolved.values.inBankDate ?? existingRow.inBankDate,
        status: normalizeRevenueLineStatus(resolved.values.status ?? existingRow.status),
        sourceSheet: existingRow.sourceSheet || fileRow.sourceSheet,
        sourceRow: existingRow.sourceRow || fileRow.sourceRow,
        importRunId: runId,
        turnaroundDays: fileRow.turnaroundDays,
        subProjectName: existingRow.subProjectName,
        // PR2A tracker column.
        milestoneNotes: resolved.values.milestoneNotes ?? existingRow.milestoneNotes ?? null,
        effectiveFrom: commitTimestamp,
        effectiveTo: null,
        snapshotRunId: runId,
        // Carry forward admin overrides from existing row.
        adminDateOverride: existingRow.adminDateOverride || null,
        adminDateOverrideReason: existingRow.adminDateOverrideReason || null,
        adminDateOverrideBy: existingRow.adminDateOverrideBy || null,
        adminDateOverrideAt: existingRow.adminDateOverrideAt || null,
        // PR2C — stable identity + 3-way-merge bookkeeping.
        rowHash,
        importSnapshot: resolved.snapshot,
        manualOverrides: insertManualOverrides,
      }).returning();
      insertedIds.push(inserted.id);
      updatedIds.push(existingId); // the old ID that was soft-closed
      counts.updated++;
      if (qbVariancesForRow.length > 0) {
        qbVariancePending.push({ appEntityId: inserted.id, variances: qbVariancesForRow });
      }
      // Re-point any active QB link from the soft-closed predecessor to
      // the new inserted row id so the gate keeps firing on the next
      // import. This MUST run for ANY linked CHANGED row — even when the
      // change was in a non-locked field and produced no variances —
      // otherwise the link rots on the dead row and protections silently
      // erode over re-imports.
      if (qbLinkedRow) {
        try {
          await repointQbLinks({
            tx,
            appEntityType: "revenue_line",
            oldAppEntityId: existingId,
            newAppEntityId: inserted.id,
          });
        } catch (err) {
          console.error("[commit-executor] Failed to re-point QB link for revenue:", err);
        }
      }
    }
  }

  // PR2C — end-of-pass cleanup. Soft-close any active row in this project
  // whose row_hash is not in seenRowHashes (i.e. the workbook no longer
  // mentions it). Rows already soft-closed by the MISSING pre-pass are
  // filtered out by the `effectiveTo IS NULL` predicate.
  if (seenRowHashes.size > 0) {
    const activeRows = await tx
      .select({ id: normalizedRevenueLines.id, rowHash: normalizedRevenueLines.rowHash })
      .from(normalizedRevenueLines)
      .where(and(
        eq(normalizedRevenueLines.projectId, projectId),
        isNull(normalizedRevenueLines.effectiveTo),
      ));
    const stale: number[] = [];
    for (const r of activeRows as Array<{ id: number; rowHash: string | null }>) {
      // Legacy rows without a hash haven't been re-imported yet — leave
      // them to the matcher path so they get a hash on next import.
      if (!r.rowHash) continue;
      if (!seenRowHashes.has(r.rowHash)) stale.push(r.id);
    }
    if (stale.length > 0) {
      await tx.update(normalizedRevenueLines)
        .set({ effectiveTo: commitTimestamp })
        .where(inArray(normalizedRevenueLines.id, stale));
    }
  }

  // Flush QB variances. Failure to log MUST NOT fail the import.
  if (qbPrecedenceOn && qbVariancePending.length > 0) {
    try {
      for (const p of qbVariancePending) {
        await writeQbVariances({
          tx,
          importRunId: runId,
          projectId,
          appEntityType: "revenue_line",
          appEntityId: p.appEntityId,
          variances: p.variances,
        });
      }
    } catch (err) {
      console.error("[commit-executor] Failed to log QB variances for revenue:", err);
    }
  }

  return { canonicalSource: CANONICAL_SOURCES.REVENUE, counts, insertedIds, updatedIds, warnings, mergeConflicts };
}

// ---------------------------------------------------------------------------
// EXPENDITURE section writer
// ---------------------------------------------------------------------------

export async function writeExpenditureIncremental(ctx: TemporalWriteContext): Promise<SectionCommitResult> {
  const { tx, projectId, projectName, runId, userId, matchedRows, mergeResults, conflictDecisions, commitTimestamp } = ctx;
  const { eq, and, isNull, inArray } = await import("drizzle-orm");
  const { normalizedCostLines, counterparties } = await import("@shared/schema");
  const {
    applyQbPrecedence,
    lookupQbLink,
    writeQbVariances,
    repointQbLinks,
    isQbPrecedenceEnabled,
  } = await import("./qb-precedence");
  const qbPrecedenceOn = await isQbPrecedenceEnabled();

  // Build a normalised-name → {id, type} lookup for counterparty resolution.
  // Covers nameCanonical and every entry in nameAliases (JSONB string array).
  // Cached once for the duration of this import run.
  type CounterpartyMatch = { id: number; type: string };
  const counterpartyByName = new Map<string, CounterpartyMatch>();
  const cpRows = await tx
    .select({ id: counterparties.id, name: counterparties.nameCanonical, aliases: counterparties.nameAliases, type: counterparties.typeDefault })
    .from(counterparties)
    .where(and(eq(counterparties.isActive, true), isNull(counterparties.deletedAt)));
  for (const cp of cpRows as Array<{ id: number; name: string; aliases: unknown; type: string }>) {
    const hit: CounterpartyMatch = { id: cp.id, type: cp.type };
    counterpartyByName.set(cp.name.trim().toLowerCase(), hit);
    const aliases = Array.isArray(cp.aliases) ? cp.aliases : [];
    for (const alias of aliases) {
      if (typeof alias === "string" && alias.trim()) {
        counterpartyByName.set(alias.trim().toLowerCase(), hit);
      }
    }
  }
  function resolveCounterparty(name: unknown): CounterpartyMatch | null {
    if (!name || typeof name !== "string") return null;
    return counterpartyByName.get(name.trim().toLowerCase()) ?? null;
  }

  const counts: CommitCounts = { inserted: 0, updated: 0, unchanged: 0, missing: 0, conflictsResolved: 0 };
  const insertedIds: number[] = [];
  const updatedIds: number[] = [];
  const warnings: RowWarning[] = [];
  const mergeConflicts: MergeConflictEntry[] = [];

  const COMPARE_FIELDS = [
    "amountExVat", "budgetQty", "budgetRate", "budgetTotal", "budgetCos",
    "invoiceNumber", "invoiceDate", "approvedDate", "paidDate",
    "forecastPaymentDate", "poNumber", "costCategory", "status",
    "counterpartyName", "revenueRecognitionAmount",
  ];

  // PR2C — set of row-hashes seen in this import. End-of-pass cleanup
  // soft-closes active rows in this project whose hash isn't here.
  const seenRowHashes = new Set<string>();

  /** Look up the existing active row by `(projectId, rowHash)`. */
  async function lookupActiveByHash(rowHash: string): Promise<Record<string, unknown> | null> {
    const rows = await tx
      .select()
      .from(normalizedCostLines)
      .where(and(
        eq(normalizedCostLines.projectId, projectId),
        eq(normalizedCostLines.rowHash, rowHash),
        isNull(normalizedCostLines.effectiveTo),
      ))
      .limit(1);
    return rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
  }

  // Admin-override carry-forward: when a row's business key shifts between
  // imports (e.g. invoice_number filled in for the first time), the matcher
  // classifies the old row as MISSING and the new row as NEW. To avoid
  // losing user-applied overrides on that identity shift, we collect every
  // soft-closed MISSING row up front and then, in the NEW insert path,
  // look for a similarity match (counterparty + description + amount) and
  // carry forward override fields from the closed predecessor.
  type ClosedPredecessor = {
    counterpartyName: string | null;
    description: string | null;
    amountExVat: any;
    adminDateOverride: any;
    adminDateOverrideReason: string | null;
    adminDateOverrideBy: any;
    adminDateOverrideAt: any;
    cosStatusOverride: any;
    cosStatusOverrideReason: string | null;
    cosStatusOverrideBy: any;
    cosStatusOverrideAt: any;
  };
  const closedPredecessors: ClosedPredecessor[] = [];
  const consumedPredecessorIdxs = new Set<number>();

  function normStr(s: any): string {
    return (s == null ? "" : String(s)).trim().toLowerCase();
  }
  function normAmt(v: any): string {
    if (v == null || v === "") return "";
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return String(v).trim();
    return n.toFixed(2);
  }
  function findPredecessor(f: Record<string, any>): ClosedPredecessor | null {
    const fa = normAmt(f.amountExVat);
    const fc = normStr(f.counterpartyName);
    const fd = normStr(f.description);
    for (let i = 0; i < closedPredecessors.length; i++) {
      if (consumedPredecessorIdxs.has(i)) continue;
      const p = closedPredecessors[i];
      if (
        normStr(p.counterpartyName) === fc &&
        normStr(p.description) === fd &&
        normAmt(p.amountExVat) === fa
      ) {
        consumedPredecessorIdxs.add(i);
        return p;
      }
    }
    return null;
  }

  // Per-row QB variances accumulated during this commit; flushed once at end.
  type PendingCostVariance = { appEntityId: number; variances: any[] };
  const qbCostVariancePending: PendingCostVariance[] = [];

  // PRE-PASS: process MISSING_FROM_UPLOAD rows first so the predecessor
  // pool is fully populated before any NEW row is inserted. matchRows()
  // emits NEW/CHANGED/UNCHANGED in file-row order and MISSING last, so
  // without this pre-pass findPredecessor() would always come up empty
  // for key-shift cases (the most common admin-override loss path).
  for (const mr of matchedRows) {
    if (mr.classification !== "MISSING_FROM_UPLOAD") continue;
    counts.missing++;
    if (mr.existingRowId == null) continue;

    // QB precedence: suppress soft-close if the row is QB-linked.
    if (qbPrecedenceOn) {
      const link = await lookupQbLink({ tx, appEntityType: "cost_line", appEntityId: mr.existingRowId });
      if (link) {
        qbCostVariancePending.push({
          appEntityId: mr.existingRowId,
          variances: [{
            field: "row",
            workbookValue: "missing",
            qbValue: link.qbDocNumber ?? link.qbEntityId,
            resolution: "missing_preserved",
            notes: `Row preserved because QB link ${link.id} is active`,
            qbLinkId: link.id,
            qbDocId: null,
            qbRealmId: link.qbRealmId,
          }],
        });
        // PR2C — mark the preserved row's hash as seen so the end-of-pass
        // hash-cleanup sweep doesn't soft-close it.
        const preservedHash = mr.existingRow?.rowHash;
        if (typeof preservedHash === "string" && preservedHash) {
          seenRowHashes.add(preservedHash);
        }
        continue;
      }
    }

    await tx.update(normalizedCostLines)
      .set({ effectiveTo: commitTimestamp })
      .where(eq(normalizedCostLines.id, mr.existingRowId));
    const er = (mr.existingRow ?? {}) as any;
    if (er.adminDateOverride || er.cosStatusOverride) {
      closedPredecessors.push({
        counterpartyName: er.counterpartyName ?? null,
        description: er.description ?? null,
        amountExVat: er.amountExVat,
        adminDateOverride: er.adminDateOverride ?? null,
        adminDateOverrideReason: er.adminDateOverrideReason ?? null,
        adminDateOverrideBy: er.adminDateOverrideBy ?? null,
        adminDateOverrideAt: er.adminDateOverrideAt ?? null,
        cosStatusOverride: er.cosStatusOverride ?? null,
        cosStatusOverrideReason: er.cosStatusOverrideReason ?? null,
        cosStatusOverrideBy: er.cosStatusOverrideBy ?? null,
        cosStatusOverrideAt: er.cosStatusOverrideAt ?? null,
      });
    }
  }

  for (const mr of matchedRows) {
    if (mr.classification === "MISSING_FROM_UPLOAD") {
      // Already handled in pre-pass above.
      continue;
    }

    const f = (mr.fileRow ?? {}) as Record<string, unknown>;
    const rowHash = mr.fileRow ? hashExpenditureRow({
      projectId,
      categoryKey: typeof f.categoryKey === "string" ? f.categoryKey : null,
      costCategory: typeof f.costCategory === "string" ? f.costCategory : null,
      description: typeof f.description === "string" ? f.description : null,
      invoiceNumber: typeof f.invoiceNumber === "string" ? f.invoiceNumber : null,
    }) : null;

    if (rowHash) {
      if (seenRowHashes.has(rowHash)) {
        warnings.push({
          sourceRow: typeof f.sourceRow === "number" ? f.sourceRow : null,
          sourceSheet: typeof f.sourceSheet === "string" ? f.sourceSheet : null,
          ref: null,
          reason: "duplicate_row_hash",
          cause: `Duplicate row hash within this import for EXPENDITURE row — second occurrence skipped to avoid silent overwrite.`,
        });
        console.warn(
          `[SmartImport] EXPENDITURE duplicate row_hash within file (hash=${rowHash}); skipping second occurrence.`,
        );
        continue;
      }
      seenRowHashes.add(rowHash);
    }

    if (mr.classification === "UNCHANGED") {
      counts.unchanged++;
      continue;
    }

    // PR2C — match the existing active row by hash first; fall back to the
    // matcher's existingRow as a one-time bridge for legacy rows.
    let hashMatchedRow: Record<string, unknown> | null = rowHash
      ? await lookupActiveByHash(rowHash)
      : null;
    if (!hashMatchedRow && mr.existingRowId != null && mr.existingRow) {
      hashMatchedRow = mr.existingRow as Record<string, unknown>;
    }

    const costFileForMerge = buildMergeRow(f, EXPENDITURE_MERGE_FIELDS);
    const importSnapshot = readSnapshot(hashMatchedRow ? hashMatchedRow.importSnapshot : null);
    const existingManualOverrides = readManualOverrides(
      hashMatchedRow ? hashMatchedRow.manualOverrides : null,
    );
    const existingForMerge = hashMatchedRow
      ? ({
          id: typeof hashMatchedRow.id === "number" ? hashMatchedRow.id : 0,
          ...buildMergeRow(hashMatchedRow, EXPENDITURE_MERGE_FIELDS),
        } as Record<string, FieldValue> & { id: number })
      : null;

    const merge = gatedMergeRowEngine({
      rowHash: rowHash ?? `legacy::expenditure::${mr.businessKey.key}`,
      fileRow: costFileForMerge,
      existingRow: existingForMerge,
      importSnapshot,
      fields: [...EXPENDITURE_MERGE_FIELDS],
    });

    const rowUid = mr.rowUid ?? mr.businessKey.key;
    const engineResolutions = buildEngineResolutions(rowUid, conflictDecisions, merge.conflicts);
    const resolvedFieldNames = new Set(engineResolutions.map(r => r.fieldName));
    const unresolvedConflicts = merge.conflicts.filter(c => !resolvedFieldNames.has(c.fieldName));

    if (unresolvedConflicts.length > 0 && existingForMerge) {
      const rowLabel = mr.businessKey.rowLabel ?? rowUid;
      for (const c of unresolvedConflicts) {
        mergeConflicts.push({
          rowKey: rowUid,
          displayLabel: rowLabel,
          section: "EXPENDITURE",
          rowHash: rowHash ?? "",
          existingRowId: existingForMerge.id,
          fieldName: c.fieldName,
          snapshotValue: c.snapshotValue,
          existingValue: c.existingValue,
          importValue: c.importValue,
        });
      }
      continue;
    }

    if (mr.classification === "NEW") {
      const carried = findPredecessor(f as Record<string, any>);
      // PR2C — if a hash-matched active row exists, fall through to the
      // CHANGED path so the merge engine drives the write.
      if (existingForMerge) {
        // Falls through to the CHANGED block below.
      } else {
        const insertSnapshot = buildSnapshot(costFileForMerge, EXPENDITURE_MERGE_FIELDS);
        const cpMatch = resolveCounterparty(f.counterpartyName);
        const [inserted] = await tx.insert(normalizedCostLines).values({
          projectId,
          projectName,
          costCategory: f.costCategory,
          counterpartyName: f.counterpartyName,
          counterpartyId: cpMatch?.id ?? null,
          counterpartyType: (cpMatch?.type as any) ?? null,
          description: f.description,
          amountExVat: f.amountExVat,
          invoiceNumber: f.invoiceNumber,
          invoiceDate: f.invoiceDate,
          invoiceDateFontColor: f.invoiceDateFontColor || null,
          invoiceDateConfirmed: f.invoiceDateConfirmed || false,
          approvedDate: f.approvedDate,
          paidDate: f.paidDate,
          paidDateFontColor: f.paidDateFontColor || null,
          paidDateConfirmed: f.paidDateConfirmed || false,
          poNumber: f.poNumber,
          cosRealised: f.cosRealised || false,
          cashflowConfirmed: f.cashflowConfirmed || false,
          status: normalizeCostLineStatus(f.status),
          sourceSheet: f.sourceSheet,
          sourceRow: f.sourceRow,
          importRunId: runId,
          turnaroundDays: f.turnaroundDays,
          budgetQty: f.budgetQty || null,
          budgetRate: f.budgetRate || null,
          budgetTotal: f.budgetTotal || null,
          budgetCos: f.budgetCos || null,
          revenueRecognitionAmount: f.revenueRecognitionAmount || null,
          forecastPaymentDate: f.forecastPaymentDate || null,
          subProjectName: f.subProjectName || null,
          // PR2A tracker columns.
          actualQty: f.actualQty ?? null,
          actualRate: f.actualRate ?? null,
          comments: f.comments ?? null,
          checkFlag: f.checkFlag ?? null,
          savingOverrun: f.savingOverrun ?? null,
          usdExchangeRate: f.usdExchangeRate ?? null,
          pricePerWatt: f.pricePerWatt ?? null,
          effectiveFrom: commitTimestamp,
          effectiveTo: null,
          snapshotRunId: runId,
          // Carry forward admin overrides from a soft-closed predecessor row
          // when this NEW row is the same business entity under a shifted key.
          adminDateOverride: carried?.adminDateOverride ?? null,
          adminDateOverrideReason: carried?.adminDateOverrideReason ?? null,
          adminDateOverrideBy: carried?.adminDateOverrideBy ?? null,
          adminDateOverrideAt: carried?.adminDateOverrideAt ?? null,
          cosStatusOverride: carried?.cosStatusOverride ?? null,
          cosStatusOverrideReason: carried?.cosStatusOverrideReason ?? null,
          cosStatusOverrideBy: carried?.cosStatusOverrideBy ?? null,
          cosStatusOverrideAt: carried?.cosStatusOverrideAt ?? null,
          // PR2C — stable identity + 3-way-merge bookkeeping.
          rowHash,
          importSnapshot: insertSnapshot,
          manualOverrides: null,
        }).returning();
        insertedIds.push(inserted.id);
        counts.inserted++;
        continue;
      }
    }

    if (mr.classification === "CHANGED" || mr.classification === "CONFLICT_PLACEHOLDER" || mr.classification === "NEW") {
      // CHANGED / CONFLICT_PLACEHOLDER, OR a NEW that resolved into an
      // existing hash match (see fall-through above).
      if (!existingForMerge) {
        continue;
      }
      const existingId = existingForMerge.id;
      const existing = (hashMatchedRow ?? mr.existingRow ?? {}) as Record<string, any>;
      const fileRow = f;

      const resolved = resolveMergeResult(
        merge,
        costFileForMerge,
        engineResolutions,
        EXPENDITURE_MERGE_FIELDS,
        userId,
        existingManualOverrides,
        commitTimestamp,
      );
      counts.conflictsResolved += resolved.conflictCount;

      // QB precedence: lock fields, force auto-realisation when QB shows
      // Paid, and surface variances.
      let qbVariancesForRow: any[] = [];
      let qbLinkedRow = false;
      let qbForceCosRealised: boolean | null = null;
      if (qbPrecedenceOn) {
        const proposed: Record<string, any> = {
          amountExVat: resolved.values.amountExVat ?? existing.amountExVat,
          invoiceNumber: resolved.values.invoiceNumber ?? existing.invoiceNumber,
          invoiceDate: resolved.values.invoiceDate ?? existing.invoiceDate,
          paidDate: resolved.values.paidDate ?? existing.paidDate,
          inBankDate: resolved.values.inBankDate ?? existing.inBankDate,
          cosRealised: existing.cosRealised,
        };
        const qbResult = await applyQbPrecedence({
          tx,
          appEntityType: "cost_line",
          appEntityId: existingId,
          proposedValues: proposed,
        });
        if (qbResult.isLinked) {
          qbLinkedRow = true;
          for (const fld of qbResult.lockedFields) {
            if (qbResult.finalValues[fld] !== undefined) {
              resolved.values[fld] = qbResult.finalValues[fld] as FieldValue;
            }
          }
          qbVariancesForRow = qbResult.variances;
          // QB Paid → cosRealised must be true regardless of workbook flag.
          if (qbResult.autoRealised || qbResult.finalValues.cosRealised === true) {
            qbForceCosRealised = true;
          }
        }
      }

      const existingHashOnDb = existing.rowHash ?? null;
      const needsHashUpgrade = rowHash != null && existingHashOnDb !== rowHash;

      // PR2C — idempotency. If the merge produced no material change AND
      // QB has nothing to add AND the existing row already carries the
      // canonical hash, skip the write entirely.
      if (!resolved.hasMaterialChanges && qbVariancesForRow.length === 0 && !needsHashUpgrade) {
        counts.unchanged++;
        continue;
      }

      // Temporal: soft-close existing row and insert replacement.
      await tx.update(normalizedCostLines)
        .set({ effectiveTo: commitTimestamp })
        .where(eq(normalizedCostLines.id, existingId));

      const insertManualOverrides = Object.keys(resolved.manualOverrides).length > 0
        ? resolved.manualOverrides
        : null;
      // Re-resolve counterparty from the incoming name (file wins on CHANGED rows;
      // falls back to the existing FK when the name didn't change and had a match).
      const changedCpName = resolved.values.counterpartyName ?? existing.counterpartyName;
      const changedCpMatch = resolveCounterparty(changedCpName) ?? (
        existing.counterpartyId ? { id: existing.counterpartyId as number, type: existing.counterpartyType as string } : null
      );
      const [inserted] = await tx.insert(normalizedCostLines).values({
        projectId,
        projectName,
        costCategory: resolved.values.costCategory ?? existing.costCategory,
        counterpartyName: changedCpName,
        counterpartyId: changedCpMatch?.id ?? null,
        counterpartyType: (changedCpMatch?.type as any) ?? null,
        description: existing.description,
        amountExVat: resolved.values.amountExVat ?? existing.amountExVat,
        invoiceNumber: resolved.values.invoiceNumber ?? existing.invoiceNumber,
        invoiceDate: resolved.values.invoiceDate ?? existing.invoiceDate,
        invoiceDateFontColor: fileRow.invoiceDateFontColor ?? existing.invoiceDateFontColor,
        invoiceDateConfirmed: resolved.values.invoiceDateConfirmed ?? existing.invoiceDateConfirmed,
        approvedDate: resolved.values.approvedDate ?? existing.approvedDate,
        paidDate: resolved.values.paidDate ?? existing.paidDate,
        paidDateFontColor: fileRow.paidDateFontColor ?? existing.paidDateFontColor,
        paidDateConfirmed: resolved.values.paidDateConfirmed ?? existing.paidDateConfirmed,
        poNumber: resolved.values.poNumber ?? existing.poNumber,
        // Recalculate cosRealised from the resolved invoice number (canonical invoice-only rule).
        // QB precedence override: force cosRealised=true when QB shows Paid.
        cosRealised: qbForceCosRealised === true
          ? true
          : !!((resolved.values.invoiceNumber ?? existing.invoiceNumber) && String(resolved.values.invoiceNumber ?? existing.invoiceNumber).trim()),
        cashflowConfirmed: resolved.values.cashflowConfirmed ?? existing.cashflowConfirmed,
        status: normalizeCostLineStatus(resolved.values.status ?? existing.status),
        sourceSheet: existing.sourceSheet || fileRow.sourceSheet,
        sourceRow: existing.sourceRow || fileRow.sourceRow,
        importRunId: runId,
        turnaroundDays: fileRow.turnaroundDays,
        budgetQty: resolved.values.budgetQty ?? existing.budgetQty,
        budgetRate: resolved.values.budgetRate ?? existing.budgetRate,
        budgetTotal: resolved.values.budgetTotal ?? existing.budgetTotal,
        budgetCos: resolved.values.budgetCos ?? existing.budgetCos,
        revenueRecognitionAmount: resolved.values.revenueRecognitionAmount ?? existing.revenueRecognitionAmount,
        forecastPaymentDate: resolved.values.forecastPaymentDate ?? existing.forecastPaymentDate,
        subProjectName: existing.subProjectName,
        // PR2A tracker columns.
        actualQty: resolved.values.actualQty ?? existing.actualQty ?? null,
        actualRate: resolved.values.actualRate ?? existing.actualRate ?? null,
        comments: resolved.values.comments ?? existing.comments ?? null,
        checkFlag: resolved.values.checkFlag ?? existing.checkFlag ?? null,
        savingOverrun: resolved.values.savingOverrun ?? existing.savingOverrun ?? null,
        usdExchangeRate: resolved.values.usdExchangeRate ?? existing.usdExchangeRate ?? null,
        pricePerWatt: resolved.values.pricePerWatt ?? existing.pricePerWatt ?? null,
        // Carry forward app-owned fields.
        noRevenueLinked: resolved.values.noRevenueLinked ?? existing.noRevenueLinked,
        adminDateOverride: existing.adminDateOverride || null,
        adminDateOverrideReason: existing.adminDateOverrideReason || null,
        adminDateOverrideBy: existing.adminDateOverrideBy || null,
        adminDateOverrideAt: existing.adminDateOverrideAt || null,
        cosStatusOverride: existing.cosStatusOverride || null,
        cosStatusOverrideReason: existing.cosStatusOverrideReason || null,
        cosStatusOverrideBy: existing.cosStatusOverrideBy || null,
        cosStatusOverrideAt: existing.cosStatusOverrideAt || null,
        effectiveFrom: commitTimestamp,
        effectiveTo: null,
        snapshotRunId: runId,
        // PR2C — stable identity + 3-way-merge bookkeeping.
        rowHash,
        importSnapshot: resolved.snapshot,
        manualOverrides: insertManualOverrides,
      }).returning();
      insertedIds.push(inserted.id);
      updatedIds.push(existingId);
      counts.updated++;
      if (qbVariancesForRow.length > 0) {
        qbCostVariancePending.push({ appEntityId: inserted.id, variances: qbVariancesForRow });
      }
      // Re-point any active QB link from the soft-closed predecessor to
      // the new inserted row id so the gate keeps firing on the next
      // import. Without this, the link stays pinned to the dead row and
      // applyQbPrecedence becomes a no-op forever after.
      if (qbLinkedRow) {
        try {
          await repointQbLinks({
            tx,
            appEntityType: "cost_line",
            oldAppEntityId: existingId,
            newAppEntityId: inserted.id,
          });
        } catch (err) {
          console.error("[commit-executor] Failed to re-point QB link for cost:", err);
        }
      }
    }
  }

  // PR2C — end-of-pass cleanup. Soft-close any active row in this project
  // whose row_hash is not in seenRowHashes.
  if (seenRowHashes.size > 0) {
    const activeRows = await tx
      .select({ id: normalizedCostLines.id, rowHash: normalizedCostLines.rowHash })
      .from(normalizedCostLines)
      .where(and(
        eq(normalizedCostLines.projectId, projectId),
        isNull(normalizedCostLines.effectiveTo),
      ));
    const stale: number[] = [];
    for (const r of activeRows as Array<{ id: number; rowHash: string | null }>) {
      if (!r.rowHash) continue;
      if (!seenRowHashes.has(r.rowHash)) stale.push(r.id);
    }
    if (stale.length > 0) {
      await tx.update(normalizedCostLines)
        .set({ effectiveTo: commitTimestamp })
        .where(inArray(normalizedCostLines.id, stale));
    }
  }

  // Flush QB variances. Failure to log MUST NOT fail the import.
  if (qbPrecedenceOn && qbCostVariancePending.length > 0) {
    try {
      for (const p of qbCostVariancePending) {
        await writeQbVariances({
          tx,
          importRunId: runId,
          projectId,
          appEntityType: "cost_line",
          appEntityId: p.appEntityId,
          variances: p.variances,
        });
      }
    } catch (err) {
      console.error("[commit-executor] Failed to log QB variances for cost:", err);
    }
  }

  return { canonicalSource: CANONICAL_SOURCES.EXPENDITURE, counts, insertedIds, updatedIds, warnings, mergeConflicts };
}

// ===========================================================================
// PR2C — auxiliary writers for the new capture tables.
//
// Each of these writers persists data that the normalizer extracts but that
// the three section writers above do NOT touch:
//   - 1:N actual-row batches against a parent cost line
//   - Project Plan rows 1–7 (baseline / forecasted completion + durations)
//   - Revenue Tracking rows 4–7 (Planned Revenue / Expenditure / Profit /
//     Margin × Costed / Actual)
//
// Idempotent: each writer compares the new payload against the current
// active row and skips the write when nothing material changed.
// ===========================================================================

import { hashActualRow } from "./row-hasher";

export interface AuxWriteContext {
  tx: any;
  projectId: number;
  runId: number;
  commitTimestamp: Date;
}

export interface ActualLineRowsContext extends AuxWriteContext {
  /**
   * Orphan actual rows extracted by the normalizer when the actual side
   * of the Expenditure Breakdown sheet has more rows than the costed
   * side (multiple invoice batches against one costed line).
   */
  actualLineRows: Array<{
    parentCategoryKey: string | null;
    parentSourceRow: number;
    actualNo: number;
    description: string | null;
    qty: string | null;
    rate: string | null;
    actualTotal: string | null;
    poNumber: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    revenueRecognitionAmount: string | null;
    financePaymentDate: string | null;
    comments: string | null;
    checkFlag: string | null;
    savingOverrun: string | null;
    cellFormat: Record<string, unknown> | null;
    sourceSheet: string;
    sourceRow: number;
  }>;
}

/**
 * Writes orphan actual-line rows to `normalized_cost_line_actuals`.
 *
 * Strategy:
 *   1. Look up each parent cost line by `(projectId, sourceRow=parentSourceRow)`
 *      among the currently active rows. Skip orphans whose parent can't be
 *      resolved (the normalizer should never emit those, but defensive).
 *   2. Compute a stable `row_hash` via `hashActualRow`.
 *   3. If an existing active actual row already has the same hash, soft-close
 *      it (`effective_to = commitTimestamp`) before inserting the new
 *      version. Otherwise insert as new.
 *   4. Capture an `import_snapshot` JSONB so the next merge pass can detect
 *      manual edits.
 *
 * Returns counts so the route can include them in the import result.
 */
export async function writeActualLineRows(
  ctx: ActualLineRowsContext,
): Promise<{ inserted: number; skipped: number; orphaned: number }> {
  const { tx, projectId, runId, commitTimestamp, actualLineRows } = ctx;
  if (!actualLineRows || actualLineRows.length === 0) {
    return { inserted: 0, skipped: 0, orphaned: 0 };
  }

  const { normalizedCostLines, normalizedCostLineActuals } = await import("@shared/schema");
  const { eq, and, isNull } = await import("drizzle-orm");

  let inserted = 0;
  let skipped = 0;
  let orphaned = 0;

  for (const row of actualLineRows) {
    // Resolve parent cost line by (project, sourceRow). Active rows only.
    const [parent] = await tx
      .select({ id: normalizedCostLines.id })
      .from(normalizedCostLines)
      .where(
        and(
          eq(normalizedCostLines.projectId, projectId),
          eq(normalizedCostLines.sourceRow, row.parentSourceRow),
          isNull(normalizedCostLines.effectiveTo),
        ),
      )
      .limit(1);

    if (!parent) {
      orphaned++;
      continue;
    }

    const rowHash = hashActualRow({
      costLineId: parent.id,
      actualNo: row.actualNo,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.invoiceDate,
    });

    // Soft-close any existing active row with the same hash.
    await tx
      .update(normalizedCostLineActuals)
      .set({ effectiveTo: commitTimestamp })
      .where(
        and(
          eq(normalizedCostLineActuals.costLineId, parent.id),
          eq(normalizedCostLineActuals.rowHash, rowHash),
          isNull(normalizedCostLineActuals.effectiveTo),
        ),
      );

    // Build the import_snapshot from the writeable fields so subsequent
    // imports can detect manual edits via the merge engine.
    const importSnapshot = {
      description: row.description,
      qty: row.qty,
      rate: row.rate,
      actualTotal: row.actualTotal,
      poNumber: row.poNumber,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.invoiceDate,
      revenueRecognitionAmount: row.revenueRecognitionAmount,
      financePaymentDate: row.financePaymentDate,
      comments: row.comments,
      checkFlag: row.checkFlag,
      savingOverrun: row.savingOverrun,
    };

    await tx.insert(normalizedCostLineActuals).values({
      costLineId: parent.id,
      projectId,
      actualNo: row.actualNo,
      description: row.description,
      qty: row.qty,
      rate: row.rate,
      actualTotal: row.actualTotal,
      poNumber: row.poNumber,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.invoiceDate,
      revenueRecognitionAmount: row.revenueRecognitionAmount,
      financePaymentDate: row.financePaymentDate,
      comments: row.comments,
      checkFlag: row.checkFlag,
      savingOverrun: row.savingOverrun,
      cellFormat: row.cellFormat,
      sourceSheet: row.sourceSheet,
      sourceRow: row.sourceRow,
      importRunId: runId,
      rowHash,
      importSnapshot,
      manualOverrides: null,
      effectiveFrom: commitTimestamp,
      effectiveTo: null,
      snapshotRunId: runId,
    });
    inserted++;
  }

  return { inserted, skipped, orphaned };
}

export interface ProjectMetadataContext extends AuxWriteContext {
  metadata: {
    baselineCompletionDate: string | null;
    forecastedCompletionDate: string | null;
    projectStartDate: string | null;
    durationMonthsFromSiteEstab: number | null;
    durationMonthsToCapacityTest: number | null;
    cellFormat: Record<string, unknown> | null;
  } | null;
  sourceSheet?: string | null;
}

/**
 * Writes the top-of-Project-Plan metadata block (baseline / forecasted
 * completion + duration metrics) to `tracker_project_metadata`.
 *
 * Idempotent: skips the write entirely when the new values match the
 * current active row exactly. Otherwise soft-closes the active row and
 * inserts a new one.
 */
export async function writeProjectMetadata(
  ctx: ProjectMetadataContext,
): Promise<{ written: boolean }> {
  const { tx, projectId, runId, commitTimestamp, metadata, sourceSheet } = ctx;
  if (!metadata) return { written: false };

  const { trackerProjectMetadata } = await import("@shared/schema");
  const { eq, and, isNull } = await import("drizzle-orm");

  // Compare against current active row. Skip if all five values match.
  const [current] = await tx
    .select()
    .from(trackerProjectMetadata)
    .where(
      and(
        eq(trackerProjectMetadata.projectId, projectId),
        isNull(trackerProjectMetadata.effectiveTo),
      ),
    )
    .limit(1);

  if (current) {
    const sameDates =
      String(current.baselineCompletionDate ?? "") === String(metadata.baselineCompletionDate ?? "")
      && String(current.forecastedCompletionDate ?? "") === String(metadata.forecastedCompletionDate ?? "")
      && String(current.projectStartDate ?? "") === String(metadata.projectStartDate ?? "");
    const sameDurations =
      String(current.durationMonthsFromSiteEstab ?? "") === String(metadata.durationMonthsFromSiteEstab ?? "")
      && String(current.durationMonthsToCapacityTest ?? "") === String(metadata.durationMonthsToCapacityTest ?? "");
    if (sameDates && sameDurations) {
      return { written: false };
    }

    await tx
      .update(trackerProjectMetadata)
      .set({ effectiveTo: commitTimestamp })
      .where(eq(trackerProjectMetadata.id, current.id));
  }

  await tx.insert(trackerProjectMetadata).values({
    projectId,
    importRunId: runId,
    baselineCompletionDate: metadata.baselineCompletionDate,
    forecastedCompletionDate: metadata.forecastedCompletionDate,
    projectStartDate: metadata.projectStartDate,
    durationMonthsFromSiteEstab: metadata.durationMonthsFromSiteEstab !== null
      ? String(metadata.durationMonthsFromSiteEstab)
      : null,
    durationMonthsToCapacityTest: metadata.durationMonthsToCapacityTest !== null
      ? String(metadata.durationMonthsToCapacityTest)
      : null,
    cellFormat: metadata.cellFormat,
    sourceSheet: sourceSheet ?? null,
    effectiveFrom: commitTimestamp,
    effectiveTo: null,
    snapshotRunId: runId,
  });
  return { written: true };
}

export interface RevenueSummaryContext extends AuxWriteContext {
  costedSummary: {
    plannedRevenue: number | null;
    plannedExpenditure: number | null;
    plannedProfit: number | null;
    plannedMargin: number | null;
    actualRevenue: number | null;
    actualExpenditure: number | null;
    actualProfit: number | null;
    actualMargin: number | null;
  } | null;
  costedSummarySource?: { sourceSheet: string; cellFormat: Record<string, unknown> | null } | null;
}

/**
 * Writes the top-of-Revenue-Tracking summary block (Planned Revenue /
 * Expenditure / Profit / Margin × Costed / Actual) to
 * `tracker_revenue_summary`.
 *
 * Same idempotency model as writeProjectMetadata.
 */
export async function writeRevenueSummary(
  ctx: RevenueSummaryContext,
): Promise<{ written: boolean }> {
  const { tx, projectId, runId, commitTimestamp, costedSummary, costedSummarySource } = ctx;
  if (!costedSummary) return { written: false };

  const { trackerRevenueSummary } = await import("@shared/schema");
  const { eq, and, isNull } = await import("drizzle-orm");

  const decFromNum = (v: number | null): string | null =>
    v === null || !isFinite(v) ? null : String(v);

  const next = {
    plannedRevenueCosted: decFromNum(costedSummary.plannedRevenue),
    plannedRevenueActual: decFromNum(costedSummary.actualRevenue),
    plannedExpenditureCosted: decFromNum(costedSummary.plannedExpenditure),
    plannedExpenditureActual: decFromNum(costedSummary.actualExpenditure),
    plannedProfitCosted: decFromNum(costedSummary.plannedProfit),
    plannedProfitActual: decFromNum(costedSummary.actualProfit),
    plannedMarginCosted: decFromNum(costedSummary.plannedMargin),
    plannedMarginActual: decFromNum(costedSummary.actualMargin),
  };

  const [current] = await tx
    .select()
    .from(trackerRevenueSummary)
    .where(
      and(
        eq(trackerRevenueSummary.projectId, projectId),
        isNull(trackerRevenueSummary.effectiveTo),
      ),
    )
    .limit(1);

  if (current) {
    const same = (Object.keys(next) as Array<keyof typeof next>).every(
      (k) => String(current[k] ?? "") === String(next[k] ?? ""),
    );
    if (same) return { written: false };

    await tx
      .update(trackerRevenueSummary)
      .set({ effectiveTo: commitTimestamp })
      .where(eq(trackerRevenueSummary.id, current.id));
  }

  await tx.insert(trackerRevenueSummary).values({
    projectId,
    importRunId: runId,
    ...next,
    cellFormat: costedSummarySource?.cellFormat ?? null,
    sourceSheet: costedSummarySource?.sourceSheet ?? null,
    effectiveFrom: commitTimestamp,
    effectiveTo: null,
    snapshotRunId: runId,
  });
  return { written: true };
}
