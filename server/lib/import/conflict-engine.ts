/**
 * Smart Import v2 — 3-Way Conflict Engine
 *
 * For every matched row on an incremental import, compares three values
 * per field:
 *   B = baseline (value at last committed import)
 *   C = current  (live canonical DB value, may have app edits)
 *   F = file     (newly uploaded value)
 *
 * Merge cases:
 *   A: B=C, C≠F  → upload changed, app did not → AUTO_ACCEPT_FILE
 *   B: B≠C, B=F  → app changed, upload did not → KEEP_APP
 *   C: B≠C, C≠F, F≠B → both diverged differently → CONFLICT
 *   D: F blank, B≠C   → upload blank, app edited → KEEP_APP (preserve app)
 *   E: B=C=F           → all same → UNCHANGED
 *   F: baseline import → no conflict logic → NEW
 *
 * Canonical sources (see docs/smart-import-v2-spine-alignment.md):
 *   PLAN:        work_items (source=SMART_IMPORT, workstream=PM)
 *   REVENUE:     normalized_revenue_lines (effectiveTo IS NULL)
 *   EXPENDITURE: normalized_cost_lines (effectiveTo IS NULL)
 *
 * Baseline source: summaryJson.normalization from the last COMMITTED import run.
 */

import type { NormalizationResult } from "./normalizer";
import type { SectionType } from "./row-matcher";
import {
  PLAN_COMPARE_FIELDS,
  REVENUE_COMPARE_FIELDS,
  EXPENDITURE_COMPARE_FIELDS,
  type MatchedRow,
  type BusinessKey,
} from "./row-matcher";
import { CANONICAL_SOURCES } from "./planner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MergeCase =
  | "UNCHANGED"         // B=C=F — all same
  | "AUTO_ACCEPT_FILE"  // B=C≠F — upload changed, app did not
  | "KEEP_APP"          // B≠C, B=F or F blank — app changed, upload didn't or is blank
  | "CONFLICT"          // B≠C, C≠F, B≠F — both diverged differently
  | "NEW_FIELD";        // field only in file (no baseline or current)

export interface FieldMerge {
  fieldName: string;
  baselineValue: string | null;
  currentAppValue: string | null;
  uploadedValue: string | null;
  mergeCase: MergeCase;
  /** True if the user must choose which value wins */
  requiresDecision: boolean;
}

export type RowConflictStatus =
  | "NO_CONFLICT"
  | "HAS_CONFLICTS"
  | "AUTO_RESOLVED";

export interface RowMergeResult {
  rowKey: string;
  displayLabel: string;
  section: SectionType;
  canonicalSource: string;
  existingRowId: number | null;
  fileIndex: number | null;
  conflictStatus: RowConflictStatus;
  fields: FieldMerge[];
}

export interface ConflictSummary {
  totalConflictRows: number;
  unresolvedConflictRows: number;
  autoResolvedRows: number;
  sections: {
    PLAN: SectionConflictSummary | null;
    REVENUE: SectionConflictSummary | null;
    EXPENDITURE: SectionConflictSummary | null;
  };
}

export interface SectionConflictSummary {
  canonicalSource: string;
  rows: RowMergeResult[];
  conflictRowCount: number;
  autoAcceptCount: number;
  keepAppCount: number;
  unchangedFieldCount: number;
}

export interface ConflictEngineResult {
  summary: ConflictSummary;
  /** True if there are unresolved conflicts that must block commit */
  hasBlockingConflicts: boolean;
  /** All row-level merge results, across all sections */
  allRows: RowMergeResult[];
}

// ---------------------------------------------------------------------------
// Value normalization (same logic as row-matcher)
// ---------------------------------------------------------------------------

function normVal(val: any): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "boolean") return val ? "true" : "";
  if (typeof val === "number") return val === 0 ? "" : String(val);
  const s = String(val).trim();
  return s === "0" ? "" : s;
}

function isBlank(val: any): boolean {
  return normVal(val) === "";
}

// ---------------------------------------------------------------------------
// Core 3-way field merge
// ---------------------------------------------------------------------------

/**
 * Classify a single field using the 3-way merge rule.
 */
export function classifyField(
  fieldName: string,
  baseline: any,
  current: any,
  uploaded: any,
): FieldMerge {
  const b = normVal(baseline);
  const c = normVal(current);
  const f = normVal(uploaded);

  // Case E: all three same → UNCHANGED
  if (b === c && c === f) {
    return { fieldName, baselineValue: b || null, currentAppValue: c || null, uploadedValue: f || null, mergeCase: "UNCHANGED", requiresDecision: false };
  }

  // Case A: upload changed, app did not (B=C, C≠F)
  if (b === c && c !== f) {
    return { fieldName, baselineValue: b || null, currentAppValue: c || null, uploadedValue: f || null, mergeCase: "AUTO_ACCEPT_FILE", requiresDecision: false };
  }

  // Case B: app changed, upload did not (B≠C, B=F)
  if (b !== c && b === f) {
    return { fieldName, baselineValue: b || null, currentAppValue: c || null, uploadedValue: f || null, mergeCase: "KEEP_APP", requiresDecision: false };
  }

  // Case D: upload is blank/null but app has an edited value
  if (isBlank(uploaded) && !isBlank(current) && b !== c) {
    return { fieldName, baselineValue: b || null, currentAppValue: c || null, uploadedValue: f || null, mergeCase: "KEEP_APP", requiresDecision: false };
  }

  // Both converged to same new value (B≠C, B≠F, C=F) — no conflict
  if (c === f) {
    return { fieldName, baselineValue: b || null, currentAppValue: c || null, uploadedValue: f || null, mergeCase: "UNCHANGED", requiresDecision: false };
  }

  // Case C: both diverged differently (B≠C, C≠F, B≠F)
  return { fieldName, baselineValue: b || null, currentAppValue: c || null, uploadedValue: f || null, mergeCase: "CONFLICT", requiresDecision: true };
}

// ---------------------------------------------------------------------------
// Row-level merge
// ---------------------------------------------------------------------------

function getCompareFields(section: SectionType): string[] {
  switch (section) {
    case "PLAN": return PLAN_COMPARE_FIELDS;
    case "REVENUE": return REVENUE_COMPARE_FIELDS;
    case "EXPENDITURE": return EXPENDITURE_COMPARE_FIELDS;
  }
}

/**
 * Run 3-way merge for a single matched row.
 *
 * @param section     - PLAN / REVENUE / EXPENDITURE
 * @param matchedRow  - from the row-matcher (has fileRow, existingRow, businessKey)
 * @param baselineRow - the row from the last committed import's summaryJson (null if first import)
 */
export function mergeRow(
  section: SectionType,
  matchedRow: MatchedRow,
  baselineRow: Record<string, any> | null,
): RowMergeResult {
  const fields: FieldMerge[] = [];
  const compareFields = getCompareFields(section);

  const fileRow = matchedRow.fileRow || {};
  const currentRow = matchedRow.existingRow || {};

  for (const field of compareFields) {
    const baseline = baselineRow ? baselineRow[field] : undefined;
    const current = currentRow[field];
    const uploaded = fileRow[field];

    const fm = classifyField(field, baseline, current, uploaded);
    fields.push(fm);
  }

  const hasConflicts = fields.some(f => f.requiresDecision);
  const hasAutoResolved = fields.some(f => f.mergeCase === "AUTO_ACCEPT_FILE" || f.mergeCase === "KEEP_APP");

  let conflictStatus: RowConflictStatus;
  if (hasConflicts) {
    conflictStatus = "HAS_CONFLICTS";
  } else if (hasAutoResolved) {
    conflictStatus = "AUTO_RESOLVED";
  } else {
    conflictStatus = "NO_CONFLICT";
  }

  const canonicalSource = CANONICAL_SOURCES[section];

  return {
    // rowKey must be unique-within-section so the mergeResults map and the
    // commit executor's decision lookup can address each row independently,
    // even inside a duplicate-business-key group. Prefer the matcher's
    // rowUid; fall back to the business key for legacy test fixtures that
    // construct MatchedRow literals without rowUid.
    rowKey: matchedRow.rowUid ?? matchedRow.businessKey.key,
    displayLabel: matchedRow.businessKey.rowLabel,
    section,
    canonicalSource,
    existingRowId: matchedRow.existingRowId,
    fileIndex: matchedRow.fileIndex,
    conflictStatus,
    fields,
  };
}

// ---------------------------------------------------------------------------
// Baseline row lookup
// ---------------------------------------------------------------------------

/**
 * Build a lookup map from the last committed import's normalization data,
 * keyed by business key, so we can find the baseline value for any matched row.
 */
export function buildBaselineLookup(
  section: SectionType,
  projectId: number,
  baselineNormalization: NormalizationResult | null,
  generateBusinessKey: (section: SectionType, projectId: number, row: Record<string, any>) => BusinessKey,
): Map<string, Record<string, any>> {
  if (!baselineNormalization) return new Map();

  let rows: Record<string, any>[];
  switch (section) {
    case "PLAN": rows = baselineNormalization.planTasks; break;
    case "REVENUE": rows = baselineNormalization.revenueLines; break;
    case "EXPENDITURE": rows = baselineNormalization.costLines; break;
  }

  const map = new Map<string, Record<string, any>>();
  for (const row of rows) {
    const bk = generateBusinessKey(section, projectId, row);
    map.set(bk.key, row);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Section-level merge
// ---------------------------------------------------------------------------

export function mergeSection(
  section: SectionType,
  matchedRows: MatchedRow[],
  baselineLookup: Map<string, Record<string, any>>,
): SectionConflictSummary {
  const rows: RowMergeResult[] = [];
  let conflictRowCount = 0;
  let autoAcceptCount = 0;
  let keepAppCount = 0;
  let unchangedFieldCount = 0;

  for (const mr of matchedRows) {
    // Only run merge for rows that exist in both file and DB
    if (mr.classification === "NEW" || mr.classification === "MISSING_FROM_UPLOAD") {
      continue;
    }

    // Baseline lookup is keyed by raw business key. For duplicate-key
    // groups the map inevitably collapses to one baseline per group — the
    // last row with that key from the previous committed import. This is
    // a known limitation: 3-way merge precision degrades inside
    // duplicate-key groups, but identity itself (the commit writes) is
    // still correct because the executor consumes `rowUid`, not the
    // baseline key. A future enhancement could store per-rowUid baselines
    // in the snapshot.
    const baselineRow = baselineLookup.get(mr.businessKey.key) || null;
    const result = mergeRow(section, mr, baselineRow);
    rows.push(result);

    if (result.conflictStatus === "HAS_CONFLICTS") conflictRowCount++;
    for (const f of result.fields) {
      if (f.mergeCase === "AUTO_ACCEPT_FILE") autoAcceptCount++;
      if (f.mergeCase === "KEEP_APP") keepAppCount++;
      if (f.mergeCase === "UNCHANGED") unchangedFieldCount++;
    }
  }

  return {
    canonicalSource: CANONICAL_SOURCES[section],
    rows,
    conflictRowCount,
    autoAcceptCount,
    keepAppCount,
    unchangedFieldCount,
  };
}

// ---------------------------------------------------------------------------
// Full conflict engine entry point
// ---------------------------------------------------------------------------

/**
 * Run the 3-way conflict engine across all sections.
 *
 * @param matchedRowsBySection - output from the row matcher, keyed by section
 * @param baselineNormalization - normalization data from the last COMMITTED import's summaryJson
 * @param projectId - the target project ID
 * @param generateBusinessKey - the key generation function from row-matcher
 */
export function runConflictEngine(
  matchedRowsBySection: Record<SectionType, MatchedRow[]>,
  baselineNormalization: NormalizationResult | null,
  projectId: number,
  generateBusinessKey: (section: SectionType, projectId: number, row: Record<string, any>) => BusinessKey,
): ConflictEngineResult {
  const allRows: RowMergeResult[] = [];
  const sectionSummaries: Record<string, SectionConflictSummary | null> = {
    PLAN: null,
    REVENUE: null,
    EXPENDITURE: null,
  };

  for (const section of ["PLAN", "REVENUE", "EXPENDITURE"] as SectionType[]) {
    const matched = matchedRowsBySection[section];
    if (!matched || matched.length === 0) continue;

    const baselineLookup = buildBaselineLookup(section, projectId, baselineNormalization, generateBusinessKey);
    const sectionResult = mergeSection(section, matched, baselineLookup);
    sectionSummaries[section] = sectionResult;
    allRows.push(...sectionResult.rows);
  }

  const totalConflictRows = allRows.filter(r => r.conflictStatus === "HAS_CONFLICTS").length;
  const autoResolvedRows = allRows.filter(r => r.conflictStatus === "AUTO_RESOLVED").length;

  return {
    summary: {
      totalConflictRows,
      unresolvedConflictRows: totalConflictRows, // until user resolves
      autoResolvedRows,
      sections: {
        PLAN: sectionSummaries.PLAN,
        REVENUE: sectionSummaries.REVENUE,
        EXPENDITURE: sectionSummaries.EXPENDITURE,
      },
    },
    hasBlockingConflicts: totalConflictRows > 0,
    allRows,
  };
}
