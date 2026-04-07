import { useMemo, useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useSearch } from "wouter";
import { PageShell } from "@/components/layout/page-shell";
import { type AttentionItem } from "@/components/dashboard/AttentionBadges";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { apiRequest } from "@/lib/queryClient";
import { QueryErrorBanner } from "@/components/QueryErrorBanner";
import { getRoleDashboardConfig, getLensDashboardConfig } from "@/config/role-dashboard-config";
import { COMPANY_ROLE_LABELS, normalizeRoleForPermissions } from "@shared/schema/users";
import type { CompanyRole } from "@shared/schema/users";
import { useLensContext } from "@/hooks/use-lens-context";
import type { LensRole } from "@shared/schema/role-based-upgrade";
import {
  LayoutDashboard,
  FolderOpen,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
  Wrench,
  ShieldCheck,
  Briefcase,
  BarChart3,
  Clock,
  ArrowRight,
  Flame,
  ChevronDown,
  ListChecks,
  ListTodo,
  ClipboardCheck,
  ClipboardList,
  Package,
  FileSpreadsheet,
  FileText,
  CalendarCheck,
  Users,
  Sun,
  Wallet,
  Activity,
  Inbox,
  Calendar,
  MessageSquare,
  AlertCircle,
  ChevronRight,
  ExternalLink,
  Info,
} from "lucide-react";

// Lazy-load tab content from My Work pages
const MyWorkTasksPage = lazy(() => import("@/pages/my-work-tasks"));
const MyWorkCalendarPage = lazy(() => import("@/pages/my-work-calendar"));
const MyWorkMeetingsPage = lazy(() => import("@/pages/my-work-meetings"));
const InboxPage = lazy(() => import("@/pages/inbox"));
const UnifiedApprovalsQueue = lazy(() =>
  import("@/components/approvals/unified-approvals-queue").then((m) => ({ default: m.UnifiedApprovalsQueue }))
);

const money = (n: number | null | undefined) =>
  `R ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/** Resolve iconKey strings from role-dashboard-config to Lucide components */
const ICON_MAP: Record<string, React.ReactNode> = {
  AlertTriangle: <AlertTriangle className="w-4 h-4" />,
  LayoutDashboard: <LayoutDashboard className="w-4 h-4" />,
  Activity: <Activity className="w-4 h-4" />,
  ListChecks: <ListChecks className="w-4 h-4" />,
  ClipboardCheck: <ClipboardCheck className="w-4 h-4" />,
  Package: <Package className="w-4 h-4" />,
  ListTodo: <ListTodo className="w-4 h-4" />,
  Users: <Users className="w-4 h-4" />,
  Sun: <Sun className="w-4 h-4" />,
  ClipboardList: <ClipboardList className="w-4 h-4" />,
  Wallet: <Wallet className="w-4 h-4" />,
  TrendingUp: <TrendingUp className="w-4 h-4" />,
  ShieldCheck: <ShieldCheck className="w-4 h-4" />,
  FileSpreadsheet: <FileSpreadsheet className="w-4 h-4" />,
  FileText: <FileText className="w-4 h-4" />,
  CalendarCheck: <CalendarCheck className="w-4 h-4" />,
  FolderOpen: <FolderOpen className="w-4 h-4" />,
  Wrench: <Wrench className="w-4 h-4" />,
  Briefcase: <Briefcase className="w-4 h-4" />,
  DollarSign: <DollarSign className="w-4 h-4" />,
  BarChart3: <BarChart3 className="w-4 h-4" />,
  ShieldAlert: <AlertTriangle className="w-4 h-4" />,
  HardHat: <Briefcase className="w-4 h-4" />,
  Gauge: <LayoutDashboard className="w-4 h-4" />,
  Milestone: <CheckCircle2 className="w-4 h-4" />,
  Flag: <Flame className="w-4 h-4" />,
};

function resolveIcon(iconKey?: string): React.ReactNode {
  return (iconKey && ICON_MAP[iconKey]) || <ArrowRight className="w-4 h-4" />;
}

const HOME_TABS = [
  { key: "actions", label: "Actions", icon: ListChecks },
  { key: "approvals", label: "Approvals", icon: ClipboardCheck },
  { key: "calendar", label: "Calendar", icon: Calendar },
  { key: "meetings", label: "Meetings", icon: MessageSquare },
  { key: "inbox", label: "Inbox", icon: Inbox },
] as const;

type HomeTab = typeof HOME_TABS[number]["key"];

/**
 * Build a compact set of KPI cards from execution-dashboard data,
 * selected by the role's config kpi keys as a guide.
 */
function getKpiCards(
  config: ReturnType<typeof getRoleDashboardConfig>,
  kpis: any,
  stats: any,
  isLoading: boolean,
) {
  const kpiKeyMap: Record<string, { label: string; value: string | number; icon: React.ReactNode }> = {
    revenue_vs_target: { label: "Inflow Received (FY)", value: money(kpis.receivedInflowFy), icon: <DollarSign className="w-4 h-4" /> },
    gp_margin: { label: "Gross Margin", value: kpis.grossMarginPctFy != null ? `${Number(kpis.grossMarginPctFy).toFixed(1)}%` : "\u2014", icon: <TrendingUp className="w-4 h-4" /> },
    projects_off_track: { label: "Red RAG", value: stats.redProjects, icon: <AlertTriangle className="w-4 h-4" /> },
    open_vos: { label: "Pending Approvals", value: kpis.pendingApprovals ?? "\u2014", icon: <CheckCircle2 className="w-4 h-4" /> },
    projects_on_track: { label: "Active Projects", value: stats.activeProjects, icon: <FolderOpen className="w-4 h-4" /> },
    milestones_due: { label: "Behind Plan", value: kpis.projectsBehindPlan ?? "\u2014", icon: <Clock className="w-4 h-4" /> },
    overdue_tasks: { label: "Pending Approvals", value: kpis.pendingApprovals ?? "\u2014", icon: <CheckCircle2 className="w-4 h-4" /> },
    my_projects_rag: { label: "Active Projects", value: stats.activeProjects, icon: <FolderOpen className="w-4 h-4" /> },
    my_overdue_tasks: { label: "Behind Plan", value: kpis.projectsBehindPlan ?? "\u2014", icon: <Clock className="w-4 h-4" /> },
    my_approvals_pending: { label: "Pending Approvals", value: kpis.pendingApprovals ?? "\u2014", icon: <CheckCircle2 className="w-4 h-4" /> },
    my_deliverables_due: { label: "Open Expenditure (FY)", value: money(kpis.openExpenditureFy), icon: <DollarSign className="w-4 h-4" /> },
    my_eng_tasks: { label: "Active Projects", value: stats.activeProjects, icon: <FolderOpen className="w-4 h-4" /> },
    design_queue: { label: "Eng. Blockers", value: kpis.openEngineeringBlockers ?? "\u2014", icon: <AlertTriangle className="w-4 h-4" /> },
    review_queue: { label: "Behind Plan", value: kpis.projectsBehindPlan ?? "\u2014", icon: <Clock className="w-4 h-4" /> },
    my_overdue_deliverables: { label: "Avg Progress", value: kpis.averageActualProgressPct != null ? `${Number(kpis.averageActualProgressPct).toFixed(0)}%` : "\u2014", icon: <BarChart3 className="w-4 h-4" /> },
    my_opportunities: { label: "Total Projects", value: stats.totalProjects, icon: <FolderOpen className="w-4 h-4" /> },
    handover_readiness: { label: "Active Projects", value: stats.activeProjects, icon: <FolderOpen className="w-4 h-4" /> },
    pd_tickets_open: { label: "Planned Revenue (FY)", value: money(kpis.plannedRevenueFy), icon: <DollarSign className="w-4 h-4" /> },
    proposals_pending: { label: "Inflow Received (FY)", value: money(kpis.receivedInflowFy), icon: <DollarSign className="w-4 h-4" /> },
    revenue_this_month: { label: "Inflow Received (FY)", value: money(kpis.receivedInflowFy), icon: <DollarSign className="w-4 h-4" /> },
    cos_this_month: { label: "Gross Margin", value: kpis.grossMarginPctFy != null ? `${Number(kpis.grossMarginPctFy).toFixed(1)}%` : "\u2014", icon: <TrendingUp className="w-4 h-4" /> },
    cash_position: { label: "Gross Profit (FY)", value: money(kpis.grossProfitFy), icon: <DollarSign className="w-4 h-4" /> },
    margin_drift: { label: "Open Expenditure (FY)", value: money(kpis.openExpenditureFy), icon: <DollarSign className="w-4 h-4" /> },
    open_ncrs: { label: "Quality Warnings", value: kpis.openQualityWarnings ?? "\u2014", icon: <AlertTriangle className="w-4 h-4" /> },
    snags_due: { label: "Pending Approvals", value: kpis.pendingApprovals ?? "\u2014", icon: <CheckCircle2 className="w-4 h-4" /> },
    inspections_pending: { label: "Avg Progress", value: kpis.averageActualProgressPct != null ? `${Number(kpis.averageActualProgressPct).toFixed(0)}%` : "\u2014", icon: <BarChart3 className="w-4 h-4" /> },
    corrective_actions_open: { label: "Active Projects", value: stats.activeProjects, icon: <FolderOpen className="w-4 h-4" /> },
    active_sites: { label: "Active Projects", value: stats.activeProjects, icon: <FolderOpen className="w-4 h-4" /> },
    site_readiness: { label: "Behind Plan", value: kpis.projectsBehindPlan ?? "\u2014", icon: <Clock className="w-4 h-4" /> },
    open_snags: { label: "Red RAG", value: stats.redProjects, icon: <AlertTriangle className="w-4 h-4" /> },
    inspections_due: { label: "Pending Approvals", value: kpis.pendingApprovals ?? "\u2014", icon: <CheckCircle2 className="w-4 h-4" /> },
    // HSE Manager KPIs
    incidents_open: { label: "Open Incidents", value: kpis.openIncidents ?? "\u2014", icon: <AlertTriangle className="w-4 h-4" /> },
    corrective_actions_due: { label: "Corrective Actions Due", value: kpis.correctiveActionsDue ?? "\u2014", icon: <Clock className="w-4 h-4" /> },
    safety_file_compliance: { label: "Safety Compliance", value: kpis.safetyCompliance ?? "\u2014", icon: <ShieldCheck className="w-4 h-4" /> },
    inspections_overdue: { label: "Inspections Overdue", value: kpis.inspectionsOverdue ?? "\u2014", icon: <AlertTriangle className="w-4 h-4" /> },
    // SSEG Manager KPIs
    applications_pending: { label: "Applications Pending", value: kpis.applicationsPending ?? "\u2014", icon: <Clock className="w-4 h-4" /> },
    queries_outstanding: { label: "Queries Outstanding", value: kpis.queriesOutstanding ?? "\u2014", icon: <AlertTriangle className="w-4 h-4" /> },
    approvals_due: { label: "Approvals Due", value: kpis.approvalsDue ?? "\u2014", icon: <CheckCircle2 className="w-4 h-4" /> },
    rejections_open: { label: "Rejections Open", value: kpis.rejectionsOpen ?? "\u2014", icon: <AlertTriangle className="w-4 h-4" /> },
    my_tasks: { label: "Active Projects", value: stats.activeProjects, icon: <FolderOpen className="w-4 h-4" /> },
    my_approvals: { label: "Pending Approvals", value: kpis.pendingApprovals ?? "\u2014", icon: <CheckCircle2 className="w-4 h-4" /> },
    my_projects: { label: "Behind Plan", value: kpis.projectsBehindPlan ?? "\u2014", icon: <Clock className="w-4 h-4" /> },
    upcoming_events: { label: "Avg Progress", value: kpis.averageActualProgressPct != null ? `${Number(kpis.averageActualProgressPct).toFixed(0)}%` : "\u2014", icon: <BarChart3 className="w-4 h-4" /> },
  };

  const seen = new Set<string>();
  const cards: Array<{ label: string; value: string | number; icon: React.ReactNode }> = [];
  for (const kpi of config.kpis) {
    const mapped = kpiKeyMap[kpi.key];
    if (mapped && !seen.has(mapped.label)) {
      seen.add(mapped.label);
      cards.push(mapped);
    }
  }

  return cards.slice(0, 4).map((card) => (
    <Card key={card.label} className="border-border/50">
      <CardContent className="p-3.5">
        <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
          {card.icon}
          <span className="text-[11px] uppercase tracking-wide">{card.label}</span>
        </div>
        {isLoading ? (
          <Skeleton className="h-5 w-20" />
        ) : (
          <p className="text-base font-semibold font-mono text-foreground">{card.value}</p>
        )}
      </CardContent>
    </Card>
  ));
}

export default function HomePage() {
  const { user } = useAuth();
  const searchString = useSearch();
  const urlTab = new URLSearchParams(searchString).get("tab") as HomeTab | null;
  const [activeTab, setActiveTab] = useState<HomeTab>(urlTab || "actions");
  const [prioritiesExpanded, setPrioritiesExpanded] = useState(false);
  const [expandedAttention, setExpandedAttention] = useState<string | null>(null);
  const [overdueDrill, setOverdueDrill] = useState<"ap" | "ar" | null>(null);

  const { data: dashData, isLoading: dashLoading, isError: dashIsError, error: dashError } = useQuery<any>({
    queryKey: ["/api/lifecycle-board/execution-dashboard"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/lifecycle-board/execution-dashboard");
      return res.json();
    },
  });

  const { data: companyPrioritiesRaw, isLoading: prioritiesLoading, isError: prioritiesIsError, error: prioritiesError } = useQuery<any[]>({
    queryKey: ["/api/priorities"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/priorities");
      return res.json();
    },
  });
  const companyPriorities = companyPrioritiesRaw?.filter((p: any) => p.status !== "complete" && p.status !== "completed");

  const { data: myWorkData, isError: myWorkIsError, error: myWorkError } = useQuery<any>({
    queryKey: ["/api/my-work/all-tasks"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/my-work/all-tasks");
      return res.json();
    },
  });

  const { data: overdueData, isLoading: overdueLoading } = useQuery<any>({
    queryKey: ["/api/lifecycle-board/overdue-payments"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/lifecycle-board/overdue-payments");
      return res.json();
    },
    enabled: overdueDrill !== null,
  });

  const lens = useLensContext();
  const userRole = (user as any)?.role;
  const effectiveRole = normalizeRoleForPermissions(userRole) as CompanyRole;
  const config = getLensDashboardConfig(effectiveRole);
  const roleLabel = lens.activeLensLabel;
  type LayoutGroup = 'leadership' | 'portfolio-manager' | 'delivery' | 'specialist' | 'finance' | 'default';
  const layoutGroup: LayoutGroup = useMemo(() => {
    switch (lens.activeLens) {
      case 'CEO': case 'COO_SUPER_ADMIN': return 'leadership';
      case 'PROGRAM_MANAGER': return 'portfolio-manager';
      case 'PROJECT_MANAGER': case 'CONSTRUCTION_MANAGER': return 'delivery';
      case 'ENGINEER': case 'QUALITY_MANAGER': return 'specialist';
      case 'CFO': case 'PROGRAM_FINANCE_MANAGER': return 'finance';
      default: return 'default';
    }
  }, [lens.activeLens]);

  const stats = useMemo(() => {
    const projects: any[] = dashData?.projects || [];
    const totalProjects = projects.length;
    const activeProjects = totalProjects;
    const greenProjects = projects.filter((p: any) => p.rag === "Green").length;
    const amberProjects = projects.filter((p: any) => p.rag === "Amber").length;
    const redProjects = projects.filter((p: any) => p.rag === "Red").length;
    return { totalProjects, activeProjects, greenProjects, amberProjects, redProjects };
  }, [dashData]);

  const kpis = dashData?.kpis || {};
  const isLoading = dashLoading;
  const currentOverdue = overdueDrill === "ap" ? overdueData?.outflow : overdueDrill === "ar" ? overdueData?.inflow : null;
  const overdueRows = currentOverdue?.items || [];

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const displayName =
    (user as any)?.name ||
    (user?.username ? user.username.charAt(0).toUpperCase() + user.username.slice(1) : "User");

  const myPendingActions = useMemo(() => {
    if (!myWorkData) return 0;
    const items: any[] = myWorkData.items || myWorkData.tasks || [];
    return items.filter((t: any) => {
      if (!t.dueDate) return false;
      const isOverdue = new Date(t.dueDate) < new Date();
      const isOpen = !["complete", "done", "closed", "cancelled"].includes(
        String(t.status || "").toLowerCase()
      );
      return isOverdue && isOpen;
    }).length;
  }, [myWorkData]);

  const myOpenTasks = useMemo(() => {
    if (!myWorkData) return 0;
    const items: any[] = myWorkData.items || myWorkData.tasks || [];
    return items.filter((t: any) => {
      return !["complete", "done", "closed", "cancelled"].includes(
        String(t.status || "").toLowerCase()
      );
    }).length;
  }, [myWorkData]);

  const attentionItems = useMemo((): AttentionItem[] => {
    const items: AttentionItem[] = [];
    if (stats.redProjects > 0) items.push({ label: "Red RAG Projects", value: stats.redProjects, color: "text-red-600 bg-red-50 border-red-200", href: "/dashboard?rag=Red" });
    if (Number(kpis.projectsBehindPlan) > 0) items.push({ label: "Behind Plan", value: Number(kpis.projectsBehindPlan), color: "text-amber-700 bg-amber-50 border-amber-200", href: "/dashboard?behindPlanOnly=true" });
    if (Number(kpis.pendingApprovals) > 0) items.push({ label: "Pending Approvals", value: Number(kpis.pendingApprovals), color: "text-blue-700 bg-blue-50 border-blue-200", href: "/pm/approvals" });
    if (Number(kpis.openEngineeringBlockers) > 0) items.push({ label: "Eng. Blockers", value: Number(kpis.openEngineeringBlockers), color: "text-violet-700 bg-violet-50 border-violet-200", href: "/dashboard?engineeringBlockersOnly=true" });
    if (Number(kpis.openQualityWarnings) > 0) items.push({ label: "Quality Warnings", value: Number(kpis.openQualityWarnings), color: "text-orange-700 bg-orange-50 border-orange-200", href: "/dashboard?qualityIssuesOnly=true" });
    if (myPendingActions > 0) items.push({ label: "My Overdue Actions", value: myPendingActions, color: "text-rose-700 bg-rose-50 border-rose-200", href: "/my-work/tasks?overdue=1" });
    return items;
  }, [stats, kpis, myPendingActions]);

  /** Build action rows for each attention category so users can act inline */
  const attentionActionRows = useMemo((): Record<string, Array<{ project: string; issue: string; severity: string; owner: string; link: string }>> => {
    const actionRows: any[] = dashData?.actionCenter?.rows || [];
    const projects: any[] = dashData?.projects || [];
    const myItems: any[] = myWorkData?.items || myWorkData?.tasks || [];

    const map: Record<string, Array<{ project: string; issue: string; severity: string; owner: string; link: string }>> = {};

    // Red RAG Projects — from project data
    map["Red RAG Projects"] = projects
      .filter((p: any) => p.rag === "Red")
      .map((p: any) => ({ project: p.projectName, issue: `RAG: Red`, severity: "High", owner: p.pm || p.pd || "Unassigned", link: `/project/${encodeURIComponent(p.projectName)}` }));

    // Behind Plan — from action center queue
    map["Behind Plan"] = actionRows
      .filter((r: any) => r.queue === "Projects Behind Plan")
      .map((r: any) => ({ project: r.projectName, issue: r.issueTitle, severity: r.severity, owner: r.owner, link: r.link }));

    // Eng. Blockers — from action center queue
    map["Eng. Blockers"] = actionRows
      .filter((r: any) => r.queue === "Engineering Bottlenecks")
      .map((r: any) => ({ project: r.projectName, issue: r.issueTitle, severity: r.severity, owner: r.owner, link: r.link }));

    // Quality Warnings — from action center queue
    map["Quality Warnings"] = actionRows
      .filter((r: any) => r.queue === "Quality Issues")
      .map((r: any) => ({ project: r.projectName, issue: r.issueTitle, severity: r.severity, owner: r.owner, link: r.link }));

    // Pending Approvals — from action center queue
    map["Pending Approvals"] = actionRows
      .filter((r: any) => r.queue === "Pending Approvals / Decisions")
      .map((r: any) => ({ project: r.projectName, issue: r.issueTitle, severity: r.severity, owner: r.owner, link: r.link }));

    // My Overdue Actions — from my work data
    map["My Overdue Actions"] = myItems
      .filter((t: any) => {
        if (!t.dueDate) return false;
        const isOverdue = new Date(t.dueDate) < new Date();
        const isOpen = !["complete", "done", "closed", "cancelled"].includes(String(t.status || "").toLowerCase());
        return isOverdue && isOpen;
      })
      .slice(0, 10)
      .map((t: any) => ({ project: t.projectName || "—", issue: t.title || t.name || "Overdue task", severity: "High", owner: "You", link: "/my-work/tasks?overdue=1" }));

    return map;
  }, [dashData, myWorkData]);

  const visiblePriorities = companyPriorities?.slice(0, 3) || [];
  const hiddenPriorities = companyPriorities?.slice(3) || [];

  /** Render a single KPI metric card */
  function kpiCard(label: string, value: string | number, icon: React.ReactNode, opts?: { color?: string; scopeLabel?: string; onClick?: () => void; helpText?: React.ReactNode }) {
    const isClickable = Boolean(opts?.onClick);
    return (
      <Card key={label} className={`border-border/50 ${isClickable ? "cursor-pointer hover:border-primary/40 transition-colors" : ""}`} onClick={opts?.onClick}>
        <CardContent className="p-3.5">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
            {icon}
            <span className="text-[11px] uppercase tracking-wide">{label}</span>
            {opts?.helpText && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild onClick={(event) => event.stopPropagation()}>
                    <button className="inline-flex text-muted-foreground hover:text-foreground" aria-label={`How ${label} is calculated`}>
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm text-xs leading-snug">
                    {opts.helpText}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          {isLoading ? <Skeleton className="h-5 w-16" /> : (
            <p className={`text-base font-semibold font-mono ${opts?.color || "text-foreground"}`}>{value}</p>
          )}
          {opts?.scopeLabel && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{opts.scopeLabel}</p>}
        </CardContent>
      </Card>
    );
  }

  /** Render a KPI card with planned vs actual values */
  function kpiCardDual(label: string, planned: string | number, actual: string | number, icon: React.ReactNode, opts?: { color?: string }) {
    return (
      <Card key={label} className="border-border/50">
        <CardContent className="p-3.5">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
            {icon}
            <span className="text-[11px] uppercase tracking-wide">{label}</span>
          </div>
          {isLoading ? <Skeleton className="h-10 w-20" /> : (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground uppercase">Planned</span>
                <span className="text-sm font-semibold font-mono text-foreground">{planned}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground uppercase">Actual</span>
                <span className={`text-sm font-semibold font-mono ${opts?.color || "text-foreground"}`}>{actual}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  /** Render the workspace card with task counts and action links */
  function workspaceCard(links: Array<{ href: string; label: string; icon: React.ReactNode; variant?: "default" | "outline" }>) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-semibold font-mono text-foreground" data-testid="text-open-tasks">{myOpenTasks}</p>
              <p className="text-xs text-muted-foreground">open tasks</p>
            </div>
            {myPendingActions > 0 && (
              <div className="text-right">
                <p className="text-2xl font-semibold font-mono text-rose-600" data-testid="text-overdue-count">{myPendingActions}</p>
                <p className="text-xs text-rose-600">overdue</p>
              </div>
            )}
          </div>
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              <Button variant={link.variant || "outline"} className="w-full">
                {link.icon}
                {link.label}
                <ArrowRight className="w-4 h-4 ml-auto" />
              </Button>
            </Link>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <PageShell data-testid="home-page">
      {(dashIsError || prioritiesIsError || myWorkIsError) && (
        <div className="mb-4 space-y-2">
          {dashIsError && <QueryErrorBanner error={dashError} />}
          {prioritiesIsError && <QueryErrorBanner error={prioritiesError} />}
          {myWorkIsError && <QueryErrorBanner error={myWorkError} />}
        </div>
      )}

      {/* 1. Greeting */}
      <div className="mb-5">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground" data-testid="text-greeting">
          {greeting}, {displayName}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-role-badge">{roleLabel}</p>
      </div>

      {/* 2. Company Priorities — shown for all roles */}
      {(companyPriorities && companyPriorities.length > 0) && (
        <Collapsible open={prioritiesExpanded} onOpenChange={setPrioritiesExpanded}>
          <Card className="border-border/60 mb-5" data-testid="card-company-priorities">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <Flame className="w-4 h-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">Company Priorities</h2>
                  <Badge variant="secondary" className="text-[11px]">{companyPriorities.length} active</Badge>
                </div>
                <Link href="/priorities">
                  <span className="text-xs text-primary hover:underline font-medium cursor-pointer">View all</span>
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {visiblePriorities.map((priority: any, i: number) => (
                  <PriorityCard key={priority.id || i} priority={priority} index={i} />
                ))}
              </div>
              {hiddenPriorities.length > 0 && (
                <>
                  <CollapsibleContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                      {hiddenPriorities.map((priority: any, i: number) => (
                        <PriorityCard key={priority.id || (i + 3)} priority={priority} index={i + 3} />
                      ))}
                    </div>
                  </CollapsibleContent>
                  <CollapsibleTrigger asChild>
                    <button className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline font-medium mx-auto">
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${prioritiesExpanded ? "rotate-180" : ""}`} />
                      {prioritiesExpanded ? "Show less" : `Show ${hiddenPriorities.length} more`}
                    </button>
                  </CollapsibleTrigger>
                </>
              )}
            </CardContent>
          </Card>
        </Collapsible>
      )}
      {!companyPriorities && prioritiesLoading && (
        <div className="mb-5">
          <Skeleton className="h-5 w-48 mb-2.5" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </div>
      )}

      {/* 3. Attention Badges — Expandable with inline action items */}
      {!isLoading && attentionItems.filter((a) => a.value > 0).length > 0 && (
        <div className="mb-6" data-testid="section-attention-needed">
          <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <ListChecks className="w-3.5 h-3.5" />
            Attention Needed
          </h2>
          <div className="flex flex-wrap gap-2">
            {attentionItems.filter((a) => a.value > 0).map((a) => (
              <button
                key={a.label}
                onClick={() => setExpandedAttention(expandedAttention === a.label ? null : a.label)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium cursor-pointer transition-colors hover:opacity-80 ${a.color} ${expandedAttention === a.label ? "ring-2 ring-offset-1 ring-current" : ""}`}
              >
                <span className="font-mono font-bold text-base">{a.value}</span>
                {a.label}
                <ChevronDown className={`w-3.5 h-3.5 opacity-50 transition-transform ${expandedAttention === a.label ? "rotate-180" : ""}`} />
              </button>
            ))}
          </div>

          {/* Expanded action items panel */}
          {expandedAttention && attentionActionRows[expandedAttention]?.length > 0 && (
            <Card className="mt-3 border-border/50">
              <CardContent className="p-0">
                <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{expandedAttention}</span>
                  <Link href={attentionItems.find((a) => a.label === expandedAttention)?.href || "#"}>
                    <span className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer">
                      View all <ExternalLink className="w-3 h-3" />
                    </span>
                  </Link>
                </div>
                <div className="divide-y">
                  {attentionActionRows[expandedAttention].slice(0, 8).map((row, i) => (
                    <Link key={i} href={row.link}>
                      <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 cursor-pointer transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{row.project}</p>
                          <p className="text-xs text-muted-foreground truncate">{row.issue}</p>
                        </div>
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${row.severity === "Critical" ? "border-red-300 text-red-700" : row.severity === "High" ? "border-amber-300 text-amber-700" : "border-gray-300 text-gray-600"}`}>
                          {row.severity}
                        </Badge>
                        <span className="text-xs text-muted-foreground shrink-0 max-w-[100px] truncate">{row.owner}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                      </div>
                    </Link>
                  ))}
                  {attentionActionRows[expandedAttention].length > 8 && (
                    <Link href={attentionItems.find((a) => a.label === expandedAttention)?.href || "#"}>
                      <div className="px-4 py-2 text-xs text-center text-primary hover:underline cursor-pointer">
                        +{attentionActionRows[expandedAttention].length - 8} more — view all
                      </div>
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* 4. Tab Navigation — Home absorbs My Work */}
      <div className="flex items-center gap-1 border-b mb-5 overflow-x-auto">
        {HOME_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 5. Tab Content */}
      {activeTab === "actions" && (
        <div className="space-y-6">

          {/* === LEADERSHIP LAYOUT (COO, CEO) === */}
          {layoutGroup === 'leadership' && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                <div className="lg:col-span-3 space-y-5">
                  <div>
                    <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Portfolio Health</h2>
                    <div className="grid grid-cols-3 gap-2">
                      {kpiCard("Active Projects", stats.activeProjects, <FolderOpen className="w-4 h-4" />)}
                      {kpiCard("Red RAG", stats.redProjects, <AlertTriangle className="w-4 h-4" />, { color: stats.redProjects > 0 ? "text-red-600" : undefined })}
                      {kpiCard("Behind Plan", kpis.projectsBehindPlan ?? "\u2014", <Clock className="w-4 h-4" />, { color: Number(kpis.projectsBehindPlan) > 0 ? "text-amber-600" : undefined })}
                    </div>
                  </div>
                  <div>
                    <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Financial Snapshot</h2>
                    <div className="grid grid-cols-3 gap-2">
                      {kpiCardDual("Inflows (FY)", money(kpis.plannedRevenueFy), money(kpis.receivedInflowFy), <DollarSign className="w-4 h-4" />)}
                      {kpiCardDual("Gross Profit (FY)", money(kpis.grossProfitFy), money(kpis.receivedInflowFy - kpis.paidExpenditureFy), <TrendingUp className="w-4 h-4" />)}
                      {kpiCardDual("COS (FY)", money(kpis.plannedExpenditureFy), money(kpis.paidExpenditureFy), <DollarSign className="w-4 h-4" />)}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {kpiCard("AP Overdue (Outflows)", money(kpis.overdueOutflowFy), <AlertCircle className="w-4 h-4" />, {
                        color: kpis.overdueOutflowFy > 0 ? "text-red-600" : undefined,
                        onClick: () => setOverdueDrill("ap"),
                        helpText: (
                          <span>
                            Includes only AP invoices (with invoice number) still unpaid as of today. Overdue means Approved Date is before today and not settled (paidDateConfirmed, COS Realised, or black paid-date marker). Uses current financial year live data only; planned rows and settled rows are excluded.
                          </span>
                        ),
                      })}
                      {kpiCard("AR Overdue (Inflows)", money(kpis.overdueInflowFy), <AlertCircle className="w-4 h-4" />, {
                        color: kpis.overdueInflowFy > 0 ? "text-amber-600" : undefined,
                        onClick: () => setOverdueDrill("ar"),
                        helpText: (
                          <span>
                            Includes only AR invoices (with invoice number) still unreceived as of today. Overdue means Expected Payment Date is before today and not settled (paidDateConfirmed, inBankDate, or black paid-date marker). Uses current financial year live data only; planned rows and settled rows are excluded.
                          </span>
                        ),
                      })}
                    </div>
                  </div>
                </div>
                <div className="lg:col-span-2">
                  <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Your Workspace</h2>
                  {workspaceCard([
                    { href: "/my-work/tasks", label: "View My Tasks", icon: <ListChecks className="w-4 h-4 mr-2" /> },
                    ...(Number(kpis.pendingApprovals) > 0 ? [{ href: "/pm/approvals", label: `Approvals (${kpis.pendingApprovals})`, icon: <ClipboardCheck className="w-4 h-4 mr-2" /> }] : []),
                  ])}
                </div>
              </div>
            </>
          )}

          {/* === PORTFOLIO-MANAGER LAYOUT (Program Manager) === */}
          {layoutGroup === 'portfolio-manager' && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                <div className="lg:col-span-3 space-y-5">
                  <div>
                    <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Portfolio Overview</h2>
                    <div className="grid grid-cols-3 gap-2">
                      {kpiCard("Active Projects", stats.activeProjects, <FolderOpen className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                      {kpiCard("Red RAG", stats.redProjects, <AlertTriangle className="w-4 h-4" />, { color: stats.redProjects > 0 ? "text-red-600" : undefined, scopeLabel: "Portfolio" })}
                      {kpiCard("Behind Plan", kpis.projectsBehindPlan ?? "\u2014", <Clock className="w-4 h-4" />, { color: Number(kpis.projectsBehindPlan) > 0 ? "text-amber-600" : undefined, scopeLabel: "Portfolio" })}
                    </div>
                  </div>
                  <div>
                    <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Delivery Health</h2>
                    <div className="grid grid-cols-3 gap-2">
                      {kpiCard("Avg Progress", kpis.averageActualProgressPct != null ? `${Number(kpis.averageActualProgressPct).toFixed(0)}%` : "\u2014", <BarChart3 className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                      {kpiCard("Eng. Blockers", kpis.openEngineeringBlockers ?? "\u2014", <AlertTriangle className="w-4 h-4" />, { color: Number(kpis.openEngineeringBlockers) > 0 ? "text-violet-600" : undefined, scopeLabel: "Portfolio" })}
                      {kpiCard("Quality Warnings", kpis.openQualityWarnings ?? "\u2014", <ShieldCheck className="w-4 h-4" />, { color: Number(kpis.openQualityWarnings) > 0 ? "text-orange-600" : undefined, scopeLabel: "Portfolio" })}
                    </div>
                  </div>
                </div>
                <div className="lg:col-span-2">
                  <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Your Workspace</h2>
                  {workspaceCard([
                    { href: "/my-work/tasks", label: "View My Tasks", icon: <ListChecks className="w-4 h-4 mr-2" /> },
                    ...(Number(kpis.pendingApprovals) > 0 ? [{ href: "/pm/approvals", label: `Approvals (${kpis.pendingApprovals})`, icon: <ClipboardCheck className="w-4 h-4 mr-2" /> }] : []),
                  ])}
                </div>
              </div>
            </>
          )}

          {/* === DELIVERY LAYOUT (Project Manager, Construction Manager) — Workspace LEFT === */}
          {layoutGroup === 'delivery' && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                <div className="lg:col-span-2">
                  <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Your Workspace</h2>
                  {workspaceCard([
                    { href: "/my-work/tasks", label: "View My Tasks", icon: <ListChecks className="w-4 h-4 mr-2" /> },
                    ...(Number(kpis.pendingApprovals) > 0 ? [{ href: "/pm/approvals", label: `Approvals (${kpis.pendingApprovals})`, icon: <ClipboardCheck className="w-4 h-4 mr-2" /> }] : []),
                  ])}
                </div>
                <div className="lg:col-span-3 space-y-5">
                  <div>
                    <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Delivery Status</h2>
                    <div className="grid grid-cols-2 gap-2">
                      {kpiCard("Active Projects", stats.activeProjects, <FolderOpen className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                      {kpiCard("Red RAG", stats.redProjects, <AlertTriangle className="w-4 h-4" />, { color: stats.redProjects > 0 ? "text-red-600" : undefined, scopeLabel: "Portfolio" })}
                      {kpiCard("Behind Plan", kpis.projectsBehindPlan ?? "\u2014", <Clock className="w-4 h-4" />, { color: Number(kpis.projectsBehindPlan) > 0 ? "text-amber-600" : undefined, scopeLabel: "Portfolio" })}
                      {kpiCard("Avg Progress", kpis.averageActualProgressPct != null ? `${Number(kpis.averageActualProgressPct).toFixed(0)}%` : "\u2014", <BarChart3 className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* === SPECIALIST LAYOUT (Engineer, Quality Manager) — Workspace LEFT === */}
          {layoutGroup === 'specialist' && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                <div className="lg:col-span-2">
                  <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Your Workspace</h2>
                  {workspaceCard([
                    { href: "/my-work/tasks", label: "View My Tasks", icon: <ListChecks className="w-4 h-4 mr-2" /> },
                    { href: config.cockpitPath, label: config.cockpitLabel, icon: <LayoutDashboard className="w-4 h-4 mr-2" /> },
                  ])}
                </div>
                <div className="lg:col-span-3">
                  <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
                    {lens.activeLens === 'ENGINEER' ? 'Engineering Health' : 'Quality & Delivery'}
                  </h2>
                  <div className="grid grid-cols-2 gap-2">
                    {lens.activeLens === 'ENGINEER' ? (
                      <>
                        {kpiCard("Eng. Blockers", kpis.openEngineeringBlockers ?? "\u2014", <AlertTriangle className="w-4 h-4" />, { color: Number(kpis.openEngineeringBlockers) > 0 ? "text-violet-600" : undefined, scopeLabel: "Portfolio" })}
                        {kpiCard("Quality Warnings", kpis.openQualityWarnings ?? "\u2014", <ShieldCheck className="w-4 h-4" />, { color: Number(kpis.openQualityWarnings) > 0 ? "text-orange-600" : undefined, scopeLabel: "Portfolio" })}
                        {kpiCard("Avg Progress", kpis.averageActualProgressPct != null ? `${Number(kpis.averageActualProgressPct).toFixed(0)}%` : "\u2014", <BarChart3 className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                        {kpiCard("Behind Plan", kpis.projectsBehindPlan ?? "\u2014", <Clock className="w-4 h-4" />, { color: Number(kpis.projectsBehindPlan) > 0 ? "text-amber-600" : undefined, scopeLabel: "Portfolio" })}
                      </>
                    ) : (
                      <>
                        {kpiCard("Quality Warnings", kpis.openQualityWarnings ?? "\u2014", <ShieldCheck className="w-4 h-4" />, { color: Number(kpis.openQualityWarnings) > 0 ? "text-orange-600" : undefined, scopeLabel: "Portfolio" })}
                        {kpiCard("Pending Approvals", kpis.pendingApprovals ?? "\u2014", <CheckCircle2 className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                        {kpiCard("Avg Progress", kpis.averageActualProgressPct != null ? `${Number(kpis.averageActualProgressPct).toFixed(0)}%` : "\u2014", <BarChart3 className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                        {kpiCard("Behind Plan", kpis.projectsBehindPlan ?? "\u2014", <Clock className="w-4 h-4" />, { color: Number(kpis.projectsBehindPlan) > 0 ? "text-amber-600" : undefined, scopeLabel: "Portfolio" })}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* === FINANCE LAYOUT (Program Finance Manager, CFO) === */}
          {layoutGroup === 'finance' && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                <div className="lg:col-span-3 space-y-5">
                  <div>
                    <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Financial Overview</h2>
                    <div className="grid grid-cols-3 gap-2">
                      {kpiCard("Inflow (FY)", money(kpis.receivedInflowFy), <DollarSign className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                      {kpiCard("Gross Margin", kpis.grossMarginPctFy != null ? `${Number(kpis.grossMarginPctFy).toFixed(1)}%` : "\u2014", <TrendingUp className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                      {kpiCard("Gross Profit", money(kpis.grossProfitFy), <DollarSign className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                    </div>
                  </div>
                  <div>
                    <div className="grid grid-cols-3 gap-2">
                      {kpiCard("Open Expenditure", money(kpis.openExpenditureFy), <DollarSign className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                      {kpiCard("Paid Expenditure", money(kpis.paidExpenditureFy), <DollarSign className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                      {kpiCard("Overdue Inflow", money(kpis.overdueInflowFy), <AlertTriangle className="w-4 h-4" />, { color: Number(kpis.overdueInflowFy) > 0 ? "text-red-600" : undefined, scopeLabel: "Portfolio" })}
                    </div>
                  </div>
                </div>
                <div className="lg:col-span-2">
                  <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Your Workspace</h2>
                  {workspaceCard([
                    { href: "/my-work/tasks", label: "View My Tasks", icon: <ListChecks className="w-4 h-4 mr-2" /> },
                    ...(Number(kpis.pendingApprovals) > 0 ? [{ href: "/pm/approvals", label: `Approvals (${kpis.pendingApprovals})`, icon: <ClipboardCheck className="w-4 h-4 mr-2" /> }] : []),
                  ])}
                </div>
              </div>
            </>
          )}

          {/* === DEFAULT LAYOUT (all other roles) === */}
          {layoutGroup === 'default' && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                <div className="lg:col-span-2">
                  <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Your Workspace</h2>
                  {workspaceCard([
                    { href: "/my-work/tasks", label: "View My Tasks", icon: <ListChecks className="w-4 h-4 mr-2" /> },
                    { href: config.cockpitPath, label: config.cockpitLabel, icon: <LayoutDashboard className="w-4 h-4 mr-2" /> },
                  ])}
                </div>
                <div className="lg:col-span-3">
                  <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Key Metrics</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {getKpiCards(config, kpis, stats, isLoading)}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Navigate To — shown for all layouts */}
          <div>
            <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
              Navigate To
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {config.quickActions.map((action) => (
                <Link key={action.path} href={action.path}>
                  <Card className="border-border/50 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group">
                    <CardContent className="p-3.5 flex items-center gap-3">
                      <div className="text-muted-foreground group-hover:text-primary transition-colors">
                        {resolveIcon(action.iconKey)}
                      </div>
                      <span className="text-sm font-medium text-foreground">{action.label}</span>
                      <ArrowRight className="w-3.5 h-3.5 ml-auto text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "approvals" && (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <UnifiedApprovalsQueue />
        </Suspense>
      )}

      {activeTab === "calendar" && (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <MyWorkCalendarPage />
        </Suspense>
      )}

      {activeTab === "meetings" && (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <MyWorkMeetingsPage />
        </Suspense>
      )}

      {activeTab === "inbox" && (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <InboxPage />
        </Suspense>
      )}

      <Dialog open={overdueDrill !== null} onOpenChange={(open) => !open && setOverdueDrill(null)}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>{overdueDrill === "ap" ? "AP Overdue (Outflows) details" : "AR Overdue (Inflows) details"}</DialogTitle>
          </DialogHeader>
          {overdueLoading ? (
            <Skeleton className="h-52 w-full" />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <p className="text-muted-foreground">
                  Total outstanding: <span className="font-semibold text-foreground">{money(currentOverdue?.totalAmount || 0)}</span> · {currentOverdue?.count || 0} item(s)
                </p>
                <p className="text-muted-foreground">As of {overdueData?.asOfDate || "today"}</p>
              </div>
              {(currentOverdue?.missingDueDateCount || 0) > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  {currentOverdue?.missingDueDateCount} item(s) were excluded because due date is missing, so overdue cannot be calculated reliably.
                </p>
              )}
              {overdueRows.length === 0 ? (
                <div className="text-sm text-muted-foreground border rounded p-4">
                  {(currentOverdue?.missingDueDateCount || 0) > 0
                    ? "No overdue items found in usable records. Remaining records are missing due dates."
                    : "No overdue items found — all items are settled or not yet due."}
                </div>
              ) : (
                <div className="max-h-[60vh] overflow-auto border rounded">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-2">Project</th>
                        <th className="text-left px-2 py-2">{overdueDrill === "ap" ? "Supplier" : "Client"}</th>
                        <th className="text-left px-2 py-2">Invoice #</th>
                        <th className="text-left px-2 py-2">Invoice Date</th>
                        <th className="text-left px-2 py-2">Due Date</th>
                        <th className="text-right px-2 py-2">Outstanding</th>
                        <th className="text-right px-2 py-2">Days Overdue</th>
                        <th className="text-left px-2 py-2">Owner / PM</th>
                        <th className="text-left px-2 py-2">Status</th>
                        <th className="text-left px-2 py-2">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overdueRows.map((row: any) => (
                        <tr key={row.id} className="border-t">
                          <td className="px-2 py-1.5">{row.projectName || "—"}</td>
                          <td className="px-2 py-1.5">{row.counterparty || "—"}</td>
                          <td className="px-2 py-1.5">{row.invoiceNumber || "—"}</td>
                          <td className="px-2 py-1.5">{row.invoiceDate || "—"}</td>
                          <td className="px-2 py-1.5">{row.dueDate || "—"}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{money(row.outstandingAmount || 0)}</td>
                          <td className="px-2 py-1.5 text-right">{row.daysOverdue ?? 0}</td>
                          <td className="px-2 py-1.5">{row.owner || "—"}</td>
                          <td className="px-2 py-1.5">{row.status || "Open"}</td>
                          <td className="px-2 py-1.5">
                            {row.recordLink ? <Link href={row.recordLink}><span className="text-primary hover:underline cursor-pointer">Open</span></Link> : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function PriorityCard({ priority, index }: { priority: any; index: number }) {
  const healthDot = priority.effectiveHealth === "critical" ? "bg-red-500" : priority.effectiveHealth === "at_risk" ? "bg-amber-500" : "bg-emerald-500";
  const healthBorder = priority.effectiveHealth === "critical" ? "border-l-red-500" : priority.effectiveHealth === "at_risk" ? "border-l-amber-500" : "border-l-emerald-500";
  const sevBadge = priority.severity === "critical" ? "bg-red-100 text-red-700" : priority.severity === "important" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600";
  const sevLabel = priority.severity === "critical" ? "Critical" : priority.severity === "important" ? "High" : "Normal";
  const days = priority.dueDate ? Math.ceil((new Date(priority.dueDate).getTime() - Date.now()) / 86400000) : null;

  return (
    <Card className={`border-l-4 ${healthBorder} hover:shadow-sm transition-all`}>
      <CardContent className="p-3" data-testid={`text-priority-${index}`}>
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`w-2 h-2 rounded-full ${healthDot} shrink-0`} />
          <Link href={`/priorities/${priority.id}`}>
            <span className="text-sm text-foreground font-medium leading-snug truncate hover:text-primary hover:underline cursor-pointer">{priority.title}</span>
          </Link>
          <Badge variant="secondary" className={`text-[10px] ml-auto shrink-0 ${sevBadge}`}>{sevLabel}</Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
          {priority.owner && <span>{priority.owner.name}</span>}
          {priority.assignedTo && !priority.owner && <span>{priority.assignedTo}</span>}
          {days != null && (
            <span className={days <= 7 ? "text-red-600 font-medium" : days <= 14 ? "text-amber-600" : ""}>
              {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}
            </span>
          )}
          {priority.blockerCount > 0 && <span className="text-red-600 font-medium">{priority.blockerCount} blocker{priority.blockerCount > 1 ? "s" : ""}</span>}
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden mb-1">
          <div className={`h-full rounded-full ${priority.effectiveHealth === "critical" ? "bg-red-500" : priority.effectiveHealth === "at_risk" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(priority.effectiveProgress || 0, 100)}%` }} />
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{priority.effectiveProgress || 0}%{!priority.hasProjects && " (manual)"}</span>
          <span>{priority.hasProjects ? `${priority.projectCount} project${priority.projectCount !== 1 ? "s" : ""}` : "Standalone"}</span>
        </div>
      </CardContent>
    </Card>
  );
}
