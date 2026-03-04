import React, { useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Line,
} from "recharts";
import {
  Loader2, CheckCircle2, Clock, AlertTriangle, FileText, Search,
  ChevronDown, ChevronRight, DollarSign, TrendingDown, Activity, Target,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";

interface MonthlyRealisationTabProps {
  projectName: string;
}

interface MonthItem {
  id: number;
  category: string | null;
  lineItem: string | null;
  amount: number;
  invoiceNumber: string | null;
  poNumber: string | null;
  invoiceDate: string | null;
  supplier: string | null;
  isRealised: boolean;
  cosStatus: string;
  paymentDate: string | null;
}

interface ProjectMonthData {
  monthKey: string;
  monthLabel: string;
  totalCOS: number;
  realisedCOS: number;
  unrealisedCOS: number;
  budget: number;
  variance: number;
  variancePct: number;
  ytdCOS: number;
  ytdRealised: number;
  ytdUnrealised: number;
  ytdBudget: number;
  ytdVariance: number;
  ytdVariancePct: number;
  itemCount: number;
  realisedCount: number;
  items: MonthItem[];
}

function formatRand(val: number | null | undefined): string {
  if (val == null || val === 0) return "R 0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

function formatRandFull(val: number): string {
  if (val === 0) return "-";
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
}

const ROW_DEFS: {
  key: string;
  label: string;
  dataKey: keyof ProjectMonthData;
  colorClass: string;
  group: "monthly" | "ytd";
  colorCoded?: boolean;
  clickable?: boolean;
}[] = [
  { key: "totalCOS", label: "COS (Finance)", dataKey: "totalCOS", colorClass: "text-foreground font-bold", group: "monthly", clickable: true },
  { key: "realisedCOS", label: "Realised COS", dataKey: "realisedCOS", colorClass: "text-foreground font-bold", group: "monthly", clickable: true },
  { key: "unrealisedCOS", label: "Unrealised COS", dataKey: "unrealisedCOS", colorClass: "text-red-600 font-semibold", group: "monthly", clickable: true },
  { key: "budget", label: "Costed", dataKey: "budget", colorClass: "text-purple-600", group: "monthly" },
  { key: "variance", label: "Variance", dataKey: "variance", colorClass: "", group: "monthly", colorCoded: true },
  { key: "variancePct", label: "Variance %", dataKey: "variancePct", colorClass: "", group: "monthly", colorCoded: true },
  { key: "ytdCOS", label: "YTD COS", dataKey: "ytdCOS", colorClass: "text-foreground font-bold", group: "ytd" },
  { key: "ytdRealised", label: "YTD Realised", dataKey: "ytdRealised", colorClass: "text-foreground font-bold", group: "ytd" },
  { key: "ytdUnrealised", label: "YTD Unrealised", dataKey: "ytdUnrealised", colorClass: "text-red-600", group: "ytd" },
  { key: "ytdBudget", label: "YTD Costed", dataKey: "ytdBudget", colorClass: "text-purple-600", group: "ytd" },
  { key: "ytdVariance", label: "YTD Variance", dataKey: "ytdVariance", colorClass: "", group: "ytd", colorCoded: true },
  { key: "ytdVariancePct", label: "YTD Variance %", dataKey: "ytdVariancePct", colorClass: "", group: "ytd", colorCoded: true },
];

function MonthDetailDrawer({ month, onClose, defaultFilter = "all" }: { month: ProjectMonthData; onClose: () => void; defaultFilter?: "all" | "realised" | "unrealised" }) {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"all" | "realised" | "unrealised">(defaultFilter);

  const filtered = useMemo(() => {
    let items = month.items || [];
    if (stateFilter === "realised") items = items.filter(i => i.isRealised);
    if (stateFilter === "unrealised") items = items.filter(i => !i.isRealised);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(i =>
        (i.category || "").toLowerCase().includes(q) ||
        (i.lineItem || "").toLowerCase().includes(q) ||
        (i.invoiceNumber || "").toLowerCase().includes(q) ||
        (i.poNumber || "").toLowerCase().includes(q) ||
        (i.supplier || "").toLowerCase().includes(q)
      );
    }
    return items;
  }, [month.items, search, stateFilter]);

  const filteredRealised = filtered.filter(i => i.isRealised).reduce((s, i) => s + i.amount, 0);
  const filteredUnrealised = filtered.filter(i => !i.isRealised).reduce((s, i) => s + i.amount, 0);

  const statusBadge = (status: string) => {
    switch (status) {
      case 'Realised': return 'bg-green-50 text-green-700 border-green-200';
      case 'Invoiced': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Committed': return 'bg-amber-50 text-amber-700 border-amber-200';
      default: return 'bg-slate-50 text-slate-600 border-slate-200';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="drawer-project-month-detail">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="ml-auto relative w-full max-w-4xl bg-background shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300">
        <div className="px-6 py-5 border-b bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
          <div>
            <h3 className="font-bold text-xl tracking-tight" data-testid="text-drawer-title">{month.monthLabel}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {month.itemCount} line items · {formatRand(month.totalCOS)}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors" data-testid="button-close-drawer">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <div className="px-6 py-4 border-b bg-gradient-to-b from-slate-50/50 to-transparent">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/50 border border-border/60 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Realised</p>
              <p className="font-mono font-black text-foreground text-lg mt-0.5" data-testid="text-drawer-realised">{formatRand(filteredRealised)}</p>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-red-50 to-red-100/50 border border-red-200/60 px-4 py-3">
              <p className="text-xs font-medium text-red-600 uppercase tracking-wider">Unrealised</p>
              <p className="font-mono font-bold text-red-700 text-lg mt-0.5" data-testid="text-drawer-unrealised">{formatRand(filteredUnrealised)}</p>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/50 border border-border/60 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total</p>
              <p className="font-mono font-bold text-foreground text-lg mt-0.5">{formatRand(filteredRealised + filteredUnrealised)}</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-b flex items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search category, description, invoice, supplier..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
              data-testid="input-drawer-search"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as any)}
            className="h-9 px-3 text-sm border border-border rounded-lg bg-muted/50 hover:bg-card transition-colors cursor-pointer"
            data-testid="select-drawer-filter"
          >
            <option value="all">All</option>
            <option value="realised">Realised</option>
            <option value="unrealised">Unrealised</option>
          </select>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Search className="h-8 w-8 text-slate-400" />
              <span className="text-sm">No line items found</span>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card/95 backdrop-blur-md z-10 border-b">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Category</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Description</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Supplier</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Invoice #</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">PO #</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Status</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/40 transition-colors" data-testid={`drawer-item-${item.id}`}>
                    <td className="px-4 py-2.5 text-muted-foreground max-w-[120px] truncate">{item.category || "—"}</td>
                    <td className="px-4 py-2.5 text-foreground max-w-[180px] truncate font-medium">{item.lineItem || "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground max-w-[120px] truncate">{item.supplier || "—"}</td>
                    <td className="px-4 py-2.5">
                      {item.invoiceNumber ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">{item.invoiceNumber}</span>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {item.poNumber ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-50 text-green-700 border border-green-200">{item.poNumber}</span>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusBadge(item.cosStatus)}`}>
                        {item.cosStatus}
                      </span>
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono font-semibold ${item.isRealised ? 'text-foreground' : 'text-red-600'}`}>
                      {formatRandFull(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/80">
                  <td className="px-4 py-3 font-bold text-sm" colSpan={6}>Total</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-sm">{formatRandFull(filtered.reduce((s, i) => s + i.amount, 0))}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export function MonthlyRealisationTab({ projectName }: MonthlyRealisationTabProps) {
  const [drawerMonth, setDrawerMonth] = useState<{ month: ProjectMonthData; defaultFilter: "all" | "realised" | "unrealised" } | null>(null);

  const { data: months = [], isLoading } = useQuery<ProjectMonthData[]>({
    queryKey: ["cos-tracker-project", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/cos-tracker/project/${encodeURIComponent(projectName)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!projectName,
  });

  const lastMonth = useMemo(() => months.length > 0 ? months[months.length - 1] : null, [months]);

  const hasData = useMemo(() => months.some(m => m.totalCOS > 0 || m.budget > 0), [months]);

  const chartData = useMemo(
    () => months.map((m) => ({
      month: m.monthLabel,
      "Realised": m.realisedCOS,
      "Unrealised": m.unrealisedCOS,
      Costed: m.budget,
    })),
    [months],
  );

  const getCellColor = useCallback((val: number, variancePct?: number) => {
    const pct = variancePct != null ? Math.abs(variancePct) : null;
    const isPositive = val > 0;
    if (pct !== null) {
      if (pct >= 0.25) return isPositive ? "text-red-700 font-bold bg-red-50" : "text-green-700 font-bold bg-green-50";
      if (pct >= 0.15) return isPositive ? "text-amber-600 font-semibold bg-amber-50" : "text-green-600 font-semibold bg-green-50";
    }
    return isPositive ? "text-red-600" : "text-green-600";
  }, []);

  const formatCell = useCallback((row: (typeof ROW_DEFS)[number], val: number) => {
    if (row.key === "variancePct" || row.key === "ytdVariancePct") {
      return `${(val * 100).toFixed(1)}%`;
    }
    return formatRand(val);
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3" data-testid="loading-cos-tracker">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
        <span className="text-sm font-medium">Loading COS data...</span>
      </div>
    );
  }

  if (!hasData) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-12">
          <p className="text-center text-muted-foreground" data-testid="no-cos-data">
            No expenditure data available. Import a tracker file to populate the COS tracker.
          </p>
        </CardContent>
      </Card>
    );
  }

  const kpiCards = [
    { id: "ytd-cos", label: "YTD COS (Finance)", value: formatRand(lastMonth?.ytdCOS ?? 0), icon: DollarSign, iconBg: "bg-muted", iconColor: "text-muted-foreground", valueColor: "text-foreground", borderColor: "" },
    { id: "ytd-realised", label: "YTD Realised (Paid)", value: formatRand(lastMonth?.ytdRealised ?? 0), icon: TrendingDown, iconBg: "bg-muted", iconColor: "text-foreground", valueColor: "text-foreground font-black", borderColor: "border-border" },
    { id: "ytd-unrealised", label: "YTD Unrealised", value: formatRand(lastMonth?.ytdUnrealised ?? 0), icon: Activity, iconBg: "bg-red-100", iconColor: "text-red-600", valueColor: "text-red-600", borderColor: "border-red-200" },
    { id: "ytd-costed", label: "YTD Costed", value: formatRand(lastMonth?.ytdBudget ?? 0), icon: Target, iconBg: "bg-purple-100", iconColor: "text-purple-600", valueColor: "text-purple-700", borderColor: "" },
    {
      id: "ytd-variance", label: "YTD Variance", value: formatRand(lastMonth?.ytdVariance ?? 0),
      icon: TrendingDown,
      iconBg: (lastMonth?.ytdVariance ?? 0) <= 0 ? "bg-green-100" : "bg-red-100",
      iconColor: (lastMonth?.ytdVariance ?? 0) <= 0 ? "text-green-600" : "text-red-600",
      valueColor: (lastMonth?.ytdVariance ?? 0) <= 0 ? "text-green-600" : "text-red-600",
      borderColor: (lastMonth?.ytdVariance ?? 0) <= 0 ? "border-green-200" : "border-red-200",
    },
    {
      id: "ytd-variance-pct", label: "Realised %",
      value: (lastMonth?.ytdCOS ?? 0) > 0 ? `${((lastMonth?.ytdRealised ?? 0) / (lastMonth?.ytdCOS ?? 1) * 100).toFixed(1)}%` : "0.0%",
      icon: Target,
      iconBg: ((lastMonth?.ytdRealised ?? 0) / Math.max(lastMonth?.ytdCOS ?? 1, 1)) >= 0.5 ? "bg-green-100" : "bg-amber-100",
      iconColor: ((lastMonth?.ytdRealised ?? 0) / Math.max(lastMonth?.ytdCOS ?? 1, 1)) >= 0.5 ? "text-green-600" : "text-amber-600",
      valueColor: ((lastMonth?.ytdRealised ?? 0) / Math.max(lastMonth?.ytdCOS ?? 1, 1)) >= 0.5 ? "text-green-600" : "text-amber-700",
      borderColor: ((lastMonth?.ytdRealised ?? 0) / Math.max(lastMonth?.ytdCOS ?? 1, 1)) >= 0.5 ? "border-green-200" : "border-amber-200",
    },
  ];

  return (
    <div className="space-y-6" data-testid="cos-tracker-tab">
      <Card className="border-amber-200/80 bg-gradient-to-r from-amber-50 to-amber-50/30 shadow-sm" data-testid="card-cos-guidance">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="rounded-xl bg-amber-200/60 p-2.5 mt-0.5 shrink-0">
            <Activity className="h-5 w-5 text-amber-700" />
          </div>
          <div>
            <p className="font-semibold text-amber-900 text-sm">COS Realisation Guide</p>
            <p className="text-sm text-amber-700/90 mt-0.5 leading-relaxed">
              COS is "Realised" when the line item has an Invoice Number AND the Invoice Raised Date has <strong className="text-foreground">black font colour</strong> (paid). <strong className="text-red-600">Red font</strong> = not yet paid. Click any month cell to see individual line items.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpiCards.map((kpi) => (
          <Card key={kpi.id} className={`shadow-sm hover:shadow-md transition-shadow ${kpi.borderColor}`} data-testid={`card-${kpi.id}`}>
            <CardContent className="pt-5 pb-4 px-4">
              <div className="flex items-start gap-3">
                <div className={`rounded-xl ${kpi.iconBg} p-2.5 shrink-0`}>
                  <kpi.icon className={`h-5 w-5 ${kpi.iconColor}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground truncate">{kpi.label}</p>
                  <p className={`text-xl font-bold font-mono mt-0.5 ${kpi.valueColor}`} data-testid={`text-${kpi.id}-value`}>
                    {kpi.value}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-white border-b px-6 py-4">
          <CardTitle className="text-lg font-semibold tracking-tight">COS Overview — {projectName}</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="h-[320px]" data-testid="chart-project-cos">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                <YAxis tickFormatter={(v: number) => formatRand(v)} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(value: number) => formatRand(value)}
                  contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }} />
                <Bar dataKey="Realised" stackId="cos" fill="#1e293b" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Unrealised" stackId="cos" fill="#dc2626" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Costed" fill="#a855f7" opacity={0.3} radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-white border-b px-6 py-4">
          <CardTitle className="text-lg font-semibold tracking-tight">Monthly COS Grid</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-project-cos-grid">
              <thead>
                <tr className="border-b bg-muted/80">
                  <th className="sticky left-0 z-10 bg-muted/95 backdrop-blur-sm px-5 py-3 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[11px] min-w-[180px] border-r border-border">
                    Metric
                  </th>
                  {months.map((m) => (
                    <th key={m.monthKey} className="px-4 py-3 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[100px]">
                      {m.monthLabel}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROW_DEFS.map((row, rowIdx) => {
                  const isYtd = row.group === "ytd";
                  const isClickable = row.clickable;
                  const isFirstYtd = isYtd && rowIdx > 0 && ROW_DEFS[rowIdx - 1].group !== "ytd";
                  return (
                    <React.Fragment key={row.key}>
                      {isFirstYtd && (
                        <tr>
                          <td colSpan={months.length + 1} className="bg-muted/60 h-px" />
                        </tr>
                      )}
                      <tr
                        className={`border-b border-border transition-colors ${isYtd ? "bg-muted/40" : "bg-card"} hover:bg-muted/40`}
                        data-testid={`row-${row.key}`}
                      >
                        <td className={`sticky left-0 z-10 px-5 py-2.5 font-medium text-sm border-r border-border ${isYtd ? "bg-muted/95 pl-8 text-muted-foreground" : "bg-card/95"} backdrop-blur-sm`}>
                          {row.label}
                        </td>
                        {months.map((m) => {
                          const val = m[row.dataKey] as number;
                          const pctRef = (row.key === "variance") ? m.variancePct : (row.key === "ytdVariance") ? m.ytdVariancePct : (row.key === "variancePct" || row.key === "ytdVariancePct") ? val : undefined;
                          const colorClass = row.colorCoded ? getCellColor(val, pctRef) : row.colorClass;

                          return (
                            <td
                              key={m.monthKey}
                              className={`px-4 py-2.5 text-right font-mono text-sm ${colorClass} ${isClickable && val !== 0 ? "cursor-pointer hover:bg-blue-50/80 hover:underline decoration-blue-300 underline-offset-2 transition-colors rounded" : ""}`}
                              onClick={isClickable && val !== 0 ? () => setDrawerMonth({
                                month: m,
                                defaultFilter: row.key === 'realisedCOS' ? 'realised' : row.key === 'unrealisedCOS' ? 'unrealised' : 'all'
                              }) : undefined}
                              data-testid={`cell-${row.key}-${m.monthKey}`}
                            >
                              {formatCell(row, val)}
                            </td>
                          );
                        })}
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {drawerMonth && (
        <MonthDetailDrawer
          key={`${drawerMonth.month.monthKey}-${drawerMonth.defaultFilter}`}
          month={drawerMonth.month}
          defaultFilter={drawerMonth.defaultFilter}
          onClose={() => setDrawerMonth(null)}
        />
      )}
    </div>
  );
}