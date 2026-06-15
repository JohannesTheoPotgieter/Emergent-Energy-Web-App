/**
 * Finance Home — response shapes + pure presentation transforms.
 *
 * Finance Home is a READER with ONE underlying source for every REV/COS/GP
 * figure: the canonical single read path, `/api/finance/lines` (which reads
 * server/repositories/finance-line-level-repository.ts directly). The page
 * never recalculates a finance number — it only groups / cumulates / sorts the
 * canonical per-line totals the endpoint already produced:
 *
 *   GET /api/finance/lines?fyStart&fyEnd  — REV/COS/GP per project + per month,
 *                                            split realised / planned, + budget
 *   GET /api/finance/drill/tree?fy        — FY → Month → Project drill nodes
 *   GET /api/finance/drill/invoices       — invoice leaves + tracker source cell
 *   GET /api/weekly-cashflow?fy           — cash in/out + available, by week
 *   GET /api/finance/reconciliation       — per-project app-vs-tracker trust
 *   GET /api/weekly-cashflow/{receivables,payables}  — AR overdue / AP due
 *
 * The headline basis is REALISED (recognised), so the KPIs, the by-month charts,
 * the per-project table and the breakdowns all read the SAME realised fields and
 * reconcile with each other and with the GP / Revenue / COS pages (their realised
 * totals trace to the same repository). No aggregate / pre-summarised rollup is
 * read anywhere.
 */
import type { ReconDisplayStatus } from "@/components/finance/recon-status";

// ── Canonical /api/finance/lines shapes ──────────────────────────────────────

/** Per-month canonical totals (aggregateLinesByMonth → MonthlyReconRow). */
export interface MonthlyReconRow {
  monthKey: string;
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  count: number;
  plannedCos: number;
  plannedRevenue: number;
  plannedGp: number;
  plannedGpPct: number | null;
  realisedCos: number;
  realisedRevenue: number;
  realisedGp: number;
  realisedGpPct: number | null;
}

/** Per-project canonical totals (summariseLinesByProject → ProjectTotals). */
export interface ProjectTotals {
  projectId: number;
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  count: number;
  plannedCos: number;
  plannedRevenue: number;
  plannedGp: number;
  plannedGpPct: number | null;
  realisedCos: number;
  realisedRevenue: number;
  realisedGp: number;
  realisedGpPct: number | null;
}

/** Manual monthly budget (tracker_monthly_manual) — same rows the COS/REV tabs show. */
export interface BudgetByMonth {
  cos: Record<string, number>;
  revenue: Record<string, number>;
}

export interface FinanceLinesResponse {
  projectIds: number[];
  fyStart: string | null;
  fyEnd: string | null;
  byProject: ProjectTotals[];
  monthly: MonthlyReconRow[];
  total: MonthlyReconRow;
  budgetByMonth: BudgetByMonth;
}

// ── Other canonical reads ─────────────────────────────────────────────────────

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
  summary: { total: number; tie: number; drift: number; notCompared: number };
}

export interface AgedWorklist {
  asOf: string;
  rows: unknown[];
  buckets: Record<string, { count: number; amount: number }> & {
    total: { count: number; amount: number };
  };
}

// ── Month frame + labels ──────────────────────────────────────────────────────

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

export function monthLabelFromKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return monthKey;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

/**
 * Ordered list of YYYY-MM keys for the FY frame. Prefers the FY bounds
 * (so every FY month shows, even with no lines/budget); falls back to the
 * sorted union of the months that actually carry data (all-data mode).
 */
export function fyMonthFrame(
  monthly: MonthlyReconRow[],
  budget: BudgetByMonth,
  startMonthKey: string | null,
  endMonthKey: string | null,
): string[] {
  if (startMonthKey && endMonthKey && MONTH_KEY_RE.test(startMonthKey) && MONTH_KEY_RE.test(endMonthKey)) {
    const keys: string[] = [];
    let [y, m] = startMonthKey.split("-").map(Number);
    const [ey, em] = endMonthKey.split("-").map(Number);
    // Guard against a malformed range running away.
    for (let i = 0; i < 240 && (y < ey || (y === ey && m <= em)); i += 1) {
      keys.push(`${y}-${String(m).padStart(2, "0")}`);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    return keys;
  }
  const union = new Set<string>();
  for (const r of monthly) if (MONTH_KEY_RE.test(r.monthKey)) union.add(r.monthKey);
  for (const k of Object.keys(budget.revenue)) if (MONTH_KEY_RE.test(k)) union.add(k);
  return Array.from(union).sort();
}

// ── FY headline totals (realised basis; FYTD incl. open month) ───────────────

export interface FyHeadline {
  realisedRevenue: number;
  realisedCos: number;
  realisedGp: number;
  marginPct: number | null;
  budgetRevenueFy: number;
}

export function fyHeadline(
  total: MonthlyReconRow | undefined,
  budget: BudgetByMonth,
  frame: string[],
): FyHeadline {
  const realisedRevenue = total?.realisedRevenue ?? 0;
  const realisedCos = total?.realisedCos ?? 0;
  const realisedGp = total?.realisedGp ?? 0;
  const budgetRevenueFy = frame.reduce((s, mk) => s + (budget.revenue[mk] ?? 0), 0);
  return {
    realisedRevenue,
    realisedCos,
    realisedGp,
    marginPct: realisedRevenue !== 0 ? (realisedGp / realisedRevenue) * 100 : null,
    budgetRevenueFy,
  };
}

// ── Chart series (all from the canonical monthly rows + manual budget) ────────

export interface MonthStatePoint {
  monthKey: string;
  monthLabel: string;
  budget: number;
  planned: number;
  realised: number;
}

export function monthStatesSeries(
  monthly: MonthlyReconRow[],
  budget: BudgetByMonth,
  frame: string[],
): MonthStatePoint[] {
  const byKey = new Map(monthly.map((m) => [m.monthKey, m]));
  return frame.map((mk) => ({
    monthKey: mk,
    monthLabel: monthLabelFromKey(mk),
    budget: budget.revenue[mk] ?? 0,
    planned: byKey.get(mk)?.plannedRevenue ?? 0,
    realised: byKey.get(mk)?.realisedRevenue ?? 0,
  }));
}

export interface OnTrackPoint {
  monthKey: string;
  monthLabel: string;
  cumRealised: number;
  cumBudget: number;
}

export function onTrackSeries(
  monthly: MonthlyReconRow[],
  budget: BudgetByMonth,
  frame: string[],
): OnTrackPoint[] {
  const byKey = new Map(monthly.map((m) => [m.monthKey, m]));
  let cumRealised = 0;
  let cumBudget = 0;
  return frame.map((mk) => {
    cumRealised += byKey.get(mk)?.realisedRevenue ?? 0;
    cumBudget += budget.revenue[mk] ?? 0;
    return { monthKey: mk, monthLabel: monthLabelFromKey(mk), cumRealised, cumBudget };
  });
}

/** Ahead/behind = cumulative realised − cumulative budget at the current month. */
export function onTrackGap(series: OnTrackPoint[], todayYyyyMm: string): number | null {
  if (series.length === 0) return null;
  let point: OnTrackPoint | null = null;
  for (const p of series) if (p.monthKey <= todayYyyyMm) point = p;
  const at = point ?? series[series.length - 1];
  return at.cumRealised - at.cumBudget;
}

export interface GpMarginPoint {
  monthKey: string;
  monthLabel: string;
  gp: number;
  margin: number | null;
}

export function gpMarginSeries(monthly: MonthlyReconRow[], frame: string[]): GpMarginPoint[] {
  const byKey = new Map(monthly.map((m) => [m.monthKey, m]));
  return frame.map((mk) => {
    const m = byKey.get(mk);
    return {
      monthKey: mk,
      monthLabel: monthLabelFromKey(mk),
      gp: m?.realisedGp ?? 0,
      margin: m && m.realisedRevenue !== 0 ? (m.realisedGp / m.realisedRevenue) * 100 : null,
    };
  });
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

// ── Per-project breakdowns (realised basis) ──────────────────────────────────

export interface ProjectGpRow {
  projectId: number;
  projectName: string;
  revenue: number;
  gp: number;
  /** Margin as a percentage (e.g. 25.0), not a fraction. */
  gpPct: number | null;
}

function pctFromFraction(frac: number | null): number | null {
  return frac == null ? null : frac * 100;
}

function rollupToRows(byProject: ProjectTotals[], nameById: Map<number, string>): ProjectGpRow[] {
  return byProject.map((p) => ({
    projectId: p.projectId,
    projectName: nameById.get(p.projectId) ?? `Project ${p.projectId}`,
    revenue: p.realisedRevenue,
    gp: p.realisedGp,
    gpPct: pctFromFraction(p.realisedGpPct),
  }));
}

/** Top N projects by realised GP (descending). */
export function topProjectsByGp(
  byProject: ProjectTotals[],
  nameById: Map<number, string>,
  n = 8,
): ProjectGpRow[] {
  return rollupToRows(byProject, nameById)
    .filter((p) => p.revenue !== 0 || p.gp !== 0)
    .sort((a, b) => b.gp - a.gp)
    .slice(0, n);
}

/** Weakest N realised margins (ascending GP%), only projects with realised revenue. */
export function weakestMargins(
  byProject: ProjectTotals[],
  nameById: Map<number, string>,
  n = 8,
): ProjectGpRow[] {
  return rollupToRows(byProject, nameById)
    .filter((p) => p.gpPct != null && p.revenue > 0)
    .sort((a, b) => (a.gpPct ?? 0) - (b.gpPct ?? 0))
    .slice(0, n);
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
