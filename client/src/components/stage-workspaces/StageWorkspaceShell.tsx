import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTransitionStage } from "@/hooks/use-stage-lifecycle";
import { getValidNextStates } from "@shared/utils/stage-state-machine";
import type { StageStatus, ProjectStageInstance } from "@shared/schema";
import { ArrowRight, Loader2, Calendar, User, Clock } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  READY_FOR_REVIEW: "Ready for Review",
  APPROVED: "Approved",
  PROGRESSED: "Progressed",
  EXCEPTION_APPROVED: "Exception Approved",
  BLOCKED: "Blocked",
};

const STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  READY_FOR_REVIEW: "bg-amber-100 text-amber-700",
  APPROVED: "bg-green-100 text-green-700",
  PROGRESSED: "bg-emerald-100 text-emerald-700",
  EXCEPTION_APPROVED: "bg-purple-100 text-purple-700",
  BLOCKED: "bg-red-100 text-red-700",
};

interface StageWorkspaceShellProps {
  projectId: number;
  stageCode: string;
  stageName: string;
  stage: ProjectStageInstance;
  isAdmin?: boolean;
  left: React.ReactNode;
  middle: React.ReactNode;
  right: React.ReactNode;
  actions?: React.ReactNode;
}

export function StageWorkspaceShell({
  projectId,
  stageCode,
  stageName,
  stage,
  isAdmin = false,
  left,
  middle,
  right,
  actions,
}: StageWorkspaceShellProps) {
  const transitionMutation = useTransitionStage(projectId);
  const currentStatus = stage.stageStatus as StageStatus;
  const validNext = getValidNextStates(currentStatus, isAdmin);

  const handleTransition = (newStatus: StageStatus) => {
    transitionMutation.mutate({ stageCode, newStatus, isOverride: isAdmin });
  };

  const daysInStage = stage.startedAt
    ? Math.floor((Date.now() - new Date(stage.startedAt).getTime()) / 86400000)
    : 0;

  return (
    <div className="space-y-4">
      {/* Stage Header */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{stageName}</h2>
          <Badge className={STATUS_COLORS[currentStatus] || "bg-gray-100"}>
            {STATUS_LABELS[currentStatus] || currentStatus}
          </Badge>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Progress value={stage.readinessPct} className="h-2 w-20" />
            <span>{stage.readinessPct}%</span>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          {stage.stageOwnerUserId && (
            <span className="flex items-center gap-1"><User className="h-3 w-3" /> Owner: #{stage.stageOwnerUserId}</span>
          )}
          {stage.targetExitDate && (
            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Target: {stage.targetExitDate}</span>
          )}
          {daysInStage > 0 && (
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {daysInStage}d in stage</span>
          )}
          {stage.updatedAt && (
            <span>Updated: {new Date(stage.updatedAt).toLocaleDateString()}</span>
          )}
        </div>

        {/* Actions row */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {actions}
          <div className="ml-auto flex gap-1">
            {validNext.map(next => (
              <Button
                key={next}
                size="sm"
                variant={next === "APPROVED" || next === "PROGRESSED" ? "default" : "outline"}
                onClick={() => handleTransition(next)}
                disabled={transitionMutation.isPending}
              >
                {transitionMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                <ArrowRight className="mr-1 h-3 w-3" />
                {STATUS_LABELS[next] || next}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Three-column layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-3 space-y-4">{left}</div>
        <div className="lg:col-span-5 space-y-4">{middle}</div>
        <div className="lg:col-span-4 space-y-4">{right}</div>
      </div>
    </div>
  );
}
