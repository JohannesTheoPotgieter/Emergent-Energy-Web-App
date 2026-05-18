import { StageWorkspaceShell } from "./StageWorkspaceShell";
import { StageDataForm, type FieldDef } from "./StageDataForm";
import { DecisionLog } from "./DecisionLog";
import { CurrentGateCard } from "@/components/stage-lifecycle/CurrentGateCard";
import { DependencyList } from "@/components/stage-lifecycle/DependencyList";
import { ExceptionDialog } from "@/components/stage-lifecycle/ExceptionDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStageDetail } from "@/hooks/use-stage-lifecycle";
import { useStageData } from "@/hooks/use-stage-data";
import { useState } from "react";
import { FileText, ShieldAlert } from "lucide-react";
import { EvidenceRequestPanel } from "./EvidenceRequestPanel";
import { QueryRouter } from "./QueryRouter";
import { ClientCommitmentTracker } from "./ClientCommitmentTracker";

const STAGE_CODE = "S01_FIRST_ASSESSMENT";

const FIELDS: FieldDef[] = [
  { key: "client_enquiry_source", label: "Client Enquiry / Lead Source", type: "text", required: true },
  { key: "client_need_summary", label: "Client Need Summary", type: "textarea", required: true, placeholder: "Business driver, energy goals, timeline expectations" },
  { key: "site_address", label: "Site Address", type: "text", required: true },
  { key: "site_type", label: "Site Type", type: "select", required: true, options: [
    { value: "roof", label: "Roof" },
    { value: "ground", label: "Ground" },
    { value: "carport", label: "Carport" },
    { value: "other", label: "Other" },
  ]},
  { key: "grid_connection_type", label: "Grid Connection Type", type: "select", required: true, options: [
    { value: "eskom", label: "Eskom" },
    { value: "municipal", label: "Municipal" },
    { value: "embedded", label: "Embedded" },
  ]},
  { key: "estimated_kwp", label: "Estimated System Size (kWp)", type: "number", required: true },
  { key: "funding_model_indication", label: "Funding Model Indication", type: "select", required: true, options: [
    { value: "self_funded", label: "Self-funded" },
    { value: "third_party", label: "Third-party" },
    { value: "ppa", label: "PPA" },
    { value: "lease", label: "Lease" },
  ]},
  { key: "client_risk_flag", label: "Client Creditworthiness / Risk Flag", type: "select", required: true, options: [
    { value: "low", label: "Low Risk" },
    { value: "medium", label: "Medium Risk" },
    { value: "high", label: "High Risk" },
  ]},
  { key: "strategic_fit", label: "Strategic Fit (aligns with EE target market)", type: "select", required: true, options: [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ]},
  { key: "go_no_go_recommendation", label: "Go / No-Go Recommendation", type: "select", required: true, options: [
    { value: "go", label: "Go — Progress to Cost Proposal & Design" },
    { value: "park", label: "Park — Put on hold" },
    { value: "no_go", label: "No-Go — Close" },
  ]},
  { key: "go_no_go_reason", label: "Go / No-Go Reason", type: "textarea", required: true },
  { key: "assessment_date", label: "Assessment Date", type: "date", required: true },
];

interface Stage1Props {
  projectId: number;
  isAdmin?: boolean;
}

export function Stage1FirstAssessment({ projectId, isAdmin }: Stage1Props) {
  const { data: stageDetail } = useStageDetail(projectId, STAGE_CODE);
  const { data: stageDataResult } = useStageData(projectId, STAGE_CODE);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [exceptionReqCode, setExceptionReqCode] = useState<string>();

  if (!stageDetail?.stage) return null;

  const stageData = stageDataResult?.data || {};
  const evidence = stageDetail.evidence || [];

  return (
    <>
      <StageWorkspaceShell
        projectId={projectId}
        stageCode={STAGE_CODE}
        stageName="Stage 1: First Assessment"
        stage={stageDetail.stage}
        isAdmin={isAdmin}
        actions={
          <Button size="sm" variant="outline" onClick={() => { setExceptionReqCode(undefined); setExceptionDialogOpen(true); }}>
            <ShieldAlert className="mr-1 h-3 w-3" /> Request Exception
          </Button>
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
            <StageDataForm
              projectId={projectId}
              stageCode={STAGE_CODE}
              title="First Assessment Data"
              fields={FIELDS}
              data={stageData}
            />

            {/* Evidence */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Evidence & Documents</CardTitle>
              </CardHeader>
              <CardContent>
                {evidence.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No evidence uploaded yet. Expected: client enquiry record, site photos, preliminary correspondence.</p>
                ) : (
                  <div className="space-y-1">
                    {evidence.map((e) => (
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
          </>
        }
        right={
          <>
            <DependencyList projectId={projectId} stageCode={STAGE_CODE} />
            <DecisionLog projectId={projectId} stageCode={STAGE_CODE} />
            <EvidenceRequestPanel projectId={projectId} stageCode={STAGE_CODE} />
            <QueryRouter projectId={projectId} stageCode={STAGE_CODE} />
            <ClientCommitmentTracker projectId={projectId} stageCode={STAGE_CODE} />

            {/* Collaboration Rule */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Collaboration Rule</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  First Assessment cannot progress to Cost Proposal & Design until PD confirms Go recommendation.
                  Bypass allowed with admin override + reason.
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
