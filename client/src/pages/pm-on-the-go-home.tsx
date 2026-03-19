import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw,
  AlertTriangle,
  ArrowRight,
  ShieldAlert,
  TrendingUp,
  CircleDollarSign,
  ChevronRight,
} from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";

interface PmProject {
  id: number;
  projectName: string;
  phase: string | null;
  ragStatus: string | null;
  contractValue: number;
  sizeKwp: number;
  escalationLevel: string | null;
  isActive: boolean;
  budget: number;
  spent: number;
  spendPercent: number;
  openRisks: number;
  voPending: number;
  schedulePct: number;
  openEscalations: number;
}

function formatZAR(value: number): string {
  if (value >= 1_000_000) {
    return `R${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `R${(value / 1_000).toFixed(0)}K`;
  }
  return `R${value.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

function getBudgetColor(spendPercent: number): string {
  if (spendPercent > 110) return "text-red-500";
  if (spendPercent > 90) return "text-amber-500";
  return "text-emerald-500";
}

function getBudgetProgressColor(spendPercent: number): string {
  if (spendPercent > 110) return "[&>div]:bg-red-500";
  if (spendPercent > 90) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-emerald-500";
}

function ProjectCard({ project, onClick }: { project: PmProject; onClick: () => void }) {
  return (
    <Card
      className="p-4 cursor-pointer hover:border-primary/40 transition-all active:scale-[0.98] touch-manipulation"
      onClick={onClick}
      data-testid={`card-project-${project.id}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3
            className="text-lg font-semibold truncate"
            data-testid={`text-project-name-${project.id}`}
          >
            {project.projectName}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            {project.phase && (
              <Badge variant="outline" className="text-xs" data-testid={`badge-phase-${project.id}`}>
                {project.phase}
              </Badge>
            )}
            {project.ragStatus && (
              <Badge
                variant="outline"
                className={`text-xs ${
                  project.ragStatus === "Red"
                    ? "border-red-500/50 text-red-500"
                    : project.ragStatus === "Amber"
                    ? "border-amber-500/50 text-amber-500"
                    : "border-emerald-500/50 text-emerald-500"
                }`}
                data-testid={`badge-rag-${project.id}`}
              >
                {project.ragStatus}
              </Badge>
            )}
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0 mt-1" />
      </div>

      <div className="space-y-3">
        <div data-testid={`budget-section-${project.id}`}>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-muted-foreground flex items-center gap-1">
              <CircleDollarSign className="w-3.5 h-3.5" />
              Budget vs Spent
            </span>
            <span className={`font-medium ${getBudgetColor(project.spendPercent)}`}>
              {project.spendPercent}%
            </span>
          </div>
          <Progress
            value={Math.min(project.spendPercent, 100)}
            className={`h-2.5 ${getBudgetProgressColor(project.spendPercent)}`}
            data-testid={`progress-budget-${project.id}`}
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span data-testid={`text-spent-${project.id}`}>
              Spent: {formatZAR(project.spent)}
            </span>
            <span data-testid={`text-budget-${project.id}`}>
              Budget: {formatZAR(project.budget)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm" data-testid={`schedule-section-${project.id}`}>
          <span className="text-muted-foreground flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" />
            Schedule
          </span>
          <div className="flex items-center gap-2 flex-1 ml-3">
            <Progress
              value={project.schedulePct}
              className="h-2 flex-1 [&>div]:bg-blue-500"
              data-testid={`progress-schedule-${project.id}`}
            />
            <span className="font-medium text-xs w-10 text-right" data-testid={`text-schedule-pct-${project.id}`}>
              {project.schedulePct}%
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {project.openRisks > 0 && (
            <Badge
              variant="destructive"
              className="text-xs flex items-center gap-1"
              data-testid={`badge-risks-${project.id}`}
            >
              <AlertTriangle className="w-3 h-3" />
              {project.openRisks} Risk{project.openRisks !== 1 ? "s" : ""}
            </Badge>
          )}
          {project.openRisks === 0 && (
            <Badge
              variant="outline"
              className="text-xs text-muted-foreground"
              data-testid={`badge-risks-${project.id}`}
            >
              0 Risks
            </Badge>
          )}

          {project.voPending > 0 && (
            <Badge
              variant="secondary"
              className="text-xs flex items-center gap-1 bg-amber-50 text-amber-600 border-amber-200"
              data-testid={`badge-vo-${project.id}`}
            >
              <CircleDollarSign className="w-3 h-3" />
              VO: {formatZAR(project.voPending)}
            </Badge>
          )}

          {project.openEscalations > 0 && (
            <Badge
              variant="destructive"
              className="text-xs flex items-center gap-1 bg-red-600"
              data-testid={`badge-escalations-${project.id}`}
            >
              <ShieldAlert className="w-3 h-3" />
              {project.openEscalations} Escalation{project.openEscalations !== 1 ? "s" : ""}
            </Badge>
          )}

        </div>
      </div>
    </Card>
  );
}

function ProjectCardSkeleton() {
  return (
    <Card className="p-4">
      <Skeleton className="h-6 w-3/4 mb-2" />
      <Skeleton className="h-4 w-1/3 mb-4" />
      <Skeleton className="h-3 w-full mb-2" />
      <Skeleton className="h-3 w-full mb-3" />
      <div className="flex gap-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-20" />
      </div>
    </Card>
  );
}

export default function PMOnTheGoHome() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, isRefetching } = useQuery<{ projects: PmProject[] }>({
    queryKey: ["/api/pm-otg/projects"],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 30_000,
  });

  const projects = data?.projects || [];

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/pm-otg/projects"] });
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 sm:py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2
          className="text-xl sm:text-2xl font-heading font-bold"
          data-testid="text-pm-otg-title"
        >
          My Active Projects — Control View
        </h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRefresh}
          disabled={isRefetching}
          data-testid="btn-refresh-projects"
          className="shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${isRefetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3" data-testid="loading-projects">
          <ProjectCardSkeleton />
          <ProjectCardSkeleton />
          <ProjectCardSkeleton />
        </div>
      )}

      {isError && (
        <Card className="p-6 border-destructive/50" data-testid="error-projects">
          <div className="flex items-center gap-3 text-destructive">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-medium">Failed to load projects</p>
              <p className="text-sm text-muted-foreground mt-1">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={handleRefresh}
            data-testid="btn-retry-projects"
          >
            Try Again
          </Button>
        </Card>
      )}

      {!isLoading && !isError && projects.length === 0 && (
        <Card className="p-8 flex flex-col items-center justify-center text-center" data-testid="empty-projects">
          <ArrowRight className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-lg font-medium">No projects assigned</p>
          <p className="text-sm text-muted-foreground mt-1">
            Contact your Program Manager to be assigned to projects.
          </p>
        </Card>
      )}

      {!isLoading && !isError && projects.length > 0 && (
        <div className="space-y-3" data-testid="project-list">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onClick={() => navigate(`/pm/on-the-go/project/${project.id}`)}
            />
          ))}
        </div>
      )}

      {!isLoading && projects.length > 0 && (
        <p className="text-xs text-muted-foreground text-center pt-2" data-testid="text-project-count">
          {projects.length} project{projects.length !== 1 ? "s" : ""} assigned
        </p>
      )}
    </div>
  );
}
