import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { PageShell } from "@/components/layout/page-shell";
import { AttentionBadges, type AttentionItem } from "@/components/dashboard/AttentionBadges";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { apiRequest } from "@/lib/queryClient";
import { QueryErrorBanner } from "@/components/QueryErrorBanner";
import { getVariant } from "@/lib/ab-test";
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
} from "lucide-react";

const money = (n: number | null | undefined) =>
  `R ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

type RoleCategory = "executive" | "finance" | "project" | "engineering" | "quality" | "business";

function getRoleCategory(role: string | undefined): RoleCategory {
  if (!role) return "executive";
  const r = role.toUpperCase();
  if (["COO_ADMIN", "CEO_ADMIN", "CCO"].includes(r)) return "executive";
  if (["CFO", "ACCOUNTANT", "PROGRAM_FINANCE_MANAGER"].includes(r)) return "finance";
  if (["PROGRAM_MANAGER", "PROJECT_MANAGER_SITE", "CONSTRUCTION_MANAGER"].includes(r)) return "project";
  if (["ENGINEER", "ENGINEERING_MANAGER"].includes(r)) return "engineering";
  if (["QUALITY_MANAGER"].includes(r)) return "quality";
  if (["PROJECT_DEVELOPER", "KEY_ACCOUNTS_MANAGER"].includes(r)) return "business";
  return "executive";
}

function getRoleLabel(role: string | undefined): string {
  if (!role) return "Team Member";
  const map: Record<string, string> = {
    COO_ADMIN: "Chief Operating Officer",
    CEO_ADMIN: "Chief Executive Officer",
    CCO: "Chief Commercial Officer",
    CFO: "Chief Financial Officer",
    ACCOUNTANT: "Accountant",
    PROGRAM_FINANCE_MANAGER: "Finance Manager",
    PROGRAM_MANAGER: "Program Manager",
    PROJECT_MANAGER_SITE: "Project Manager",
    CONSTRUCTION_MANAGER: "Construction Manager",
    ENGINEER: "Engineer",
    ENGINEERING_MANAGER: "Engineering Manager",
    QUALITY_MANAGER: "Quality Manager",
    PROJECT_DEVELOPER: "Project Developer",
    KEY_ACCOUNTS_MANAGER: "Key Accounts Manager",
  };
  return map[role.toUpperCase()] || "Team Member";
}

function StatCard({
  value,
  label,
  color,
  loading,
  testId,
}: {
  value: string | number;
  label: string;
  color?: string;
  loading: boolean;
  testId: string;
}) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-3.5 text-center">
        {loading ? (
          <Skeleton className="h-7 w-10 mx-auto" />
        ) : (
          <p className={`text-xl font-semibold font-mono ${color || "text-foreground"}`} data-testid={testId}>
            {value}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground mt-1 uppercase tracking-wide">{label}</p>
      </CardContent>
    </Card>
  );
}

function KpiCard({
  icon,
  label,
  value,
  loading,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading: boolean;
  testId: string;
}) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-3.5">
        <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
          {icon}
          <span className="text-[11px] uppercase tracking-wide">{label}</span>
        </div>
        {loading ? (
          <Skeleton className="h-5 w-20" />
        ) : (
          <p className="text-base font-semibold font-mono text-foreground" data-testid={testId}>
            {value}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function getCompactQuickLinks(category: RoleCategory): { href: string; label: string; icon: React.ReactNode }[] {
  switch (category) {
    case "executive":
      return [
        { href: "/execution-board", label: "Execution Dashboard", icon: <Briefcase className="w-4 h-4" /> },
        { href: "/cashflow", label: "Finance", icon: <DollarSign className="w-4 h-4" /> },
        { href: "/projects", label: "All Projects", icon: <FolderOpen className="w-4 h-4" /> },
      ];
    case "finance":
      return [
        { href: "/cashflow", label: "Cashflow", icon: <DollarSign className="w-4 h-4" /> },
        { href: "/cos", label: "Cost of Sales", icon: <TrendingUp className="w-4 h-4" /> },
        { href: "/projects", label: "All Projects", icon: <FolderOpen className="w-4 h-4" /> },
      ];
    case "project":
      return [
        { href: "/execution-board", label: "Execution Dashboard", icon: <Briefcase className="w-4 h-4" /> },
        { href: "/engineering", label: "Engineering", icon: <Wrench className="w-4 h-4" /> },
        { href: "/quality", label: "Quality", icon: <ShieldCheck className="w-4 h-4" /> },
      ];
    case "engineering":
      return [
        { href: "/engineering", label: "Engineering Overview", icon: <Wrench className="w-4 h-4" /> },
        { href: "/engineering/tasks", label: "Tasks", icon: <CheckCircle2 className="w-4 h-4" /> },
        { href: "/quality", label: "Quality", icon: <ShieldCheck className="w-4 h-4" /> },
      ];
    case "quality":
      return [
        { href: "/quality", label: "Quality Workspace", icon: <ShieldCheck className="w-4 h-4" /> },
        { href: "/engineering", label: "Engineering", icon: <Wrench className="w-4 h-4" /> },
        { href: "/projects", label: "All Projects", icon: <FolderOpen className="w-4 h-4" /> },
      ];
    case "business":
      return [
        { href: "/project-lifecycle", label: "Project Lifecycle", icon: <FolderOpen className="w-4 h-4" /> },
        { href: "/pd", label: "PD Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
        { href: "/projects", label: "All Projects", icon: <FolderOpen className="w-4 h-4" /> },
      ];
    default:
      return [
        { href: "/execution-board", label: "Execution Dashboard", icon: <Briefcase className="w-4 h-4" /> },
        { href: "/projects", label: "All Projects", icon: <FolderOpen className="w-4 h-4" /> },
        { href: "/cashflow", label: "Finance", icon: <DollarSign className="w-4 h-4" /> },
      ];
  }
}

function getRoleKpis(
  category: RoleCategory,
  kpis: any,
  stats: any,
  isLoading: boolean
): React.ReactNode {
  switch (category) {
    case "executive":
      return (
        <div className="space-y-2.5">
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            <StatCard value={stats.totalProjects} label="Total Projects" loading={isLoading} testId="text-total-projects" />
            <StatCard value={stats.inConstruction} label="In Construction" color="text-emerald-600" loading={isLoading} testId="text-in-construction" />
            <StatCard value={stats.inCompany} label="In Company" color="text-blue-600" loading={isLoading} testId="text-in-company" />
            <StatCard value={stats.inPipeline} label="Pipeline" color="text-violet-600" loading={isLoading} testId="text-in-pipeline" />
            <StatCard value={stats.greenProjects} label="Green RAG" color="text-emerald-600" loading={isLoading} testId="text-green-projects" />
            <StatCard value={stats.amberProjects} label="Amber RAG" color="text-amber-600" loading={isLoading} testId="text-amber-projects" />
            <StatCard value={stats.redProjects} label="Red RAG" color="text-red-600" loading={isLoading} testId="text-red-projects" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Inflow Received (FY)" value={money(kpis.receivedInflowFy)} loading={isLoading} testId="text-inflow-received" />
            <KpiCard icon={<TrendingUp className="w-4 h-4" />} label="Gross Margin" value={kpis.grossMarginPctFy != null ? `${Number(kpis.grossMarginPctFy).toFixed(1)}%` : "—"} loading={isLoading} testId="text-gp-pct" />
            <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Gross Profit (FY)" value={money(kpis.grossProfitFy)} loading={isLoading} testId="text-gross-profit" />
            <KpiCard icon={<Clock className="w-4 h-4" />} label="Behind Plan" value={kpis.projectsBehindPlan ?? "—"} loading={isLoading} testId="text-behind-plan" />
          </div>
        </div>
      );

    case "finance":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Inflow Received (FY)" value={money(kpis.receivedInflowFy)} loading={isLoading} testId="text-inflow-received" />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Open Inflow (FY)" value={money(kpis.openInflowFy)} loading={isLoading} testId="text-open-inflow" />
          <KpiCard icon={<TrendingUp className="w-4 h-4" />} label="Gross Margin" value={kpis.grossMarginPctFy != null ? `${Number(kpis.grossMarginPctFy).toFixed(1)}%` : "—"} loading={isLoading} testId="text-gp-pct" />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Gross Profit (FY)" value={money(kpis.grossProfitFy)} loading={isLoading} testId="text-gross-profit" />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Planned Revenue (FY)" value={money(kpis.plannedRevenueFy)} loading={isLoading} testId="text-planned-revenue" />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Paid Expenditure (FY)" value={money(kpis.paidExpenditureFy)} loading={isLoading} testId="text-paid-expenditure" />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Open Expenditure (FY)" value={money(kpis.openExpenditureFy)} loading={isLoading} testId="text-open-expenditure" />
          <KpiCard icon={<AlertTriangle className="w-4 h-4" />} label="Stale Imports" value={kpis.staleImports ?? "—"} loading={isLoading} testId="text-stale-imports" />
        </div>
      );

    case "project":
      return (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <StatCard value={stats.activeProjects} label="Active Projects" loading={isLoading} testId="text-active-projects" />
            <StatCard value={stats.inConstruction} label="In Construction" color="text-emerald-600" loading={isLoading} testId="text-in-construction" />
            <StatCard value={stats.greenProjects} label="Green RAG" color="text-emerald-600" loading={isLoading} testId="text-green-projects" />
            <StatCard value={stats.amberProjects} label="Amber RAG" color="text-amber-600" loading={isLoading} testId="text-amber-projects" />
            <StatCard value={stats.redProjects} label="Red RAG" color="text-red-600" loading={isLoading} testId="text-red-projects" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <KpiCard icon={<BarChart3 className="w-4 h-4" />} label="Avg Progress" value={kpis.averageActualProgressPct != null ? `${Number(kpis.averageActualProgressPct).toFixed(0)}%` : "—"} loading={isLoading} testId="text-avg-progress" />
            <KpiCard icon={<Clock className="w-4 h-4" />} label="Behind Plan" value={kpis.projectsBehindPlan ?? "—"} loading={isLoading} testId="text-behind-plan" />
            <KpiCard icon={<CheckCircle2 className="w-4 h-4" />} label="Pending Approvals" value={kpis.pendingApprovals ?? "—"} loading={isLoading} testId="text-pending-approvals" />
            <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Open Expenditure (FY)" value={money(kpis.openExpenditureFy)} loading={isLoading} testId="text-open-expenditure" />
          </div>
        </div>
      );

    case "engineering":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard value={stats.activeProjects} label="Active Projects" loading={isLoading} testId="text-active-projects" />
          <KpiCard icon={<BarChart3 className="w-4 h-4" />} label="Avg Progress" value={kpis.averageActualProgressPct != null ? `${Number(kpis.averageActualProgressPct).toFixed(0)}%` : "—"} loading={isLoading} testId="text-avg-progress" />
          <KpiCard icon={<AlertTriangle className="w-4 h-4" />} label="Eng. Blockers" value={kpis.openEngineeringBlockers ?? "—"} loading={isLoading} testId="text-eng-blockers" />
          <KpiCard icon={<Clock className="w-4 h-4" />} label="Behind Plan" value={kpis.projectsBehindPlan ?? "—"} loading={isLoading} testId="text-behind-plan" />
        </div>
      );

    case "quality":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard value={stats.activeProjects} label="Active Projects" loading={isLoading} testId="text-active-projects" />
          <KpiCard icon={<AlertTriangle className="w-4 h-4" />} label="Quality Warnings" value={kpis.openQualityWarnings ?? "—"} loading={isLoading} testId="text-quality-warnings" />
          <KpiCard icon={<CheckCircle2 className="w-4 h-4" />} label="Pending Approvals" value={kpis.pendingApprovals ?? "—"} loading={isLoading} testId="text-pending-approvals" />
          <KpiCard icon={<BarChart3 className="w-4 h-4" />} label="Avg Progress" value={kpis.averageActualProgressPct != null ? `${Number(kpis.averageActualProgressPct).toFixed(0)}%` : "—"} loading={isLoading} testId="text-avg-progress" />
        </div>
      );

    case "business":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard value={stats.totalProjects} label="Total Projects" loading={isLoading} testId="text-total-projects" />
          <StatCard value={stats.activeProjects} label="Active" loading={isLoading} testId="text-active-projects" />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Planned Revenue (FY)" value={money(kpis.plannedRevenueFy)} loading={isLoading} testId="text-planned-revenue" />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Inflow Received (FY)" value={money(kpis.receivedInflowFy)} loading={isLoading} testId="text-inflow-received" />
        </div>
      );

    default:
      return null;
  }
}

export default function HomePage() {
  const { user } = useAuth();
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
  const roleCategory = getRoleCategory(userRole);
  const roleLabel = getRoleLabel(userRole);

  const stats = useMemo(() => {
    const projects: any[] = dashData?.projects || [];
    const totalProjects = projects.length;
    const activeProjects = totalProjects;

    const constructionPhases = new Set(["construction", "qa"]);
    const companyPhases = new Set(["compliance handover", "handover", "financial close", "commercial close out", "dlp"]);

    const getCategory = (phase: string | null | undefined) => {
      const p = (phase || "").toLowerCase().trim();
      if (constructionPhases.has(p)) return "construction";
      if (companyPhases.has(p)) return "company";
      return "pipeline";
    };

    const inConstruction = projects.filter((p: any) => getCategory(p.executionPhase) === "construction").length;
    const inCompany = projects.filter((p: any) => getCategory(p.executionPhase) === "company").length;
    const inPipeline = projects.filter((p: any) => getCategory(p.executionPhase) === "pipeline").length;

    const greenProjects = projects.filter((p: any) => p.rag === "Green").length;
    const amberProjects = projects.filter((p: any) => p.rag === "Amber").length;
    const redProjects = projects.filter((p: any) => p.rag === "Red").length;
    return { totalProjects, activeProjects, inConstruction, inCompany, inPipeline, greenProjects, amberProjects, redProjects };
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
    if (Number(kpis.projectsBehindPlan) > 0) items.push({ label: "Behind Plan", value: Number(kpis.projectsBehindPlan), color: "text-amber-700 bg-amber-50 border-amber-200", href: "/execution-board" });
    if (Number(kpis.pendingApprovals) > 0) items.push({ label: "Pending Approvals", value: Number(kpis.pendingApprovals), color: "text-blue-700 bg-blue-50 border-blue-200", href: "/approvals" });
    if (Number(kpis.openEngineeringBlockers) > 0) items.push({ label: "Eng. Blockers", value: Number(kpis.openEngineeringBlockers), color: "text-violet-700 bg-violet-50 border-violet-200", href: "/engineering" });
    if (Number(kpis.openQualityWarnings) > 0) items.push({ label: "Quality Warnings", value: Number(kpis.openQualityWarnings), color: "text-orange-700 bg-orange-50 border-orange-200", href: "/quality" });
    if (myPendingActions > 0) items.push({ label: "My Overdue Actions", value: myPendingActions, color: "text-rose-700 bg-rose-50 border-rose-200", href: "/my-work/tasks" });
    return items;
  }, [stats, kpis, myPendingActions]);

  const totalAttention = attentionItems.reduce((sum, item) => sum + item.value, 0);
  const quickLinks = useMemo(() => getCompactQuickLinks(roleCategory), [roleCategory]);
  const layoutVariant = useMemo(() => getVariant("home_layout_2026", ["compact", "expanded"], (user as any)?.id), [user]);

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

      {/* Greeting Strip */}
      <div className="mb-5">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground" data-testid="text-greeting">
          {greeting}, {displayName}
        </h1>
        <div className="flex items-center gap-3 mt-0.5">
          <p className="text-sm text-muted-foreground" data-testid="text-role-badge">{roleLabel}</p>
          {!isLoading && totalAttention > 0 && (
            <span className="text-xs text-amber-600 font-medium">{totalAttention} item{totalAttention !== 1 ? "s" : ""} need attention</span>
          )}
        </div>
      </div>

      {/* Attention Badges — promoted to top */}
      {!isLoading && (
        <AttentionBadges items={attentionItems} threshold={0} />
      )}

      {/* KPIs + Next Steps — A/B: compact (two-column) vs expanded (full-width stacked) */}
      {layoutVariant === "expanded" ? (
        <>
          <div className="mb-6">
            <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
              Your Metrics
            </h2>
            {getRoleKpis(roleCategory, kpis, stats, isLoading)}
          </div>
          <div className="mb-6 flex items-center gap-3">
            <Link href="/my-work">
              <Button data-testid="link-my-work">
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Go to My Work
                {myOpenTasks > 0 && <Badge variant="secondary" className="ml-2 text-xs">{myOpenTasks} open</Badge>}
              </Button>
            </Link>
            {quickLinks.map((link) => (
              <Link key={link.href} href={link.href}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  {link.icon}
                  {link.label}
                </Button>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mb-6">
          {/* Left: KPIs (wider) */}
          <div className="lg:col-span-3">
            <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
              Your Metrics
            </h2>
            {getRoleKpis(roleCategory, kpis, stats, isLoading)}
          </div>

          {/* Right: Next Steps */}
          <div className="lg:col-span-2">
            <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
              Next Steps
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
                <Link href="/my-work">
                  <Button className="w-full" data-testid="link-my-work">
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Go to My Work
                    <ArrowRight className="w-4 h-4 ml-auto" />
                  </Button>
                </Link>
                <div className="border-t border-border/50 pt-3 space-y-1.5">
                  {quickLinks.map((link) => (
                    <Link key={link.href} href={link.href}>
                      <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors cursor-pointer group">
                        {link.icon}
                        <span>{link.label}</span>
                        <ArrowRight className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-60 transition-opacity" />
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Company Priorities — Collapsible */}
      {(companyPriorities && companyPriorities.length > 0) && (
        <Collapsible open={prioritiesExpanded} onOpenChange={setPrioritiesExpanded}>
          <Card className="border-border/60 mb-6" data-testid="card-company-priorities">
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
        <div className="mb-6">
          <Skeleton className="h-5 w-48 mb-2.5" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </div>
      )}
      {companyPriorities && companyPriorities.length === 0 && !prioritiesLoading && (
        <Card className="border-border/60 mb-6">
          <CardContent className="p-5 text-center">
            <p className="text-sm text-muted-foreground">No priorities assigned to your projects</p>
          </CardContent>
        </Card>
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
