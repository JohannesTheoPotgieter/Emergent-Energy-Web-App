import { useMemo, useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link, useSearch } from "wouter";
import { PageShell } from "@/components/layout/page-shell";
import { AttentionBadges, type AttentionItem } from "@/components/dashboard/AttentionBadges";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { apiRequest } from "@/lib/queryClient";
import { QueryErrorBanner } from "@/components/QueryErrorBanner";
import { getRoleDashboardConfig } from "@/config/role-dashboard-config";
import { COMPANY_ROLE_LABELS, normalizeRoleForPermissions } from "@shared/schema/users";
import type { CompanyRole } from "@shared/schema/users";
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
} from "lucide-react";

// Lazy-load tab content from My Work pages
const MyWorkTasksPage = lazy(() => import("@/pages/my-work-tasks"));
const MyWorkCalendarPage = lazy(() => import("@/pages/my-work-calendar"));
const MyWorkMeetingsPage = lazy(() => import("@/pages/my-work-meetings"));
const InboxPage = lazy(() => import("@/pages/inbox"));

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

  const userRole = (user as any)?.role;
  const effectiveRole = normalizeRoleForPermissions(userRole) as CompanyRole;
  const config = getRoleDashboardConfig(effectiveRole);
  const roleLabel = COMPANY_ROLE_LABELS[effectiveRole] || "Team Member";

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
    if (stats.redProjects > 0) items.push({ label: "Red RAG Projects", value: stats.redProjects, color: "text-red-600 bg-red-50 border-red-200", href: "/projects" });
    if (Number(kpis.projectsBehindPlan) > 0) items.push({ label: "Behind Plan", value: Number(kpis.projectsBehindPlan), color: "text-amber-700 bg-amber-50 border-amber-200", href: "/gates" });
    if (Number(kpis.pendingApprovals) > 0) items.push({ label: "Pending Approvals", value: Number(kpis.pendingApprovals), color: "text-blue-700 bg-blue-50 border-blue-200", href: "/pm/approvals" });
    if (Number(kpis.openEngineeringBlockers) > 0) items.push({ label: "Eng. Blockers", value: Number(kpis.openEngineeringBlockers), color: "text-violet-700 bg-violet-50 border-violet-200", href: "/gates/blocked" });
    if (Number(kpis.openQualityWarnings) > 0) items.push({ label: "Quality Warnings", value: Number(kpis.openQualityWarnings), color: "text-orange-700 bg-orange-50 border-orange-200", href: "/gates" });
    if (myPendingActions > 0) items.push({ label: "My Overdue Actions", value: myPendingActions, color: "text-rose-700 bg-rose-50 border-rose-200", href: "/my-work/tasks" });
    return items;
  }, [stats, kpis, myPendingActions]);

  const visiblePriorities = companyPriorities?.slice(0, 3) || [];
  const hiddenPriorities = companyPriorities?.slice(3) || [];

  return (
    <PageShell data-testid="home-page">
      {(dashIsError || prioritiesIsError || myWorkIsError) && (
        <div className="mb-4 space-y-2">
          {dashIsError && <QueryErrorBanner error={dashError} />}
          {prioritiesIsError && <QueryErrorBanner error={prioritiesError} />}
          {myWorkIsError && <QueryErrorBanner error={myWorkError} />}
        </div>
      )}

      {/* 1. Status Strip — personal summary */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground" data-testid="text-greeting">
            {greeting}, {displayName}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-role-badge">{roleLabel}</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {myPendingActions > 0 && (
            <div className="flex items-center gap-1.5 text-rose-600 font-medium">
              <AlertTriangle className="h-4 w-4" />
              <span>{myPendingActions} overdue</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <ListChecks className="h-4 w-4" />
            <span>{myOpenTasks} open tasks</span>
          </div>
          {Number(kpis.pendingApprovals) > 0 && (
            <div className="flex items-center gap-1.5 text-blue-600">
              <ClipboardCheck className="h-4 w-4" />
              <span>{kpis.pendingApprovals} approvals</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Attention Badges */}
      {!isLoading && (
        <AttentionBadges items={attentionItems} threshold={0} />
      )}

      {/* 3. Tab Navigation — Home absorbs My Work */}
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

      {/* 4. Tab Content */}
      {activeTab === "actions" && (
        <div className="space-y-6">
          {/* Quick Actions + Workspace */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            <div className="lg:col-span-3">
              <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
                Quick Actions
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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

            <div className="lg:col-span-2">
              <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
                Your Workspace
              </h2>
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
                  <Link href="/gates">
                    <Button className="w-full" data-testid="link-gates">
                      <LayoutDashboard className="w-4 h-4 mr-2" />
                      Open Gates
                    </Button>
                  </Link>
                  <Link href={config.cockpitPath}>
                    <Button variant="outline" className="w-full" data-testid="link-cockpit">
                      <LayoutDashboard className="w-4 h-4 mr-2" />
                      {config.cockpitLabel}
                      <ArrowRight className="w-4 h-4 ml-auto" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Key Metrics */}
          <div>
            <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
              Key Metrics
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {getKpiCards(config, kpis, stats, isLoading)}
            </div>
          </div>

          {/* Company Priorities */}
          {(companyPriorities && companyPriorities.length > 0) && (
            <Collapsible open={prioritiesExpanded} onOpenChange={setPrioritiesExpanded}>
              <Card className="border-border/60" data-testid="card-company-priorities">
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
            <div>
              <Skeleton className="h-5 w-48 mb-2.5" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Skeleton className="h-24 w-full rounded-lg" />
                <Skeleton className="h-24 w-full rounded-lg" />
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "approvals" && (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <MyWorkTasksPage />
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
