import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
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
} from "lucide-react";

const token = () => localStorage.getItem("auth_token") || "";
const money = (n: number | null | undefined) => `R ${(Number(n || 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function QuickLink({ href, icon, label, description, color }: { href: string; icon: React.ReactNode; label: string; description: string; color: string }) {
  return (
    <Link href={href}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer border-border/60 h-full" data-testid={`link-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        <CardContent className="p-4 flex items-start gap-3">
          <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center shrink-0`}>
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function StatCard({ value, label, color, loading, testId }: { value: string | number; label: string; color?: string; loading: boolean; testId: string }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4 text-center">
        {loading ? <Skeleton className="h-8 w-12 mx-auto" /> : (
          <p className={`text-2xl font-bold ${color || "text-foreground"}`} data-testid={testId}>{value}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </CardContent>
    </Card>
  );
}

function KpiCard({ icon, label, value, loading, testId }: { icon: React.ReactNode; label: string; value: string; loading: boolean; testId: string }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          {icon}
          <span className="text-xs">{label}</span>
        </div>
        {loading ? <Skeleton className="h-6 w-20" /> : (
          <p className="text-lg font-bold text-foreground" data-testid={testId}>{value}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function HomePage() {
  const { user } = useAuth();

  const { data: summaryData, isLoading: summaryLoading } = useQuery<any>({
    queryKey: ["/api/projects-summary"],
    queryFn: async () => {
      const res = await fetch("/api/projects-summary", {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: dashData, isLoading: dashLoading } = useQuery<any>({
    queryKey: ["/api/program-dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/program-dashboard", {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const stats = useMemo(() => {
    const projects = Array.isArray(summaryData) ? summaryData : summaryData?.projects || [];
    const totalProjects = projects.length;
    const activeProjects = projects.filter((p: any) => p.is_active === true).length;
    const greenProjects = projects.filter((p: any) => p.rag_status === "Green").length;
    const amberProjects = projects.filter((p: any) => p.rag_status === "Amber").length;
    const redProjects = projects.filter((p: any) => p.rag_status === "Red").length;
    return { totalProjects, activeProjects, greenProjects, amberProjects, redProjects };
  }, [summaryData]);

  const dashStats = useMemo(() => {
    const projects = dashData?.projects || [];
    const greenCount = projects.filter((p: any) => p.rag === "Green").length;
    const amberCount = projects.filter((p: any) => p.rag === "Amber").length;
    const redCount = projects.filter((p: any) => p.rag === "Red").length;
    return { greenCount, amberCount, redCount };
  }, [dashData]);

  const kpis = dashData?.kpis || {};

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const displayName = (user as any)?.name || (user?.username ? user.username.charAt(0).toUpperCase() + user.username.slice(1) : "User");
  const isLoading = summaryLoading || dashLoading;

  const activeCount = kpis.activeDashboardProjects ?? stats.activeProjects;
  const greenCount = dashStats.greenCount || stats.greenProjects;
  const amberCount = dashStats.amberCount || stats.amberProjects;
  const redCount = dashStats.redCount || stats.redProjects;

  return (
    <PageShell data-testid="home-page">
      <SectionHeader
        icon={<LayoutDashboard className="w-5 h-5" />}
        title={`${greeting}, ${displayName}`}
        description="Here's an overview of your workspace and quick access to key areas."
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-6">
        <StatCard value={stats.totalProjects} label="Total Projects" loading={summaryLoading} testId="text-total-projects" />
        <StatCard value={activeCount} label="Active" loading={isLoading} testId="text-active-projects" />
        <StatCard value={greenCount} label="Green RAG" color="text-emerald-600" loading={isLoading} testId="text-green-projects" />
        <StatCard value={amberCount} label="Amber RAG" color="text-amber-600" loading={isLoading} testId="text-amber-projects" />
        <StatCard value={redCount} label="Red RAG" color="text-red-600" loading={isLoading} testId="text-red-projects" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        <KpiCard
          icon={<DollarSign className="w-4 h-4" />}
          label="Inflow Received (FY)"
          value={money(kpis.receivedInflowFy)}
          loading={dashLoading}
          testId="text-inflow-received"
        />
        <KpiCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Gross Margin"
          value={kpis.grossMarginPctFy != null ? `${(Number(kpis.grossMarginPctFy) * 100).toFixed(1)}%` : "—"}
          loading={dashLoading}
          testId="text-gp-pct"
        />
        <KpiCard
          icon={<BarChart3 className="w-4 h-4" />}
          label="Avg Progress"
          value={kpis.averageActualProgressPct != null ? `${Number(kpis.averageActualProgressPct).toFixed(0)}%` : "—"}
          loading={dashLoading}
          testId="text-avg-progress"
        />
        <KpiCard
          icon={<Clock className="w-4 h-4" />}
          label="Behind Plan"
          value={kpis.projectsBehindPlan ?? "—"}
          loading={dashLoading}
          testId="text-behind-plan"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        <KpiCard
          icon={<DollarSign className="w-4 h-4" />}
          label="Planned Revenue (FY)"
          value={money(kpis.plannedRevenueFy)}
          loading={dashLoading}
          testId="text-planned-revenue"
        />
        <KpiCard
          icon={<DollarSign className="w-4 h-4" />}
          label="Gross Profit (FY)"
          value={money(kpis.grossProfitFy)}
          loading={dashLoading}
          testId="text-gross-profit"
        />
        <KpiCard
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Stale Imports"
          value={kpis.staleImports ?? "—"}
          loading={dashLoading}
          testId="text-stale-imports"
        />
        <KpiCard
          icon={<CheckCircle2 className="w-4 h-4" />}
          label="Pending Approvals"
          value={kpis.pendingApprovals ?? "—"}
          loading={dashLoading}
          testId="text-pending-approvals"
        />
      </div>

      <h2 className="text-base font-semibold text-foreground mt-8 mb-3">Quick Access</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <QuickLink
          href="/my-work"
          icon={<CheckCircle2 className="w-5 h-5 text-emerald-600" />}
          label="My Work"
          description="Tasks, approvals, calendar & meetings"
          color="bg-emerald-100"
        />
        <QuickLink
          href="/project-lifecycle"
          icon={<FolderOpen className="w-5 h-5 text-blue-600" />}
          label="Project Lifecycle"
          description="Lifecycle stages, clients & stage gates"
          color="bg-blue-100"
        />
        <QuickLink
          href="/pm-dashboard"
          icon={<Briefcase className="w-5 h-5 text-violet-600" />}
          label="Project Management"
          description="Execution overview & project controls"
          color="bg-violet-100"
        />
        <QuickLink
          href="/engineering"
          icon={<Wrench className="w-5 h-5 text-orange-600" />}
          label="Engineering"
          description="Engineering overview & task requests"
          color="bg-orange-100"
        />
        <QuickLink
          href="/cashflow"
          icon={<DollarSign className="w-5 h-5 text-teal-600" />}
          label="Finance"
          description="Cashflow, COS, revenue & gross profit"
          color="bg-teal-100"
        />
        <QuickLink
          href="/quality"
          icon={<ShieldCheck className="w-5 h-5 text-indigo-600" />}
          label="Quality"
          description="Quality dashboard & checklists"
          color="bg-indigo-100"
        />
      </div>
    </PageShell>
  );
}
