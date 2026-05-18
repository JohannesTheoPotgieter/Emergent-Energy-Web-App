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
import { FileText, ShieldAlert, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

const STAGE_CODE = "S10_POST_HANDOVER_REVIEW";

const FIELDS: FieldDef[] = [
  { key: "review_due_date", label: "Review Due Date", type: "date", required: true },
  { key: "review_status", label: "Review Status", type: "select", required: true, options: [
    { value: "scheduled", label: "Scheduled" },
    { value: "in_progress", label: "In Progress" },
    { value: "completed", label: "Completed" },
    { value: "overdue", label: "Overdue" },
  ]},
  { key: "review_owner_user_id", label: "Review Owner User ID", type: "number" },
  { key: "review_meeting_date", label: "Review Meeting Date", type: "date" },
  { key: "actual_vs_expected_summary", label: "Actual vs Expected Summary", type: "textarea", placeholder: "Performance comparison (actual kWh vs modelled)..." },
  { key: "loss_attribution_text", label: "Loss Attribution", type: "textarea", placeholder: "Shading, soiling, equipment, grid, other..." },
  { key: "client_feedback_text", label: "Client Feedback", type: "textarea" },
  { key: "quality_issue_summary", label: "Quality Issue Summary", type: "textarea", placeholder: "Warranty trends, defect patterns..." },
  { key: "compliance_issue_summary", label: "Compliance Issue Summary", type: "textarea" },
  { key: "matriarch_feedback_text", label: "Matriarch / O&M Feedback", type: "textarea" },
  { key: "engineering_lessons_text", label: "Engineering Lessons", type: "textarea", placeholder: "Design assumptions vs reality..." },
  { key: "pd_lessons_text", label: "PD Lessons", type: "textarea", placeholder: "Commercial / client relationship feedback..." },
  { key: "pm_lessons_text", label: "PM Lessons", type: "textarea", placeholder: "Execution and process lessons..." },
  { key: "relationship_risk_level", label: "Relationship Risk Level", type: "select", required: true, options: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ]},
  { key: "upsell_opportunity_text", label: "Upsell Opportunity", type: "textarea", placeholder: "Sales expansion opportunity assessment..." },
  { key: "lessons_learned_text", label: "Lessons Learned Summary", type: "textarea" },
  { key: "follow_up_action_count", label: "Follow-up Actions Count", type: "number" },
  { key: "review_completed_date", label: "Review Completed Date", type: "date" },
  { key: "review_report_url", label: "Review Report URL", type: "text", placeholder: "Link to review report" },
];

interface Stage10Props {
  projectId: number;
  isAdmin?: boolean;
}

export function Stage10PostHandoverReview({ projectId, isAdmin }: Stage10Props) {
  const { data: stageDetail } = useStageDetail(projectId, STAGE_CODE);
  const { data: stageDataResult } = useStageData(projectId, STAGE_CODE);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [exceptionReqCode, setExceptionReqCode] = useState<string>();

  if (!stageDetail?.stage) return null;

  const stageData = stageDataResult?.data || {};
  const evidence = stageDetail.evidence || [];

  const reviewStatus = stageData.review_status;
  const riskLevel = stageData.relationship_risk_level;

  const reviewStatusBadge = reviewStatus === "completed"
    ? { className: "bg-green-100 text-green-700", icon: CheckCircle2, label: "Review: Completed" }
    : reviewStatus === "overdue"
    ? { className: "bg-red-100 text-red-700", icon: AlertTriangle, label: "Review: Overdue" }
    : reviewStatus === "in_progress"
    ? { className: "bg-amber-100 text-amber-700", icon: Clock, label: "Review: In Progress" }
    : reviewStatus === "scheduled"
    ? { className: "bg-blue-100 text-blue-700", icon: Clock, label: "Review: Scheduled" }
    : null;

  const riskBadge = riskLevel === "high"
    ? { className: "bg-red-100 text-red-700", label: "Risk: High" }
    : riskLevel === "medium"
    ? { className: "bg-amber-100 text-amber-700", label: "Risk: Medium" }
    : riskLevel === "low"
    ? { className: "bg-green-100 text-green-700", label: "Risk: Low" }
    : null;

  return (
    <>
      <StageWorkspaceShell
        projectId={projectId}
        stageCode={STAGE_CODE}
        stageName="Stage 9: 3 Months Post HO Review"
        stage={stageDetail.stage}
        isAdmin={isAdmin}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => { setExceptionReqCode(undefined); setExceptionDialogOpen(true); }}>
              <ShieldAlert className="mr-1 h-3 w-3" /> Request Exception
            </Button>
            {reviewStatusBadge && (
              <Badge className={reviewStatusBadge.className}>
                <reviewStatusBadge.icon className="mr-1 h-3 w-3" />
                {reviewStatusBadge.label}
              </Badge>
            )}
            {riskBadge && (
              <Badge className={riskBadge.className}>
                <AlertTriangle className="mr-1 h-3 w-3" />
                {riskBadge.label}
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
              title="3 Months Post HO Review Data"
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
                    Expected: performance report (actual vs modelled), client feedback record, follow-up action list,
                    lessons learned summary, review meeting minutes.
                  </p>
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

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Collaboration Rule</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <p>
                    3-month reviews are automatically scheduled at the moment of client handover acceptance.
                    Exco is informed of all completed reviews and accepts key lessons.
                  </p>
                  <p>
                    Systemic issues repeated across multiple projects should be flagged for process change.
                    Lessons learned should be linked to stage definitions and templates for future projects.
                  </p>
                </div>
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
