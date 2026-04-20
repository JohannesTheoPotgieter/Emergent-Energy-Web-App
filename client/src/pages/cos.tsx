import React, { useState, useMemo, useCallback } from "react";
import { FinanceShell } from "@/components/layout/FinanceShell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SectionHeader } from "@/components/layout/page-shell";
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
  LineChart,
} from "recharts";
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
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
  Wallet,
  Eye,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ListChecks,
  LineChart as LineChartIcon,
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

type CosTab = "realised" | "committed" | "planned";

interface RowDef {
  key: string;
  label: string;
  dataKey: keyof MonthData;
  editable: boolean;
  colorClass: string;
  group: "monthly" | "ytd";
  colorCoded?: boolean;
  expandable?: boolean;
  projectsKey?: "cosProjects" | "realisedProjects" | "committedProjects" | "plannedProjects" | "qbOnlyProjects" | "appOnlyPendingProjects";
  tabs: CosTab[];
}

const ROW_DEFS: RowDef[] = [
  // Planned tab: budget baseline + manual override
  { key: "totalCOS", label: "COS Planned", dataKey: "totalCOS", editable: false, colorClass: "text-emerald-700 font-semibold", group: "monthly", expandable: true, projectsKey: "plannedProjects", tabs: ["planned"] },
  { key: "budget", label: "Budget (Manual)", dataKey: "budget", editable: true, colorClass: "text-emerald-700/60", group: "monthly", tabs: ["planned"] },
  // Committed tab: planned with invoice captured but date unconfirmed
  { key: "committedCOS", label: "COS Committed", dataKey: "committedCOS", editable: false, colorClass: "text-amber-700 font-semibold", group: "monthly", expandable: true, projectsKey: "committedProjects", tabs: ["committed"] },
  // Realised tab: invoice date confirmed AND invoice linked, plus QB reconciliation
  { key: "realisedCOS", label: "COS Realised", dataKey: "realisedCOS", editable: false, colorClass: "text-foreground font-bold", group: "monthly", expandable: true, projectsKey: "realisedProjects", tabs: ["realised"] },
  { key: "qbOnlyActual", label: "Quickbooks COS", dataKey: "qbOnlyActual", editable: false, colorClass: "text-emerald-600 font-semibold", group: "monthly", expandable: true, projectsKey: "qbOnlyProjects", tabs: ["realised"] },
  { key: "variance", label: "Budget Variance", dataKey: "variance", editable: false, colorClass: "", group: "monthly", colorCoded: true, tabs: ["realised", "committed", "planned"] },
  { key: "variancePct", label: "Budget Variance %", dataKey: "variancePct", editable: false, colorClass: "", group: "monthly", colorCoded: true, tabs: ["realised", "committed", "planned"] },
  { key: "ytdBudget", label: "YTD Planned (Budget)", dataKey: "ytdBudget", editable: false, colorClass: "text-emerald-700", group: "ytd", tabs: ["planned"] },
  { key: "ytdCommitted", label: "YTD Committed", dataKey: "ytdCommitted", editable: false, colorClass: "text-amber-700", group: "ytd", tabs: ["committed"] },
  { key: "ytdRealised", label: "YTD Realised", dataKey: "ytdRealised", editable: false, colorClass: "text-foreground font-bold", group: "ytd", tabs: ["realised"] },
  { key: "ytdQbOnly", label: "YTD QB Actual", dataKey: "ytdQbOnly", editable: false, colorClass: "text-emerald-600", group: "ytd", tabs: ["realised"] },
  { key: "ytdVariance", label: "YTD Variance", dataKey: "ytdVariance", editable: false, colorClass: "", group: "ytd", colorCoded: true, tabs: ["realised", "committed", "planned"] },
  { key: "ytdVariancePct", label: "YTD Variance %", dataKey: "ytdVariancePct", editable: false, colorClass: "", group: "ytd", colorCoded: true, tabs: ["realised", "committed", "planned"] },
];

const TAB_META: Record<CosTab, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  ytdKey: keyof MonthData;
  monthKey: keyof MonthData;
  defaultDrawerFilter: "realised" | "committed" | "planned";
  description: string;
  accent: string;
  sparkColor: string;
}> = {
  realised: { label: "Realised", icon: CheckCircle2, ytdKey: "ytdRealised", monthKey: "realisedCOS", defaultDrawerFilter: "realised", description: "Invoice date confirmed and supplier invoice linked.", accent: "text-foreground", sparkColor: "#0f172a" },
  committed: { label: "Committed", icon: Clock, ytdKey: "ytdCommitted", monthKey: "committedCOS", defaultDrawerFilter: "committed", description: "Invoice captured but invoice date not yet confirmed.", accent: "text-amber-700", sparkColor: "#b45309" },
  planned: { label: "Planned", icon: ListChecks, ytdKey: "ytdPlanned", monthKey: "totalCOS", defaultDrawerFilter: "planned", description: "Cost lines with a planned date — the budget baseline.", accent: "text-emerald-700", sparkColor: "#16a34a" },
};

function CosStateBadge({ state }: { state: "realised" | "committed" | "planned" | "qb_actual" }) {
  const styles: Record<string, string> = {
    realised: "bg-emerald-50 text-emerald-700 border-emerald-200",
    committed: "bg-amber-50 text-amber-700 border-amber-200",
    planned: "bg-emerald-50/60 text-emerald-700 border-emerald-200/70",
    qb_actual: "bg-card text-foreground border-border",
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
    qb_only: "bg-card text-foreground border-border",
    app_only: "bg-muted text-muted-foreground border-border",
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
        <div className="px-4 sm:px-6 py-4 border-b bg-gradient-to-r from-emerald-50/40 to-card flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <FileText className="h-4 w-4 text-emerald-700" />
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
              <span className="font-semibold font-mono text-foreground">{formatRand(totalQbAmount)}</span>
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
                              className="text-emerald-700 hover:underline inline-flex items-center gap-1 font-medium"
                              onClick={() => navigate(`/project/${encodeURIComponent(item.projectName || "")}?tab=expenditure`)}
                            >
                              <span className="truncate max-w-[200px]">{item.projectName}</span>
                              <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-60" />
                            </button>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground truncate max-w-[160px]">{item.supplier || "—"}</td>
                        <td className="px-3 py-2 font-mono text-[11px]">{item.invoiceNumber || "—"}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-foreground">{item.qbBillNumber || "—"}</td>
                        <td className="px-3 py-2 font-mono text-[11px]">{item.poNumber || "—"}</td>
                        <td className="px-3 py-2 text-right font-mono">{item.appAmount == null ? <span className="text-muted-foreground">—</span> : formatRand(item.appAmount)}</td>
                        <td className="px-3 py-2 text-right font-mono text-foreground">{item.qbAmount == null ? <span className="text-muted-foreground">—</span> : formatRand(item.qbAmount)}</td>
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
                            className="text-emerald-700 hover:underline font-medium text-sm truncate block"
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
                        <span className="font-mono text-foreground">{item.qbBillNumber || "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">App:</span>{" "}
                        <span className="font-mono font-medium">{item.appAmount == null ? "—" : formatRand(item.appAmount)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">QB:</span>{" "}
                        <span className="font-mono font-medium text-foreground">{item.qbAmount == null ? "—" : formatRand(item.qbAmount)}</span>
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

  const [activeTab, setActiveTab] = useState<"recon" | "trend">("recon");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);

  const { data: rawMonths = [], isLoading, isError, error, refetch, dataUpdatedAt, isFetching } = useQuery<MonthData[]>({
    queryKey: ["/api/cos-tracker"],
    staleTime: 30_000,
  });

  const { data: projectsSummary = [] } = useQuery<Array<{ project_name: string; has_tracker_import?: boolean }>>({
    queryKey: ["/api/projects-summary"],
  });

  const trackerProjectNames = useMemo(() => {
    const set = new Set<string>();
    projectsSummary.forEach((p) => {
      if (p.project_name && p.has_tracker_import) set.add(p.project_name);
    });
    return Array.from(set).sort();
  }, [projectsSummary]);

  const filteredRailNames = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return trackerProjectNames;
    return trackerProjectNames.filter((n) => n.toLowerCase().includes(q));
  }, [trackerProjectNames, projectSearch]);

  const isProjectFiltered = selectedProjects.length > 0;

  // When a project filter is active, derive each month's totals from its per-project
  // breakdown arrays (filtered to selected projects) and rebuild YTD chains. Budget is
  // tracked at the company level only, so it falls to 0 in the filtered view.
  const months = useMemo<MonthData[]>(() => {
    if (!isProjectFiltered) return rawMonths;
    const sel = new Set(selectedProjects);
    const sumProjects = (arr: ProjectBreakdown[] | undefined) =>
      (arr ?? []).filter((p) => sel.has(p.projectName)).reduce((s, p) => s + (p.value ?? 0), 0);
    const filterProjects = (arr: ProjectBreakdown[] | undefined) =>
      (arr ?? []).filter((p) => sel.has(p.projectName));
    let ytdCOS = 0, ytdRealised = 0, ytdCommitted = 0, ytdPlanned = 0, ytdQbOnly = 0, ytdAppOnlyPending = 0;
    const ytdBudget = 0;
    return rawMonths.map((m) => {
      const realisedCOS = sumProjects(m.realisedProjects);
      const committedCOS = sumProjects(m.committedProjects);
      const plannedCOS = sumProjects(m.plannedProjects);
      const totalCOS = realisedCOS + committedCOS;
      const qbOnlyActual = sumProjects(m.qbOnlyProjects);
      const appOnlyPending = sumProjects(m.appOnlyPendingProjects);
      const budget = 0;
      const variance = totalCOS - budget;
      const variancePct = 0;
      ytdCOS += totalCOS;
      ytdRealised += realisedCOS;
      ytdCommitted += committedCOS;
      ytdPlanned += plannedCOS;
      ytdQbOnly += qbOnlyActual;
      ytdAppOnlyPending += appOnlyPending;
      const ytdVariance = ytdCOS - ytdBudget;
      const ytdVariancePct = 0;
      return {
        ...m,
        totalCOS,
        realisedCOS,
        committedCOS,
        plannedCOS,
        qbOnlyActual,
        appOnlyPending,
        budget,
        variance,
        variancePct,
        qbVsAppVariance: qbOnlyActual - totalCOS,
        qbVsAppVariancePct: qbOnlyActual !== 0 ? ((qbOnlyActual - totalCOS) / qbOnlyActual) * 100 : 0,
        ytdCOS,
        ytdRealised,
        ytdCommitted,
        ytdPlanned,
        ytdQbOnly,
        ytdAppOnlyPending,
        ytdBudget,
        ytdVariance,
        ytdVariancePct,
        cosProjects: filterProjects(m.cosProjects),
        realisedProjects: filterProjects(m.realisedProjects),
        committedProjects: filterProjects(m.committedProjects),
        plannedProjects: filterProjects(m.plannedProjects),
        qbOnlyProjects: filterProjects(m.qbOnlyProjects),
        appOnlyPendingProjects: filterProjects(m.appOnlyPendingProjects),
      };
    });
  }, [rawMonths, isProjectFiltered, selectedProjects]);

  const mutation = useMutation({
    mutationFn: async (body: { trackerType: string; monthKey: string; budget?: string }) => {
      await apiRequest("POST", "/api/tracker-monthly", body);
    },
    onMutate: async (body: { trackerType: string; monthKey: string; budget?: string }) => {
      if (body.budget == null) return;
      const newBudget = Number(body.budget);
      if (!Number.isFinite(newBudget)) return;
      await qc.cancelQueries({ queryKey: ["/api/cos-tracker"] });
      const previous = qc.getQueryData<MonthData[]>(["/api/cos-tracker"]);
      if (!previous) return { previous };
      const targetIdx = previous.findIndex((m) => m.monthKey === body.monthKey);
      if (targetIdx < 0) return { previous };
      const next = previous.map((m) => ({ ...m }));
      next[targetIdx].budget = newBudget;
      // Recompute per-month variance for the changed month and cumulative YTD from that
      // month onward — mirrors server formula in finance-routes.ts (variance = totalCOS - budget;
      // ytdBudget = cumulative budget; ytdVariance = ytdCOS - ytdBudget).
      let ytdBudget = 0;
      let ytdCOS = 0;
      for (let i = 0; i < next.length; i++) {
        const m = next[i];
        ytdBudget += m.budget ?? 0;
        ytdCOS += m.totalCOS ?? 0;
        if (i >= targetIdx) {
          m.variance = (m.totalCOS ?? 0) - (m.budget ?? 0);
          m.variancePct = (m.budget ?? 0) !== 0 ? (m.variance / (m.budget ?? 0)) * 100 : 0;
          m.ytdBudget = ytdBudget;
          m.ytdVariance = ytdCOS - ytdBudget;
          m.ytdVariancePct = ytdBudget !== 0 ? (m.ytdVariance / ytdBudget) * 100 : 0;
        }
      }
      qc.setQueryData<MonthData[]>(["/api/cos-tracker"], next);
      return { previous };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.previous) qc.setQueryData(["/api/cos-tracker"], ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["/api/cos-tracker"] });
      invalidateDashboardQueries(qc);
    },
  });

  const lastMonth = useMemo(() => (months.length ? months[months.length - 1] : null), [months]);
  const prevMonth = useMemo(() => (months.length > 1 ? months[months.length - 2] : null), [months]);

  const fyTotals = useMemo(
    () => ({
      budget: months.reduce((s, m) => s + (m.budget ?? 0), 0),
      planned: months.reduce((s, m) => s + (m.realisedCOS ?? 0) + (m.committedCOS ?? 0) + (m.plannedCOS ?? 0), 0),
      realised: months.reduce((s, m) => s + (m.realisedCOS ?? 0), 0),
      quickbooks: months.reduce((s, m) => s + (m.qbOnlyActual ?? 0), 0),
    }),
    [months],
  );

  // Collect all project names per row from the months data, then narrow by tracker-loaded set
  // and (optionally) by user-selected projects.
  const projectNamesByRow = useMemo(() => {
    const result: Record<string, string[]> = {};
    const trackerSet = new Set(trackerProjectNames);
    const selectedSet = new Set(selectedProjects);
    for (const key of ["cosProjects", "realisedProjects", "committedProjects", "plannedProjects", "qbOnlyProjects", "appOnlyPendingProjects"] as const) {
      const names = new Set<string>();
      for (const m of months) {
        for (const p of m[key] || []) {
          if (!trackerSet.has(p.projectName)) continue;
          if (selectedSet.size > 0 && !selectedSet.has(p.projectName)) continue;
          names.add(p.projectName);
        }
      }
      result[key] = Array.from(names).sort();
    }
    return result;
  }, [months, trackerProjectNames, selectedProjects]);

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
    const payload: Record<string, string> = { trackerType: "COS", monthKey: editing.monthKey };
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
        // Manual budget overlay so edits to the Budget (Manual) row pull through
        // visually to the trend chart. Budget is tracked at company level only,
        // so we omit it (null breaks the line cleanly) when a per-project filter
        // is active to avoid misleading a user with a zeroed-out line.
        "Budget": isProjectFiltered ? null : (m.budget ?? 0),
        // Tracking line: cumulative realised tracking against the cumulative
        // manual budget, expressed as a percentage. Plotted on a secondary
        // right-hand y-axis. Null when no budget exists yet so the line breaks
        // cleanly instead of sitting on the zero baseline.
        "Tracking vs Budget %":
          !isProjectFiltered && m.ytdBudget && m.ytdBudget > 0
            ? Math.round(((m.ytdRealised ?? 0) / m.ytdBudget) * 1000) / 10
            : null,
      })),
    [months, isProjectFiltered],
  );

  const sparkData = useMemo(() => {
    return {
      realised: months.map((m) => ({ x: m.monthKey, y: m.realisedCOS })),
      committed: months.map((m) => ({ x: m.monthKey, y: m.committedCOS })),
      planned: months.map((m) => ({ x: m.monthKey, y: m.totalCOS })),
    } as Record<CosTab, { x: string; y: number }[]>;
  }, [months]);

  const getCellColor = (val: number, variancePct?: number) => {
    const pct = variancePct != null ? Math.abs(variancePct) : null;
    const isPositive = val > 0;
    if (pct !== null) {
      if (pct >= 0.25) return isPositive ? "text-destructive font-bold bg-destructive/10" : "text-emerald-700 font-bold bg-emerald-50";
      if (pct >= 0.15) return isPositive ? "text-amber-700 font-semibold bg-amber-50" : "text-emerald-600 font-semibold bg-emerald-50";
    }
    return isPositive ? "text-destructive" : "text-emerald-700";
  };

  const formatCell = (row: RowDef, val: number) => {
    if (row.key === "variancePct" || row.key === "ytdVariancePct") return `${val.toFixed(1)}%`;
    return formatRand(val);
  };

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <div className="p-4 md:p-6"><PageError title="Unable to load COS Tracker" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></div>;

  const ytdRealised = lastMonth?.ytdRealised ?? 0;
  const ytdCommitted = lastMonth?.ytdCommitted ?? 0;
  const ytdPlanned = lastMonth?.ytdPlanned ?? 0;
  const ytdQbCos = lastMonth?.ytdQbOnly ?? 0;
  const realisationRate = ytdPlanned > 0 ? Math.round((ytdRealised / ytdPlanned) * 100) : 0;

  const kpiByTab: Record<CosTab, { ytdValue: number; lastValue: number; prevValue: number }> = {
    realised: { ytdValue: ytdRealised, lastValue: lastMonth?.realisedCOS ?? 0, prevValue: prevMonth?.realisedCOS ?? 0 },
    committed: { ytdValue: ytdCommitted, lastValue: lastMonth?.committedCOS ?? 0, prevValue: prevMonth?.committedCOS ?? 0 },
    planned: { ytdValue: ytdPlanned, lastValue: lastMonth?.totalCOS ?? 0, prevValue: prevMonth?.totalCOS ?? 0 },
  };

  const renderSparkline = (tab: CosTab) => (
    <div className="h-10 w-28 sm:w-36">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={sparkData[tab]} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line type="monotone" dataKey="y" stroke={TAB_META[tab].sparkColor} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  const renderGrid = () => {
    const rows = ROW_DEFS;
    return (
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
            {rows.map((row, rowIdx) => {
              const isYtd = row.group === "ytd";
              const isExpanded = expandedRows.has(row.key);
              const isClickable = ["totalCOS", "realisedCOS", "committedCOS", "qbOnlyActual"].includes(row.key);
              const isFirstYtd = isYtd && rowIdx > 0 && rows[rowIdx - 1].group !== "ytd";
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
                          className="flex items-center gap-1.5 hover:text-emerald-700 transition-colors group"
                          onClick={() => toggleRow(row.key)}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${row.label} by project`}
                          data-testid={`toggle-${row.key}`}
                        >
                          <span className="text-muted-foreground group-hover:text-emerald-600 transition-colors">
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
                      if (row.editable && !isProjectFiltered) {
                        return (
                          <td key={m.monthKey} className="px-1 sm:px-2 py-1 sm:py-1.5 text-right">
                            {isEditingCell ? (
                              <Input
                                type="number"
                                className="h-7 sm:h-8 w-full text-right font-mono text-xs sm:text-sm border-emerald-300 focus:ring-emerald-400"
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
                                className={`w-full text-right font-mono cursor-pointer hover:bg-emerald-50 rounded-lg px-1.5 sm:px-3 py-1 sm:py-1.5 transition-colors ${row.colorClass}`}
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
                          className={`px-2 sm:px-4 py-1.5 sm:py-2.5 text-right font-mono text-xs sm:text-sm ${colorClass} ${isClickable ? "cursor-pointer hover:bg-emerald-50/70 hover:underline decoration-emerald-300 underline-offset-2 transition-colors rounded" : ""}`}
                          onClick={isClickable ? () => setDrawerMonth({
                            monthKey: m.monthKey,
                            monthLabel: m.monthLabel,
                            defaultFilter: row.key === "realisedCOS" ? "realised" : row.key === "committedCOS" ? "committed" : row.key === "totalCOS" ? "planned" : row.key === "qbOnlyActual" ? "qb_actual" : "all",
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
                      className="border-b border-border/40 bg-emerald-50/20 hover:bg-emerald-50/40 transition-colors"
                      data-testid={`row-detail-${row.key}-${pName}`}
                    >
                      <td className="sticky left-0 z-10 bg-emerald-50/30 backdrop-blur-sm pl-7 sm:pl-11 pr-2 sm:pr-4 py-1 sm:py-1.5 text-[10px] sm:text-xs text-muted-foreground truncate max-w-[140px] sm:max-w-[200px] border-r border-border" title={pName}>
                        <button
                          type="button"
                          className="cursor-pointer text-emerald-700 hover:text-emerald-900 hover:underline decoration-dashed underline-offset-2 transition-colors text-left"
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
                        const drillFilter = row.key === "realisedCOS" ? "realised" as const : row.key === "committedCOS" ? "committed" as const : row.key === "totalCOS" ? "planned" as const : row.key === "qbOnlyActual" ? "qb_actual" as const : "all" as const;
                        return (
                          <td
                            key={m.monthKey}
                            className={`px-2 sm:px-4 py-1 sm:py-1.5 text-right font-mono text-[10px] sm:text-xs text-emerald-700/70 ${val !== 0 ? "cursor-pointer hover:bg-emerald-50/70 hover:underline decoration-emerald-300 underline-offset-2 transition-colors rounded" : ""}`}
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
    );
  };

  type FyCardKey = "budget" | "planned" | "realised" | "quickbooks";
  const FY_CARD_META: Record<FyCardKey, {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    iconBg: string;
    accent: string;
    sparkColor: string;
    getValue: (m: MonthData) => number;
  }> = {
    budget: { label: "FY Budget", icon: Wallet, iconBg: "bg-emerald-50 text-emerald-700 border border-emerald-200", accent: "text-emerald-700", sparkColor: "#16a34a", getValue: (m) => m.budget ?? 0 },
    planned: { label: "FY Planned", icon: ListChecks, iconBg: "bg-emerald-100 text-emerald-700", accent: "text-emerald-700", sparkColor: "#16a34a", getValue: (m) => (m.realisedCOS ?? 0) + (m.committedCOS ?? 0) + (m.plannedCOS ?? 0) },
    realised: { label: "FY Realised", icon: CheckCircle2, iconBg: "bg-foreground/8 text-foreground", accent: "text-foreground", sparkColor: "#0f172a", getValue: (m) => m.realisedCOS ?? 0 },
    quickbooks: { label: "FY Quickbooks", icon: DollarSign, iconBg: "bg-emerald-50 text-emerald-700 border border-emerald-200", accent: "text-emerald-700", sparkColor: "#16a34a", getValue: (m) => m.qbOnlyActual ?? 0 },
  };

  const renderFyKpiCard = (key: FyCardKey) => {
    const meta = FY_CARD_META[key];
    const Icon = meta.icon;
    const fyValue = fyTotals[key];
    const lastValue = lastMonth ? meta.getValue(lastMonth) : 0;
    const prevValue = prevMonth ? meta.getValue(prevMonth) : 0;
    const delta = lastValue - prevValue;
    const deltaPct = prevValue !== 0 ? (delta / Math.abs(prevValue)) * 100 : 0;
    const deltaPositive = delta >= 0;
    const cardSpark = months.map((m) => ({ x: m.monthKey, y: meta.getValue(m) }));
    return (
      <Card key={key} className="border-border shadow-sm">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${meta.iconBg}`}>
              <Icon className="h-3.5 w-3.5" />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{meta.label}</p>
          </div>
          <p className={`text-lg sm:text-xl font-bold font-mono tracking-tight ${meta.accent}`} data-testid={`text-fy-${key}-value`}>
            {formatRand(fyValue)}
          </p>
          <div className="flex items-center justify-between mt-1.5">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Last mo.</span>
              <span className="font-mono font-semibold text-xs">{formatRand(lastValue)}</span>
              {prevMonth && (
                <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${deltaPositive ? "text-emerald-700" : "text-destructive"}`}>
                  {deltaPositive ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
                  {Math.abs(deltaPct).toFixed(1)}%
                </span>
              )}
            </div>
            <div className="h-10 w-28 sm:w-36">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cardSpark} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                  <Line type="monotone" dataKey="y" stroke={meta.sparkColor} strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderTrend = () => (
    <Card className="shadow-sm overflow-hidden">
      <CardHeader className="bg-muted/30 border-b border-border px-3 sm:px-5 py-2.5 sm:py-3">
        <CardTitle className="text-sm font-semibold tracking-tight flex items-center gap-2">
          <LineChartIcon className="h-4 w-4 text-muted-foreground" />
          COS trend — Planned · Committed · Realised · QB (bars) + Tracking vs Budget % (line)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-6">
        <div className="h-[320px] sm:h-[440px]" data-testid="chart-cos">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
              <YAxis yAxisId="left" tickFormatter={(v: number) => formatRand(v)} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fontSize: 11, fill: "#16a34a" }}
                axisLine={false}
                tickLine={false}
                domain={[0, (dataMax: number) => Math.max(120, Math.ceil((dataMax || 0) / 20) * 20)]}
              />
              <Tooltip
                formatter={(value: number, name: string) =>
                  name === "Tracking vs Budget %"
                    ? [value == null ? "—" : `${value.toFixed(1)}%`, name]
                    : [formatRand(value), name]
                }
                contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", fontSize: "12px" }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }} />
              <Bar yAxisId="left" dataKey="COS Planned (Budget)" fill="#a7f3d0" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="COS Committed" stackId="app" fill="#f59e0b" radius={[0, 0, 0, 0]} />
              <Bar yAxisId="left" dataKey="COS Realised" stackId="app" fill="#0f172a" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="Quickbooks COS" fill="#16a34a" radius={[4, 4, 0, 0]} />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="Budget"
                stroke="#16a34a"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={{ r: 2.5, fill: "#16a34a" }}
                connectNulls={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="Tracking vs Budget %"
                stroke="#0f766e"
                strokeWidth={2}
                dot={{ r: 3, fill: "#0f766e" }}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <FinanceShell>
      <div className="space-y-3">
        <SectionHeader
          icon={<Wallet className="h-5 w-5" />}
          title="Cost of Sales FY26"
          eyebrow={`Sep ${new Date().getFullYear() - 1} – Aug ${new Date().getFullYear()}`}
          actions={
            <TooltipProvider delayDuration={200}>
              <UiTooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 rounded-lg border-border" data-testid="button-cos-help">
                    <HelpCircle className="h-3.5 w-3.5" />
                    How it works
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[320px] text-xs leading-relaxed">
                  <p className="font-semibold mb-1">COS realisation pipeline</p>
                  <p><strong>Planned</strong> = cost line with a planned date (no PO/invoice).</p>
                  <p><strong>Committed</strong> = invoice captured but invoice date unconfirmed.</p>
                  <p><strong>Realised</strong> = invoice date confirmed AND supplier invoice linked.</p>
                  <p className="mt-1 text-muted-foreground">Both gates required for realisation. Sourced from Finance - COS sheets and Expenditure Breakdown.</p>
                </TooltipContent>
              </UiTooltip>
            </TooltipProvider>
          }
        />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground -mt-1">
          <Badge variant="outline" className="gap-1 px-2 py-0.5 text-[11px] font-medium border-border bg-card">
            <CheckCircle2 className="h-3 w-3 text-foreground" />
            YTD Realised {formatRand(ytdRealised)}
          </Badge>
          <Badge variant="outline" className="gap-1 px-2 py-0.5 text-[11px] font-medium border-border bg-card">
            <ListChecks className="h-3 w-3 text-emerald-700" />
            YTD Planned {formatRand(ytdPlanned)}
          </Badge>
          <Badge variant="outline" className="gap-1 px-2 py-0.5 text-[11px] font-medium border-emerald-200 bg-emerald-50 text-emerald-800">
            <TrendingUp className="h-3 w-3" />
            {realisationRate}% realised
          </Badge>
          <Badge variant="outline" className="gap-1 px-2 py-0.5 text-[11px] font-medium border-border bg-card">
            <DollarSign className="h-3 w-3" />
            QB Actual {formatRand(ytdQbCos)}
          </Badge>
          <Badge variant="outline" className="gap-1 px-2 py-0.5 text-[11px] font-medium border-border bg-card">
            <Loader2 className={`h-3 w-3 ${isFetching ? "animate-spin text-emerald-600" : ""}`} />
            {dataUpdatedAt
              ? `Refreshed ${new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Live"}
          </Badge>
        </div>

        <div className="lg:flex lg:gap-5 lg:items-start -mt-1">
          <aside
            className="hidden lg:flex lg:flex-col lg:w-56 lg:shrink-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] rounded-xl border border-border bg-card shadow-sm p-3"
            data-testid="rail-filter-cos"
            aria-label="Filter projects"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Projects</h3>
              {selectedProjects.length > 0 && (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedProjects([])}
                  data-testid="rail-clear-all-cos"
                >
                  Clear ({selectedProjects.length})
                </button>
              )}
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search projects…"
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                className="h-8 pl-7 text-xs"
                data-testid="rail-search-cos"
              />
            </div>
            <div className="overflow-y-auto -mx-1 px-1">
              <label className="flex items-center gap-2 px-1 py-1 cursor-pointer rounded hover:bg-muted/40 text-xs">
                <input
                  type="checkbox"
                  className="accent-emerald-600 h-3.5 w-3.5"
                  checked={selectedProjects.length === 0}
                  onChange={() => setSelectedProjects([])}
                  data-testid="rail-all-projects-cos"
                />
                <span className={`truncate ${selectedProjects.length === 0 ? "font-medium" : "text-muted-foreground"}`}>All projects</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{trackerProjectNames.length}</span>
              </label>
              {filteredRailNames.length === 0 ? (
                <p className="text-[11px] text-muted-foreground px-2 py-3">No tracker-loaded projects match.</p>
              ) : (
                filteredRailNames.map((name) => {
                  const checked = selectedProjects.includes(name);
                  return (
                    <label key={name} className="flex items-center gap-2 px-1 py-1 cursor-pointer rounded hover:bg-muted/40 text-xs">
                      <input
                        type="checkbox"
                        className="accent-emerald-600 h-3.5 w-3.5"
                        checked={checked}
                        onChange={() =>
                          setSelectedProjects((prev) =>
                            prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
                          )
                        }
                        data-testid={`rail-project-cos-${name}`}
                      />
                      <span className={`truncate ${checked ? "font-medium text-foreground" : "text-muted-foreground"}`} title={name}>
                        {name}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </aside>

          <div className="flex-1 min-w-0 space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3" data-testid="kpi-strip-cos">
              {renderFyKpiCard("budget")}
              {renderFyKpiCard("planned")}
              {renderFyKpiCard("realised")}
              {renderFyKpiCard("quickbooks")}
            </div>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "recon" | "trend")}>
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <TabsList className="bg-muted/60">
                  <TabsTrigger value="recon" className="data-[state=active]:bg-card gap-1.5" data-testid="tab-recon">
                    <ListChecks className="h-3.5 w-3.5" />
                    Recon Grid
                  </TabsTrigger>
                  <TabsTrigger value="trend" className="data-[state=active]:bg-card gap-1.5" data-testid="tab-trend">
                    <LineChartIcon className="h-3.5 w-3.5" />
                    Trend
                  </TabsTrigger>
                </TabsList>

                <div className="lg:hidden">
                  <Popover open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1.5 rounded-lg border-border" data-testid="button-project-picker-cos">
                        <Filter className="h-3.5 w-3.5" />
                        Projects
                        {selectedProjects.length > 0 && (
                          <Badge variant="outline" className="ml-1 px-1.5 py-0 text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700">
                            {selectedProjects.length}
                          </Badge>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-2" align="end">
                      <div className="relative mb-2">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <Input
                          placeholder="Search projects…"
                          value={projectSearch}
                          onChange={(e) => setProjectSearch(e.target.value)}
                          className="h-8 pl-7 text-xs"
                        />
                      </div>
                      <div className="max-h-72 overflow-y-auto -mx-1 px-1">
                        <label className="flex items-center gap-2 px-1 py-1 cursor-pointer rounded hover:bg-muted/40 text-xs">
                          <input
                            type="checkbox"
                            className="accent-emerald-600 h-3.5 w-3.5"
                            checked={selectedProjects.length === 0}
                            onChange={() => setSelectedProjects([])}
                          />
                          <span className={`truncate ${selectedProjects.length === 0 ? "font-medium" : "text-muted-foreground"}`}>All projects</span>
                        </label>
                        {filteredRailNames.map((name) => {
                          const checked = selectedProjects.includes(name);
                          return (
                            <label key={name} className="flex items-center gap-2 px-1 py-1 cursor-pointer rounded hover:bg-muted/40 text-xs">
                              <input
                                type="checkbox"
                                className="accent-emerald-600 h-3.5 w-3.5"
                                checked={checked}
                                onChange={() =>
                                  setSelectedProjects((prev) =>
                                    prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
                                  )
                                }
                              />
                              <span className={`truncate ${checked ? "font-medium" : "text-muted-foreground"}`}>{name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {selectedProjects.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3 lg:hidden">
                  {selectedProjects.map((p) => (
                    <Badge
                      key={p}
                      variant="secondary"
                      className="text-xs gap-1 cursor-pointer hover:bg-destructive/10"
                      onClick={() => setSelectedProjects((prev) => prev.filter((x) => x !== p))}
                    >
                      {p}
                      <X className="h-3 w-3" />
                    </Badge>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-muted-foreground px-2"
                    onClick={() => setSelectedProjects([])}
                  >
                    Clear all
                  </Button>
                </div>
              )}

              <TabsContent value="recon" className="mt-0">
                <Card className="shadow-sm overflow-hidden">
                  <CardHeader className="bg-muted/30 border-b border-border px-3 sm:px-5 py-2.5 sm:py-3">
                    <CardTitle className="text-sm font-semibold tracking-tight flex items-center gap-2">
                      <ListChecks className="h-4 w-4 text-muted-foreground" />
                      Planned → Committed → Realised → QuickBooks reconciliation
                      {isProjectFiltered && (
                        <Badge variant="outline" className="ml-2 text-[10px] font-medium border-emerald-200 bg-emerald-50 text-emerald-700">
                          Filtered: {selectedProjects.length} project{selectedProjects.length === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">{renderGrid()}</CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="trend" className="mt-0">{renderTrend()}</TabsContent>
            </Tabs>

          </div>
        </div>
      </div>


      {drawerMonth && (
        <MonthDetailDrawer
          key={`${drawerMonth.monthKey}-${drawerMonth.defaultFilter}-${drawerMonth.defaultProject || "all"}`}
          monthKey={drawerMonth.monthKey}
          monthLabel={drawerMonth.monthLabel}
          defaultFilter={drawerMonth.defaultFilter}
          defaultProject={drawerMonth.defaultProject}
          onClose={() => setDrawerMonth(null)}
        />
      )}
    </FinanceShell>
  );
}
