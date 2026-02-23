import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import {
  Flag,
  Loader2,
  ArrowRight,
  AlertTriangle,
  TrendingDown,
  Clock,
  ChevronRight,
  ExternalLink,
  Users,
  Calendar,
  Target,
} from "lucide-react";

interface CompanyPriority {
  id: number;
  title: string;
  description: string | null;
  department: string | null;
  horizon: string;
  ownerRole: string | null;
  linkedProjectName: string | null;
  severity: string;
  status: string;
  priorityRank: number | null;
  assignedTo: string | null;
  nextAction: string | null;
  support: string[] | null;
  definitionOfDone: string | null;
  dueDate: string | null;
  linkedTaskId: number | null;
  linkedTaskType: string | null;
  links?: { id: number; linkType: string; projectName: string | null; taskId: number | null }[];
}

interface OverviewData {
  total_program_budget: number;
  actual_spend_paid: number;
  revenue_realised: number;
  active_projects: number;
  data_as_of: string;
}

interface ProjectReport {
  project_name: string;
  project_info_id: number;
  phase: string | null;
  size_kwp: number | null;
  delta_vs_expected: number | null;
  escalation_level: string | null;
  actual_revenue: number;
  actual_expenses: number;
  gp_percent: number | null;
  project_pct_complete: number | null;
  expected_pct_complete: number | null;
  is_active: boolean;
}

interface ExecutionProject {
  id: number | null;
  projectName: string;
  sizeKwp: string | null;
  contractValue: string | null;
  phase: string | null;
  isActive: boolean;
  escalationLevel: string | null;
  ragStatus: string | null;
  executionEnabled: boolean;
  executionPhase: string | null;
  archivedStatus: string;
  engTotal: number;
  engDone: number;
  engOverdue: number;
  projectPctComplete: number | null;
}

function formatCurrency(val: number): string {
  if (val >= 1_000_000) return `R${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `R${(val / 1_000).toFixed(0)}K`;
  return `R${val.toFixed(0)}`;
}

function formatPct(val: number): string {
  return `${val.toFixed(1)}%`;
}

function ragColor(pct: number): string {
  if (pct >= 80) return "text-emerald-600";
  if (pct >= 60) return "text-amber-500";
  return "text-red-600";
}

function ragBg(pct: number): string {
  if (pct >= 80) return "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800";
  if (pct >= 60) return "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800";
  return "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800";
}

function riskBg(count: number): string {
  if (count === 0) return "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800";
  if (count <= 3) return "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800";
  return "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800";
}

function riskColor(count: number): string {
  if (count === 0) return "text-emerald-600";
  if (count <= 3) return "text-amber-500";
  return "text-red-600";
}

function severityOrder(s: string): number {
  if (s === "critical") return 0;
  if (s === "important") return 1;
  return 2;
}

function statusColor(status: string): string {
  switch (status) {
    case "active":
    case "in_progress":
      return "bg-emerald-600 text-white";
    case "monitoring":
      return "bg-blue-600 text-white";
    case "not_started":
      return "bg-slate-400 text-white";
    case "complete":
      return "bg-emerald-700 text-white";
    case "closed":
      return "bg-gray-400 text-white";
    default:
      return "bg-slate-500 text-white";
  }
}

function severityBorder(severity: string): string {
  if (severity === "critical") return "border-l-red-500";
  if (severity === "important") return "border-l-amber-500";
  return "border-l-slate-300 dark:border-l-slate-600";
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

function ExecutiveHealthStrip({ execProjects, overview }: { execProjects: ExecutionProject[]; overview: OverviewData | undefined }) {
  if (!overview && execProjects.length === 0) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="health-strip-loading">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="border rounded-lg p-3 animate-pulse bg-muted/30">
            <div className="h-3 w-20 bg-muted rounded mb-2" />
            <div className="h-8 w-16 bg-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  const activeExec = execProjects.filter(p => p.executionEnabled && p.archivedStatus === "ACTIVE");
  const withPct = activeExec.filter(p => p.projectPctComplete !== null);
  const avgCompletion = withPct.length > 0
    ? Math.round(withPct.reduce((acc, p) => acc + (p.projectPctComplete || 0), 0) / withPct.length)
    : 0;

  const atRisk = activeExec.filter(p =>
    p.ragStatus === "Red" || p.escalationLevel
  );
  const behindSchedule = activeExec.filter(p =>
    p.engOverdue > 0 || p.ragStatus === "Red" || p.ragStatus === "Amber"
  );

  const revPct = overview && overview.total_program_budget > 0
    ? (overview.revenue_realised / overview.total_program_budget) * 100
    : 0;
  const cosPct = overview && overview.total_program_budget > 0
    ? (overview.actual_spend_paid / overview.total_program_budget) * 100
    : 0;

  const metrics = [
    {
      label: "Execution Projects",
      value: activeExec.length.toString(),
      sub: `${avgCompletion}% avg completion`,
      color: "text-slate-800 dark:text-slate-200",
      bg: "bg-slate-50 border-slate-200 dark:bg-slate-900/40 dark:border-slate-700",
    },
    {
      label: "Revenue Realised",
      value: overview ? formatPct(revPct) : "—",
      sub: overview ? formatCurrency(overview.revenue_realised) : "",
      color: ragColor(revPct),
      bg: ragBg(revPct),
    },
    {
      label: "Behind Schedule",
      value: behindSchedule.length.toString(),
      sub: `of ${activeExec.length} execution`,
      color: riskColor(behindSchedule.length),
      bg: riskBg(behindSchedule.length),
    },
    {
      label: "Projects At Risk",
      value: atRisk.length.toString(),
      sub: atRisk.length > 0 ? atRisk.slice(0, 2).map(p => p.projectName.replace(/_Tracker.*$/, "").replace(/_/g, " ")).join(", ") : "None",
      color: riskColor(atRisk.length),
      bg: riskBg(atRisk.length),
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="health-strip">
      {metrics.map((m, i) => (
        <div key={i} className={`border rounded-lg p-3 ${m.bg}`} data-testid={`health-metric-${i}`}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{m.label}</p>
          <p className={`text-2xl font-bold ${m.color} leading-tight mt-0.5`}>{m.value}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{m.sub}</p>
        </div>
      ))}
    </div>
  );
}

function CompanyPrioritiesCards({ isAdmin, priorities, isLoading }: { isAdmin: boolean; priorities: CompanyPriority[]; isLoading: boolean }) {
  const activePriorities = priorities.filter(p => !["closed", "complete"].includes(p.status));

  const sorted = [...activePriorities].sort((a, b) => {
    const aOverdue = isOverdue(a.dueDate) ? 0 : 1;
    const bOverdue = isOverdue(b.dueDate) ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;

    const aSev = severityOrder(a.severity);
    const bSev = severityOrder(b.severity);
    if (aSev !== bSev) return aSev - bSev;

    return (a.priorityRank ?? 999) - (b.priorityRank ?? 999);
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Flag className="h-4 w-4 text-red-500" />
            Company Priorities
          </h2>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (activePriorities.length === 0 && !isAdmin) return null;

  return (
    <div className="space-y-3" data-testid="company-priorities-section">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Flag className="h-4 w-4 text-red-500" />
          Company Priorities
          <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground/70">
            {activePriorities.length} active
          </span>
        </h2>
        {isAdmin && (
          <Link href="/company-priorities">
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid="button-manage-priorities">
              Manage <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        )}
      </div>

      {activePriorities.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">No active company priorities.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map(p => {
            const overdue = isOverdue(p.dueDate);
            const linkedCount = (p.links?.length ?? 0) + (p.linkedProjectName ? 1 : 0);
            return (
              <div
                key={p.id}
                className={`border-l-4 ${severityBorder(p.severity)} border rounded-lg bg-card p-3 space-y-2 ${overdue ? "ring-1 ring-red-300 dark:ring-red-800" : ""}`}
                data-testid={`priority-card-${p.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-sm leading-snug" data-testid={`text-priority-title-${p.id}`}>{p.title}</h3>
                  <Badge className={`text-[10px] px-1.5 py-0 shrink-0 ${statusColor(p.status)}`}>
                    {p.status.replace(/_/g, " ")}
                  </Badge>
                </div>

                {p.assignedTo && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    <span>{p.assignedTo}</span>
                  </div>
                )}

                {p.nextAction && (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Target className="h-3 w-3 mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{p.nextAction}</span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1 border-t border-border/50">
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    {p.dueDate && (
                      <span className={`flex items-center gap-1 ${overdue ? "text-red-600 font-medium" : ""}`}>
                        <Calendar className="h-3 w-3" />
                        {p.dueDate}
                        {overdue && <AlertTriangle className="h-3 w-3" />}
                      </span>
                    )}
                    {linkedCount > 0 && (
                      <span className="flex items-center gap-1">
                        <ExternalLink className="h-3 w-3" />
                        {linkedCount} linked
                      </span>
                    )}
                  </div>
                  <Link href="/company-priorities">
                    <Button variant="ghost" size="sm" className="h-6 text-[11px] px-2 gap-0.5" data-testid={`button-view-priority-${p.id}`}>
                      Details <ChevronRight className="h-3 w-3" />
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ImmediateAttentionPanel({ projects }: { projects: ProjectReport[] }) {
  const activeProjects = projects.filter(p => p.is_active);

  const attentionItems: { project: string; id: number; issue: string; severity: "high" | "medium" | "low"; borderColor: string }[] = [];

  activeProjects.forEach(p => {
    const name = p.project_name.replace(/_Tracker.*$/, "").replace(/_/g, " ");

    if (p.escalation_level) {
      attentionItems.push({
        project: name,
        id: p.project_info_id,
        issue: `Escalation: ${p.escalation_level}`,
        severity: p.escalation_level === "Highest" ? "high" : "medium",
        borderColor: p.escalation_level === "Highest" ? "border-l-red-500" : "border-l-amber-500",
      });
    }

    if (p.delta_vs_expected !== null && p.delta_vs_expected < -0.05) {
      attentionItems.push({
        project: name,
        id: p.project_info_id,
        issue: `Behind schedule by ${Math.abs(p.delta_vs_expected * 100).toFixed(1)}%`,
        severity: p.delta_vs_expected < -0.1 ? "high" : "medium",
        borderColor: p.delta_vs_expected < -0.1 ? "border-l-red-500" : "border-l-amber-500",
      });
    }

    if (p.gp_percent !== null && p.gp_percent < 0.1 && p.actual_revenue > 500000) {
      attentionItems.push({
        project: name,
        id: p.project_info_id,
        issue: `Margin drift: GP ${(p.gp_percent * 100).toFixed(1)}%`,
        severity: p.gp_percent < 0.05 ? "high" : "medium",
        borderColor: p.gp_percent < 0.05 ? "border-l-red-500" : "border-l-amber-500",
      });
    }
  });

  attentionItems.sort((a, b) => {
    const sevOrder = { high: 0, medium: 1, low: 2 };
    return sevOrder[a.severity] - sevOrder[b.severity];
  });

  const display = attentionItems.slice(0, 8);

  if (display.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="attention-panel">
      <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        Immediate Attention
        <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground/70">
          {attentionItems.length} items
        </span>
      </h2>
      <div className="space-y-1">
        {display.map((item, i) => (
          <Link key={`${item.id}-${i}`} href={`/projects/${item.id}`}>
            <div
              className={`border-l-4 ${item.borderColor} border rounded-md bg-card px-3 py-2 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors cursor-pointer group`}
              data-testid={`attention-item-${i}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-medium text-sm truncate">{item.project}</span>
                <span className="text-xs text-muted-foreground truncate hidden sm:inline">{item.issue}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge
                  variant="secondary"
                  className={`text-[10px] px-1.5 py-0 ${
                    item.severity === "high"
                      ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                  }`}
                >
                  {item.severity}
                </Badge>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const { user, isAdmin } = useAuth();
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const canEdit = isAdmin || (companyRole && ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO"].includes(companyRole));

  const { data: overview } = useQuery<OverviewData>({
    queryKey: ["/api/overview"],
  });

  const { data: execProjects = [] } = useQuery<ExecutionProject[]>({
    queryKey: ["/api/lifecycle-board/projects"],
  });

  const { data: projects = [] } = useQuery<ProjectReport[]>({
    queryKey: ["/api/projects-summary"],
  });

  const { data: priorities = [], isLoading: prioritiesLoading } = useQuery<CompanyPriority[]>({
    queryKey: ["/api/mytool/company-priorities"],
  });

  const activeExecCount = execProjects.filter(p => p.executionEnabled && p.archivedStatus === "ACTIVE").length;

  return (
    <div className="space-y-6" data-testid="home-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Execution Cockpit</h1>
          <p className="text-sm text-muted-foreground">
            {activeExecCount || "—"} execution projects &middot; {new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
      </div>

      <ExecutiveHealthStrip execProjects={execProjects} overview={overview} />

      <CompanyPrioritiesCards isAdmin={!!canEdit} priorities={priorities} isLoading={prioritiesLoading} />

      <ImmediateAttentionPanel projects={projects} />
    </div>
  );
}
