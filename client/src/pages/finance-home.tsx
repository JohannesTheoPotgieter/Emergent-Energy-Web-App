/**
 * Finance Home — the accountant's dashboard.
 *
 * A pure READER with ONE underlying source for every REV/COS/GP figure: the
 * canonical single read path `/api/finance/lines` (which reads
 * server/repositories/finance-line-level-repository.ts directly). The KPIs, the
 * by-month charts, the per-project table and the breakdowns all read the SAME
 * realised fields off that one response, so they reconcile with each other and
 * with the GP / Revenue / COS pages (whose realised totals trace to the same
 * repository). Nothing is recalculated on the page.
 *
 * The insight/polish upgrades (variance callouts, run-rate forecast, exception
 * watch-list, as-at basis, prior-FY compare, grain, board target, board export,
 * cash runway) all RE-GROUP these same canonical figures — no new finance
 * number is computed. The board FY target (when set) is a display comparison
 * only; the frozen recognition/realisation/cashflow paths are untouched.
 *
 *   GET /api/finance/lines?fyStart&fyEnd  — REV/COS/GP per project + per month
 *                                            (realised / planned) + manual budget
 *   GET /api/revenue-tracker?fyStart&fyEnd — revenue by month (ties to Revenue screen)
 *   GET /api/finance/drill/{tree,invoices} — drill to the tracker source cell
 *   GET /api/weekly-cashflow?fy            — cash in/out + available, by week
 *   GET /api/finance/reconciliation        — canonical project list + names + drift
 *   GET /api/weekly-cashflow/{receivables,payables} — AR overdue / AP due
 *   GET /api/smart-import/health-dashboard — import freshness + flagged trackers
 *   GET /api/import-config/attention       — parked (needs-review) imports
 *   GET /api/board-targets                 — board FY revenue target + margin
 *
 * FORBIDDEN here (and proven absent by qa/tests/unit/finance-home-canonical):
 * the pre-summarised per-project revenue rollup, the company-wide whole-life
 * plan, the per-month tracker aggregate endpoints, and the bookkeeping-system
 * reconciliation tile (kept on its own page).
 *
 * Brand: centralised tokens + shared finance template components only.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { GitCompare, Search } from "lucide-react";

import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  FinancePageHeader,
  KpiRow,
  KpiTile,
  MoneyValue,
  DrillTable,
  FinanceLoading,
  FinanceEmpty,
  FinanceError,
  type DrillColumn,
} from "@/components/finance/template";
import { FinancialYearScopeControl } from "@/components/finance/FinancialYearScopeControl";
import {
  ChartCard,
  RevenueStatesChart,
  OnTrackChart,
  GpMarginChart,
  CashByWeekChart,
  TopProjectsGpChart,
  RunwaySparkline,
} from "@/components/finance/home/finance-home-charts";
import {
  ImportFreshnessChip,
  DashboardControls,
  BoardExportMenu,
  BoardTargetDialog,
  ExceptionWatchList,
} from "@/components/finance/home/finance-home-controls";
import { MonthDrillDrawer, type MonthDrillTarget } from "@/components/finance/home/month-drill-drawer";
import { ProjectDrillDetail } from "@/components/finance/home/project-drill-detail";
import { fetchQueryFn } from "@/lib/queryClient";
import { formatZar, formatZarCompact } from "@/lib/currency";
import { formatRelativeWithAbsoluteZA } from "@/lib/datetime";
import { useAuth } from "@/hooks/use-auth";
import { useFinancialYearScope, getFinancialYearBounds } from "@/hooks/use-financial-year-scope";
import { budgetDelta } from "@/lib/finance/budget-variance";
import { exportBoardCsv, exportBoardXlsx, type BoardExportModel } from "@/lib/finance/board-export";
import {
  applyGrain,
  alignPriorByIndex,
  asAtHeadline,
  buildMonthStateChartRows,
  buildOnTrackChartRows,
  cashByWeekSeries,
  currentSastMonthKey,
  exceptionWatchList,
  fyHeadline,
  fyMonthFrame,
  gpMarginSeries,
  lastClosedMonthKey,
  monthLabelFromKey,
  monthStatesSeries,
  onTrackGap,
  onTrackSeries,
  openMonthRealisedCos,
  openMonthRealisedRevenue,
  revenueMonthStates,
  runRateForecast,
  topProjectsByGp,
  weekLabel,
  type AgedWorklist,
  type AsAtMode,
  type BoardTarget,
  type BoardTargetsResponse,
  type CashflowResponse,
  type ChartGrain,
  type FinanceLinesResponse,
  type MonthlyReconRow,
  type ProjectGpRow,
  type ReconPortfolioResponse,
  type RevenueTrackerResponse,
} from "@/lib/finance/home-data";

const todayIso = new Date().toISOString().slice(0, 10);

interface ImportHealthRow {
  lastImportDate: string | null;
  lastImportStatus?: string;
  unresolvedIssueCount?: number;
  staleness?: string;
}

interface ImportAttentionItem {
  state: string;
}
interface ImportAttentionResponse {
  items: ImportAttentionItem[];
}

// Roles allowed to set the board FY target (mirrors the server allowlist).
const BOARD_TARGET_ROLES = new Set(["COO_ADMIN", "CEO_ADMIN", "CFO"]);

// AR "overdue" / AP "due" tiles show PAST-DUE only — lines aged beyond 30 days
// from the invoice-raised date. The not-yet-due 0-30 bucket is excluded so the
// figure matches the "overdue/due" label (the worklist `total` bucket is ALL
// open AR/AP, including current). Assumes 30-day terms; widen the bucket list
// here if terms change.
const PAST_DUE_BUCKETS = ["31-60", "61-90", "90+"] as const;
function pastDueTotal(w: AgedWorklist | undefined): { amount: number; count: number } {
  const buckets = w?.buckets;
  if (!buckets) return { amount: 0, count: 0 };
  return PAST_DUE_BUCKETS.reduce(
    (acc, key) => ({
      amount: acc.amount + (buckets[key]?.amount ?? 0),
      count: acc.count + (buckets[key]?.count ?? 0),
    }),
    { amount: 0, count: 0 },
  );
}

/** localStorage-backed enum state (item 5 persistence). */
function usePersistedEnum<T extends string>(key: string, initial: T, valid: readonly T[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    const stored = window.localStorage.getItem(key);
    return stored && (valid as readonly string[]).includes(stored) ? (stored as T) : initial;
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, v);
      } catch {
        /* ignore quota / privacy-mode failures */
      }
    },
    [key],
  );
  return [value, set];
}

interface AllProjectRow {
  projectId: number;
  projectName: string;
  revenue: number;
  gp: number;
  gpPct: number | null;
}

export default function FinanceHomePage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const fyScope = useFinancialYearScope();
  const qs = fyScope.apiQueryString;
  const fyWindowQs =
    fyScope.startDate && fyScope.endDate
      ? `?fyStart=${fyScope.startDate}&fyEnd=${fyScope.endDate}`
      : "";

  // ── Dashboard controls (persisted) ─────────────────────────────────────────
  const [asAt, setAsAt] = usePersistedEnum<AsAtMode>("ee.financeHome.asAt", "closed", ["closed", "open"]);
  const [grain, setGrain] = usePersistedEnum<ChartGrain>("ee.financeHome.grain", "month", ["month", "quarter"]);
  const [compareRaw, setCompareRaw] = usePersistedEnum<"on" | "off">("ee.financeHome.compare", "off", ["on", "off"]);
  const [exceptionsExpanded, setExceptionsExpanded] = useState(false);
  const canCompare = fyScope.fy != null;
  const compare = compareRaw === "on" && canCompare;
  const priorFy = fyScope.fy != null ? fyScope.fy - 1 : null;
  const priorLabel = priorFy != null ? getFinancialYearBounds(priorFy).label : "prior FY";

  // ── Canonical reads ────────────────────────────────────────────────────────
  const linesQuery = useQuery<FinanceLinesResponse>({
    queryKey: ["/api/finance/lines", fyWindowQs],
    queryFn: fetchQueryFn(`/api/finance/lines${fyWindowQs}`),
    staleTime: 60_000,
  });
  const revTrackerQuery = useQuery<RevenueTrackerResponse>({
    queryKey: ["/api/revenue-tracker", fyWindowQs],
    queryFn: fetchQueryFn(`/api/revenue-tracker${fyWindowQs}`),
    staleTime: 60_000,
  });
  // Prior-FY overlay (item 6) — same endpoints, prior window; only when comparing.
  const priorWindowQs = priorFy != null ? (() => {
    const b = getFinancialYearBounds(priorFy);
    return `?fyStart=${b.startDate}&fyEnd=${b.endDate}`;
  })() : "";
  const priorLinesQuery = useQuery<FinanceLinesResponse>({
    queryKey: ["/api/finance/lines", "prior", priorWindowQs],
    queryFn: fetchQueryFn(`/api/finance/lines${priorWindowQs}`),
    staleTime: 60_000,
    enabled: compare && priorFy != null,
  });
  const cashQuery = useQuery<CashflowResponse>({
    queryKey: ["/api/weekly-cashflow", qs],
    queryFn: fetchQueryFn(`/api/weekly-cashflow?${qs}`),
    staleTime: 60_000,
  });
  const reconQuery = useQuery<ReconPortfolioResponse>({
    queryKey: ["/api/finance/reconciliation"],
    queryFn: fetchQueryFn("/api/finance/reconciliation"),
    staleTime: 60_000,
  });
  const arQuery = useQuery<AgedWorklist>({
    queryKey: ["/api/weekly-cashflow/receivables"],
    queryFn: fetchQueryFn("/api/weekly-cashflow/receivables"),
    staleTime: 60_000,
  });
  const apQuery = useQuery<AgedWorklist>({
    queryKey: ["/api/weekly-cashflow/payables"],
    queryFn: fetchQueryFn("/api/weekly-cashflow/payables"),
    staleTime: 60_000,
  });
  const importHealthQuery = useQuery<ImportHealthRow[]>({
    queryKey: ["/api/smart-import/health-dashboard"],
    queryFn: fetchQueryFn("/api/smart-import/health-dashboard", { on401: "returnNull" }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const importAttentionQuery = useQuery<ImportAttentionResponse>({
    queryKey: ["/api/import-config/attention"],
    queryFn: fetchQueryFn("/api/import-config/attention", { on401: "returnNull" }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const boardTargetQuery = useQuery<BoardTargetsResponse>({
    queryKey: ["/api/board-targets"],
    queryFn: fetchQueryFn("/api/board-targets", { on401: "returnNull" }),
    staleTime: 5 * 60_000,
    retry: false,
  });

  // ── Derived (grouping/sorting only — no figure recalculated) ────────────────
  const linesData = linesQuery.data;
  const monthly = useMemo(() => linesData?.monthly ?? [], [linesData]);
  const byProject = useMemo(() => linesData?.byProject ?? [], [linesData]);
  const budgetByMonth = useMemo(
    () => linesData?.budgetByMonth ?? { cos: {}, revenue: {} },
    [linesData],
  );
  const weeks = useMemo(() => cashQuery.data?.weeks ?? [], [cashQuery.data]);
  const reconProjects = useMemo(() => reconQuery.data?.projects ?? [], [reconQuery.data]);
  const arPastDue = useMemo(() => pastDueTotal(arQuery.data), [arQuery.data]);
  const apPastDue = useMemo(() => pastDueTotal(apQuery.data), [apQuery.data]);
  const revTrackerMonths = useMemo(() => revTrackerQuery.data?.months ?? [], [revTrackerQuery.data]);

  const frame = useMemo(
    () => fyMonthFrame(monthly, budgetByMonth, fyScope.startMonthKey, fyScope.endMonthKey),
    [monthly, budgetByMonth, fyScope.startMonthKey, fyScope.endMonthKey],
  );

  // ── As-at basis (item 5): the boundary month for realised-to-date ───────────
  const openMonthKey = useMemo(() => currentSastMonthKey(), []);
  const lastClosed = useMemo(() => lastClosedMonthKey(frame, openMonthKey), [frame, openMonthKey]);
  // "closed" excludes the open month (realised counted only up to the last closed
  // month); "open" includes it. boundaryKey caps which months contribute realised.
  const boundaryKey = asAt === "closed" ? (lastClosed ?? "0000-00") : openMonthKey;
  const asAtBasisLabel =
    asAt === "closed"
      ? lastClosed
        ? `Last closed month (${monthLabelFromKey(lastClosed)})`
        : "Last closed month"
      : "Incl. open month (MTD)";

  // Realised zeroed for months beyond the as-at boundary — a re-grouping of the
  // canonical per-month figures, not a recomputation.
  const asAtMonthly = useMemo<MonthlyReconRow[]>(
    () =>
      monthly.map((m) =>
        m.monthKey > boundaryKey
          ? { ...m, realisedRevenue: 0, realisedCos: 0, realisedGp: 0, realisedGpPct: null }
          : m,
      ),
    [monthly, boundaryKey],
  );

  const headline = useMemo(
    () => fyHeadline(linesData?.total, budgetByMonth, frame),
    [linesData, budgetByMonth, frame],
  );

  // ── KPI figures (as-at aware; include-open stays byte-identical to before) ──
  const inclOpenRevenue = useMemo(
    () => revTrackerMonths.reduce((s, m) => s + (m.realisedRevenue ?? 0), 0),
    [revTrackerMonths],
  );
  const revenueBudgetFy = useMemo(
    () => revTrackerMonths.reduce((s, m) => s + (m.budget ?? 0), 0),
    [revTrackerMonths],
  );
  const openRevenue = useMemo(
    () => openMonthRealisedRevenue(revTrackerMonths, openMonthKey),
    [revTrackerMonths, openMonthKey],
  );
  const openCos = useMemo(() => openMonthRealisedCos(monthly, openMonthKey), [monthly, openMonthKey]);
  const kpi = useMemo(
    () =>
      asAtHeadline({
        inclOpenRevenue,
        inclOpenCos: headline.realisedCos,
        openRevenue,
        openCos,
        mode: asAt,
      }),
    [inclOpenRevenue, headline.realisedCos, openRevenue, openCos, asAt],
  );
  const revenueRecognised = kpi.realisedRevenue;
  const realisedCos = kpi.realisedCos;
  const grossProfit = kpi.grossProfit;
  const marginPct = kpi.marginPct;

  const cosBudgetFy = useMemo(
    () => frame.reduce((s, mk) => s + (budgetByMonth.cos[mk] ?? 0), 0),
    [frame, budgetByMonth],
  );

  const revFiguresLoading = linesQuery.isLoading || revTrackerQuery.isLoading;
  const revFiguresError = revTrackerQuery.isError;
  const gpFiguresError = revTrackerQuery.isError || linesQuery.isError;

  // ── Board FY target (item 8) — display comparison only ──────────────────────
  const boardTarget = useMemo<BoardTarget | null>(() => {
    const targets = boardTargetQuery.data?.targets ?? [];
    return targets.find((t) => t.fy === fyScope.fy) ?? null;
  }, [boardTargetQuery.data, fyScope.fy]);
  const revenueTargetValue = boardTarget?.revenueTarget ?? null;
  const targetMarginValue = boardTarget?.targetMarginPct ?? null;
  const hasBoardRevenueTarget = revenueTargetValue != null && revenueTargetValue > 0;
  // Comparison denominator: board target when set, else the manual FY budget.
  const revenueTarget = hasBoardRevenueTarget ? (revenueTargetValue as number) : revenueBudgetFy;
  const revenueTargetLabel = hasBoardRevenueTarget ? "board target" : "FY budget";
  const revVsTargetPct = revenueTarget !== 0 ? Math.round((revenueRecognised / revenueTarget) * 100) : 0;
  const revVariance = budgetDelta(revenueRecognised, revenueTarget); // realised − target
  const cosVariance = budgetDelta(realisedCos, cosBudgetFy); // realised − budget (over = +)
  const canEditBoardTarget =
    fyScope.fy != null && BOARD_TARGET_ROLES.has(String(user?.role ?? "").toUpperCase());

  // ── Chart series (as-at applied; grain + prior-FY overlay) ──────────────────
  const monthStatesAsAt = useMemo(() => {
    const base = revenueMonthStates(revTrackerMonths);
    return base.map((p) =>
      p.monthKey > boundaryKey ? { ...p, realised: 0, qb: 0 } : p,
    );
  }, [revTrackerMonths, boundaryKey]);
  const baseStates = useMemo(() => applyGrain(monthStatesAsAt, grain), [monthStatesAsAt, grain]);

  const onTrack = useMemo(
    () => onTrackSeries(asAtMonthly, budgetByMonth, frame),
    [asAtMonthly, budgetByMonth, frame],
  );
  const onTrackGapValue = useMemo(() => onTrackGap(onTrack, boundaryKey), [onTrack, boundaryKey]);
  const forecast = useMemo(
    () => runRateForecast(onTrack, boundaryKey, openMonthKey),
    [onTrack, boundaryKey, openMonthKey],
  );
  const gpMonths = useMemo(() => gpMarginSeries(asAtMonthly, frame), [asAtMonthly, frame]);
  const cashWeeks = useMemo(() => cashByWeekSeries(weeks), [weeks]);

  // Prior-FY series for the compare overlay.
  const priorMonthly = useMemo(() => priorLinesQuery.data?.monthly ?? [], [priorLinesQuery.data]);
  const priorBudget = useMemo(
    () => priorLinesQuery.data?.budgetByMonth ?? { cos: {}, revenue: {} },
    [priorLinesQuery.data],
  );
  const priorFrame = useMemo(() => {
    if (priorFy == null) return [] as string[];
    const b = getFinancialYearBounds(priorFy);
    return fyMonthFrame([], { cos: {}, revenue: {} }, b.startMonthKey, b.endMonthKey);
  }, [priorFy]);
  const priorOnTrack = useMemo(
    () => onTrackSeries(priorMonthly, priorBudget, priorFrame),
    [priorMonthly, priorBudget, priorFrame],
  );
  const priorRealisedByIndex = useMemo(() => {
    if (!compare) return null;
    const priorStates = applyGrain(monthStatesSeries(priorMonthly, priorBudget, priorFrame), grain);
    return alignPriorByIndex(priorStates, baseStates.length, (p) => p.realised);
  }, [compare, priorMonthly, priorBudget, priorFrame, grain, baseStates.length]);

  const onTrackRows = useMemo(
    () => buildOnTrackChartRows(onTrack, forecast, compare ? priorOnTrack : null),
    [onTrack, forecast, compare, priorOnTrack],
  );
  const monthStateRows = useMemo(
    () => buildMonthStateChartRows(baseStates, priorRealisedByIndex),
    [baseStates, priorRealisedByIndex],
  );

  const nameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of reconProjects) m.set(p.projectId, p.projectName);
    return m;
  }, [reconProjects]);

  const topGp = useMemo<ProjectGpRow[]>(
    () => topProjectsByGp(byProject, nameById),
    [byProject, nameById],
  );

  // Exception watch-list (item 3) — rule-flagged projects from the ledger rollup
  // + reconciliation drift. Ranked worst-first; capped unless expanded.
  const exceptions = useMemo(
    () =>
      exceptionWatchList(byProject, reconProjects, nameById, {
        topN: exceptionsExpanded ? Math.max(byProject.length, 8) : 8,
      }),
    [byProject, reconProjects, nameById, exceptionsExpanded],
  );

  // Current week + negative-cash guard.
  const currentWeek = useMemo(
    () =>
      weeks.find((w) => w.weekStart <= todayIso && todayIso < w.weekEnd) ??
      weeks.find((w) => w.weekStart <= todayIso) ??
      null,
    [weeks],
  );
  const inflowsLoaded = useMemo(() => weeks.some((w) => (w.projectInflows ?? 0) > 0), [weeks]);
  const cashNegativeNoInflows =
    currentWeek != null && currentWeek.availablePayment < 0 && !inflowsLoaded;

  // 4-week cash runway (item 9) — current week + next 3, plot availablePayment.
  const runway = useMemo(() => {
    const curIdx = weeks.findIndex((w) => w.weekStart <= todayIso && todayIso < w.weekEnd);
    const startIdx = curIdx >= 0 ? curIdx : weeks.findIndex((w) => w.weekStart <= todayIso);
    if (startIdx < 0) return [] as { weekStart: string; value: number }[];
    return weeks
      .slice(startIdx, startIdx + 4)
      .map((w) => ({ weekStart: w.weekStart, value: w.availablePayment ?? 0 }));
  }, [weeks]);

  // ── Import freshness / health chip (item 4) ─────────────────────────────────
  const importHealthRows = useMemo(() => importHealthQuery.data ?? [], [importHealthQuery.data]);
  const latestImportIso = useMemo(() => {
    const dates = importHealthRows
      .map((r) => r.lastImportDate)
      .filter((d): d is string => !!d)
      .sort();
    return dates[dates.length - 1] ?? null;
  }, [importHealthRows]);
  const importTrackers = useMemo(
    () => importHealthRows.filter((r) => !!r.lastImportDate).length,
    [importHealthRows],
  );
  const importFlagged = useMemo(
    () => importHealthRows.filter((r) => (r.unresolvedIssueCount ?? 0) > 0).length,
    [importHealthRows],
  );
  const importParked = useMemo(
    () => (importAttentionQuery.data?.items ?? []).filter((i) => i.state === "needs_review").length,
    [importAttentionQuery.data],
  );
  const importRelative = latestImportIso ? formatRelativeWithAbsoluteZA(latestImportIso) : null;

  // ── All-projects table ──────────────────────────────────────────────────────
  const [search, setSearch] = useState("");

  const allRows = useMemo<AllProjectRow[]>(() => {
    const metricsById = new Map(byProject.map((p) => [p.projectId, p]));
    const built = reconProjects.map((p) => {
      const m = metricsById.get(p.projectId);
      return {
        projectId: p.projectId,
        projectName: p.projectName,
        revenue: m?.realisedRevenue ?? 0,
        gp: m?.realisedGp ?? 0,
        gpPct: m?.realisedGpPct != null ? m.realisedGpPct * 100 : null,
      };
    });
    return built.sort((a, b) => b.revenue - a.revenue);
  }, [reconProjects, byProject]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? allRows.filter((r) => r.projectName.toLowerCase().includes(q)) : allRows;
  }, [allRows, search]);

  const allColumns: DrillColumn<AllProjectRow>[] = [
    {
      key: "project",
      header: "Project",
      sortValue: (r) => r.projectName,
      cell: (r) => (
        <Link
          href={`/projects/${r.projectId}/finance`}
          className="font-medium text-foreground hover:underline"
          data-testid={`finance-home-project-row-${r.projectId}`}
        >
          {r.projectName}
        </Link>
      ),
    },
    {
      key: "revenue",
      header: "Revenue",
      numeric: true,
      widthClass: "w-32",
      cell: (r) => <MoneyValue value={r.revenue} />,
      sortValue: (r) => r.revenue,
    },
    {
      key: "gp",
      header: "GP",
      numeric: true,
      widthClass: "w-32",
      cell: (r) => <MoneyValue value={r.gp} />,
      sortValue: (r) => r.gp,
    },
    {
      key: "gpPct",
      header: "GP %",
      numeric: true,
      widthClass: "w-20",
      hideBelowMd: true,
      cell: (r) => (
        <span className="tabular-nums text-slate-700">
          {r.gpPct != null ? `${r.gpPct.toFixed(1)}%` : "—"}
        </span>
      ),
      sortValue: (r) => r.gpPct,
      exportValue: (r) => (r.gpPct != null ? `${r.gpPct.toFixed(1)}%` : ""),
    },
  ];

  // ── Board-ready export (item 7) ─────────────────────────────────────────────
  const buildExportModel = useCallback((): BoardExportModel => {
    const byKeyMonthly = new Map(monthly.map((m) => [m.monthKey, m]));
    const byKeyRev = new Map(revTrackerMonths.map((m) => [m.monthKey, m]));
    const byKeyOnTrack = new Map(onTrack.map((p) => [p.monthKey, p]));
    const monthlyRows = frame.map((mk) => {
      const budget = budgetByMonth.revenue[mk] ?? 0;
      const planned = byKeyMonthly.get(mk)?.plannedRevenue ?? 0;
      const beyond = mk > boundaryKey;
      const realised = beyond ? 0 : byKeyRev.get(mk)?.realisedRevenue ?? 0;
      const qb = beyond ? 0 : byKeyRev.get(mk)?.qbRevenueActual ?? 0;
      const ot = byKeyOnTrack.get(mk);
      return {
        month: monthLabelFromKey(mk),
        budget,
        planned,
        realised,
        qb,
        variance: realised - budget,
        cumRealised: ot?.cumRealised ?? 0,
        cumBudget: ot?.cumBudget ?? 0,
        onTrackGap: ot ? ot.cumRealised - ot.cumBudget : 0,
      };
    });
    const kpis = [
      { metric: "Revenue recognised", value: formatZar(revenueRecognised) },
      { metric: `Revenue ${revenueTargetLabel}`, value: formatZar(revenueTarget) },
      { metric: "Revenue vs target", value: `${formatZar(revVariance)} (${revVsTargetPct}%)` },
      { metric: "Cost of sales", value: formatZar(realisedCos) },
      { metric: "COS budget", value: formatZar(cosBudgetFy) },
      { metric: "Gross profit", value: formatZar(grossProfit) },
      { metric: "GP margin", value: marginPct != null ? `${marginPct.toFixed(1)}%` : "—" },
      {
        metric: "Target margin",
        value: targetMarginValue != null ? `${targetMarginValue.toFixed(1)}%` : "not set",
      },
      {
        metric: "Projected FY-close (run-rate)",
        value: forecast.projectedFyClose != null ? formatZar(forecast.projectedFyClose) : "—",
      },
      {
        metric: "Projected gap to budget",
        value: forecast.gapToBudget != null ? formatZar(forecast.gapToBudget) : "—",
      },
      {
        metric: "Cash available this week",
        value: currentWeek ? formatZar(currentWeek.availablePayment) : "—",
      },
      { metric: "AR overdue (30+ days)", value: formatZar(arPastDue.amount) },
      { metric: "AP due (30+ days)", value: formatZar(apPastDue.amount) },
    ];
    return {
      fyLabel: fyScope.label,
      asAtLabel: asAtBasisLabel,
      basis: "ex-VAT · canonical line-level ledger",
      kpis,
      monthly: monthlyRows,
    };
  }, [
    monthly,
    revTrackerMonths,
    onTrack,
    frame,
    budgetByMonth,
    boundaryKey,
    revenueRecognised,
    revenueTargetLabel,
    revenueTarget,
    revVariance,
    revVsTargetPct,
    realisedCos,
    cosBudgetFy,
    grossProfit,
    marginPct,
    targetMarginValue,
    forecast,
    currentWeek,
    arPastDue,
    apPastDue,
    fyScope.label,
    asAtBasisLabel,
  ]);

  const handleExport = useCallback(
    (format: "csv" | "xlsx") => {
      const model = buildExportModel();
      const filename = `finance-home-board-${fyScope.label.replace(/\s+/g, "-")}`;
      if (format === "csv") exportBoardCsv(model, filename);
      else void exportBoardXlsx(model, filename);
    },
    [buildExportModel, fyScope.label],
  );

  // ── Month drill ─────────────────────────────────────────────────────────────
  const [drill, setDrill] = useState<MonthDrillTarget | null>(null);
  const openMonth = (monthKey: string) =>
    setDrill({ monthKey, monthLabel: monthLabelFromKey(monthKey) });

  const subtitle = `${fyScope.label} · every figure from your trackers, line-for-line`;
  const figuresLoading = linesQuery.isLoading;

  // Directional variance callout node (item 1) — colour ONLY signals direction.
  const varianceCallout = (
    prefix: string,
    delta: number,
    goodWhenNegative: boolean,
  ) => {
    const isGood = goodWhenNegative ? delta <= 0 : delta >= 0;
    const word = goodWhenNegative
      ? delta <= 0
        ? "under"
        : "over"
      : delta >= 0
        ? "ahead"
        : "behind";
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <span>{prefix}</span>
        <MoneyValue value={Math.abs(delta)} align="left" className="text-[11px] font-medium" />
        <span className="text-slate-300">·</span>
        <span className={isGood ? "font-medium text-emerald-700" : "font-medium text-status-drift"}>
          {word}
        </span>
      </span>
    );
  };

  return (
    <PageShell data-testid="finance-home-page">
      <FinancePageHeader
        data-testid="finance-home-header"
        title="Finance Home"
        question={subtitle}
        source="Canonical line-level ledger · ex-VAT"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ImportFreshnessChip
              relative={importRelative}
              title={latestImportIso ? `Last committed import · ${latestImportIso}` : undefined}
              trackers={importTrackers}
              parked={importParked}
              flagged={importFlagged}
            />
            {canEditBoardTarget && fyScope.fy != null && (
              <BoardTargetDialog
                fy={fyScope.fy}
                fyLabel={fyScope.label}
                current={boardTarget}
                onSaved={() => queryClient.invalidateQueries({ queryKey: ["/api/board-targets"] })}
              />
            )}
            <BoardExportMenu onExport={handleExport} disabled={figuresLoading || revFiguresLoading} />
          </div>
        }
        period={<FinancialYearScopeControl scope={fyScope} />}
      />

      {/* Dashboard controls — as-at basis · grain · prior-FY compare */}
      <section className="mb-3 flex flex-wrap items-center justify-between gap-2" aria-label="Dashboard controls">
        <DashboardControls
          asAt={asAt}
          onAsAt={setAsAt}
          grain={grain}
          onGrain={setGrain}
          compare={compare}
          onCompare={(v) => setCompareRaw(v ? "on" : "off")}
          priorLabel={priorLabel}
        />
        <span className="text-[11px] text-slate-400" data-testid="finance-home-asat-note">
          Realised as at: <span className="font-medium text-slate-600">{asAtBasisLabel}</span>
          {asAt === "open" && kpi.openGp !== 0 && (
            <> · open-month MTD GP {formatZarCompact(kpi.openGp)}</>
          )}
        </span>
      </section>

      {/* KPI ROW — the four headline answers (realised, per the as-at basis) */}
      <section className="mb-3" aria-label="Headline finance figures">
        <KpiRow>
          <KpiTile
            data-testid="finance-home-kpi-revenue"
            label="Revenue recognised"
            description={asAtBasisLabel}
            value={revFiguresLoading ? "…" : revFiguresError ? "—" : <MoneyValue value={revenueRecognised} align="left" />}
            tone="positive"
            progress={!revFiguresError && revenueTarget !== 0 ? { pct: revVsTargetPct, tone: "positive" } : undefined}
            supporting={
              revFiguresError ? (
                "Revenue source unavailable"
              ) : (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {varianceCallout(`vs ${revenueTargetLabel} ${formatZarCompact(revenueTarget)} ·`, revVariance, false)}
                  {!hasBoardRevenueTarget && (
                    <Badge
                      variant="outline"
                      className="text-[9px] border-status-drift/40 text-status-drift"
                      title={`${fyScope.label} manual monthly budget — provisional until a board FY revenue target is set.`}
                    >
                      Provisional
                    </Badge>
                  )}
                </span>
              )
            }
            href="/revenue-tracker"
          />

          <KpiTile
            data-testid="finance-home-kpi-cos"
            label="Cost of sales"
            description={asAtBasisLabel}
            value={figuresLoading ? "…" : <MoneyValue value={realisedCos} align="left" />}
            tone="default"
            supporting={
              cosBudgetFy !== 0
                ? varianceCallout("vs budget", cosVariance, true)
                : "Realised COS, line-for-line"
            }
            href="/cos"
          />

          <KpiTile
            data-testid="finance-home-kpi-gp"
            label="Gross profit"
            description={asAtBasisLabel}
            value={revFiguresLoading ? "…" : gpFiguresError ? "—" : <MoneyValue value={grossProfit} align="left" />}
            tone={gpFiguresError ? "default" : grossProfit >= 0 ? "positive" : "critical"}
            supporting={
              gpFiguresError ? (
                "Source unavailable"
              ) : marginPct == null ? (
                "No realised revenue yet"
              ) : targetMarginValue != null ? (
                <span className="inline-flex flex-wrap items-center gap-1">
                  <span>margin {marginPct.toFixed(1)}%</span>
                  <span className="text-slate-300">vs target</span>
                  <span
                    className={
                      marginPct >= targetMarginValue ? "font-medium text-emerald-700" : "font-medium text-status-drift"
                    }
                  >
                    {targetMarginValue.toFixed(1)}%
                  </span>
                </span>
              ) : (
                <span>
                  margin {marginPct.toFixed(1)}% · <span className="text-slate-400">no target set</span>
                </span>
              )
            }
            href="/finance/gp/company"
          />

          <KpiTile
            data-testid="finance-home-kpi-cash"
            label="Cash available this week"
            description={currentWeek ? `Week of ${weekLabel(currentWeek.weekStart)}` : "this week"}
            value={
              cashQuery.isLoading
                ? "…"
                : currentWeek
                  ? <MoneyValue value={currentWeek.availablePayment} align="left" />
                  : "—"
            }
            tone={
              currentWeek
                ? cashNegativeNoInflows
                  ? "warning"
                  : currentWeek.availablePayment >= 0
                    ? "positive"
                    : "critical"
                : "default"
            }
            supporting={
              !currentWeek
                ? cashQuery.isLoading
                  ? "Loading…"
                  : "No week in range"
                : cashNegativeNoInflows
                  ? "Inflows not yet loaded — opening + outflows only"
                  : currentWeek.hasAvailPayOverride
                    ? "Manual override in effect"
                    : "4-week runway →"
            }
            sparkline={runway.length > 0 ? { content: <RunwaySparkline data={runway} />, widthClass: "w-24" } : undefined}
            href="/cashflow"
          />
        </KpiRow>
      </section>

      {/* SECTION 4 — Revenue by month: budget · planned · realised (click a month) */}
      <section className="mb-3">
        <ChartCard
          title="Revenue — budget · planned · realised · QB, by month"
          hint="Same figures as the Revenue screen, by invoice-raised month. Click a month to drill in."
          data-testid="finance-home-revenue-states"
        >
          {revTrackerQuery.isLoading ? (
            <FinanceLoading label="Loading revenue…" />
          ) : revTrackerQuery.isError ? (
            <FinanceError title="Could not load revenue." onRetry={() => revTrackerQuery.refetch()} />
          ) : monthStateRows.length === 0 ? (
            <FinanceEmpty title="No revenue in this FY." />
          ) : (
            <RevenueStatesChart
              data={monthStateRows}
              onMonthClick={grain === "month" ? openMonth : undefined}
              priorLabel={compare ? priorLabel : undefined}
            />
          )}
        </ChartCard>
      </section>

      {/* SECTION 5 — On track for the year? + run-rate forecast */}
      <section className="mb-3">
        <ChartCard
          title="On track for the year?"
          hint="Cumulative realised vs cumulative budget, with a dotted run-rate forecast to FY-close."
          action={
            onTrackGapValue != null ? (
              <Badge
                variant="outline"
                className={onTrackGapValue >= 0 ? "ee-status-success" : "ee-status-danger"}
              >
                {onTrackGapValue >= 0 ? "Ahead" : "Behind"} {formatZarCompact(Math.abs(onTrackGapValue))}
              </Badge>
            ) : undefined
          }
          data-testid="finance-home-on-track"
        >
          {figuresLoading ? (
            <FinanceLoading label="Loading…" />
          ) : onTrackRows.length === 0 ? (
            <FinanceEmpty title="No revenue in this FY." />
          ) : (
            <>
              <OnTrackChart data={onTrackRows} showForecast priorLabel={compare ? priorLabel : undefined} />
              {forecast.projectedFyClose != null && (
                <p className="mt-1 text-[11px] text-slate-500" data-testid="finance-home-forecast-note">
                  Run-rate forecast:{" "}
                  <span className="font-medium text-slate-700">
                    projected {formatZarCompact(forecast.projectedFyClose)}
                  </span>{" "}
                  at FY-close ·{" "}
                  {forecast.gapToBudget != null && (
                    <span className={forecast.gapToBudget >= 0 ? "font-medium text-emerald-700" : "font-medium text-status-drift"}>
                      {forecast.gapToBudget >= 0 ? "ahead of" : "behind"} budget {formatZarCompact(Math.abs(forecast.gapToBudget))}
                    </span>
                  )}{" "}
                  <span className="text-slate-400">(forecast — distinct from the actual-to-date gap above)</span>
                </p>
              )}
            </>
          )}
        </ChartCard>
      </section>

      {/* SECTION 6 — GP & margin by month · Cash by week */}
      <section className="mb-3 grid gap-3 lg:grid-cols-2">
        <ChartCard title="GP & margin by month" data-testid="finance-home-gp-margin">
          {figuresLoading ? (
            <FinanceLoading label="Loading…" />
          ) : gpMonths.length === 0 ? (
            <FinanceEmpty title="No GP in this FY." />
          ) : (
            <GpMarginChart data={gpMonths} />
          )}
        </ChartCard>
        <ChartCard title="Cash by week" hint="Inflows by received-date, outflows by payment-date." data-testid="finance-home-cash-week">
          {cashQuery.isLoading ? (
            <FinanceLoading label="Loading…" />
          ) : cashWeeks.length === 0 ? (
            <FinanceEmpty title="No cashflow weeks in range." />
          ) : (
            <CashByWeekChart data={cashWeeks} />
          )}
        </ChartCard>
      </section>

      {/* SECTION 7 — Top projects by GP · Exception watch-list + AR/AP */}
      <section className="mb-3 grid gap-3 lg:grid-cols-2">
        <ChartCard title="Top projects by GP" data-testid="finance-home-top-gp">
          {figuresLoading ? (
            <FinanceLoading label="Loading…" />
          ) : topGp.length === 0 ? (
            <FinanceEmpty title="No project GP yet." />
          ) : (
            <TopProjectsGpChart data={topGp} onProjectClick={(id) => navigate(`/projects/${id}/finance`)} />
          )}
        </ChartCard>

        <ChartCard
          title="Exceptions · AR overdue + AP due"
          hint="Projects flagged by rule: negative GP, sub-5% margin, or app-vs-tracker drift."
          data-testid="finance-home-risk"
        >
          <div className="grid grid-cols-2 gap-3">
            <KpiTile
              label="AR overdue"
              value={arQuery.isLoading ? "…" : formatZar(arPastDue.amount)}
              tone="critical"
              supporting={`${arPastDue.count} invoices · 30+ days`}
            />
            <KpiTile
              label="AP due"
              value={apQuery.isLoading ? "…" : formatZar(apPastDue.amount)}
              tone="warning"
              supporting={`${apPastDue.count} bills · 30+ days`}
            />
          </div>
          <div className="mt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
              Exception watch-list
            </p>
            {figuresLoading ? (
              <FinanceLoading label="Loading…" />
            ) : (
              <ExceptionWatchList list={exceptions} onViewAll={() => setExceptionsExpanded(true)} />
            )}
          </div>
        </ChartCard>
      </section>

      {/* SECTION 8 — All projects (drift-first, searchable/sortable, drill on expand) */}
      <section aria-label="All projects" data-testid="finance-home-all-projects">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <GitCompare className="h-4 w-4 text-brand-green" />
            All projects
            <Badge variant="outline" className="text-[10px]">{allRows.length}</Badge>
          </h2>
          <div className="relative w-56 max-w-[60vw]">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects…"
              className="h-8 pl-7 text-xs"
              data-testid="finance-home-project-search"
            />
          </div>
        </div>

        {reconQuery.isLoading || linesQuery.isLoading ? (
          <FinanceLoading label="Loading projects…" />
        ) : reconQuery.isError ? (
          <FinanceError title="Could not load projects." onRetry={() => reconQuery.refetch()} />
        ) : filteredRows.length === 0 ? (
          <FinanceEmpty title="No projects match." />
        ) : (
          <DrillTable
            columns={allColumns}
            rows={filteredRows}
            rowKey={(r) => r.projectId}
            sortable
            defaultSort={{ key: "gp", dir: "desc" }}
            exportFilename={`finance-home-projects-${fyScope.label.replace(/\s+/g, "-")}`}
            maxBodyHeightClass="max-h-[60vh]"
            caption="All projects — realised revenue and GP"
            renderDetail={(r) => <ProjectDrillDetail projectId={r.projectId} fyWindowQs={fyWindowQs} />}
          />
        )}
      </section>

      <MonthDrillDrawer target={drill} fy={fyScope.fy} onClose={() => setDrill(null)} />
    </PageShell>
  );
}
