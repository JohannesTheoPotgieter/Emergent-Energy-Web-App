import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getQueryFn, apiRequest, invalidateDashboardQueries } from "@/lib/queryClient";
import { usePermission } from "@/hooks/use-permissions";
import {
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from "recharts";
import {
  DollarSign,
  TrendingUp,
  Activity,
  ChevronDown,
  ChevronRight,
  X,
  Search,
  Loader2,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { EnergyLoader } from "@/components/ui/energy-loader";
import { SearchableSelect } from "@/components/ui/searchable-select";

interface ProjectBreakdown {
  projectName: string;
  value: number;
}

interface MonthData {
  monthKey: string;
  monthLabel: string;
  totalRevenue: number;
  realisedRevenue: number;
  unrealisedRevenue: number;
  budget: number;
  variance: number;
  variancePct: number;
  ytdRevenue: number;
  ytdRealised: number;
  ytdUnrealised: number;
  ytdBudget: number;
  ytdVariance: number;
  ytdVariancePct: number;
  revProjects: ProjectBreakdown[];
  realisedProjects: ProjectBreakdown[];
  unrealisedProjects: ProjectBreakdown[];
  budgetProjects: ProjectBreakdown[];
}

interface RevenueTrackerResponse {
  months: MonthData[];
  totalMilestoneRevenue: number;
  totalCOS: number;
}

interface MonthDetailItem {
  id: number;
  projectName: string;
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
  revState: string;
}

function formatRand(val: number | null | undefined): string {
  if (val == null) return "R 0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

const ROW_DEFS: {
  key: string;
  label: string;
  dataKey: keyof MonthData;
  colorClass: string;
  group: "monthly" | "ytd";
  expandable?: boolean;
  editable?: boolean;
  projectsKey?: "revProjects" | "realisedProjects" | "unrealisedProjects";
  colorCoded?: boolean;
}[] = [
  { key: "totalRevenue", label: "Revenue", dataKey: "totalRevenue", colorClass: "text-foreground font-bold", group: "monthly", expandable: true, projectsKey: "revProjects" },
  { key: "realisedRevenue", label: "Realised Revenue", dataKey: "realisedRevenue", colorClass: "text-emerald-700 font-bold", group: "monthly", expandable: true, projectsKey: "realisedProjects" },
  { key: "unrealisedRevenue", label: "Unrealised Revenue", dataKey: "unrealisedRevenue", colorClass: "text-amber-600 font-semibold", group: "monthly", expandable: true, projectsKey: "unrealisedProjects" },
  { key: "budget", label: "Budget", dataKey: "budget", colorClass: "text-purple-600", group: "monthly", editable: true },
  { key: "variance", label: "Variance", dataKey: "variance", colorClass: "", group: "monthly", colorCoded: true },
  { key: "variancePct", label: "Variance %", dataKey: "variancePct", colorClass: "", group: "monthly", colorCoded: true },
  { key: "ytdRevenue", label: "YTD Revenue", dataKey: "ytdRevenue", colorClass: "text-foreground font-bold", group: "ytd" },
  { key: "ytdRealised", label: "YTD Realised", dataKey: "ytdRealised", colorClass: "text-emerald-700 font-bold", group: "ytd" },
  { key: "ytdUnrealised", label: "YTD Unrealised", dataKey: "ytdUnrealised", colorClass: "text-amber-600", group: "ytd" },
  { key: "ytdBudget", label: "YTD Budget", dataKey: "ytdBudget", colorClass: "text-purple-600", group: "ytd" },
  { key: "ytdVariance", label: "YTD Variance", dataKey: "ytdVariance", colorClass: "", group: "ytd", colorCoded: true },
  { key: "ytdVariancePct", label: "YTD Variance %", dataKey: "ytdVariancePct", colorClass: "", group: "ytd", colorCoded: true },
];

function MonthDetailDrawer({ monthKey, monthLabel, onClose, defaultFilter = "all", defaultProject = "all" }: { monthKey: string; monthLabel: string; onClose: () => void; defaultFilter?: "all" | "realised" | "unrealised"; defaultProject?: string }) {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"all" | "realised" | "unrealised">(defaultFilter);
  const [projectFilter, setProjectFilter] = useState<string>(defaultProject);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const stateParam = stateFilter !== "all" ? `&state=${stateFilter === "realised" ? "Realised" : "Unrealised"}` : "";
  const projectParam = projectFilter !== "all" ? `&project=${encodeURIComponent(projectFilter)}` : "";

  const { data: rawItems, isLoading } = useQuery<MonthDetailItem[]>({
    queryKey: [`/api/revenue-tracker/month-detail?monthKey=${monthKey}${stateParam}${projectParam}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const items = rawItems ?? [];

  const summaries = useMemo(() => {
    const realisedItems = items.filter(i => i.isRealised);
    const unrealisedItems = items.filter(i => !i.isRealised);
    return {
      lineCount: items.length,
      totalAmount: items.reduce((s, i) => s + i.revenueAmount, 0),
      realisedTotal: realisedItems.reduce((s, i) => s + i.revenueAmount, 0),
      unrealisedTotal: unrealisedItems.reduce((s, i) => s + i.revenueAmount, 0),
      realisedCount: realisedItems.length,
      unrealisedCount: unrealisedItems.length,
    };
  }, [items]);

  const allProjects = useMemo(() => {
    const names = new Set(items.map(i => i.projectName));
    return Array.from(names).sort();
  }, [items]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(i =>
      i.projectName.toLowerCase().includes(q) ||
      (i.category || "").toLowerCase().includes(q) ||
      (i.lineItem || "").toLowerCase().includes(q) ||
      (i.invoiceNumber || "").toLowerCase().includes(q) ||
      (i.supplier || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const filteredTotal = useMemo(() => filtered.reduce((s, i) => s + i.revenueAmount, 0), [filtered]);
  const filteredRealised = useMemo(() => filtered.filter(i => i.isRealised).reduce((s, i) => s + i.revenueAmount, 0), [filtered]);
  const filteredUnrealised = useMemo(() => filtered.filter(i => !i.isRealised).reduce((s, i) => s + i.revenueAmount, 0), [filtered]);

  const stateBadgeColor = (state: string) => {
    switch (state) {
      case 'Received':
      case 'Realised': return 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 font-bold';
      case 'Invoiced': return 'bg-blue-50 text-blue-600 ring-1 ring-blue-200';
      case 'Committed': return 'bg-amber-50 text-amber-600 ring-1 ring-amber-200';
      default: return 'bg-amber-100 text-amber-700 ring-1 ring-amber-200';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="drawer-revenue-detail" role="dialog" aria-modal="true" aria-label={`Revenue detail for ${monthLabel}`}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={onClose} aria-hidden="true" />
      <div className="ml-auto relative w-full max-w-5xl bg-white shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300">
        <div className="px-3 sm:px-6 py-4 sm:py-5 border-b bg-gradient-to-r from-emerald-50 to-white flex items-center justify-between">
          <div>
            <h3 className="font-bold text-xl tracking-tight text-foreground" data-testid="text-drawer-title">{monthLabel}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Revenue Line Item Detail · {summaries.lineCount} items · {formatRand(summaries.totalAmount)}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors" data-testid="button-close-drawer" aria-label="Close detail drawer">
            <X className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </button>
        </div>

        <div className="px-3 sm:px-6 py-3 sm:py-4 border-b bg-gradient-to-b from-emerald-50/30 to-transparent">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
            <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-200/60 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-emerald-600 uppercase tracking-wider">Realised</p>
                  <p className="font-mono font-black text-emerald-700 text-lg mt-0.5" data-testid="text-realised-total">{formatRand(summaries.realisedTotal)}</p>
                </div>
                <Badge variant="secondary" className="bg-emerald-200/60 text-emerald-700 text-xs font-semibold">{summaries.realisedCount}</Badge>
              </div>
              <div className="absolute -right-3 -bottom-3 w-16 h-16 rounded-full bg-emerald-200/20" />
            </div>
            <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-amber-50 to-amber-100/50 border border-amber-200/60 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-amber-600 uppercase tracking-wider">Unrealised</p>
                  <p className="font-mono font-bold text-amber-700 text-lg mt-0.5" data-testid="text-unrealised-total">{formatRand(summaries.unrealisedTotal)}</p>
                </div>
                <Badge variant="secondary" className="bg-amber-200/60 text-amber-600 text-xs font-semibold">{summaries.unrealisedCount}</Badge>
              </div>
              <div className="absolute -right-3 -bottom-3 w-16 h-16 rounded-full bg-amber-200/20" />
            </div>
            <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/50 border border-border/60 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total</p>
                  <p className="font-mono font-bold text-foreground text-lg mt-0.5">{formatRand(summaries.totalAmount)}</p>
                </div>
                <Badge variant="secondary" className="bg-slate-200/60 text-muted-foreground text-xs font-semibold">{summaries.lineCount}</Badge>
              </div>
              <div className="absolute -right-3 -bottom-3 w-16 h-16 rounded-full bg-slate-200/20" />
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-b flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search project, category, supplier, invoice…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 bg-muted/50 border-border focus:bg-white transition-colors"
              data-testid="input-search-detail"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as any)}
            className="h-9 px-3 text-sm border border-border rounded-lg bg-muted/50 hover:bg-white transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-300"
            data-testid="select-state-filter"
          >
            <option value="all">All States</option>
            <option value="realised">Realised Only</option>
            <option value="unrealised">Unrealised Only</option>
          </select>
          <SearchableSelect
            value={projectFilter}
            onValueChange={(v) => setProjectFilter(v || "all")}
            options={[
              { value: "all", label: "All Projects" },
              ...allProjects.map(p => ({ value: p, label: p })),
            ]}
            placeholder="All Projects"
            searchPlaceholder="Search projects..."
            triggerClassName="h-9 max-w-[220px]"
            data-testid="select-project-filter"
          />
        </div>

        <div className="px-6 py-2.5 border-b bg-muted/80 flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">
            <span className="text-foreground font-semibold">{filtered.length}</span> items
          </span>
          <div className="flex items-center gap-5">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-emerald-700 font-mono text-xs font-bold">{formatRand(filteredRealised)}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-amber-600 font-mono text-xs font-medium">{formatRand(filteredUnrealised)}</span>
            </span>
            <span className="font-mono font-bold text-foreground">{formatRand(filteredTotal)}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
              <span className="text-sm">Loading line items…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Search className="h-8 w-8 text-slate-600" />
              <span className="text-sm">No line items found</span>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white/95 backdrop-blur-md z-10 border-b">
                <tr>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px] w-8"></th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Project</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Category</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Line Item</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Status</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">COS</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.slice(0, 500).map((item, i) => (
                  <React.Fragment key={item.id}>
                    <tr
                      className={`group cursor-pointer transition-colors ${expandedId === item.id ? 'bg-emerald-50/60' : 'hover:bg-muted/80'}`}
                      onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                      data-testid={`row-detail-${i}`}
                    >
                      <td className="px-3 py-2.5 text-slate-500 group-hover:text-muted-foreground transition-colors">
                        {expandedId === item.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </td>
                      <td className="px-3 py-2.5 max-w-[150px] truncate font-medium text-foreground" title={item.projectName}>{item.projectName}</td>
                      <td className="px-3 py-2.5 text-muted-foreground max-w-[150px] truncate" title={item.category || ""}>{item.category || "—"}</td>
                      <td className="px-3 py-2.5 max-w-[200px] truncate text-foreground" title={item.lineItem || ""}>{item.lineItem || "—"}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${stateBadgeColor(item.revState)}`}>
                          {item.revState}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{formatRand(item.costAmount)}</td>
                      <td className={`px-3 py-2.5 text-right font-mono font-semibold ${item.isRealised ? 'text-emerald-700' : 'text-amber-600'}`}>
                        {item.noRevenueLinked ? <span className="text-slate-400 italic text-[10px]">No Rev</span> : formatRand(item.revenueAmount)}
                      </td>
                    </tr>
                    {expandedId === item.id && (
                      <tr className="bg-gradient-to-r from-emerald-50/40 to-slate-50/40">
                        <td colSpan={7} className="px-6 py-4">
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-x-6 gap-y-3 text-xs">
                            <div>
                              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">Invoice #</p>
                              <p className="font-medium text-foreground">{item.invoiceNumber || "—"}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">PO #</p>
                              <p className="font-medium text-foreground">{item.poNumber || "—"}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">Invoice Date</p>
                              <p className="font-medium text-foreground">{item.invoiceDate || "—"}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">Supplier</p>
                              <p className="font-medium text-foreground">{item.supplier || "—"}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">Revenue Status</p>
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${stateBadgeColor(item.revState)}`}>
                                {item.revState}
                              </span>
                              {item.noRevenueLinked && (
                                <Badge variant="outline" className="ml-1 text-[9px] border-orange-300 text-orange-600">No Rev Linked</Badge>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

type EditingCell = { field: string; monthKey: string; value: string };

export default function RevenueTrackerPage() {
  const qc = useQueryClient();
  const { allowed: canEditRevenueTracker } = usePermission("revenue_tracker", "edit");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [drawerMonth, setDrawerMonth] = useState<{ monthKey: string; monthLabel: string; defaultFilter?: "all" | "realised" | "unrealised"; defaultProject?: string } | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<RevenueTrackerResponse>({
    queryKey: ["/api/revenue-tracker"],
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: async (body: { trackerType: string; monthKey: string; budget?: string }) => {
      await apiRequest("POST", "/api/tracker-monthly", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/revenue-tracker"] });
      invalidateDashboardQueries(qc);
    },
  });

  const startEdit = useCallback((field: string, monthKey: string, currentValue: number) => {
    setEditing({ field, monthKey, value: String(currentValue) });
  }, []);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const payload: Record<string, string> = {
      trackerType: "REV",
      monthKey: editing.monthKey,
    };
    payload[editing.field] = editing.value;
    mutation.mutate(payload as any);
    setEditing(null);
  }, [editing, mutation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") commitEdit();
      if (e.key === "Escape") setEditing(null);
    },
    [commitEdit],
  );

  const months = data?.months ?? [];

  const lastMonth = useMemo(() => {
    if (!months.length) return null;
    return months[months.length - 1];
  }, [months]);

  const projectNamesByRow = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const key of ["revProjects", "realisedProjects", "unrealisedProjects"] as const) {
      const names = new Set<string>();
      for (const m of months) {
        for (const p of (m as any)[key] || []) {
          names.add(p.projectName);
        }
      }
      result[key] = Array.from(names).sort();
    }
    return result;
  }, [months]);

  const toggleRow = useCallback((key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const chartData = useMemo(
    () =>
      months.map((m) => ({
        month: m.monthLabel,
        "Realised": m.realisedRevenue,
        "Unrealised": m.unrealisedRevenue,
        "Budget": m.budget,
        "YTD Variance": m.ytdVariance,
      })),
    [months],
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50/50" data-testid="loading-indicator">
        <div className="bg-white border-b border-border/80 px-3 sm:px-6 py-4 sm:py-6 shadow-sm">
          <div className="max-w-[1800px] mx-auto">
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
        </div>
        <div className="max-w-[1800px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="shadow-sm">
                <CardContent className="pt-5 pb-4 px-4">
                  <div className="flex items-start gap-3">
                    <Skeleton className="h-10 w-10 rounded-xl" />
                    <div className="flex-1">
                      <Skeleton className="h-3 w-20 mb-2" />
                      <Skeleton className="h-6 w-24" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="shadow-sm overflow-hidden">
            <CardContent className="p-6">
              <Skeleton className="h-[420px] w-full rounded-lg" />
            </CardContent>
          </Card>
          <Card className="shadow-sm overflow-hidden">
            <CardContent className="p-0">
              <div className="px-5 py-3 border-b"><Skeleton className="h-5 w-40" /></div>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex gap-2 px-5 py-2.5 border-b border-border/40">
                  <Skeleton className="h-4 w-36" />
                  {Array.from({ length: 6 }).map((_, j) => (
                    <Skeleton key={j} className="h-4 w-20 ml-auto" />
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto" data-testid="revenue-tracker-error-state">
        <Card className="border-red-200 bg-red-50/40">
          <CardContent className="py-10 text-center space-y-3">
            <AlertCircle className="h-8 w-8 text-red-500 mx-auto" />
            <p className="text-sm font-semibold text-red-700">Revenue tracker data failed to load.</p>
            <p className="text-xs text-red-600/90">{(error as Error)?.message || "An unexpected error occurred."}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-revenue-tracker">Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const ytdVar = lastMonth?.ytdVariance ?? 0;
  const realisedPct = (lastMonth?.ytdRevenue ?? 0) > 0
    ? (lastMonth?.ytdRealised ?? 0) / (lastMonth?.ytdRevenue ?? 1)
    : 0;

  const kpiCards = [
    { id: "ytd-revenue", label: "YTD Revenue", value: formatRand(lastMonth?.ytdRevenue ?? 0), icon: DollarSign, iconBg: "bg-muted", iconColor: "text-muted-foreground", valueColor: "text-foreground font-black", borderColor: "", tooltip: "Year-to-date total revenue from milestone payments. Includes both received and pending payments." },
    { id: "ytd-realised", label: "YTD Realised", value: formatRand(lastMonth?.ytdRealised ?? 0), icon: TrendingUp, iconBg: "bg-muted", iconColor: "text-foreground", valueColor: "text-foreground font-black", borderColor: "border-border", tooltip: "Revenue where milestone payment has been received and confirmed. This is actual cash collected." },
    { id: "ytd-unrealised", label: "YTD Unrealised", value: formatRand(lastMonth?.ytdUnrealised ?? 0), icon: Activity, iconBg: "bg-red-100", iconColor: "text-red-600", valueColor: "text-red-600", borderColor: "border-red-200", tooltip: "Revenue from milestones that have been invoiced or are planned but payment is not yet received." },
    {
      id: "ytd-variance", label: "YTD Variance", value: formatRand(ytdVar),
      icon: TrendingUp,
      iconBg: ytdVar >= 0 ? "bg-green-100" : "bg-red-100",
      iconColor: ytdVar >= 0 ? "text-green-600" : "text-red-600",
      valueColor: ytdVar >= 0 ? "text-green-600" : "text-red-600",
      borderColor: ytdVar >= 0 ? "border-green-200" : "border-red-200",
      tooltip: "Difference between actual revenue and budget (Revenue − Budget). Green = ahead of plan, Red = behind plan.",
    },
    {
      id: "realised-pct", label: "Realised %", value: `${(realisedPct * 100).toFixed(1)}%`,
      icon: Activity,
      iconBg: realisedPct >= 0.5 ? "bg-green-100" : "bg-amber-100",
      iconColor: realisedPct >= 0.5 ? "text-green-600" : "text-amber-600",
      valueColor: realisedPct >= 0.5 ? "text-green-600" : "text-amber-600",
      borderColor: realisedPct >= 0.5 ? "border-green-200" : "border-amber-200",
      tooltip: "Percentage of total revenue that has been realised (received). Green if >= 50%, Amber if below.",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50/50">
      <div className="bg-white border-b border-border/80 px-3 sm:px-6 py-4 sm:py-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 max-w-[1800px] mx-auto">
          <div>
            <h2 className="text-xl sm:text-3xl font-heading font-bold tracking-tight text-foreground" data-testid="text-page-title">
              Revenue Tracker FY26
            </h2>
            <p className="text-muted-foreground mt-1 sm:mt-1.5 text-xs sm:text-sm" data-testid="text-page-subtitle">
              Monthly revenue tracking with realised vs unrealised analysis. Click any month cell to see contributing line items.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-[1800px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6">
        <Card className="border-emerald-200/80 bg-gradient-to-r from-emerald-50 to-emerald-50/30 shadow-sm" data-testid="card-info-banner">
          <CardContent className="p-4 flex items-start gap-3">
            <div className="rounded-xl bg-emerald-200/60 p-2.5 mt-0.5 shrink-0">
              <TrendingUp className="h-5 w-5 text-emerald-700" />
            </div>
            <div>
              <p className="font-semibold text-emerald-900 text-sm">Revenue Realisation Tracker</p>
              <p className="text-sm text-emerald-700/90 mt-0.5 leading-relaxed">
                Revenue is "Realised" when the milestone payment has been received. <strong className="text-emerald-800">Green</strong> = received/confirmed. <strong className="text-amber-600">Amber</strong> = pending/unrealised. Data sourced from milestone inflows and payment records.
              </p>
            </div>
          </CardContent>
        </Card>

        <TooltipProvider delayDuration={300}>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4" role="region" aria-label="Revenue KPI Summary">
            {kpiCards.map((kpi) => (
              <Card key={kpi.id} className={`shadow-sm hover:shadow-md transition-shadow ${kpi.borderColor}`} data-testid={`card-${kpi.id}`}>
                <CardContent className="pt-5 pb-4 px-4">
                  <div className="flex items-start gap-3">
                    <div className={`rounded-xl ${kpi.iconBg} p-2.5 shrink-0`}>
                      <kpi.icon className={`h-5 w-5 ${kpi.iconColor}`} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <p className="text-xs font-medium text-muted-foreground truncate">{kpi.label}</p>
                        <UiTooltip>
                          <TooltipTrigger asChild>
                            <button type="button" className="text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0" aria-label={`Info: ${kpi.label}`}>
                              <HelpCircle className="h-3 w-3" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[240px] text-xs leading-relaxed">
                            {kpi.tooltip}
                          </TooltipContent>
                        </UiTooltip>
                      </div>
                      <p className={`text-xl font-bold font-mono mt-0.5 ${kpi.valueColor}`} data-testid={`text-${kpi.id}-value`}>
                        {kpi.value}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TooltipProvider>

        <Card className="shadow-sm overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-emerald-50 to-white border-b px-6 py-4">
            <CardTitle className="text-lg font-semibold tracking-tight">Revenue Overview</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="h-[420px]" data-testid="chart-revenue">
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
                  <Bar dataKey="Realised" stackId="rev" fill="#059669" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Unrealised" stackId="rev" fill="#d97706" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Budget" fill="#a855f7" opacity={0.3} radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="YTD Variance" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-emerald-50 to-white border-b px-6 py-4">
            <CardTitle className="text-lg font-semibold tracking-tight">Monthly Revenue Grid</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-revenue-grid">
                <thead>
                  <tr className="border-b bg-muted/80">
                    <th className="sticky left-0 z-10 bg-muted/95 backdrop-blur-sm px-5 py-3 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[11px] min-w-[200px] border-r border-border">
                      Metric
                    </th>
                    {months.map((m) => (
                      <th key={m.monthKey} className="px-4 py-3 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[110px]">
                        {m.monthLabel}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROW_DEFS.map((row, rowIdx) => {
                    const isYtd = row.group === "ytd";
                    const isExpanded = expandedRows.has(row.key);
                    const isClickable = ["totalRevenue", "realisedRevenue", "unrealisedRevenue"].includes(row.key);
                    const isFirstYtd = isYtd && rowIdx > 0 && ROW_DEFS[rowIdx - 1].group !== "ytd";
                    return (
                      <React.Fragment key={row.key}>
                        {isFirstYtd && (
                          <tr>
                            <td colSpan={months.length + 1} className="bg-muted/60 h-px" />
                          </tr>
                        )}
                        <tr
                          className={`border-b border-border transition-colors ${isYtd ? "bg-muted/40" : "bg-white"} hover:bg-muted/40`}
                          data-testid={`row-${row.key}`}
                        >
                          <td className={`sticky left-0 z-10 px-5 py-2.5 font-medium text-sm border-r border-border ${isYtd ? "bg-muted/95" : "bg-white/95"} backdrop-blur-sm`}>
                            {row.expandable ? (
                              <button
                                type="button"
                                className="flex items-center gap-1.5 hover:text-emerald-600 transition-colors group"
                                onClick={() => toggleRow(row.key)}
                                aria-expanded={isExpanded}
                                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.label} by project`}
                                data-testid={`toggle-${row.key}`}
                              >
                                <span className="text-slate-500 group-hover:text-emerald-500 transition-colors">
                                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </span>
                                <span>{row.label}</span>
                              </button>
                            ) : (
                              <span className={isYtd ? "pl-5.5 text-muted-foreground" : ""}>{row.label}</span>
                            )}
                          </td>
                          {months.map((m) => {
                            const val = m[row.dataKey] as number;
                            const isEditingCell = editing?.field === row.key && editing?.monthKey === m.monthKey;

                            if (row.editable && canEditRevenueTracker) {
                              return (
                                <td key={m.monthKey} className="px-2 py-1.5 text-right">
                                  {isEditingCell ? (
                                    <Input
                                      type="number"
                                      className="h-8 w-full text-right font-mono text-sm border-purple-300 focus:ring-purple-400"
                                      value={editing.value}
                                      onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                      onBlur={commitEdit}
                                      onKeyDown={handleKeyDown}
                                      autoFocus
                                      data-testid={`input-${row.key}-${m.monthKey}`}
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      className={`w-full text-right font-mono cursor-pointer hover:bg-purple-50 rounded-lg px-3 py-1.5 transition-colors ${row.colorClass}`}
                                      onClick={() => startEdit(row.key, m.monthKey, val)}
                                      data-testid={`cell-${row.key}-${m.monthKey}`}
                                    >
                                      {formatRand(val)}
                                    </button>
                                  )}
                                </td>
                              );
                            }

                            const colorCodedClass = row.colorCoded
                              ? val < 0 ? "text-red-600 font-semibold" : val > 0 ? "text-green-600 font-semibold" : "text-slate-500"
                              : row.colorClass;
                            const isVarPct = row.key === "variancePct" || row.key === "ytdVariancePct";
                            const displayVal = isVarPct ? `${(val * 100).toFixed(1)}%` : formatRand(val);
                            return (
                              <td
                                key={m.monthKey}
                                className={`px-4 py-2.5 text-right font-mono text-sm ${colorCodedClass} ${isClickable ? "cursor-pointer hover:bg-emerald-50/80 hover:underline decoration-emerald-300 underline-offset-2 transition-colors rounded" : ""}`}
                                onClick={isClickable ? () => setDrawerMonth({
                                  monthKey: m.monthKey,
                                  monthLabel: m.monthLabel,
                                  defaultFilter: row.key === 'realisedRevenue' ? 'realised' : row.key === 'unrealisedRevenue' ? 'unrealised' : 'all'
                                }) : undefined}
                                data-testid={`cell-${row.key}-${m.monthKey}`}
                              >
                                {displayVal}
                              </td>
                            );
                          })}
                        </tr>
                        {row.expandable && isExpanded && row.projectsKey && (projectNamesByRow[row.projectsKey] || []).map((pName) => (
                          <tr
                            key={`${row.key}-${pName}`}
                            className="border-b border-slate-50 bg-emerald-50/20 hover:bg-emerald-50/50 transition-colors"
                            data-testid={`row-detail-${row.key}-${pName}`}
                          >
                            <td className="sticky left-0 z-10 bg-emerald-50/30 backdrop-blur-sm pl-11 pr-4 py-1.5 text-xs text-muted-foreground truncate max-w-[200px] border-r border-border" title={pName}>
                              <span className="cursor-pointer hover:text-emerald-600 hover:underline decoration-dashed underline-offset-2 transition-colors">
                                {pName}
                              </span>
                            </td>
                            {months.map((m) => {
                              const projArr = row.projectsKey ? (m as any)[row.projectsKey] as ProjectBreakdown[] : [];
                              const proj = projArr?.find((p: ProjectBreakdown) => p.projectName === pName);
                              const val = proj?.value ?? 0;
                              const drillFilter = row.key === 'realisedRevenue' ? 'realised' as const : row.key === 'unrealisedRevenue' ? 'unrealised' as const : 'all' as const;
                              return (
                                <td
                                  key={m.monthKey}
                                  className={`px-4 py-1.5 text-right font-mono text-xs text-emerald-600/70 ${val !== 0 ? "cursor-pointer hover:bg-emerald-50/80 hover:underline decoration-emerald-300 underline-offset-2 transition-colors rounded" : ""}`}
                                  onClick={val !== 0 ? () => setDrawerMonth({
                                    monthKey: m.monthKey,
                                    monthLabel: m.monthLabel,
                                    defaultFilter: drillFilter,
                                    defaultProject: pName,
                                  }) : undefined}
                                  data-testid={`cell-detail-${row.key}-${pName}-${m.monthKey}`}
                                >
                                  {val !== 0 ? formatRand(val) : ""}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {drawerMonth && (
        <MonthDetailDrawer
          key={`${drawerMonth.monthKey}-${drawerMonth.defaultFilter}-${drawerMonth.defaultProject || 'all'}`}
          monthKey={drawerMonth.monthKey}
          monthLabel={drawerMonth.monthLabel}
          defaultFilter={drawerMonth.defaultFilter}
          defaultProject={drawerMonth.defaultProject}
          onClose={() => setDrawerMonth(null)}
        />
      )}
    </div>
  );
}
