import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useStageDetail, useTransitionStage, useHydrateChecklist, useUpdateRequirement } from "@/hooks/use-stage-lifecycle";
import { CurrentGateCard } from "./CurrentGateCard";
import { ExceptionDialog } from "./ExceptionDialog";
import { DependencyList } from "./DependencyList";
import { getValidNextStates } from "@shared/utils/stage-state-machine";
import type { StageStatus } from "@shared/schema";
import { Loader2, FileText, ShieldAlert, ArrowRight, Link2 } from "lucide-react";

interface StageDetailPanelProps {
  projectId: number;
  stageCode: string;
  isAdmin?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  READY_FOR_REVIEW: "Ready for Review",
  APPROVED: "Approved",
  PROGRESSED: "Progressed",
  EXCEPTION_APPROVED: "Exception Approved",
  BLOCKED: "Blocked",
};

export function StageDetailPanel({ projectId, stageCode, isAdmin = false }: StageDetailPanelProps) {
  const { data, isLoading } = useStageDetail(projectId, stageCode);
  const transitionMutation = useTransitionStage(projectId);
  const hydrateMutation = useHydrateChecklist(projectId);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [exceptionReqCode, setExceptionReqCode] = useState<string | undefined>();

  if (isLoading) {
    return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading stage...</div>;
  }

  if (!data?.stage) {
    return <div className="p-4 text-sm text-muted-foreground">Stage not found.</div>;
  }

  const { stage, evidence, exceptions, dependencies } = data;
  const currentStatus = stage.stageStatus as StageStatus;
  const validNext = getValidNextStates(currentStatus, isAdmin);

  const handleTransition = (newStatus: StageStatus) => {
    transitionMutation.mutate({
      stageCode,
      newStatus,
      isOverride: isAdmin,
    });
  };

  const handleHydrate = () => {
    hydrateMutation.mutate(stageCode);
  };

  const handleRequestException = (requirementCode: string) => {
    setExceptionReqCode(requirementCode);
    setExceptionDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Status + Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-sm">
          {STATUS_LABELS[currentStatus] || currentStatus}
        </Badge>
        <span className="text-xs text-muted-foreground">Readiness: {stage.readinessPct}%</span>

        <div className="ml-auto flex gap-1">
          {data.requirements.length === 0 && (
            <Button size="sm" variant="outline" onClick={handleHydrate} disabled={hydrateMutation.isPending}>
              {hydrateMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Hydrate Checklist
            </Button>
          )}
          {validNext.map(next => (
            <Button
              key={next}
              size="sm"
              variant={next === 'APPROVED' || next === 'PROGRESSED' ? 'default' : 'outline'}
              onClick={() => handleTransition(next)}
              disabled={transitionMutation.isPending}
            >
              <ArrowRight className="mr-1 h-3 w-3" />
              {STATUS_LABELS[next] || next}
            </Button>
          ))}
        </div>
      </div>

      <Tabs defaultValue="checklist" className="w-full">
        <TabsList>
          <TabsTrigger value="checklist">Checklist</TabsTrigger>
          <TabsTrigger value="evidence">
            Evidence
            {evidence.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px] px-1">{evidence.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="exceptions">
            Exceptions
            {exceptions.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px] px-1">{exceptions.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="dependencies">
            Dependencies
            {dependencies.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px] px-1">{dependencies.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="checklist">
          <CurrentGateCard
            projectId={projectId}
            stageCode={stageCode}
            onRequestException={handleRequestException}
          />
        </TabsContent>

        <TabsContent value="evidence">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Evidence Documents</CardTitle>
            </CardHeader>
            <CardContent>
              {evidence.length === 0 ? (
                <p className="text-sm text-muted-foreground">No evidence uploaded yet.</p>
              ) : (
                <div className="space-y-1">
                  {evidence.map((e: any) => (
                    <div key={e.id} className="flex items-center gap-2 text-sm py-1">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <a href={e.fileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex-1">
                        {e.title}
                      </a>
                      {e.evidenceType && <Badge variant="outline" className="text-[10px]">{e.evidenceType}</Badge>}
                      {e.reviewStatus && <Badge variant="outline" className="text-[10px]">{e.reviewStatus}</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="exceptions">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Exceptions</CardTitle>
                <Button size="sm" variant="outline" onClick={() => { setExceptionReqCode(undefined); setExceptionDialogOpen(true); }}>
                  <ShieldAlert className="mr-1 h-3 w-3" />
                  Request Exception
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {exceptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No exceptions.</p>
              ) : (
                <div className="space-y-2">
                  {exceptions.map((ex: any) => (
                    <div key={ex.id} className="rounded border p-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{ex.status}</Badge>
                        <Badge variant="outline" className="text-[10px]">{ex.riskLevel}</Badge>
                        {ex.requirementCode && <span className="text-xs text-muted-foreground">{ex.requirementCode}</span>}
                      </div>
                      <p className="mt-1">{ex.reasonText}</p>
                      {ex.conditionsText && <p className="mt-1 text-xs text-muted-foreground">Conditions: {ex.conditionsText}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dependencies">
          <DependencyList projectId={projectId} stageCode={stageCode} />
        </TabsContent>
      </Tabs>

      <ExceptionDialog
        open={exceptionDialogOpen}
        onOpenChange={setExceptionDialogOpen}
        projectId={projectId}
        stageCode={stageCode}
        requirementCode={exceptionReqCode}
      />
    </div>
  );
}
