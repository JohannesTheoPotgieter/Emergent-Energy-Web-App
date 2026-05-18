import {} from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProjectStageInstance } from "@shared/schema";
import { STAGE_SEQUENCE } from "@shared/utils/stage-state-machine";
import { PHASE_BY_CODE } from "@shared/phases";
import { CheckCircle2, Circle, AlertCircle, Loader2, ShieldCheck, XCircle } from "lucide-react";

interface StageTimelineProps {
  stages: (ProjectStageInstance & { daysInStage: number })[];
  currentStageCode: string | null;
  onStageClick?: (stageCode: string) => void;
}

const STAGE_SHORT_LABELS: Record<string, string> = {
  S01_FIRST_ASSESSMENT: "1. Assessment",
  S02_DESIGN_COST_PROPOSAL: "2. Cost & Design",
  S03_SIGNATURE_FINANCIAL_CLOSE: "3. Fin Close",
  S04_PLANNING: "4. Planning",
  S06_CONSTRUCTION: "5. Construction",
  S07_COMMISSIONING: "6. Commissioning",
  S08_OM_HANDOVER: "7. O&M HO",
  S09_CLIENT_HANDOVER: "8. Client HO",
  S10_POST_HANDOVER_REVIEW: "9. 3M Review",
  S9B_COMPLIANCE_HANDOVER: "10. Compliance HO",
  S_HOLD: "Hold",
  S_DONE: "Done",
  // legacy retained for historical rows
  S04_PD_PM_HANDOVER: "3. PD→PM (legacy)",
  S05_FINANCIAL_REVIEW: "Fin Review (legacy)",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  NOT_STARTED: <Circle className="h-5 w-5 text-gray-300" />,
  IN_PROGRESS: <Loader2 className="h-5 w-5 text-blue-500" />,
  READY_FOR_REVIEW: <AlertCircle className="h-5 w-5 text-amber-500" />,
  APPROVED: <CheckCircle2 className="h-5 w-5 text-green-500" />,
  PROGRESSED: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
  EXCEPTION_APPROVED: <ShieldCheck className="h-5 w-5 text-orange-500" />,
  BLOCKED: <XCircle className="h-5 w-5 text-red-500" />,
};

export function StageTimeline({ stages, currentStageCode, onStageClick }: StageTimelineProps) {
  const sorted = [...stages].sort((a, b) => {
    const seqA = STAGE_SEQUENCE[a.stageCode as keyof typeof STAGE_SEQUENCE] || 0;
    const seqB = STAGE_SEQUENCE[b.stageCode as keyof typeof STAGE_SEQUENCE] || 0;
    return seqA - seqB;
  });

  return (
    <TooltipProvider>
      <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
        {sorted.map((stage, i) => {
          const isCurrent = stage.stageCode === currentStageCode;
          const label = STAGE_SHORT_LABELS[stage.stageCode] || PHASE_BY_CODE[stage.stageCode]?.label || stage.stageCode;
          const icon = STATUS_ICON[stage.stageStatus] || <Circle className="h-5 w-5 text-gray-300" />;

          return (
            <div key={stage.stageCode} className="flex items-center">
              {i > 0 && (
                <div className={`h-px w-4 ${stage.stageStatus === 'NOT_STARTED' ? 'bg-gray-200' : 'bg-blue-300'}`} />
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onStageClick?.(stage.stageCode)}
                    className={`flex flex-col items-center gap-0.5 rounded-md px-2 py-1 transition-colors
                      ${isCurrent ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted/50'}
                    `}
                  >
                    {icon}
                    <span className={`text-[10px] leading-tight whitespace-nowrap ${isCurrent ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
                      {label}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{stage.stageStatus.replace(/_/g, ' ')}</p>
                  {stage.readinessPct > 0 && <p className="text-xs">{stage.readinessPct}% ready</p>}
                  {stage.daysInStage > 0 && <p className="text-xs">{stage.daysInStage} days in stage</p>}
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
