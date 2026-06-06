/**
 * Repository-backed revenue recognition — the canonical, and now only, source
 * for "Revenue" KPI tiles (the legacy col-U readers in `revenue-recognition.ts`
 * were removed once every caller routed through here).
 *
 * Per AGENT_GUARDRAILS § 3.3.2 the ONLY place per-line revenue is computed is
 * `finance-line-level-repository.ts`. Every "Revenue" KPI must consume its
 * output and sum — never re-read the deprecated persisted col-U column. These
 * helpers do exactly that:
 *
 *   planned  = Σ perLineRevenue over all lines (the § 3.3 recognised / POC
 *              revenue total).
 *   realised = Σ perLineRevenue where bucket === "realised" (the canonical
 *              realised gate — the repository's bucket is derived from
 *              isCanonicalCosRealised so the split matches the COS tracker
 *              line-for-line).
 *
 * Post the P2.1b cutover the repository reports the strict (Q/X)×J formula, so
 * routing the tiles here makes "reported revenue = formula" hold on every
 * surface — not just the ones already on the repository.
 */

import {
  FinanceLineLevelRepository,
  type FinanceLine,
  type GetProjectFinanceLinesOptions,
} from "../../repositories/finance-line-level-repository";

export interface RepoRevenueTotals {
  /** Σ perLineRevenue across all lines — recognised (POC) revenue. */
  planned: number;
  /** Σ perLineRevenue where the line's bucket is "realised". */
  realised: number;
}

/** Pure fold of repository lines into {planned, realised}. Exported for tests. */
export function sumRepoRevenue(
  lines: ReadonlyArray<Pick<FinanceLine, "perLineRevenue" | "bucket">>,
): RepoRevenueTotals {
  let planned = 0;
  let realised = 0;
  for (const l of lines) {
    planned += l.perLineRevenue;
    if (l.bucket === "realised") realised += l.perLineRevenue;
  }
  return { planned, realised };
}

/** Pure per-project fold. Exported for tests + the projects-summary tile. */
export function sumRepoRevenueByProject(
  lines: ReadonlyArray<Pick<FinanceLine, "projectId" | "perLineRevenue" | "bucket">>,
): Map<number, RepoRevenueTotals> {
  const out = new Map<number, RepoRevenueTotals>();
  for (const l of lines) {
    const cur = out.get(l.projectId) ?? { planned: 0, realised: 0 };
    cur.planned += l.perLineRevenue;
    if (l.bucket === "realised") cur.realised += l.perLineRevenue;
    out.set(l.projectId, cur);
  }
  return out;
}

/** De-duplicate + keep only positive integer project ids. */
function cleanIds(projectIds: readonly number[]): number[] {
  return [...new Set(projectIds.filter((id) => Number.isInteger(id) && id > 0))];
}

/**
 * Revenue totals for a set of projects via the § 3.3.2 single read path.
 * Scope is exactly the project ids passed in (each project's category totals
 * are computed independently — § 3.3.1, no cross-project pooling).
 */
export async function getRepoRevenueTotals(
  repo: FinanceLineLevelRepository,
  projectIds: readonly number[],
  opts?: GetProjectFinanceLinesOptions,
): Promise<RepoRevenueTotals> {
  const ids = cleanIds(projectIds);
  if (ids.length === 0) return { planned: 0, realised: 0 };
  const lines = await repo.getPortfolioFinanceLines(ids, opts);
  return sumRepoRevenue(lines);
}

/** Per-project revenue totals (one entry per project that has lines). */
export async function getRepoRevenueByProject(
  repo: FinanceLineLevelRepository,
  projectIds: readonly number[],
  opts?: GetProjectFinanceLinesOptions,
): Promise<Map<number, RepoRevenueTotals>> {
  const ids = cleanIds(projectIds);
  if (ids.length === 0) return new Map();
  const lines = await repo.getPortfolioFinanceLines(ids, opts);
  return sumRepoRevenueByProject(lines);
}
