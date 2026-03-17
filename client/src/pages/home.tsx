import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import {
  LayoutDashboard,
  FolderOpen,
  Activity,
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronRight,
  Users,
  DollarSign,
  Wrench,
  ShieldCheck,
  Briefcase,
  ArrowRight,
} from "lucide-react";

const token = () => localStorage.getItem("auth_token") || "";

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
    const activeProjects = projects.filter((p: any) => p.status === "active" || p.executionPhase === "In Execution").length;
    const greenProjects = projects.filter((p: any) => p.ragStatus === "Green").length;
    const amberProjects = projects.filter((p: any) => p.ragStatus === "Amber").length;
    const redProjects = projects.filter((p: any) => p.ragStatus === "Red").length;
    return { totalProjects, activeProjects, greenProjects, amberProjects, redProjects };
  }, [summaryData]);

  const kpis = dashData?.kpis || {};

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const displayName = user?.username ? user.username.charAt(0).toUpperCase() + user.username.slice(1) : "User";

  return (
    <PageShell data-testid="home-page">
      <SectionHeader
        icon={<LayoutDashboard className="w-5 h-5" />}
        title={`${greeting}, ${displayName}`}
        description="Here's an overview of your workspace and quick access to key areas."
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-6">
        <Card className="border-border/60">
          <CardContent className="p-4 text-center">
            {summaryLoading ? <Skeleton className="h-8 w-12 mx-auto" /> : (
              <p className="text-2xl font-bold text-foreground" data-testid="text-total-projects">{stats.totalProjects}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">Total Projects</p>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-4 text-center">
            {summaryLoading ? <Skeleton className="h-8 w-12 mx-auto" /> : (
              <p className="text-2xl font-bold text-foreground" data-testid="text-active-projects">{stats.activeProjects}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">Active</p>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-4 text-center">
            {summaryLoading ? <Skeleton className="h-8 w-12 mx-auto" /> : (
              <p className="text-2xl font-bold text-emerald-600" data-testid="text-green-projects">{stats.greenProjects}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">Green RAG</p>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-4 text-center">
            {summaryLoading ? <Skeleton className="h-8 w-12 mx-auto" /> : (
              <p className="text-2xl font-bold text-amber-600" data-testid="text-amber-projects">{stats.amberProjects}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">Amber RAG</p>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-4 text-center">
            {summaryLoading ? <Skeleton className="h-8 w-12 mx-auto" /> : (
              <p className="text-2xl font-bold text-red-600" data-testid="text-red-projects">{stats.redProjects}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">Red RAG</p>
          </CardContent>
        </Card>
      </div>

      {dashData?.kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Card className="border-border/60">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <DollarSign className="w-4 h-4" />
                <span className="text-xs">Revenue YTD</span>
              </div>
              <p className="text-lg font-bold text-foreground" data-testid="text-revenue-ytd">
                R {(Number(kpis.revenueYtd || 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/60">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <TrendingUp className="w-4 h-4" />
                <span className="text-xs">GP %</span>
              </div>
              <p className="text-lg font-bold text-foreground" data-testid="text-gp-pct">
                {kpis.gpPct != null ? `${Number(kpis.gpPct).toFixed(1)}%` : "—"}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/60">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-xs">Tasks Complete</span>
              </div>
              <p className="text-lg font-bold text-foreground" data-testid="text-tasks-complete">
                {kpis.tasksCompletePct != null ? `${Number(kpis.tasksCompletePct).toFixed(0)}%` : "—"}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/60">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-xs">Exceptions</span>
              </div>
              <p className="text-lg font-bold text-foreground" data-testid="text-exceptions">
                {kpis.exceptionCount ?? "—"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

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
