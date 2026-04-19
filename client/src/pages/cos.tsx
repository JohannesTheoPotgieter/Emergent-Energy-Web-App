import React, { useState, useMemo, useCallback } from "react";
import { FinanceShell } from "@/components/layout/FinanceShell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest, fetchQueryFn, invalidateDashboardQueries } from "@/lib/queryClient";
import { useFinanceQuery } from "@/lib/finance-trust";
import { DataTrustBadge } from "@/components/ui/data-trust-badge";
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
  HelpCircle,
  Search,
  Filter,
  FileText,
  AlertCircle,
  Inbox,
  Loader2,
  ExternalLink,
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
  committedCOS: number;
  plannedCOS: number;
  qbOnlyActual: number;
  appOnlyPending: number;
  budget: number;
  variance: number;
  variancePct: number;
  /** QB COS actual minus (Realised + Committed) in app. Positive = QB has more than the app recognises. */
  qbVsAppVariance?: number;
  qbVsAppVariancePct?: number;
  ytdCOS: number;
  ytdRealised: number;
  ytdCommitted: number;
  ytdPlanned: number;
  ytdQbOnly: number;
  ytdAppOnlyPending: number;
  ytdBudget: number;
  ytdVariance: number;
  ytdVariancePct: number;
  cosProjects: ProjectBreakdown[];
  realisedProjects: ProjectBreakdown[];
  committedProjects: ProjectBreakdown[];
  plannedProjects: ProjectBreakdown[];
  qbOnlyProjects: ProjectBreakdown[];
  appOnlyPendingProjects: ProjectBreakdown[];
}

interface MonthDetailItem {
  id: string;
  projectName: string | null;
  category: string | null;
  lineItem: string | null;
  appAmount: number | null;
  qbAmount: number | null;
  invoiceNumber: string | null;
  qbBillNumber: string | null;
  invoiceDate: string | null;
  invoiceDateConfirmed: boolean;
  supplier: string | null;
  month: string;
  poNumber: string | null;
  qbTransactionType: string | null;
  qbTransactionDate: string | null;
  recognitionDate: string | null;
  syncSource: string | null;
  sourceTraceId: string | null;
  matchStatus: "matched" | "qb_only" | "app_only";
  cosState: "realised" | "committed" | "planned" | "qb_actual";
  reasonBucket: "matched realised" | "matched committed" | "QB-only actual" | "app-only pending" | "planned";
}

interface MonthDetail {
  monthKey: string;
  lineCount: number;
  totalAmount: number;
  realisedTotal: number;
  committedTotal: number;
  plannedTotal: number;
  qbOnlyTotal: number;
  appOnlyPendingTotal: number;
  realisedCount: number;
  committedCount: number;
  plannedCount: number;
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
  projectsKey?: "cosProjects" | "realisedProjects" | "committedProjects" | "plannedProjects" | "qbOnlyProjects" | "appOnlyPendingProjects";
}[] = [
  // Grid rows per spec: COS Planned → COS Realised → COS Committed → QB COS → QB/App Recon.
  // Planned = all cost lines in the app that have a planned date (budget baseline, no duplication)
  { key: "totalCOS", label: "COS Planned", dataKey: "totalCOS", editable: false, colorClass: "text-purple-600 font-semibold", group: "monthly", expandable: true, projectsKey: "cosProjects" },
  { key: "budget", label: "Budget (Manual)", dataKey: "budget", editable: true, colorClass: "text-purple-600/60", group: "monthly" },
  // Committed = planned line with an invoice captured and linked, but invoice date NOT yet confirmed (not black)
  { key: "committedCOS", label: "COS Committed", dataKey: "committedCOS", editable: false, colorClass: "text-amber-600 font-semibold", group: "monthly", expandable: true, projectsKey: "committedProjects" },
  // Realised = invoice date confirmed (black) AND invoice linked
  { key: "realisedCOS", label: "COS Realised", dataKey: "realisedCOS", editable: false, colorClass: "text-foreground font-bold", group: "monthly", expandable: true, projectsKey: "realisedProjects" },
  { key: "qbOnlyActual", label: "Quickbooks COS", dataKey: "qbOnlyActual", editable: false, colorClass: "text-blue-600 font-semibold", group: "monthly", expandable: true, projectsKey: "qbOnlyProjects" },
  { key: "variance", label: "Budget Variance", dataKey: "variance", editable: false, colorClass: "", group: "monthly", colorCoded: true },
  { key: "variancePct", label: "Budget Variance %", dataKey: "variancePct", editable: false, colorClass: "", group: "monthly", colorCoded: true },
  { key: "ytdBudget", label: "YTD Planned (Budget)", dataKey: "ytdBudget", editable: false, colorClass: "text-purple-600", group: "ytd" },
  { key: "ytdCommitted", label: "YTD Committed", dataKey: "ytdCommitted", editable: false, colorClass: "text-amber-600", group: "ytd" },
  { key: "ytdRealised", label: "YTD Realised", dataKey: "ytdRealised", editable: false, colorClass: "text-foreground font-bold", group: "ytd" },
  { key: "ytdQbOnly", label: "YTD QB Actual", dataKey: "ytdQbOnly", editable: false, colorClass: "text-blue-600", group: "ytd" },
  { key: "ytdVariance", label: "YTD Variance", dataKey: "ytdVariance", editable: false, colorClass: "", group: "ytd", colorCoded: true },
  { key: "ytdVariancePct", label: "YTD Variance %", dataKey: "ytdVariancePct", editable: false, colorClass: "", group: "ytd", colorCoded: true },
];

function CosStateBadge({ state }: { state: "realised" | "committed" | "planned" | "qb_actual" }) {
  const styles: Record<string, string> = {
    realised: "bg-emerald-50 text-emerald-700 border-emerald-200",
    committed: "bg-amber-50 text-amber-700 border-amber-200",
    planned: "bg-purple-50 text-purple-700 border-purple-200",
    qb_actual: "bg-blue-50 text-blue-700 border-blue-200",
  };
  const labels: Record<string, string> = {
    realised: "Realised",
    committed: "Committed",
    planned: "Planned",
    qb_actual: "QB Actual",
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border ${styles[state]}`}>
      {labels[state]}
    </span>
  );
}

function MatchStatusBadge({ status }: { status: "matched" | "qb_only" | "app_only" }) {
  const styles: Record<string, string> = {
    matched: "bg-emerald-50 text-emerald-700 border-emerald-200",
    qb_only: "bg-blue-50 text-blue-700 border-blue-200",
    app_only: "bg-slate-50 text-slate-700 border-slate-200",
  };
  const labels: Record<string, string> = {
    matched: "Matched",
    qb_only: "QB only",
    app_only: "App only",
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function MonthDetailDrawer({ monthKey, monthLabel, onClose, defaultFilter = "all", defaultProject = "all" }: { monthKey: string; monthLabel: string; onClose: () => void; defaultFilter?: "all" | "realised" | "committed" | "planned" | "qb_actual"; defaultProject?: string }) {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"all" | "realised" | "committed" | "planned" | "qb_actual">(defaultFilter);
  const [projectFilter, setProjectFilter] = useState<string>(defaultProject);
  const stateParam = stateFilter !== "all" ? `&state=${stateFilter}` : "";
  const projectParam = projectFilter !== "all" ? `&project=${encodeURIComponent(projectFilter)}` : "";

  const { data, isLoading, isError, error, refetch } = useQuery<MonthDetail>({
    queryKey: ["/api/cos-tracker/month-detail", monthKey, stateFilter, projectFilter],
    queryFn: fetchQueryFn(`/api/cos-tracker/month-detail?monthKey=${monthKey}${stateParam}${projectParam}`),
    retry: 1,
  });

  const filtered = useMemo(() => {
    if (!data?.items) return [];
    let items = data.items;
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(i =>
        (i.projectName || "").toLowerCase().includes(q) ||
        (i.category || "").toLowerCase().includes(q) ||
        (i.lineItem || "").toLowerCase().includes(q) ||
        (i.invoiceNumber || "").toLowerCase().includes(q) ||
        (i.qbBillNumber || "").toLowerCase().includes(q) ||
        (i.supplier || "").toLowerCase().includes(q)
      );
    }
    return items;
  }, [data, search, stateFilter, projectFilter]);

  const allProjects = useMemo(() => {
    const names = new Set((data?.items || []).map(i => i.projectName).filter(Boolean) as string[]);
    return Array.from(names).sort();
  }, [data]);

  const totalAppAmount = useMemo(
    () => filtered.reduce((sum, item) => sum + (item.appAmount ?? 0), 0),
    [filtered],
  );
  const totalQbAmount = useMemo(
    () => filtered.reduce((sum, item) => sum + (item.qbAmount ?? 0), 0),
    [filtered],
  );

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={`COS detail for ${monthLabel}`}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in-0" onClick={onClose} aria-hidden="true" />
      <div className="ml-auto relative w-full sm:max-w-3xl lg:max-w-5xl xl:max-w-6xl bg-background shadow-2xl flex flex-col h-full animate-in slide-in-from-right-4">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div className="h-8 w-8 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                <FileText className="h-4 w-4 text-purple-600" />
              </div>
              <h3 className="font-bold text-lg sm:text-xl truncate">{monthLabel}</h3>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">Cost-of-sales drill-down with QB / App reconciliation</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-full transition-colors flex-shrink-0"
            aria-label="Close drawer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Summary chips */}
        {!isLoading && !isError && data && (
          <div className="px-4 sm:px-6 py-3 border-b bg-muted/20 flex flex-wrap gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Lines:</span>
              <span className="font-semibold">{filtered.length}</span>
              {filtered.length !== (data.items?.length ?? 0) && (
                <span className="text-muted-foreground">/ {data.items?.length ?? 0}</span>
              )}
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">App total:</span>
              <span className="font-semibold font-mono">{formatRand(totalAppAmount)}</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">QB total:</span>
              <span className="font-semibold font-mono text-blue-700">{formatRand(totalQbAmount)}</span>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="px-4 sm:px-6 py-3 border-b flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search project, supplier, invoice, bill..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1 sm:flex-initial">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <select
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value as any)}
                className="h-9 pl-8 pr-3 border rounded-md bg-background text-xs sm:text-sm w-full"
                aria-label="Filter by status"
              >
                <option value="all">All statuses</option>
                <option value="realised">Realised</option>
                <option value="committed">Committed</option>
                <option value="planned">Planned</option>
                <option value="qb_actual">QB Actual</option>
              </select>
            </div>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="h-9 px-3 border rounded-md bg-background text-xs sm:text-sm flex-1 sm:flex-initial"
              aria-label="Filter by project"
            >
              <option value="all">All projects</option>
              {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-12 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>Loading cost lines…</span>
            </div>
          ) : isError ? (
            <div className="p-12 flex flex-col items-center justify-center gap-3 text-center">
              <div className="h-12 w-12 rounded-full bg-red-50 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <p className="font-medium text-sm">Unable to load detail</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-md">{error instanceof Error ? error.message : "An unexpected error occurred fetching the drill-down."}</p>
              </div>
              <button
                onClick={() => refetch()}
                className="text-xs font-medium px-3 py-1.5 rounded-md border bg-background hover:bg-muted transition-colors"
              >
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center gap-2 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Inbox className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No cost lines</p>
              <p className="text-xs text-muted-foreground max-w-md">
                No rows match the current filters for {monthLabel}. Try clearing the search or switching the status filter.
              </p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card border-b z-10 shadow-sm">
                    <tr>
                      <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Project</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Supplier</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">App Invoice</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">QB Bill</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">PO</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">App</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">QB</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Recognised</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Match</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => (
                      <tr key={item.id} className="border-b hover:bg-muted/40 transition-colors">
                        <td className="px-3 py-2">
                          {item.projectName ? (
                            <button
                              className="text-blue-600 hover:underline inline-flex items-center gap-1 font-medium"
                              onClick={() => navigate(`/project/${encodeURIComponent(item.projectName || "")}?tab=expenditure`)}
                            >
                              <span className="truncate max-w-[200px]">{item.projectName}</span>
                              <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-60" />
                            </button>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground truncate max-w-[160px]">{item.supplier || "—"}</td>
                        <td className="px-3 py-2 font-mono text-[11px]">{item.invoiceNumber || "—"}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-blue-700">{item.qbBillNumber || "—"}</td>
                        <td className="px-3 py-2 font-mono text-[11px]">{item.poNumber || "—"}</td>
                        <td className="px-3 py-2 text-right font-mono">{item.appAmount == null ? <span className="text-muted-foreground">—</span> : formatRand(item.appAmount)}</td>
                        <td className="px-3 py-2 text-right font-mono text-blue-700">{item.qbAmount == null ? <span className="text-muted-foreground">—</span> : formatRand(item.qbAmount)}</td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{item.recognitionDate || "—"}</td>
                        <td className="px-3 py-2"><MatchStatusBadge status={item.matchStatus} /></td>
                        <td className="px-3 py-2"><CosStateBadge state={item.cosState} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile card view */}
              <div className="md:hidden divide-y">
                {filtered.map((item) => (
                  <div key={item.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {item.projectName ? (
                          <button
                            className="text-blue-600 hover:underline font-medium text-sm truncate block"
                            onClick={() => navigate(`/project/${encodeURIComponent(item.projectName || "")}?tab=expenditure`)}
                          >
                            {item.projectName}
                          </button>
                        ) : <span className="text-sm text-muted-foreground">Unassigned</span>}
                        <p className="text-xs text-muted-foreground truncate">{item.supplier || "—"}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <CosStateBadge state={item.cosState} />
                        <MatchStatusBadge status={item.matchStatus} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">App Inv:</span>{" "}
                        <span className="font-mono">{item.invoiceNumber || "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">QB Bill:</span>{" "}
                        <span className="font-mono text-blue-700">{item.qbBillNumber || "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">App:</span>{" "}
                        <span className="font-mono font-medium">{item.appAmount == null ? "—" : formatRand(item.appAmount)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">QB:</span>{" "}
                        <span className="font-mono font-medium text-blue-700">{item.qbAmount == null ? "—" : formatRand(item.qbAmount)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CosTracker() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [drawerMonth, setDrawerMonth] = useState<{ monthKey: string; monthLabel: string; defaultFilter?: "all" | "realised" | "committed" | "planned" | "qb_actual"; defaultProject?: string } | null>(null);
  const { data: monthsData, trust, isLoading, isError, error, refetch } = useFinanceQuery<MonthData[]>({
    queryKey: ["/api/cos-tracker"],
    url: "/api/cos-tracker",
    staleTime: 30_000,
  });
  const months: MonthData[] = monthsData ?? [];

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
    for (const key of ["cosProjects", "realisedProjects", "committedProjects", "plannedProjects", "qbOnlyProjects", "appOnlyPendingProjects"] as const) {
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
        "COS Planned (Budget)": m.plannedCOS,
        "COS Committed": m.committedCOS,
        "COS Realised": m.realisedCOS,
        "Quickbooks COS": m.qbOnlyActual,
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
      return `${val.toFixed(1)}%`;
    }
    return formatRand(val);
  };

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <div className="p-4 md:p-6"><PageError title="Unable to load COS Tracker" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></div>;

  const ytdQbCos = lastMonth?.ytdQbOnly ?? 0;
  const ytdPlanned = lastMonth?.ytdPlanned ?? 0;
  const ytdCommitted = lastMonth?.ytdCommitted ?? 0;
  const ytdRealised = lastMonth?.ytdRealised ?? 0;

  const kpiCards = [
    { id: "ytd-planned", label: "COS Planned (Budget)", value: formatRand(ytdPlanned), icon: Target, iconBg: "bg-purple-100", iconColor: "text-purple-600", valueColor: "text-purple-700", borderColor: "border-purple-200", tooltip: "All cost lines in the app with a planned date — the budget baseline for the period." },
    { id: "ytd-committed", label: "COS Committed", value: formatRand(ytdCommitted), icon: Activity, iconBg: "bg-amber-100", iconColor: "text-amber-600", valueColor: "text-amber-700", borderColor: "border-amber-200", tooltip: "Planned cost with a supplier invoice captured and linked, but invoice date not yet confirmed (red/orange font in app)." },
    { id: "ytd-realised", label: "COS Realised", value: formatRand(ytdRealised), icon: TrendingDown, iconBg: "bg-muted", iconColor: "text-foreground", valueColor: "text-foreground font-black", borderColor: "border-border", tooltip: "Invoice date confirmed (black font) AND invoice linked to the cost line. Both gates required." },
    { id: "ytd-qb-cos", label: "Quickbooks COS", value: formatRand(ytdQbCos), icon: DollarSign, iconBg: "bg-sky-100", iconColor: "text-sky-600", valueColor: "text-sky-700", borderColor: "border-sky-200", tooltip: "COS from QuickBooks bills (YTD). Accounting source of truth." },
  ];

  return (
    <FinanceShell><div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50/50">
      <div className="bg-card border-b border-border/80 px-3 sm:px-6 py-4 sm:py-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 max-w-[1800px] mx-auto">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl sm:text-3xl font-heading font-bold tracking-tight text-foreground" data-testid="text-page-title">
                Cost of Sales Tracker FY26
              </h2>
              <DataTrustBadge trust={trust} />
            </div>
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
                Planned = no PO or invoice. Committed = PO or invoice captured but invoice date still <strong className="text-red-600">red</strong> (unconfirmed). Realised = supplier invoice number captured AND invoice date confirmed <strong className="text-foreground">black</strong>. Both gates are required — invoice alone is no longer sufficient. Data sourced from Finance - COS sheets and Expenditure Breakdown.
              </p>
            </div>
          </CardContent>
        </Card>


        <TooltipProvider delayDuration={300}>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4" role="region" aria-label="COS KPI Summary">
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
                      {trust?.nullCount && trust.nullCount > 0 ? (
                        <p className="text-[11px] font-medium text-amber-600 mt-0.5" data-testid={`text-${kpi.id}-null-count`}>
                          ({trust.nullCount} missing)
                        </p>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TooltipProvider>

        <Card className="shadow-sm overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-slate-50 to-white border-b px-3 sm:px-6 py-3 sm:py-4">
            <CardTitle className="text-base sm:text-lg font-semibold tracking-tight">COS Overview</CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6">
            <div className="h-[280px] sm:h-[420px]" data-testid="chart-cos">
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
                  <Bar dataKey="COS Planned (Budget)" fill="#a855f7" opacity={0.3} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="COS Committed" stackId="app" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="COS Realised" stackId="app" fill="#1e293b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Quickbooks COS" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-slate-50 to-white border-b px-3 sm:px-6 py-3 sm:py-4">
            <CardTitle className="text-base sm:text-lg font-semibold tracking-tight">Monthly COS Grid</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm" data-testid="table-cos-grid">
                <thead>
                  <tr className="border-b bg-muted/80">
                    <th className="sticky left-0 z-10 bg-muted/95 backdrop-blur-sm px-3 sm:px-5 py-2 sm:py-3 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[10px] sm:text-[11px] min-w-[140px] sm:min-w-[200px] border-r border-border">
                      Metric
                    </th>
                    {months.map((m) => (
                      <th key={m.monthKey} className="px-2 sm:px-4 py-2 sm:py-3 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[10px] sm:text-[11px] whitespace-nowrap min-w-[85px] sm:min-w-[110px]">
                        {m.monthLabel}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROW_DEFS.map((row, rowIdx) => {
                    const isYtd = row.group === "ytd";
                    const isExpanded = expandedRows.has(row.key);
                    const isClickable = ["totalCOS", "realisedCOS", "committedCOS", "qbOnlyActual"].includes(row.key);
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
                          <td className={`sticky left-0 z-10 px-3 sm:px-5 py-2 sm:py-2.5 font-medium text-xs sm:text-sm border-r border-border ${isYtd ? "bg-muted/95" : "bg-card/95"} backdrop-blur-sm`}>
                            {row.expandable ? (
                              <button
                                type="button"
                                className="flex items-center gap-1.5 hover:text-blue-600 transition-colors group"
                                onClick={() => toggleRow(row.key)}
                                aria-expanded={isExpanded}
                                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.label} by project`}
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
                                <td key={m.monthKey} className="px-1 sm:px-2 py-1 sm:py-1.5 text-right">
                                  {isEditingCell ? (
                                    <Input
                                      type="number"
                                      className="h-7 sm:h-8 w-full text-right font-mono text-xs sm:text-sm border-purple-300 focus:ring-purple-400"
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
                                      className={`w-full text-right font-mono cursor-pointer hover:bg-purple-50 rounded-lg px-1.5 sm:px-3 py-1 sm:py-1.5 transition-colors ${row.colorClass}`}
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
                                className={`px-2 sm:px-4 py-1.5 sm:py-2.5 text-right font-mono text-xs sm:text-sm ${colorClass} ${isClickable ? "cursor-pointer hover:bg-blue-50/80 hover:underline decoration-blue-300 underline-offset-2 transition-colors rounded" : ""}`}
                                onClick={isClickable ? () => setDrawerMonth({
                                  monthKey: m.monthKey,
                                  monthLabel: m.monthLabel,
                                  defaultFilter: row.key === 'realisedCOS' ? 'realised' : row.key === 'committedCOS' ? 'committed' : row.key === 'appOnlyPending' ? 'planned' : row.key === 'qbOnlyActual' ? 'qb_actual' : 'all'
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
                            <td className="sticky left-0 z-10 bg-blue-50/30 backdrop-blur-sm pl-7 sm:pl-11 pr-2 sm:pr-4 py-1 sm:py-1.5 text-[10px] sm:text-xs text-muted-foreground truncate max-w-[140px] sm:max-w-[200px] border-r border-border" title={pName}>
                              <button
                                type="button"
                                className="cursor-pointer text-blue-600 hover:text-blue-800 hover:underline decoration-dashed underline-offset-2 transition-colors text-left"
                                onClick={(e) => { e.stopPropagation(); navigate(`/project/${encodeURIComponent(pName)}?tab=expenditure`); }}
                                aria-label={`View ${pName} expenditure details`}
                              >
                                {pName}
                              </button>
                            </td>
                            {months.map((m) => {
                              const projArr = row.projectsKey ? (m as any)[row.projectsKey] as ProjectBreakdown[] : [];
                              const proj = projArr?.find((p: ProjectBreakdown) => p.projectName === pName);
                              const val = proj?.value ?? 0;
                              const drillFilter = row.key === 'realisedCOS' ? 'realised' as const : row.key === 'committedCOS' ? 'committed' as const : row.key === 'appOnlyPending' ? 'planned' as const : row.key === 'qbOnlyActual' ? 'qb_actual' as const : 'all' as const;
                              return (
                                <td
                                  key={m.monthKey}
                                  className={`px-2 sm:px-4 py-1 sm:py-1.5 text-right font-mono text-[10px] sm:text-xs text-blue-600/70 ${val !== 0 ? "cursor-pointer hover:bg-blue-50/80 hover:underline decoration-blue-300 underline-offset-2 transition-colors rounded" : ""}`}
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
    </div></FinanceShell>
  );
}
