import { useState, useCallback } from "react";
import { StageWorkspaceShell } from "./StageWorkspaceShell";
import { StageDataForm, type FieldDef } from "./StageDataForm";
import { DecisionLog } from "./DecisionLog";
import { CurrentGateCard } from "@/components/stage-lifecycle/CurrentGateCard";
import { DependencyList } from "@/components/stage-lifecycle/DependencyList";
import { ExceptionDialog } from "@/components/stage-lifecycle/ExceptionDialog";
import { CharterOverview } from "./charter/CharterOverview";
import { CharterStakeholders } from "./charter/CharterStakeholders";
import { CharterScope } from "./charter/CharterScope";
import { CharterSchedule } from "./charter/CharterSchedule";
import { CharterBudget } from "./charter/CharterBudget";
import { CharterRisks } from "./charter/CharterRisks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStageDetail } from "@/hooks/use-stage-lifecycle";
import { useStageData } from "@/hooks/use-stage-data";
import { useProjectCharter, useSaveCharter, useUpdateCharterStatus } from "@/hooks/use-stage-data";
import { FileText, ShieldAlert, Save, Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type { ProjectCharter } from "@shared/schema";
import { AcceptanceWorkflow } from "./AcceptanceWorkflow";
import { ClientCommitmentTracker } from "./ClientCommitmentTracker";
import { EvidenceRequestPanel } from "./EvidenceRequestPanel";
import { QueryRouter } from "./QueryRouter";
import { ClientUpdateEditor } from "./ClientUpdateEditor";

const STAGE_CODE = "S04_PD_PM_HANDOVER";

const STAGE_FIELDS: FieldDef[] = [
  { key: "project_charter_status", label: "Charter Status", type: "select", required: true, options: [
    { value: "draft", label: "Draft" },
    { value: "complete", label: "Complete" },
    { value: "reviewed", label: "Reviewed" },
    { value: "accepted", label: "Accepted" },
  ]},
  { key: "scope_summary_text", label: "Scope Summary", type: "textarea" },
  { key: "commercial_summary_text", label: "Commercial Summary", type: "textarea" },
  { key: "design_pack_url", label: "Design Pack URL", type: "text", placeholder: "Link to design pack" },
  { key: "stakeholder_list_complete", label: "Stakeholder List Complete", type: "boolean" },
  { key: "risk_register_started", label: "Risk Register Started", type: "boolean" },
  { key: "special_conditions_text", label: "Special Conditions", type: "textarea" },
  { key: "long_lead_items_text", label: "Long Lead Items", type: "textarea" },
  { key: "permits_and_approvals_text", label: "Permits & Approvals", type: "textarea" },
  { key: "handover_meeting_date", label: "Handover Meeting Date", type: "date", required: true },
  { key: "handover_minutes_url", label: "Handover Minutes URL", type: "text" },
  { key: "pm_review_status", label: "PM Review Status", type: "select", options: [
    { value: "not_started", label: "Not Started" },
    { value: "in_progress", label: "In Progress" },
    { value: "complete", label: "Complete" },
  ]},
  { key: "pm_acceptance_status", label: "PM Acceptance Status", type: "select", required: true, options: [
    { value: "accepted", label: "Accepted" },
    { value: "accepted_with_reservations", label: "Accepted with Reservations" },
    { value: "rejected", label: "Rejected" },
  ]},
  { key: "pm_rejection_reason", label: "PM Rejection Reason (if rejected)", type: "textarea" },
];

const CHARTER_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-700" },
  complete: { label: "Complete", color: "bg-blue-100 text-blue-700" },
  reviewed: { label: "Reviewed", color: "bg-amber-100 text-amber-700" },
  accepted: { label: "Accepted", color: "bg-green-100 text-green-700" },
};

interface Stage4Props {
  projectId: number;
  isAdmin?: boolean;
}

export function Stage4PdPmHandover({ projectId, isAdmin }: Stage4Props) {
  const { data: stageDetail } = useStageDetail(projectId, STAGE_CODE);
  const { data: stageDataResult } = useStageData(projectId, STAGE_CODE);
  const { data: charterResult } = useProjectCharter(projectId);
  const saveCharterMutation = useSaveCharter(projectId);
  const updateCharterStatusMutation = useUpdateCharterStatus(projectId);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [exceptionReqCode, setExceptionReqCode] = useState<string>();
  const [charterDraft, setCharterDraft] = useState<Partial<ProjectCharter>>({});
  const [charterDirty, setCharterDirty] = useState(false);

  if (!stageDetail?.stage) return null;

  const stageData = stageDataResult?.data || {};
  const evidence = stageDetail.evidence || [];
  const charter = { ...(charterResult?.charter || {}), ...charterDraft };
  const charterStatus = charterResult?.charter?.status || "draft";
  const statusInfo = CHARTER_STATUS_LABELS[charterStatus] || CHARTER_STATUS_LABELS.draft;

  const handleCharterChange = useCallback((field: string, value: any) => {
    setCharterDraft(prev => ({ ...prev, [field]: value }));
    setCharterDirty(true);
  }, []);

  const handleSaveCharter = () => {
    saveCharterMutation.mutate(charterDraft, {
      onSuccess: () => {
        setCharterDraft({});
        setCharterDirty(false);
      },
    });
  };

  const handleCharterStatusUpdate = (status: string) => {
    updateCharterStatusMutation.mutate(status);
  };

  return (
    <>
      <StageWorkspaceShell
        projectId={projectId}
        stageCode={STAGE_CODE}
        stageName="Stage 4: PD → PM Handover"
        stage={stageDetail.stage}
        isAdmin={isAdmin}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => { setExceptionReqCode(undefined); setExceptionDialogOpen(true); }}>
              <ShieldAlert className="mr-1 h-3 w-3" /> Request Exception
            </Button>
            <Badge className={statusInfo.color}>Charter: {statusInfo.label}</Badge>
          </>
        }
        left={
          <CurrentGateCard
            projectId={projectId}
            stageCode={STAGE_CODE}
            onRequestException={(code) => { setExceptionReqCode(code); setExceptionDialogOpen(true); }}
          />
        }
        middle={
          <>
            {/* Charter Form */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Project Charter</CardTitle>
                  <div className="flex items-center gap-2">
                    {charterStatus === "draft" && (
                      <Button size="sm" variant="outline" onClick={() => handleCharterStatusUpdate("complete")}>
                        Mark Complete
                      </Button>
                    )}
                    {charterStatus === "complete" && (
                      <Button size="sm" variant="outline" onClick={() => handleCharterStatusUpdate("reviewed")}>
                        Mark Reviewed
                      </Button>
                    )}
                    {charterStatus === "reviewed" && (
                      <Button size="sm" variant="default" onClick={() => handleCharterStatusUpdate("accepted")}>
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Accept Charter
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={handleSaveCharter}
                      disabled={!charterDirty || saveCharterMutation.isPending}
                      variant={charterDirty ? "default" : "outline"}
                    >
                      {saveCharterMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
                      Save Charter
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="overview" className="w-full">
                  <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
                    <TabsTrigger value="overview" className="text-xs">1. Overview</TabsTrigger>
                    <TabsTrigger value="stakeholders" className="text-xs">2. Stakeholders</TabsTrigger>
                    <TabsTrigger value="scope" className="text-xs">3. Scope</TabsTrigger>
                    <TabsTrigger value="schedule" className="text-xs">4. Schedule</TabsTrigger>
                    <TabsTrigger value="budget" className="text-xs">5. Budget</TabsTrigger>
                    <TabsTrigger value="risks" className="text-xs">6. Risks</TabsTrigger>
                  </TabsList>
                  <TabsContent value="overview"><CharterOverview charter={charter} onChange={handleCharterChange} /></TabsContent>
                  <TabsContent value="stakeholders"><CharterStakeholders charter={charter} onChange={handleCharterChange} /></TabsContent>
                  <TabsContent value="scope"><CharterScope charter={charter} onChange={handleCharterChange} /></TabsContent>
                  <TabsContent value="schedule"><CharterSchedule charter={charter} onChange={handleCharterChange} /></TabsContent>
                  <TabsContent value="budget"><CharterBudget charter={charter} onChange={handleCharterChange} /></TabsContent>
                  <TabsContent value="risks"><CharterRisks charter={charter} onChange={handleCharterChange} /></TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Stage-level fields */}
            <StageDataForm
              projectId={projectId}
              stageCode={STAGE_CODE}
              title="Handover Data"
              fields={STAGE_FIELDS}
              data={stageData}
            />

            {/* PM Acceptance Summary */}
            {stageData.pm_acceptance_status && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">PM Acceptance Decision</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    {stageData.pm_acceptance_status === "accepted" && (
                      <Badge className="bg-green-100 text-green-700"><CheckCircle2 className="mr-1 h-3 w-3" /> Accepted</Badge>
                    )}
                    {stageData.pm_acceptance_status === "accepted_with_reservations" && (
                      <Badge className="bg-amber-100 text-amber-700"><AlertTriangle className="mr-1 h-3 w-3" /> Accepted with Reservations</Badge>
                    )}
                    {stageData.pm_acceptance_status === "rejected" && (
                      <Badge className="bg-red-100 text-red-700"><XCircle className="mr-1 h-3 w-3" /> Rejected</Badge>
                    )}
                  </div>
                  {stageData.pm_rejection_reason && (
                    <p className="mt-2 text-sm text-muted-foreground">{stageData.pm_rejection_reason}</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Acceptance Workflow */}
            <AcceptanceWorkflow projectId={projectId} stageCode={STAGE_CODE} isAdmin={isAdmin} />

            {/* Evidence */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Evidence & Documents</CardTitle>
              </CardHeader>
              <CardContent>
                {evidence.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Expected: charter document, design pack index, stakeholder list, client comms history, handover meeting minutes.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {evidence.map((e: any) => (
                      <div key={e.id} className="flex items-center gap-2 text-sm py-1">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <a href={e.fileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex-1">{e.title}</a>
                        {e.evidenceType && <Badge variant="outline" className="text-[10px]">{e.evidenceType}</Badge>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Weekly Client Update */}
            <ClientUpdateEditor projectId={projectId} />
          </>
        }
        right={
          <>
            <DependencyList projectId={projectId} stageCode={STAGE_CODE} />
            <DecisionLog projectId={projectId} stageCode={STAGE_CODE} />
            <EvidenceRequestPanel projectId={projectId} stageCode={STAGE_CODE} />
            <QueryRouter projectId={projectId} stageCode={STAGE_CODE} />
            <ClientCommitmentTracker projectId={projectId} stageCode={STAGE_CODE} />

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Collaboration Rule</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Handover is NOT "done" when the meeting is held. It is done when the PM confirms readiness and all reserved items are closed.
                  PD remains owner until PM accepts. Bypass allowed with admin override + reason.
                </p>
              </CardContent>
            </Card>
          </>
        }
      />

      <ExceptionDialog
        open={exceptionDialogOpen}
        onOpenChange={setExceptionDialogOpen}
        projectId={projectId}
        stageCode={STAGE_CODE}
        requirementCode={exceptionReqCode}
      />
    </>
  );
}
