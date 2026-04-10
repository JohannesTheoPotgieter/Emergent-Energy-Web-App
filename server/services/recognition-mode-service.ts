/**
 * Recognition Mode Service (S14)
 *
 * Determines whether a project is ready for category-based revenue recognition.
 *
 * Recognition modes:
 *   CATEGORY_READY        — All categories have DIRECT J_cat. Revenue release
 *                           formula can use (Q/X_cat)*J_cat.
 *   LEGACY_PRE_REIMPORT   — No DIRECT category allocations exist. Project has
 *                           not been re-imported with the updated parser.
 *                           Revenue release is UNAVAILABLE (not degraded).
 *   REIMPORT_FAILED       — Project was re-imported but J_cat extraction failed
 *                           (e.g. missing "Total Revenue" column). Same effect as
 *                           LEGACY_PRE_REIMPORT — recognition unavailable.
 *
 * This service is the control plane for the re-import campaign and formula cutover.
 * It does NOT compute recognition numbers — it only determines whether the
 * recognition formula CAN run for a project.
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
  /** Number of active category allocations with DIRECT confidence */
  directCategoryCount: number;
  /** Number of active category allocations total (including PROVISIONAL) */
  totalCategoryCount: number;
  /** Category keys that lack DIRECT revenue_allocation (for diagnostics) */
  incompleteCategoryKeys: string[];
  /** Whether the latest import run had J_cat extraction issues */
  latestImportHadJcatIssues: boolean;
}

// ---------------------------------------------------------------------------
// Core query
// ---------------------------------------------------------------------------

/**
 * Determine the recognition mode for a project.
 *
 * Rules:
 * 1. If ALL active category_revenue_allocations rows have:
 *    - allocation_confidence IN ('DIRECT', 'HEADER_ERROR_POSITIONAL', 'MANUAL')
 *    - revenue_allocation IS NOT NULL
 *    Then mode = CATEGORY_READY.
 *
 * 2. If zero active rows exist → LEGACY_PRE_REIMPORT.
 *
 * 3. If active rows exist but any row has:
 *    - allocation_confidence = 'PROVISIONAL'
 *    - OR revenue_allocation IS NULL
 *    Then check whether the latest committed import run had J_cat issues.
 *    If yes → REIMPORT_FAILED. Otherwise → LEGACY_PRE_REIMPORT.
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
    const hasJcatIssues = await checkLatestImportForJcatIssues(projectId);
    return {
      mode: hasJcatIssues ? "REIMPORT_FAILED" : "LEGACY_PRE_REIMPORT",
      directCategoryCount: 0,
      totalCategoryCount: 0,
      incompleteCategoryKeys: [],
      latestImportHadJcatIssues: hasJcatIssues,
    };
  }

  // Check which allocations are DIRECT and have a revenue_allocation value
  const TRUSTED_CONFIDENCES = new Set(["DIRECT", "HEADER_ERROR_POSITIONAL", "MANUAL"]);
  const directAllocations = activeAllocations.filter(
    (a: typeof activeAllocations[number]) => TRUSTED_CONFIDENCES.has(a.allocationConfidence) && a.revenueAllocation != null,
  );
  const directCategoryCount = directAllocations.length;

  const incompleteCategoryKeys = activeAllocations
    .filter((a: typeof activeAllocations[number]) => !TRUSTED_CONFIDENCES.has(a.allocationConfidence) || a.revenueAllocation == null)
    .map((a: typeof activeAllocations[number]) => a.categoryKey);

  // All categories have trusted J_cat → ready for category-level recognition
  if (directCategoryCount === totalCategoryCount) {
    return {
      mode: "CATEGORY_READY",
      directCategoryCount,
      totalCategoryCount,
      incompleteCategoryKeys: [],
      latestImportHadJcatIssues: false,
    };
  }

  // Some categories are incomplete — check if this is due to a failed re-import
  const hasJcatIssues = await checkLatestImportForJcatIssues(projectId);
  return {
    mode: hasJcatIssues ? "REIMPORT_FAILED" : "LEGACY_PRE_REIMPORT",
    directCategoryCount,
    totalCategoryCount,
    incompleteCategoryKeys,
    latestImportHadJcatIssues: hasJcatIssues,
  };
}

/**
 * Check whether the latest committed import run for this project had
 * J_cat-related issues (JCAT_COLUMN_MISSING, JCAT_POSITIONAL_FALLBACK, etc.).
 */
async function checkLatestImportForJcatIssues(projectId: number): Promise<boolean> {
  // Find the latest committed run for this project
  const [latestRun] = await db
    .select({ id: smartImportRuns.id })
    .from(smartImportRuns)
    .where(and(
      eq(smartImportRuns.projectId, projectId),
      eq(smartImportRuns.status, "COMMITTED"),
    ))
    .orderBy(desc(smartImportRuns.committedAt))
    .limit(1);

  if (!latestRun) return false;

  // Check for J_cat-related issues on that run
  const issues = await db
    .select({ issueType: importIssues.issueType })
    .from(importIssues)
    .where(and(
      eq(importIssues.importRunId, latestRun.id),
      eq(importIssues.section, "EXPENDITURE"),
    ));

  return issues.some((i: { issueType: string | null }) => i.issueType != null && i.issueType.startsWith("JCAT_"));
}
