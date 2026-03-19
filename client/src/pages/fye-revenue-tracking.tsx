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
  AlertCircle, BarChart3, FileText, Camera,
  Plus, Trash2, Pencil, RefreshCw, X, Check, Eye, Clock,
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
  fyeYear: number;
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
  updatedAt: string | null;
}

interface LostDealRow {
  id: number;
  fyeYear: number;
  dealName: string;
  dealValue: string | null;
  businessDeveloper: string | null;
  lostReason: string | null;
  lostDate: string | null;
  notes: string | null;
  updatedAt: string | null;
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
    { label: "Actual GP%", value: formatPct(totals.actualGpPct), icon: BarChart3, negative: totals.actualGpPct != null && totals.actualGpPct < 0 },
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

// ─── Editable Pipeline Section ───

function PipelineSection({ pipeline, canEdit, fye }: { pipeline: PipelineRow[]; canEdit: { allowed: boolean; loading: boolean }; fye: number }) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const qc = useQueryClient();

  const pipelineFiltered = pipeline.filter((p) => p.dealProbabilityPct >= 75);

  const emptyForm = { projectName: "", projectDeveloper: "", location: "", sizeKwp: "", dealProbabilityPct: 75, forecastSignatureDate: "", solarRevenue: "", bessRevenue: "", forecastGpPct: "", notes: "" };
  const [form, setForm] = useState(emptyForm);

  const saveMutation = useMutation({
    mutationFn: async (data: typeof form & { id?: number }) => {
      const payload = { ...data, fyeYear: fye, dealProbabilityPct: Number(data.dealProbabilityPct), solarRevenue: data.solarRevenue || "0", bessRevenue: data.bessRevenue || "0", forecastGpPct: data.forecastGpPct || null };
      if (data.id) {
        await apiRequest("PUT", `/api/fye-revenue-tracking/pipeline/${data.id}`, payload);
      } else {
        await apiRequest("POST", "/api/fye-revenue-tracking/pipeline", payload);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/fye-revenue-tracking/pipeline?fye=${fye}`] }); setShowForm(false); setEditId(null); setForm(emptyForm); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/fye-revenue-tracking/pipeline/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/fye-revenue-tracking/pipeline?fye=${fye}`] }); },
  });

  const startEdit = (p: PipelineRow) => {
    setForm({ projectName: p.projectName, projectDeveloper: p.projectDeveloper || "", location: p.location || "", sizeKwp: p.sizeKwp || "", dealProbabilityPct: p.dealProbabilityPct, forecastSignatureDate: p.forecastSignatureDate || "", solarRevenue: p.solarRevenue || "", bessRevenue: p.bessRevenue || "", forecastGpPct: p.forecastGpPct || "", notes: p.notes || "" });
    setEditId(p.id);
    setShowForm(true);
  };

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Forecasted Pipeline — 75% Probability and Higher
          </CardTitle>
          {canEdit.allowed && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setForm(emptyForm); setEditId(null); setShowForm(!showForm); }}>
              {showForm ? <><X className="h-3 w-3 mr-1" />Cancel</> : <><Plus className="h-3 w-3 mr-1" />Add Deal</>}
            </Button>
          )}
        </div>
      </CardHeader>
      {showForm && (
        <CardContent className="pt-0 pb-3 px-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 p-3 bg-muted/30 rounded border text-xs">
            <Input placeholder="Project Name *" value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} className="h-7 text-xs" />
            <Input placeholder="Developer" value={form.projectDeveloper} onChange={(e) => setForm({ ...form, projectDeveloper: e.target.value })} className="h-7 text-xs" />
            <Input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="h-7 text-xs" />
            <Input placeholder="Size (kWp)" value={form.sizeKwp} onChange={(e) => setForm({ ...form, sizeKwp: e.target.value })} className="h-7 text-xs" type="number" />
            <Input placeholder="Probability %" value={form.dealProbabilityPct} onChange={(e) => setForm({ ...form, dealProbabilityPct: Number(e.target.value) })} className="h-7 text-xs" type="number" min={0} max={100} />
            <Input placeholder="Forecast Sign Date" value={form.forecastSignatureDate} onChange={(e) => setForm({ ...form, forecastSignatureDate: e.target.value })} className="h-7 text-xs" type="date" />
            <Input placeholder="Solar Revenue" value={form.solarRevenue} onChange={(e) => setForm({ ...form, solarRevenue: e.target.value })} className="h-7 text-xs" type="number" />
            <Input placeholder="BESS Revenue" value={form.bessRevenue} onChange={(e) => setForm({ ...form, bessRevenue: e.target.value })} className="h-7 text-xs" type="number" />
            <Input placeholder="Forecast GP% (0.20 = 20%)" value={form.forecastGpPct} onChange={(e) => setForm({ ...form, forecastGpPct: e.target.value })} className="h-7 text-xs" type="number" step="0.01" />
            <div className="flex gap-1">
              <Button size="sm" className="h-7 text-xs flex-1" disabled={!form.projectName || saveMutation.isPending} onClick={() => saveMutation.mutate(editId ? { ...form, id: editId } : form)}>
                {saveMutation.isPending ? "Saving..." : editId ? "Update" : "Add"}
              </Button>
            </div>
          </div>
          {saveMutation.isError && <p className="text-xs text-red-500 mt-1">{(saveMutation.error as any)?.message || "Save failed"}</p>}
        </CardContent>
      )}
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
              {canEdit.allowed && <th className="text-center px-2 py-2 font-medium w-16">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {pipelineFiltered.length === 0 ? (
              <tr><td colSpan={canEdit.allowed ? 11 : 10} className="text-center py-6 text-muted-foreground">No pipeline deals found</td></tr>
            ) : (
              pipelineFiltered.map((p) => {
                const solar = parseFloat(p.solarRevenue || "0");
                const bess = parseFloat(p.bessRevenue || "0");
                const gpPct = parseFloat(p.forecastGpPct || "0");
                const forecastGp = gpPct * (solar + bess);
                return (
                  <tr key={p.id} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-1.5 font-medium">{p.projectName}</td>
                    <td className="px-2 py-1.5">{p.projectDeveloper || "–"}</td>
                    <td className="px-2 py-1.5">{p.location || "–"}</td>
                    <td className="text-right px-2 py-1.5 tabular-nums">{p.sizeKwp || "–"}</td>
                    <td className="text-right px-2 py-1.5 tabular-nums">{p.dealProbabilityPct}%</td>
                    <td className="px-2 py-1.5">{formatDate(p.forecastSignatureDate)}</td>
                    <td className="text-right px-2 py-1.5 tabular-nums">{formatRand(solar)}</td>
                    <td className="text-right px-2 py-1.5 tabular-nums">{formatRand(bess)}</td>
                    <td className="text-right px-2 py-1.5 tabular-nums">{(gpPct * 100).toFixed(1)}%</td>
                    <td className="text-right px-2 py-1.5 tabular-nums font-medium">{formatRand(forecastGp)}</td>
                    {canEdit.allowed && (
                      <td className="text-center px-2 py-1.5">
                        <div className="flex justify-center gap-1">
                          <button onClick={() => startEdit(p)} className="p-0.5 hover:text-blue-600" title="Edit"><Pencil className="h-3 w-3" /></button>
                          <button onClick={() => { if (confirm("Archive this deal?")) deleteMutation.mutate(p.id); }} className="p-0.5 hover:text-red-600" title="Archive"><Trash2 className="h-3 w-3" /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ─── Editable Lost Deals Section ───

function LostDealsSection({ lostDeals, canEdit, fye }: { lostDeals: LostDealRow[]; canEdit: { allowed: boolean; loading: boolean }; fye: number }) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const qc = useQueryClient();

  const emptyForm = { dealName: "", dealValue: "", businessDeveloper: "", lostReason: "", lostDate: "", notes: "" };
  const [form, setForm] = useState(emptyForm);

  const saveMutation = useMutation({
    mutationFn: async (data: typeof form & { id?: number }) => {
      const payload = { ...data, fyeYear: fye };
      if (data.id) {
        await apiRequest("PUT", `/api/fye-revenue-tracking/lost-deals/${data.id}`, payload);
      } else {
        await apiRequest("POST", "/api/fye-revenue-tracking/lost-deals", payload);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/fye-revenue-tracking/lost-deals?fye=${fye}`] }); setShowForm(false); setEditId(null); setForm(emptyForm); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/fye-revenue-tracking/lost-deals/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/fye-revenue-tracking/lost-deals?fye=${fye}`] }); },
  });

  const startEdit = (d: LostDealRow) => {
    setForm({ dealName: d.dealName, dealValue: d.dealValue || "", businessDeveloper: d.businessDeveloper || "", lostReason: d.lostReason || "", lostDate: d.lostDate || "", notes: d.notes || "" });
    setEditId(d.id);
    setShowForm(true);
  };

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            Lost Deals
          </CardTitle>
          {canEdit.allowed && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setForm(emptyForm); setEditId(null); setShowForm(!showForm); }}>
              {showForm ? <><X className="h-3 w-3 mr-1" />Cancel</> : <><Plus className="h-3 w-3 mr-1" />Add Deal</>}
            </Button>
          )}
        </div>
      </CardHeader>
      {showForm && (
        <CardContent className="pt-0 pb-3 px-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 p-3 bg-muted/30 rounded border text-xs">
            <Input placeholder="Deal Name *" value={form.dealName} onChange={(e) => setForm({ ...form, dealName: e.target.value })} className="h-7 text-xs" />
            <Input placeholder="Deal Value" value={form.dealValue} onChange={(e) => setForm({ ...form, dealValue: e.target.value })} className="h-7 text-xs" type="number" />
            <Input placeholder="Business Developer" value={form.businessDeveloper} onChange={(e) => setForm({ ...form, businessDeveloper: e.target.value })} className="h-7 text-xs" />
            <Input placeholder="Lost Reason" value={form.lostReason} onChange={(e) => setForm({ ...form, lostReason: e.target.value })} className="h-7 text-xs" />
            <Input placeholder="Lost Date" value={form.lostDate} onChange={(e) => setForm({ ...form, lostDate: e.target.value })} className="h-7 text-xs" type="date" />
            <div className="flex gap-1">
              <Button size="sm" className="h-7 text-xs flex-1" disabled={!form.dealName || saveMutation.isPending} onClick={() => saveMutation.mutate(editId ? { ...form, id: editId } : form)}>
                {saveMutation.isPending ? "Saving..." : editId ? "Update" : "Add"}
              </Button>
            </div>
          </div>
          {saveMutation.isError && <p className="text-xs text-red-500 mt-1">{(saveMutation.error as any)?.message || "Save failed"}</p>}
        </CardContent>
      )}
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
              {canEdit.allowed && <th className="text-center px-2 py-2 font-medium w-16">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {lostDeals.length === 0 ? (
              <tr><td colSpan={canEdit.allowed ? 7 : 6} className="text-center py-6 text-muted-foreground">No lost deals recorded</td></tr>
            ) : (
              lostDeals.map((d) => (
                <tr key={d.id} className="border-b hover:bg-muted/30">
                  <td className="px-3 py-1.5 font-medium">{d.dealName}</td>
                  <td className="text-right px-2 py-1.5 tabular-nums">{formatRand(parseFloat(d.dealValue || "0"))}</td>
                  <td className="px-2 py-1.5">{d.businessDeveloper || "–"}</td>
                  <td className="px-2 py-1.5">{d.lostReason || "–"}</td>
                  <td className="px-2 py-1.5">{formatDate(d.lostDate)}</td>
                  <td className="px-2 py-1.5 truncate max-w-[150px]" title={d.notes || ""}>{d.notes || "–"}</td>
                  {canEdit.allowed && (
                    <td className="text-center px-2 py-1.5">
                      <div className="flex justify-center gap-1">
                        <button onClick={() => startEdit(d)} className="p-0.5 hover:text-blue-600" title="Edit"><Pencil className="h-3 w-3" /></button>
                        <button onClick={() => { if (confirm("Delete this lost deal?")) deleteMutation.mutate(d.id); }} className="p-0.5 hover:text-red-600" title="Delete"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function DetailTab({ fye }: { fye: number }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fundingFilter, setFundingFilter] = useState("");

  const { data, isLoading, error, refetch } = useQuery<DetailData>({
    queryKey: [`/api/fye-revenue-tracking/detail?fye=${fye}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: pipeline } = useQuery<PipelineRow[]>({
    queryKey: [`/api/fye-revenue-tracking/pipeline?fye=${fye}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: lostDeals } = useQuery<LostDealRow[]>({
    queryKey: [`/api/fye-revenue-tracking/lost-deals?fye=${fye}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: kpis } = useQuery<KpiData>({
    queryKey: [`/api/fye-revenue-tracking/kpis?fye=${fye}`],
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
  if (error || !data) return (
    <div className="text-center py-12">
      <AlertCircle className="h-8 w-8 mx-auto mb-2 text-red-500" />
      <p className="text-sm font-medium text-foreground mb-1">Failed to load detail data</p>
      <p className="text-xs text-muted-foreground mb-3">{(error as any)?.message || "Unknown error"}</p>
      <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5 mr-1" />Retry</Button>
    </div>
  );

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
                      <td className={cn("text-right px-2 py-1.5 tabular-nums", p.actualGpPct != null && p.actualGpPct < 0 && "text-red-600")}>{formatPct(p.actualGpPct)}</td>
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
                    <td className="text-right px-2 py-2 tabular-nums">{formatPct(filteredTotals.budgetRevenue ? filteredTotals.budgetGp / filteredTotals.budgetRevenue : null)}</td>
                    <td className={cn("text-right px-2 py-2 tabular-nums", filteredTotals.actualGp < 0 && "text-red-600")}>{formatPct(filteredTotals.actualRevenue ? filteredTotals.actualGp / filteredTotals.actualRevenue : null)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Forecast Pipeline */}
      <PipelineSection pipeline={pipeline || []} canEdit={canEdit} fye={fye} />

      {/* Lost Deals */}
      <LostDealsSection lostDeals={lostDeals || []} canEdit={canEdit} fye={fye} />

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

// ─── Snapshot Types ───

interface SnapshotSummary {
  id: number;
  fyeYear: number;
  snapshotMonth: number;
  snapshotDate: string;
  snapshotLabel: string;
  status: string;
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
}

// ─── Snapshots Tab ───

function SnapshotsTab({ fye }: { fye: number }) {
  const [showCreate, setShowCreate] = useState(false);
  const [viewId, setViewId] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const qc = useQueryClient();
  const canEdit = usePermission("fye_revenue_tracking", "edit");

  const { data: snapshots, isLoading } = useQuery<SnapshotSummary[]>({
    queryKey: [`/api/fye-revenue-tracking/snapshots?fye=${fye}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: viewData, isLoading: viewLoading } = useQuery<any>({
    queryKey: [`/api/fye-revenue-tracking/snapshots/${viewId}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: viewId !== null,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/fye-revenue-tracking/snapshots", { fyeYear: fye, snapshotLabel: label, notes: notes || undefined });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/fye-revenue-tracking/snapshots?fye=${fye}`] }); setShowCreate(false); setLabel(""); setNotes(""); },
  });

  const submitMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("PUT", `/api/fye-revenue-tracking/snapshots/${id}/submit`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/fye-revenue-tracking/snapshots?fye=${fye}`] }); },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("PUT", `/api/fye-revenue-tracking/snapshots/${id}/approve`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/fye-revenue-tracking/snapshots?fye=${fye}`] }); },
  });

  // Auto-suggest label
  const suggestedLabel = useMemo(() => {
    const now = new Date();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${monthNames[now.getMonth()]} ${now.getFullYear()} Month-End`;
  }, []);

  // Historical view
  if (viewId !== null && viewData) {
    const sd = viewData.snapshotData;
    return (
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded p-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-amber-800">Viewing snapshot: {viewData.snapshotLabel}</p>
            <p className="text-xs text-amber-600">
              {viewData.status === "approved" ? `Approved on ${formatDate(viewData.approvedAt)}` :
               viewData.status === "submitted" ? `Submitted on ${formatDate(viewData.submittedAt)}` :
               `Draft — created ${formatDate(viewData.createdAt)}`}
            </p>
          </div>
          <div className="flex gap-2">
            <a href={`/api/fye-revenue-tracking/snapshots/${viewId}/export`} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm" className="h-7 text-xs"><Download className="h-3 w-3 mr-1" />Export Excel</Button>
            </a>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setViewId(null)}><X className="h-3 w-3 mr-1" />Close</Button>
          </div>
        </div>

        {/* Render dashboard from snapshot */}
        {sd?.dashboard?.months && (
          <>
            <Card><CardHeader className="pb-2 pt-3 px-4"><CardTitle className="text-sm font-semibold">Revenue Tracking (Snapshot)</CardTitle></CardHeader>
            <CardContent className="px-0 pb-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b"><th className="text-left px-3 py-1.5 font-medium w-32">Row</th>
                  {sd.dashboard.months.map((m: any) => <th key={m.monthKey} className="text-right px-2 py-1.5 font-medium min-w-[80px]">{m.label}</th>)}
                </tr></thead>
                <tbody>
                  {(["budget", "actualForecast", "actual", "captured"] as const).map((rk) => (
                    <tr key={rk} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-1.5 font-medium">{rk === "actualForecast" ? "Actual + Forecast" : rk === "captured" ? "Captured" : rk.charAt(0).toUpperCase() + rk.slice(1)}</td>
                      {sd.dashboard.months.map((m: any, i: number) => <td key={i} className="text-right px-2 py-1.5 tabular-nums">{m.revenue?.[rk] != null ? formatRand(m.revenue[rk]) : "–"}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent></Card>
          </>
        )}

        {/* Summary from snapshot */}
        {sd?.detail?.totals && (
          <Card className="p-4">
            <p className="text-sm font-semibold mb-2">Detail Totals (Snapshot)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
              <div><span className="text-muted-foreground">Budget Rev:</span> {formatRand(sd.detail.totals.budgetRevenue)}</div>
              <div><span className="text-muted-foreground">Budget COS:</span> {formatRand(sd.detail.totals.budgetCos)}</div>
              <div><span className="text-muted-foreground">Budget GP:</span> {formatRand(sd.detail.totals.budgetGp)}</div>
              <div><span className="text-muted-foreground">Actual Rev:</span> {formatRand(sd.detail.totals.actualRevenue)}</div>
              <div><span className="text-muted-foreground">Actual Exp:</span> {formatRand(sd.detail.totals.actualExpense)}</div>
              <div><span className="text-muted-foreground">Actual GP:</span> {formatRand(sd.detail.totals.actualGp)}</div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">{sd.detail.projects?.length || 0} projects, {sd.pipeline?.length || 0} pipeline deals, {sd.lostDeals?.length || 0} lost deals</p>
            <p className="text-xs text-muted-foreground">KPI: Brought In {sd.kpi?.broughtIn}, Signed {sd.kpi?.signed}, Total {sd.kpi?.total}</p>
          </Card>
        )}
      </div>
    );
  }

  const statusBadge = (status: string) => {
    if (status === "approved") return <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">Approved</Badge>;
    if (status === "submitted") return <Badge className="bg-amber-100 text-amber-700 text-[10px]">Submitted</Badge>;
    return <Badge variant="outline" className="text-[10px]">Draft</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Month-End Snapshots</h3>
        {canEdit.allowed && (
          <Button size="sm" className="h-7 text-xs" onClick={() => { setLabel(suggestedLabel); setShowCreate(true); }}>
            <Camera className="h-3 w-3 mr-1" />Take Snapshot
          </Button>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <Card className="p-4 border-emerald-200 bg-emerald-50/30">
          <p className="text-sm font-semibold mb-2">Take Month-End Snapshot</p>
          <div className="space-y-2">
            <Input placeholder="Snapshot label" value={label} onChange={(e) => setLabel(e.target.value)} className="h-8 text-xs" />
            <textarea placeholder="Notes for the board (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full h-16 text-xs border rounded p-2 bg-background" />
            <p className="text-xs text-muted-foreground">This will capture the complete report: dashboard, project detail, pipeline deals, lost deals, and KPIs.</p>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" disabled={!label || createMutation.isPending} onClick={() => createMutation.mutate()}>
                {createMutation.isPending ? "Creating..." : "Create Draft Snapshot"}
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
            {createMutation.isError && <p className="text-xs text-red-500">{(createMutation.error as any)?.message || "Failed to create snapshot"}</p>}
          </div>
        </Card>
      )}

      {/* Snapshot List */}
      {isLoading ? <Skeleton className="h-32 w-full" /> : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-3 py-2 font-medium">Label</th>
                  <th className="text-left px-2 py-2 font-medium">Date</th>
                  <th className="text-left px-2 py-2 font-medium">Status</th>
                  <th className="text-left px-2 py-2 font-medium">Notes</th>
                  <th className="text-center px-2 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(!snapshots || snapshots.length === 0) ? (
                  <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No snapshots yet. Take your first month-end snapshot.</td></tr>
                ) : snapshots.map((s) => (
                  <tr key={s.id} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{s.snapshotLabel}</td>
                    <td className="px-2 py-2">{formatDate(s.snapshotDate)}</td>
                    <td className="px-2 py-2">{statusBadge(s.status)}</td>
                    <td className="px-2 py-2 truncate max-w-[200px]" title={s.notes || ""}>{s.notes || "–"}</td>
                    <td className="px-2 py-2">
                      <div className="flex justify-center gap-1">
                        <button onClick={() => setViewId(s.id)} className="p-1 hover:text-blue-600" title="View"><Eye className="h-3.5 w-3.5" /></button>
                        <a href={`/api/fye-revenue-tracking/snapshots/${s.id}/export`} target="_blank" rel="noreferrer" className="p-1 hover:text-emerald-600" title="Export"><Download className="h-3.5 w-3.5" /></a>
                        {s.status === "draft" && canEdit.allowed && (
                          <button onClick={() => { if (confirm("Submit this snapshot to the board?")) submitMutation.mutate(s.id); }} className="p-1 hover:text-amber-600" title="Submit"><Check className="h-3.5 w-3.5" /></button>
                        )}
                        {s.status === "submitted" && canEdit.allowed && (
                          <button onClick={() => { if (confirm("Approve this snapshot?")) approveMutation.mutate(s.id); }} className="p-1 hover:text-emerald-600" title="Approve"><Check className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main Page ───

export default function FyeRevenueTrackingPage() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "detail" | "snapshots">("dashboard");
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
        <button
          onClick={() => setActiveTab("snapshots")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === "snapshots" ? "border-emerald-600 text-emerald-600" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Camera className="h-3.5 w-3.5 inline mr-1.5" />Snapshots
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "dashboard" ? <DashboardTab fye={fye} /> : activeTab === "detail" ? <DetailTab fye={fye} /> : <SnapshotsTab fye={fye} />}
    </div>
  );
}
