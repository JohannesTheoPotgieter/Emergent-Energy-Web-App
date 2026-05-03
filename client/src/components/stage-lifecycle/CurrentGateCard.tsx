import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useStageDetail } from "@/hooks/use-stage-lifecycle";
import type { ProjectStageRequirement } from "@shared/schema";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Clock,
  Sparkles,
  ExternalLink,
  RotateCcw,
} from "lucide-react";

interface CurrentGateCardProps {
  projectId: number;
  stageCode: string;
  onRequestException?: (requirementCode: string) => void;
  onRevertToAuto?: (requirementId: number) => void;
}

// Status icons keyed off both casings while the codebase normalizes.
const REQ_STATUS_ICON: Record<string, React.ReactNode> = {
  COMPLETE: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  complete: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  NOT_APPLICABLE: <CheckCircle2 className="h-4 w-4 text-gray-400" />,
  not_applicable: <CheckCircle2 className="h-4 w-4 text-gray-400" />,
  WAIVED: <CheckCircle2 className="h-4 w-4 text-amber-400" />,
  waived: <CheckCircle2 className="h-4 w-4 text-amber-400" />,
  IN_PROGRESS: <Clock className="h-4 w-4 text-blue-500" />,
  in_progress: <Clock className="h-4 w-4 text-blue-500" />,
  NOT_STARTED: <Circle className="h-4 w-4 text-gray-300" />,
  not_started: <Circle className="h-4 w-4 text-gray-300" />,
};

type RequirementWithAuto = ProjectStageRequirement & {
  autoStatus?: string | null;
  autoSourceLabel?: string | null;
  autoSourceRef?: string | null;
  autoEvidenceUrl?: string | null;
  autoConfidence?: string | null;
  autoComputedAt?: string | null;
};

const COMPLETED_STATUSES = new Set(["COMPLETE", "complete", "NOT_APPLICABLE", "not_applicable", "WAIVED", "waived"]);

/** Manual wins. If manual is `not_started` and auto detected something,
 *  the row displays the auto status with a "Detected" badge. */
function effectiveStatus(req: RequirementWithAuto): { status: string; isAuto: boolean } {
  const manual = (req.status ?? "").toLowerCase();
  if (manual === "not_started" && req.autoStatus) {
    return { status: req.autoStatus, isAuto: true };
  }
  return { status: req.status, isAuto: false };
}

function groupByDepartment(requirements: RequirementWithAuto[]) {
  const groups: Record<string, RequirementWithAuto[]> = {};
  for (const req of requirements) {
    if (!groups[req.department]) groups[req.department] = [];
    groups[req.department].push(req);
  }
  return groups;
}

function deptComplete(reqs: RequirementWithAuto[]): number {
  return reqs.filter((r) => COMPLETED_STATUSES.has(effectiveStatus(r).status)).length;
}

function deptAutoCount(reqs: RequirementWithAuto[]): number {
  return reqs.filter((r) => effectiveStatus(r).isAuto).length;
}

export function CurrentGateCard({ projectId, stageCode, onRequestException, onRevertToAuto }: CurrentGateCardProps) {
  const { data, isLoading } = useStageDetail(projectId, stageCode);
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Current Gate</CardTitle></CardHeader>
        <CardContent><div className="text-sm text-muted-foreground">Loading...</div></CardContent>
      </Card>
    );
  }

  if (!data?.requirements?.length) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Current Gate</CardTitle></CardHeader>
        <CardContent><div className="text-sm text-muted-foreground">No checklist items. Hydrate from templates to begin.</div></CardContent>
      </Card>
    );
  }

  const requirements = data.requirements as RequirementWithAuto[];
  const grouped = groupByDepartment(requirements);
  const departments = Object.keys(grouped).sort();

  const totalAuto = requirements.filter((r) => effectiveStatus(r).isAuto).length;

  const toggleDept = (dept: string) => {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  };

  return (
    <TooltipProvider>
      <Card data-testid="card-current-gate">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Gate Checklist by Department</CardTitle>
            {totalAuto > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 bg-violet-50 text-violet-700 border-violet-200 gap-1"
                    data-testid="badge-auto-coverage"
                  >
                    <Sparkles className="h-3 w-3" />
                    {totalAuto} of {requirements.length} auto-populated
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs max-w-xs">
                    These items were detected from existing app data (signed contracts, completed work
                    items, approved drawings, etc.). They count toward gate readiness but the gate is
                    still passed manually by the responsible owner.
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {departments.map((dept) => {
            const reqs = grouped[dept];
            const completed = deptComplete(reqs);
            const auto = deptAutoCount(reqs);
            const pct = Math.round((completed / reqs.length) * 100);
            const isExpanded = expandedDepts.has(dept);

            return (
              <Collapsible key={dept} open={isExpanded} onOpenChange={() => toggleDept(dept)}>
                <CollapsibleTrigger
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50 text-left"
                  data-testid={`button-toggle-dept-${dept}`}
                >
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="text-sm font-medium flex-1">{dept}</span>
                  {auto > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1 py-0 bg-violet-50 text-violet-700 border-violet-200"
                      data-testid={`badge-dept-auto-${dept}`}
                    >
                      <Sparkles className="h-2.5 w-2.5 mr-0.5" />
                      {auto}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">{completed}/{reqs.length}</span>
                  <Progress value={pct} className="h-1.5 w-16" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="ml-6 space-y-0.5 pb-1">
                    {reqs.map((req) => {
                      const eff = effectiveStatus(req);
                      const isCompleted = COMPLETED_STATUSES.has(eff.status);
                      const isManualOverride = !!req.autoStatus && !eff.isAuto;
                      return (
                        <div
                          key={req.id}
                          className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${
                            req.blocksGate && !isCompleted ? "bg-red-50" : ""
                          }`}
                          data-testid={`row-requirement-${req.itemCode}`}
                        >
                          {REQ_STATUS_ICON[eff.status] || <Circle className="h-4 w-4 text-gray-300" />}
                          <span className="flex-1">{req.itemName}</span>

                          {eff.isAuto && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1.5 py-0 bg-violet-50 text-violet-700 border-violet-200 gap-1"
                                  data-testid={`badge-detected-${req.itemCode}`}
                                >
                                  <Sparkles className="h-2.5 w-2.5" />
                                  Detected
                                  {req.autoConfidence === "medium" && <span className="opacity-70">·~</span>}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="left">
                                <p className="text-xs max-w-xs">
                                  {req.autoSourceLabel ?? "Auto-detected from app data"}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          )}

                          {eff.isAuto && req.autoEvidenceUrl && (
                            <a
                              href={req.autoEvidenceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-violet-600 hover:text-violet-800"
                              title="Open source"
                              data-testid={`link-evidence-${req.itemCode}`}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}

                          {isManualOverride && onRevertToAuto && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 text-[10px] px-1.5 text-violet-700"
                                  onClick={() => onRevertToAuto(req.id)}
                                  data-testid={`button-revert-auto-${req.itemCode}`}
                                >
                                  <RotateCcw className="h-3 w-3 mr-0.5" />
                                  Use auto ({req.autoStatus})
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs max-w-xs">
                                  Manual override is currently winning. Revert to use the auto-detected
                                  status from {req.autoSourceLabel ?? "app data"}.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          )}

                          {req.blocksGate && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 bg-red-50 text-red-600 border-red-200"
                              data-testid={`badge-blocks-${req.itemCode}`}
                            >
                              blocks gate
                            </Badge>
                          )}
                          {req.blocksGate && !isCompleted && onRequestException && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 text-[10px] px-1.5"
                              onClick={() => onRequestException(req.itemCode)}
                              data-testid={`button-exception-${req.itemCode}`}
                            >
                              Exception
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
