/**
 * Finance Home — response shapes + pure presentation transforms.
 *
 * Finance Home is a READER. Every figure on the page comes from a canonical
 * tracker endpoint (the §3.3 single read path) and is reshaped here for the
 * charts / KPIs WITHOUT any recalculation of a finance number:
 *
 *   GET /api/revenue-tracker?fy=<fy>   → { months: RevTrackerMonthRow[] }
 *   GET /api/cos-tracker?fy=<fy>       → CosTrackerMonthRow[]
 *   GET /api/weekly-cashflow?fy=<fy>   → { weeks: CashflowWeekRow[] }
 *   GET /api/finance/lines             → { byProject: ProjectLineRollup[] }
 *   GET /api/finance/reconciliation    → ReconPortfolioResponse
 *   GET /api/weekly-cashflow/{receivables,payables,missing-invoices}
 *
 * These helpers only group / cumulate / sort the canonical figures — they never
 * derive REV/COS/GP themselves (GP comes from the locked gp-summary helper). No
 * pre-summarised / aggregate revenue rollup is read anywhere.
 */
import type { ReconDisplayStatus } from "@/components/finance/recon-status";
import { buildGpMonthSummaries, type GpMonthSummary } from "@/lib/finance/gp-summary";

// ── Canonical response shapes (subset we consume) ─────────────────────────────

export interface RevTrackerMonthRow {
  monthKey: string;
  monthLabel: string;
  totalRevenue: number;
  realisedRevenue: number;
  unrealisedRevenue: number;
  budget: number;
  ytdRevenue: number;
  ytdRealised: number;
  ytdBudget: number;
  realisedProjects: ProjectAmount[];
  revProjects: ProjectAmount[];
  unrealisedProjects: ProjectAmount[];
}
export interface RevTrackerResponse {
  months: RevTrackerMonthRow[];
}

export interface CosTrackerMonthRow {
  monthKey: string;
  monthLabel: string;
  budget: number;
  realisedCOS: number;
  realisedProjects: ProjectAmount[];
}

export interface CashflowWeekRow {
  weekStart: string;
  weekEnd: string;
  projectInflows: number;
  projectOutflows: number;
  availablePayment: number;
  hasAvailPayOverride: boolean;
}
export interface CashflowResponse {
  weeks: CashflowWeekRow[];
}

export interface ProjectAmount {
  projectName: string;
  amount: number;
}

/** /api/finance/lines byProject rollup (canonical §3.3 per-project totals). */
export interface ProjectLineRollup {
  projectId: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  realisedRevenue: number;
  realisedGp: number;
  realisedGpPct: number | null;
  count: number;
}
export interface FinanceLinesResponse {
  projectIds: number[];
  byProject?: ProjectLineRollup[];
}

export interface ReconPortfolioProjectRow {
  projectId: number;
  projectName: string;
  status: ReconDisplayStatus;
  appVsTrackerDelta: number;
  absDelta: number;
  /** True when a tracker baseline (col-U) was pasted to reconcile against. */
  trackerBaselinePresent: boolean;
}
export interface ReconPortfolioResponse {
  projects: ReconPortfolioProjectRow[];
  summary: {
    total: number;
    tie: number;
    drift: number;
    notCompared: number;
  };
}

export interface AgedWorklistRow {
  lineId: number;
  projectId: number | null;
  projectName: string | null;
  counterpartyName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amountExVat: number;
  ageDays: number;
  ageBucket: string;
  source: { sourceSheet: string | null; sourceRow: number | null; sourceCell: string | null };
}
export interface AgedWorklist {
  asOf: string;
  rows: AgedWorklistRow[];
  buckets: Record<string, { count: number; amount: number }> & { total: { count: number; amount: number } };
}

// ── Trust posture (the "Match my trackers?" strip) ───────────────────────────

export type TieState = "tie" | "drift" | "not_compared";

/**
 * Map a reconciliation status + baseline flag to the trust posture.
 *  - drift        → amber (stale paste) or red (structural fault).
 *  - tie          → ties to the tracker within R1 AND a tracker baseline exists.
 *  - not_compared → no tracker pasted yet, allocations not linked, or never
 *                   computed. A `green` with NO baseline is NEVER a tie.
 */
export function tieState(status: ReconDisplayStatus, baselinePresent: boolean): TieState {
  if (status === "amber" || status === "red") return "drift";
  if (status === "green" && baselinePresent) return "tie";
  return "not_compared";
}

export interface TrustCounts {
  tie: number;
  drift: number;
  notCompared: number;
}

export function summariseTrust(projects: ReconPortfolioProjectRow[]): TrustCounts {
  const counts: TrustCounts = { tie: 0, drift: 0, notCompared: 0 };
  for (const p of projects) {
    const state = tieState(p.status, p.trackerBaselinePresent);
    if (state === "tie") counts.tie += 1;
    else if (state === "drift") counts.drift += 1;
    else counts.notCompared += 1;
  }
  return counts;
}

// ── FY headline totals (FYTD, incl. open month — owner ruling) ───────────────

export interface FyRevenueTotals {
  /** Σ realised revenue across the FY months (FYTD incl. the open month). */
  realisedFytd: number;
  /** Σ monthly manual budget across the FY (the provisional FY26 target). */
  budgetFy: number;
}

export function fyRevenueTotals(months: RevTrackerMonthRow[]): FyRevenueTotals {
  let realisedFytd = 0;
  let budgetFy = 0;
  for (const m of months) {
    realisedFytd += m.realisedRevenue ?? 0;
    budgetFy += m.budget ?? 0;
  }
  return { realisedFytd, budgetFy };
}

export function fyRealisedCos(cosMonths: CosTrackerMonthRow[]): number {
  return cosMonths.reduce((s, m) => s + (m.realisedCOS ?? 0), 0);
}

// ── Chart series ──────────────────────────────────────────────────────────────

export interface MonthStatePoint {
  monthKey: string;
  monthLabel: string;
  budget: number;
  planned: number;
  realised: number;
}

/** Revenue by month split by tracker state (budget / planned / realised). */
export function monthStatesSeries(months: RevTrackerMonthRow[]): MonthStatePoint[] {
  return months.map((m) => ({
    monthKey: m.monthKey,
    monthLabel: m.monthLabel,
    budget: m.budget ?? 0,
    // "planned" = the not-yet-realised (RED font) forecast portion.
    planned: m.unrealisedRevenue ?? Math.max(0, (m.totalRevenue ?? 0) - (m.realisedRevenue ?? 0)),
    realised: m.realisedRevenue ?? 0,
  }));
}

export interface OnTrackPoint {
  monthKey: string;
  monthLabel: string;
  cumRealised: number;
  cumBudget: number;
}

/** Cumulative realised vs cumulative budget across the FY (the pace line). */
export function onTrackSeries(months: RevTrackerMonthRow[]): OnTrackPoint[] {
  let cumRealised = 0;
  let cumBudget = 0;
  return months.map((m) => {
    cumRealised += m.realisedRevenue ?? 0;
    cumBudget += m.budget ?? 0;
    return { monthKey: m.monthKey, monthLabel: m.monthLabel, cumRealised, cumBudget };
  });
}

/**
 * Ahead/behind = cumulative realised − cumulative budget at the current month
 * (the latest month on or before todayYyyyMm). Positive = ahead of plan.
 */
export function onTrackGap(series: OnTrackPoint[], todayYyyyMm: string): number | null {
  if (series.length === 0) return null;
  let point: OnTrackPoint | null = null;
  for (const p of series) {
    if (p.monthKey <= todayYyyyMm) point = p;
  }
  const at = point ?? series[series.length - 1];
  return at.cumRealised - at.cumBudget;
}

export interface CashWeekPoint {
  weekStart: string;
  label: string;
  inflows: number;
  outflows: number;
  available: number;
}

export function cashByWeekSeries(weeks: CashflowWeekRow[]): CashWeekPoint[] {
  return weeks.map((w) => ({
    weekStart: w.weekStart,
    label: weekLabel(w.weekStart),
    inflows: w.projectInflows ?? 0,
    outflows: w.projectOutflows ?? 0,
    available: w.availablePayment ?? 0,
  }));
}

export function weekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(d.getTime())) return weekStart;
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

// ── Per-project breakdowns (Top GP / weakest margins) ────────────────────────

export interface ProjectGpRow {
  projectId: number;
  projectName: string;
  revenue: number;
  gp: number;
  gpPct: number | null;
}

function rollupToRows(
  byProject: ProjectLineRollup[],
  nameById: Map<number, string>,
): ProjectGpRow[] {
  return byProject.map((p) => ({
    projectId: p.projectId,
    projectName: nameById.get(p.projectId) ?? `Project ${p.projectId}`,
    revenue: p.revenue,
    gp: p.gp,
    gpPct: p.gpPct,
  }));
}

/** Top N projects by GP (descending). */
export function topProjectsByGp(
  byProject: ProjectLineRollup[],
  nameById: Map<number, string>,
  n = 8,
): ProjectGpRow[] {
  return rollupToRows(byProject, nameById)
    .filter((p) => p.revenue !== 0 || p.gp !== 0)
    .sort((a, b) => b.gp - a.gp)
    .slice(0, n);
}

/** Weakest N margins (ascending GP%), only projects that have revenue. */
export function weakestMargins(
  byProject: ProjectLineRollup[],
  nameById: Map<number, string>,
  n = 8,
): ProjectGpRow[] {
  return rollupToRows(byProject, nameById)
    .filter((p) => p.gpPct != null && p.revenue > 0)
    .sort((a, b) => (a.gpPct ?? 0) - (b.gpPct ?? 0))
    .slice(0, n);
}

// ── GP/margin by month (reuses the locked gp-summary derivation) ─────────────

export function gpMarginSeries(
  cosMonths: { monthKey: string; monthLabel: string; budget: number; realisedCOS: number }[],
  revMonths: { monthKey: string; monthLabel: string; budget: number; realisedRevenue: number }[],
): GpMonthSummary[] {
  return buildGpMonthSummaries(cosMonths, revMonths);
}
