import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useStageDetail } from "@/hooks/use-stage-lifecycle";
import type { ProjectStageRequirement } from "@shared/schema";
import { ChevronDown, ChevronRight, CheckCircle2, Circle, AlertCircle, Clock } from "lucide-react";

interface CurrentGateCardProps {
  projectId: number;
  stageCode: string;
  onRequestException?: (requirementCode: string) => void;
}

const REQ_STATUS_ICON: Record<string, React.ReactNode> = {
  COMPLETE: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  NOT_APPLICABLE: <CheckCircle2 className="h-4 w-4 text-gray-400" />,
  WAIVED: <CheckCircle2 className="h-4 w-4 text-amber-400" />,
  IN_PROGRESS: <Clock className="h-4 w-4 text-blue-500" />,
  NOT_STARTED: <Circle className="h-4 w-4 text-gray-300" />,
};

function groupByDepartment(requirements: ProjectStageRequirement[]) {
  const groups: Record<string, ProjectStageRequirement[]> = {};
  for (const req of requirements) {
    if (!groups[req.department]) groups[req.department] = [];
    groups[req.department].push(req);
  }
  return groups;
}

function deptComplete(reqs: ProjectStageRequirement[]): number {
  return reqs.filter(r => ['COMPLETE', 'NOT_APPLICABLE', 'WAIVED'].includes(r.status)).length;
}

export function CurrentGateCard({ projectId, stageCode, onRequestException }: CurrentGateCardProps) {
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

  const grouped = groupByDepartment(data.requirements);
  const departments = Object.keys(grouped).sort();

  const toggleDept = (dept: string) => {
    setExpandedDepts(prev => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Gate Checklist by Department</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {departments.map(dept => {
          const reqs = grouped[dept];
          const completed = deptComplete(reqs);
          const pct = Math.round((completed / reqs.length) * 100);
          const isExpanded = expandedDepts.has(dept);

          return (
            <Collapsible key={dept} open={isExpanded} onOpenChange={() => toggleDept(dept)}>
              <CollapsibleTrigger className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50 text-left">
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span className="text-sm font-medium flex-1">{dept}</span>
                <span className="text-xs text-muted-foreground">{completed}/{reqs.length}</span>
                <Progress value={pct} className="h-1.5 w-16" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="ml-6 space-y-0.5 pb-1">
                  {reqs.map(req => (
                    <div
                      key={req.id}
                      className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${req.blocksGate && req.status !== 'COMPLETE' && req.status !== 'NOT_APPLICABLE' && req.status !== 'WAIVED' ? 'bg-red-50' : ''}`}
                    >
                      {REQ_STATUS_ICON[req.status] || <Circle className="h-4 w-4 text-gray-300" />}
                      <span className="flex-1">{req.itemName}</span>
                      {req.blocksGate && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-red-50 text-red-600 border-red-200">
                          blocks gate
                        </Badge>
                      )}
                      {req.blocksGate && req.status !== 'COMPLETE' && req.status !== 'NOT_APPLICABLE' && onRequestException && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 text-[10px] px-1.5"
                          onClick={() => onRequestException(req.itemCode)}
                        >
                          Exception
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </CardContent>
    </Card>
  );
}
