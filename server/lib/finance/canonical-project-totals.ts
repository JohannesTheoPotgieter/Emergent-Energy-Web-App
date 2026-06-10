/**
 * Canonical per-project REV / COS / GP totals — the ONLY aggregation over the
 * § 3.3.2 single read path (FinanceLineLevelRepository).
 *
 * Why this exists. The same metric used to render up to four different values
 * because surfaces computed independently:
 *   - finance-line-level-repository  → (Q/X)×J per line (the keeper)
 *   - canonical-dashboard-kpi        → parent-grain `getCosRealisedAmountForNclRow`
 *   - company-overview               → COS-ratio blend (realisedCos/totalCos)×totalRev
 *   - project_revenue_summary        → pasted workbook header summary
 * Every dashboard / overview / KPI / PRS surface now consumes THIS module and
 * sums — per § 3.3.1 aggregates are always the sum of per-line values, never a
 * pooled or parallel formula.
 *
 * Metric definitions (recognised family — billed/cash concepts live elsewhere
 * and must not be conflated per § 3.3.3):
 *   realisedRevenue / realisedCos / realisedGp — lines whose bucket is
 *     "realised" under the canonical § 3.2 predicate, on the § 3.3
 *     recognition date (invoice-raised / override).
 *   recognisedRevenueAllLines / totalCosAllLines — every line with actuals,
 *     realised or not (the "to date" dashboards).
 *   plannedRevenue / plannedCos / plannedGp — the (G/I)×J planned side.
 */

import {
  FinanceLineLevelRepository,
  type FinanceLine,
  type GetProjectFinanceLinesOptions,
} from "../../repositories/finance-line-level-repository";
import type { db } from "../../db";

export interface CanonicalProjectTotals {
  projectId: number;
  realisedRevenue: number;
  realisedCos: number;
  realisedGp: number;
  /** GP% of the realised pair; null when realisedRevenue is 0. */
  realisedGpPct: number | null;
  recognisedRevenueAllLines: number;
  totalCosAllLines: number;
  gpAllLines: number;
  plannedRevenue: number;
  plannedCos: number;
  plannedGp: number;
  lineCount: number;
}

const r2 = (n: number): number => Number(n.toFixed(2));

function emptyTotals(projectId: number): CanonicalProjectTotals {
  return {
    projectId,
    realisedRevenue: 0,
    realisedCos: 0,
    realisedGp: 0,
    realisedGpPct: null,
    recognisedRevenueAllLines: 0,
    totalCosAllLines: 0,
    gpAllLines: 0,
    plannedRevenue: 0,
    plannedCos: 0,
    plannedGp: 0,
    lineCount: 0,
  };
}

/** Pure aggregation — sum of per-line values, nothing else (§ 3.3.1). */
export function aggregateCanonicalProjectTotals(
  lines: readonly FinanceLine[],
  projectIds?: readonly number[],
): Map<number, CanonicalProjectTotals> {
  const byProject = new Map<number, CanonicalProjectTotals>();
  for (const id of projectIds ?? []) byProject.set(id, emptyTotals(id));

  for (const line of lines) {
    let totals = byProject.get(line.projectId);
    if (!totals) {
      totals = emptyTotals(line.projectId);
      byProject.set(line.projectId, totals);
    }
    totals.lineCount += 1;
    totals.recognisedRevenueAllLines += line.perLineRevenue;
    totals.totalCosAllLines += line.actualTotal;
    totals.gpAllLines += line.perLineGp;
    totals.plannedRevenue += line.plannedRevenue;
    totals.plannedCos += line.plannedActualTotal;
    totals.plannedGp += line.plannedGp;
    if (line.bucket === "realised") {
      totals.realisedRevenue += line.perLineRevenue;
      totals.realisedCos += line.actualTotal;
      totals.realisedGp += line.perLineGp;
    }
  }

  for (const totals of byProject.values()) {
    totals.realisedRevenue = r2(totals.realisedRevenue);
    totals.realisedCos = r2(totals.realisedCos);
    totals.realisedGp = r2(totals.realisedGp);
    totals.realisedGpPct =
      totals.realisedRevenue !== 0 ? totals.realisedGp / totals.realisedRevenue : null;
    totals.recognisedRevenueAllLines = r2(totals.recognisedRevenueAllLines);
    totals.totalCosAllLines = r2(totals.totalCosAllLines);
    totals.gpAllLines = r2(totals.gpAllLines);
    totals.plannedRevenue = r2(totals.plannedRevenue);
    totals.plannedCos = r2(totals.plannedCos);
    totals.plannedGp = r2(totals.plannedGp);
  }
  return byProject;
}

/**
 * Fetch + aggregate for a set of projects. `dbInstance` lets import commits
 * run this inside their transaction (the repository accepts any executor with
 * the drizzle query surface).
 */
export async function getCanonicalProjectTotals(
  projectIds: number[],
  opts: GetProjectFinanceLinesOptions = {},
  dbInstance?: typeof db,
): Promise<Map<number, CanonicalProjectTotals>> {
  if (projectIds.length === 0) return new Map();
  const repo = new FinanceLineLevelRepository(dbInstance);
  const lines = await repo.getPortfolioFinanceLines(projectIds, opts);
  return aggregateCanonicalProjectTotals(lines, projectIds);
}
