/**
 * FYE Tracking — Finance tab.
 *
 * Reproduces the "FY26 Project Tracking (EE - from trackers)" workbook from the
 * imported tracker data:
 *   • View A (Projects): Budget vs Actual per project + a 4-state portfolio
 *     reconciliation (Realised / Committed / Planned / Unrealised) + amber
 *     flags + TOTAL row.
 *   • View B (Dashboard): Revenue / COS / GP, monthly + YTD-running, with three
 *     series — Revised Budget (manual, editable) / Actual / Plan-ahead.
 *
 * Everything except the Revised-Budget figures recomputes from the imported
 * tracker lines; "Refresh from import" re-pulls the latest snapshot.
 */

import React, { useMemo, useState } from "react";
import { FinanceShell } from "@/components/layout/FinanceShell";
import { FinancialYearScopeControl } from "@/components/finance/FinancialYearScopeControl";
import { useFinancialYearScope } from "@/hooks/use-financial-year-scope";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  FinancePageHeader,
  MoneyValue,
  StatusBadge,
  DrillTable,
  FinanceLoading,
  FinanceError,
  type DrillColumn,
} from "@/components/finance/template";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { fetchQueryFn, apiRequest } from "@/lib/queryClient";
import { usePermission } from "@/hooks/use-permissions";
import { RefreshCw, BarChart3, Table2, ArrowUpDown } from "lucide-react";
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

// ─── View A — Projects ───────────────────────────────────────────────────────
type SortKey = "project" | "type" | "budgetRevenue" | "actualRevenue" | "actualGpPct" | "pctRealised";

function ProjectsView({ apiQueryString }: { apiQueryString: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery<ProjectsResponse>({
    queryKey: [`/api/fye-revenue-tracking/projects?${apiQueryString}`],
    queryFn: fetchQueryFn(`/api/fye-revenue-tracking/projects?${apiQueryString}`),
  });
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | FyeProjectType>("all");
  const [sortKey, setSortKey] = useState<SortKey>("budgetRevenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => {
    let r = data?.rows ?? [];
    if (filter.trim()) r = r.filter((x) => x.project.toLowerCase().includes(filter.trim().toLowerCase()));
    if (typeFilter !== "all") r = r.filter((x) => x.type === typeFilter);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...r].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }, [data, filter, typeFilter, sortKey, sortDir]);

  if (isLoading) return <FinanceLoading />;
  if (isError) return <FinanceError hint={(error as Error)?.message} onRetry={() => void refetch()} />;
  if (!data) return null;

  const setSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "project" || k === "type" ? "asc" : "desc"); }
  };
  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <Button
      type="button"
      size="sm"
      variant={k === sortKey ? "default" : "outline"}
      className="h-7 gap-1 text-xs"
      onClick={() => setSort(k)}
    >
      {label}
      <ArrowUpDown className="h-3 w-3 opacity-60" />
      {k === sortKey && <span className="text-[10px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </Button>
  );
  const st = data.stateTotals;
  const t = data.totals;

  // 4-state portfolio reconciliation rows (Realised / Committed / Planned /
  // Unrealised) + the Budget (all states) row rendered as a bold strip below.
  type StateRow = { key: string; label: string; revenue: number; cos: number };
  const stateRows: StateRow[] = (["realised", "committed", "planned", "unrealised"] as const).map((s) => ({
    key: s, label: s, revenue: st[s].revenue, cos: st[s].cos,
  }));
  const stateColumns: DrillColumn<StateRow>[] = [
    { key: "state", header: "State", cell: (r) => <span className="capitalize">{r.label}</span> },
    { key: "revenue", header: "Revenue", numeric: true, cell: (r) => <MoneyValue value={r.revenue} /> },
    { key: "cos", header: "COS", numeric: true, cell: (r) => <MoneyValue value={r.cos} /> },
    { key: "gp", header: "GP", numeric: true, cell: (r) => <MoneyValue value={r.revenue - r.cos} /> },
  ];

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
    },
    { key: "type", header: "Type", cell: (r) => r.type },
    { key: "start", header: "Start", cell: (r) => <span className="whitespace-nowrap">{r.startDate ?? "—"}</span> },
    { key: "endPc", header: "End (PC)", cell: (r) => <span className="whitespace-nowrap">{r.endDatePc ?? "—"}</span> },
    { key: "budgetRevenue", header: "Budget Rev", numeric: true, cell: (r) => <MoneyValue value={r.budgetRevenue} /> },
    { key: "budgetCos", header: "Budget COS", numeric: true, cell: (r) => <MoneyValue value={r.budgetCos} /> },
    { key: "budgetGp", header: "Budget GP", numeric: true, cell: (r) => <MoneyValue value={r.budgetGp} /> },
    { key: "budgetGpPct", header: "Bud GP%", numeric: true, cell: (r) => PCT(r.budgetGpPct) },
    { key: "actualRevenue", header: "Actual Rev", numeric: true, cell: (r) => <MoneyValue value={r.actualRevenue} /> },
    { key: "actualCos", header: "Actual COS", numeric: true, cell: (r) => <MoneyValue value={r.actualCos} /> },
    { key: "actualGp", header: "Actual GP", numeric: true, cell: (r) => <MoneyValue value={r.actualGp} /> },
    { key: "actualGpPct", header: "Act GP%", numeric: true, cell: (r) => PCT(r.actualGpPct) },
    { key: "pctRealised", header: "% Real.", numeric: true, cell: (r) => PCT(r.pctRealised) },
    {
      key: "flag",
      header: "Flag",
      cell: (r) => (
        <>
          {rowAmber(r) && <StatusBadge tone="warning" label="COS, no revenue — check tracker" />}
          {rowNonStd(r) && <StatusBadge tone="neutral" label="Non-standard template (excl. from totals)" />}
        </>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* 4-state portfolio reconciliation */}
      <div>
        <h2 className="mb-2 text-sm font-semibold">Portfolio recognition states (FY{String(data.fye).slice(-2)})</h2>
        <DrillTable
          columns={stateColumns}
          rows={stateRows}
          rowKey={(r) => r.key}
          stickyHeader={false}
          caption="Portfolio revenue / COS / GP across the four recognition states."
        />
        {/* Budget (all states) — total strip (DrillTable has no footer). */}
        <div className="mt-1 flex flex-wrap items-center justify-end gap-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold">
          <span className="mr-auto">Budget (all states)</span>
          <span>Rev <MoneyValue value={st.budget.revenue} align="left" /></span>
          <span>COS <MoneyValue value={st.budget.cos} align="left" /></span>
          <span>GP <MoneyValue value={st.budget.revenue - st.budget.cos} align="left" /></span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Filter project…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-48" data-testid="fye-project-filter" />
        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
          <option value="all">All types</option><option value="Active">Active</option><option value="Past">Past</option><option value="Compliance">Compliance</option>
        </select>
        <span className="text-xs text-muted-foreground">{data.projectCount} projects · {data.excluded.length} excluded</span>
        <span className="ml-auto inline-flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Sort</span>
          <SortBtn k="project" label="Project" />
          <SortBtn k="type" label="Type" />
          <SortBtn k="budgetRevenue" label="Budget Rev" />
          <SortBtn k="actualRevenue" label="Actual Rev" />
          <SortBtn k="actualGpPct" label="Act GP%" />
          <SortBtn k="pctRealised" label="% Real." />
        </span>
      </div>

      <DrillTable
        columns={projectColumns}
        rows={rows}
        rowKey={(r) => r.projectId}
        maxBodyHeightClass="max-h-[60vh]"
        caption="Budget vs actual revenue / COS / GP per project."
      />

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
        <details className="text-xs text-muted-foreground">
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
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{METRIC_LABEL[block.metric]} — monthly, YTD & trend (R millions)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}m`} />
              <Tooltip formatter={(value) => `R${Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}m`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Revised Budget" stroke="#f97316" strokeWidth={1.5} dot={false} connectNulls />
              <Line type="monotone" dataKey="Plan ahead" stroke="#2563eb" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />
              <Line type="monotone" dataKey="Actual" stroke="#16A34A" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground border-b">
              <tr><th className="text-left px-1 py-1 sticky left-0 bg-card">Series \\ Month</th>{block.monthly.map((m) => <th key={m.monthKey} className="text-right px-1 py-1 whitespace-nowrap">{m.label}</th>)}</tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/40">
                <td className="px-1 py-1 sticky left-0 bg-card text-orange-600 font-medium">Revised Budget</td>
                {block.monthly.map((m) => <td key={m.monthKey} className="text-right px-1 py-0.5"><RevisedBudgetCell fye={fye} metric={block.metric} monthKey={m.monthKey} value={m.revisedBudget} canEdit={canEdit} /></td>)}
              </tr>
              <tr className="border-b border-border/40">
                <td className="px-1 py-1 sticky left-0 bg-card text-emerald-700 font-semibold">Actual</td>
                {block.monthly.map((m) => <td key={m.monthKey} className="text-right px-1 py-1 font-mono">{fmtM(m.actual)}</td>)}
              </tr>
              <tr>
                <td className="px-1 py-1 sticky left-0 bg-card text-blue-600 font-medium">Plan ahead</td>
                {block.monthly.map((m) => <td key={m.monthKey} className="text-right px-1 py-1 font-mono">{fmtM(m.planAhead)}</td>)}
              </tr>
              <tr className="border-t-2 text-muted-foreground">
                <td className="px-1 py-1 sticky left-0 bg-card italic">Actual YTD</td>
                {block.ytd.map((m) => <td key={m.monthKey} className="text-right px-1 py-1 font-mono">{fmtM(m.actual)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
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
  if (isLoading) return <FinanceLoading />;
  if (isError) return <FinanceError hint={(error as Error)?.message} onRetry={() => void refetch()} />;
  if (!data) return null;
  const d = data.dashboard;
  const monthOptions = d.revenue.monthly.map((m) => ({ monthKey: m.monthKey, label: m.label }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Actuals close to <span className="font-medium">{d.lastClosedMonthKey ?? "—"}</span>; Plan-ahead continues with Committed + Planned pipeline to year-end. Revised Budget is manual and editable.
        </p>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
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

  // "as at" banner — pulled from the projects response.
  const { data: meta } = useQuery<ProjectsResponse>({
    queryKey: [`/api/fye-revenue-tracking/projects?${fyScope.apiQueryString}`],
    queryFn: fetchQueryFn(`/api/fye-revenue-tracking/projects?${fyScope.apiQueryString}`),
  });

  const refresh = () => { void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").includes("/api/fye-revenue-tracking") }); };

  return (
    <FinanceShell>
      <FinancePageHeader
        title="FYE Tracking"
        question="FY26 project tracking from the imported trackers — Budget vs Actual and the Revenue/COS/GP dashboard."
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="projects" className="gap-1.5" data-testid="tab-fye-projects"><Table2 className="h-4 w-4" />Projects</TabsTrigger>
          <TabsTrigger value="dashboard" className="gap-1.5" data-testid="tab-fye-dashboard"><BarChart3 className="h-4 w-4" />Dashboard</TabsTrigger>
        </TabsList>
        <TabsContent value="projects" className="mt-3"><ProjectsView apiQueryString={fyScope.apiQueryString} /></TabsContent>
        <TabsContent value="dashboard" className="mt-3"><DashboardView apiQueryString={fyScope.apiQueryString} canEdit={canEdit} /></TabsContent>
      </Tabs>
    </FinanceShell>
  );
}
