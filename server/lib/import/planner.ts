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
import { detectImportMode, loadCurrentPlanRows, loadCurrentRevenueRows, loadCurrentCostRows, loadBaselineForPlanner } from "./baseline";
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
  /** Global planner warnings */
  warnings: string[];
  /** When the plan was generated */
  generatedAt: string;
}

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

  // INCREMENTAL — load current state, baseline snapshot, and run matching + conflicts
  const [planRows, revenueRows, costRows, baselineNormalization] = await Promise.all([
    loadCurrentPlanRows(projectId),
    loadCurrentRevenueRows(projectId),
    loadCurrentCostRows(projectId),
    loadBaselineForPlanner(projectId),
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

  return {
    importMode: "INCREMENTAL",
    lastCommittedRunId: baselineInfo.lastCommittedRunId,
    sections: {
      PLAN: planSection,
      REVENUE: revenueSection,
      EXPENDITURE: expenditureSection,
    },
    conflicts,
    warnings,
    generatedAt: new Date().toISOString(),
  };
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
