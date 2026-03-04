import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest, getQueryFn, invalidateDashboardQueries } from "@/lib/queryClient";
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
  DollarSign,
  TrendingDown,
  Target,
  Activity,
  ChevronDown,
  ChevronRight,
  X,
  Search,
  Info,
  Loader2,
} from "lucide-react";

interface ProjectBreakdown {
  projectName: string;
  value: number;
}

interface MonthData {
  monthKey: string;
  monthLabel: string;
  totalCOS: number;
  realisedCOS: number;
  unrealisedCOS: number;
  budget: number;
  variance: number;
  variancePct: number;
  revRealised: number;
  ytdCOS: number;
  ytdRealised: number;
  ytdUnrealised: number;
  ytdBudget: number;
  ytdVariance: number;
  ytdVariancePct: number;
  ytdRevRealised: number;
  cosProjects: ProjectBreakdown[];
  realisedProjects: ProjectBreakdown[];
  unrealisedProjects: ProjectBreakdown[];
}

interface MonthDetailItem {
  id: number;
  projectName: string;
  category: string | null;
  lineItem: string | null;
  amount: number;
  invoiceNumber: string | null;
  poNumber: string | null;
  invoiceDate: string | null;
  invoiceDateConfirmed: boolean;
  paymentDate: string | null;
  paymentDateConfirmed: boolean;
  supplier: string | null;
  isRealised: boolean;
  realisedMonth: string | null;
  cosState: string;
}

interface MonthDetail {
  monthKey: string;
  lineCount: number;
  totalAmount: number;
  realisedTotal: number;
  unrealisedTotal: number;
  realisedCount: number;
  unrealisedCount: number;
  items: MonthDetailItem[];
}

function formatRand(val: number | null | undefined): string {
  if (val == null) return "R 0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

type EditableField = "budget";

interface EditingCell {
  field: EditableField;
  monthKey: string;
  value: string;
}

const ROW_DEFS: {
  key: string;
  label: string;
  dataKey: keyof MonthData;
  editable: boolean;
  colorClass: string;
  group: "monthly" | "ytd";
  colorCoded?: boolean;
  expandable?: boolean;
  projectsKey?: "cosProjects" | "realisedProjects" | "unrealisedProjects";
}[] = [
  { key: "totalCOS", label: "COS (Finance)", dataKey: "totalCOS", editable: false, colorClass: "text-foreground font-bold", group: "monthly", expandable: true, projectsKey: "cosProjects" },
  { key: "realisedCOS", label: "Realised COS", dataKey: "realisedCOS", editable: false, colorClass: "text-foreground font-bold", group: "monthly", expandable: true, projectsKey: "realisedProjects" },
  { key: "unrealisedCOS", label: "Unrealised COS", dataKey: "unrealisedCOS", editable: false, colorClass: "text-red-600 font-semibold", group: "monthly", expandable: true, projectsKey: "unrealisedProjects" },
  { key: "budget", label: "Costed", dataKey: "budget", editable: true, colorClass: "text-purple-600", group: "monthly" },
  { key: "variance", label: "Variance", dataKey: "variance", editable: false, colorClass: "", group: "monthly", colorCoded: true },
  { key: "variancePct", label: "Variance %", dataKey: "variancePct", editable: false, colorClass: "", group: "monthly", colorCoded: true },
  { key: "ytdCOS", label: "YTD COS", dataKey: "ytdCOS", editable: false, colorClass: "text-foreground font-bold", group: "ytd" },
  { key: "ytdRealised", label: "YTD Realised", dataKey: "ytdRealised", editable: false, colorClass: "text-foreground font-bold", group: "ytd" },
  { key: "ytdUnrealised", label: "YTD Unrealised", dataKey: "ytdUnrealised", editable: false, colorClass: "text-red-600", group: "ytd" },
  { key: "ytdBudget", label: "YTD Costed", dataKey: "ytdBudget", editable: false, colorClass: "text-purple-600", group: "ytd" },
  { key: "ytdVariance", label: "YTD Variance", dataKey: "ytdVariance", editable: false, colorClass: "", group: "ytd", colorCoded: true },
  { key: "ytdVariancePct", label: "YTD Variance %", dataKey: "ytdVariancePct", editable: false, colorClass: "", group: "ytd", colorCoded: true },
];

function MonthDetailDrawer({ monthKey, monthLabel, onClose, defaultFilter = "all", defaultProject = "all" }: { monthKey: string; monthLabel: string; onClose: () => void; defaultFilter?: "all" | "realised" | "unrealised"; defaultProject?: string }) {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"all" | "realised" | "unrealised">(defaultFilter);
  const [projectFilter, setProjectFilter] = useState<string>(defaultProject);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<MonthDetail>({
    queryKey: [`/api/cos-tracker/month-detail?monthKey=${monthKey}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const toggleRealisedMutation = useMutation({
    mutationFn: async ({ id, realised }: { id: number; realised: boolean }) => {
      await apiRequest("PATCH", `/api/cos-tracker/toggle-realised/${id}`, { realised });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/cos-tracker/month-detail?monthKey=${monthKey}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/cos-tracker"] });
      invalidateDashboardQueries(queryClient);
    },
  });

  const allProjects = useMemo(() => {
    if (!data?.items) return [];
    const names = new Set(data.items.map(i => i.projectName));
    return Array.from(names).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data?.items) return [];
    let items = data.items;
    if (stateFilter === "realised") items = items.filter(i => i.isRealised);
    if (stateFilter === "unrealised") items = items.filter(i => !i.isRealised);
    if (projectFilter !== "all") items = items.filter(i => i.projectName === projectFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(i =>
        i.projectName.toLowerCase().includes(q) ||
        (i.category || "").toLowerCase().includes(q) ||
        (i.lineItem || "").toLowerCase().includes(q) ||
        (i.invoiceNumber || "").toLowerCase().includes(q) ||
        (i.poNumber || "").toLowerCase().includes(q) ||
        (i.supplier || "").toLowerCase().includes(q)
      );
    }
    return items;
  }, [data, search, stateFilter, projectFilter]);

  const filteredTotal = useMemo(() => filtered.reduce((s, i) => s + i.amount, 0), [filtered]);
  const filteredRealised = useMemo(() => filtered.filter(i => i.isRealised).reduce((s, i) => s + i.amount, 0), [filtered]);
  const filteredUnrealised = useMemo(() => filtered.filter(i => !i.isRealised).reduce((s, i) => s + i.amount, 0), [filtered]);

  const stateBadgeColor = (state: string) => {
    switch (state) {
      case 'Paid': return 'bg-slate-200 text-foreground ring-1 ring-slate-400 font-bold';
      case 'Invoiced':
      case 'Realised': return 'bg-muted text-foreground ring-1 ring-slate-300';
      case 'Committed': return 'bg-red-50 text-red-600 ring-1 ring-red-200';
      default: return 'bg-red-100 text-red-700 ring-1 ring-red-200';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="drawer-month-detail">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="ml-auto relative w-full max-w-5xl bg-background shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300">
        <div className="px-3 sm:px-6 py-4 sm:py-5 border-b bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
          <div>
            <h3 className="font-bold text-xl tracking-tight" data-testid="text-drawer-title">{monthLabel}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              COS Line Item Detail · {data?.lineCount ?? 0} items · {formatRand(data?.totalAmount ?? 0)}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors" data-testid="button-close-drawer">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <div className="px-3 sm:px-6 py-3 sm:py-4 border-b bg-gradient-to-b from-slate-50/50 to-transparent">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
            <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/50 border border-border/60 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Realised (Paid)</p>
                  <p className="font-mono font-black text-foreground text-lg mt-0.5" data-testid="text-realised-total">{formatRand(data?.realisedTotal ?? 0)}</p>
                </div>
                <Badge variant="secondary" className="bg-slate-200/60 text-foreground text-xs font-semibold">{data?.realisedCount ?? 0}</Badge>
              </div>
              <div className="absolute -right-3 -bottom-3 w-16 h-16 rounded-full bg-slate-200/20" />
            </div>
            <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-red-50 to-red-100/50 border border-red-200/60 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-red-600 uppercase tracking-wider">Unrealised (Not Paid)</p>
                  <p className="font-mono font-bold text-red-700 text-lg mt-0.5" data-testid="text-unrealised-total">{formatRand(data?.unrealisedTotal ?? 0)}</p>
                </div>
                <Badge variant="secondary" className="bg-red-200/60 text-red-600 text-xs font-semibold">{data?.unrealisedCount ?? 0}</Badge>
              </div>
              <div className="absolute -right-3 -bottom-3 w-16 h-16 rounded-full bg-red-200/20" />
            </div>
            <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/50 border border-border/60 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total</p>
                  <p className="font-mono font-bold text-foreground text-lg mt-0.5">{formatRand(data?.totalAmount ?? 0)}</p>
                </div>
                <Badge variant="secondary" className="bg-slate-200/60 text-muted-foreground text-xs font-semibold">{data?.lineCount ?? 0}</Badge>
              </div>
              <div className="absolute -right-3 -bottom-3 w-16 h-16 rounded-full bg-slate-200/20" />
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-b flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search project, category, invoice, PO, supplier…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 bg-muted/50 border-border focus:bg-card transition-colors"
              data-testid="input-search-detail"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as any)}
            className="h-9 px-3 text-sm border border-border rounded-lg bg-muted/50 hover:bg-card transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-300"
            data-testid="select-state-filter"
          >
            <option value="all">All States</option>
            <option value="realised">Realised Only</option>
            <option value="unrealised">Unrealised Only</option>
          </select>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="h-9 px-3 text-sm border border-border rounded-lg bg-muted/50 hover:bg-card transition-colors cursor-pointer max-w-[220px] focus:outline-none focus:ring-2 focus:ring-slate-300"
            data-testid="select-project-filter"
          >
            <option value="all">All Projects</option>
            {allProjects.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div className="px-6 py-2.5 border-b bg-muted/80 flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">
            <span className="text-foreground font-semibold">{filtered.length}</span> items
          </span>
          <div className="flex items-center gap-5">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-800" />
              <span className="text-foreground font-mono text-xs font-bold">{formatRand(filteredRealised)}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-red-600 font-mono text-xs font-medium">{formatRand(filteredUnrealised)}</span>
            </span>
            <span className="font-mono font-bold text-foreground">{formatRand(filteredTotal)}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
              <span className="text-sm">Loading line items…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Search className="h-8 w-8 text-slate-600" />
              <span className="text-sm">No line items found</span>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card/95 backdrop-blur-md z-10 border-b">
                <tr>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px] w-8"></th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Project</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Category</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Line Item</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Status</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Realised</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.slice(0, 500).map((item, i) => (
                  <React.Fragment key={item.id}>
                    <tr
                      className={`group cursor-pointer transition-colors ${expandedId === item.id ? 'bg-blue-50/60' : 'hover:bg-muted/80'}`}
                      onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                      data-testid={`row-detail-${i}`}
                    >
                      <td className="px-3 py-2.5 text-slate-500 group-hover:text-muted-foreground transition-colors">
                        {expandedId === item.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </td>
                      <td className="px-3 py-2.5 max-w-[150px] truncate font-medium text-foreground" title={item.projectName}>{item.projectName}</td>
                      <td className="px-3 py-2.5 text-muted-foreground max-w-[110px] truncate" title={item.category || ""}>{item.category || "—"}</td>
                      <td className="px-3 py-2.5 max-w-[200px] truncate text-foreground" title={item.lineItem || ""}>{item.lineItem || "—"}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${stateBadgeColor(item.cosState)}`}>
                          {item.cosState}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer transition-colors ${
                            item.isRealised
                              ? 'bg-muted text-foreground ring-1 ring-slate-300 font-bold hover:bg-red-50 hover:text-red-600 hover:ring-red-200'
                              : 'bg-red-50 text-red-600 ring-1 ring-red-200 hover:bg-muted hover:text-foreground hover:ring-slate-300'
                          }`}
                          title={item.isRealised ? 'Click to mark as Not Realised' : 'Click to mark as Realised'}
                          disabled={toggleRealisedMutation.isPending}
                          onClick={() => toggleRealisedMutation.mutate({ id: item.id, realised: !item.isRealised })}
                          data-testid={`button-toggle-realised-${item.id}`}
                        >
                          {item.isRealised
                            ? (item.invoiceNumber ? `INV: ${item.invoiceNumber.substring(0, 12)}` : (item.realisedMonth || 'Realised'))
                            : 'Not Realised'}
                        </button>
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono font-semibold ${item.isRealised ? 'text-foreground' : 'text-red-600'}`}>{formatRand(item.amount)}</td>
                    </tr>
                    {expandedId === item.id && (
                      <tr className="bg-gradient-to-r from-blue-50/40 to-slate-50/40">
                        <td colSpan={7} className="px-6 py-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-xs">
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
                              <p className="font-medium text-red-600 flex items-center gap-1.5">
                                {item.invoiceDate || "—"}
                                {item.invoiceDate && (
                                  <span className={`inline-block w-2 h-2 rounded-full ${item.invoiceDateConfirmed ? 'bg-green-500 ring-2 ring-green-200' : 'bg-red-400 ring-2 ring-red-200'}`}
                                    title={item.invoiceDateConfirmed ? 'Confirmed' : 'Forecast'} />
                                )}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">Payment Date</p>
                              <p className="font-medium text-foreground flex items-center gap-1.5">
                                {item.paymentDate || "—"}
                                {item.paymentDate && (
                                  <span className={`inline-block w-2 h-2 rounded-full ${item.paymentDateConfirmed ? 'bg-green-500 ring-2 ring-green-200' : 'bg-red-400 ring-2 ring-red-200'}`}
                                    title={item.paymentDateConfirmed ? 'Confirmed' : 'Forecast'} />
                                )}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">Supplier</p>
                              <p className="font-medium text-foreground">{item.supplier || "—"}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">Realised Month</p>
                              <p className="font-medium text-foreground">{item.realisedMonth || "Not realised"}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">COS State</p>
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${stateBadgeColor(item.cosState)}`}>
                                {item.cosState}
                              </span>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">Amount</p>
                              <p className="font-mono font-bold text-foreground">{formatRand(item.amount)}</p>
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

export default function CosTracker() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [drawerMonth, setDrawerMonth] = useState<{ monthKey: string; monthLabel: string; defaultFilter?: "all" | "realised" | "unrealised"; defaultProject?: string } | null>(null);

  const { data: months = [], isLoading } = useQuery<MonthData[]>({
    queryKey: ["/api/cos-tracker"],
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: async (body: { trackerType: string; monthKey: string; budget?: string }) => {
      await apiRequest("POST", "/api/tracker-monthly", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cos-tracker"] });
      invalidateDashboardQueries(qc);
    },
  });

  const lastMonth = useMemo(() => {
    if (!months.length) return null;
    return months[months.length - 1];
  }, [months]);

  const projectNamesByRow = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const key of ["cosProjects", "realisedProjects", "unrealisedProjects"] as const) {
      const names = new Set<string>();
      for (const m of months) {
        for (const p of m[key] || []) {
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

  const startEdit = useCallback((field: EditableField, monthKey: string, currentValue: number) => {
    setEditing({ field, monthKey, value: String(currentValue) });
  }, []);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const payload: Record<string, string> = {
      trackerType: "COS",
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

  const chartData = useMemo(
    () =>
      months.map((m) => ({
        month: m.monthLabel,
        "Realised": m.realisedCOS,
        "Unrealised": m.unrealisedCOS,
        Costed: m.budget,
        "YTD Variance": m.ytdVariance,
      })),
    [months],
  );

  const cosBreakdownData = useMemo(
    () =>
      months.map((m) => ({
        month: m.monthLabel,
        "Costed COS": m.budget,
        "Planned COS": m.totalCOS,
        "Realised COS": m.realisedCOS,
        "Outstanding COS": m.unrealisedCOS,
      })),
    [months],
  );

  const getCellColor = (val: number, variancePct?: number) => {
    const pct = variancePct != null ? Math.abs(variancePct) : null;
    const isPositive = val > 0;
    if (pct !== null) {
      if (pct >= 0.25) return isPositive ? "text-red-700 font-bold bg-red-50" : "text-green-700 font-bold bg-green-50";
      if (pct >= 0.15) return isPositive ? "text-amber-600 font-semibold bg-amber-50" : "text-green-600 font-semibold bg-green-50";
    }
    return isPositive ? "text-red-600" : "text-green-600";
  };

  const formatCell = (row: (typeof ROW_DEFS)[number], val: number) => {
    if (row.key === "variancePct" || row.key === "ytdVariancePct") {
      return `${(val * 100).toFixed(1)}%`;
    }
    return formatRand(val);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3" data-testid="loading-indicator">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
        <span className="text-sm font-medium">Loading COS data…</span>
      </div>
    );
  }

  const kpiCards = [
    { id: "ytd-total-cos", label: "YTD COS (Finance)", value: formatRand(lastMonth?.ytdCOS ?? 0), icon: DollarSign, iconBg: "bg-muted", iconColor: "text-muted-foreground", valueColor: "text-foreground", borderColor: "" },
    { id: "ytd-realised", label: "YTD Realised (Paid)", value: formatRand(lastMonth?.ytdRealised ?? 0), icon: TrendingDown, iconBg: "bg-muted", iconColor: "text-foreground", valueColor: "text-foreground font-black", borderColor: "border-border" },
    { id: "ytd-unrealised", label: "YTD Unrealised (Not Paid)", value: formatRand(lastMonth?.ytdUnrealised ?? 0), icon: Activity, iconBg: "bg-red-100", iconColor: "text-red-600", valueColor: "text-red-600", borderColor: "border-red-200" },
    { id: "ytd-budget", label: "YTD Costed", value: formatRand(lastMonth?.ytdBudget ?? 0), icon: Target, iconBg: "bg-purple-100", iconColor: "text-purple-600", valueColor: "text-purple-700", borderColor: "" },
    {
      id: "ytd-variance", label: "YTD Variance", value: formatRand(lastMonth?.ytdVariance ?? 0),
      icon: TrendingDown,
      iconBg: (lastMonth?.ytdVariance ?? 0) <= 0 ? "bg-green-100" : "bg-red-100",
      iconColor: (lastMonth?.ytdVariance ?? 0) <= 0 ? "text-green-600" : "text-red-600",
      valueColor: (lastMonth?.ytdVariance ?? 0) <= 0 ? "text-green-600" : "text-red-600",
      borderColor: (lastMonth?.ytdVariance ?? 0) <= 0 ? "border-green-200" : "border-red-200",
    },
    {
      id: "ytd-variance-pct", label: "YTD Variance %", value: `${((lastMonth?.ytdVariancePct ?? 0) * 100).toFixed(1)}%`,
      icon: Activity,
      iconBg: (lastMonth?.ytdVariancePct ?? 0) <= 0 ? "bg-green-100" : "bg-red-100",
      iconColor: (lastMonth?.ytdVariancePct ?? 0) <= 0 ? "text-green-600" : "text-red-600",
      valueColor: (lastMonth?.ytdVariancePct ?? 0) <= 0 ? "text-green-600" : "text-red-600",
      borderColor: (lastMonth?.ytdVariancePct ?? 0) <= 0 ? "border-green-200" : "border-red-200",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50/50">
      <div className="bg-card border-b border-border/80 px-3 sm:px-6 py-4 sm:py-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 max-w-[1800px] mx-auto">
          <div>
            <h2 className="text-xl sm:text-3xl font-heading font-bold tracking-tight text-foreground" data-testid="text-page-title">
              Cost of Sales Tracker FY26
            </h2>
            <p className="text-muted-foreground mt-1 sm:mt-1.5 text-xs sm:text-sm" data-testid="text-page-subtitle">
              Monthly COS tracking with planned vs costed analysis. Click any month cell to see contributing line items.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-[1800px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6">
        <Card className="border-amber-200/80 bg-gradient-to-r from-amber-50 to-amber-50/30 shadow-sm" data-testid="card-wip-banner">
          <CardContent className="p-4 flex items-start gap-3">
            <div className="rounded-xl bg-amber-200/60 p-2.5 mt-0.5 shrink-0">
              <Activity className="h-5 w-5 text-amber-700" />
            </div>
            <div>
              <p className="font-semibold text-amber-900 text-sm">COS Realisation Tracker</p>
              <p className="text-sm text-amber-700/90 mt-0.5 leading-relaxed">
                COS is "Realised" when the matching expenditure line has an Invoice Number AND the Invoice Raised Date has <strong className="text-foreground">black font colour</strong> (paid). <strong className="text-red-600">Red font</strong> = not paid. Data sourced from Finance - COS sheets and Expenditure Breakdown.
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
            <CardTitle className="text-lg font-semibold tracking-tight">COS Overview</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="h-[420px]" data-testid="chart-cos">
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
                  <Line
                    type="monotone"
                    dataKey="YTD Variance"
                    stroke="#ef4444"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm overflow-hidden" data-testid="card-cos-breakdown">
          <CardHeader className="bg-gradient-to-r from-slate-50 to-white border-b px-6 py-4">
            <CardTitle className="text-lg font-semibold tracking-tight">COS Monthly Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="h-[420px]" data-testid="chart-cos-breakdown">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={cosBreakdownData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                  <YAxis tickFormatter={(v: number) => formatRand(v)} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(value: number) => formatRand(value)}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }} />
                  <Bar dataKey="Costed COS" fill="#a6a6a6" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Planned COS" fill="#4472C4" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Realised COS" fill="#ED7D31" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Outstanding COS" fill="#FFC000" radius={[2, 2, 0, 0]} />
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
              <table className="w-full text-sm" data-testid="table-cos-grid">
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
                    const isClickable = ["totalCOS", "realisedCOS", "unrealisedCOS"].includes(row.key);
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
                          <td className={`sticky left-0 z-10 px-5 py-2.5 font-medium text-sm border-r border-border ${isYtd ? "bg-muted/95" : "bg-card/95"} backdrop-blur-sm`}>
                            {row.expandable ? (
                              <button
                                type="button"
                                className="flex items-center gap-1.5 hover:text-blue-600 transition-colors group"
                                onClick={() => toggleRow(row.key)}
                                data-testid={`toggle-${row.key}`}
                              >
                                <span className="text-slate-500 group-hover:text-blue-500 transition-colors">
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

                            if (row.editable) {
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
                                      onClick={() => startEdit(row.key as EditableField, m.monthKey, val)}
                                      data-testid={`cell-${row.key}-${m.monthKey}`}
                                    >
                                      {formatRand(val)}
                                    </button>
                                  )}
                                </td>
                              );
                            }

                            const pctRef = (row.key === "variance") ? m.variancePct : (row.key === "ytdVariance") ? m.ytdVariancePct : (row.key === "variancePct" || row.key === "ytdVariancePct") ? val : undefined;
                            const colorClass = row.colorCoded ? getCellColor(val, pctRef) : row.colorClass;

                            return (
                              <td
                                key={m.monthKey}
                                className={`px-4 py-2.5 text-right font-mono text-sm ${colorClass} ${isClickable ? "cursor-pointer hover:bg-blue-50/80 hover:underline decoration-blue-300 underline-offset-2 transition-colors rounded" : ""}`}
                                onClick={isClickable ? () => setDrawerMonth({
                                  monthKey: m.monthKey,
                                  monthLabel: m.monthLabel,
                                  defaultFilter: row.key === 'realisedCOS' ? 'realised' : row.key === 'unrealisedCOS' ? 'unrealised' : 'all'
                                }) : undefined}
                                data-testid={`cell-${row.key}-${m.monthKey}`}
                              >
                                {formatCell(row, val)}
                              </td>
                            );
                          })}
                        </tr>
                        {row.expandable && isExpanded && row.projectsKey && (projectNamesByRow[row.projectsKey] || []).map((pName) => (
                          <tr
                            key={`${row.key}-${pName}`}
                            className="border-b border-slate-50 bg-blue-50/20 hover:bg-blue-50/50 transition-colors"
                            data-testid={`row-detail-${row.key}-${pName}`}
                          >
                            <td className="sticky left-0 z-10 bg-blue-50/30 backdrop-blur-sm pl-11 pr-4 py-1.5 text-xs text-muted-foreground truncate max-w-[200px] border-r border-border" title={pName}>
                              <span className="cursor-pointer hover:text-blue-600 hover:underline decoration-dashed underline-offset-2 transition-colors">
                                {pName}
                              </span>
                            </td>
                            {months.map((m) => {
                              const projArr = row.projectsKey ? (m as any)[row.projectsKey] as ProjectBreakdown[] : [];
                              const proj = projArr?.find((p: ProjectBreakdown) => p.projectName === pName);
                              const val = proj?.value ?? 0;
                              const drillFilter = row.key === 'realisedCOS' ? 'realised' as const : row.key === 'unrealisedCOS' ? 'unrealised' as const : 'all' as const;
                              return (
                                <td
                                  key={m.monthKey}
                                  className={`px-4 py-1.5 text-right font-mono text-xs text-blue-600/70 ${val !== 0 ? "cursor-pointer hover:bg-blue-50/80 hover:underline decoration-blue-300 underline-offset-2 transition-colors rounded" : ""}`}
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
