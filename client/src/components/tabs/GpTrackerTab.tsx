import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Loader2, Search, DollarSign, TrendingUp, Activity, Target, X, Percent,
} from "lucide-react";
import { Input } from "@/components/ui/input";

interface GpTrackerTabProps {
  projectName: string;
}

interface GpItem {
  id: number;
  category: string | null;
  lineItem: string | null;
  costAmount: number;
  revenueAmount: number;
  gpAmount: number;
  invoiceNumber: string | null;
  poNumber: string | null;
  invoiceDate: string | null;
  supplier: string | null;
  isRealised: boolean;
  noRevenueLinked: boolean;
}

interface GpMonthData {
  monthKey: string;
  monthLabel: string;
  totalRevenue: number;
  totalCOS: number;
  totalGP: number;
  realisedGP: number;
  unrealisedGP: number;
  gpPct: number;
  ytdRevenue: number;
  ytdCOS: number;
  ytdGP: number;
  ytdRealisedGP: number;
  ytdUnrealisedGP: number;
  ytdGpPct: number;
  itemCount: number;
  realisedCount: number;
  items: GpItem[];
}

interface GpTrackerResponse {
  months: GpMonthData[];
  totalMilestoneRevenue: number;
  totalCOS: number;
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
  dataKey: keyof GpMonthData;
  colorClass: string;
  group: "monthly" | "ytd";
  clickable?: boolean;
  colorCoded?: boolean;
  isPct?: boolean;
}[] = [
  { key: "totalRevenue", label: "Revenue", dataKey: "totalRevenue", colorClass: "text-blue-700 font-bold", group: "monthly", clickable: true },
  { key: "totalCOS", label: "COS", dataKey: "totalCOS", colorClass: "text-red-600 font-bold", group: "monthly", clickable: true },
  { key: "totalGP", label: "Gross Profit", dataKey: "totalGP", colorClass: "text-foreground font-black", group: "monthly", colorCoded: true, clickable: true },
  { key: "realisedGP", label: "Realised GP", dataKey: "realisedGP", colorClass: "text-emerald-700 font-bold", group: "monthly", clickable: true },
  { key: "unrealisedGP", label: "Unrealised GP", dataKey: "unrealisedGP", colorClass: "text-amber-600 font-semibold", group: "monthly", clickable: true },
  { key: "gpPct", label: "GP %", dataKey: "gpPct", colorClass: "", group: "monthly", colorCoded: true, isPct: true },
  { key: "ytdRevenue", label: "YTD Revenue", dataKey: "ytdRevenue", colorClass: "text-blue-700 font-bold", group: "ytd" },
  { key: "ytdCOS", label: "YTD COS", dataKey: "ytdCOS", colorClass: "text-red-600 font-bold", group: "ytd" },
  { key: "ytdGP", label: "YTD Gross Profit", dataKey: "ytdGP", colorClass: "text-foreground font-black", group: "ytd", colorCoded: true },
  { key: "ytdRealisedGP", label: "YTD Realised GP", dataKey: "ytdRealisedGP", colorClass: "text-emerald-700 font-bold", group: "ytd" },
  { key: "ytdUnrealisedGP", label: "YTD Unrealised GP", dataKey: "ytdUnrealisedGP", colorClass: "text-amber-600", group: "ytd" },
  { key: "ytdGpPct", label: "YTD GP %", dataKey: "ytdGpPct", colorClass: "", group: "ytd", colorCoded: true, isPct: true },
];

function GpDetailDrawer({ month, onClose, defaultFilter = "all" }: { month: GpMonthData; onClose: () => void; defaultFilter?: "all" | "realised" | "unrealised" }) {
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

  const filteredRevenue = filtered.reduce((s, i) => s + i.revenueAmount, 0);
  const filteredCOS = filtered.reduce((s, i) => s + i.costAmount, 0);
  const filteredGP = filteredRevenue - filteredCOS;

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="drawer-gp-month-detail">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="ml-auto relative w-full max-w-4xl bg-white shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300">
        <div className="px-6 py-5 border-b bg-gradient-to-r from-emerald-50 to-white flex items-center justify-between">
          <div>
            <h3 className="font-bold text-xl tracking-tight text-slate-900" data-testid="text-gp-drawer-title">{month.monthLabel} — Gross Profit</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              {month.itemCount} line items · GP: {formatRand(month.totalGP)}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors" data-testid="button-close-gp-drawer">
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <div className="px-6 py-4 border-b bg-gradient-to-b from-emerald-50/30 to-white">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-200/60 px-4 py-3">
              <p className="text-xs font-medium text-blue-600 uppercase tracking-wider">Revenue</p>
              <p className="font-mono font-black text-blue-800 text-lg mt-0.5">{formatRand(filteredRevenue)}</p>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-red-50 to-red-100/50 border border-red-200/60 px-4 py-3">
              <p className="text-xs font-medium text-red-600 uppercase tracking-wider">COS</p>
              <p className="font-mono font-bold text-red-700 text-lg mt-0.5">{formatRand(filteredCOS)}</p>
            </div>
            <div className={`rounded-xl bg-gradient-to-br ${filteredGP >= 0 ? 'from-emerald-50 to-emerald-100/50 border-emerald-200/60' : 'from-red-50 to-red-100/50 border-red-200/60'} border px-4 py-3`}>
              <p className={`text-xs font-medium uppercase tracking-wider ${filteredGP >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>Gross Profit</p>
              <p className={`font-mono font-bold text-lg mt-0.5 ${filteredGP >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>{formatRand(filteredGP)}</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-b flex items-center gap-2 bg-white">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search category, description, invoice, supplier..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
              data-testid="input-gp-drawer-search"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as any)}
            className="h-9 px-3 text-sm border border-slate-200 rounded-lg bg-slate-50 hover:bg-white transition-colors cursor-pointer"
            data-testid="select-gp-drawer-filter"
          >
            <option value="all">All</option>
            <option value="realised">Realised</option>
            <option value="unrealised">Unrealised</option>
          </select>
        </div>

        <div className="flex-1 overflow-y-auto bg-white">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
              <Search className="h-8 w-8 text-slate-300" />
              <span className="text-sm">No line items found</span>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white/95 backdrop-blur-md z-10 border-b">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Category</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Description</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Supplier</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Status</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Revenue</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">COS</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">GP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((item) => {
                  const gp = item.revenueAmount - item.costAmount;
                  return (
                    <tr key={item.id} className="hover:bg-emerald-50/30 transition-colors" data-testid={`gp-drawer-item-${item.id}`}>
                      <td className="px-4 py-2.5 text-slate-500 max-w-[120px] truncate">{item.category || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-900 max-w-[180px] truncate font-medium">{item.lineItem || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-500 max-w-[120px] truncate">{item.supplier || "—"}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          item.isRealised
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>
                          {item.isRealised ? 'Realised' : 'Unrealised'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-blue-600 text-[11px]">
                        {formatRandFull(item.revenueAmount)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-red-600 text-[11px]">
                        {formatRandFull(item.costAmount)}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono font-semibold text-[11px] ${gp >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        {formatRandFull(gp)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td className="px-4 py-3 font-bold text-sm text-slate-900" colSpan={4}>Total</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-sm text-blue-700">{formatRandFull(filteredRevenue)}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-sm text-red-600">{formatRandFull(filteredCOS)}</td>
                  <td className={`px-4 py-3 text-right font-mono font-bold text-sm ${filteredGP >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatRandFull(filteredGP)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export function GpTrackerTab({ projectName }: GpTrackerTabProps) {
  const [drawerMonth, setDrawerMonth] = useState<{ month: GpMonthData; defaultFilter: "all" | "realised" | "unrealised" } | null>(null);

  const { data, isLoading } = useQuery<GpTrackerResponse>({
    queryKey: ["gp-tracker-project", projectName],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/gp-tracker/project/${encodeURIComponent(projectName)}`, {
        credentials: "include",
        headers,
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!projectName,
  });

  const months = data?.months ?? [];
  const totalMilestoneRevenue = data?.totalMilestoneRevenue ?? 0;
  const totalCOS = data?.totalCOS ?? 0;

  const lastMonth = useMemo(() => months.length > 0 ? months[months.length - 1] : null, [months]);

  const hasData = useMemo(() => months.some(m => m.totalGP !== 0 || m.totalRevenue > 0 || m.totalCOS > 0), [months]);

  const chartData = useMemo(
    () => months.map((m) => ({
      month: m.monthLabel,
      "Revenue": m.totalRevenue,
      "COS": m.totalCOS,
      "Gross Profit": m.totalGP,
      "YTD GP %": m.ytdGpPct,
    })),
    [months],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3" data-testid="loading-gp-tracker">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
        <span className="text-sm font-medium">Loading GP data...</span>
      </div>
    );
  }

  if (!hasData) {
    return (
      <Card className="shadow-sm bg-white">
        <CardContent className="py-12">
          <p className="text-center text-slate-500" data-testid="no-gp-data">
            No GP data available. Import a tracker file to populate the GP tracker.
          </p>
        </CardContent>
      </Card>
    );
  }

  const overallGP = totalMilestoneRevenue - totalCOS;
  const overallGpPct = totalMilestoneRevenue !== 0 ? (overallGP / totalMilestoneRevenue) * 100 : 0;
  const ytdGP = lastMonth?.ytdGP ?? 0;
  const ytdGpPct = lastMonth?.ytdGpPct ?? 0;

  const kpiCards = [
    {
      id: "total-revenue",
      label: "Total Revenue",
      value: formatRand(totalMilestoneRevenue),
      icon: DollarSign,
      iconBg: "bg-blue-50",
      iconColor: "text-blue-600",
      valueColor: "text-blue-700 font-black",
      borderColor: "border-blue-200",
    },
    {
      id: "total-cos",
      label: "Total COS",
      value: formatRand(totalCOS),
      icon: TrendingUp,
      iconBg: "bg-red-50",
      iconColor: "text-red-600",
      valueColor: "text-red-600 font-black",
      borderColor: "border-red-200",
    },
    {
      id: "overall-gp",
      label: "Overall GP",
      value: formatRand(overallGP),
      icon: Target,
      iconBg: overallGP >= 0 ? "bg-emerald-50" : "bg-red-50",
      iconColor: overallGP >= 0 ? "text-emerald-600" : "text-red-600",
      valueColor: overallGP >= 0 ? "text-emerald-600 font-black" : "text-red-600 font-black",
      borderColor: overallGP >= 0 ? "border-emerald-200" : "border-red-200",
    },
    {
      id: "overall-gp-pct",
      label: "Overall GP %",
      value: `${overallGpPct.toFixed(1)}%`,
      icon: Percent,
      iconBg: overallGpPct >= 20 ? "bg-emerald-50" : overallGpPct >= 0 ? "bg-amber-50" : "bg-red-50",
      iconColor: overallGpPct >= 20 ? "text-emerald-600" : overallGpPct >= 0 ? "text-amber-600" : "text-red-600",
      valueColor: overallGpPct >= 20 ? "text-emerald-600" : overallGpPct >= 0 ? "text-amber-600" : "text-red-600",
      borderColor: overallGpPct >= 20 ? "border-emerald-200" : overallGpPct >= 0 ? "border-amber-200" : "border-red-200",
    },
    {
      id: "ytd-gp",
      label: "YTD GP",
      value: formatRand(ytdGP),
      icon: Activity,
      iconBg: ytdGP >= 0 ? "bg-emerald-50" : "bg-red-50",
      iconColor: ytdGP >= 0 ? "text-emerald-600" : "text-red-600",
      valueColor: ytdGP >= 0 ? "text-emerald-600" : "text-red-600",
      borderColor: ytdGP >= 0 ? "border-emerald-200" : "border-red-200",
    },
    {
      id: "ytd-gp-pct",
      label: "YTD GP %",
      value: `${ytdGpPct.toFixed(1)}%`,
      icon: Percent,
      iconBg: ytdGpPct >= 20 ? "bg-emerald-50" : ytdGpPct >= 0 ? "bg-amber-50" : "bg-red-50",
      iconColor: ytdGpPct >= 20 ? "text-emerald-600" : ytdGpPct >= 0 ? "text-amber-600" : "text-red-600",
      valueColor: ytdGpPct >= 20 ? "text-emerald-600" : ytdGpPct >= 0 ? "text-amber-600" : "text-red-600",
      borderColor: ytdGpPct >= 20 ? "border-emerald-200" : ytdGpPct >= 0 ? "border-amber-200" : "border-red-200",
    },
  ];

  return (
    <div className="space-y-6" data-testid="gp-tracker-tab">
      <Card className="border-emerald-200/80 bg-gradient-to-r from-emerald-50 to-emerald-50/30 shadow-sm" data-testid="card-gp-guidance">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="rounded-xl bg-emerald-200/60 p-2.5 mt-0.5 shrink-0">
            <TrendingUp className="h-5 w-5 text-emerald-700" />
          </div>
          <div>
            <p className="font-semibold text-emerald-900 text-sm">GP Tracker Guide</p>
            <p className="text-sm text-emerald-700/90 mt-0.5 leading-relaxed">
              Gross Profit = Revenue - COS. Revenue is calculated from COS realisation using the formula: revenue = (item_cost / total_COS) x total_milestone_revenue. Click any month cell to see the line item breakdown.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpiCards.map((kpi) => (
          <Card key={kpi.id} className={`shadow-sm hover:shadow-md transition-shadow bg-white ${kpi.borderColor}`} data-testid={`card-${kpi.id}`}>
            <CardContent className="pt-5 pb-4 px-4">
              <div className="flex items-start gap-3">
                <div className={`rounded-xl ${kpi.iconBg} p-2.5 shrink-0`}>
                  <kpi.icon className={`h-5 w-5 ${kpi.iconColor}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500 truncate">{kpi.label}</p>
                  <p className={`text-xl font-bold font-mono mt-0.5 ${kpi.valueColor}`} data-testid={`text-${kpi.id}-value`}>
                    {kpi.value}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shadow-sm overflow-hidden bg-white">
        <CardHeader className="bg-gradient-to-r from-emerald-50 to-white border-b px-6 py-4">
          <CardTitle className="text-lg font-semibold tracking-tight text-slate-900">GP Overview — {projectName}</CardTitle>
        </CardHeader>
        <CardContent className="p-6 bg-white">
          <div className="h-[320px]" data-testid="chart-project-gp">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                <YAxis yAxisId="left" tickFormatter={(v: number) => formatRand(v)} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => `${v.toFixed(0)}%`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(value: number, name: string) => name === "YTD GP %" ? `${value.toFixed(1)}%` : formatRand(value)}
                  contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px', backgroundColor: '#fff' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }} />
                <Bar yAxisId="left" dataKey="Revenue" fill="#3b82f6" opacity={0.4} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="left" dataKey="COS" fill="#ef4444" opacity={0.4} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="left" dataKey="Gross Profit" fill="#059669" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="YTD GP %" stroke="#7c3aed" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm overflow-hidden bg-white">
        <CardHeader className="bg-gradient-to-r from-emerald-50 to-white border-b px-6 py-4">
          <CardTitle className="text-lg font-semibold tracking-tight text-slate-900">Monthly GP Grid</CardTitle>
        </CardHeader>
        <CardContent className="p-0 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-project-gp-grid">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="sticky left-0 z-10 bg-slate-50 px-5 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider text-[11px] min-w-[180px] border-r border-slate-200">
                    Metric
                  </th>
                  {months.map((m) => (
                    <th key={m.monthKey} className="px-4 py-3 text-right font-semibold text-slate-500 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[100px]">
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
                          <td colSpan={months.length + 1} className="bg-slate-100 h-px" />
                        </tr>
                      )}
                      <tr
                        className={`border-b border-slate-100 transition-colors ${isYtd ? "bg-slate-50/60" : "bg-white"} hover:bg-emerald-50/30`}
                        data-testid={`row-gp-${row.key}`}
                      >
                        <td className={`sticky left-0 z-10 px-5 py-2.5 font-medium text-sm border-r border-slate-200 ${isYtd ? "bg-slate-50 pl-8 text-slate-500" : "bg-white text-slate-900"}`}>
                          {row.label}
                        </td>
                        {months.map((m) => {
                          const val = m[row.dataKey] as number;
                          const colorCodedClass = row.colorCoded
                            ? val < 0 ? "text-red-600 font-semibold" : val > 0 ? "text-green-600 font-semibold" : "text-slate-500"
                            : row.colorClass;
                          const displayVal = row.isPct ? `${val.toFixed(1)}%` : formatRand(val);
                          return (
                            <td
                              key={m.monthKey}
                              className={`px-4 py-2.5 text-right font-mono text-sm ${colorCodedClass} ${isClickable && val !== 0 ? "cursor-pointer hover:bg-emerald-50 hover:underline decoration-emerald-300 underline-offset-2 transition-colors rounded" : ""}`}
                              onClick={isClickable && val !== 0 ? () => setDrawerMonth({
                                month: m,
                                defaultFilter: row.key === 'realisedGP' ? 'realised' : row.key === 'unrealisedGP' ? 'unrealised' : 'all'
                              }) : undefined}
                              data-testid={`cell-gp-${row.key}-${m.monthKey}`}
                            >
                              {displayVal}
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
        <GpDetailDrawer
          key={`${drawerMonth.month.monthKey}-${drawerMonth.defaultFilter}`}
          month={drawerMonth.month}
          onClose={() => setDrawerMonth(null)}
          defaultFilter={drawerMonth.defaultFilter}
        />
      )}
    </div>
  );
}
