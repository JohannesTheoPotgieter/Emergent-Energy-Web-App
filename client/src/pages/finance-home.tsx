/**
 * Finance Home — the accountant's dashboard.
 *
 * A pure READER. Every figure on this page comes from the canonical tracker
 * read path (the §3.3 single source of truth), reshaped for display but NEVER
 * recalculated here:
 *
 *   GET /api/revenue-tracker?fy   — REV by month: budget / planned / realised
 *   GET /api/cos-tracker?fy       — COS realised by month (+ budget)
 *   GET /api/weekly-cashflow?fy   — cash in/out + available, by week
 *   GET /api/finance/lines        — canonical §3.3 REV/GP per project
 *   GET /api/finance/reconciliation — per-project app-vs-tracker trust posture
 *   GET /api/weekly-cashflow/{receivables,payables} — AR overdue / AP due
 *   GET /api/finance/drill/{invoices} & /reconciliation/:id — drill to a cell
 *
 * FORBIDDEN here (and proven absent by qa/tests/unit/finance-home-canonical):
 * the pre-summarised per-project revenue rollup, the company-wide whole-life
 * plan, and the bookkeeping-system reconciliation tile (kept on its own page).
 *
 * GP = Revenue − COS via the locked gp-summary helper — the identical
 * derivation the GP page uses, so Home never shows a figure the finance pages
 * don't. Brand: centralised tokens + shared finance template components only.
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
  fyRealisedCos,
  fyRevenueTotals,
  gpMarginSeries,
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
  type CosTrackerMonthRow,
  type FinanceLinesResponse,
  type ProjectGpRow,
  type ProjectLineRollup,
  type ReconPortfolioResponse,
  type RevTrackerResponse,
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
  const revQuery = useQuery<RevTrackerResponse>({
    queryKey: ["/api/revenue-tracker", qs],
    queryFn: fetchQueryFn(`/api/revenue-tracker?${qs}`),
    staleTime: 60_000,
  });
  const cosQuery = useQuery<CosTrackerMonthRow[]>({
    queryKey: ["/api/cos-tracker", qs],
    queryFn: fetchQueryFn(`/api/cos-tracker?${qs}`),
    staleTime: 60_000,
  });
  const cashQuery = useQuery<CashflowResponse>({
    queryKey: ["/api/weekly-cashflow", qs],
    queryFn: fetchQueryFn(`/api/weekly-cashflow?${qs}`),
    staleTime: 60_000,
  });
  const linesQuery = useQuery<FinanceLinesResponse>({
    queryKey: ["/api/finance/lines", fyWindowQs],
    queryFn: fetchQueryFn(`/api/finance/lines${fyWindowQs}`),
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
  // Freshness: most recent committed import (best-effort — never blocks the page).
  const importHealthQuery = useQuery<ImportHealthRow[]>({
    queryKey: ["/api/smart-import/health-dashboard"],
    queryFn: fetchQueryFn("/api/smart-import/health-dashboard", { on401: "returnNull" }),
    staleTime: 5 * 60_000,
    retry: false,
  });

  // ── Derived (grouping/sorting only — no figure recalculated) ────────────────
  const revMonths = useMemo(() => revQuery.data?.months ?? [], [revQuery.data]);
  const cosMonths = useMemo(() => cosQuery.data ?? [], [cosQuery.data]);
  const weeks = useMemo(() => cashQuery.data?.weeks ?? [], [cashQuery.data]);
  const byProject = useMemo<ProjectLineRollup[]>(() => linesQuery.data?.byProject ?? [], [linesQuery.data]);
  const reconProjects = useMemo(() => reconQuery.data?.projects ?? [], [reconQuery.data]);

  const revTotals = useMemo(() => fyRevenueTotals(revMonths), [revMonths]);
  const realisedCos = useMemo(() => fyRealisedCos(cosMonths), [cosMonths]);
  const realisedRevenue = revTotals.realisedFytd;
  const realisedGp = realisedRevenue - realisedCos;
  const marginPct = realisedRevenue !== 0 ? (realisedGp / realisedRevenue) * 100 : null;
  const budgetFy = revTotals.budgetFy;
  const revVsTargetPct = budgetFy !== 0 ? Math.round((realisedRevenue / budgetFy) * 100) : 0;

  const monthStates = useMemo(() => monthStatesSeries(revMonths), [revMonths]);
  const onTrack = useMemo(() => onTrackSeries(revMonths), [revMonths]);
  const onTrackGapValue = useMemo(() => onTrackGap(onTrack, currentYyyyMm), [onTrack]);
  const gpMonths = useMemo(() => gpMarginSeries(cosMonths, revMonths), [cosMonths, revMonths]);
  const cashWeeks = useMemo(() => cashByWeekSeries(weeks), [weeks]);

  const nameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of reconProjects) m.set(p.projectId, p.projectName);
    return m;
  }, [reconProjects]);
  const idByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of reconProjects) m.set(p.projectName, p.projectId);
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
        revenue: m?.revenue ?? 0,
        gp: m?.gp ?? 0,
        gpPct: m?.gpPct ?? null,
        tie: tieState(p.status, p.trackerBaselinePresent),
        absDelta: p.absDelta,
      };
    });
  }, [reconProjects, byProject]);

  const sortedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? allRows.filter((r) => r.projectName.toLowerCase().includes(q))
      : allRows;
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
          // Drift-first by default, then by drift magnitude.
          return (
            dir * (TIE_RANK[a.tie] - TIE_RANK[b.tie]) || b.absDelta - a.absDelta
          );
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
  const openMonth = (monthKey: string) => {
    const m = revMonths.find((x) => x.monthKey === monthKey);
    if (!m) return;
    setDrill({ monthKey: m.monthKey, monthLabel: m.monthLabel, projects: m.realisedProjects ?? [] });
  };

  const subtitle = `${fyScope.label} · every figure from your trackers, line-for-line${asOf ? ` · as at ${asOf}` : ""}`;
  const asAtTag = "FYTD · incl. open month";
  const trustReady = !reconQuery.isLoading && !reconQuery.isError;

  return (
    <PageShell data-testid="finance-home-page">
      <FinancePageHeader
        data-testid="finance-home-header"
        title="Finance Home"
        question={subtitle}
        source="Canonical trackers · ex-VAT"
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

      {/* KPI ROW — the four headline answers (FYTD, incl. open month) */}
      <section className="mb-3" aria-label="Headline finance figures">
        <KpiRow>
          <KpiTile
            data-testid="finance-home-kpi-revenue"
            label="Revenue recognised"
            description={asAtTag}
            value={revQuery.isLoading ? "…" : <MoneyValue value={realisedRevenue} align="left" />}
            tone="positive"
            progress={budgetFy !== 0 ? { pct: revVsTargetPct, tone: "positive" } : undefined}
            supporting={
              <span className="inline-flex items-center gap-1.5">
                <span>
                  vs FY budget {formatZarCompact(budgetFy)} · {revVsTargetPct}%
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
            value={cosQuery.isLoading ? "…" : <MoneyValue value={realisedCos} align="left" />}
            tone="default"
            supporting="Realised COS, line-for-line"
            sourceBadge={trustReady ? <TrustBadge status={trustBadge} /> : undefined}
            href="/cos"
          />

          <KpiTile
            data-testid="finance-home-kpi-gp"
            label="Gross profit"
            description={asAtTag}
            value={cosQuery.isLoading || revQuery.isLoading ? "…" : <MoneyValue value={realisedGp} align="left" />}
            tone={realisedGp >= 0 ? "positive" : "critical"}
            supporting={marginPct != null ? `Margin ${marginPct.toFixed(1)}%` : "No realised revenue yet"}
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
          hint="From the revenue tracker, by invoice-raised month. Click a month to drill in."
          data-testid="finance-home-revenue-states"
        >
          {revQuery.isLoading ? (
            <FinanceLoading label="Loading revenue…" />
          ) : revQuery.isError ? (
            <FinanceError title="Could not load revenue." onRetry={() => revQuery.refetch()} />
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
          {revQuery.isLoading ? (
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
          {cosQuery.isLoading || revQuery.isLoading ? (
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
          {linesQuery.isLoading ? (
            <FinanceLoading label="Loading…" />
          ) : topGp.length === 0 ? (
            <FinanceEmpty title="No project GP yet." />
          ) : (
            <TopProjectsGpChart
              data={topGp}
              onProjectClick={(id) => navigate(`/projects/${id}/finance`)}
            />
          )}
        </ChartCard>

        <ChartCard title="Weakest margins · AR overdue + AP due" data-testid="finance-home-risk">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border border-slate-200 p-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-600">AR overdue</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                {arQuery.isLoading ? "…" : formatZar(arQuery.data?.buckets.total.amount ?? 0)}
              </p>
              <p className="text-[11px] text-slate-400">
                {arQuery.data?.buckets.total.count ?? 0} invoices
              </p>
            </div>
            <div className="rounded-md border border-slate-200 p-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">AP due</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                {apQuery.isLoading ? "…" : formatZar(apQuery.data?.buckets.total.amount ?? 0)}
              </p>
              <p className="text-[11px] text-slate-400">
                {apQuery.data?.buckets.total.count ?? 0} bills
              </p>
            </div>
          </div>
          <div className="mt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
              Weakest margins
            </p>
            {linesQuery.isLoading ? (
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
                      className={`tabular-nums font-medium ${
                        (p.gpPct ?? 0) < 0 ? "text-rose-600" : "text-slate-700"
                      }`}
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
            caption="All projects — revenue, GP and tracker tie status"
            renderDetail={(r) => <ProjectDrillDetail projectId={r.projectId} />}
          />
        )}
      </section>

      <MonthDrillDrawer
        target={drill}
        fy={fyScope.fy}
        nameById={idByName}
        onClose={() => setDrill(null)}
      />
    </PageShell>
  );
}
