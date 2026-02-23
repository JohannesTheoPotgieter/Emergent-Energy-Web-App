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

  const { data: projects = [] } = useQuery<ProjectReport[]>({
    queryKey: ["/api/projects-summary"],
  });

  const { data: priorities = [], isLoading: prioritiesLoading } = useQuery<CompanyPriority[]>({
    queryKey: ["/api/mytool/company-priorities"],
  });

  return (
    <div className="space-y-6" data-testid="home-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Execution Cockpit</h1>
          <p className="text-sm text-muted-foreground">
            {new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
      </div>

      <CompanyPrioritiesCards isAdmin={!!canEdit} priorities={priorities} isLoading={prioritiesLoading} />

      <ImmediateAttentionPanel projects={projects} />
    </div>
  );
}
