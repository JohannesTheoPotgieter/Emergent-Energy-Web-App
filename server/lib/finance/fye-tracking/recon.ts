/**
 * FYE Tracking — reconciliation metrics.
 *
 * Extracts the headline figures the FY26 workbook is reconciled against from a
 * computed {@link FyeTrackingResult}: the 4-state totals, YTD-Realised and a
 * named month's Realised, the project count, and the de-dup / amber-flag
 * checks. Pure (type-only import of the result shape) so it is safe to use in
 * both the recon CLI and the test without loading the DB layer.
 */

import type { FyeTrackingResult } from "./service";
import type { FyeStateTotals } from "./compute";

export interface FyeReconMetrics {
  states: FyeStateTotals;
  /** YTD-running Realised at the last closed month. */
  ytdRealised: { revenue: number; cos: number; gp: number; marginPct: number | null };
  /** Realised in a specific month (monthly, non-cumulative). */
  monthRealised: { monthKey: string; revenue: number; cos: number };
  projectCount: number;
  /** Projects flagged COS_NO_REVENUE (amber, kept). */
  amberProjects: string[];
  /** Projects flagged NON_STANDARD_TEMPLATE (excluded from totals). */
  nonStandardProjects: string[];
  /** Names of excluded/de-duped trackers. */
  excluded: string[];
  /** Superspar live count + whether a "Despatch" duplicate survived (should be 0). */
  supersparLiveCount: number;
  supersparDespatchDuplicateCount: number;
}

export function extractReconMetrics(
  result: FyeTrackingResult,
  monthKey = "2026-05",
): FyeReconMetrics {
  const { projectTable, dashboard } = result;

  const lastClosed = dashboard.lastClosedMonthKey;
  const ytdRev = lastClosed ? dashboard.revenue.ytd.find((r) => r.monthKey === lastClosed)?.actual ?? 0 : 0;
  const ytdCos = lastClosed ? dashboard.cos.ytd.find((r) => r.monthKey === lastClosed)?.actual ?? 0 : 0;
  const ytdGp = ytdRev - ytdCos;

  const monthRev = dashboard.revenue.monthly.find((r) => r.monthKey === monthKey)?.actual ?? 0;
  const monthCos = dashboard.cos.monthly.find((r) => r.monthKey === monthKey)?.actual ?? 0;

  const amberProjects = projectTable.rows.filter((r) => r.flags.includes("COS_NO_REVENUE")).map((r) => r.project);
  const nonStandardProjects = projectTable.rows.filter((r) => r.flags.includes("NON_STANDARD_TEMPLATE")).map((r) => r.project);

  const supersparRows = projectTable.rows.filter((r) => /superspar/i.test(r.project));
  const supersparDespatchDuplicateCount = supersparRows.filter((r) => /despatch/i.test(r.project)).length;

  return {
    states: projectTable.stateTotals,
    ytdRealised: { revenue: ytdRev ?? 0, cos: ytdCos ?? 0, gp: ytdGp, marginPct: ytdRev ? ytdGp / ytdRev : null },
    monthRealised: { monthKey, revenue: monthRev ?? 0, cos: monthCos ?? 0 },
    projectCount: projectTable.projectCount,
    amberProjects,
    nonStandardProjects,
    excluded: projectTable.excluded.map((e) => e.project),
    supersparLiveCount: supersparRows.length,
    supersparDespatchDuplicateCount,
  };
}

/** The Excel acceptance baseline (FY26 snapshot as at 3 Jun 2026). The figures
 * move with the data — this is the snapshot the methodology must reproduce. */
export const FY26_EXCEL_BASELINE = {
  states: {
    realised: { revenue: 129_805_448, cos: 111_955_417 },
    committed: { revenue: 45_904_486, cos: 43_140_272 },
    planned: { revenue: 59_848_541, cos: 59_814_450 },
    unrealised: { revenue: 1_207_484, cos: 281_543 },
    budget: { revenue: 236_765_960, cos: 215_191_682 },
  },
  ytdRealised: { revenue: 129_336_720, cos: 111_319_783, gp: 18_016_937, marginPct: 0.139 },
  mayRealised: { monthKey: "2026-05", revenue: 31_480_892, cos: 26_444_224 },
  projectCount: 48,
  amberProjects: [
    "Sibasa", "Mayo Macs", "Lynnridge", "Meraki Ph3", "Trident Steel GP", "Boundary Terraces", "Cascades",
  ],
} as const;
