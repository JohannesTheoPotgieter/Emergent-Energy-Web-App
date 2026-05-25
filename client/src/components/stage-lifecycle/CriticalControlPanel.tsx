import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useProjectStages, useInitializeStages, useAdvanceToStage, type StageDashboardPayload } from "@/hooks/use-stage-lifecycle";
import { STAGE_SEQUENCE, normalizeStageStatus } from "@shared/utils/stage-state-machine";
import { PHASES } from "@shared/phases";
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
  FastForward,
} from "lucide-react";

interface CriticalControlPanelProps {
  projectId: number;
  onViewGate?: () => void;
  isAdmin?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  not_started: "bg-gray-100 text-gray-700",
  in_progress: "bg-blue-100 text-blue-700",
  ready_for_review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  progressed: "bg-emerald-100 text-emerald-800",
  exception_approved: "bg-orange-100 text-orange-700",
  blocked: "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  ready_for_review: "Ready for Review",
  approved: "Approved",
  progressed: "Progressed",
  exception_approved: "Exception Approved",
  blocked: "Blocked",
};

// Stage labels are derived from the canonical lifecycle in
// shared/phases.ts (single source of truth). Sequential phases are
// prefixed with their displayNumber so the panel reads as "1. First
// Assessment" / "10. Compliance Handover", and terminal branches
// (Hold/Done) are shown without an ordinal. Legacy deprecated codes
// (S04_PD_PM_HANDOVER, S05_FINANCIAL_REVIEW) are added afterwards
// so historical project rows still render a recognisable label.
const STAGE_LABELS: Record<string, string> = {
  ...Object.fromEntries(
    PHASES.map((p) => [
      p.code,
      p.isSequential && p.displayNumber !== null ? `${p.displayNumber}. ${p.label}` : p.label,
    ]),
  ),
  S04_PD_PM_HANDOVER: "PD → PM Handover (legacy)",
  S05_FINANCIAL_REVIEW: "Financial Review (legacy)",
};

const ORDERED_STAGE_CODES = Object.entries(STAGE_SEQUENCE)
  .sort(([, a], [, b]) => a - b)
  .map(([code]) => code);

export function CriticalControlPanel({ projectId, onViewGate, isAdmin = false }: CriticalControlPanelProps) {
  const { data, isLoading } = useProjectStages(projectId);
  const initMutation = useInitializeStages(projectId);
  const advanceMutation = useAdvanceToStage(projectId);
  const { toast } = useToast();
  const [advanceDialogOpen, setAdvanceDialogOpen] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string>("");
  const [advanceReason, setAdvanceReason] = useState("");

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
  const statusKey = normalizeStageStatus(currentStage.stageStatus);
  const statusLabel = STATUS_LABELS[statusKey] || currentStage.stageStatus;
  const statusColor = STATUS_COLORS[statusKey] || "bg-gray-100 text-gray-700";

  // Terminal-aware sequence resolution.
  // STAGE_SEQUENCE assigns 0 to S_HOLD and S_DONE; the prior code used
  // `|| 1` which silently coerced terminal stages to sequence 1, so the
  // "Skip to Stage" dropdown would offer S02..S10 to a project on Done
  // (violating the terminal contract from Task #81). We use `??` so 0
  // remains 0, and explicitly branch terminal stages so:
  //   - S_DONE projects show no advance targets at all (Done is
  //     permanent — resume requires a separate Hold→Resume action).
  //   - S_HOLD projects also show no advance targets here; they should
  //     use the dedicated /stages/resume endpoint to restore previous_phase.
  // Any future "advance from Hold" UI must call resumeProjectFromHold,
  // not the generic advance-to-stage path.
  const isTerminalStage = currentStage.stageCode === "S_HOLD" || currentStage.stageCode === "S_DONE";
  const currentSeq = STAGE_SEQUENCE[currentStage.stageCode as keyof typeof STAGE_SEQUENCE] ?? -1;
  const advanceTargets = isTerminalStage
    ? []
    : ORDERED_STAGE_CODES.filter(code => {
        const seq = STAGE_SEQUENCE[code as keyof typeof STAGE_SEQUENCE];
        // Skip terminal codes from the advance dropdown — they go through
        // the dedicated Hold/Done endpoints, never through advance-to.
        if (code === "S_HOLD" || code === "S_DONE") return false;
        return seq > currentSeq;
      });

  const handleAdvance = () => {
    const trimmedReason = advanceReason.trim();
    if (!selectedTarget || trimmedReason.length === 0) return;
    advanceMutation.mutate(
      { targetStageCode: selectedTarget, reason: trimmedReason },
      {
        onSuccess: (result: any) => {
          const skippedCount = result.skipped?.length || 0;
          toast({
            title: "Project advanced",
            description: `Skipped ${skippedCount} stage${skippedCount !== 1 ? 's' : ''}. Now at ${STAGE_LABELS[result.currentStage] || result.currentStage}.`,
          });
          setAdvanceDialogOpen(false);
          setSelectedTarget("");
          setAdvanceReason("");
        },
        onError: (err: Error) => {
          toast({ title: "Failed to advance", description: err.message, variant: "destructive" });
        },
      },
    );
  };

  return (
    <>
      <div className="border-b bg-muted/30 px-4 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-sm font-semibold">{stageLabel}</span>

          <Badge variant="outline" className={`text-xs ${statusColor}`}>
            {statusLabel}
          </Badge>

          <div className="flex items-center gap-2 min-w-[120px]">
            <Progress value={currentStage.readinessPct} className="h-2 w-20" />
            <span className="text-xs text-muted-foreground">{currentStage.readinessPct}%</span>
          </div>

          {currentStage.daysInStage > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {currentStage.daysInStage}d in stage
            </div>
          )}

          {openExceptionCount > 0 && (
            <div className="flex items-center gap-1">
              <ShieldAlert className="h-3.5 w-3.5 text-orange-500" />
              <span className="text-xs text-orange-600">{openExceptionCount} exception{openExceptionCount !== 1 ? 's' : ''}</span>
            </div>
          )}

          {openDependencyCount > 0 && (
            <div className="flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs text-amber-600">{openDependencyCount} waiting</span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-1">
            {isAdmin && advanceTargets.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => setAdvanceDialogOpen(true)}
                data-testid="button-advance-to-stage"
              >
                <FastForward className="h-3 w-3" />
                Skip to Stage
              </Button>
            )}
            {onViewGate && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onViewGate}>
                View Gate
                <ChevronRight className="ml-1 h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        <p className="mt-1 text-xs text-muted-foreground italic">{statusSentence}</p>
      </div>

      <Dialog open={advanceDialogOpen} onOpenChange={setAdvanceDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Skip to Stage</DialogTitle>
            <DialogDescription>
              Advance this project to the stage it's actually at. All earlier stages will be marked as progressed. This requires COO approval and is logged in the decision register.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Current Stage</label>
              <div className="text-sm text-muted-foreground px-3 py-2 bg-muted/50 rounded-md">
                {stageLabel}
                <Badge variant="outline" className={`ml-2 text-[10px] ${statusColor}`}>{statusLabel}</Badge>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Advance to</label>
              <Select value={selectedTarget} onValueChange={setSelectedTarget}>
                <SelectTrigger data-testid="select-advance-target">
                  <SelectValue placeholder="Select target stage..." />
                </SelectTrigger>
                <SelectContent>
                  {advanceTargets.map(code => (
                    <SelectItem key={code} value={code} data-testid={`option-advance-${code}`}>
                      {STAGE_LABELS[code] || code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedTarget && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                <strong>
                  {ORDERED_STAGE_CODES.filter(c => {
                    const seq = STAGE_SEQUENCE[c as keyof typeof STAGE_SEQUENCE];
                    return seq >= currentSeq && seq < (STAGE_SEQUENCE[selectedTarget as keyof typeof STAGE_SEQUENCE] || 0);
                  }).length}
                </strong> stage(s) will be marked as progressed. The target stage will be set to in progress.
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason <span className="text-destructive">*</span></label>
              <Textarea
                placeholder="e.g. Project already in construction — aligning system with reality"
                value={advanceReason}
                onChange={(e) => setAdvanceReason(e.target.value)}
                rows={2}
                data-testid="input-advance-reason"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAdvanceDialogOpen(false)} data-testid="button-advance-cancel">
              Cancel
            </Button>
            <Button
              onClick={handleAdvance}
              disabled={!selectedTarget || advanceReason.trim().length === 0 || advanceMutation.isPending}
              data-testid="button-advance-confirm"
            >
              {advanceMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FastForward className="mr-1.5 h-3.5 w-3.5" />}
              Advance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
