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
import { FileText, ShieldAlert, CheckCircle2 } from "lucide-react";
import { EvidenceRequestPanel } from "./EvidenceRequestPanel";
import { QueryRouter } from "./QueryRouter";
import { ClientCommitmentTracker } from "./ClientCommitmentTracker";

const STAGE_CODE = "S02_DESIGN_COST_PROPOSAL";

const FIELDS: FieldDef[] = [
  { key: "site_visit_complete", label: "Site Visit Complete", type: "boolean" },
  { key: "site_visit_date", label: "Site Visit Date", type: "date" },
  { key: "site_accuracy_status", label: "Site Accuracy Status", type: "select", options: [
    { value: "pending", label: "Pending" },
    { value: "verified", label: "Verified" },
    { value: "issues_found", label: "Issues Found" },
  ]},
  { key: "design_basis_complete", label: "Design Basis Complete", type: "boolean", required: true },
  { key: "design_basis_doc_url", label: "Design Basis Document URL", type: "text", placeholder: "Link to design basis document" },
  { key: "system_design_version", label: "System Design Version", type: "text", placeholder: "e.g. v1.0" },
  { key: "cost_model_complete", label: "Cost Model Complete", type: "boolean", required: true },
  { key: "cost_model_file_url", label: "Cost Model File URL", type: "text", placeholder: "Link to cost model" },
  { key: "margin_pct", label: "Margin %", type: "number", required: true },
  { key: "major_risks_text", label: "Major Risks", type: "textarea", placeholder: "Key risks identified..." },
  { key: "assumptions_text", label: "Assumptions", type: "textarea", placeholder: "Design and cost assumptions..." },
  { key: "engineering_review_status", label: "Engineering Review Status", type: "select", options: [
    { value: "not_requested", label: "Not Requested" },
    { value: "requested", label: "Requested" },
    { value: "in_review", label: "In Review" },
    { value: "approved", label: "Approved" },
    { value: "changes_required", label: "Changes Required" },
  ]},
  { key: "commercial_review_status", label: "Commercial Review Status", type: "select", options: [
    { value: "not_requested", label: "Not Requested" },
    { value: "requested", label: "Requested" },
    { value: "in_review", label: "In Review" },
    { value: "approved", label: "Approved" },
    { value: "changes_required", label: "Changes Required" },
  ]},
  { key: "proposal_ready_status", label: "Proposal Ready Status", type: "select", options: [
    { value: "draft", label: "Draft" },
    { value: "in_review", label: "In Review" },
    { value: "ready", label: "Ready" },
  ]},
  { key: "pd_confirmed", label: "PD Confirmed", type: "boolean", required: true },
  { key: "design_engineer_confirmed", label: "Design Engineer Confirmed", type: "boolean", required: true },
];

interface Stage2Props {
  projectId: number;
  isAdmin?: boolean;
}

export function Stage2DesignCostProposal({ projectId, isAdmin }: Stage2Props) {
  const { data: stageDetail } = useStageDetail(projectId, STAGE_CODE);
  const { data: stageDataResult } = useStageData(projectId, STAGE_CODE);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [exceptionReqCode, setExceptionReqCode] = useState<string>();

  if (!stageDetail?.stage) return null;

  const stageData = stageDataResult?.data || {};
  const evidence = stageDetail.evidence || [];
  const dualConfirmed = stageData.pd_confirmed && stageData.design_engineer_confirmed;

  return (
    <>
      <StageWorkspaceShell
        projectId={projectId}
        stageCode={STAGE_CODE}
        stageName="Stage 2: Cost Proposal & Design"
        stage={stageDetail.stage}
        isAdmin={isAdmin}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => { setExceptionReqCode(undefined); setExceptionDialogOpen(true); }}>
              <ShieldAlert className="mr-1 h-3 w-3" /> Request Exception
            </Button>
            {dualConfirmed && (
              <Badge className="bg-green-100 text-green-700">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Dual Confirmation Complete
              </Badge>
            )}
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
            <StageDataForm
              projectId={projectId}
              stageCode={STAGE_CODE}
              title="Cost Proposal & Design Data"
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
                  <p className="text-sm text-muted-foreground">
                    Expected: proposal versions, structural pre-check, single-line diagram, cost model, design basis document.
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
                  Proposal cannot be marked ready until PD and Design Engineer both confirm site accuracy, solution fit, and costing basis.
                  This is a gate, not just a PD ticket. Bypass allowed with admin override + reason.
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
