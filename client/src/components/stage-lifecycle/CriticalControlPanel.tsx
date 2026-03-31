import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectStages, useInitializeStages, type StageDashboardPayload } from "@/hooks/use-stage-lifecycle";
import { generateStatusSentence, getUnsatisfiedBlockers, computeDaysInStage } from "@shared/utils/stage-state-machine";
import { useToast } from "@/hooks/use-toast";
import {
  Clock,
  AlertTriangle,
  ShieldAlert,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  PlayCircle,
} from "lucide-react";

interface CriticalControlPanelProps {
  projectId: number;
  onViewGate?: () => void;
  isAdmin?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  READY_FOR_REVIEW: "bg-amber-100 text-amber-700",
  APPROVED: "bg-green-100 text-green-700",
  PROGRESSED: "bg-emerald-100 text-emerald-800",
  EXCEPTION_APPROVED: "bg-orange-100 text-orange-700",
  BLOCKED: "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  READY_FOR_REVIEW: "Ready for Review",
  APPROVED: "Approved",
  PROGRESSED: "Progressed",
  EXCEPTION_APPROVED: "Exception Approved",
  BLOCKED: "Blocked",
};

const STAGE_LABELS: Record<string, string> = {
  S01_FIRST_ASSESSMENT: "1. First Assessment",
  S02_DESIGN_COST_PROPOSAL: "2. Design & Cost Proposal",
  S03_SIGNATURE_FINANCIAL_CLOSE: "3. Financial Close",
  S04_PD_PM_HANDOVER: "4. PD → PM Handover",
  S05_FINANCIAL_REVIEW: "5. Financial Review",
  S06_CONSTRUCTION: "6. Construction",
  S07_COMMISSIONING: "7. Commissioning",
  S08_OM_HANDOVER: "8. O&M Handover",
  S09_CLIENT_HANDOVER: "9. Client Handover",
  S10_POST_HANDOVER_REVIEW: "10. Post-Handover Review",
};

export function CriticalControlPanel({ projectId, onViewGate, isAdmin = false }: CriticalControlPanelProps) {
  const { data, isLoading } = useProjectStages(projectId);
  const initMutation = useInitializeStages(projectId);
  const { toast } = useToast();

  if (isLoading) {
    return (
      <div className="border-b bg-muted/30 px-4 py-2">
        <div className="flex items-center gap-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
    );
  }

  if (!data?.currentStage) {
    return (
      <div className="border-b bg-muted/30 px-4 py-2 flex items-center gap-3">
        <span className="text-sm text-muted-foreground">No stage lifecycle initialized for this project.</span>
        {isAdmin && (
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs gap-1.5"
            onClick={() => {
              initMutation.mutate(undefined, {
                onSuccess: () => toast({ title: "Stage lifecycle initialized" }),
                onError: (err: Error) => toast({ title: "Failed to initialize", description: err.message, variant: "destructive" }),
              });
            }}
            disabled={initMutation.isPending}
            data-testid="button-initialize-lifecycle"
          >
            {initMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
            Initialize Lifecycle
          </Button>
        )}
      </div>
    );
  }

  const { currentStage, statusSentence, openExceptionCount, openDependencyCount, requirements } = data;
  const stageLabel = STAGE_LABELS[currentStage.stageCode] || currentStage.stageCode;
  const statusLabel = STATUS_LABELS[currentStage.stageStatus] || currentStage.stageStatus;
  const statusColor = STATUS_COLORS[currentStage.stageStatus] || "bg-gray-100 text-gray-700";

  return (
    <div className="border-b bg-muted/30 px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {/* Stage name */}
        <span className="text-sm font-semibold">{stageLabel}</span>

        {/* Status badge */}
        <Badge variant="outline" className={`text-xs ${statusColor}`}>
          {statusLabel}
        </Badge>

        {/* Readiness */}
        <div className="flex items-center gap-2 min-w-[120px]">
          <Progress value={currentStage.readinessPct} className="h-2 w-20" />
          <span className="text-xs text-muted-foreground">{currentStage.readinessPct}%</span>
        </div>

        {/* Days in stage */}
        {currentStage.daysInStage > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {currentStage.daysInStage}d in stage
          </div>
        )}

        {/* Open exceptions */}
        {openExceptionCount > 0 && (
          <div className="flex items-center gap-1">
            <ShieldAlert className="h-3.5 w-3.5 text-orange-500" />
            <span className="text-xs text-orange-600">{openExceptionCount} exception{openExceptionCount !== 1 ? 's' : ''}</span>
          </div>
        )}

        {/* Open dependencies */}
        {openDependencyCount > 0 && (
          <div className="flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs text-amber-600">{openDependencyCount} waiting</span>
          </div>
        )}

        {/* View Gate button */}
        {onViewGate && (
          <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={onViewGate}>
            View Gate
            <ChevronRight className="ml-1 h-3 w-3" />
          </Button>
        )}
      </div>

      {/* The one sentence that matters */}
      <p className="mt-1 text-xs text-muted-foreground italic">{statusSentence}</p>
    </div>
  );
}
