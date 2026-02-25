import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useLocation } from "wouter";
import {
  Briefcase,
  DollarSign,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  ArrowRight,
  HardHat,
  Zap,
  PauseCircle,
  TrendingUp,
  BarChart3,
} from "lucide-react";

async function pmFetch(url: string) {
  const token = localStorage.getItem("auth_token");
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface ProjectDates {
  pdHandover: string | null;
  pdHandoverActual: string | null;
  constructionStart: string | null;
  constructionStartActual: string | null;
  commissioning: string | null;
  commissioningActual: string | null;
  clientHandover: string | null;
  clientHandoverActual: string | null;
  omHandover: string | null;
}

interface ProjectFinancials {
  totalBudget: number;
  totalActual: number;
  spendPercent: number;
  cosRealised: number;
  cosDeferred: number;
  cosFlagged: number;
  cosPlanned: number;
}

interface ProjectTasks {
  total: number;
  inProgress: number;
  completed: number;
  onHold: number;
  needsApproval: number;
  overdue: number;
  active: number;
}

interface PMProject {
  id: number;
  projectName: string;
  phase: string | null;
  ragStatus: string | null;
  contractValue: number;
  sizeKwp: number;
  escalationLevel: string | null;
  isActive: boolean;
  dates: ProjectDates;
  financials: ProjectFinancials;
  tasks: ProjectTasks;
}

interface PMDashboardData {
  projects: PMProject[];
  summary: {
    totalProjects: number;
    totalContractValue: number;
    totalBudget: number;
    totalActualSpend: number;
    activeTasks: number;
    overdueTasks: number;
    completedTasks: number;
  };
}

const ragColors: Record<string, string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  grey: "bg-gray-400",
};

function formatCurrency(val: number): string {
  if (val >= 1_000_000) return `R${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `R${(val / 1_000).toFixed(0)}K`;
  return `R${val.toFixed(0)}`;
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "2-digit" });
  } catch {
    return d;
  }
}

function DateRow({ label, planned, actual }: { label: string; planned: string | null; actual: string | null }) {
  if (!planned && !actual) return null;
  return (
    <div className="flex justify-between text-xs" data-testid={`date-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={actual ? "text-green-600 font-medium" : ""}>{formatDate(actual || planned)}</span>
    </div>
  );
}

export default function PMDashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const { data, isLoading, error } = useQuery<PMDashboardData>({
    queryKey: ["pm-dashboard"],
    queryFn: () => pmFetch("/api/pm/dashboard"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="pm-loading">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-destructive" data-testid="pm-error">
        <AlertTriangle className="h-5 w-5 mr-2" />
        Failed to load dashboard
      </div>
    );
  }

  const { projects, summary } = data!;

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="pm-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="pm-title">
            My Projects
          </h1>
          <p className="text-sm text-muted-foreground">
            {user?.name ? `${user.name} — ` : ""}
            {summary.totalProjects} project{summary.totalProjects !== 1 ? "s" : ""} assigned
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="pm-summary-cards">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Briefcase className="h-3.5 w-3.5" /> Projects
            </div>
            <p className="text-2xl font-bold" data-testid="summary-total-projects">{summary.totalProjects}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <DollarSign className="h-3.5 w-3.5" /> Contract Value
            </div>
            <p className="text-2xl font-bold" data-testid="summary-contract-value">{formatCurrency(summary.totalContractValue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Zap className="h-3.5 w-3.5" /> Active Tasks
            </div>
            <p className="text-2xl font-bold" data-testid="summary-active-tasks">{summary.activeTasks}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Overdue
            </div>
            <p className={`text-2xl font-bold ${summary.overdueTasks > 0 ? "text-red-600" : ""}`} data-testid="summary-overdue">
              {summary.overdueTasks}
            </p>
          </CardContent>
        </Card>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center" data-testid="pm-empty">
            <Briefcase className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
            <h3 className="font-medium text-lg mb-1">No projects assigned yet</h3>
            <p className="text-sm text-muted-foreground">Projects will appear here once they are linked to your account.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="pm-projects-grid">
          {projects.map((project) => (
            <Card
              key={project.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate(`/project/${encodeURIComponent(project.projectName)}`)}
              data-testid={`pm-project-${project.id}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold truncate flex-1 mr-2">{project.projectName}</CardTitle>
                  <div className="flex items-center gap-2 shrink-0">
                    {project.ragStatus && (
                      <div
                        className={`h-2.5 w-2.5 rounded-full ${ragColors[project.ragStatus] || "bg-gray-300"}`}
                        title={`RAG: ${project.ragStatus}`}
                        data-testid={`rag-${project.id}`}
                      />
                    )}
                    {project.phase && (
                      <Badge variant="outline" className="text-[9px] h-5">{project.phase}</Badge>
                    )}
                  </div>
                </div>
                {project.sizeKwp > 0 && (
                  <p className="text-xs text-muted-foreground">{project.sizeKwp} kWp</p>
                )}
              </CardHeader>

              <CardContent className="space-y-3 pt-0">
                <div className="space-y-1">
                  <DateRow label="Construction" planned={project.dates.constructionStart} actual={project.dates.constructionStartActual} />
                  <DateRow label="Commissioning" planned={project.dates.commissioning} actual={project.dates.commissioningActual} />
                  <DateRow label="Client Handover" planned={project.dates.clientHandover} actual={project.dates.clientHandoverActual} />
                </div>

                <Separator />

                <div data-testid={`financials-${project.id}`}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <BarChart3 className="h-3 w-3" /> Budget vs Actual
                    </span>
                    <span className="font-medium">{project.financials.spendPercent}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        project.financials.spendPercent > 100 ? "bg-red-500" :
                        project.financials.spendPercent > 80 ? "bg-amber-500" : "bg-primary"
                      }`}
                      style={{ width: `${Math.min(project.financials.spendPercent, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                    <span>{formatCurrency(project.financials.totalActual)} spent</span>
                    <span>{formatCurrency(project.financials.totalBudget)} budget</span>
                  </div>
                </div>

                <div className="flex gap-1.5" data-testid={`cos-${project.id}`}>
                  {project.financials.cosRealised > 0 && (
                    <Badge className="text-[9px] bg-green-100 text-green-800 hover:bg-green-100">R:{project.financials.cosRealised}</Badge>
                  )}
                  {project.financials.cosDeferred > 0 && (
                    <Badge className="text-[9px] bg-amber-100 text-amber-800 hover:bg-amber-100">D:{project.financials.cosDeferred}</Badge>
                  )}
                  {project.financials.cosFlagged > 0 && (
                    <Badge className="text-[9px] bg-red-100 text-red-800 hover:bg-red-100">F:{project.financials.cosFlagged}</Badge>
                  )}
                  {project.financials.cosPlanned > 0 && (
                    <Badge className="text-[9px] bg-gray-100 text-gray-600 hover:bg-gray-100">P:{project.financials.cosPlanned}</Badge>
                  )}
                </div>

                <Separator />

                <div data-testid={`tasks-${project.id}`}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <HardHat className="h-3 w-3" /> Engineering Tasks
                    </span>
                    <span className="font-medium">{project.tasks.completed}/{project.tasks.total}</span>
                  </div>
                  {project.tasks.total > 0 && (
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-1.5">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all"
                        style={{ width: `${project.tasks.total > 0 ? (project.tasks.completed / project.tasks.total) * 100 : 0}%` }}
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {project.tasks.inProgress > 0 && (
                      <span className="text-[10px] flex items-center gap-0.5 text-blue-600">
                        <Clock className="h-2.5 w-2.5" /> {project.tasks.inProgress} active
                      </span>
                    )}
                    {project.tasks.onHold > 0 && (
                      <span className="text-[10px] flex items-center gap-0.5 text-amber-600">
                        <PauseCircle className="h-2.5 w-2.5" /> {project.tasks.onHold} hold
                      </span>
                    )}
                    {project.tasks.overdue > 0 && (
                      <span className="text-[10px] flex items-center gap-0.5 text-red-600">
                        <AlertTriangle className="h-2.5 w-2.5" /> {project.tasks.overdue} overdue
                      </span>
                    )}
                    {project.tasks.completed > 0 && (
                      <span className="text-[10px] flex items-center gap-0.5 text-green-600">
                        <CheckCircle2 className="h-2.5 w-2.5" /> {project.tasks.completed} done
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end text-xs text-primary">
                  <span className="flex items-center gap-1">View details <ArrowRight className="h-3 w-3" /></span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
