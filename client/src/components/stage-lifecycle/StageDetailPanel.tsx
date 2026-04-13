import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useStageDetail, useTransitionStage, useHydrateChecklist, useUpdateRequirement, useInitializeStages } from "@/hooks/use-stage-lifecycle";
import { useToast } from "@/hooks/use-toast";
import { CurrentGateCard } from "./CurrentGateCard";
import { ExceptionDialog } from "./ExceptionDialog";
import { DependencyList } from "./DependencyList";
import { Stage1FirstAssessment } from "@/components/stage-workspaces/Stage1FirstAssessment";
import { Stage2DesignCostProposal } from "@/components/stage-workspaces/Stage2DesignCostProposal";
import { Stage3FinancialClose } from "@/components/stage-workspaces/Stage3FinancialClose";
import { Stage4PdPmHandover } from "@/components/stage-workspaces/Stage4PdPmHandover";
import { Stage5FinancialReview } from "@/components/stage-workspaces/Stage5FinancialReview";
import { Stage6Construction } from "@/components/stage-workspaces/Stage6Construction";
import { Stage7Commissioning } from "@/components/stage-workspaces/Stage7Commissioning";
import { Stage8OmHandover } from "@/components/stage-workspaces/Stage8OmHandover";
import { Stage9ClientHandover } from "@/components/stage-workspaces/Stage9ClientHandover";
import { Stage10PostHandoverReview } from "@/components/stage-workspaces/Stage10PostHandoverReview";
import { getValidNextStates } from "@shared/utils/stage-state-machine";
import type { StageStatus } from "@shared/schema";
import { Loader2, FileText, ShieldAlert, ArrowRight, Link2, PlayCircle, Milestone } from "lucide-react";

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

// Stage codes that have dedicated workspace components
const STAGE_WORKSPACE_MAP: Record<string, React.ComponentType<{ projectId: number; isAdmin?: boolean }>> = {
  S01_FIRST_ASSESSMENT: Stage1FirstAssessment,
  S02_DESIGN_COST_PROPOSAL: Stage2DesignCostProposal,
  S03_SIGNATURE_FINANCIAL_CLOSE: Stage3FinancialClose,
  S04_PD_PM_HANDOVER: Stage4PdPmHandover,
  S05_FINANCIAL_REVIEW: Stage5FinancialReview,
  S06_CONSTRUCTION: Stage6Construction,
  S07_COMMISSIONING: Stage7Commissioning,
  S08_OM_HANDOVER: Stage8OmHandover,
  S09_CLIENT_HANDOVER: Stage9ClientHandover,
  S10_POST_HANDOVER_REVIEW: Stage10PostHandoverReview,
};

export function StageDetailPanel({ projectId, stageCode, isAdmin = false }: StageDetailPanelProps) {
  const { data, isLoading } = useStageDetail(projectId, stageCode);
  const transitionMutation = useTransitionStage(projectId);
  const hydrateMutation = useHydrateChecklist(projectId);
  const initMutation = useInitializeStages(projectId);
  const { toast } = useToast();
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [exceptionReqCode, setExceptionReqCode] = useState<string | undefined>();
  const [lastTemplatesFound, setLastTemplatesFound] = useState<number | null>(null);

  useEffect(() => {
    setLastTemplatesFound(null);
  }, [projectId, stageCode]);

  if (isLoading) {
    return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading stage...</div>;
  }

  if (!data?.stage) {
    return (
      <Card>
        <CardContent className="py-12 flex flex-col items-center justify-center text-center">
          <div className="rounded-full bg-muted p-3 mb-4">
            <Milestone className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-semibold mb-1">No Stage Lifecycle Found</h3>
          <p className="text-sm text-muted-foreground mb-5 max-w-sm">
            This project does not have a stage lifecycle set up yet. Initialize it to start tracking gates, checklists, and approvals.
          </p>
          {isAdmin && (
            <Button
              onClick={() => {
                initMutation.mutate(undefined, {
                  onSuccess: () => toast({ title: "Stage lifecycle initialized", description: "All stages have been created for this project." }),
                  onError: (err: Error) => toast({ title: "Failed to initialize", description: err.message, variant: "destructive" }),
                });
              }}
              disabled={initMutation.isPending}
              className="gap-2"
              data-testid="button-initialize-lifecycle-main"
            >
              {initMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              Initialize Stage Lifecycle
            </Button>
          )}
          {!isAdmin && (
            <p className="text-xs text-muted-foreground">Contact a COO or admin to initialize this project's lifecycle.</p>
          )}
        </CardContent>
      </Card>
    );
  }

  // If a dedicated workspace exists for this stage, render it
  const WorkspaceComponent = STAGE_WORKSPACE_MAP[stageCode];
  const hasNoRequirements = data.requirements.length === 0;
  const hasNoTemplates = lastTemplatesFound === 0;
  const hydrateHelperText = hydrateMutation.isPending
    ? "Hydrating checklist templates..."
    : hasNoTemplates
      ? "No active checklist templates found for this stage."
      : "Populate checklist from active templates to begin.";
  const hydrateButtonLabel = hydrateMutation.isPending ? "Hydrating..." : hasNoTemplates ? "Recheck Templates" : "Hydrate Checklist";

  const handleHydrate = () => {
    hydrateMutation.mutate(stageCode, {
      onSuccess: (result) => {
        const createdCount = result?.createdCount ?? 0;
        const templatesFound = result?.templatesFound ?? 0;
        setLastTemplatesFound(templatesFound);

        console.info("[stage-lifecycle] hydrate checklist result", {
          stageCode,
          createdCount,
          templatesFound,
        });

        if (templatesFound === 0 || createdCount === 0) {
          toast({
            title: "No templates available",
            description: "No active checklist templates found for this stage.",
          });
          return;
        }

        toast({
          title: "Checklist hydrated",
          description: `Created ${createdCount} requirement${createdCount === 1 ? "" : "s"} for ${stageCode}.`,
        });
      },
      onError: (err: Error) => {
        toast({
          title: "Failed to hydrate checklist",
          description: err.message || "Unable to hydrate stage checklist.",
          variant: "destructive",
        });
      },
    });
  };

  if (WorkspaceComponent) {
    return (
      <div className="space-y-4">
        {/* Hydrate button if no requirements exist */}
        {hasNoRequirements && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleHydrate} disabled={hydrateMutation.isPending}>
              {hydrateMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              {hydrateButtonLabel}
            </Button>
            <span className="text-xs text-muted-foreground">{hydrateHelperText}</span>
          </div>
        )}
        <WorkspaceComponent projectId={projectId} isAdmin={isAdmin} />
      </div>
    );
  }

  // Fallback: Generic stage view (for stages 6-10 until their workspaces are built)
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
          {hasNoRequirements && (
            <Button size="sm" variant="outline" onClick={handleHydrate} disabled={hydrateMutation.isPending}>
              {hydrateMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              {hydrateButtonLabel}
            </Button>
          )}
          {validNext.map(next => (
            <Button
              key={next}
              size="sm"
              variant={next === 'approved' || next === 'progressed' ? 'default' : 'outline'}
              onClick={() => handleTransition(next)}
              disabled={transitionMutation.isPending}
            >
              <ArrowRight className="mr-1 h-3 w-3" />
              {STATUS_LABELS[next] || next}
            </Button>
          ))}
        </div>
      </div>
      {hasNoRequirements && (
        <p className="text-xs text-muted-foreground">{hydrateHelperText}</p>
      )}

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
