import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Construction, Zap, Wrench, UserCheck, DollarSign, AlertCircle,
  TrendingDown, TrendingUp, ArrowRight, AlertTriangle, Clock,
  ChevronDown, ChevronRight, X, Loader2, Target, BarChart3,
} from "lucide-react";
import { useLocation, Link } from "wouter";
import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from "recharts";

function formatRand(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "—";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

function formatPct(val: number | null): string {
  if (val === null || val === undefined) return "--";
  return `${(val * 100).toFixed(1)}%`;
}

interface HighPriority {
  overdueExpenses: Array<{
    id: number;
    projectName: string;
    lineItem: string | null;
    invoiceNumber: string | null;
    poNumber: string | null;
    amount: number;
    paymentDate: string;
    severity: string;
    hasInvoice?: boolean;
  }>;
  revenueOutstanding: Array<{
    id: number;
    projectName: string;
    milestoneName: string | null;
    invoiceNumber: string | null;
    amount: number;
    dueDate: string | null;
    severity: string;
  }>;
  projectsBehindPlan: Array<{
    projectName: string;
    phase: string | null;
    pm: string | null;
    delta: number;
    avgActual: number;
    avgExpected: number;
    severity: string;
  }>;
  upcomingMilestones: Array<{
    projectName: string;
    milestoneType: string;
    date: string;
    pm: string | null;
  }>;
}

const severityConfig: Record<string, { bg: string; text: string; border: string }> = {
  Critical: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
  High: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  Medium: { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200" },
};

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = severityConfig[severity] || severityConfig.Medium;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${cfg.bg} ${cfg.text} ${cfg.border} border`}>
      {severity}
    </span>
  );
}

function KpiDrilldown({
  items,
  type,
  onClose,
  onNavigate,
}: {
  items: any[];
  type: string;
  onClose: () => void;
  onNavigate: (projectName: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const isFinancial = type === "revenue" || type === "expense" || type === "inflows" || type === "outflows";

  return (
    <div
      ref={ref}
      className="absolute z-50 top-full left-0 sm:left-1/2 sm:-translate-x-1/2 mt-2 w-[calc(100vw-2rem)] sm:w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
      data-testid="kpi-drilldown"
    >
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {items.length} project{items.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          data-testid="drilldown-close"
        >
          <X className="h-3.5 w-3.5 text-gray-400" />
        </button>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">No projects</div>
      ) : (
        <div className="max-h-60 overflow-y-auto divide-y divide-gray-50 dark:divide-gray-800">
          {items.map((item: any, i: number) => (
            <button
              key={i}
              className="w-full text-left flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-blue-50/50 dark:hover:bg-blue-900/20 transition-colors group"
              onClick={() => onNavigate(item.projectName)}
              data-testid={`drilldown-item-${i}`}
            >
              <span className="truncate text-sm font-medium text-gray-700 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                {(item.projectName || "").replace("_Tracker", "")}
              </span>
              {isFinancial ? (
                <span className="text-xs font-mono font-semibold text-gray-500 whitespace-nowrap">{formatRand(item.amount ?? 0)}</span>
              ) : (
                <span className="text-xs text-gray-400 whitespace-nowrap">{item.date || item.pm || "—"}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  value,
  label,
  sublabel,
  color,
  drilldownKey,
  drilldownItems,
  drilldownType,
  isFinancial,
  activeDrilldown,
  onToggle,
  onClose,
  onNavigate,
  testId,
  valueTestId,
}: {
  icon: any;
  value: string | number;
  label: string;
  sublabel?: string;
  color: string;
  drilldownKey: string;
  drilldownItems?: any[];
  drilldownType: string;
  isFinancial?: boolean;
  activeDrilldown: string | null;
  onToggle: (key: string) => void;
  onClose: () => void;
  onNavigate: (name: string) => void;
  testId: string;
  valueTestId: string;
}) {
  const colorMap: Record<string, { card: string; icon: string; iconBg: string; value: string; label: string; sub: string }> = {
    amber: {
      card: "border-amber-200/60 bg-gradient-to-br from-amber-50 to-orange-50/30 dark:from-amber-950/30 dark:to-orange-950/20 dark:border-amber-800/40",
      icon: "text-amber-600 dark:text-amber-400",
      iconBg: "bg-amber-100/80 dark:bg-amber-900/50",
      value: "text-amber-900 dark:text-amber-200",
      label: "text-amber-700 dark:text-amber-400",
      sub: "text-amber-500 dark:text-amber-500",
    },
    blue: {
      card: "border-blue-200/60 bg-gradient-to-br from-blue-50 to-indigo-50/30 dark:from-blue-950/30 dark:to-indigo-950/20 dark:border-blue-800/40",
      icon: "text-blue-600 dark:text-blue-400",
      iconBg: "bg-blue-100/80 dark:bg-blue-900/50",
      value: "text-blue-900 dark:text-blue-200",
      label: "text-blue-700 dark:text-blue-400",
      sub: "text-blue-500 dark:text-blue-500",
    },
    green: {
      card: "border-emerald-200/60 bg-gradient-to-br from-emerald-50 to-green-50/30 dark:from-emerald-950/30 dark:to-green-950/20 dark:border-emerald-800/40",
      icon: "text-emerald-600 dark:text-emerald-400",
      iconBg: "bg-emerald-100/80 dark:bg-emerald-900/50",
      value: "text-emerald-900 dark:text-emerald-200",
      label: "text-emerald-700 dark:text-emerald-400",
      sub: "text-emerald-500 dark:text-emerald-500",
    },
    purple: {
      card: "border-violet-200/60 bg-gradient-to-br from-violet-50 to-purple-50/30 dark:from-violet-950/30 dark:to-purple-950/20 dark:border-violet-800/40",
      icon: "text-violet-600 dark:text-violet-400",
      iconBg: "bg-violet-100/80 dark:bg-violet-900/50",
      value: "text-violet-900 dark:text-violet-200",
      label: "text-violet-700 dark:text-violet-400",
      sub: "text-violet-500 dark:text-violet-500",
    },
    red: {
      card: "border-red-200/60 bg-gradient-to-br from-red-50 to-rose-50/30 dark:from-red-950/30 dark:to-rose-950/20 dark:border-red-800/40",
      icon: "text-red-600 dark:text-red-400",
      iconBg: "bg-red-100/80 dark:bg-red-900/50",
      value: "text-red-900 dark:text-red-200",
      label: "text-red-700 dark:text-red-400",
      sub: "text-red-500 dark:text-red-500",
    },
  };

  const c = colorMap[color] || colorMap.blue;
  const isOpen = activeDrilldown === drilldownKey;

  return (
    <div className="relative">
      <button
        className={`w-full text-left rounded-xl border ${c.card} p-3 sm:p-5 cursor-pointer hover:shadow-lg active:scale-[0.98] sm:hover:scale-[1.02] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-400`}
        onClick={() => onToggle(drilldownKey)}
        data-testid={testId}
      >
        <div className="flex items-start gap-3 sm:gap-4">
          <div className={`p-2 sm:p-3 rounded-xl ${c.iconBg} shrink-0`}>
            <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${c.icon}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-xl sm:text-2xl font-bold tracking-tight ${c.value}`} data-testid={valueTestId}>
              {value}
            </p>
            <p className={`text-xs sm:text-sm font-medium mt-0.5 ${c.label}`}>{label}</p>
            {sublabel && <p className={`text-[10px] sm:text-[11px] mt-0.5 ${c.sub}`}>{sublabel}</p>}
          </div>
        </div>
      </button>
      {isOpen && drilldownItems && (
        <KpiDrilldown items={drilldownItems} type={drilldownType} onClose={onClose} onNavigate={onNavigate} />
      )}
    </div>
  );
}

function PrioritySection({
  title,
  icon: Icon,
  iconColor,
  accentBorder,
  items,
  renderItem,
  expanded,
  onToggle,
}: {
  title: string;
  icon: any;
  iconColor: string;
  accentBorder: string;
  items: any[];
  renderItem: (item: any, i: number) => React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
}) {
  const displayItems = expanded ? items : items.slice(0, 5);
  const testSlug = title.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className={`rounded-lg border-l-4 ${accentBorder} bg-white dark:bg-gray-900/50 overflow-hidden`}>
      <button
        className="flex items-center gap-3 w-full text-left px-4 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors"
        onClick={onToggle}
        data-testid={`toggle-${testSlug}`}
      >
        <div className={`p-1.5 rounded-lg ${iconColor.replace("text-", "bg-").replace("600", "100")} dark:bg-opacity-20`}>
          <Icon className={`h-4 w-4 ${iconColor}`} />
        </div>
        <span className="font-semibold text-sm text-gray-800 dark:text-gray-200 flex-1">{title}</span>
        <Badge className="rounded-full px-2.5 py-0.5 text-xs font-bold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-0">
          {items.length}
        </Badge>
        {items.length > 0 && (
          expanded
            ? <ChevronDown className="h-4 w-4 text-gray-400 transition-transform" />
            : <ChevronRight className="h-4 w-4 text-gray-400 transition-transform" />
        )}
      </button>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 px-4 pb-3">All clear — no items</p>
      ) : (
        <div className="px-2 pb-2">
          <div className="space-y-0.5">
            {displayItems.map((item, i) => renderItem(item, i))}
          </div>
          {items.length > 5 && !expanded && (
            <div className="px-2 pt-1">
              <Button variant="ghost" size="sm" className="h-7 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50/50 px-2" onClick={onToggle}>
                Show {items.length - 5} more…
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value ?? 0) * 100));
  const barColor = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-blue-500" : pct >= 25 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono font-medium text-gray-600 dark:text-gray-400 w-12 text-right">{pct.toFixed(1)}%</span>
    </div>
  );
}

function SkeletonDashboard() {
  return (
    <div className="space-y-8 max-w-[1400px] mx-auto">
      <div className="space-y-2">
        <div className="h-9 w-64 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse" />
        <div className="h-4 w-48 bg-gray-100 dark:bg-gray-800/60 rounded animate-pulse" />
      </div>
      <div className="grid gap-3 sm:gap-4 grid-cols-1 xs:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-28 bg-gray-100 dark:bg-gray-800/40 rounded-xl animate-pulse" />
        ))}
      </div>
      <div className="h-64 bg-gray-100 dark:bg-gray-800/40 rounded-xl animate-pulse" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-48 bg-gray-100 dark:bg-gray-800/40 rounded-xl animate-pulse" />
        <div className="h-48 bg-gray-100 dark:bg-gray-800/40 rounded-xl animate-pulse" />
      </div>
    </div>
  );
}

function phaseColor(phase: string | null): string {
  switch (phase?.toLowerCase()) {
    case 'construction': return '#4472C4';
    case 'qa': case 'quality assurance': return '#ED7D31';
    case 'commissioning': return '#FFC000';
    case 'handover': return '#70AD47';
    case 'compliance handover': return '#5B9BD5';
    case 'commercial close out': return '#A5A5A5';
    case 'dlp': return '#9B59B6';
    case 'financial close': return '#2ECC71';
    case 'planning': return '#1ABC9C';
    case 'tbc': return '#BDC3C7';
    case 'hold': return '#E74C3C';
    default: return '#70AD47';
  }
}

function GanttTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-800 dark:text-gray-200 mb-1">{d.displayName}</p>
      <p className="text-gray-500">Start: {d.startDate || "—"}</p>
      <p className="text-gray-500">End: {d.endDate || "—"}</p>
      {d.phase && <p className="text-gray-500">Phase: {d.phase}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeDrilldown, setActiveDrilldown] = useState<string | null>(null);

  const { data: dashboardData, isLoading: dashLoading } = useQuery<{
    kpis: {
      siteEstablishmentNext10: number;
      commissioningNext10: number;
      omHandoverNext10: number;
      clientHandoverNext10: number;
      revenueOutstanding: number;
      expenseOverdue: number;
      inflowsThisWeek: number;
      outflowsThisWeek: number;
    };
    cosKpis: {
      currentMonthRealised: number;
      currentMonthTarget: number;
      currentMonthRealisedPct: number;
      ytdRealised: number;
      ytdTarget: number;
      ytdRealisedPct: number;
    };
    kpiDetails: {
      siteEstablishmentProjects: Array<{ projectName: string; date: string; pm: string | null }>;
      commissioningProjects: Array<{ projectName: string; date: string; pm: string | null }>;
      omHandoverProjects: Array<{ projectName: string; date: string; pm: string | null }>;
      clientHandoverProjects: Array<{ projectName: string; date: string; pm: string | null }>;
      revenueOutstandingProjects: Array<{ projectName: string; amount: number }>;
      expenseOverdueProjects: Array<{ projectName: string; amount: number }>;
      inflowProjects: Array<{ projectName: string; amount: number }>;
      outflowProjects: Array<{ projectName: string; amount: number }>;
    };
    pmTable: Array<{ pm: string; activeProjects: number; commissioningThisMonth: number; clientHandoverThisMonth: number }>;
    projectsByPhase: Array<{ phase: string; count: number }>;
    completionCompare: Array<{ projectName: string; actualPct: number; expectedPct: number }>;
    portfolioTimeline: Array<{ projectName: string; startDate: string | null; endDate: string | null; phase: string | null }>;
  }>({
    queryKey: ["/api/program-dashboard"],
  });

  const { data: highPriority, isLoading: hpLoading } = useQuery<HighPriority>({
    queryKey: ["/api/dashboard/high-priority"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: projectsSummary = [] } = useQuery<any[]>({
    queryKey: ["/api/projects-summary"],
  });

  const kpis = dashboardData?.kpis;
  const cosKpis = dashboardData?.cosKpis;
  const kpiDetails = dashboardData?.kpiDetails;
  const pmTable = dashboardData?.pmTable || [];
  const projectsByPhase = dashboardData?.projectsByPhase || [];
  const completionCompare = dashboardData?.completionCompare || [];
  const portfolioTimeline = dashboardData?.portfolioTimeline || [];

  const top10Projects = useMemo(() => {
    if (!projectsSummary.length) return [];
    return [...projectsSummary]
      .sort((a, b) => (a.delta_vs_expected ?? 0) - (b.delta_vs_expected ?? 0))
      .slice(0, 10);
  }, [projectsSummary]);

  const pmTotals = useMemo(() => {
    return pmTable.reduce(
      (acc, row) => ({
        activeProjects: acc.activeProjects + row.activeProjects,
        commissioningThisMonth: acc.commissioningThisMonth + row.commissioningThisMonth,
        clientHandoverThisMonth: acc.clientHandoverThisMonth + row.clientHandoverThisMonth,
      }),
      { activeProjects: 0, commissioningThisMonth: 0, clientHandoverThisMonth: 0 }
    );
  }, [pmTable]);

  const ganttData = useMemo(() => {
    if (!portfolioTimeline.length) return [];
    const allDates = portfolioTimeline
      .flatMap(p => [p.startDate, p.endDate])
      .filter(Boolean)
      .map(d => new Date(d!).getTime());
    if (!allDates.length) return [];
    const minTime = Math.min(...allDates);
    return portfolioTimeline.map(p => {
      const start = p.startDate ? new Date(p.startDate).getTime() : null;
      const end = p.endDate ? new Date(p.endDate).getTime() : null;
      return {
        displayName: (p.projectName || "").replace(/_Tracker$/i, "").replace(/_/g, " "),
        projectName: p.projectName,
        phase: p.phase,
        startDate: p.startDate,
        endDate: p.endDate,
        offset: start ? (start - minTime) / (1000 * 60 * 60 * 24) : 0,
        duration: start && end ? Math.max(1, (end - start) / (1000 * 60 * 60 * 24)) : 1,
      };
    });
  }, [portfolioTimeline]);

  const completionChartData = useMemo(() => {
    return completionCompare.map(p => ({
      name: (p.projectName || "").replace(/_Tracker$/i, "").replace(/_/g, " "),
      projectName: p.projectName,
      actual: Math.round(p.actualPct),
      expected: Math.round(p.expectedPct),
    }));
  }, [completionCompare]);

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleDrilldown = (key: string) => {
    setActiveDrilldown((prev) => (prev === key ? null : key));
  };

  const navigateToProject = (projectName: string) => {
    setActiveDrilldown(null);
    setLocation(`/project/${encodeURIComponent(projectName)}`);
  };

  if (dashLoading && !dashboardData) {
    return <SkeletonDashboard />;
  }

  return (
    <div className="space-y-8 max-w-[1400px] mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50" data-testid="text-page-title">
            Program Dashboard
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            FY26: 1 Sep 2025 – 31 Aug 2026
          </p>
        </div>
        <time className="text-sm font-medium text-gray-400 dark:text-gray-500 tabular-nums" data-testid="text-today-date">
          {format(new Date(), "EEEE, d MMMM yyyy")}
        </time>
      </header>

      <section aria-label="Milestone KPIs">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Milestones</p>
        <div className="grid gap-3 sm:gap-4 grid-cols-1 xs:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon={Construction}
            value={kpis?.siteEstablishmentNext10 ?? 0}
            label="Site Establishment"
            sublabel="Next 7 Days"
            color="amber"
            drilldownKey="site"
            drilldownItems={kpiDetails?.siteEstablishmentProjects}
            drilldownType="milestone"
            activeDrilldown={activeDrilldown}
            onToggle={toggleDrilldown}
            onClose={() => setActiveDrilldown(null)}
            onNavigate={navigateToProject}
            testId="card-site-establishment"
            valueTestId="value-site-establishment"
          />
          <KpiCard
            icon={Zap}
            value={kpis?.commissioningNext10 ?? 0}
            label="Commissioning"
            sublabel="Next 7 Days"
            color="blue"
            drilldownKey="commissioning"
            drilldownItems={kpiDetails?.commissioningProjects}
            drilldownType="milestone"
            activeDrilldown={activeDrilldown}
            onToggle={toggleDrilldown}
            onClose={() => setActiveDrilldown(null)}
            onNavigate={navigateToProject}
            testId="card-commissioning"
            valueTestId="value-commissioning"
          />
          <KpiCard
            icon={Wrench}
            value={kpis?.omHandoverNext10 ?? 0}
            label="O&M Handover"
            sublabel="Next 7 Days"
            color="green"
            drilldownKey="om"
            drilldownItems={kpiDetails?.omHandoverProjects}
            drilldownType="milestone"
            activeDrilldown={activeDrilldown}
            onToggle={toggleDrilldown}
            onClose={() => setActiveDrilldown(null)}
            onNavigate={navigateToProject}
            testId="card-om-handover"
            valueTestId="value-om-handover"
          />
          <KpiCard
            icon={UserCheck}
            value={kpis?.clientHandoverNext10 ?? 0}
            label="Client Handover"
            sublabel="Next 7 Days"
            color="purple"
            drilldownKey="client"
            drilldownItems={kpiDetails?.clientHandoverProjects}
            drilldownType="milestone"
            activeDrilldown={activeDrilldown}
            onToggle={toggleDrilldown}
            onClose={() => setActiveDrilldown(null)}
            onNavigate={navigateToProject}
            testId="card-client-handover"
            valueTestId="value-client-handover"
          />
        </div>
      </section>

      <section aria-label="Financial KPIs">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Financial</p>
        <div className="grid gap-3 sm:gap-4 grid-cols-1 xs:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon={Target}
            value={cosKpis ? `${(cosKpis.ytdRealisedPct * 100).toFixed(1)}%` : "--"}
            label="COS Realised vs YTD Target"
            sublabel={cosKpis ? `${formatRand(cosKpis.ytdRealised)} / ${formatRand(cosKpis.ytdTarget)}` : undefined}
            color="green"
            drilldownKey="cosYtd"
            drilldownType="info"
            activeDrilldown={activeDrilldown}
            onToggle={toggleDrilldown}
            onClose={() => setActiveDrilldown(null)}
            onNavigate={navigateToProject}
            testId="card-cos-ytd"
            valueTestId="value-cos-ytd"
          />
          <KpiCard
            icon={BarChart3}
            value={cosKpis ? `${(cosKpis.currentMonthRealisedPct * 100).toFixed(1)}%` : "--"}
            label="COS Realised vs Month Target"
            sublabel={cosKpis ? `${formatRand(cosKpis.currentMonthRealised)} / ${formatRand(cosKpis.currentMonthTarget)}` : undefined}
            color="blue"
            drilldownKey="cosMonth"
            drilldownType="info"
            activeDrilldown={activeDrilldown}
            onToggle={toggleDrilldown}
            onClose={() => setActiveDrilldown(null)}
            onNavigate={navigateToProject}
            testId="card-cos-month"
            valueTestId="value-cos-month"
          />
          <KpiCard
            icon={DollarSign}
            value={formatRand(kpis?.revenueOutstanding ?? 0)}
            label="Revenue Outstanding"
            sublabel="Invoiced, unpaid & overdue"
            color="amber"
            drilldownKey="revOutstanding"
            drilldownItems={kpiDetails?.revenueOutstandingProjects}
            drilldownType="revenue"
            isFinancial
            activeDrilldown={activeDrilldown}
            onToggle={toggleDrilldown}
            onClose={() => setActiveDrilldown(null)}
            onNavigate={navigateToProject}
            testId="card-revenue-outstanding"
            valueTestId="value-revenue-outstanding"
          />
          <KpiCard
            icon={AlertCircle}
            value={formatRand(kpis?.expenseOverdue ?? 0)}
            label="Expenses Overdue"
            sublabel="Payment date in the past"
            color="red"
            drilldownKey="expOverdue"
            drilldownItems={kpiDetails?.expenseOverdueProjects}
            drilldownType="expense"
            isFinancial
            activeDrilldown={activeDrilldown}
            onToggle={toggleDrilldown}
            onClose={() => setActiveDrilldown(null)}
            onNavigate={navigateToProject}
            testId="card-expenses-overdue"
            valueTestId="value-expenses-overdue"
          />
        </div>
      </section>

      <Card className="border-l-4 border-l-red-500 shadow-sm" data-testid="card-high-priority">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold text-gray-900 dark:text-gray-50">High Priority Actions</CardTitle>
              <p className="text-xs text-gray-400 mt-0.5">
                Overdue expenses · Revenue outstanding · Projects behind plan · Upcoming milestones
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {hpLoading ? (
            <div className="flex items-center gap-2 py-6 justify-center text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading priority items…</span>
            </div>
          ) : highPriority ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <PrioritySection
                title="Overdue Expenses"
                icon={AlertCircle}
                iconColor="text-red-600"
                accentBorder="border-l-red-400"
                items={highPriority.overdueExpenses}
                expanded={!!expanded.overdue}
                onToggle={() => toggle("overdue")}
                renderItem={(item, i) => (
                  <Link key={i} href={`/project/${encodeURIComponent(item.projectName)}?tab=expenditure&highlightId=${item.id}&highlightType=expense`}>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-50/60 dark:hover:bg-red-900/10 cursor-pointer group transition-colors" data-testid={`item-overdue-${i}`}>
                      <SeverityBadge severity={item.severity} />
                      <span className="text-sm truncate flex-1 text-gray-700 dark:text-gray-300 group-hover:text-red-700 dark:group-hover:text-red-400 transition-colors font-medium">
                        {item.projectName.replace("_Tracker", "")}
                      </span>
                      {item.hasInvoice !== undefined && (
                        <Badge variant={item.hasInvoice ? "default" : "destructive"} className="text-[9px] px-1 py-0">
                          {item.hasInvoice ? "INV" : "No INV"}
                        </Badge>
                      )}
                      <span className="text-sm font-mono font-semibold text-red-600 whitespace-nowrap">{formatRand(item.amount)}</span>
                      <span className="text-[11px] text-gray-400 whitespace-nowrap">{item.paymentDate}</span>
                    </div>
                  </Link>
                )}
              />

              <PrioritySection
                title="Revenue Outstanding"
                icon={DollarSign}
                iconColor="text-amber-600"
                accentBorder="border-l-amber-400"
                items={highPriority.revenueOutstanding}
                expanded={!!expanded.revenue}
                onToggle={() => toggle("revenue")}
                renderItem={(item, i) => (
                  <Link key={i} href={`/project/${encodeURIComponent(item.projectName)}?tab=revenue-tracking&highlightId=${item.id}&highlightType=revenue`}>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-amber-50/60 dark:hover:bg-amber-900/10 cursor-pointer group transition-colors" data-testid={`item-revenue-${i}`}>
                      <SeverityBadge severity={item.severity} />
                      <span className="text-sm truncate flex-1 text-gray-700 dark:text-gray-300 group-hover:text-amber-700 dark:group-hover:text-amber-400 transition-colors font-medium">
                        {item.projectName.replace("_Tracker", "")}
                      </span>
                      <span className="text-sm font-mono font-semibold text-amber-600 whitespace-nowrap">{formatRand(item.amount)}</span>
                      {item.invoiceNumber && (
                        <span className="text-[11px] text-gray-400 truncate max-w-[80px]">{item.invoiceNumber}</span>
                      )}
                    </div>
                  </Link>
                )}
              />

              <PrioritySection
                title="Projects Behind Plan"
                icon={TrendingDown}
                iconColor="text-orange-600"
                accentBorder="border-l-orange-400"
                items={highPriority.projectsBehindPlan}
                expanded={!!expanded.behind}
                onToggle={() => toggle("behind")}
                renderItem={(item, i) => (
                  <Link key={i} href={`/project/${encodeURIComponent(item.projectName)}`}>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-orange-50/60 dark:hover:bg-orange-900/10 cursor-pointer group transition-colors" data-testid={`item-behind-${i}`}>
                      <SeverityBadge severity={item.severity} />
                      <span className="text-sm truncate flex-1 text-gray-700 dark:text-gray-300 group-hover:text-orange-700 dark:group-hover:text-orange-400 transition-colors font-medium">
                        {item.projectName.replace("_Tracker", "")}
                      </span>
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0 font-mono font-bold">{formatPct(item.delta)}</Badge>
                      {item.pm && <span className="text-[11px] text-gray-400 whitespace-nowrap">{item.pm}</span>}
                    </div>
                  </Link>
                )}
              />

              <PrioritySection
                title="Upcoming Milestones"
                icon={Clock}
                iconColor="text-blue-600"
                accentBorder="border-l-blue-400"
                items={highPriority.upcomingMilestones}
                expanded={!!expanded.milestones}
                onToggle={() => toggle("milestones")}
                renderItem={(item, i) => (
                  <Link key={i} href={`/project/${encodeURIComponent(item.projectName)}`}>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-blue-50/60 dark:hover:bg-blue-900/10 cursor-pointer group transition-colors" data-testid={`item-milestone-${i}`}>
                      <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] font-bold px-1.5" variant="outline">{item.milestoneType}</Badge>
                      <span className="text-sm truncate flex-1 text-gray-700 dark:text-gray-300 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors font-medium">
                        {item.projectName.replace("_Tracker", "")}
                      </span>
                      <span className="text-[11px] font-mono text-gray-400 whitespace-nowrap">{item.date}</span>
                      {item.pm && <span className="text-[11px] text-gray-400 whitespace-nowrap">{item.pm}</span>}
                    </div>
                  </Link>
                )}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:gap-6 grid-cols-1 xl:grid-cols-5">
        <Card className="xl:col-span-2 shadow-sm" data-testid="card-pm-summary">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold text-gray-900 dark:text-gray-50">PM Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800">
                    <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">PM Name</th>
                    <th className="text-right py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Active</th>
                    <th className="text-right py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Comm.</th>
                    <th className="text-right py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Handover</th>
                  </tr>
                </thead>
                <tbody>
                  {pmTable.map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors" data-testid={`row-pm-${i}`}>
                      <td className="py-2.5 px-3 font-medium text-gray-700 dark:text-gray-300">{row.pm}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-gray-600 dark:text-gray-400">{row.activeProjects}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-gray-600 dark:text-gray-400">{row.commissioningThisMonth}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-gray-600 dark:text-gray-400">{row.clientHandoverThisMonth}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 dark:border-gray-700">
                    <td className="py-2.5 px-3 font-bold text-gray-900 dark:text-gray-100">Total</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-gray-900 dark:text-gray-100">{pmTotals.activeProjects}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-gray-900 dark:text-gray-100">{pmTotals.commissioningThisMonth}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-gray-900 dark:text-gray-100">{pmTotals.clientHandoverThisMonth}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-3 shadow-sm" data-testid="card-projects-overview">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold text-gray-900 dark:text-gray-50">Active Projects — Top 10</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50/50 gap-1"
                onClick={() => setLocation("/projects")}
                data-testid="link-view-all-projects"
              >
                View All <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800">
                    <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Project</th>
                    <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Phase</th>
                    <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400 min-w-[140px]">% Complete</th>
                    <th className="text-right py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Delta</th>
                    <th className="text-right py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Revenue</th>
                    <th className="text-right py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Expenses</th>
                  </tr>
                </thead>
                <tbody>
                  {top10Projects.map((p: any, i: number) => {
                    const delta = p.delta_vs_expected ?? 0;
                    const deltaColor = delta < -0.05 ? "text-red-600 bg-red-50" : delta < 0 ? "text-amber-600 bg-amber-50" : "text-emerald-600 bg-emerald-50";
                    return (
                      <tr
                        key={p.project_name || i}
                        className="border-b border-gray-50 dark:border-gray-800/50 last:border-0 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 cursor-pointer transition-colors"
                        onClick={() => setLocation(`/project/${encodeURIComponent(p.project_name)}`)}
                        data-testid={`row-project-${i}`}
                      >
                        <td className="py-2.5 px-3 font-medium text-gray-800 dark:text-gray-200 max-w-[180px] truncate">
                          {(p.project_name || "").replace("_Tracker", "")}
                        </td>
                        <td className="py-2.5 px-3 text-gray-500 dark:text-gray-400">{p.phase || "--"}</td>
                        <td className="py-2.5 px-3">
                          <ProgressBar value={p.project_pct_complete ?? 0} />
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-mono font-bold ${deltaColor}`}>
                            {formatPct(p.delta_vs_expected)}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-gray-600 dark:text-gray-400">{formatRand(p.actual_revenue ?? 0)}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-gray-600 dark:text-gray-400">{formatRand(p.actual_expenses ?? 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {projectsByPhase.length > 0 && (
        <Card className="shadow-sm" data-testid="card-projects-by-phase">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold text-gray-900 dark:text-gray-50">Count of Projects by Phase</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(200, projectsByPhase.length * 40 + 40)}>
              <BarChart data={projectsByPhase} layout="vertical" margin={{ top: 5, right: 15, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="phase"
                  width={160}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 13 }}
                  formatter={(value: number) => [value, "Projects"]}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={28}>
                  {projectsByPhase.map((_entry, index) => (
                    <Cell key={index} fill="#4472C4" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {completionChartData.length > 0 && (
        <Card className="shadow-sm" data-testid="card-completion-compare">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold text-gray-900 dark:text-gray-50">
              Construction & QA — Actual vs Forecasted Completion
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(300, completionChartData.length * 30 + 60)}>
              <BarChart data={completionChartData} layout="vertical" margin={{ top: 5, right: 15, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={140}
                  tick={{ fontSize: 10 }}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 13 }}
                  formatter={(value: number, name: string) => [`${value}%`, name === "actual" ? "Project % Complete" : "Expected % Completed"]}
                />
                <Legend
                  formatter={(value) => value === "actual" ? "Project % Complete" : "Expected % Completed"}
                  wrapperStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="actual" fill="#70AD47" radius={[0, 4, 4, 0]} maxBarSize={14} />
                <Bar dataKey="expected" fill="#4472C4" radius={[0, 4, 4, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {ganttData.length > 0 && (
        <Card className="shadow-sm" data-testid="card-portfolio-gantt">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold text-gray-900 dark:text-gray-50">Portfolio Gantt Chart</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
              <div style={{ minWidth: 700 }}>
                {(() => {
                  const allDates = portfolioTimeline
                    .flatMap(p => [p.startDate, p.endDate])
                    .filter(Boolean)
                    .map(d => new Date(d!).getTime());
                  if (!allDates.length) return null;
                  const minTime = Math.min(...allDates);
                  const maxTime = Math.max(...allDates);
                  const totalDays = Math.max(1, (maxTime - minTime) / (1000 * 60 * 60 * 24));

                  const dateMarkers: { label: string; pct: number }[] = [];
                  const markerInterval = Math.ceil(totalDays / 10);
                  for (let d = 0; d <= totalDays; d += markerInterval) {
                    const t = new Date(minTime + d * 86400000);
                    dateMarkers.push({
                      label: format(t, "yyyy/MM/dd"),
                      pct: (d / totalDays) * 100,
                    });
                  }

                  const todayTime = new Date().getTime();
                  const todayPct = todayTime >= minTime && todayTime <= maxTime
                    ? ((todayTime - minTime) / (maxTime - minTime)) * 100
                    : null;

                  const phases = Array.from(new Set(ganttData.map(r => r.phase).filter(Boolean))) as string[];

                  return (
                    <div className="flex flex-col">
                      <div className="flex mb-1 pl-[160px] sm:pl-[220px]">
                        <div className="relative flex-1 h-5">
                          {dateMarkers.map((m, i) => (
                            <span
                              key={i}
                              className="absolute text-[10px] text-gray-400 whitespace-nowrap"
                              style={{ left: `${m.pct}%`, transform: "translateX(-50%)" }}
                            >
                              {m.label}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="relative">
                        {todayPct !== null && (
                          <div
                            className="absolute top-0 bottom-0 border-l-2 border-red-400 border-dashed z-10 pointer-events-none"
                            style={{ left: `calc(var(--gantt-label-w, 160px) + (100% - var(--gantt-label-w, 160px)) * ${todayPct / 100})` }}
                            title={`Today: ${format(new Date(), "yyyy/MM/dd")}`}
                          >
                            <span className="absolute -top-4 -translate-x-1/2 text-[9px] font-semibold text-red-500">Today</span>
                          </div>
                        )}
                        {ganttData.map((row, i) => {
                          const leftPct = (row.offset / totalDays) * 100;
                          const widthPct = Math.max(0.3, (row.duration / totalDays) * 100);
                          return (
                            <div
                              key={i}
                              className="flex items-center h-7 hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer transition-colors group"
                              onClick={() => navigateToProject(row.projectName)}
                              data-testid={`gantt-row-${i}`}
                            >
                              <div className="w-[160px] sm:w-[220px] shrink-0 pr-2 text-right">
                                <span className="text-[10px] sm:text-[11px] text-gray-600 dark:text-gray-400 truncate block group-hover:text-blue-600 transition-colors">
                                  {row.displayName}
                                </span>
                              </div>
                              <div className="relative flex-1 h-5">
                                <div
                                  className="absolute top-1 h-3 rounded-sm transition-colors opacity-90 group-hover:opacity-100"
                                  style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: 3, backgroundColor: phaseColor(row.phase) }}
                                  title={`${row.displayName} | ${row.phase || 'Unknown'}\n${row.startDate} → ${row.endDate}`}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {phases.length > 0 && (
                        <div className="flex flex-wrap gap-3 mt-3 pt-2 border-t border-gray-100 dark:border-gray-800">
                          {phases.map(p => (
                            <div key={p} className="flex items-center gap-1.5">
                              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: phaseColor(p) }} />
                              <span className="text-[10px] text-gray-500">{p}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
