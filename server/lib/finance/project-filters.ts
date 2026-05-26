/**
 * DF-1 — Project-status filter helpers for finance aggregates.
 *
 * The canonical finance aggregators (getCanonicalFinanceByProjectIds,
 * getPortfolioFinanceLines, the cashflow weekly view, etc.) accept a
 * `projectIds: number[]` and roll up finance lines for those projects.
 * Before this helper, callers passed every project they could find for
 * the user — including projects in `closed`, `internal`, `tbc` statuses,
 * which silently inflated FY revenue / cashflow / priority KPI totals.
 *
 * Use `filterActiveProjectIds` to keep only active / hold projects (the
 * default for finance KPIs). Use `filterProjectIdsByStatus` for explicit
 * status sets (e.g. ['active', 'closed'] for end-of-year reports that
 * want to include just-closed projects). The "All projects" path is the
 * legacy default — call the canonical aggregator directly without going
 * through this helper.
 */
import { inArray } from "drizzle-orm";
import { db } from "../../db";
import { projectInfo } from "@shared/schema";

/**
 * Statuses that contribute to "current" finance aggregates by default.
 * `active` projects are live; `hold` projects are still on the books
 * (per § 4A Hold is a status not a stage) and their committed costs /
 * forecast cash flows should still be visible.
 *
 * `closed` is the typical exclude — the project is wrapped, its books
 * have been finalised; it shouldn't keep inflating the current FY tile.
 * `internal` covers non-customer-facing work (office build, R&D) and
 * shouldn't appear in commercial finance KPIs. `tbc` is pre-sale and
 * has no business in finance aggregates until it goes active.
 */
export const DEFAULT_FINANCE_PROJECT_STATUSES = ["active", "hold"] as const;

export type FinanceProjectStatus =
  | "active"
  | "hold"
  | "internal"
  | "closed"
  | "tbc";

/**
 * Returns the subset of `projectIds` whose `project_status` is in
 * `statuses` (defaults to active + hold). Preserves input order for the
 * matching rows; drops rows that don't match.
 */
export async function filterProjectIdsByStatus(
  projectIds: number[],
  statuses: readonly FinanceProjectStatus[] = DEFAULT_FINANCE_PROJECT_STATUSES,
): Promise<number[]> {
  if (projectIds.length === 0) return [];
  const allowed = new Set<string>(statuses);
  const rows = await db
    .select({ id: projectInfo.id, status: projectInfo.projectStatus })
    .from(projectInfo)
    .where(inArray(projectInfo.id, projectIds));
  const allowedIds = new Set<number>();
  for (const r of rows) {
    if (r.status && allowed.has(String(r.status))) allowedIds.add(r.id);
  }
  return projectIds.filter((id) => allowedIds.has(id));
}

/**
 * Convenience: filter to active + hold only. Most finance reads should
 * use this; opt out to `filterProjectIdsByStatus` if a different set is
 * needed.
 */
export async function filterActiveProjectIds(projectIds: number[]): Promise<number[]> {
  return filterProjectIdsByStatus(projectIds, DEFAULT_FINANCE_PROJECT_STATUSES);
}
