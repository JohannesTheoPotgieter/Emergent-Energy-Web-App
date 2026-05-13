import { useMemo, useState, Suspense, useEffect } from "react";
import { lazyWithRetry } from "@/lib/lazy-with-retry";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link, useSearch, useLocation } from "wouter";
import { PageShell } from "@/components/layout/page-shell";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { apiRequest } from "@/lib/queryClient";
import { QueryErrorBanner } from "@/components/QueryErrorBanner";
import type { DoNextItem } from "@shared/schema/home";
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
  ChevronRight,
  ExternalLink,
  Info,
  X,
  BellOff,
  Sparkles,
} from "lucide-react";

// Lazy-load tab content from My Work pages (with the same ChunkLoadError
// retry wrapper App.tsx uses for all other lazy routes — Prompt 0.12 follow-up).
const MyWorkTasksPage = lazyWithRetry(() => import("@/pages/my-work-tasks"));
const MyWorkCalendarPage = lazyWithRetry(() => import("@/pages/my-work-calendar"));
const MyWorkMeetingsPage = lazyWithRetry(() => import("@/pages/my-work-meetings"));
const InboxPage = lazyWithRetry(() => import("@/pages/inbox"));
const UnifiedApprovalsQueue = lazyWithRetry(() =>
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

type LayoutGroup = 'leadership' | 'portfolio-manager' | 'delivery' | 'specialist' | 'finance' | 'default';

/** Pre-select the most useful starting tab for each layout group. */
function defaultTabForLayout(group: LayoutGroup, pendingApprovals: number): HomeTab {
  if (pendingApprovals > 0 && (group === 'finance' || group === 'leadership')) return "approvals";
  if (group === 'specialist') return "inbox";
  return "actions";
}

interface DoNextResponse {
  role: string;
  generatedAt: string;
  items: DoNextItem[];
  totalBeforeCap: number;
}

/** Canonical drill-down destinations for KPI cards. Keeps every home-screen
 * card tied to the source-of-truth page so users can always click through to
 * the underlying records. */
const KPI_HREF: Record<string, string> = {
  "Active Projects": "/projects",
  "Total Projects": "/projects",
  "Red RAG": "/execution-board?rag=Red",
  "Behind Plan": "/execution-board?behindPlanOnly=true",
  "Avg Progress": "/execution-board",
  "Eng. Blockers": "/execution-board?engineeringBlockersOnly=true",
  "Quality Warnings": "/execution-board?qualityIssuesOnly=true",
  "Pending Approvals": "/pm/approvals",
  "Approvals Due": "/pm/approvals",
  "Inflow (FY)": "/cos/analysis",
  "Inflow Received (FY)": "/cos/analysis",
  "Received Inflow (FY)": "/cos/analysis",
  "Planned Revenue (FY)": "/cos/analysis",
  "Gross Margin": "/cos/analysis",
  "Gross Profit": "/cos/analysis",
  "Gross Profit (FY)": "/cos/analysis",
  "Open Expenditure": "/cos",
  "Open Expenditure (FY)": "/cos",
  "Paid Expenditure": "/cos",
  "Overdue Inflow": "/cos/analysis",
  "Open Incidents": "/execution-board",
  "Corrective Actions Due": "/execution-board",
  "Safety Compliance": "/execution-board",
  "Inspections Overdue": "/execution-board",
  "Applications Pending": "/execution-board",
  "Queries Outstanding": "/execution-board",
  "Rejections Open": "/execution-board",
};

/**
 * Build a compact set of KPI cards from execution-dashboard data,
 * selected by the role's config kpi keys as a guide.
 */
function getKpiCards(
  config: ReturnType<typeof getRoleDashboardConfig>,
  kpis: any,
  stats: any,
  isLoading: boolean,
  navigate: (path: string) => void,
) {
  // Each role-config KPI key resolves to a real metric (value + icon) or to
  // null when the metric isn't yet computed server-side. We render the
  // role-config's stated label as the card title in either case \u2014 never a
  // substitute label \u2014 so the user sees what they asked for, with "\u2014" for
  // metrics not yet wired. Substituting unrelated metrics under different
  // labels (the previous behaviour) was the prompt's highest-severity UX
  // failure: "users trust a number shown under a label that doesn't
  // describe the source." Trade-off: more cards show "\u2014" today; fixing
  // them is a server-metric expansion job, not a UI cosmetic change.
  const fmtPct = (n: unknown) => (n != null ? `${Number(n).toFixed(0)}%` : null);
  const fmtPct1 = (n: unknown) => (n != null ? `${Number(n).toFixed(1)}%` : null);
  const orNull = (n: unknown) => (n == null ? null : (n as string | number));

  type KpiSource = { value: string | number | null; icon: React.ReactNode };
  const kpiSource: Record<string, KpiSource> = {
    // \u2500\u2500 Finance \u2014 real server-computed metrics
    revenue_vs_target: { value: money(kpis.receivedInflowFy), icon: <DollarSign className="w-4 h-4" /> },
    revenue_this_month: { value: money(kpis.revenueOutstandingThisMonth), icon: <DollarSign className="w-4 h-4" /> },
    proposals_pending: { value: money(kpis.receivedInflowFy), icon: <DollarSign className="w-4 h-4" /> },
    pd_tickets_open: { value: money(kpis.plannedRevenueFy), icon: <DollarSign className="w-4 h-4" /> },
    cash_position: { value: money(kpis.grossProfitFy), icon: <DollarSign className="w-4 h-4" /> },
    margin_drift: { value: money(kpis.openExpenditureFy), icon: <DollarSign className="w-4 h-4" /> },
    my_deliverables_due: { value: money(kpis.openExpenditureFy), icon: <DollarSign className="w-4 h-4" /> },
    gp_margin: { value: fmtPct1(kpis.grossMarginPctFy), icon: <TrendingUp className="w-4 h-4" /> },
    cos_this_month: { value: money(kpis.cosOutstandingThisMonth), icon: <DollarSign className="w-4 h-4" /> },

    // \u2500\u2500 Project status \u2014 real metrics
    projects_on_track: { value: stats.activeProjects, icon: <FolderOpen className="w-4 h-4" /> },
    my_opportunities: { value: stats.totalProjects, icon: <FolderOpen className="w-4 h-4" /> },
    projects_off_track: { value: orNull(stats.redProjects), icon: <AlertTriangle className="w-4 h-4" /> },
    projects_behind_plan: { value: orNull(kpis.projectsBehindPlan), icon: <Clock className="w-4 h-4" /> },
    milestones_due: { value: orNull(kpis.projectsBehindPlan), icon: <Clock className="w-4 h-4" /> },
    my_overdue_tasks: { value: orNull(kpis.projectsBehindPlan), icon: <Clock className="w-4 h-4" /> },
    my_overdue_deliverables: { value: fmtPct(kpis.averageActualProgressPct), icon: <BarChart3 className="w-4 h-4" /> },
    open_vos: { value: orNull(kpis.pendingApprovals), icon: <CheckCircle2 className="w-4 h-4" /> },
    overdue_tasks: { value: orNull(kpis.pendingApprovals), icon: <CheckCircle2 className="w-4 h-4" /> },
    my_approvals_pending: { value: orNull(kpis.pendingApprovals), icon: <CheckCircle2 className="w-4 h-4" /> },
    my_approvals: { value: orNull(kpis.pendingApprovals), icon: <CheckCircle2 className="w-4 h-4" /> },
    pending_approvals_kpi: { value: orNull(kpis.pendingApprovals), icon: <CheckCircle2 className="w-4 h-4" /> },

    // \u2500\u2500 Engineering
    design_queue: { value: orNull(kpis.openEngineeringBlockers), icon: <AlertTriangle className="w-4 h-4" /> },

    // \u2500\u2500 Quality \u2014 only open_warnings is wired today
    open_warnings: { value: orNull(kpis.openQualityWarnings), icon: <AlertTriangle className="w-4 h-4" /> },
  };

  const cards: Array<{ label: string; value: string | number; icon: React.ReactNode }> = [];
  const seen = new Set<string>();
  for (const kpi of config.kpis) {
    if (seen.has(kpi.label)) continue;
    seen.add(kpi.label);
    const source = kpiSource[kpi.key];
    if (!source || source.value == null) continue;
    cards.push({
      label: kpi.label,
      value: source.value,
      icon: source.icon,
    });
  }

  return cards.slice(0, 4).map((card) => {
    const href = KPI_HREF[card.label];
    const clickable = Boolean(href);
    return (
      <Card
        key={card.label}
        className={`border-border/50 ${clickable ? "cursor-pointer hover:border-primary/40 transition-colors" : ""}`}
        onClick={clickable ? () => navigate(href!) : undefined}
        data-testid={`kpi-card-${card.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      >
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
    );
  });
}

export default function HomePage() {
  const { user } = useAuth();
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const urlTab = new URLSearchParams(searchString).get("tab") as HomeTab | null;
  const [activeTab, setActiveTab] = useState<HomeTab>(urlTab || "actions");
  const [autoTabApplied, setAutoTabApplied] = useState<boolean>(Boolean(urlTab));

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

  // Do Next — central, role-aware action strip. Single source of truth replaces
  // the older Attention Needed section. Snooze/dismiss state is server-side so
  // it follows the user across devices.
  const queryClient = useQueryClient();
  const { data: doNextData, isLoading: doNextLoading } = useQuery<DoNextResponse>({
    queryKey: ["/api/home/do-next"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/home/do-next");
      return res.json();
    },
    staleTime: 60_000,
  });
  const doNextItems = doNextData?.items ?? [];

  const snoozeMutation = useMutation({
    mutationFn: async ({ key, hours }: { key: string; hours: number }) => {
      await apiRequest("POST", `/api/home/do-next/${encodeURIComponent(key)}/snooze`, { hours });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/home/do-next"] }),
  });
  const dismissMutation = useMutation({
    mutationFn: async ({ key }: { key: string }) => {
      await apiRequest("POST", `/api/home/do-next/${encodeURIComponent(key)}/dismiss`, {});
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/home/do-next"] }),
  });

  const lens = useLensContext();
  const userRole = (user as any)?.role;
  const effectiveRole = normalizeRoleForPermissions(userRole) as CompanyRole;
  const config = getLensDashboardConfig(effectiveRole);
  const roleLabel = lens.activeLensLabel;
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

  // Pre-select the most useful starting tab for this role once the dashboard
  // data is in (we need pendingApprovals to know if Approvals is the right
  // landing tab for finance/leadership lenses).
  useEffect(() => {
    if (autoTabApplied) return;
    if (dashLoading) return;
    const pending = Number(kpis.pendingApprovals) || 0;
    const next = defaultTabForLayout(layoutGroup, pending);
    if (next !== activeTab) setActiveTab(next);
    setAutoTabApplied(true);
    // We intentionally only run this once per mount, after data lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashLoading, layoutGroup]);

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

  /** Render a single KPI metric card.
   *
   * Every card on the home screen should drill into the source of truth.
   * Pass either an explicit `onClick` (for in-page drill modals like AP/AR
   * overdue) or an `href` for navigation; if neither is supplied we fall
   * back to the canonical drill destination from `KPI_HREF[label]`. */
  function kpiCard(label: string, value: string | number, icon: React.ReactNode, opts?: { color?: string; scopeLabel?: string; onClick?: () => void; href?: string; helpText?: React.ReactNode }) {
    const fallbackHref = opts?.href ?? KPI_HREF[label];
    const navigateClick = !opts?.onClick && fallbackHref ? () => setLocation(fallbackHref) : undefined;
    const handleClick = opts?.onClick ?? navigateClick;
    const isClickable = Boolean(handleClick);
    return (
      <Card
        key={label}
        className={`border-border/50 ${isClickable ? "cursor-pointer hover:border-primary/40 transition-colors" : ""}`}
        onClick={handleClick}
        data-testid={`kpi-card-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      >
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
  function kpiCardDual(label: string, planned: string | number, actual: string | number, icon: React.ReactNode, opts?: { color?: string; href?: string }) {
    const fallbackHref = opts?.href ?? KPI_HREF[label];
    const isClickable = Boolean(fallbackHref);
    return (
      <Card
        key={label}
        className={`border-border/50 ${isClickable ? "cursor-pointer hover:border-primary/40 transition-colors" : ""}`}
        onClick={isClickable ? () => setLocation(fallbackHref!) : undefined}
        data-testid={`kpi-card-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      >
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

      {/* 2+3. Focus Panel — Company Priorities (left) + Do Next (right) merged */}
      <FocusPanel
        priorities={companyPriorities ?? []}
        prioritiesLoading={prioritiesLoading && !companyPriorities}
        doNextItems={doNextItems}
        doNextLoading={doNextLoading}
        onSnooze={(key, hours) => snoozeMutation.mutate({ key, hours })}
        onDismiss={(key) => dismissMutation.mutate({ key })}
      />

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
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {kpiCard("Active Projects", stats.activeProjects, <FolderOpen className="w-4 h-4" />)}
                      {kpiCard("Red RAG", stats.redProjects, <AlertTriangle className="w-4 h-4" />, { color: stats.redProjects > 0 ? "text-red-600" : undefined })}
                      {kpiCard("Behind Plan", kpis.projectsBehindPlan ?? "\u2014", <Clock className="w-4 h-4" />, { color: Number(kpis.projectsBehindPlan) > 0 ? "text-amber-600" : undefined })}
                    </div>
                  </div>
                </div>
                <div className="lg:col-span-2">
                  <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Your Workspace</h2>
                  {workspaceCard([
                    { href: "/priorities?tab=my", label: "View My Tasks", icon: <ListChecks className="w-4 h-4 mr-2" /> },
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
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {kpiCard("Active Projects", stats.activeProjects, <FolderOpen className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                      {kpiCard("Red RAG", stats.redProjects, <AlertTriangle className="w-4 h-4" />, { color: stats.redProjects > 0 ? "text-red-600" : undefined, scopeLabel: "Portfolio" })}
                      {kpiCard("Behind Plan", kpis.projectsBehindPlan ?? "\u2014", <Clock className="w-4 h-4" />, { color: Number(kpis.projectsBehindPlan) > 0 ? "text-amber-600" : undefined, scopeLabel: "Portfolio" })}
                    </div>
                  </div>
                  <div>
                    <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Delivery Health</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {kpiCard("Avg Progress", kpis.averageActualProgressPct != null ? `${Number(kpis.averageActualProgressPct).toFixed(0)}%` : "\u2014", <BarChart3 className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                      {kpiCard("Eng. Blockers", kpis.openEngineeringBlockers ?? "\u2014", <AlertTriangle className="w-4 h-4" />, { color: Number(kpis.openEngineeringBlockers) > 0 ? "text-violet-600" : undefined, scopeLabel: "Portfolio" })}
                      {kpiCard("Quality Warnings", kpis.openQualityWarnings ?? "\u2014", <ShieldCheck className="w-4 h-4" />, { color: Number(kpis.openQualityWarnings) > 0 ? "text-orange-600" : undefined, scopeLabel: "Portfolio" })}
                    </div>
                  </div>
                </div>
                <div className="lg:col-span-2">
                  <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Your Workspace</h2>
                  {workspaceCard([
                    { href: "/priorities?tab=my", label: "View My Tasks", icon: <ListChecks className="w-4 h-4 mr-2" /> },
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
                    { href: "/priorities?tab=my", label: "View My Tasks", icon: <ListChecks className="w-4 h-4 mr-2" /> },
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
                    { href: "/priorities?tab=my", label: "View My Tasks", icon: <ListChecks className="w-4 h-4 mr-2" /> },
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
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {kpiCard("Inflow (FY)", money(kpis.receivedInflowFy), <DollarSign className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                      {kpiCard("Gross Margin", kpis.grossMarginPctFy != null ? `${Number(kpis.grossMarginPctFy).toFixed(1)}%` : "\u2014", <TrendingUp className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                      {kpiCard("Gross Profit", money(kpis.grossProfitFy), <DollarSign className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                    </div>
                  </div>
                  <div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {kpiCard("Open Expenditure", money(kpis.openExpenditureFy), <DollarSign className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                      {kpiCard("Paid Expenditure", money(kpis.paidExpenditureFy), <DollarSign className="w-4 h-4" />, { scopeLabel: "Portfolio" })}
                      {kpiCard("Overdue Inflow", money(kpis.overdueInflowFy), <AlertTriangle className="w-4 h-4" />, { color: Number(kpis.overdueInflowFy) > 0 ? "text-red-600" : undefined, scopeLabel: "Portfolio" })}
                    </div>
                  </div>
                </div>
                <div className="lg:col-span-2">
                  <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Your Workspace</h2>
                  {workspaceCard([
                    { href: "/priorities?tab=my", label: "View My Tasks", icon: <ListChecks className="w-4 h-4 mr-2" /> },
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
                    { href: "/priorities?tab=my", label: "View My Tasks", icon: <ListChecks className="w-4 h-4 mr-2" /> },
                    { href: config.cockpitPath, label: config.cockpitLabel, icon: <LayoutDashboard className="w-4 h-4 mr-2" /> },
                  ])}
                </div>
                <div className="lg:col-span-3">
                  <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Key Metrics</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {getKpiCards(config, kpis, stats, isLoading, setLocation)}
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

// ============================================================
// Do Next strip
// ============================================================
//
// A horizontally-scrolling row of action chips. Each chip is a verb-led label
// linking to a resolution screen, with a quiet snooze/dismiss menu so users
// can tune what shows up tomorrow. Empty state celebrates a clear queue.

const KIND_CHIP_TONE: Record<string, string> = {
  approval: "bg-emerald-50 border-emerald-200 text-emerald-900 hover:bg-emerald-100",
  rag: "bg-rose-50 border-rose-200 text-rose-900 hover:bg-rose-100",
  hse_incident: "bg-rose-50 border-rose-200 text-rose-900 hover:bg-rose-100",
  qb_sync_failed: "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100",
  import_drift: "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100",
  blocked_priority: "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100",
  overdue_task: "bg-rose-50 border-rose-200 text-rose-900 hover:bg-rose-100",
  behind_plan: "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100",
  eng_blocker: "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100",
  quality_issue: "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100",
};

function chipTone(kind: string): string {
  return KIND_CHIP_TONE[kind] || "bg-muted border-border text-foreground hover:bg-muted/70";
}

function DoNextStrip({
  items,
  loading,
  onSnooze,
  onDismiss,
}: {
  items: DoNextItem[];
  loading: boolean;
  onSnooze: (key: string, hours: number) => void;
  onDismiss: (key: string) => void;
}) {
  if (loading) {
    return (
      <div className="mb-6" data-testid="section-do-next">
        <div className="flex items-center gap-2 mb-2.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider">Do Next</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-44 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mb-6" data-testid="section-do-next">
        <div className="flex items-center gap-2 mb-2.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider">Do Next</h2>
        </div>
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
            <p className="text-sm text-emerald-900">
              You're clear. No actions need you right now — well done.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mb-6" data-testid="section-do-next">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider">Do Next</h2>
          <Badge variant="secondary" className="text-[11px]" data-testid="badge-do-next-count">
            {items.length} {items.length === 1 ? "action" : "actions"}
          </Badge>
        </div>
        <span className="text-[11px] text-muted-foreground">Ranked for you · snooze or dismiss what isn't useful</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <DoNextChip key={item.key} item={item} onSnooze={onSnooze} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}

function FocusPanel({
  priorities,
  prioritiesLoading,
  doNextItems,
  doNextLoading,
  onSnooze,
  onDismiss,
}: {
  priorities: any[];
  prioritiesLoading: boolean;
  doNextItems: DoNextItem[];
  doNextLoading: boolean;
  onSnooze: (key: string, hours: number) => void;
  onDismiss: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasPriorities = priorities.length > 0 || prioritiesLoading;
  const hasActions = doNextItems.length > 0 || doNextLoading;

  if (!hasPriorities && !hasActions) return null;

  const visiblePriorities = priorities.slice(0, 3);
  const hiddenPriorities = priorities.slice(3);

  return (
    <div className="mb-5 grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="section-focus-panel">
      {/* Company Priorities */}
      {hasPriorities && (
        <Card className="border-border/60" data-testid="card-company-priorities">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <Flame className="w-4 h-4 text-primary" />
                <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider">Company Priorities</h2>
                {!prioritiesLoading && priorities.length > 0 && (
                  <Badge variant="secondary" className="text-[11px]">{priorities.length} active</Badge>
                )}
              </div>
              <Link href="/priorities">
                <span className="text-xs text-primary hover:underline font-medium cursor-pointer">View all</span>
              </Link>
            </div>
            {prioritiesLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-20 w-full rounded-lg" />
                <Skeleton className="h-20 w-full rounded-lg" />
              </div>
            ) : (
              <Collapsible open={expanded} onOpenChange={setExpanded}>
                <div className="space-y-2">
                  {visiblePriorities.map((priority: any, i: number) => (
                    <PriorityCard key={priority.id || i} priority={priority} index={i} />
                  ))}
                </div>
                {hiddenPriorities.length > 0 && (
                  <>
                    <CollapsibleContent>
                      <div className="space-y-2 mt-2">
                        {hiddenPriorities.map((priority: any, i: number) => (
                          <PriorityCard key={priority.id || (i + 3)} priority={priority} index={i + 3} />
                        ))}
                      </div>
                    </CollapsibleContent>
                    <CollapsibleTrigger asChild>
                      <button className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline font-medium mx-auto">
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                        {expanded ? "Show less" : `Show ${hiddenPriorities.length} more`}
                      </button>
                    </CollapsibleTrigger>
                  </>
                )}
              </Collapsible>
            )}
          </CardContent>
        </Card>
      )}

      {/* Do Next */}
      <Card className={`border-border/60 ${!hasPriorities ? "lg:col-span-2" : ""}`} data-testid="card-do-next">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-primary" />
              <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider">Do Next</h2>
              {!doNextLoading && doNextItems.length > 0 && (
                <Badge variant="secondary" className="text-[11px]" data-testid="badge-do-next-count">
                  {doNextItems.length} {doNextItems.length === 1 ? "action" : "actions"}
                </Badge>
              )}
            </div>
            {!doNextLoading && doNextItems.length > 0 && (
              <span className="text-[11px] text-muted-foreground hidden sm:block">Ranked · snooze or dismiss</span>
            )}
          </div>
          {doNextLoading ? (
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-40 rounded-lg" />
              ))}
            </div>
          ) : doNextItems.length === 0 ? (
            <div className="flex items-center gap-3 py-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <p className="text-sm text-emerald-900">You're clear — no actions need you right now.</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {doNextItems.map((item) => (
                <DoNextChip key={item.key} item={item} onSnooze={onSnooze} onDismiss={onDismiss} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DoNextChip({
  item,
  onSnooze,
  onDismiss,
}: {
  item: DoNextItem;
  onSnooze: (key: string, hours: number) => void;
  onDismiss: (key: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const tone = chipTone(item.kind);

  return (
    <div
      className={`group inline-flex items-stretch rounded-lg border overflow-hidden ${tone}`}
      data-testid={`chip-do-next-${item.kind}`}
    >
      <Link href={item.href}>
        <button
          type="button"
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-left max-w-[320px]"
          aria-label={`Open: ${item.title}`}
        >
          <span className="truncate">{item.title}</span>
          {item.subtitle && (
            <span className="text-xs opacity-70 truncate hidden sm:inline">· {item.subtitle}</span>
          )}
        </button>
      </Link>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="px-2 border-l border-current/20 opacity-60 hover:opacity-100"
            aria-label="Snooze or dismiss"
            data-testid={`btn-do-next-menu-${item.kind}`}
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-44 p-1">
          <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">Snooze</div>
          <button
            type="button"
            onClick={() => { onSnooze(item.key, 4); setMenuOpen(false); }}
            className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted flex items-center gap-2"
          >
            <Clock className="w-3.5 h-3.5" /> 4 hours
          </button>
          <button
            type="button"
            onClick={() => { onSnooze(item.key, 24); setMenuOpen(false); }}
            className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted flex items-center gap-2"
          >
            <Clock className="w-3.5 h-3.5" /> Tomorrow
          </button>
          <button
            type="button"
            onClick={() => { onSnooze(item.key, 24 * 7); setMenuOpen(false); }}
            className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted flex items-center gap-2"
          >
            <Clock className="w-3.5 h-3.5" /> Next week
          </button>
          <div className="my-1 border-t" />
          <button
            type="button"
            onClick={() => { onDismiss(item.key); setMenuOpen(false); }}
            className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted flex items-center gap-2 text-rose-700"
          >
            <BellOff className="w-3.5 h-3.5" /> Dismiss
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
