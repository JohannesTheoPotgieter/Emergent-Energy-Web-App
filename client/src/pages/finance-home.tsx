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
 *   GET /api/finance/lines?fyStart&fyEnd  — REV/COS/GP per project + per month
 *                                            (realised / planned) + manual budget
 *   GET /api/finance/drill/{tree,invoices} — drill to the tracker source cell
 *   GET /api/weekly-cashflow?fy            — cash in/out + available, by week
 *   GET /api/finance/reconciliation        — per-project app-vs-tracker trust
 *   GET /api/weekly-cashflow/{receivables,payables} — AR overdue / AP due
 *   GET /api/smart-import/health-dashboard — "as at" last-import freshness
 *
 * FORBIDDEN here (and proven absent by qa/tests/unit/finance-home-canonical):
 * the pre-summarised per-project revenue rollup, the company-wide whole-life
 * plan, the per-month tracker aggregate endpoints, and the bookkeeping-system
 * reconciliation tile (kept on its own page).
 *
 * Brand: centralised tokens + shared finance template components only.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ArrowRight, GitCompare, Search } from "lucide-react";

import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  FinancePageHeader,
  KpiRow,
  KpiTile,
  TrustBadge,
  MoneyValue,
  StatusBadge,
  type StatusTone,
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
} from "@/components/finance/home/finance-home-charts";
import { MonthDrillDrawer, type MonthDrillTarget } from "@/components/finance/home/month-drill-drawer";
import { ProjectDrillDetail } from "@/components/finance/home/project-drill-detail";
import { fetchQueryFn } from "@/lib/queryClient";
import { formatZar, formatZarCompact } from "@/lib/currency";
import { useFinancialYearScope } from "@/hooks/use-financial-year-scope";
import {
  cashByWeekSeries,
  fyHeadline,
  fyMonthFrame,
  gpMarginSeries,
  monthLabelFromKey,
  monthStatesSeries,
  onTrackGap,
  onTrackSeries,
  summariseTrust,
  tieState,
  topProjectsByGp,
  weakestMargins,
  weekLabel,
  type AgedWorklist,
  type CashflowResponse,
  type FinanceLinesResponse,
  type ProjectGpRow,
  type ReconPortfolioResponse,
  type TieState,
} from "@/lib/finance/home-data";

const todayIso = new Date().toISOString().slice(0, 10);
const currentYyyyMm = todayIso.slice(0, 7);

interface ImportHealthRow {
  lastImportDate: string | null;
}

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

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


// Trust posture → shared status chip.
const TIE_CHIP: Record<TieState, { tone: StatusTone; label: string }> = {
  tie: { tone: "ties", label: "Ties" },
  drift: { tone: "warning", label: "Drift" },
  not_compared: { tone: "neutral", label: "Not compared yet" },
};
const TIE_RANK: Record<TieState, number> = { drift: 0, not_compared: 1, tie: 2 };

interface AllProjectRow {
  projectId: number;
  projectName: string;
  revenue: number;
  gp: number;
  gpPct: number | null;
  tie: TieState;
  absDelta: number;
}

type SortKey = "tie" | "project" | "revenue" | "gp" | "gpPct";

export default function FinanceHomePage() {
  const [, navigate] = useLocation();
  const fyScope = useFinancialYearScope();
  const qs = fyScope.apiQueryString;
  const fyWindowQs =
    fyScope.startDate && fyScope.endDate
      ? `?fyStart=${fyScope.startDate}&fyEnd=${fyScope.endDate}`
      : "";

  // ── Canonical reads ────────────────────────────────────────────────────────
  // ONE source for REV/COS/GP: the §3.3 single read path. byProject + monthly +
  // total + budgetByMonth all come from this single response.
  const linesQuery = useQuery<FinanceLinesResponse>({
    queryKey: ["/api/finance/lines", fyWindowQs],
    queryFn: fetchQueryFn(`/api/finance/lines${fyWindowQs}`),
    staleTime: 60_000,
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

  const frame = useMemo(
    () => fyMonthFrame(monthly, budgetByMonth, fyScope.startMonthKey, fyScope.endMonthKey),
    [monthly, budgetByMonth, fyScope.startMonthKey, fyScope.endMonthKey],
  );

  const headline = useMemo(
    () => fyHeadline(linesData?.total, budgetByMonth, frame),
    [linesData, budgetByMonth, frame],
  );
  const revVsTargetPct =
    headline.budgetRevenueFy !== 0
      ? Math.round((headline.realisedRevenue / headline.budgetRevenueFy) * 100)
      : 0;

  const monthStates = useMemo(
    () => monthStatesSeries(monthly, budgetByMonth, frame),
    [monthly, budgetByMonth, frame],
  );
  const onTrack = useMemo(
    () => onTrackSeries(monthly, budgetByMonth, frame),
    [monthly, budgetByMonth, frame],
  );
  const onTrackGapValue = useMemo(() => onTrackGap(onTrack, currentYyyyMm), [onTrack]);
  const gpMonths = useMemo(() => gpMarginSeries(monthly, frame), [monthly, frame]);
  const cashWeeks = useMemo(() => cashByWeekSeries(weeks), [weeks]);

  const nameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of reconProjects) m.set(p.projectId, p.projectName);
    return m;
  }, [reconProjects]);

  const topGp = useMemo<ProjectGpRow[]>(
    () => topProjectsByGp(byProject, nameById),
    [byProject, nameById],
  );
  const weakMargins = useMemo<ProjectGpRow[]>(
    () => weakestMargins(byProject, nameById, 5),
    [byProject, nameById],
  );

  const trust = useMemo(() => summariseTrust(reconProjects), [reconProjects]);
  const trustBadge: "ties" | "drift" = trust.drift > 0 ? "drift" : "ties";

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

  // As-at: latest committed import date.
  const asOf = useMemo(() => {
    const dates = (importHealthQuery.data ?? [])
      .map((r) => r.lastImportDate)
      .filter((d): d is string => !!d)
      .sort();
    return fmtDate(dates[dates.length - 1] ?? null);
  }, [importHealthQuery.data]);

  // ── All-projects table ──────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("tie");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const allRows = useMemo<AllProjectRow[]>(() => {
    const metricsById = new Map(byProject.map((p) => [p.projectId, p]));
    return reconProjects.map((p) => {
      const m = metricsById.get(p.projectId);
      return {
        projectId: p.projectId,
        projectName: p.projectName,
        // Realised basis — sums to the realised KPI headline.
        revenue: m?.realisedRevenue ?? 0,
        gp: m?.realisedGp ?? 0,
        gpPct: m?.realisedGpPct != null ? m.realisedGpPct * 100 : null,
        tie: tieState(p.status, p.trackerBaselinePresent),
        absDelta: p.absDelta,
      };
    });
  }, [reconProjects, byProject]);

  const sortedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? allRows.filter((r) => r.projectName.toLowerCase().includes(q)) : allRows;
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: AllProjectRow, b: AllProjectRow): number => {
      switch (sortKey) {
        case "project":
          return dir * a.projectName.localeCompare(b.projectName);
        case "revenue":
          return dir * (a.revenue - b.revenue);
        case "gp":
          return dir * (a.gp - b.gp);
        case "gpPct":
          return dir * ((a.gpPct ?? -Infinity) - (b.gpPct ?? -Infinity));
        case "tie":
        default:
          return dir * (TIE_RANK[a.tie] - TIE_RANK[b.tie]) || b.absDelta - a.absDelta;
      }
    };
    return [...filtered].sort(cmp);
  }, [allRows, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "tie" || key === "project" ? "asc" : "desc");
    }
  };
  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  const allColumns: DrillColumn<AllProjectRow>[] = [
    {
      key: "project",
      header: <button type="button" onClick={() => toggleSort("project")}>Project{sortIndicator("project")}</button>,
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
      header: <button type="button" onClick={() => toggleSort("revenue")}>Revenue{sortIndicator("revenue")}</button>,
      numeric: true,
      widthClass: "w-32",
      cell: (r) => <MoneyValue value={r.revenue} />,
    },
    {
      key: "gp",
      header: <button type="button" onClick={() => toggleSort("gp")}>GP{sortIndicator("gp")}</button>,
      numeric: true,
      widthClass: "w-32",
      cell: (r) => <MoneyValue value={r.gp} />,
    },
    {
      key: "gpPct",
      header: <button type="button" onClick={() => toggleSort("gpPct")}>GP %{sortIndicator("gpPct")}</button>,
      numeric: true,
      widthClass: "w-20",
      hideBelowMd: true,
      cell: (r) => (
        <span className="tabular-nums text-slate-700">
          {r.gpPct != null ? `${r.gpPct.toFixed(1)}%` : "—"}
        </span>
      ),
    },
    {
      key: "tie",
      header: <button type="button" onClick={() => toggleSort("tie")}>Tie status{sortIndicator("tie")}</button>,
      align: "right",
      widthClass: "w-40",
      cell: (r) => <StatusBadge tone={TIE_CHIP[r.tie].tone} label={TIE_CHIP[r.tie].label} />,
    },
  ];

  // ── Month drill ─────────────────────────────────────────────────────────────
  const [drill, setDrill] = useState<MonthDrillTarget | null>(null);
  const openMonth = (monthKey: string) =>
    setDrill({ monthKey, monthLabel: monthLabelFromKey(monthKey) });

  const subtitle = `${fyScope.label} · every figure from your trackers, line-for-line${asOf ? ` · as at ${asOf}` : ""}`;
  const asAtTag = "FYTD · incl. open month";
  const trustReady = !reconQuery.isLoading && !reconQuery.isError;
  const figuresLoading = linesQuery.isLoading;

  return (
    <PageShell data-testid="finance-home-page">
      <FinancePageHeader
        data-testid="finance-home-header"
        title="Finance Home"
        question={subtitle}
        source="Canonical line-level ledger · ex-VAT"
        period={<FinancialYearScopeControl scope={fyScope} />}
      />

      {/* TRUST STRIP — "Match my trackers?" (app vs reproduced tracker, per project) */}
      <section
        className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
        aria-label="Tracker reconciliation posture"
        data-testid="finance-home-trust-strip"
      >
        <span className="text-sm font-semibold text-slate-700">Match my trackers?</span>
        {!trustReady ? (
          <span className="text-xs text-slate-400">{reconQuery.isError ? "reconciliation unavailable" : "checking…"}</span>
        ) : trust.tie + trust.drift + trust.notCompared === 0 ? (
          <span className="text-xs text-slate-400">No active projects.</span>
        ) : (
          <>
            <StatusBadge tone="ties" label={`${trust.tie} tie`} data-testid="finance-home-trust-tie" />
            <StatusBadge
              tone={trust.drift > 0 ? "warning" : "neutral"}
              label={`${trust.drift} drift`}
              data-testid="finance-home-trust-drift"
            />
            <StatusBadge
              tone="neutral"
              label={`${trust.notCompared} not compared yet`}
              data-testid="finance-home-trust-parked"
            />
          </>
        )}
        <Link
          href="/program/excel-vs-app"
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand-green hover:underline"
        >
          Reconciliation <ArrowRight className="h-3 w-3" />
        </Link>
      </section>

      {/* KPI ROW — the four headline answers (realised, FYTD incl. open month) */}
      <section className="mb-3" aria-label="Headline finance figures">
        <KpiRow>
          <KpiTile
            data-testid="finance-home-kpi-revenue"
            label="Revenue recognised"
            description={asAtTag}
            value={figuresLoading ? "…" : <MoneyValue value={headline.realisedRevenue} align="left" />}
            tone="positive"
            progress={headline.budgetRevenueFy !== 0 ? { pct: revVsTargetPct, tone: "positive" } : undefined}
            supporting={
              <span className="inline-flex items-center gap-1.5">
                <span>
                  vs FY budget {formatZarCompact(headline.budgetRevenueFy)} · {revVsTargetPct}%
                </span>
                <Badge
                  variant="outline"
                  className="text-[9px] border-status-drift/40 text-status-drift"
                  title="FY26 manual monthly budget — provisional until a board FY revenue target is set."
                >
                  Provisional
                </Badge>
              </span>
            }
            sourceBadge={trustReady ? <TrustBadge status={trustBadge} /> : undefined}
            href="/revenue-tracker"
          />

          <KpiTile
            data-testid="finance-home-kpi-cos"
            label="Cost of sales"
            description={asAtTag}
            value={figuresLoading ? "…" : <MoneyValue value={headline.realisedCos} align="left" />}
            tone="default"
            supporting="Realised COS, line-for-line"
            sourceBadge={trustReady ? <TrustBadge status={trustBadge} /> : undefined}
            href="/cos"
          />

          <KpiTile
            data-testid="finance-home-kpi-gp"
            label="Gross profit"
            description={asAtTag}
            value={figuresLoading ? "…" : <MoneyValue value={headline.realisedGp} align="left" />}
            tone={headline.realisedGp >= 0 ? "positive" : "critical"}
            supporting={headline.marginPct != null ? `Margin ${headline.marginPct.toFixed(1)}%` : "No realised revenue yet"}
            sourceBadge={trustReady ? <TrustBadge status={trustBadge} /> : undefined}
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
                    : "Opening + inflows − outflows"
            }
            href="/cashflow"
          />
        </KpiRow>
      </section>

      {/* SECTION 4 — Revenue by month: budget · planned · realised (click a month) */}
      <section className="mb-3">
        <ChartCard
          title="Revenue — budget · planned · realised, by month"
          hint="From the line-level ledger, by invoice-raised month. Click a month to drill in."
          data-testid="finance-home-revenue-states"
        >
          {figuresLoading ? (
            <FinanceLoading label="Loading revenue…" />
          ) : linesQuery.isError ? (
            <FinanceError title="Could not load revenue." onRetry={() => linesQuery.refetch()} />
          ) : monthStates.length === 0 ? (
            <FinanceEmpty title="No revenue in this FY." />
          ) : (
            <RevenueStatesChart data={monthStates} onMonthClick={openMonth} />
          )}
        </ChartCard>
      </section>

      {/* SECTION 5 — On track for the year? */}
      <section className="mb-3">
        <ChartCard
          title="On track for the year?"
          hint="Cumulative realised vs cumulative budget across the FY."
          action={
            onTrackGapValue != null ? (
              <Badge
                variant="outline"
                className={
                  onTrackGapValue >= 0
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-rose-200 bg-rose-50 text-rose-700"
                }
              >
                {onTrackGapValue >= 0 ? "Ahead" : "Behind"} {formatZarCompact(Math.abs(onTrackGapValue))}
              </Badge>
            ) : undefined
          }
          data-testid="finance-home-on-track"
        >
          {figuresLoading ? (
            <FinanceLoading label="Loading…" />
          ) : onTrack.length === 0 ? (
            <FinanceEmpty title="No revenue in this FY." />
          ) : (
            <OnTrackChart data={onTrack} />
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

      {/* SECTION 7 — Top projects by GP · Weakest margins / AR overdue + AP due */}
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

        <ChartCard title="Weakest margins · AR overdue + AP due" data-testid="finance-home-risk">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border border-slate-200 p-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-600">AR overdue</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                {arQuery.isLoading ? "…" : formatZar(arPastDue.amount)}
              </p>
              <p className="text-[11px] text-slate-400">{arPastDue.count} invoices · 30+ days</p>
            </div>
            <div className="rounded-md border border-slate-200 p-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">AP due</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                {apQuery.isLoading ? "…" : formatZar(apPastDue.amount)}
              </p>
              <p className="text-[11px] text-slate-400">{apPastDue.count} bills · 30+ days</p>
            </div>
          </div>
          <div className="mt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Weakest margins</p>
            {figuresLoading ? (
              <FinanceLoading label="Loading…" />
            ) : weakMargins.length === 0 ? (
              <p className="text-xs text-slate-400">No project margins yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {weakMargins.map((p) => (
                  <li key={p.projectId} className="flex items-center justify-between gap-2 py-1 text-sm">
                    <Link
                      href={`/projects/${p.projectId}/finance`}
                      className="truncate font-medium text-slate-700 hover:underline"
                    >
                      {p.projectName}
                    </Link>
                    <span
                      className={`tabular-nums font-medium ${(p.gpPct ?? 0) < 0 ? "text-rose-600" : "text-slate-700"}`}
                    >
                      {p.gpPct != null ? `${p.gpPct.toFixed(1)}%` : "—"}
                    </span>
                  </li>
                ))}
              </ul>
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
        ) : sortedRows.length === 0 ? (
          <FinanceEmpty title="No projects match." />
        ) : (
          <DrillTable
            columns={allColumns}
            rows={sortedRows}
            rowKey={(r) => r.projectId}
            maxBodyHeightClass="max-h-[60vh]"
            caption="All projects — realised revenue, GP and tracker tie status"
            renderDetail={(r) => <ProjectDrillDetail projectId={r.projectId} fyWindowQs={fyWindowQs} />}
          />
        )}
      </section>

      <MonthDrillDrawer target={drill} fy={fyScope.fy} onClose={() => setDrill(null)} />
    </PageShell>
  );
}
