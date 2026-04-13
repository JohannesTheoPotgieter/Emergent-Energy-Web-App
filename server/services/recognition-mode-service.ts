/**
 * Recognition Mode Service (S14)
 *
 * Determines whether a project is ready for category-based revenue recognition.
 *
 * Recognition modes:
 *   CATEGORY_READY        — All categories have trusted J_cat (DIRECT,
 *                           HEADER_ERROR_POSITIONAL, or MANUAL) with non-null
 *                           revenue_allocation. Revenue release formula can
 *                           use (Q/X_cat)*J_cat.
 *   LEGACY_PRE_REIMPORT   — No trusted category allocations exist. Project has
 *                           not been re-imported with the updated parser.
 *                           Revenue release is UNAVAILABLE (not degraded).
 *   REIMPORT_FAILED       — Project was re-imported but J_cat extraction FAILED
 *                           (missing "Total Revenue" column entirely). Same effect
 *                           as LEGACY_PRE_REIMPORT — recognition unavailable.
 *
 * Trust classification:
 *   DIRECT                    — Synonym-matched "Total Revenue" column. Fully trusted.
 *   HEADER_ERROR_POSITIONAL   — Column found via positional detection when header was
 *                               broken (e.g. "ERROR on REV"). Trusted for formula use
 *                               because the values were successfully extracted and
 *                               reconciled. A JCAT_POSITIONAL_FALLBACK WARNING is
 *                               generated but this does NOT make the mode REIMPORT_FAILED.
 *   MANUAL                    — Operator-entered J_cat value. Fully trusted.
 *   PROVISIONAL               — Backfill placeholder with revenue_allocation=NULL.
 *                               NOT trusted. Does not count toward CATEGORY_READY.
 *
 * Issue classification:
 *   JCAT_COLUMN_MISSING           — FAILURE: column not found at all. → REIMPORT_FAILED.
 *   JCAT_POSITIONAL_FALLBACK      — WARNING: extraction succeeded via fallback. Does NOT
 *                                   trigger REIMPORT_FAILED. The allocation confidence
 *                                   (HEADER_ERROR_POSITIONAL) is the authoritative signal.
 *   JCAT_RECONCILIATION_VARIANCE  — WARNING: sum check failed. Does NOT trigger
 *                                   REIMPORT_FAILED. Data quality concern only.
 */

import { db } from "../db";
import {
  categoryRevenueAllocations,
  smartImportRuns,
  importIssues,
} from "@shared/schema";
import { eq, and, isNull, desc } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecognitionMode = "CATEGORY_READY" | "LEGACY_PRE_REIMPORT" | "REIMPORT_FAILED";

export interface RecognitionModeResult {
  mode: RecognitionMode;
  /** Number of active category allocations with trusted confidence */
  trustedCategoryCount: number;
  /** Number of active category allocations total (including PROVISIONAL) */
  totalCategoryCount: number;
  /** Category keys that lack trusted revenue_allocation (for diagnostics) */
  incompleteCategoryKeys: string[];
  /** Whether the latest import run had a J_cat extraction FAILURE (not just a warning) */
  latestImportHadJcatFailure: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Allocation confidence values that are trusted for category-level recognition.
 * PROVISIONAL is explicitly excluded — it is a diagnostic placeholder only.
 */
const TRUSTED_CONFIDENCES = new Set(["DIRECT", "HEADER_ERROR_POSITIONAL", "MANUAL"]);

/**
 * Issue types that indicate J_cat extraction FAILED (column not found).
 * JCAT_POSITIONAL_FALLBACK and JCAT_RECONCILIATION_VARIANCE are warnings,
 * not failures — extraction succeeded but with reduced confidence.
 */
const JCAT_FAILURE_ISSUE_TYPES = new Set(["JCAT_COLUMN_MISSING"]);

// ---------------------------------------------------------------------------
// Core query
// ---------------------------------------------------------------------------

/**
 * Determine the recognition mode for a project.
 *
 * Decision tree:
 * 1. Fetch active category_revenue_allocations.
 * 2. If zero rows exist:
 *    a. Check latest committed import for JCAT failure issues.
 *    b. If failure found → REIMPORT_FAILED.
 *    c. Otherwise → LEGACY_PRE_REIMPORT.
 * 3. If rows exist:
 *    a. Count how many have trusted confidence AND non-null revenue_allocation.
 *    b. If all do → CATEGORY_READY.
 *    c. Otherwise → check latest import for JCAT failure issues → REIMPORT_FAILED or LEGACY_PRE_REIMPORT.
 */
export async function getRecognitionMode(projectId: number): Promise<RecognitionModeResult> {
  // Fetch all active category allocations for this project
  const activeAllocations = await db
    .select({
      id: categoryRevenueAllocations.id,
      categoryKey: categoryRevenueAllocations.categoryKey,
      revenueAllocation: categoryRevenueAllocations.revenueAllocation,
      allocationConfidence: categoryRevenueAllocations.allocationConfidence,
    })
    .from(categoryRevenueAllocations)
    .where(and(
      eq(categoryRevenueAllocations.projectId, projectId),
      isNull(categoryRevenueAllocations.effectiveTo),
    ));

  const totalCategoryCount = activeAllocations.length;

  // No allocations at all → project has never been re-imported with the new parser
  if (totalCategoryCount === 0) {
    const hasJcatFailure = await checkLatestImportForJcatFailure(projectId);
    return {
      mode: hasJcatFailure ? "REIMPORT_FAILED" : "LEGACY_PRE_REIMPORT",
      trustedCategoryCount: 0,
      totalCategoryCount: 0,
      incompleteCategoryKeys: [],
      latestImportHadJcatFailure: hasJcatFailure,
    };
  }

  // Count trusted allocations: confidence is in TRUSTED_CONFIDENCES AND revenue_allocation is non-null.
  const trustedAllocations = activeAllocations.filter(
    (a: typeof activeAllocations[number]) => TRUSTED_CONFIDENCES.has(a.allocationConfidence) && a.revenueAllocation != null,
  );
  const trustedCategoryCount = trustedAllocations.length;

  const incompleteCategoryKeys = activeAllocations
    .filter((a: typeof activeAllocations[number]) => !TRUSTED_CONFIDENCES.has(a.allocationConfidence) || a.revenueAllocation == null)
    .map((a: typeof activeAllocations[number]) => a.categoryKey);

  // All categories have trusted J_cat → ready for category-level recognition.
  // Note: latestImportHadJcatFailure is false here by definition — if the import
  // had a column-missing failure, no DIRECT/HEADER_ERROR_POSITIONAL allocations
  // would exist for those categories.
  if (trustedCategoryCount === totalCategoryCount) {
    return {
      mode: "CATEGORY_READY",
      trustedCategoryCount,
      totalCategoryCount,
      incompleteCategoryKeys: [],
      latestImportHadJcatFailure: false,
    };
  }

  // Some categories are incomplete — check if this is due to an extraction failure
  const hasJcatFailure = await checkLatestImportForJcatFailure(projectId);
  return {
    mode: hasJcatFailure ? "REIMPORT_FAILED" : "LEGACY_PRE_REIMPORT",
    trustedCategoryCount,
    totalCategoryCount,
    incompleteCategoryKeys,
    latestImportHadJcatFailure: hasJcatFailure,
  };
}

/**
 * Check whether the latest committed import run for this project had a
 * J_cat extraction FAILURE (specifically JCAT_COLUMN_MISSING).
 *
 * JCAT_POSITIONAL_FALLBACK and JCAT_RECONCILIATION_VARIANCE are warnings,
 * not failures. A positional fallback that successfully extracts values
 * produces HEADER_ERROR_POSITIONAL allocations, which are trusted.
 */
async function checkLatestImportForJcatFailure(projectId: number): Promise<boolean> {
  // Find the latest committed run for this project
  const [latestRun] = await db
    .select({ id: smartImportRuns.id })
    .from(smartImportRuns)
    .where(and(
      eq(smartImportRuns.projectId, projectId),
      eq(smartImportRuns.status, "committed"),
    ))
    .orderBy(desc(smartImportRuns.committedAt))
    .limit(1);

  if (!latestRun) return false;

  // Check for J_cat FAILURE issues (not warnings) on that run
  const issues = await db
    .select({ issueType: importIssues.issueType })
    .from(importIssues)
    .where(and(
      eq(importIssues.importRunId, latestRun.id),
      eq(importIssues.section, "EXPENDITURE"),
    ));

  return issues.some((i: { issueType: string | null }) =>
    i.issueType != null && JCAT_FAILURE_ISSUE_TYPES.has(i.issueType),
  );
}
