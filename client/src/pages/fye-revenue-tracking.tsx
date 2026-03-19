import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { usePermission } from "@/hooks/use-permissions";
import {
  Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart,
} from "recharts";
import {
  DollarSign, TrendingUp, Activity, Search, Download,
  AlertCircle, BarChart3, FileText,
  Plus, Trash2, Pencil, RefreshCw, X,
} from "lucide-react";

// ─── Types ───

interface MonthMetric {
  budget: number;
  actualForecast: number;
  actual: number | null;
  captured: number | null;
}

interface DashboardMonth {
  monthKey: string;
  label: string;
  revenue: MonthMetric;
  cos: MonthMetric;
  gp: MonthMetric;
}

interface DashboardData {
  fye: number;
  months: DashboardMonth[];
  monthKeys: string[];
}

interface ProjectRow {
  projectId: number;
  projectName: string;
  businessDeveloper: string | null;
  province: string | null;
  sizeKwp: number;
  projectType: string | null;
  fundingType: string | null;
  startDate: string | null;
  pcDate: string | null;
  status: string | null;
  budgetRevenue: number;
  budgetCos: number;
  budgetGp: number;
  actualRevenue: number;
  actualExpense: number;
  actualGp: number;
  budgetGpPct: number | null;
  actualGpPct: number | null;
  signedStatus: string;
}

interface DetailData {
  fye: number;
  projects: ProjectRow[];
  totals: {
    budgetRevenue: number;
    budgetCos: number;
    budgetGp: number;
    actualRevenue: number;
    actualExpense: number;
    actualGp: number;
    budgetGpPct: number | null;
    actualGpPct: number | null;
  };
}

interface PipelineRow {
  id: number;
  projectName: string;
  projectDeveloper: string | null;
  location: string | null;
  sizeKwp: string | null;
  dealProbabilityPct: number;
  forecastSignatureDate: string | null;
  solarRevenue: string | null;
  bessRevenue: string | null;
  forecastGpPct: string | null;
  notes: string | null;
}

interface LostDealRow {
  id: number;
  dealName: string;
  dealValue: string | null;
  businessDeveloper: string | null;
  lostReason: string | null;
  lostDate: string | null;
  notes: string | null;
}

interface KpiData {
  broughtIn: number;
  signed: number;
  total: number;
}

// ─── Helpers ───

function getCurrentFye(): number {
  const now = new Date();
  return now.getMonth() + 1 >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

function formatRand(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "–";
  if (val === 0) return "R 0";
  const sign = val < 0 ? "-" : "";
  const abs = Math.abs(val);
  return `${sign}R ${Math.round(abs).toLocaleString("en-ZA")}`;
}

function formatPct(val: number | null | undefined): string {
  if (val == null || isNaN(val) || !isFinite(val)) return "N/A";
  return `${(val * 100).toFixed(1)}%`;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ─── Dashboard Tab ───

function DashboardSection({
  title,
  months,
  metricKey,
  isRunning,
}: {
  title: string;
  months: DashboardMonth[];
  metricKey: "revenue" | "cos" | "gp";
  isRunning: boolean;
}) {
  const rows = [
    { key: "budget", label: "Budget", color: "text-blue-700 bg-blue-50" },
    { key: "actualForecast", label: "Actual + Forecast", color: "text-emerald-700 bg-emerald-50" },
    { key: "actual", label: "Actual", color: "text-amber-700 bg-amber-50" },
    { key: "captured", label: "Captured Data", color: "text-purple-700 bg-purple-50" },
  ] as const;

  const data = useMemo(() => {
    if (!isRunning) return months;
    // Cumulative
    let cumBudget = 0, cumAF = 0, cumActual: number | null = 0, cumCaptured: number | null = 0;
    return months.map((m) => {
      const metric = m[metricKey];
      cumBudget += metric.budget;
      cumAF += metric.actualForecast;
      if (metric.actual !== null) cumActual = (cumActual || 0) + metric.actual;
      else cumActual = cumActual || null;
      if (metric.captured !== null) cumCaptured = (cumCaptured || 0) + metric.captured;
      else cumCaptured = cumCaptured || null;
      return {
        ...m,
        [metricKey]: { budget: cumBudget, actualForecast: cumAF, actual: cumActual, captured: cumCaptured },
      };
    });
  }, [months, metricKey, isRunning]);

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground w-32 sticky left-0 bg-white z-10">Row</th>
              {data.map((m) => (
                <th key={m.monthKey} className="text-right px-2 py-1.5 font-medium text-muted-foreground min-w-[80px]">
                  {m.label}
                </th>
              ))}
              <th className="text-right px-3 py-1.5 font-bold text-muted-foreground min-w-[90px]">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const vals = data.map((m) => (m[metricKey] as any)[row.key] as number | null);
              const nonNullVals = vals.filter((v): v is number => v !== null);
              const total = isRunning
                ? vals[vals.length - 1]
                : nonNullVals.length > 0 ? nonNullVals.reduce((a, b) => a + b, 0) : null;
              return (
                <tr key={row.key} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-1.5 sticky left-0 bg-white z-10">
                    <Badge variant="outline" className={cn("text-[10px] font-medium", row.color)}>{row.label}</Badge>
                  </td>
                  {vals.map((v, i) => (
                    <td key={i} className={cn("text-right px-2 py-1.5 tabular-nums", v !== null && v < 0 && "text-red-600 font-medium")}>
                      {v === null ? "–" : formatRand(v)}
                    </td>
                  ))}
                  <td className={cn("text-right px-3 py-1.5 font-bold tabular-nums", total !== null && total < 0 && "text-red-600")}>
                    {total === null ? "–" : formatRand(total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function DashboardChart({
  title,
  months,
  metricKey,
}: {
  title: string;
  months: DashboardMonth[];
  metricKey: "revenue" | "gp";
}) {
  const chartData = months.map((m) => ({
    label: m.label,
    Budget: (m[metricKey] as MonthMetric).budget,
    "Actual + Forecast": (m[metricKey] as MonthMetric).actualForecast,
    Actual: (m[metricKey] as MonthMetric).actual,
    Captured: (m[metricKey] as MonthMetric).captured,
  }));

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatRand(v)} />
            <Tooltip formatter={(v: number) => formatRand(v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Budget" fill="#3b82f6" opacity={0.6} />
            <Line type="monotone" dataKey="Actual + Forecast" stroke="#10b981" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Actual" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
            <Line type="monotone" dataKey="Captured" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function DashboardTab({ fye }: { fye: number }) {
  const { data, isLoading, error, refetch } = useQuery<DashboardData>({
    queryKey: [`/api/fye-revenue-tracking/dashboard?fye=${fye}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  if (isLoading) return <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-40 w-full" />)}</div>;
  if (error || !data) return (
    <div className="text-center py-12">
      <AlertCircle className="h-8 w-8 mx-auto mb-2 text-red-500" />
      <p className="text-sm font-medium text-foreground mb-1">Failed to load dashboard data</p>
      <p className="text-xs text-muted-foreground mb-3">{(error as any)?.message || "Unknown error"}</p>
      <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5 mr-1" />Retry</Button>
    </div>
  );

  const { months } = data;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        <DashboardChart title="Revenue Tracking" months={months} metricKey="revenue" />
        <DashboardChart title="GP Tracking" months={months} metricKey="gp" />
      </div>
      <DashboardSection title="Revenue Tracking" months={months} metricKey="revenue" isRunning={false} />
      <DashboardSection title="Running Revenue" months={months} metricKey="revenue" isRunning={true} />
      <DashboardSection title="COS Tracking" months={months} metricKey="cos" isRunning={false} />
      <DashboardSection title="Running COS" months={months} metricKey="cos" isRunning={true} />
      <DashboardSection title="GP Tracking" months={months} metricKey="gp" isRunning={false} />
      <DashboardSection title="Running GP" months={months} metricKey="gp" isRunning={true} />
    </div>
  );
}

// ─── FYE Detail Tab ───

function SummaryCards({ totals }: { totals: DetailData["totals"] }) {
  const cards = [
    { label: "Budget Revenue", value: formatRand(totals.budgetRevenue), icon: DollarSign },
    { label: "Budget COS", value: formatRand(totals.budgetCos), icon: TrendingUp },
    { label: "Budget GP", value: formatRand(totals.budgetGp), icon: Activity, negative: totals.budgetGp < 0 },
    { label: "Actual Revenue", value: formatRand(totals.actualRevenue), icon: DollarSign },
    { label: "Actual Expense", value: formatRand(totals.actualExpense), icon: TrendingUp },
    { label: "Actual GP", value: formatRand(totals.actualGp), icon: Activity, negative: totals.actualGp < 0 },
    { label: "Budget GP%", value: formatPct(totals.budgetGpPct), icon: BarChart3 },
    { label: "Actual GP%", value: formatPct(totals.actualGpPct), icon: BarChart3, negative: totals.actualGpPct < 0 },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
      {cards.map((c) => (
        <Card key={c.label} className="p-2">
          <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center gap-1">
            <c.icon className="h-3 w-3" />{c.label}
          </div>
          <div className={cn("text-sm font-bold tabular-nums", c.negative && "text-red-600")}>{c.value}</div>
        </Card>
      ))}
    </div>
  );
}

function DetailTab({ fye }: { fye: number }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fundingFilter, setFundingFilter] = useState("");

  const { data, isLoading, error } = useQuery<DetailData>({
    queryKey: [`/api/fye-revenue-tracking/detail?fye=${fye}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: pipeline } = useQuery<PipelineRow[]>({
    queryKey: ["/api/fye-revenue-tracking/pipeline"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: lostDeals } = useQuery<LostDealRow[]>({
    queryKey: ["/api/fye-revenue-tracking/lost-deals"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: kpis } = useQuery<KpiData>({
    queryKey: ["/api/fye-revenue-tracking/kpis"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const canEdit = usePermission("fye_revenue_tracking", "edit");

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.projects.filter((p) => {
      if (search && !p.projectName.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (fundingFilter && p.fundingType !== fundingFilter) return false;
      return true;
    });
  }, [data, search, statusFilter, fundingFilter]);

  const uniqueStatuses = useMemo(() => [...new Set(data?.projects.map((p) => p.status).filter(Boolean) as string[])].sort(), [data]);
  const uniqueFunding = useMemo(() => [...new Set(data?.projects.map((p) => p.fundingType).filter(Boolean) as string[])].sort(), [data]);

  const filteredTotals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => ({
        budgetRevenue: acc.budgetRevenue + r.budgetRevenue,
        budgetCos: acc.budgetCos + r.budgetCos,
        budgetGp: acc.budgetGp + r.budgetGp,
        actualRevenue: acc.actualRevenue + r.actualRevenue,
        actualExpense: acc.actualExpense + r.actualExpense,
        actualGp: acc.actualGp + r.actualGp,
      }),
      { budgetRevenue: 0, budgetCos: 0, budgetGp: 0, actualRevenue: 0, actualExpense: 0, actualGp: 0 }
    );
  }, [filtered]);

  const handleExport = async () => {
    try {
      const csvRows = [
        ["Project Name", "Business Developer", "Province", "Size (kWp)", "Project Type", "Funding Type", "Start Date", "PC Date", "Status", "Budget Revenue", "Budget COS", "Budget GP", "Actual Revenue", "Actual Expense", "Actual GP", "Budget GP%", "Actual GP%"],
        ...filtered.map((p) => [
          p.projectName, p.businessDeveloper || "", p.province || "", p.sizeKwp, p.projectType || "", p.fundingType || "",
          p.startDate || "", p.pcDate || "", p.status || "",
          p.budgetRevenue, p.budgetCos, p.budgetGp, p.actualRevenue, p.actualExpense, p.actualGp,
          formatPct(p.budgetGpPct), formatPct(p.actualGpPct),
        ]),
      ];
      const csv = csvRows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fye-${fye}-detail.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  if (isLoading) return <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-32 w-full" />)}</div>;
  if (error || !data) return <div className="text-center py-12 text-muted-foreground"><AlertCircle className="h-8 w-8 mx-auto mb-2" />Failed to load detail data</div>;

  const pipelineFiltered = (pipeline || []).filter((p) => p.dealProbabilityPct >= 75);

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <SummaryCards totals={data.totals} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search projects..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 text-xs border rounded px-2 bg-background">
          <option value="">All Statuses</option>
          {uniqueStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fundingFilter} onChange={(e) => setFundingFilter(e.target.value)} className="h-8 text-xs border rounded px-2 bg-background">
          <option value="">All Funding</option>
          {uniqueFunding.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleExport}>
          <Download className="h-3.5 w-3.5 mr-1" />Export CSV
        </Button>
      </div>

      {/* Project Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <tr className="border-b">
                <th className="text-left px-3 py-2 font-medium sticky left-0 bg-muted/80 z-20 min-w-[180px]">Project Name</th>
                <th className="text-left px-2 py-2 font-medium">BD</th>
                <th className="text-left px-2 py-2 font-medium">Province</th>
                <th className="text-right px-2 py-2 font-medium">kWp</th>
                <th className="text-left px-2 py-2 font-medium">Type</th>
                <th className="text-left px-2 py-2 font-medium">Funding</th>
                <th className="text-left px-2 py-2 font-medium">Start</th>
                <th className="text-left px-2 py-2 font-medium">PC Date</th>
                <th className="text-left px-2 py-2 font-medium">Status</th>
                <th className="text-right px-2 py-2 font-medium">Budget Rev</th>
                <th className="text-right px-2 py-2 font-medium">Budget COS</th>
                <th className="text-right px-2 py-2 font-medium">Budget GP</th>
                <th className="text-right px-2 py-2 font-medium">Actual Rev</th>
                <th className="text-right px-2 py-2 font-medium">Actual Exp</th>
                <th className="text-right px-2 py-2 font-medium">Actual GP</th>
                <th className="text-right px-2 py-2 font-medium">Bud GP%</th>
                <th className="text-right px-2 py-2 font-medium">Act GP%</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={17} className="text-center py-8 text-muted-foreground">No projects found</td></tr>
              ) : (
                <>
                  {filtered.map((p) => (
                    <tr key={p.projectId} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-1.5 font-medium sticky left-0 bg-white z-10 truncate max-w-[200px]" title={p.projectName}>{p.projectName}</td>
                      <td className="px-2 py-1.5 truncate max-w-[100px]" title={p.businessDeveloper || ""}>{p.businessDeveloper || "—"}</td>
                      <td className="px-2 py-1.5">{p.province || "—"}</td>
                      <td className="text-right px-2 py-1.5 tabular-nums">{p.sizeKwp ? p.sizeKwp.toLocaleString() : "—"}</td>
                      <td className="px-2 py-1.5">{p.projectType || "—"}</td>
                      <td className="px-2 py-1.5">{p.fundingType || "—"}</td>
                      <td className="px-2 py-1.5">{formatDate(p.startDate)}</td>
                      <td className="px-2 py-1.5">{formatDate(p.pcDate)}</td>
                      <td className="px-2 py-1.5">{p.status ? <Badge variant="outline" className="text-[10px]">{p.status}</Badge> : "—"}</td>
                      <td className="text-right px-2 py-1.5 tabular-nums">{formatRand(p.budgetRevenue)}</td>
                      <td className="text-right px-2 py-1.5 tabular-nums">{formatRand(p.budgetCos)}</td>
                      <td className={cn("text-right px-2 py-1.5 tabular-nums", p.budgetGp < 0 && "text-red-600")}>{formatRand(p.budgetGp)}</td>
                      <td className="text-right px-2 py-1.5 tabular-nums">{formatRand(p.actualRevenue)}</td>
                      <td className="text-right px-2 py-1.5 tabular-nums">{formatRand(p.actualExpense)}</td>
                      <td className={cn("text-right px-2 py-1.5 tabular-nums", p.actualGp < 0 && "text-red-600")}>{formatRand(p.actualGp)}</td>
                      <td className="text-right px-2 py-1.5 tabular-nums">{formatPct(p.budgetGpPct)}</td>
                      <td className={cn("text-right px-2 py-1.5 tabular-nums", p.actualGpPct < 0 && "text-red-600")}>{formatPct(p.actualGpPct)}</td>
                    </tr>
                  ))}
                  {/* Totals Row */}
                  <tr className="border-t-2 bg-muted/50 font-bold">
                    <td className="px-3 py-2 sticky left-0 bg-muted/50 z-10">Totals ({filtered.length})</td>
                    <td colSpan={8}></td>
                    <td className="text-right px-2 py-2 tabular-nums">{formatRand(filteredTotals.budgetRevenue)}</td>
                    <td className="text-right px-2 py-2 tabular-nums">{formatRand(filteredTotals.budgetCos)}</td>
                    <td className={cn("text-right px-2 py-2 tabular-nums", filteredTotals.budgetGp < 0 && "text-red-600")}>{formatRand(filteredTotals.budgetGp)}</td>
                    <td className="text-right px-2 py-2 tabular-nums">{formatRand(filteredTotals.actualRevenue)}</td>
                    <td className="text-right px-2 py-2 tabular-nums">{formatRand(filteredTotals.actualExpense)}</td>
                    <td className={cn("text-right px-2 py-2 tabular-nums", filteredTotals.actualGp < 0 && "text-red-600")}>{formatRand(filteredTotals.actualGp)}</td>
                    <td className="text-right px-2 py-2 tabular-nums">{formatPct(filteredTotals.budgetRevenue ? filteredTotals.budgetGp / filteredTotals.budgetRevenue : 0)}</td>
                    <td className={cn("text-right px-2 py-2 tabular-nums", filteredTotals.actualGp < 0 && "text-red-600")}>{formatPct(filteredTotals.actualRevenue ? filteredTotals.actualGp / filteredTotals.actualRevenue : 0)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Forecast Pipeline */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Forecasted Pipeline — 75% Probability and Higher
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-2 font-medium">Project Name</th>
                <th className="text-left px-2 py-2 font-medium">Developer</th>
                <th className="text-left px-2 py-2 font-medium">Location</th>
                <th className="text-right px-2 py-2 font-medium">Size (kWp)</th>
                <th className="text-right px-2 py-2 font-medium">Probability %</th>
                <th className="text-left px-2 py-2 font-medium">Forecast Sign Date</th>
                <th className="text-right px-2 py-2 font-medium">Solar Revenue</th>
                <th className="text-right px-2 py-2 font-medium">BESS Revenue</th>
                <th className="text-right px-2 py-2 font-medium">Forecast GP%</th>
                <th className="text-right px-2 py-2 font-medium">Forecast GP</th>
              </tr>
            </thead>
            <tbody>
              {pipelineFiltered.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-6 text-muted-foreground">No pipeline deals found</td></tr>
              ) : (
                pipelineFiltered.map((p) => {
                  const solar = parseFloat(p.solarRevenue || "0");
                  const bess = parseFloat(p.bessRevenue || "0");
                  const gpPct = parseFloat(p.forecastGpPct || "0");
                  const forecastGp = gpPct * (solar + bess);
                  return (
                    <tr key={p.id} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-1.5 font-medium">{p.projectName}</td>
                      <td className="px-2 py-1.5">{p.projectDeveloper || "—"}</td>
                      <td className="px-2 py-1.5">{p.location || "—"}</td>
                      <td className="text-right px-2 py-1.5 tabular-nums">{p.sizeKwp || "—"}</td>
                      <td className="text-right px-2 py-1.5 tabular-nums">{p.dealProbabilityPct}%</td>
                      <td className="px-2 py-1.5">{formatDate(p.forecastSignatureDate)}</td>
                      <td className="text-right px-2 py-1.5 tabular-nums">{formatRand(solar)}</td>
                      <td className="text-right px-2 py-1.5 tabular-nums">{formatRand(bess)}</td>
                      <td className="text-right px-2 py-1.5 tabular-nums">{(gpPct * 100).toFixed(1)}%</td>
                      <td className="text-right px-2 py-1.5 tabular-nums font-medium">{formatRand(forecastGp)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Lost Deals */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            Lost Deals
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-2 font-medium">Deal Name</th>
                <th className="text-right px-2 py-2 font-medium">Deal Value</th>
                <th className="text-left px-2 py-2 font-medium">Business Developer</th>
                <th className="text-left px-2 py-2 font-medium">Lost Reason</th>
                <th className="text-left px-2 py-2 font-medium">Lost Date</th>
                <th className="text-left px-2 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {!lostDeals || lostDeals.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">No lost deals recorded</td></tr>
              ) : (
                lostDeals.map((d) => (
                  <tr key={d.id} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-1.5 font-medium">{d.dealName}</td>
                    <td className="text-right px-2 py-1.5 tabular-nums">{formatRand(parseFloat(d.dealValue || "0"))}</td>
                    <td className="px-2 py-1.5">{d.businessDeveloper || "—"}</td>
                    <td className="px-2 py-1.5">{d.lostReason || "—"}</td>
                    <td className="px-2 py-1.5">{formatDate(d.lostDate)}</td>
                    <td className="px-2 py-1.5 truncate max-w-[150px]" title={d.notes || ""}>{d.notes || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* KPI Counts */}
      {kpis && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3 text-center">
            <div className="text-xs text-muted-foreground mb-1">Brought In</div>
            <div className="text-2xl font-bold">{kpis.broughtIn}</div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-xs text-muted-foreground mb-1">Signed</div>
            <div className="text-2xl font-bold text-emerald-600">{kpis.signed}</div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-xs text-muted-foreground mb-1">Total</div>
            <div className="text-2xl font-bold text-blue-600">{kpis.total}</div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───

export default function FyeRevenueTrackingPage() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "detail">("dashboard");
  const [fye, setFye] = useState(getCurrentFye());

  const fyeOptions = useMemo(() => {
    const current = getCurrentFye();
    return [current - 1, current, current + 1];
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">FYE Revenue Tracking</h1>
          <p className="text-xs text-muted-foreground">Financial Year End: Sep {fye - 1} – Aug {fye}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={fye}
            onChange={(e) => setFye(parseInt(e.target.value, 10))}
            className="h-8 text-xs border rounded px-2 bg-background"
          >
            {fyeOptions.map((y) => (
              <option key={y} value={y}>FYE {y} (Sep {y - 1} – Aug {y})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab("dashboard")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === "dashboard" ? "border-emerald-600 text-emerald-600" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <BarChart3 className="h-3.5 w-3.5 inline mr-1.5" />Dashboard
        </button>
        <button
          onClick={() => setActiveTab("detail")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === "detail" ? "border-emerald-600 text-emerald-600" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <FileText className="h-3.5 w-3.5 inline mr-1.5" />FYE Detail
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "dashboard" ? <DashboardTab fye={fye} /> : <DetailTab fye={fye} />}
    </div>
  );
}
