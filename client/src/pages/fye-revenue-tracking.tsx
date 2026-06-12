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
  FinanceLoading,
  FinanceError,
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
  const Th = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => (
    <th className={`px-2 py-2 ${num ? "text-right" : "text-left"} cursor-pointer select-none whitespace-nowrap`} onClick={() => setSort(k)}>
      <span className="inline-flex items-center gap-1">{label}<ArrowUpDown className="h-3 w-3 opacity-40" /></span>
    </th>
  );
  const st = data.stateTotals;

  return (
    <div className="space-y-4">
      {/* 4-state portfolio reconciliation */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Portfolio recognition states (FY{String(data.fye).slice(-2)})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground border-b"><th className="text-left px-2 py-1">State</th><th className="text-right px-2 py-1">Revenue</th><th className="text-right px-2 py-1">COS</th><th className="text-right px-2 py-1">GP</th></tr></thead>
              <tbody className="font-mono">
                {(["realised", "committed", "planned", "unrealised"] as const).map((s) => (
                  <tr key={s} className="border-b border-border/40">
                    <td className="px-2 py-1 capitalize font-sans">{s}</td>
                    <td className="px-2 py-1 text-right"><MoneyValue value={st[s].revenue} /></td>
                    <td className="px-2 py-1 text-right"><MoneyValue value={st[s].cos} /></td>
                    <td className="px-2 py-1 text-right"><MoneyValue value={st[s].revenue - st[s].cos} /></td>
                  </tr>
                ))}
                <tr className="font-bold border-t-2"><td className="px-2 py-1 font-sans">Budget (all states)</td>
                  <td className="px-2 py-1 text-right"><MoneyValue value={st.budget.revenue} /></td>
                  <td className="px-2 py-1 text-right"><MoneyValue value={st.budget.cos} /></td>
                  <td className="px-2 py-1 text-right"><MoneyValue value={st.budget.revenue - st.budget.cos} /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Filter project…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-48" data-testid="fye-project-filter" />
        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
          <option value="all">All types</option><option value="Active">Active</option><option value="Past">Past</option><option value="Compliance">Compliance</option>
        </select>
        <span className="text-xs text-muted-foreground">{data.projectCount} projects · {data.excluded.length} excluded</span>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 border-b">
              <tr>
                <Th k="project" label="Project" /><Th k="type" label="Type" />
                <th className="px-2 py-2 text-left whitespace-nowrap">Start</th><th className="px-2 py-2 text-left whitespace-nowrap">End (PC)</th>
                <Th k="budgetRevenue" label="Budget Rev" num /><th className="px-2 py-2 text-right">Budget COS</th><th className="px-2 py-2 text-right">Budget GP</th><th className="px-2 py-2 text-right">Bud GP%</th>
                <Th k="actualRevenue" label="Actual Rev" num /><th className="px-2 py-2 text-right">Actual COS</th><th className="px-2 py-2 text-right">Actual GP</th><Th k="actualGpPct" label="Act GP%" num /><Th k="pctRealised" label="% Real." num />
                <th className="px-2 py-2 text-left">Flag</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const amber = r.flags.includes("COS_NO_REVENUE");
                const nonStd = r.flags.includes("NON_STANDARD_TEMPLATE");
                return (
                  <tr key={r.projectId} className={`border-b border-border/40 ${amber ? "bg-amber-50 dark:bg-amber-950/20" : ""} ${nonStd ? "opacity-70 italic" : ""}`} data-testid={`fye-project-row-${r.projectId}`}>
                    <td className="px-2 py-1.5 font-medium">{r.project}</td>
                    <td className="px-2 py-1.5">{r.type}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.startDate ?? "—"}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.endDatePc ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right font-mono"><MoneyValue value={r.budgetRevenue} /></td>
                    <td className="px-2 py-1.5 text-right font-mono"><MoneyValue value={r.budgetCos} /></td>
                    <td className="px-2 py-1.5 text-right font-mono"><MoneyValue value={r.budgetGp} /></td>
                    <td className="px-2 py-1.5 text-right font-mono">{PCT(r.budgetGpPct)}</td>
                    <td className="px-2 py-1.5 text-right font-mono"><MoneyValue value={r.actualRevenue} /></td>
                    <td className="px-2 py-1.5 text-right font-mono"><MoneyValue value={r.actualCos} /></td>
                    <td className="px-2 py-1.5 text-right font-mono"><MoneyValue value={r.actualGp} /></td>
                    <td className="px-2 py-1.5 text-right font-mono">{PCT(r.actualGpPct)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{PCT(r.pctRealised)}</td>
                    <td className="px-2 py-1.5">
                      {amber && <StatusBadge tone="warning" label="COS, no revenue — check tracker" />}
                      {nonStd && <StatusBadge tone="neutral" label="Non-standard template (excl. from totals)" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-bold border-t-2 bg-muted/40">
                <td className="px-2 py-2" colSpan={4}>TOTAL ({data.projectCount} projects)</td>
                <td className="px-2 py-2 text-right font-mono"><MoneyValue value={data.totals.budgetRevenue} /></td>
                <td className="px-2 py-2 text-right font-mono"><MoneyValue value={data.totals.budgetCos} /></td>
                <td className="px-2 py-2 text-right font-mono"><MoneyValue value={data.totals.budgetGp} /></td>
                <td className="px-2 py-2 text-right font-mono">{PCT(data.totals.budgetGpPct)}</td>
                <td className="px-2 py-2 text-right font-mono"><MoneyValue value={data.totals.actualRevenue} /></td>
                <td className="px-2 py-2 text-right font-mono"><MoneyValue value={data.totals.actualCos} /></td>
                <td className="px-2 py-2 text-right font-mono"><MoneyValue value={data.totals.actualGp} /></td>
                <td className="px-2 py-2 text-right font-mono">{PCT(data.totals.actualGpPct)}</td>
                <td className="px-2 py-2 text-right font-mono">{PCT(data.totals.pctRealised)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

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
