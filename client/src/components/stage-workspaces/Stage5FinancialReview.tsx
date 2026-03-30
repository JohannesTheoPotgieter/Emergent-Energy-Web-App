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
import { FileText, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";

const STAGE_CODE = "S05_FINANCIAL_REVIEW";

const FIELDS: FieldDef[] = [
  { key: "baseline_revenue", label: "Baseline Revenue (R)", type: "number", required: true },
  { key: "baseline_cos", label: "Baseline COS (R)", type: "number", required: true },
  { key: "committed_cost", label: "Committed Cost (R)", type: "number", required: true },
  { key: "actual_invoiced_cost", label: "Actual Invoiced Cost (R)", type: "number", required: true },
  { key: "forecast_cost", label: "Forecast Cost (R)", type: "number", required: true },
  { key: "forecast_margin_pct", label: "Forecast Margin %", type: "number", required: true },
  { key: "margin_drift_pct", label: "Margin Drift %", type: "number" },
  { key: "open_vo_count", label: "Open Variation Orders", type: "number" },
  { key: "procurement_risk_text", label: "Procurement Risk", type: "textarea", placeholder: "Key procurement risks..." },
  { key: "po_payment_dependencies_text", label: "PO / Payment Dependencies", type: "textarea" },
  { key: "milestone_evidence_status", label: "Milestone Evidence Status", type: "select", options: [
    { value: "not_started", label: "Not Started" },
    { value: "partial", label: "Partial" },
    { value: "complete", label: "Complete" },
  ]},
  { key: "variance_commentary_text", label: "Variance Commentary", type: "textarea", placeholder: "Explain any material variances..." },
  { key: "financial_review_notes", label: "Financial Review Notes", type: "textarea" },
  { key: "financial_review_status", label: "Financial Review Status", type: "select", required: true, options: [
    { value: "pending", label: "Pending" },
    { value: "in_review", label: "In Review" },
    { value: "approved", label: "Approved" },
    { value: "escalated", label: "Escalated" },
  ]},
  { key: "financial_review_date", label: "Financial Review Date", type: "date", required: true },
];

interface Stage5Props {
  projectId: number;
  isAdmin?: boolean;
}

export function Stage5FinancialReview({ projectId, isAdmin }: Stage5Props) {
  const { data: stageDetail } = useStageDetail(projectId, STAGE_CODE);
  const { data: stageDataResult } = useStageData(projectId, STAGE_CODE);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [exceptionReqCode, setExceptionReqCode] = useState<string>();

  if (!stageDetail?.stage) return null;

  const stageData = stageDataResult?.data || {};
  const evidence = stageDetail.evidence || [];
  const marginDrift = stageData.margin_drift_pct || 0;

  return (
    <>
      <StageWorkspaceShell
        projectId={projectId}
        stageCode={STAGE_CODE}
        stageName="Stage 5: Financial Review"
        stage={stageDetail.stage}
        isAdmin={isAdmin}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => { setExceptionReqCode(undefined); setExceptionDialogOpen(true); }}>
              <ShieldAlert className="mr-1 h-3 w-3" /> Request Exception
            </Button>
            {marginDrift !== 0 && (
              <Badge className={marginDrift < 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}>
                {marginDrift < 0 ? <TrendingDown className="mr-1 h-3 w-3" /> : <TrendingUp className="mr-1 h-3 w-3" />}
                Margin Drift: {marginDrift > 0 ? "+" : ""}{marginDrift}%
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
              title="Financial Review Data"
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
                    Expected: cost reports, variation approvals, PO documentation.
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

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Collaboration Rule</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Financial review should create actions for other teams directly rather than becoming a separate finance-only conversation.
                  Review actions flow outward to PM, Engineering, Procurement. Bypass allowed with admin override + reason.
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
