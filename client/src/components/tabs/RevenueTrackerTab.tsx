import React, { useMemo, useState, useCallback } from "react";
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
  Loader2, Search, DollarSign, TrendingUp, Activity, Target, X,
} from "lucide-react";
import { Input } from "@/components/ui/input";

interface RevenueTrackerTabProps {
  projectName: string;
}

interface RevenueItem {
  id: number;
  category: string | null;
  lineItem: string | null;
  costAmount: number;
  revenueAmount: number;
  invoiceNumber: string | null;
  poNumber: string | null;
  invoiceDate: string | null;
  supplier: string | null;
  isRealised: boolean;
  noRevenueLinked: boolean;
}

interface RevenueMonthData {
  monthKey: string;
  monthLabel: string;
  totalRevenue: number;
  realisedRevenue: number;
  unrealisedRevenue: number;
  ytdRevenue: number;
  ytdRealised: number;
  ytdUnrealised: number;
  itemCount: number;
  realisedCount: number;
  items: RevenueItem[];
}

interface RevenueTrackerResponse {
  months: RevenueMonthData[];
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
  dataKey: keyof RevenueMonthData;
  colorClass: string;
  group: "monthly" | "ytd";
  clickable?: boolean;
}[] = [
  { key: "totalRevenue", label: "Revenue", dataKey: "totalRevenue", colorClass: "text-foreground font-bold", group: "monthly", clickable: true },
  { key: "realisedRevenue", label: "Realised Revenue", dataKey: "realisedRevenue", colorClass: "text-emerald-700 font-bold", group: "monthly", clickable: true },
  { key: "unrealisedRevenue", label: "Unrealised Revenue", dataKey: "unrealisedRevenue", colorClass: "text-amber-600 font-semibold", group: "monthly", clickable: true },
  { key: "ytdRevenue", label: "YTD Revenue", dataKey: "ytdRevenue", colorClass: "text-foreground font-bold", group: "ytd" },
  { key: "ytdRealised", label: "YTD Realised", dataKey: "ytdRealised", colorClass: "text-emerald-700 font-bold", group: "ytd" },
  { key: "ytdUnrealised", label: "YTD Unrealised", dataKey: "ytdUnrealised", colorClass: "text-amber-600", group: "ytd" },
];

function RevenueDetailDrawer({ month, onClose, defaultFilter = "all" }: { month: RevenueMonthData; onClose: () => void; defaultFilter?: "all" | "realised" | "unrealised" }) {
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

  const filteredRealised = filtered.filter(i => i.isRealised).reduce((s, i) => s + i.revenueAmount, 0);
  const filteredUnrealised = filtered.filter(i => !i.isRealised).reduce((s, i) => s + i.revenueAmount, 0);

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="drawer-revenue-month-detail">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="ml-auto relative w-full max-w-4xl bg-white shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300">
        <div className="px-6 py-5 border-b bg-gradient-to-r from-emerald-50 to-white flex items-center justify-between">
          <div>
            <h3 className="font-bold text-xl tracking-tight text-slate-900" data-testid="text-revenue-drawer-title">{month.monthLabel}</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              {month.itemCount} line items · {formatRand(month.totalRevenue)}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors" data-testid="button-close-revenue-drawer">
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <div className="px-6 py-4 border-b bg-gradient-to-b from-emerald-50/30 to-white">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-200/60 px-4 py-3">
              <p className="text-xs font-medium text-emerald-600 uppercase tracking-wider">Realised</p>
              <p className="font-mono font-black text-emerald-800 text-lg mt-0.5" data-testid="text-revenue-drawer-realised">{formatRand(filteredRealised)}</p>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-amber-50 to-amber-100/50 border border-amber-200/60 px-4 py-3">
              <p className="text-xs font-medium text-amber-600 uppercase tracking-wider">Unrealised</p>
              <p className="font-mono font-bold text-amber-700 text-lg mt-0.5" data-testid="text-revenue-drawer-unrealised">{formatRand(filteredUnrealised)}</p>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/50 border border-slate-200/60 px-4 py-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total</p>
              <p className="font-mono font-bold text-slate-900 text-lg mt-0.5">{formatRand(filteredRealised + filteredUnrealised)}</p>
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
              data-testid="input-revenue-drawer-search"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as any)}
            className="h-9 px-3 text-sm border border-slate-200 rounded-lg bg-slate-50 hover:bg-white transition-colors cursor-pointer"
            data-testid="select-revenue-drawer-filter"
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
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Invoice #</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">PO #</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Status</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Cost</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-emerald-50/30 transition-colors" data-testid={`revenue-drawer-item-${item.id}`}>
                    <td className="px-4 py-2.5 text-slate-500 max-w-[120px] truncate">{item.category || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-900 max-w-[180px] truncate font-medium">{item.lineItem || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-500 max-w-[120px] truncate">{item.supplier || "—"}</td>
                    <td className="px-4 py-2.5">
                      {item.invoiceNumber ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">{item.invoiceNumber}</span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {item.poNumber ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-50 text-green-700 border border-green-200">{item.poNumber}</span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        item.isRealised
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : item.noRevenueLinked
                            ? 'bg-slate-50 text-slate-500 border-slate-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        {item.isRealised ? 'Realised' : item.noRevenueLinked ? 'No Revenue' : 'Unrealised'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-500 text-[11px]">
                      {formatRandFull(item.costAmount)}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono font-semibold ${item.isRealised ? 'text-emerald-700' : 'text-amber-600'}`}>
                      {formatRandFull(item.revenueAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td className="px-4 py-3 font-bold text-sm text-slate-900" colSpan={6}>Total</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-sm text-slate-500">{formatRandFull(filtered.reduce((s, i) => s + i.costAmount, 0))}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-sm text-slate-900">{formatRandFull(filtered.reduce((s, i) => s + i.revenueAmount, 0))}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export function RevenueTrackerTab({ projectName }: RevenueTrackerTabProps) {
  const [drawerMonth, setDrawerMonth] = useState<{ month: RevenueMonthData; defaultFilter: "all" | "realised" | "unrealised" } | null>(null);

  const { data, isLoading } = useQuery<RevenueTrackerResponse>({
    queryKey: ["revenue-tracker-project", projectName],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/revenue-tracker/project/${encodeURIComponent(projectName)}`, {
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

  const lastMonth = useMemo(() => months.length > 0 ? months[months.length - 1] : null, [months]);

  const hasData = useMemo(() => months.some(m => m.totalRevenue > 0), [months]);

  const chartData = useMemo(
    () => months.map((m) => ({
      month: m.monthLabel,
      "Realised": m.realisedRevenue,
      "Unrealised": m.unrealisedRevenue,
      Budget: totalMilestoneRevenue / Math.max(months.length, 1),
    })),
    [months, totalMilestoneRevenue],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3" data-testid="loading-revenue-tracker">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
        <span className="text-sm font-medium">Loading revenue data...</span>
      </div>
    );
  }

  if (!hasData) {
    return (
      <Card className="shadow-sm bg-white">
        <CardContent className="py-12">
          <p className="text-center text-slate-500" data-testid="no-revenue-data">
            No revenue data available. Import a tracker file to populate the revenue tracker.
          </p>
        </CardContent>
      </Card>
    );
  }

  const kpiCards = [
    {
      id: "ytd-revenue",
      label: "YTD Revenue",
      value: formatRand(lastMonth?.ytdRevenue ?? 0),
      icon: DollarSign,
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-600",
      valueColor: "text-slate-900 font-black",
      borderColor: "border-emerald-200",
    },
    {
      id: "ytd-realised-revenue",
      label: "YTD Realised Revenue",
      value: formatRand(lastMonth?.ytdRealised ?? 0),
      icon: TrendingUp,
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-700",
      valueColor: "text-emerald-700 font-black",
      borderColor: "border-emerald-200",
    },
    {
      id: "ytd-unrealised-revenue",
      label: "YTD Unrealised Revenue",
      value: formatRand(lastMonth?.ytdUnrealised ?? 0),
      icon: Activity,
      iconBg: "bg-amber-100",
      iconColor: "text-amber-600",
      valueColor: "text-amber-600",
      borderColor: "border-amber-200",
    },
    {
      id: "total-milestone-inflows",
      label: "Total Milestone Inflows",
      value: formatRand(totalMilestoneRevenue),
      icon: Target,
      iconBg: "bg-green-100",
      iconColor: "text-green-600",
      valueColor: "text-green-700",
      borderColor: "border-green-200",
    },
  ];

  return (
    <div className="space-y-6" data-testid="revenue-tracker-tab">
      <Card className="border-emerald-200/80 bg-gradient-to-r from-emerald-50 to-emerald-50/30 shadow-sm" data-testid="card-revenue-guidance">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="rounded-xl bg-emerald-200/60 p-2.5 mt-0.5 shrink-0">
            <TrendingUp className="h-5 w-5 text-emerald-700" />
          </div>
          <div>
            <p className="font-semibold text-emerald-900 text-sm">Revenue Tracker Guide</p>
            <p className="text-sm text-emerald-700/90 mt-0.5 leading-relaxed">
              Revenue is "Realised" when the corresponding COS line item has a confirmed invoice and payment. Click any month cell to see individual line items and their realisation status.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
          <CardTitle className="text-lg font-semibold tracking-tight text-slate-900">Revenue Overview — {projectName}</CardTitle>
        </CardHeader>
        <CardContent className="p-6 bg-white">
          <div className="h-[320px]" data-testid="chart-project-revenue">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                <YAxis tickFormatter={(v: number) => formatRand(v)} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(value: number) => formatRand(value)}
                  contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px', backgroundColor: '#fff' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }} />
                <Bar dataKey="Realised" stackId="revenue" fill="#059669" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Unrealised" stackId="revenue" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="Budget" stroke="#10b981" strokeWidth={2} strokeDasharray="6 3" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm overflow-hidden bg-white">
        <CardHeader className="bg-gradient-to-r from-emerald-50 to-white border-b px-6 py-4">
          <CardTitle className="text-lg font-semibold tracking-tight text-slate-900">Monthly Revenue Grid</CardTitle>
        </CardHeader>
        <CardContent className="p-0 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-project-revenue-grid">
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
                        data-testid={`row-revenue-${row.key}`}
                      >
                        <td className={`sticky left-0 z-10 px-5 py-2.5 font-medium text-sm border-r border-slate-200 ${isYtd ? "bg-slate-50 pl-8 text-slate-500" : "bg-white text-slate-900"}`}>
                          {row.label}
                        </td>
                        {months.map((m) => {
                          const val = m[row.dataKey] as number;
                          return (
                            <td
                              key={m.monthKey}
                              className={`px-4 py-2.5 text-right font-mono text-sm ${row.colorClass} ${isClickable && val !== 0 ? "cursor-pointer hover:bg-emerald-50 hover:underline decoration-emerald-300 underline-offset-2 transition-colors rounded" : ""}`}
                              onClick={isClickable && val !== 0 ? () => setDrawerMonth({
                                month: m,
                                defaultFilter: row.key === 'realisedRevenue' ? 'realised' : row.key === 'unrealisedRevenue' ? 'unrealised' : 'all'
                              }) : undefined}
                              data-testid={`cell-revenue-${row.key}-${m.monthKey}`}
                            >
                              {formatRand(val)}
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
        <RevenueDetailDrawer
          key={`${drawerMonth.month.monthKey}-${drawerMonth.defaultFilter}`}
          month={drawerMonth.month}
          onClose={() => setDrawerMonth(null)}
          defaultFilter={drawerMonth.defaultFilter}
        />
      )}
    </div>
  );
}