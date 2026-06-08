/**
 * GP month summary — presentation helper for the Finance Home GP card.
 *
 * GP = Revenue − COS, using the *exact same canonical pipeline numbers* the
 * COS and Revenue trackers expose (and the GP page derives from). This module
 * does not introduce a new figure or formula — it only aligns the two tracker
 * responses by month and picks the current month. The GP page
 * (finance-gp-company.tsx) builds the full grid from the same inputs.
 *
 * Sources:
 *   GET /api/cos-tracker?fy=<fy>      → CosTrackerMonth[]
 *   GET /api/revenue-tracker?fy=<fy>  → { months: RevTrackerMonth[] }
 */

/** Subset of the cos-tracker month row we consume. */
export interface CosTrackerMonth {
  monthKey: string;
  monthLabel: string;
  /** Manual budget (same source as the GP page "Budget COS"). */
  budget: number;
  /** Realised COS (invoice captured + BLACK confirmed date). */
  realisedCOS: number;
}

/** Subset of the revenue-tracker month row we consume. */
export interface RevTrackerMonth {
  monthKey: string;
  monthLabel: string;
  /** Manual budget (same source as the GP page "Budget Revenue"). */
  budget: number;
  /** Realised revenue (§3.3 category-scoped POC, realised lines only). */
  realisedRevenue: number;
}

export interface RevTrackerResponse {
  months: RevTrackerMonth[];
}

export interface GpMonthSummary {
  monthKey: string;
  monthLabel: string;
  realisedRevenue: number;
  realisedCOS: number;
  realisedGP: number;
  budgetRevenue: number;
  budgetCOS: number;
  budgetGP: number;
  /** Realised GP / Realised Revenue, or null when revenue is 0. */
  realisedMarginPct: number | null;
}

function marginPct(gp: number, rev: number): number | null {
  return rev !== 0 ? (gp / rev) * 100 : null;
}

/**
 * Align cos + revenue tracker months by monthKey and derive per-month GP.
 * COS months drive the ordering frame (same as the GP page).
 */
export function buildGpMonthSummaries(
  cosMonths: CosTrackerMonth[],
  revMonths: RevTrackerMonth[],
): GpMonthSummary[] {
  const revByKey = new Map(revMonths.map((m) => [m.monthKey, m]));
  return cosMonths.map((cos) => {
    const rev = revByKey.get(cos.monthKey);
    const realisedRevenue = rev?.realisedRevenue ?? 0;
    const realisedCOS = cos.realisedCOS ?? 0;
    const realisedGP = realisedRevenue - realisedCOS;
    const budgetRevenue = rev?.budget ?? 0;
    const budgetCOS = cos.budget ?? 0;
    const budgetGP = budgetRevenue - budgetCOS;
    return {
      monthKey: cos.monthKey,
      monthLabel: cos.monthLabel,
      realisedRevenue,
      realisedCOS,
      realisedGP,
      budgetRevenue,
      budgetCOS,
      budgetGP,
      realisedMarginPct: marginPct(realisedGP, realisedRevenue),
    };
  });
}

/**
 * Pick the current month (by YYYY-MM key), falling back to the latest month
 * on or before it, then to the last month in the series. Returns the chosen
 * month plus the one before it (for the month-over-month trend).
 */
export function pickCurrentMonth(
  months: GpMonthSummary[],
  todayYyyyMm: string,
): { current: GpMonthSummary | null; previous: GpMonthSummary | null } {
  if (months.length === 0) return { current: null, previous: null };
  let idx = months.findIndex((m) => m.monthKey === todayYyyyMm);
  if (idx === -1) {
    for (let i = months.length - 1; i >= 0; i -= 1) {
      if (months[i].monthKey <= todayYyyyMm) {
        idx = i;
        break;
      }
    }
    if (idx === -1) idx = months.length - 1;
  }
  return { current: months[idx], previous: idx > 0 ? months[idx - 1] : null };
}
