import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useSearch, useLocation } from "wouter";
import { severityStyle, ragBadgeClasses } from "@/lib/status-colors";
import { EmptyState } from "@/components/ui/empty-state";
import { PageShell } from "@/components/layout/page-shell";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  TrendingDown,
  TrendingUp,
  DollarSign,
  Clock,
  HardHat,
  Shield,
  FileWarning,
  Users,
  FolderOpen,
  Filter,
  RotateCcw,
  ExternalLink,
  Wrench,
  HandshakeIcon,
  Sun,
  Wind,
  Zap,
  Battery,
  Leaf,
  RefreshCw,
  AlertTriangle,
  BarChart3,
  Activity,
} from "lucide-react";
type DashboardResponse = {
  meta: { fyStart: string; fyEnd: string };
  kpis: Record<string, number | null>;
  options: { portfolios: string[]; pms: string[]; pds: string[]; executionPhases: string[]; rags: string[] };
  projects: any[];
  actionCenter: Record<string, any[]>;
  charts: {
    datasets: Array<{
      id: string; label: string; description: string;
      dimensionKey: string; dimensionLabel: string;
      metrics: Array<{ key: string; label: string; format: string; color: string }>;
      rows: any[];
    }>;
    presets: any[];
  };
};

/* ── branded chart palette ── */
const CHART_COLORS = {
  revenue: "#059669",   // emerald-600
  cos: "#ea580c",       // orange-600
  gp: "#0d9488",        // teal-600
  actual: "#047857",    // emerald-700
  planned: "#2563eb",   // blue-600
};

const chartMoney = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `R${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R${(v / 1_000).toFixed(0)}K`;
  return `R${v.toFixed(0)}`;
};

/* ── skeleton loaders ── */
function KpiSkeleton() {
  return (
    <Card className="border-border/50 energy-card">
      <CardContent className="p-4 space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-3 w-32" />
      </CardContent>
    </Card>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-1 p-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex gap-3 items-center py-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-16 hidden lg:block" />
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-4 w-14 ml-auto" />
          <Skeleton className="h-4 w-14 hidden md:block" />
          <Skeleton className="h-4 w-16 hidden lg:block" />
          <Skeleton className="h-4 w-4" />
        </div>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="h-[280px] flex items-center justify-center">
      <div className="text-center space-y-2">
        <Skeleton className="h-6 w-6 mx-auto rounded-full" />
        <Skeleton className="h-3 w-24 mx-auto" />
      </div>
    </div>
  );
}


const money = (n: number | null | undefined) =>
  `R ${(Number(n || 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const pct = (n: number | null | undefined) => (n == null ? "-" : `${Number(n).toFixed(1)}%`);

function queueMeta(key: string) {
  switch (key) {
    case "projectsBehindPlan":
      return { icon: <Clock className="w-4 h-4 text-red-500" />, border: "border-l-red-500", bg: "bg-red-50/30" };
    case "inflowAtRisk":
      return { icon: <DollarSign className="w-4 h-4 text-blue-500" />, border: "border-l-blue-500", bg: "bg-blue-50/30" };
    case "expenditureAtRisk":
      return { icon: <TrendingDown className="w-4 h-4 text-orange-500" />, border: "border-l-orange-500", bg: "bg-orange-50/30" };
    case "engineeringBottlenecks":
      return { icon: <Shield className="w-4 h-4 text-violet-500" />, border: "border-l-violet-500", bg: "bg-violet-50/30" };
    case "qualityIssues":
      return { icon: <FileWarning className="w-4 h-4 text-amber-500" />, border: "border-l-amber-500", bg: "bg-amber-50/30" };
    case "pendingApprovalsDecisions":
      return { icon: <Users className="w-4 h-4 text-emerald-500" />, border: "border-l-emerald-500", bg: "bg-emerald-50/30" };
    default:
      return { icon: <AlertCircle className="w-4 h-4 text-slate-500" />, border: "border-l-slate-400", bg: "bg-slate-50/30" };
  }
}

type UpcomingEvent = { type: string; date: string; projectName: string; projectId: number | null; detail: string; amount?: string };

const PROJECT_EVENT_TYPES = new Set(["site_establishment", "commissioning", "handover_om", "handover_client", "practical_completion", "pd_handover", "construction_start"]);
const PAYMENT_EVENT_TYPES = new Set(["payment_in", "payment_out"]);

function eventIcon(type: string) {
  switch (type) {
    case "site_establishment": return <HardHat className="w-4 h-4 text-orange-500" />;
    case "construction_start": return <HardHat className="w-4 h-4 text-orange-500" />;
    case "commissioning": return <Wrench className="w-4 h-4 text-blue-500" />;
    case "practical_completion": return <Shield className="w-4 h-4 text-teal-500" />;
    case "handover_om": return <HandshakeIcon className="w-4 h-4 text-violet-500" />;
    case "handover_client": return <HandshakeIcon className="w-4 h-4 text-emerald-500" />;
    case "pd_handover": return <FolderOpen className="w-4 h-4 text-sky-500" />;
    case "payment_in": return <TrendingUp className="w-4 h-4 text-emerald-600" />;
    case "payment_out": return <TrendingDown className="w-4 h-4 text-red-500" />;
    default: return <CalendarDays className="w-4 h-4 text-gray-500" />;
  }
}

function eventLabel(type: string) {
  switch (type) {
    case "site_establishment": return "Site Establishment";
    case "construction_start": return "Construction Start";
    case "commissioning": return "Commissioning";
    case "practical_completion": return "Practical Completion";
    case "handover_om": return "Handover to O&M";
    case "handover_client": return "Handover to Client";
    case "pd_handover": return "PD Handover";
    case "payment_in": return "Payment Coming In";
    case "payment_out": return "Payment Going Out";
    default: return "Event";
  }
}

function eventBadgeStyle(type: string) {
  switch (type) {
    case "site_establishment": case "construction_start": return "bg-orange-50 text-orange-700 border-orange-200";
    case "commissioning": return "bg-blue-50 text-blue-700 border-blue-200";
    case "practical_completion": return "bg-teal-50 text-teal-700 border-teal-200";
    case "handover_om": return "bg-violet-50 text-violet-700 border-violet-200";
    case "handover_client": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "pd_handover": return "bg-sky-50 text-sky-700 border-sky-200";
    case "payment_in": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "payment_out": return "bg-red-50 text-red-700 border-red-200";
    default: return "bg-gray-50 text-gray-700 border-gray-200";
  }
}

function formatEventDate(d: string) {
  const dt = new Date(d + "T00:00:00");
  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  const dayLabel = d === todayStr ? "Today" : d === tomorrowStr ? "Tomorrow" : dt.toLocaleDateString("en-ZA", { weekday: "short" });
  return `${dayLabel}, ${dt.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}`;
}

function UpcomingEventsSection({ events }: { events: UpcomingEvent[] }) {
  const [showPayments, setShowPayments] = useState(false);

  const filtered = useMemo(() => {
    if (showPayments) return events;
    return events.filter((ev) => PROJECT_EVENT_TYPES.has(ev.type));
  }, [events, showPayments]);

  const paymentCount = useMemo(() => events.filter((ev) => PAYMENT_EVENT_TYPES.has(ev.type)).length, [events]);

  if (filtered.length === 0 && !showPayments && paymentCount === 0) return null;

  const grouped = filtered.reduce<Record<string, UpcomingEvent[]>>((acc, ev) => {
    (acc[ev.date] = acc[ev.date] || []).push(ev);
    return acc;
  }, {});

  return (
    <Card className="border-border" data-testid="upcoming-events-card">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 className="text-sm font-semibold">Upcoming This Week</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{filtered.length} event{filtered.length !== 1 ? "s" : ""} in the next 5 working days</p>
          </div>
          {paymentCount > 0 && (
            <Button
              size="sm"
              variant={showPayments ? "default" : "outline"}
              className={`text-xs h-7 ${showPayments ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
              onClick={() => setShowPayments(!showPayments)}
              data-testid="toggle-payments"
            >
              <DollarSign className="w-3.5 h-3.5 mr-1" />
              Payments ({paymentCount})
            </Button>
          )}
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No project milestones in the next 5 working days</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([date, evts]) => (
              <div key={date}>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{formatEventDate(date)}</div>
                <div className="space-y-1.5">
                  {evts.map((ev, idx) => (
                    <div key={idx} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5 hover:bg-muted/20 transition-colors">
                      {eventIcon(ev.type)}
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${eventBadgeStyle(ev.type)}`}>{eventLabel(ev.type)}</Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{ev.projectName}</p>
                        <p className="text-xs text-muted-foreground truncate">{ev.detail}</p>
                      </div>
                      {ev.amount && (
                        <span className={`text-sm font-semibold shrink-0 ${ev.type === "payment_in" ? "text-emerald-600" : ev.type === "payment_out" ? "text-red-600" : "text-gray-700"}`}>
                          R {Number(ev.amount).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      )}
                      {ev.projectName && (
                        <Link href={`/project/${encodeURIComponent(ev.projectName)}`}>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600 shrink-0">
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type FinancialEvent = { type: "inflow" | "outflow"; date: string; projectName: string; projectId: number | null; detail: string; amount: string | null; invoiceNumber?: string | null };
type FinancialsResponse = { rangeStart: string; rangeEnd: string; events: FinancialEvent[]; totalInflow: number; totalOutflow: number; netCashflow: number };

function UpcomingFinancialsSection({ data }: { data: FinancialsResponse | undefined }) {
  const hasEvents = data && data.events.length > 0;

  const grouped = hasEvents
    ? data.events.reduce<Record<string, FinancialEvent[]>>((acc, ev) => {
        (acc[ev.date] = acc[ev.date] || []).push(ev);
        return acc;
      }, {})
    : {};

  const inflowCount = hasEvents ? data.events.filter(e => e.type === "inflow").length : 0;
  const outflowCount = hasEvents ? data.events.filter(e => e.type === "outflow").length : 0;

  return (
    <Card className="border-border" data-testid="upcoming-financials-card">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 className="text-sm font-semibold">Upcoming Financial Milestones</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {hasEvents
                ? `${data.events.length} item${data.events.length !== 1 ? "s" : ""} in the next 10 working days`
                : "Next 10 working days"}
            </p>
          </div>
          {hasEvents && (
            <div className="flex items-center gap-3 text-xs">
              {inflowCount > 0 && (
                <span className="flex items-center gap-1 text-emerald-600 font-medium">
                  <TrendingUp className="w-3.5 h-3.5" />
                  {inflowCount} inflow{inflowCount !== 1 ? "s" : ""}: R {data.totalInflow.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              )}
              {outflowCount > 0 && (
                <span className="flex items-center gap-1 text-red-600 font-medium">
                  <TrendingDown className="w-3.5 h-3.5" />
                  {outflowCount} outflow{outflowCount !== 1 ? "s" : ""}: R {data.totalOutflow.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              )}
            </div>
          )}
        </div>

        {hasEvents ? (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded-lg border border-border/50 p-3">
                <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Total Inflows</p>
                <p className="text-base font-semibold font-mono text-emerald-700 mt-0.5">R {data.totalInflow.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              </div>
              <div className="rounded-lg border border-border/50 p-3">
                <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Total Outflows</p>
                <p className="text-base font-semibold font-mono text-red-700 mt-0.5">R {data.totalOutflow.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              </div>
              <div className="rounded-lg border border-border/50 p-3">
                <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Net Cashflow</p>
                <p className={`text-base font-semibold font-mono mt-0.5 ${data.netCashflow >= 0 ? "text-emerald-700" : "text-amber-700"}`}>R {data.netCashflow.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              </div>
            </div>

            <div className="space-y-4">
              {Object.entries(grouped).map(([date, evts]) => (
                <div key={date}>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{formatEventDate(date)}</div>
                  <div className="space-y-1.5">
                    {evts.map((ev, idx) => (
                      <div key={idx} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5 hover:bg-muted/20 transition-colors">
                        {ev.type === "inflow"
                          ? <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0" />
                          : <TrendingDown className="w-4 h-4 text-red-500 shrink-0" />}
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${ev.type === "inflow" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                          {ev.type === "inflow" ? "Inflow" : "Outflow"}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{ev.projectName}</p>
                          <p className="text-xs text-muted-foreground truncate">{ev.detail}</p>
                        </div>
                        {ev.amount != null && (
                          <span className={`text-sm font-semibold shrink-0 ${ev.type === "inflow" ? "text-emerald-600" : "text-red-600"}`}>
                            R {Number(ev.amount).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        )}
                        {ev.projectId && (
                          <Link href={`/project/${encodeURIComponent(ev.projectName)}`}>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600 shrink-0" data-testid={`financial-nav-${idx}`}>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </Button>
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-border/60 p-6 text-center">
            <DollarSign className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No upcoming inflows or outflows in the next 10 working days</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Financial milestones will appear here when payment dates or invoice dates fall within this window</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [collapsedQueues, setCollapsedQueues] = useState<Set<string>>(new Set());
  const [expandedQueues, setExpandedQueues] = useState<Set<string>>(new Set());

  /* ── URL filter sync ── */
  const searchString = useSearch();
  const [, navigate] = useLocation();

  const defaultFilters = {
    search: "", portfolio: "all", pm: "all", pd: "all",
    executionPhase: "all", rag: "all",
    exceptionOnly: false, behindPlanOnly: false, inflowRiskOnly: false,
    outflowRiskOnly: false, engineeringBlockersOnly: false,
    qualityIssuesOnly: false, pendingApprovalsOnly: false, staleImportsOnly: false,
  };

  const filtersFromUrl = useMemo(() => {
    const params = new URLSearchParams(searchString);
    const f = { ...defaultFilters };
    for (const [k, v] of params.entries()) {
      if (k in f) {
        if (typeof (f as any)[k] === "boolean") (f as any)[k] = v === "true";
        else (f as any)[k] = v;
      }
    }
    return f;
  }, [searchString]);

  const filters = filtersFromUrl;

  const setFilters = useCallback((updater: ((prev: typeof defaultFilters) => typeof defaultFilters) | typeof defaultFilters) => {
    const next = typeof updater === "function" ? updater(filters) : updater;
    const params = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => {
      if (typeof v === "boolean") { if (v) params.set(k, "true"); }
      else if (v && v !== "all") params.set(k, v);
    });
    const qs = params.toString();
    navigate(qs ? `/dashboard?${qs}` : "/dashboard", { replace: true });
  }, [filters, navigate]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (typeof v === "boolean") {
        if (v) params.set(k, "true");
      } else if (v && v !== "all") {
        params.set(k, v);
      }
    });
    return params.toString();
  }, [filters]);

  const { data, isLoading, isError, error, refetch } = useQuery<DashboardResponse>({
    queryKey: ["/api/program-dashboard", query],
    queryFn: async () => {
      const res = await fetch(`/api/program-dashboard${query ? `?${query}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Dashboard request failed (${res.status})`);
      return res.json();
    },
    refetchOnWindowFocus: true,
  });

  const { data: upcomingData } = useQuery<{ rangeStart: string; rangeEnd: string; events: UpcomingEvent[] }>({
    queryKey: ["/api/upcoming-events"],
    queryFn: async () => {
      const res = await fetch("/api/upcoming-events", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch events");
      return res.json();
    },
    refetchOnWindowFocus: true,
  });

  const { data: financialsData } = useQuery<FinancialsResponse>({
    queryKey: ["/api/upcoming-financials"],
    queryFn: async () => {
      const res = await fetch("/api/upcoming-financials", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch financials");
      return res.json();
    },
    refetchOnWindowFocus: true,
  });

  const opts = data?.options || { portfolios: [], pms: [], pds: [], executionPhases: [], rags: [] };

  const toggleQueue = (queue: string) => {
    setCollapsedQueues((prev) => {
      const next = new Set(prev);
      if (next.has(queue)) next.delete(queue);
      else next.add(queue);
      return next;
    });
  };

  const queueKeys: Array<[string, string]> = [
    ["projectsBehindPlan", "Projects Behind Plan"],
    ["inflowAtRisk", "Inflow at Risk"],
    ["expenditureAtRisk", "Expenditure / COS at Risk"],
    ["engineeringBottlenecks", "Engineering Bottlenecks"],
    ["qualityIssues", "Quality Issues"],
    ["pendingApprovalsDecisions", "Pending Approvals / Decisions"],
  ];

  const hasActiveFilters =
    filters.search ||
    filters.portfolio !== "all" ||
    filters.pm !== "all" ||
    filters.pd !== "all" ||
    filters.executionPhase !== "all" ||
    filters.rag !== "all" ||
    filters.exceptionOnly ||
    filters.behindPlanOnly ||
    filters.inflowRiskOnly ||
    filters.outflowRiskOnly ||
    filters.engineeringBlockersOnly ||
    filters.qualityIssuesOnly ||
    filters.pendingApprovalsOnly ||
    filters.staleImportsOnly;

  const totalActionItems = useMemo(() => {
    if (!data?.actionCenter) return 0;
    return queueKeys.reduce((sum, [k]) => sum + (data.actionCenter[k]?.length || 0), 0);
  }, [data?.actionCenter]);


  return (
    <PageShell className="p-0" data-testid="execution-dashboard-page">
      {/* ── Error banner ── */}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50/80 p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-800">Failed to load dashboard</p>
            <p className="text-xs text-red-600 mt-0.5">{(error as Error)?.message || "An unexpected error occurred"}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()} className="shrink-0 gap-1.5 border-red-200 text-red-700 hover:bg-red-100">
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </Button>
        </div>
      )}

      {/* ── Header with energy accent ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200/60 animate-solar-pulse">
            <Zap className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Execution Dashboard</h1>
            {data?.meta && (
              <p className="text-muted-foreground text-sm mt-0.5 flex items-center gap-1.5">
                <Leaf className="w-3 h-3 text-emerald-500" />
                FY {data.meta.fyStart} – {data.meta.fyEnd}
              </p>
            )}
          </div>
        </div>
        {hasActiveFilters && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilters(defaultFilters)}
            className="gap-1.5 text-muted-foreground"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Clear filters
          </Button>
        )}
      </div>

      <Card className="border-border/50 animate-energy-flow">
        <CardContent className="p-3 space-y-2.5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
            <Input
              placeholder="Search projects..."
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              className="h-9"
              data-testid="input-filter-search"
            />
            <SearchableSelect
              value={filters.portfolio}
              onValueChange={(v) => setFilters((f) => ({ ...f, portfolio: v }))}
              placeholder="Portfolio"
              options={[{ value: "all", label: "All Portfolios" }, ...opts.portfolios.map((v) => ({ value: v, label: v }))]}
            />
            <SearchableSelect
              value={filters.pm}
              onValueChange={(v) => setFilters((f) => ({ ...f, pm: v }))}
              placeholder="Project Manager"
              options={[{ value: "all", label: "All PMs" }, ...opts.pms.map((v) => ({ value: v, label: v }))]}
            />
            <SearchableSelect
              value={filters.pd}
              onValueChange={(v) => setFilters((f) => ({ ...f, pd: v }))}
              placeholder="Project Developer"
              options={[{ value: "all", label: "All PDs" }, ...opts.pds.map((v) => ({ value: v, label: v }))]}
            />
            <SearchableSelect
              value={filters.executionPhase}
              onValueChange={(v) => setFilters((f) => ({ ...f, executionPhase: v }))}
              placeholder="Execution Phase"
              options={[{ value: "all", label: "All Phases" }, ...opts.executionPhases.map((v) => ({ value: v, label: v }))]}
            />
            <SearchableSelect
              value={filters.rag}
              onValueChange={(v) => setFilters((f) => ({ ...f, rag: v }))}
              placeholder="RAG Status"
              options={[{ value: "all", label: "All RAG" }, ...opts.rags.map((v) => ({ value: v, label: v }))]}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["exceptionOnly", "Exceptions"],
                ["behindPlanOnly", "Behind plan"],
                ["inflowRiskOnly", "Inflow risk"],
                ["outflowRiskOnly", "Outflow risk"],
                ["engineeringBlockersOnly", "Eng. blockers"],
                ["qualityIssuesOnly", "Quality issues"],
                ["pendingApprovalsOnly", "Pending approvals"],
                ["staleImportsOnly", "Stale imports"],
              ] as const
            ).map(([key, label]) => {
              const active = Boolean((filters as any)[key]);
              return (
                <button
                  key={key}
                  onClick={() => setFilters((f) => ({ ...f, [key]: !active }))}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${
                    active
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-background border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                  data-testid={`filter-toggle-${key}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <p className="text-[13px] text-muted-foreground -mt-2">Portfolio health at a glance — powered by live project data.</p>

      {/* ── Stale metrics banner ── */}
      {data?.kpis && Number(data.kpis.staleImports || 0) > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{data.kpis.staleImports}</strong> project(s) have stale imports (older than 7 days). Financial data may be outdated.
          </span>
        </div>
      )}

      {/* ── KPI strip (expanded) ── */}
      <TooltipProvider delayDuration={200}>
        {isLoading && !data ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <KpiSkeleton key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {([
              { label: "Active Projects", value: String(data?.kpis?.activeDashboardProjects ?? 0), icon: <Sun className="w-4 h-4 text-amber-500" />, color: "text-foreground", tip: "Projects with committed imports and FY activity" },
              { label: "Avg Progress", value: pct(data?.kpis?.averageActualProgressPct), icon: <Activity className="w-4 h-4 text-emerald-500" />, color: "text-emerald-700", tip: `Actual ${pct(data?.kpis?.averageActualProgressPct)} vs Expected ${pct(data?.kpis?.averageExpectedProgressPct)}` },
              { label: "Behind Plan", value: String(data?.kpis?.projectsBehindPlan ?? 0), icon: <Clock className="w-4 h-4 text-red-500" />, color: Number(data?.kpis?.projectsBehindPlan || 0) > 0 ? "text-red-700" : "text-foreground", tip: "Projects >5% behind expected progress" },
              { label: "Planned Revenue", value: money(data?.kpis?.plannedRevenueFy), icon: <Zap className="w-4 h-4 text-emerald-500 animate-glow-pulse" />, color: "text-foreground", tip: "Total planned revenue for the financial year" },
              { label: "Received Inflow", value: money(data?.kpis?.receivedInflowFy), icon: <Battery className="w-4 h-4 text-emerald-600" />, color: "text-emerald-700", tip: "Cash received and confirmed in bank" },
              { label: "Open Receivables", value: money(data?.kpis?.openInflowFy), icon: <TrendingUp className="w-4 h-4 text-amber-500" />, color: "text-amber-700", tip: "Outstanding inflow requiring follow-up" },
              { label: "Gross Profit", value: money(data?.kpis?.grossProfitFy), icon: <Wind className="w-4 h-4 text-teal-500" />, color: Number(data?.kpis?.grossProfitFy || 0) >= 0 ? "text-teal-700" : "text-red-700", tip: `GP Margin: ${data?.kpis?.grossMarginPctFy != null ? Number(data.kpis.grossMarginPctFy).toFixed(1) + "%" : "-"}` },
              { label: "Open Expenditure", value: money(data?.kpis?.openExpenditureFy), icon: <TrendingDown className="w-4 h-4 text-orange-500" />, color: "text-orange-700", tip: "Supplier spend outstanding this FY" },
            ] as const).map((kpi) => (
              <Tooltip key={kpi.label}>
                <TooltipTrigger asChild>
                  <Card className="border-border/50 energy-card cursor-default" data-testid={`kpi-${kpi.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        {kpi.icon}
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground truncate">{kpi.label}</p>
                      </div>
                      <p className={`text-lg font-semibold font-mono ${kpi.color}`}>{kpi.value}</p>
                    </CardContent>
                  </Card>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>{kpi.tip}</p></TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}

        {/* ── Secondary KPI row ── */}
        {data?.kpis && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {([
              { label: "Paid Expenditure", value: money(data.kpis.paidExpenditureFy), color: "text-emerald-700", tip: "Confirmed paid supplier spend" },
              { label: "Eng. Blockers", value: String(data.kpis.openEngineeringBlockers ?? 0), color: Number(data.kpis.openEngineeringBlockers || 0) > 0 ? "text-violet-700" : "text-foreground", tip: "Open engineering stage items" },
              { label: "Quality Warnings", value: String(data.kpis.openQualityWarnings ?? 0), color: Number(data.kpis.openQualityWarnings || 0) > 0 ? "text-amber-700" : "text-foreground", tip: "Open quality issues" },
              { label: "Pending Approvals", value: String(data.kpis.pendingApprovals ?? 0), color: Number(data.kpis.pendingApprovals || 0) > 0 ? "text-blue-700" : "text-foreground", tip: "Decisions awaiting sign-off" },
              { label: "Stale Imports", value: String(data.kpis.staleImports ?? 0), color: Number(data.kpis.staleImports || 0) > 0 ? "text-red-700" : "text-foreground", tip: "Projects with imports older than 7 days" },
              { label: "Planned Expenditure", value: money(data.kpis.plannedExpenditureFy), color: "text-foreground", tip: "Total budgeted expenditure for the FY" },
            ] as const).map((kpi) => (
              <Tooltip key={kpi.label}>
                <TooltipTrigger asChild>
                  <Card className="border-border/50 energy-card cursor-default">
                    <CardContent className="p-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground truncate mb-1">{kpi.label}</p>
                      <p className={`text-base font-semibold font-mono ${kpi.color}`}>{kpi.value}</p>
                    </CardContent>
                  </Card>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>{kpi.tip}</p></TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </TooltipProvider>

      <Card className="border-border energy-card" data-testid="immediate-intervention-queue">
        <CardContent className="p-4 md:p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Wind className="w-4 h-4 text-sky-500" />
              <div>
              <h2 className="text-sm font-semibold">Action Centre</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{totalActionItems} items requiring attention</p>
            </div>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {queueKeys.map(([k, title]) => {
              const rows = data?.actionCenter?.[k] || [];
              const isCollapsed = collapsedQueues.has(k);
              const meta = queueMeta(k);
              const isQueueExpanded = expandedQueues.has(k);
              const showMax = isQueueExpanded ? rows.length : 5;
              const visibleRows = isCollapsed ? [] : rows.slice(0, showMax);

              return (
                <div key={k} className="rounded-lg border border-border overflow-hidden">
                  <button
                    onClick={() => toggleQueue(k)}
                    className="w-full flex items-center gap-2 px-4 py-3 text-left bg-muted/20 hover:bg-muted/40 transition-colors"
                    data-testid={`queue-toggle-${k}`}
                  >
                    {meta.icon}
                    <span className="text-sm font-semibold flex-1">{title}</span>
                    <Badge variant="outline" className="text-xs font-medium">{rows.length}</Badge>
                    {isCollapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
                  </button>
                  {!isCollapsed && (
                    <div className="divide-y divide-border/40">
                      {rows.length === 0 ? (
                        <div className="px-4 py-4 text-sm text-muted-foreground">All clear — no items</div>
                      ) : (
                        <>
                          {visibleRows.map((r: any, idx: number) => {
                            const sev = severityStyle(r.severity);
                            return (
                              <div key={idx} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors">
                                <Badge className={`text-[10px] shrink-0 ${sev.bg} ${sev.text}`}>{r.severity}</Badge>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium truncate">{r.projectName || r.project}</p>
                                  <p className="text-xs text-muted-foreground truncate">{r.issueTitle}</p>
                                </div>
                                {r.owner && <span className="text-xs text-muted-foreground shrink-0">{r.owner}</span>}
                                {(r.link || r.links?.project) && (
                                  <Link href={r.link || r.links?.project}>
                                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600 shrink-0">
                                      <ArrowRight className="w-3.5 h-3.5" />
                                    </Button>
                                  </Link>
                                )}
                              </div>
                            );
                          })}
                          {rows.length > 5 && (
                            <button
                              onClick={() => setExpandedQueues(prev => {
                                const next = new Set(prev);
                                if (next.has(k)) next.delete(k); else next.add(k);
                                return next;
                              })}
                              className="w-full px-4 py-2 text-xs text-emerald-600 cursor-pointer hover:underline hover:bg-muted/20 text-left transition-colors"
                            >
                              {isQueueExpanded ? "Show less" : `Show ${rows.length - 5} more...`}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Monthly Forecast Chart ── */}
      {(() => {
        const ds = data?.charts?.datasets?.find((d: any) => d.id === "monthlyForecast");
        const rows = ds?.rows || [];
        if (isLoading && !data) return (
          <Card className="border-border energy-card">
            <CardContent className="p-4 md:p-5">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4 text-emerald-500" />
                <h2 className="text-sm font-semibold">FY Revenue & Cost Forecast</h2>
              </div>
              <ChartSkeleton />
            </CardContent>
          </Card>
        );
        if (rows.length === 0) return null;
        return (
          <Card className="border-border energy-card" data-testid="forecast-chart">
            <CardContent className="p-4 md:p-5">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="w-4 h-4 text-emerald-500" />
                <h2 className="text-sm font-semibold">FY Revenue & Cost Forecast</h2>
              </div>
              <p className="text-xs text-muted-foreground mb-4">{ds?.description}</p>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={rows} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.revenue} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={CHART_COLORS.revenue} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradCos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.cos} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={CHART_COLORS.cos} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradGp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.gp} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={CHART_COLORS.gp} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis tickFormatter={chartMoney} tick={{ fontSize: 11 }} className="text-muted-foreground" width={60} />
                  <RechartsTooltip
                    formatter={(value: number, name: string) => [chartMoney(value), name]}
                    contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Area type="monotone" dataKey="plannedRevenue" name="Revenue" stroke={CHART_COLORS.revenue} fill="url(#gradRevenue)" strokeWidth={2} />
                  <Area type="monotone" dataKey="plannedCos" name="COS" stroke={CHART_COLORS.cos} fill="url(#gradCos)" strokeWidth={2} />
                  <Area type="monotone" dataKey="grossProfit" name="Gross Profit" stroke={CHART_COLORS.gp} fill="url(#gradGp)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        );
      })()}

      <UpcomingEventsSection events={upcomingData?.events || []} />
      <UpcomingFinancialsSection data={financialsData} />

      {(() => {
        const planned = Number(data?.kpis?.cosPlannedMonth || 0);
        const realised = Number(data?.kpis?.cosRealisedMonth || 0);
        const realisedPct = planned > 0 ? (realised / planned) * 100 : 0;
        const gap = planned - realised;
        const monthStr = data?.kpis?.currentMonth
          ? new Date(`${data.kpis.currentMonth}-01T00:00:00`).toLocaleDateString("en-ZA", { month: "long", year: "numeric" })
          : "This Month";
        return (
          <Card className="border-border energy-card" data-testid="cos-tracker-card">
            <CardContent className="p-4 md:p-5">
              <div className="mb-3 flex items-center gap-2">
                <Battery className="w-4 h-4 text-emerald-500" />
                <h2 className="text-sm font-semibold">COS Planned vs Realised</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{monthStr}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-border/50 p-3">
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Planned COS</p>
                  <p className="text-lg font-semibold font-mono mt-1">{money(planned)}</p>
                  <p className="text-xs text-muted-foreground">Total cost lines this month</p>
                </div>
                <div className="rounded-lg border border-border/50 p-3">
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Realised COS</p>
                  <p className="text-lg font-semibold font-mono text-emerald-700 mt-1">{money(realised)}</p>
                  <p className="text-xs text-muted-foreground">{realisedPct.toFixed(1)}% of planned</p>
                </div>
                <div className="rounded-lg border border-border/50 p-3">
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Gap</p>
                  <p className={`text-lg font-semibold font-mono mt-1 ${gap > 0 ? "text-amber-700" : "text-emerald-700"}`}>{money(Math.abs(gap))}</p>
                  <p className="text-xs text-muted-foreground">
                    {gap > 0 ? "Still to be realised" : "Fully realised"}
                  </p>
                </div>
              </div>
              {planned > 0 && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Realisation progress</span>
                    <span>{realisedPct.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`h-2.5 rounded-full transition-all energy-progress-bar ${realisedPct >= 80 ? "bg-emerald-500" : realisedPct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                      style={{ width: `${Math.min(realisedPct, 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      <Card className="border-border energy-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sun className="w-4 h-4 text-amber-500" />
            <h2 className="text-sm font-semibold">Project Portfolio</h2>
            <Badge variant="secondary" className="text-[11px] font-mono">
              {(data?.projects || []).length}
            </Badge>
          </div>
          {isLoading && !data ? (
            <TableSkeleton />
          ) : (
            <div className="rounded-lg border border-border">
              <table className="w-full text-sm" data-testid="execution-dashboard-table">
                <thead>
                  <tr className="bg-muted/30 text-xs uppercase tracking-normal text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">Project</th>
                    <th className="text-left py-2 px-2 font-medium hidden lg:table-cell">PM</th>
                    <th className="text-center py-2 px-2 font-medium">RAG</th>
                    <th className="text-right py-2 px-2 font-medium">Progress</th>
                    <th className="text-right py-2 px-2 font-medium hidden md:table-cell">Variance</th>
                    <th className="text-right py-2 px-2 font-medium hidden lg:table-cell">Open Inflow</th>
                    <th className="text-right py-2 px-2 font-medium hidden lg:table-cell">Open Exp.</th>
                    <th className="text-right py-2 px-2 font-medium hidden md:table-cell" title="Planned gross margin based on planned revenue and expenditure">Plan GP %</th>
                    <th className="text-center py-2 px-2 font-medium">Issues</th>
                    <th className="w-8 py-2 px-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.projects || []).map((p: any) => {
                    const isExpanded = expanded === p.projectId;
                    const variance = Number(p.scheduleVariancePct || 0);
                    return (
                      <Fragment key={p.projectId}>
                        <tr
                          className={`border-t border-border/40 cursor-pointer transition-colors ${isExpanded ? "bg-muted/40" : "hover:bg-muted/20"}`}
                          onClick={() => setExpanded(isExpanded ? null : p.projectId)}
                          data-testid={`project-row-${p.projectId}`}
                        >
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-foreground truncate max-w-[200px]">{p.projectName}</div>
                            <div className="text-[11px] text-muted-foreground lg:hidden">{p.pm || "-"}</div>
                          </td>
                          <td className="py-2.5 px-2 text-muted-foreground text-xs hidden lg:table-cell">{p.pm || "-"}</td>
                          <td className="py-2.5 px-2 text-center">
                            <Badge className={`text-[10px] ${ragBadgeClasses(p.rag || "Unknown")}`}>{p.rag || "-"}</Badge>
                          </td>
                          <td className="py-2.5 px-2 text-right">
                            <span className="tabular-nums font-medium text-sm">{pct(p.actualProgressPct)}</span>
                            <div className="text-[10px] text-muted-foreground tabular-nums">of {pct(p.expectedProgressPct)}</div>
                          </td>
                          <td className={`py-2.5 px-2 text-right tabular-nums text-sm font-medium hidden md:table-cell ${variance < 0 ? "text-red-700" : variance > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                            {pct(p.scheduleVariancePct)}
                          </td>
                          <td className="py-2.5 px-2 text-right tabular-nums text-sm text-amber-600 hidden lg:table-cell">{money(p.openInflowFy)}</td>
                          <td className="py-2.5 px-2 text-right tabular-nums text-sm text-amber-600 hidden lg:table-cell">{money(p.openExpenditureFy)}</td>
                          <td className="py-2.5 px-2 text-right tabular-nums text-sm font-medium hidden md:table-cell">{p.plannedRevenueFy > 0 ? pct(p.grossMarginPctFy || 0) : <span className="text-muted-foreground">-</span>}</td>
                          <td className="py-2.5 px-2 text-center">
                            {p.criticalActionCount > 0 ? (
                              <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">{p.criticalActionCount}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="py-2.5 px-1 text-center">
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-muted/20 border-t border-border/40">
                            <td colSpan={10} className="p-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                                <div className="rounded-lg border border-border/50 p-3">
                                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Project Details</p>
                                  <div className="space-y-1.5 text-sm">
                                    <p><span className="text-muted-foreground">Portfolio:</span> <span className="font-medium">{p.portfolio || "-"}</span></p>
                                    <p><span className="text-muted-foreground">PM:</span> {p.pm || "-"}</p>
                                    <p><span className="text-muted-foreground">PD:</span> {p.pd || "-"}</p>
                                    <p><span className="text-muted-foreground">Phase:</span> {p.executionPhase || "-"}</p>
                                  </div>
                                </div>
                                <div className="rounded-lg border border-border/50 p-3">
                                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Progress</p>
                                  <div className="space-y-1.5 text-sm">
                                    <p><span className="text-muted-foreground">Actual:</span> <span className="font-medium">{pct(p.actualProgressPct)}</span></p>
                                    <p><span className="text-muted-foreground">Expected:</span> {pct(p.expectedProgressPct)}</p>
                                    <p><span className="text-muted-foreground">Variance:</span> <span className={variance < 0 ? "text-red-700 font-medium" : "text-emerald-600 font-medium"}>{pct(p.scheduleVariancePct)}</span></p>
                                  </div>
                                </div>
                                <div className="rounded-lg border border-border/50 p-3">
                                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Financials</p>
                                  <div className="space-y-1.5 text-sm">
                                    <p><span className="text-muted-foreground">Revenue:</span> {money(p.plannedRevenueFy)}</p>
                                    <p><span className="text-muted-foreground">Inflow:</span> <span className="text-emerald-600">{money(p.receivedInflowFy)}</span></p>
                                    <p><span className="text-muted-foreground">Open Inflow:</span> <span className="text-amber-600">{money(p.openInflowFy)}</span></p>
                                    <p><span className="text-muted-foreground">Expenditure:</span> {money(p.plannedExpenditureFy)}</p>
                                    <p><span className="text-muted-foreground">Paid:</span> <span className="text-emerald-600">{money(p.paidExpenditureFy)}</span></p>
                                    <p><span className="text-muted-foreground">Open Exp:</span> <span className="text-amber-600">{money(p.openExpenditureFy)}</span></p>
                                    <p><span className="text-muted-foreground">Plan GP Margin:</span> <span className="font-medium">{pct(p.grossMarginPctFy || 0)}</span></p>
                                  </div>
                                </div>
                                <div className="rounded-lg border border-border/50 p-3">
                                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Issues & Status</p>
                                  <div className="space-y-1.5 text-sm">
                                    <p><span className="text-muted-foreground">Critical actions:</span> <span className="font-medium">{p.criticalActionCount}</span></p>
                                    <p><span className="text-muted-foreground">Engineering:</span> {p.engineeringStatus}</p>
                                    <p><span className="text-muted-foreground">Quality:</span> {p.qualityStatus}</p>
                                    <p><span className="text-muted-foreground">Import:</span> {p.importFreshness}</p>
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2 mt-3 flex-wrap">
                                <Link href={`/project/${encodeURIComponent(p.projectName)}`}>
                                  <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    Open Project
                                  </Button>
                                </Link>
                                <Link href={`/project/${encodeURIComponent(p.projectName)}?tab=plan`}><Button size="sm" variant="outline">Plan</Button></Link>
                                <Link href={`/project/${encodeURIComponent(p.projectName)}?tab=revenue-tracking`}><Button size="sm" variant="outline">Revenue</Button></Link>
                                <Link href={`/project/${encodeURIComponent(p.projectName)}?tab=expenditure`}><Button size="sm" variant="outline">Expenditure</Button></Link>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {(data?.projects || []).length === 0 && (
                <EmptyState title="No projects match current filters" className="border-0 rounded-none" />
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
