import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useProjectStages, useInitializeStages, useAdvanceToStage, type StageDashboardPayload } from "@/hooks/use-stage-lifecycle";
import { STAGE_SEQUENCE } from "@shared/utils/stage-state-machine";
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
  const statusLabel = STATUS_LABELS[currentStage.stageStatus] || currentStage.stageStatus;
  const statusColor = STATUS_COLORS[currentStage.stageStatus] || "bg-gray-100 text-gray-700";

  const currentSeq = STAGE_SEQUENCE[currentStage.stageCode as keyof typeof STAGE_SEQUENCE] || 1;
  const advanceTargets = ORDERED_STAGE_CODES.filter(code => {
    const seq = STAGE_SEQUENCE[code as keyof typeof STAGE_SEQUENCE];
    return seq > currentSeq;
  });

  const handleAdvance = () => {
    if (!selectedTarget) return;
    advanceMutation.mutate(
      { targetStageCode: selectedTarget, reason: advanceReason || undefined },
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
              Advance this project to the stage it's actually at. All earlier stages will be marked as completed (Progressed). This is logged in the decision register.
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
                </strong> stage(s) will be marked as Progressed (skipped). The target stage will be set to In Progress.
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason <span className="text-muted-foreground font-normal">(optional)</span></label>
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
              disabled={!selectedTarget || advanceMutation.isPending}
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
