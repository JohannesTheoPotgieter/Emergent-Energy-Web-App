/**
 * Category-allocation relink (S10) — single implementation for every commit
 * path AND the prod remediation backfill.
 *
 * Why this exists. `category_revenue_allocations` is a snapshot table: every
 * import soft-closes the project's active allocation rows and inserts new
 * ones with NEW ids. `normalized_cost_lines.category_allocation_id` must be
 * re-pointed after each rotation or it dangles on a soft-closed row that the
 * § 3.1 snapshot guard correctly excludes — the line then derives ZERO § 3.3
 * revenue. The previous inline S10 blocks (duplicated in
 * server/smart-import-routes.ts and server/services/scheduler-commit.ts)
 * only ran when the CURRENT run extracted allocations, matched only on the
 * raw category NAME, and left unresolvable lines silently NULL. Result in
 * prod: most projects' lines unlinked, ~90% of revenue orphaned.
 *
 * Rules here:
 *  - Runs against the project's LIVE allocations (callers that just rotated
 *    allocations see their fresh rows — they are the live set).
 *  - Matches, in order: the line's own categoryKey, then its costCategory,
 *    against the allocation's categoryKey, categoryName, and the numbered
 *    "N. Name" composite — all whitespace-collapsed, trimmed, lowercased.
 *  - A line that cannot be resolved is NEVER left silent: it is flagged
 *    `noRevenueLinked = true` (the existing explicit "no formula linkage"
 *    flag the § 3.3 read path and UI badges already understand) and counted
 *    for the caller's import warnings.
 */

import { and, eq, isNull } from "drizzle-orm";
import { categoryRevenueAllocations, normalizedCostLines } from "@shared/schema";

/** Drizzle db or transaction — both expose the same query surface. */
type Executor = {
  select: (...args: never[]) => unknown;
  update: (...args: never[]) => unknown;
} & Record<string, unknown>;

export interface RelinkResult {
  /** Live allocation rows available for the project. */
  allocationCount: number;
  /** Lines whose categoryKey / categoryAllocationId were re-pointed. */
  relinked: number;
  /** Lines with cost-category data that matched no live allocation. */
  unresolved: number;
  /** Unresolved lines newly flagged noRevenueLinked (idempotent subset). */
  flagged: number;
}

export const normalizeCategoryMatchKey = (raw: string): string =>
  raw.trim().toLowerCase().replace(/\s+/g, " ");

interface LiveAllocation {
  id: number;
  categoryKey: string;
  categoryName: string;
  categoryNumber: string;
}

/** Build the lookup map used to resolve a cost line to a live allocation. */
export function buildAllocationMatchMap(
  allocations: readonly LiveAllocation[],
): Map<string, { key: string; id: number }> {
  const map = new Map<string, { key: string; id: number }>();
  // Insert name-based entries first so key-based entries win on collision.
  for (const a of allocations) {
    const target = { key: a.categoryKey, id: a.id };
    const numbered = `${a.categoryNumber}. ${a.categoryName}`;
    for (const candidate of [a.categoryName, numbered, a.categoryKey]) {
      const k = normalizeCategoryMatchKey(candidate ?? "");
      if (k) map.set(k, target);
    }
  }
  return map;
}

/** Resolve one line's category fields against the match map. */
export function resolveLineAllocation(
  line: { categoryKey: string | null; costCategory: string | null },
  matchMap: Map<string, { key: string; id: number }>,
): { key: string; id: number } | null {
  if (line.categoryKey) {
    const hit = matchMap.get(normalizeCategoryMatchKey(line.categoryKey));
    if (hit) return hit;
  }
  if (line.costCategory) {
    const hit = matchMap.get(normalizeCategoryMatchKey(line.costCategory));
    if (hit) return hit;
  }
  return null;
}

/**
 * Re-point every active cost line of `projectId` at its live allocation,
 * and flag the ones that cannot be resolved. Idempotent: a second run on
 * converged data performs zero writes.
 */
export async function relinkCategoryAllocationsForProject(
  tx: Executor,
  projectId: number,
): Promise<RelinkResult> {
  const dbi = tx as unknown as typeof import("../../db").db;

  const liveAllocations: LiveAllocation[] = await dbi
    .select({
      id: categoryRevenueAllocations.id,
      categoryKey: categoryRevenueAllocations.categoryKey,
      categoryName: categoryRevenueAllocations.categoryName,
      categoryNumber: categoryRevenueAllocations.categoryNumber,
    })
    .from(categoryRevenueAllocations)
    .where(
      and(
        eq(categoryRevenueAllocations.projectId, projectId),
        isNull(categoryRevenueAllocations.effectiveTo),
      ),
    );

  const result: RelinkResult = {
    allocationCount: liveAllocations.length,
    relinked: 0,
    unresolved: 0,
    flagged: 0,
  };

  const activeLines: Array<{
    id: number;
    costCategory: string | null;
    categoryKey: string | null;
    categoryAllocationId: number | null;
    noRevenueLinked: boolean | null;
    revenueRecognitionAmount: string | null;
  }> = await dbi
    .select({
      id: normalizedCostLines.id,
      costCategory: normalizedCostLines.costCategory,
      categoryKey: normalizedCostLines.categoryKey,
      categoryAllocationId: normalizedCostLines.categoryAllocationId,
      noRevenueLinked: normalizedCostLines.noRevenueLinked,
      revenueRecognitionAmount: normalizedCostLines.revenueRecognitionAmount,
    })
    .from(normalizedCostLines)
    .where(
      and(
        eq(normalizedCostLines.projectId, projectId),
        isNull(normalizedCostLines.effectiveTo),
        isNull(normalizedCostLines.deletedAt),
      ),
    );

  if (activeLines.length === 0) return result;

  const matchMap = buildAllocationMatchMap(liveAllocations);

  for (const line of activeLines) {
    const match = resolveLineAllocation(line, matchMap);
    if (match) {
      if (line.categoryKey !== match.key || line.categoryAllocationId !== match.id) {
        await dbi
          .update(normalizedCostLines)
          .set({ categoryKey: match.key, categoryAllocationId: match.id })
          .where(
            and(
              eq(normalizedCostLines.id, line.id),
              isNull(normalizedCostLines.effectiveTo),
            ),
          );
        result.relinked++;
      }
      continue;
    }

    // Only lines that carry category information count as "unresolved" —
    // a line with no category at all is a different data-quality class
    // (the read path already warns missing_category_allocation_linkage).
    const hasCategorySignal = !!(
      (line.categoryKey && line.categoryKey.trim()) ||
      (line.costCategory && line.costCategory.trim())
    );
    if (!hasCategorySignal && line.categoryAllocationId == null) continue;

    result.unresolved++;
    // Explicit, never silent (§ 3.3 edge-case philosophy): flag the line so
    // the UI badge + recon board surface it. Stale FKs pointing at closed
    // allocations are also cleared here so the read path's warning fires
    // deterministically instead of depending on which snapshot the FK hits.
    const needsFlag = line.noRevenueLinked !== true && line.revenueRecognitionAmount == null;
    const needsFkClear =
      line.categoryAllocationId != null &&
      !liveAllocations.some((a) => a.id === line.categoryAllocationId);
    if (needsFlag || needsFkClear) {
      await dbi
        .update(normalizedCostLines)
        .set({
          ...(needsFlag ? { noRevenueLinked: true } : {}),
          ...(needsFkClear ? { categoryAllocationId: null } : {}),
        })
        .where(
          and(
            eq(normalizedCostLines.id, line.id),
            isNull(normalizedCostLines.effectiveTo),
          ),
        );
      if (needsFlag) result.flagged++;
    }
  }

  return result;
}
