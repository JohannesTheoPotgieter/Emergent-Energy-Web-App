/**
 * Smart Import v2 — Import Planner
 *
 * Produces a structured diff plan for an import run BEFORE commit.
 * Classifies every row as NEW / CHANGED / UNCHANGED / MISSING_FROM_UPLOAD.
 *
 * This module is the single entry point consumed by the API layer.
 * It delegates to:
 *   - baseline.ts  — for import mode detection and current state loading
 *   - row-matcher.ts — for business key generation and row matching
 */

import type { NormalizationResult } from "./normalizer";
import {
  detectImportMode,
  loadCurrentPlanRows,
  loadCurrentRevenueRows,
  loadCurrentCostRows,
  loadBaselineForPlanner,
  loadDeletedPlanRows,
  loadDeletedRevenueRows,
  loadDeletedCostRows,
  type DeletedRowSummary,
} from "./baseline";
import type { ImportMode } from "./baseline";
import { runConflictEngine, type ConflictEngineResult, type ConflictSummary } from "./conflict-engine";

// ---------------------------------------------------------------------------
// Canonical source declarations — the authoritative table for each section.
// See docs/smart-import-v2-spine-alignment.md for full evidence.
// ---------------------------------------------------------------------------

/**
 * PLAN:        work_items (source=SMART_IMPORT, workstream=PM)
 *              — normalizedPlanTasks is a dead table (never written, never read).
 * REVENUE:     normalized_revenue_lines (effectiveTo IS NULL)
 *              — canonical source for all revenue/inflow KPIs and dashboards.
 * EXPENDITURE: normalized_cost_lines (effectiveTo IS NULL)
 *              — canonical source for all cost/COS KPIs and dashboards.
 */
export const CANONICAL_SOURCES = {
  PLAN: "work_items",
  REVENUE: "normalized_revenue_lines",
  EXPENDITURE: "normalized_cost_lines",
} as const;
import {
  matchRows,
  generateBusinessKey,
  type SectionType,
  type MatchedRow,
  type MatchConfidence,
  type RowClassification,
  type ChangedField,
  type BusinessKey,
} from "./row-matcher";

// ---------------------------------------------------------------------------
// Public types — the planner's output shape
// ---------------------------------------------------------------------------

export interface SectionPlan {
  /** The canonical DB table used as comparison source for this section */
  canonicalSource: string;
  /** Number of rows classified as NEW */
  newCount: number;
  /** Number of rows classified as CHANGED */
  changedCount: number;
  /** Number of rows classified as UNCHANGED */
  unchangedCount: number;
  /** Number of rows in DB but not in the uploaded file */
  missingFromUploadCount: number;
  /** Number of rows with conflict placeholder (future: 3-way merge) */
  conflictPlaceholderCount: number;
  /** Detailed row-level plan (capped at a reasonable size for API response) */
  rows: PlannedRow[];
  /** Total row count in the uploaded file for this section */
  fileRowCount: number;
  /** Total active row count in the DB for this section */
  existingRowCount: number;
}

export interface PlannedRow {
  classification: RowClassification;
  businessKey: string;
  /**
   * Unique-within-section row identifier surfaced to clients for conflict
   * resolution keying. For singletons equals `businessKey`; for members of
   * a duplicate-key group it is suffixed (`#pk<id>` / `#new-<idx>`).
   */
  rowUid: string;
  keyType: "PRIMARY" | "FALLBACK";
  matchConfidence: MatchConfidence;
  rowLabel: string;
  fileIndex: number | null;
  existingRowId: number | null;
  changedFields: ChangedField[];
  warnings: string[];
  /** True when this row belongs to a duplicate-business-key group. */
  inDuplicateGroup: boolean;
}

export interface PlannerResult {
  /** BASELINE (first import) or INCREMENTAL (subsequent) */
  importMode: ImportMode;
  /** ID of the last committed import for this project (null if BASELINE) */
  lastCommittedRunId: number | null;
  /** Per-section planning results */
  sections: {
    PLAN: SectionPlan | null;
    REVENUE: SectionPlan | null;
    EXPENDITURE: SectionPlan | null;
  };
  /** 3-way conflict detection results (null for BASELINE imports) */
  conflicts: ConflictEngineResult | null;
  /**
   * File rows whose business key matches a previously-soft-deleted DB row.
   * The operator deleted the row in the app, then the same row reappeared
   * in the re-imported workbook. The commit endpoint refuses to commit
   * until each candidate has a decision: `keep_deleted` (skip the file
   * row, row stays deleted) or `restore_and_apply` (un-delete the row and
   * apply the file's values). Empty array means no clashes.
   */
  resurrections: ResurrectionCandidate[];
  /** Global planner warnings */
  warnings: string[];
  /** When the plan was generated */
  generatedAt: string;
}

export interface ResurrectionCandidate {
  /** Stable key used to match the decision in the commit payload. */
  resurrectionKey: string;
  section: SectionType;
  /** Human-readable row label for the UI ("Inverter PO #INV-001 — R 17,500"). */
  rowLabel: string;
  /** Business key derived from the file row. */
  businessKey: string;
  /** Existing soft-deleted row's primary id. */
  deletedRowId: number;
  /** Whichever delete signal fired — deletedAt (work_items) or effectiveTo (lines). */
  deletedAt: string | null;
  /** Index into the file's section array (so the executor can find the file values). */
  fileIndex: number;
  /** Compact preview of the file values for operator review. */
  filePreview: Record<string, string | number | null>;
  /** Compact preview of the soft-deleted row values for comparison. */
  deletedPreview: Record<string, string | number | null>;
}

export type ResurrectionDecision = "keep_deleted" | "restore_and_apply";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildSectionPlan(
  canonicalSource: string,
  matchedRows: MatchedRow[],
  fileRowCount: number,
  existingRowCount: number,
): SectionPlan {
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;
  let missingFromUploadCount = 0;
  let conflictPlaceholderCount = 0;

  const rows: PlannedRow[] = [];

  for (const mr of matchedRows) {
    switch (mr.classification) {
      case "NEW": newCount++; break;
      case "CHANGED": changedCount++; break;
      case "UNCHANGED": unchangedCount++; break;
      case "MISSING_FROM_UPLOAD": missingFromUploadCount++; break;
      case "CONFLICT_PLACEHOLDER": conflictPlaceholderCount++; break;
    }

    rows.push({
      classification: mr.classification,
      businessKey: mr.businessKey.key,
      rowUid: mr.rowUid ?? mr.businessKey.key,
      keyType: mr.businessKey.keyType,
      matchConfidence: mr.businessKey.matchConfidence,
      rowLabel: mr.businessKey.rowLabel,
      fileIndex: mr.fileIndex,
      existingRowId: mr.existingRowId,
      changedFields: mr.changedFields,
      warnings: mr.warnings,
      inDuplicateGroup: mr.inDuplicateGroup ?? false,
    });
  }

  return {
    canonicalSource,
    newCount,
    changedCount,
    unchangedCount,
    missingFromUploadCount,
    conflictPlaceholderCount,
    rows,
    fileRowCount,
    existingRowCount,
  };
}

// ---------------------------------------------------------------------------
// Main planner entry point
// ---------------------------------------------------------------------------

/**
 * Run the import planner for a given project and normalization result.
 *
 * @param projectId - The target project ID. If null, planning cannot proceed.
 * @param normalization - The normalized data from the uploaded file.
 * @returns PlannerResult with per-section classification of every row.
 */
export async function runImportPlanner(
  projectId: number | null,
  normalization: NormalizationResult,
): Promise<PlannerResult> {
  const warnings: string[] = [];

  // If no projectId, we can't compare against existing data.
  // Treat everything as BASELINE.
  if (!projectId) {
    warnings.push("No projectId assigned yet. All rows classified as NEW (baseline assumed).");
    return buildBaselinePlan(normalization, warnings);
  }

  // Detect import mode
  const baselineInfo = await detectImportMode(projectId);

  if (baselineInfo.importMode === "BASELINE") {
    return buildBaselinePlan(normalization, warnings, baselineInfo.lastCommittedRunId);
  }

  // INCREMENTAL — load current state, baseline snapshot, soft-deleted rows
  // (for resurrection detection) and run matching + conflicts.
  const [
    planRows,
    revenueRows,
    costRows,
    baselineNormalization,
    deletedPlanRows,
    deletedRevenueRows,
    deletedCostRows,
  ] = await Promise.all([
    loadCurrentPlanRows(projectId),
    loadCurrentRevenueRows(projectId),
    loadCurrentCostRows(projectId),
    loadBaselineForPlanner(projectId),
    loadDeletedPlanRows(projectId),
    loadDeletedRevenueRows(projectId),
    loadDeletedCostRows(projectId),
  ]);

  if (!baselineNormalization) {
    warnings.push("No baseline normalization found from last committed import. 3-way merge will treat current DB state as baseline.");
  }

  // Run row matching per section and collect matched rows for conflict engine
  let planSection: SectionPlan | null = null;
  let revenueSection: SectionPlan | null = null;
  let expenditureSection: SectionPlan | null = null;
  const matchedRowsBySection: Record<SectionType, MatchedRow[]> = { PLAN: [], REVENUE: [], EXPENDITURE: [] };

  if (normalization.planTasks.length > 0 || planRows.length > 0) {
    const matched = matchRows("PLAN", projectId, normalization.planTasks, planRows as any);
    matchedRowsBySection.PLAN = matched;
    planSection = buildSectionPlan(CANONICAL_SOURCES.PLAN, matched, normalization.planTasks.length, planRows.length);
    collectWarnings(matched, "PLAN", warnings);
  }

  // SAFETY GUARD — section presence: gate matcher on file-side row count.
  // Prior failure mode: an upload that omitted the Cashflow / Finance-Revenue
  // sheet would mass-classify existing active rows as MISSING_FROM_UPLOAD
  // and wipe them. Trade-off: an upload whose section is present but
  // intentionally empty leaves existing rows in place rather than clearing
  // them. In the C&I solar tracker workflow this case effectively does not
  // occur (projects always have ≥1 milestone / cost line), and the
  // wipe-on-missing-sheet failure is far more damaging. Operators clear a
  // section explicitly via the UI's soft-delete path.
  if (normalization.revenueLines.length > 0) {
    const matched = matchRows("REVENUE", projectId, normalization.revenueLines, revenueRows as any);
    matchedRowsBySection.REVENUE = matched;
    revenueSection = buildSectionPlan(CANONICAL_SOURCES.REVENUE, matched, normalization.revenueLines.length, revenueRows.length);
    collectWarnings(matched, "REVENUE", warnings);
  }

  if (normalization.costLines.length > 0) {
    const matched = matchRows("EXPENDITURE", projectId, normalization.costLines, costRows as any);
    matchedRowsBySection.EXPENDITURE = matched;
    expenditureSection = buildSectionPlan(CANONICAL_SOURCES.EXPENDITURE, matched, normalization.costLines.length, costRows.length);
    collectWarnings(matched, "EXPENDITURE", warnings);
  }

  // Run 3-way conflict engine
  const conflicts = runConflictEngine(
    matchedRowsBySection,
    baselineNormalization,
    projectId,
    generateBusinessKey,
  );

  // Resurrection detection — any NEW file rows whose business key collides
  // with a row the operator previously soft-deleted in the app surface here
  // so the commit endpoint can force an explicit operator decision instead
  // of silently re-inserting a duplicate. See PlannerResult.resurrections.
  const resurrections = detectResurrections(
    projectId,
    matchedRowsBySection,
    {
      PLAN: deletedPlanRows,
      REVENUE: deletedRevenueRows,
      EXPENDITURE: deletedCostRows,
    },
    {
      PLAN: normalization.planTasks,
      REVENUE: normalization.revenueLines,
      EXPENDITURE: normalization.costLines,
    },
  );

  return {
    importMode: "INCREMENTAL",
    lastCommittedRunId: baselineInfo.lastCommittedRunId,
    sections: {
      PLAN: planSection,
      REVENUE: revenueSection,
      EXPENDITURE: expenditureSection,
    },
    conflicts,
    resurrections,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Resurrection detector
// ---------------------------------------------------------------------------
//
// The active baseline excludes soft-deleted rows, so the row-matcher would
// classify a file row whose business key matches a deleted row as NEW. That
// silently re-inserts a duplicate. The operator's explicit "delete this row
// in the app" intent gets clobbered by the next file upload.
//
// This pass walks the NEW classifications, generates the business key from
// the file row, and looks up deleted rows by the same key. Each hit
// produces a ResurrectionCandidate that the commit endpoint requires the
// operator to resolve before the run can be committed.

export function detectResurrections(
  projectId: number,
  matched: Record<SectionType, MatchedRow[]>,
  deletedBySection: Record<SectionType, DeletedRowSummary[]>,
  fileBySection: Record<SectionType, any[]>,
): ResurrectionCandidate[] {
  const out: ResurrectionCandidate[] = [];

  for (const section of ["PLAN", "REVENUE", "EXPENDITURE"] as const) {
    const deleted = deletedBySection[section];
    if (!deleted || deleted.length === 0) continue;

    // Map every soft-deleted row to its business key so the lookup is O(N+M).
    const deletedByKey = new Map<string, DeletedRowSummary>();
    for (const d of deleted) {
      const bk = generateBusinessKey(section, projectId, d.row as any);
      // First-write-wins; the loader already orders newest-first for PLAN.
      if (!deletedByKey.has(bk.key)) {
        deletedByKey.set(bk.key, d);
      }
    }

    const fileRows = fileBySection[section] ?? [];
    for (const mr of matched[section]) {
      if (mr.classification !== "NEW") continue;
      const hit = deletedByKey.get(mr.businessKey.key);
      if (!hit) continue;
      const fileRow = mr.fileIndex != null ? fileRows[mr.fileIndex] : null;
      if (!fileRow) continue;

      out.push({
        resurrectionKey: `${section}::${mr.businessKey.key}`,
        section,
        rowLabel: mr.businessKey.rowLabel || `${section} row`,
        businessKey: mr.businessKey.key,
        deletedRowId: hit.id,
        deletedAt:
          hit.deletedAt?.toISOString() ??
          hit.effectiveTo?.toISOString() ??
          null,
        fileIndex: mr.fileIndex ?? -1,
        filePreview: previewForSection(section, fileRow),
        deletedPreview: previewForSection(section, hit.row),
      });
    }
  }

  return out;
}

const PREVIEW_FIELDS: Record<SectionType, string[]> = {
  PLAN: ["taskName", "taskNo", "startDate", "endDate", "actualStartDate", "actualEndDate", "owner", "status"],
  REVENUE: ["milestoneName", "amountExVat", "invoiceNumber", "invoiceDate", "expectedPaymentDate", "status"],
  EXPENDITURE: ["costCategory", "description", "counterpartyName", "amountExVat", "invoiceNumber", "invoiceDate", "status"],
};

function previewForSection(section: SectionType, row: any): Record<string, string | number | null> {
  const fields = PREVIEW_FIELDS[section];
  const out: Record<string, string | number | null> = {};
  for (const f of fields) {
    const v = row?.[f];
    if (v == null || v === "") {
      out[f] = null;
    } else if (typeof v === "number") {
      out[f] = v;
    } else if (typeof v === "string") {
      out[f] = v.length > 80 ? `${v.slice(0, 77)}…` : v;
    } else {
      out[f] = String(v);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Baseline plan builder — all rows are NEW
// ---------------------------------------------------------------------------

function buildBaselinePlan(
  normalization: NormalizationResult,
  warnings: string[],
  lastCommittedRunId: number | null = null,
): PlannerResult {
  function baselineSectionPlan(canonicalSource: string, rows: Record<string, any>[]): SectionPlan | null {
    if (rows.length === 0) return null;
    return {
      canonicalSource,
      newCount: rows.length,
      changedCount: 0,
      unchangedCount: 0,
      missingFromUploadCount: 0,
      conflictPlaceholderCount: 0,
      rows: rows.map((r, i) => ({
        classification: "NEW" as const,
        businessKey: "",
        rowUid: `baseline#${i}`,
        keyType: "PRIMARY" as const,
        matchConfidence: "HIGH" as const,
        rowLabel: (r as any).taskName || (r as any).milestoneName || (r as any).description || `Row ${i + 1}`,
        fileIndex: i,
        existingRowId: null,
        changedFields: [],
        warnings: [],
        inDuplicateGroup: false,
      })),
      fileRowCount: rows.length,
      existingRowCount: 0,
    };
  }

  return {
    importMode: "BASELINE",
    lastCommittedRunId,
    sections: {
      PLAN: baselineSectionPlan(CANONICAL_SOURCES.PLAN, normalization.planTasks),
      REVENUE: baselineSectionPlan(CANONICAL_SOURCES.REVENUE, normalization.revenueLines),
      EXPENDITURE: baselineSectionPlan(CANONICAL_SOURCES.EXPENDITURE, normalization.costLines),
    },
    conflicts: null, // No conflicts on baseline import
    resurrections: [], // No prior deletes are possible on a baseline import
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Warning collector
// ---------------------------------------------------------------------------

function collectWarnings(matchedRows: MatchedRow[], section: SectionType, warnings: string[]): void {
  let lowConfidenceCount = 0;
  for (const mr of matchedRows) {
    if (mr.businessKey.matchConfidence === "LOW" && mr.classification !== "MISSING_FROM_UPLOAD") {
      lowConfidenceCount++;
    }
    // Collect per-row warnings into global list (capped)
    for (const w of mr.warnings) {
      if (warnings.length < 50) {
        warnings.push(`[${section}] ${w}`);
      }
    }
  }
  if (lowConfidenceCount > 0) {
    warnings.push(`[${section}] ${lowConfidenceCount} row(s) matched with LOW confidence. Review identity keys.`);
  }
}

// Re-export types for convenience
export type { ImportMode } from "./baseline";
export type { RowClassification, MatchConfidence, ChangedField } from "./row-matcher";
export type { ConflictEngineResult, ConflictSummary, RowMergeResult, FieldMerge, MergeCase, RowConflictStatus, SectionConflictSummary } from "./conflict-engine";
