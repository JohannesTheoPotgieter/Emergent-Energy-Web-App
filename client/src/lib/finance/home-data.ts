/**
 * Finance Home — response shapes + pure presentation transforms.
 *
 * Finance Home is a READER. COS/GP, the per-project table and the trust strip
 * read the canonical single read path `/api/finance/lines` (which reads
 * server/repositories/finance-line-level-repository.ts directly). REVENUE — the
 * revenue KPI and the revenue-by-month chart — reads `/api/revenue-tracker`
 * (owner decision 2026-06-19) so its budget · planned · realised · QuickBooks
 * bars tie cell-for-cell to the Revenue screen, which reads the same endpoint.
 * The page never recalculates a finance number — it only groups / cumulates /
 * sorts the totals each endpoint already produced:
 *
 *   GET /api/finance/lines?fyStart&fyEnd  — REV/COS/GP per project + per month,
 *                                            split realised / planned, + budget
 *   GET /api/revenue-tracker?fyStart&fyEnd — revenue by month: budget, planned
 *                                            (FYE engine), realised, QuickBooks
 *   GET /api/finance/drill/tree?fy        — FY → Month → Project drill nodes
 *   GET /api/finance/drill/invoices       — invoice leaves + tracker source cell
 *   GET /api/weekly-cashflow?fy           — cash in/out + available, by week
 *   GET /api/finance/reconciliation       — per-project app-vs-tracker trust
 *   GET /api/weekly-cashflow/{receivables,payables}  — AR overdue / AP due
 *
 * The headline basis is REALISED (recognised). Realised revenue is the SAME
 * canonical source on both endpoints (canonicalRealisedByMonth → the line-level
 * repository), so the revenue KPI ties to its chart and to the GP / Revenue /
 * COS pages; GP is recomputed on Home as (tracker revenue − line COS) so
 * REV − COS = GP holds exactly. No aggregate / pre-summarised rollup is read.
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
  /** QuickBooks realised (accrual P&L Income), same figure as the Revenue screen's QuickBooks column. */
  qb: number;
  /**
   * True when a manual budget was actually captured for this month. Future
   * months typically have no budget set yet, so `budget` collapses to 0 and the
   * budget bar renders zero-height (visually "absent"). The chart uses this flag
   * to footnote that absence instead of leaving it unexplained.
   */
  budgetSet: boolean;
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
    qb: 0,
    budgetSet: budget.revenue[mk] !== undefined,
  }));
}

// ── Revenue-by-month chart, sourced from the Revenue screen's endpoint ────────
// The Finance Home revenue-by-month chart must tie cell-for-cell to the Revenue
// screen (budget · planned · realised · QuickBooks). Both surfaces therefore read
// the SAME `/api/revenue-tracker` rows — PLANNED there comes from the FYE engine
// and QuickBooks from the accrual P&L, neither of which /api/finance/lines carries.

/** A single month row from GET /api/revenue-tracker (the fields the chart plots). */
export interface RevenueTrackerMonthRow {
  monthKey: string;
  budget: number;
  /** PLANNED column on the Revenue screen. */
  totalRevenue: number;
  realisedRevenue: number;
  /** QUICKBOOKS column on the Revenue screen. */
  qbRevenueActual: number;
}

export interface RevenueTrackerResponse {
  months: RevenueTrackerMonthRow[];
}

/**
 * Build the revenue-by-month chart series from the Revenue-screen endpoint so
 * every bar matches that table exactly. Months arrive already FY-ordered.
 */
export function revenueMonthStates(months: RevenueTrackerMonthRow[]): MonthStatePoint[] {
  return months.map((m) => ({
    monthKey: m.monthKey,
    monthLabel: monthLabelFromKey(m.monthKey),
    budget: m.budget ?? 0,
    planned: m.totalRevenue ?? 0,
    realised: m.realisedRevenue ?? 0,
    qb: m.qbRevenueActual ?? 0,
    budgetSet: (m.budget ?? 0) > 0,
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

// ─────────────────────────────────────────────────────────────────────────────
// Finance Home upgrades — additive derivations (all from the canonical ledger).
//
// Everything below RE-GROUPS the same realised/budget figures the endpoints
// above already produced. No new finance number is computed: the "include open
// month" values are byte-identical to the current page; "last closed month"
// simply subtracts the open (current) month's own canonical per-month value.
// ─────────────────────────────────────────────────────────────────────────────

/** As-at basis for the FYTD headline: settled months only, or including the live month. */
export type AsAtMode = "closed" | "open";

/** Chart grain for the by-month series. */
export type ChartGrain = "month" | "quarter";

/** Board-set FY target (item 8) as consumed by the Revenue KPI. */
export interface BoardTarget {
  fy: number;
  revenueTarget: number | null;
  targetMarginPct: number | null;
}

export interface BoardTargetsResponse {
  targets: BoardTarget[];
}

/**
 * Trailing window (in closed months) for the FY-close run-rate projection.
 * Mean of the last N closed months of realised revenue. Kept as a const so the
 * window is tuned in one place.
 */
export const RUN_RATE_WINDOW = 3;

/** Default margin floor for the exception watch-list (fraction, i.e. 0.05 = 5%). */
export const LOW_MARGIN_THRESHOLD = 0.05;

const SAST_OFFSET_MS = 120 * 60 * 1000;

/**
 * Current YYYY-MM anchored to SAST — matches the server's realised classifier
 * (`todayMonthKey()`), so "open month" agrees with the ledger's month boundary
 * rather than drifting with the viewer's timezone.
 */
export function currentSastMonthKey(now: Date = new Date()): string {
  return new Date(now.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 7);
}

/**
 * The last CLOSED FY month = the greatest frame month strictly before the open
 * (current) SAST month. Null when the FY has no closed month yet (frame in the
 * future). `frame` is ascending.
 */
export function lastClosedMonthKey(frame: string[], openMonthKey: string): string | null {
  let last: string | null = null;
  for (const mk of frame) if (mk < openMonthKey) last = mk;
  return last;
}

// ── As-at FYTD headline (item 5) ──────────────────────────────────────────────

export interface AsAtHeadline {
  realisedRevenue: number;
  realisedCos: number;
  grossProfit: number;
  marginPct: number | null;
  /** The open (current) month's own realised contribution — shown as an MTD add-on. */
  openRevenue: number;
  openCos: number;
  openGp: number;
}

/**
 * Recompute the FYTD headline for the chosen as-at basis. The include-open
 * inputs are the page's current totals; "closed" subtracts the open month's own
 * canonical per-month realised. No recomputation of any finance figure.
 */
export function asAtHeadline(args: {
  inclOpenRevenue: number;
  inclOpenCos: number;
  openRevenue: number;
  openCos: number;
  mode: AsAtMode;
}): AsAtHeadline {
  const { inclOpenRevenue, inclOpenCos, openRevenue, openCos, mode } = args;
  const realisedRevenue = mode === "closed" ? inclOpenRevenue - openRevenue : inclOpenRevenue;
  const realisedCos = mode === "closed" ? inclOpenCos - openCos : inclOpenCos;
  const grossProfit = realisedRevenue - realisedCos;
  return {
    realisedRevenue,
    realisedCos,
    grossProfit,
    marginPct: realisedRevenue !== 0 ? (grossProfit / realisedRevenue) * 100 : null,
    openRevenue,
    openCos,
    openGp: openRevenue - openCos,
  };
}

/** The open (current) month's realised revenue from the Revenue-screen rows. */
export function openMonthRealisedRevenue(
  months: RevenueTrackerMonthRow[],
  openMonthKey: string,
): number {
  return months.find((m) => m.monthKey === openMonthKey)?.realisedRevenue ?? 0;
}

/** The open (current) month's realised COS from the canonical monthly rows. */
export function openMonthRealisedCos(monthly: MonthlyReconRow[], openMonthKey: string): number {
  return monthly.find((m) => m.monthKey === openMonthKey)?.realisedCos ?? 0;
}

// ── Run-rate FY-close forecast (item 2) ───────────────────────────────────────

export interface RunRatePoint {
  monthKey: string;
  monthLabel: string;
  /** Cumulative realised extended at the trailing run-rate; null before the anchor. */
  projected: number | null;
}

export interface RunRateForecast {
  /** Aligned to the on-track frame; `projected` is populated from the anchor → FY-end. */
  points: RunRatePoint[];
  /** Mean monthly realised over the trailing closed-month window. */
  runRate: number;
  projectedFyClose: number | null;
  /** Cumulative budget at FY-end. */
  budgetFyClose: number;
  /** projectedFyClose − budgetFyClose (negative = projected to land behind budget). */
  gapToBudget: number | null;
  monthsProjected: number;
}

/**
 * Extend the cumulative-realised line to FY-end at the trailing run-rate (mean
 * of the last RUN_RATE_WINDOW closed months' realised). The projection anchors
 * at `boundaryKey` (the as-at boundary) and adds the run-rate each month to
 * FY-end. This is a FORECAST — kept visually and semantically distinct from the
 * actual-to-date ahead/behind gap (`onTrackGap`).
 */
export function runRateForecast(
  series: OnTrackPoint[],
  boundaryKey: string | null,
  openMonthKey: string,
  window = RUN_RATE_WINDOW,
): RunRateForecast {
  const budgetFyClose = series.length ? series[series.length - 1].cumBudget : 0;
  const emptyPoints = series.map((p) => ({
    monthKey: p.monthKey,
    monthLabel: p.monthLabel,
    projected: null as number | null,
  }));
  const empty: RunRateForecast = {
    points: emptyPoints,
    runRate: 0,
    projectedFyClose: null,
    budgetFyClose,
    gapToBudget: null,
    monthsProjected: 0,
  };
  if (series.length === 0) return empty;

  // Per-month realised deltas from the cumulative series.
  const perMonth = series.map((p, i) => (i === 0 ? p.cumRealised : p.cumRealised - series[i - 1].cumRealised));
  // Closed months = strictly before the open (current) month.
  const closedIdx = series
    .map((p, i) => ({ i, closed: p.monthKey < openMonthKey }))
    .filter((x) => x.closed)
    .map((x) => x.i);
  if (closedIdx.length === 0) return empty;

  const windowIdx = closedIdx.slice(-window);
  const runRate = windowIdx.reduce((s, i) => s + perMonth[i], 0) / windowIdx.length;

  const lastClosed = windowIdx[windowIdx.length - 1];
  const boundaryIdx = boundaryKey ? series.findIndex((p) => p.monthKey === boundaryKey) : lastClosed;
  const anchorIdx = boundaryIdx >= 0 ? boundaryIdx : lastClosed;

  const points: RunRatePoint[] = emptyPoints.map((p) => ({ ...p }));
  let running = series[anchorIdx].cumRealised;
  points[anchorIdx].projected = running;
  for (let i = anchorIdx + 1; i < series.length; i += 1) {
    running += runRate;
    points[i].projected = running;
  }
  const projectedFyClose = points[series.length - 1].projected;
  return {
    points,
    runRate,
    projectedFyClose,
    budgetFyClose,
    gapToBudget: projectedFyClose != null ? projectedFyClose - budgetFyClose : null,
    monthsProjected: Math.max(0, series.length - 1 - anchorIdx),
  };
}

// ── Exception watch-list (item 3) ─────────────────────────────────────────────

export type ExceptionReason = "negative_gp" | "low_margin" | "tracker_drift";

export interface ExceptionRow {
  projectId: number;
  projectName: string;
  revenue: number;
  gp: number;
  /** Margin as a percentage (e.g. 4.2), not a fraction; null when no realised revenue. */
  gpPct: number | null;
  /** App-vs-tracker drift magnitude (absDelta) from the reconciliation layer. */
  drift: number;
  reasons: ExceptionReason[];
  /** Internal ranking — higher = worse. */
  severity: number;
}

export interface ExceptionWatchList {
  rows: ExceptionRow[];
  /** Count before the top-N cap (drives the "view all" affordance). */
  totalFlagged: number;
}

/**
 * Rule-flag projects from the per-project ledger rollup + reconciliation layer:
 *   - negative GP,
 *   - realised margin below `marginThreshold` (default 5%),
 *   - material app-vs-tracker drift (reconciliation status amber/red).
 * Ranked worst-first, capped at `topN`. Names resolved via `nameById`.
 */
export function exceptionWatchList(
  byProject: ProjectTotals[],
  recon: ReconPortfolioProjectRow[],
  nameById: Map<number, string>,
  opts: { marginThreshold?: number; topN?: number } = {},
): ExceptionWatchList {
  const marginThreshold = opts.marginThreshold ?? LOW_MARGIN_THRESHOLD;
  const topN = opts.topN ?? 8;
  const reconById = new Map(recon.map((r) => [r.projectId, r]));

  const flagged: ExceptionRow[] = [];
  for (const p of byProject) {
    const r = reconById.get(p.projectId);
    const hasRealised = p.realisedRevenue !== 0 || p.realisedGp !== 0;
    const isDrift = r != null && (r.status === "amber" || r.status === "red");

    const reasons: ExceptionReason[] = [];
    if (hasRealised && p.realisedGp < 0) reasons.push("negative_gp");
    if (
      p.realisedGpPct != null &&
      p.realisedRevenue > 0 &&
      p.realisedGp >= 0 &&
      p.realisedGpPct < marginThreshold
    ) {
      reasons.push("low_margin");
    }
    if (isDrift) reasons.push("tracker_drift");
    if (reasons.length === 0) continue;

    const drift = r?.absDelta ?? 0;
    let severity = 0;
    if (reasons.includes("negative_gp")) severity += 1_000_000 + Math.abs(p.realisedGp);
    if (reasons.includes("low_margin")) severity += 100_000 + (marginThreshold - (p.realisedGpPct ?? 0)) * 1000;
    if (reasons.includes("tracker_drift")) severity += drift;

    flagged.push({
      projectId: p.projectId,
      projectName: nameById.get(p.projectId) ?? `Project ${p.projectId}`,
      revenue: p.realisedRevenue,
      gp: p.realisedGp,
      gpPct: p.realisedGpPct != null ? p.realisedGpPct * 100 : null,
      drift,
      reasons,
      severity,
    });
  }
  flagged.sort((a, b) => b.severity - a.severity);
  return { rows: flagged.slice(0, topN), totalFlagged: flagged.length };
}

// ── Month/Quarter grain (item 6) ──────────────────────────────────────────────

/**
 * Fold a FY-ordered month series into quarters (Q1 = first three frame months,
 * i.e. Sep–Nov for a full FY). Sums each state; keeps the first month's key as
 * the group anchor. Pure regroup of already-computed monthly figures.
 */
export function toQuarterlyStates(points: MonthStatePoint[]): MonthStatePoint[] {
  const out: MonthStatePoint[] = [];
  for (let i = 0; i < points.length; i += 3) {
    const group = points.slice(i, i + 3);
    if (group.length === 0) continue;
    out.push({
      monthKey: group[0].monthKey,
      monthLabel: `Q${Math.floor(i / 3) + 1}`,
      budget: group.reduce((s, g) => s + g.budget, 0),
      planned: group.reduce((s, g) => s + g.planned, 0),
      realised: group.reduce((s, g) => s + g.realised, 0),
      qb: group.reduce((s, g) => s + g.qb, 0),
      budgetSet: group.some((g) => g.budgetSet),
    });
  }
  return out;
}

export function applyGrain(points: MonthStatePoint[], grain: ChartGrain): MonthStatePoint[] {
  return grain === "quarter" ? toQuarterlyStates(points) : points;
}

// ── Prior-FY overlay alignment (item 6) ───────────────────────────────────────

/**
 * Align a prior-FY series onto the current frame BY POSITION. Both FYs run
 * Sep–Aug, so frame index i in the prior FY maps to index i in the current FY.
 * Returns a value-by-index array (null where the prior FY has no matching slot).
 */
export function alignPriorByIndex<T>(prior: T[], length: number, pick: (row: T) => number): (number | null)[] {
  return Array.from({ length }, (_, i) => (i < prior.length ? pick(prior[i]) : null));
}

// ── On-track chart row (item 2 + item 6): actual + forecast + prior overlay ───

export interface OnTrackChartRow extends OnTrackPoint {
  /** Dotted FY-close projection (item 2). Null before the projection anchor. */
  projected?: number | null;
  /** Prior-FY cumulative realised overlay (item 6). Null when compare is off. */
  priorCumRealised?: number | null;
}

/**
 * Merge the actual cumulative series with the run-rate projection and an
 * optional prior-FY cumulative overlay into a single chart array.
 */
export function buildOnTrackChartRows(
  actual: OnTrackPoint[],
  forecast: RunRateForecast | null,
  priorSeries: OnTrackPoint[] | null,
): OnTrackChartRow[] {
  const priorByIndex = priorSeries
    ? alignPriorByIndex(priorSeries, actual.length, (p) => p.cumRealised)
    : null;
  return actual.map((p, i) => ({
    ...p,
    projected: forecast ? forecast.points[i]?.projected ?? null : undefined,
    priorCumRealised: priorByIndex ? priorByIndex[i] : undefined,
  }));
}

// ── Month-states chart row (item 6): current + prior overlay ───────────────────

export interface MonthStateChartRow extends MonthStatePoint {
  /** Prior-FY realised revenue overlay, aligned by FY position. */
  priorRealised?: number | null;
}

export function buildMonthStateChartRows(
  current: MonthStatePoint[],
  priorRealisedByIndex: (number | null)[] | null,
): MonthStateChartRow[] {
  return current.map((p, i) => ({
    ...p,
    priorRealised: priorRealisedByIndex ? priorRealisedByIndex[i] ?? null : undefined,
  }));
}
