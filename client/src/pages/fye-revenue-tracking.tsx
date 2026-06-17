/**
 * FYE Tracking — Finance tab.
 *
 * Reproduces the "FY Project Tracking (EE - from trackers)" workbook from the
 * imported tracker data, brought in line with the rest of the compact finance
 * template (FinanceShell → FinancePageHeader → KpiRow → drill content), so it
 * looks and behaves like Revenue / COS / GP / Cashflow:
 *   • A headline KPI row (Budget Rev · Actual Rev · Actual COS · Actual GP) that
 *     answers "where is the FY landing?" before any table.
 *   • View A (Projects): the four recognition states (Realised / Committed /
 *     Planned / Unrealised) as stat cards + Budget vs Actual per project + a
 *     TOTAL strip + amber flags.
 *   • View B (Dashboard): Revenue / COS / GP, monthly + YTD-running, with three
 *     series — Revised Budget (manual, editable) / Actual / Plan-ahead — drawn
 *     with the shared ChartCard + brand palette.
 *
 * Everything except the Revised-Budget figures recomputes from the imported
 * tracker lines; "Refresh from import" re-pulls the latest snapshot. The FY shown
 * is always the one the server actually resolved (no hardcoded year), so the
 * header never disagrees with the data. Presentation only — no figure is
 * computed here.
 */

import React, { useMemo, useState } from "react";
import { FinanceShell } from "@/components/layout/FinanceShell";
import { FinancialYearScopeControl } from "@/components/finance/FinancialYearScopeControl";
import { useFinancialYearScope } from "@/hooks/use-financial-year-scope";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  FinancePageHeader,
  KpiRow,
  KpiTile,
  MoneyValue,
  StatusBadge,
  DrillTable,
  FinanceLoading,
  FinanceError,
  FinanceEmpty,
  type DrillColumn,
} from "@/components/finance/template";
import { ChartCard } from "@/components/finance/home/finance-home-charts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { fetchQueryFn, apiRequest } from "@/lib/queryClient";
import { formatZarCompact } from "@/lib/currency";
import { usePermission } from "@/hooks/use-permissions";
import { RefreshCw, BarChart3, Table2 } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// ── API types (mirror the server compute layer) ─────────────────────────────
type FyeFlag = "COS_NO_REVENUE" | "NON_STANDARD_TEMPLATE";
type FyeProjectType = "Active" | "Past" | "Compliance";

interface FyeProjectRow {
  projectId: number;
  project: string;
  type: FyeProjectType;
  startDate: string | null;
  endDatePc: string | null;
  budgetRevenue: number;
  budgetCos: number;
  budgetGp: number;
  budgetGpPct: number | null;
  actualRevenue: number;
  actualCos: number;
  actualGp: number;
  actualGpPct: number | null;
  pctRealised: number | null;
  flags: FyeFlag[];
  excludedFromTotals: boolean;
}
interface MoneyPair { revenue: number; cos: number; }
interface StateTotals {
  realised: MoneyPair; committed: MoneyPair; planned: MoneyPair; unrealised: MoneyPair; budget: MoneyPair;
}
interface AsAt { date: string; sourceFileName: string | null; committedAt: string | null; }
interface ProjectsResponse {
  fye: number; asAt: AsAt; rows: FyeProjectRow[]; totals: FyeProjectRow;
  stateTotals: StateTotals;
  excluded: Array<{ projectId: number; project: string; reason: string }>;
  projectCount: number;
}
interface SeriesRow { monthKey: string; label: string; revisedBudget: number | null; actual: number | null; planAhead: number | null; }
interface MetricBlockData { metric: "revenue" | "cos" | "gp"; monthly: SeriesRow[]; ytd: SeriesRow[]; }
interface DashboardResponse {
  fye: number; asAt: AsAt;
  dashboard: { monthKeys: string[]; lastClosedMonthKey: string | null; revenue: MetricBlockData; cos: MetricBlockData; gp: MetricBlockData; };
}

const PCT = (v: number | null): string => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const toM = (v: number | null): number | null => (v == null ? null : Math.round((v / 1_000_000) * 100) / 100);
const fmtM = (v: number | null): string => (v == null ? "—" : `R${toM(v)!.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}m`);
const fyLabel = (fye: number): string => `FY${String(fye).slice(-2)}`;

// Brand-aligned series colours — match the Finance Home charts so every finance
// surface plots the same idea in the same colour.
const SERIES = {
  budget: "#94A3B8", // slate — the management target / reference
  planAhead: "#F59E0B", // amber — forecast (committed + planned pipeline)
  actual: "#16A34A", // emerald — realised actuals
} as const;

// ─── View A — Projects ───────────────────────────────────────────────────────

// One recognition-state stat card (Realised / Committed / Planned / Unrealised).
const STATE_STYLE: Record<
  "realised" | "committed" | "planned" | "unrealised",
  { label: string; dot: string; accent: string; help: string }
> = {
  realised: { label: "Realised", dot: "bg-emerald-500", accent: "text-emerald-700", help: "Invoiced + confirmed" },
  committed: { label: "Committed", dot: "bg-amber-500", accent: "text-amber-700", help: "PO / order placed" },
  planned: { label: "Planned", dot: "bg-sky-500", accent: "text-sky-700", help: "Scheduled, not yet committed" },
  unrealised: { label: "Unrealised", dot: "bg-slate-400", accent: "text-slate-600", help: "Budget not yet actioned" },
};

function StateCard({ stateKey, pair }: { stateKey: keyof typeof STATE_STYLE; pair: MoneyPair }) {
  const s = STATE_STYLE[stateKey];
  const gp = pair.revenue - pair.cos;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3" data-testid={`fye-state-card-${stateKey}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} aria-hidden="true" />
        <span className="text-sm font-semibold text-slate-900">{s.label}</span>
      </div>
      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-400">{s.help}</p>
      <dl className="mt-2 space-y-1 text-xs">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-slate-500">Revenue</dt>
          <dd className={`tabular-nums font-semibold ${s.accent}`}><MoneyValue value={pair.revenue} align="left" /></dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-slate-500">COS</dt>
          <dd className="tabular-nums text-slate-700"><MoneyValue value={pair.cos} align="left" /></dd>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1">
          <dt className="text-slate-500">GP</dt>
          <dd className="tabular-nums font-semibold text-slate-900"><MoneyValue value={gp} align="left" /></dd>
        </div>
      </dl>
    </div>
  );
}

function ProjectsView({ apiQueryString }: { apiQueryString: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery<ProjectsResponse>({
    queryKey: [`/api/fye-revenue-tracking/projects?${apiQueryString}`],
    queryFn: fetchQueryFn(`/api/fye-revenue-tracking/projects?${apiQueryString}`),
  });
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | FyeProjectType>("all");

  const rows = useMemo(() => {
    let r = data?.rows ?? [];
    if (filter.trim()) r = r.filter((x) => x.project.toLowerCase().includes(filter.trim().toLowerCase()));
    if (typeFilter !== "all") r = r.filter((x) => x.type === typeFilter);
    return r;
  }, [data, filter, typeFilter]);

  if (isLoading) return <FinanceLoading label="Loading project tracking…" />;
  if (isError) return <FinanceError hint={(error as Error)?.message} onRetry={() => void refetch()} />;
  if (!data) return null;

  const st = data.stateTotals;
  const t = data.totals;

  // Projects table columns. Row-level COS_NO_REVENUE / NON_STANDARD_TEMPLATE
  // styling is reapplied per-cell (the Project cell carries the flag classes).
  const rowAmber = (r: FyeProjectRow) => r.flags.includes("COS_NO_REVENUE");
  const rowNonStd = (r: FyeProjectRow) => r.flags.includes("NON_STANDARD_TEMPLATE");
  const projectColumns: DrillColumn<FyeProjectRow>[] = [
    {
      key: "project",
      header: "Project",
      cell: (r) => (
        <span
          className={`font-medium ${rowAmber(r) ? "text-amber-700" : ""} ${rowNonStd(r) ? "opacity-70 italic" : ""}`}
          data-testid={`fye-project-row-${r.projectId}`}
        >
          {r.project}
        </span>
      ),
      sortValue: (r) => r.project,
    },
    { key: "type", header: "Type", cell: (r) => r.type, sortValue: (r) => r.type },
    { key: "start", header: "Start", cell: (r) => <span className="whitespace-nowrap">{r.startDate ?? "—"}</span>, sortValue: (r) => r.startDate },
    { key: "endPc", header: "End (PC)", cell: (r) => <span className="whitespace-nowrap">{r.endDatePc ?? "—"}</span>, sortValue: (r) => r.endDatePc },
    { key: "budgetRevenue", header: "Budget Rev", numeric: true, cell: (r) => <MoneyValue value={r.budgetRevenue} />, sortValue: (r) => r.budgetRevenue },
    { key: "budgetCos", header: "Budget COS", numeric: true, cell: (r) => <MoneyValue value={r.budgetCos} />, sortValue: (r) => r.budgetCos },
    { key: "budgetGp", header: "Budget GP", numeric: true, cell: (r) => <MoneyValue value={r.budgetGp} />, sortValue: (r) => r.budgetGp },
    { key: "budgetGpPct", header: "Bud GP%", numeric: true, cell: (r) => PCT(r.budgetGpPct), sortValue: (r) => r.budgetGpPct, exportValue: (r) => PCT(r.budgetGpPct) },
    { key: "actualRevenue", header: "Actual Rev", numeric: true, cell: (r) => <MoneyValue value={r.actualRevenue} />, sortValue: (r) => r.actualRevenue },
    { key: "actualCos", header: "Actual COS", numeric: true, cell: (r) => <MoneyValue value={r.actualCos} />, sortValue: (r) => r.actualCos },
    { key: "actualGp", header: "Actual GP", numeric: true, cell: (r) => <MoneyValue value={r.actualGp} />, sortValue: (r) => r.actualGp },
    { key: "actualGpPct", header: "Act GP%", numeric: true, cell: (r) => PCT(r.actualGpPct), sortValue: (r) => r.actualGpPct, exportValue: (r) => PCT(r.actualGpPct) },
    { key: "pctRealised", header: "% Real.", numeric: true, cell: (r) => PCT(r.pctRealised), sortValue: (r) => r.pctRealised, exportValue: (r) => PCT(r.pctRealised) },
    {
      key: "flag",
      header: "Flag",
      sortable: false,
      cell: (r) => (
        <>
          {rowAmber(r) && <StatusBadge tone="warning" label="COS, no revenue — check tracker" />}
          {rowNonStd(r) && <StatusBadge tone="neutral" label="Non-standard template (excl. from totals)" />}
        </>
      ),
      exportValue: (r) => r.flags.join(" · "),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Four recognition states as stat cards (Realised / Committed / Planned / Unrealised). */}
      <section aria-label="Portfolio recognition states">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Portfolio recognition states · {fyLabel(data.fye)}</h2>
          <span className="text-[11px] text-slate-400">{data.projectCount} projects · {data.excluded.length} excluded</span>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StateCard stateKey="realised" pair={st.realised} />
          <StateCard stateKey="committed" pair={st.committed} />
          <StateCard stateKey="planned" pair={st.planned} />
          <StateCard stateKey="unrealised" pair={st.unrealised} />
        </div>
        {/* Budget (all states) — total strip. */}
        <div className="mt-2 flex flex-wrap items-center justify-end gap-x-5 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold tabular-nums">
          <span className="mr-auto text-slate-500">Budget · all states</span>
          <span>Rev <MoneyValue value={st.budget.revenue} align="left" /></span>
          <span>COS <MoneyValue value={st.budget.cos} align="left" /></span>
          <span>GP <MoneyValue value={st.budget.revenue - st.budget.cos} align="left" /></span>
        </div>
      </section>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Filter project…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-48" data-testid="fye-project-filter" />
        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
          <option value="all">All types</option><option value="Active">Active</option><option value="Past">Past</option><option value="Compliance">Compliance</option>
        </select>
        <span className="ml-auto text-[11px] text-slate-400">Click any column header to sort · Export for the full list</span>
      </div>

      {rows.length === 0 ? (
        <FinanceEmpty title="No projects match." hint="Clear the filter or widen the type selection." />
      ) : (
        <DrillTable
          columns={projectColumns}
          rows={rows}
          rowKey={(r) => r.projectId}
          sortable
          defaultSort={{ key: "budgetRevenue", dir: "desc" }}
          exportFilename={`fye-tracking-projects-${fyLabel(data.fye)}`}
          maxBodyHeightClass="max-h-[60vh]"
          caption="Budget vs actual revenue / COS / GP per project."
        />
      )}

      {/* TOTAL — bold strip after the table (DrillTable has no footer). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold tabular-nums">
        <span className="mr-auto">TOTAL ({data.projectCount} projects)</span>
        <span>Budget Rev <MoneyValue value={t.budgetRevenue} align="left" /></span>
        <span>Budget COS <MoneyValue value={t.budgetCos} align="left" /></span>
        <span>Budget GP <MoneyValue value={t.budgetGp} align="left" /></span>
        <span>Bud GP% {PCT(t.budgetGpPct)}</span>
        <span>Actual Rev <MoneyValue value={t.actualRevenue} align="left" /></span>
        <span>Actual COS <MoneyValue value={t.actualCos} align="left" /></span>
        <span>Actual GP <MoneyValue value={t.actualGp} align="left" /></span>
        <span>Act GP% {PCT(t.actualGpPct)}</span>
        <span>% Real. {PCT(t.pctRealised)}</span>
      </div>

      {data.excluded.length > 0 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">Excluded / de-duplicated trackers ({data.excluded.length})</summary>
          <ul className="mt-2 space-y-1 pl-4 list-disc">
            {data.excluded.map((e) => <li key={`${e.projectId}-${e.project}`}><span className="font-medium">{e.project}</span> — {e.reason}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

// ─── View B — Dashboard ──────────────────────────────────────────────────────
const METRIC_LABEL: Record<string, string> = { revenue: "Revenue", cos: "COS", gp: "GP" };

function RevisedBudgetCell({ fye, metric, monthKey, value, canEdit }: { fye: number; metric: string; monthKey: string; value: number | null; canEdit: boolean; }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));
  React.useEffect(() => { setDraft(value == null ? "" : String(value)); }, [value]);
  const mut = useApiMutation<unknown, unknown, string>({
    mutationFn: (amount: string) => apiRequest("PUT", "/api/fye-revenue-tracking/revised-budget", { fye, metric, monthKey, amount }),
    successToast: "Revised budget updated",
    onSuccess: () => { void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").includes("/api/fye-revenue-tracking/dashboard") }); },
  });
  if (!canEdit) return <span className="font-mono">{fmtM(value)}</span>;
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { const n = Number(draft); if (Number.isFinite(n) && String(n) !== String(value ?? "")) mut.mutate(String(n)); }}
      className="h-6 w-24 text-right font-mono text-[11px] px-1"
      data-testid={`fye-revised-${metric}-${monthKey}`}
    />
  );
}

function MetricBlock({ fye, block, canEdit }: { fye: number; block: MetricBlockData; canEdit: boolean }) {
  const chartData = useMemo(
    () => block.ytd.map((r) => ({ label: r.label, "Revised Budget": toM(r.revisedBudget), Actual: toM(r.actual), "Plan ahead": toM(r.planAhead) })),
    [block.ytd],
  );
  return (
    <ChartCard
      title={`${METRIC_LABEL[block.metric]} — monthly, YTD & trend`}
      hint="R millions · Revised Budget (target) vs Actual vs Plan-ahead (forecast to year-end)"
      data-testid={`fye-metric-${block.metric}`}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} />
            <YAxis tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v: number) => `${v}m`} />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", boxShadow: "0 4px 16px rgba(0,0,0,0.08)", fontSize: 12, padding: "6px 10px" }}
              formatter={(value) => `R${Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}m`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="Revised Budget" stroke={SERIES.budget} strokeWidth={1.5} dot={false} connectNulls />
            <Line type="monotone" dataKey="Plan ahead" stroke={SERIES.planAhead} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />
            <Line type="monotone" dataKey="Actual" stroke={SERIES.actual} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="border-b text-slate-400">
            <tr><th className="sticky left-0 bg-white px-1 py-1 text-left font-medium">Series \ Month</th>{block.monthly.map((m) => <th key={m.monthKey} className="whitespace-nowrap px-1 py-1 text-right font-medium">{m.label}</th>)}</tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="sticky left-0 bg-white px-1 py-1 font-medium text-slate-500">Revised Budget</td>
              {block.monthly.map((m) => <td key={m.monthKey} className="px-1 py-0.5 text-right"><RevisedBudgetCell fye={fye} metric={block.metric} monthKey={m.monthKey} value={m.revisedBudget} canEdit={canEdit} /></td>)}
            </tr>
            <tr className="border-b border-slate-100">
              <td className="sticky left-0 bg-white px-1 py-1 font-semibold text-emerald-700">Actual</td>
              {block.monthly.map((m) => <td key={m.monthKey} className="px-1 py-1 text-right font-mono">{fmtM(m.actual)}</td>)}
            </tr>
            <tr>
              <td className="sticky left-0 bg-white px-1 py-1 font-medium text-amber-600">Plan ahead</td>
              {block.monthly.map((m) => <td key={m.monthKey} className="px-1 py-1 text-right font-mono">{fmtM(m.planAhead)}</td>)}
            </tr>
            <tr className="border-t-2 text-slate-400">
              <td className="sticky left-0 bg-white px-1 py-1 italic">Actual YTD</td>
              {block.ytd.map((m) => <td key={m.monthKey} className="px-1 py-1 text-right font-mono">{fmtM(m.actual)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

function DashboardView({ apiQueryString, canEdit }: { apiQueryString: string; canEdit: boolean }) {
  // "" = Auto (server clamps Actual to the last closed month). A chosen month
  // overrides how far the Actual line runs (passed through as ?actualThrough).
  const [actualThrough, setActualThrough] = useState<string>("");
  const qs = actualThrough ? `${apiQueryString}&actualThrough=${actualThrough}` : apiQueryString;
  const { data, isLoading, isError, error, refetch } = useQuery<DashboardResponse>({
    queryKey: [`/api/fye-revenue-tracking/dashboard?${qs}`],
    queryFn: fetchQueryFn(`/api/fye-revenue-tracking/dashboard?${qs}`),
  });
  if (isLoading) return <FinanceLoading label="Loading dashboard…" />;
  if (isError) return <FinanceError hint={(error as Error)?.message} onRetry={() => void refetch()} />;
  if (!data) return null;
  const d = data.dashboard;
  const monthOptions = d.revenue.monthly.map((m) => ({ monthKey: m.monthKey, label: m.label }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-xs text-slate-500">
          Actuals close to <span className="font-medium text-slate-700">{d.lastClosedMonthKey ?? "—"}</span>; Plan-ahead continues with the committed + planned pipeline to year-end. Revised Budget is manual and editable.
        </p>
        <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-500">
          Actuals through
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={actualThrough}
            onChange={(e) => setActualThrough(e.target.value)}
            data-testid="fye-actual-through"
          >
            <option value="">Auto (last closed)</option>
            {monthOptions.map((m) => (
              <option key={m.monthKey} value={m.monthKey}>{m.label}</option>
            ))}
          </select>
        </label>
      </div>
      <MetricBlock fye={data.fye} block={d.revenue} canEdit={canEdit} />
      <MetricBlock fye={data.fye} block={d.cos} canEdit={canEdit} />
      <MetricBlock fye={data.fye} block={d.gp} canEdit={canEdit} />
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function FyeRevenueTrackingPage() {
  const fyScope = useFinancialYearScope();
  const qc = useQueryClient();
  const canEdit = usePermission("fye_revenue_tracking", "edit").allowed;
  const [tab, setTab] = useState("projects");

  // Page-level projects read — feeds both the "as at" banner and the headline
  // KPI row. Same query key as ProjectsView, so React Query dedupes the fetch.
  const { data: meta } = useQuery<ProjectsResponse>({
    queryKey: [`/api/fye-revenue-tracking/projects?${fyScope.apiQueryString}`],
    queryFn: fetchQueryFn(`/api/fye-revenue-tracking/projects?${fyScope.apiQueryString}`),
  });

  // The FY actually resolved by the server (the page is single-FY by nature, so
  // "All data" resolves to a concrete year — show that, never a hardcoded label).
  const shownFy = meta ? fyLabel(meta.fye) : fyScope.label;
  const t = meta?.totals;
  const revVsBudgetPct = t && t.budgetRevenue > 0 ? Math.round((t.actualRevenue / t.budgetRevenue) * 100) : null;

  const refresh = () => { void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").includes("/api/fye-revenue-tracking") }); };

  return (
    <FinanceShell>
      <FinancePageHeader
        title={`FYE Tracking · ${shownFy}`}
        question="Budget vs actual and the Revenue / COS / GP dashboard, reproduced line-for-line from your imported trackers."
        period={<FinancialYearScopeControl scope={fyScope} />}
        source={meta?.asAt ? <>As at <span className="font-medium">{meta.asAt.date}</span></> : undefined}
        asOf={
          meta?.asAt?.sourceFileName
            ? <>last import <span className="font-mono">{meta.asAt.sourceFileName}</span></>
            : undefined
        }
        actions={
          <Button size="sm" variant="outline" onClick={refresh} className="gap-1.5" data-testid="fye-refresh">
            <RefreshCw className="h-3.5 w-3.5" />Refresh from import
          </Button>
        }
      />

      {/* Headline KPI row — answers first, exactly like Revenue / COS / GP. */}
      <KpiRow>
        <KpiTile
          data-testid="fye-kpi-budget-revenue"
          label="Budget Revenue"
          description={`${shownFy} · all projects`}
          value={t ? <MoneyValue value={t.budgetRevenue} align="left" /> : "…"}
        />
        <KpiTile
          data-testid="fye-kpi-actual-revenue"
          label="Actual Revenue"
          description={`${shownFy} · recognised`}
          value={t ? <MoneyValue value={t.actualRevenue} align="left" /> : "…"}
          tone="positive"
          progress={revVsBudgetPct != null ? { pct: revVsBudgetPct, tone: "positive" } : undefined}
          supporting={
            t
              ? revVsBudgetPct != null
                ? `${revVsBudgetPct}% of budget · ${PCT(t.pctRealised)} realised`
                : `${PCT(t.pctRealised)} realised`
              : undefined
          }
        />
        <KpiTile
          data-testid="fye-kpi-actual-cos"
          label="Actual COS"
          description={`${shownFy} · recognised`}
          value={t ? <MoneyValue value={t.actualCos} align="left" /> : "…"}
          supporting={t ? `vs budget ${formatZarCompact(t.budgetCos)}` : undefined}
        />
        <KpiTile
          data-testid="fye-kpi-actual-gp"
          label="Actual GP"
          description={`${shownFy} · recognised`}
          value={t ? <MoneyValue value={t.actualGp} align="left" /> : "…"}
          tone={t && t.actualGp >= 0 ? "positive" : "critical"}
          supporting={t ? (t.actualGpPct != null ? `Margin ${PCT(t.actualGpPct)}` : "No realised revenue yet") : undefined}
        />
      </KpiRow>

      {/* Reconciliation note — ties these figures to the other finance tabs so a
          reader never mistakes the curated-portfolio total for a disagreement. */}
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400" data-testid="fye-reconciliation-note">
        <span className="font-medium text-slate-500">Actual = Realised</span> — the same line-for-line
        figure the Revenue, COS and GP tabs show (one canonical source; they reconcile to the cent).
        Totals are the curated FY portfolio
        {meta && meta.excluded.length > 0
          ? `: ${meta.excluded.length} tracker${meta.excluded.length === 1 ? "" : "s"} excluded (archived / duplicate / non-standard) — see Projects.`
          : "."}
      </p>

      <div className="mt-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="projects" className="gap-1.5" data-testid="tab-fye-projects"><Table2 className="h-4 w-4" />Projects</TabsTrigger>
            <TabsTrigger value="dashboard" className="gap-1.5" data-testid="tab-fye-dashboard"><BarChart3 className="h-4 w-4" />Dashboard</TabsTrigger>
          </TabsList>
          <TabsContent value="projects" className="mt-3"><ProjectsView apiQueryString={fyScope.apiQueryString} /></TabsContent>
          <TabsContent value="dashboard" className="mt-3"><DashboardView apiQueryString={fyScope.apiQueryString} canEdit={canEdit} /></TabsContent>
        </Tabs>
      </div>
    </FinanceShell>
  );
}
