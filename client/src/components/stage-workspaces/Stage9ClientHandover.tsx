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
import { FileText, ShieldAlert, CheckCircle2, XCircle, AlertTriangle, CalendarClock } from "lucide-react";

const STAGE_CODE = "S09_CLIENT_HANDOVER";

const FIELDS: FieldDef[] = [
  { key: "client_handover_pack_status", label: "Client Handover Pack Status", type: "select", options: [
    { value: "not_started", label: "Not Started" },
    { value: "in_progress", label: "In Progress" },
    { value: "complete", label: "Complete" },
  ]},
  { key: "client_handover_pack_delivered", label: "Handover Pack Delivered", type: "boolean" },
  { key: "client_training_complete", label: "Client Training Complete", type: "boolean" },
  { key: "open_items_text", label: "Open Items", type: "textarea", placeholder: "List any open items..." },
  { key: "remaining_snag_obligations_text", label: "Remaining Snag Obligations", type: "textarea", placeholder: "Snags with resolution timelines..." },
  { key: "warranty_route_confirmed", label: "Warranty Route Confirmed", type: "boolean" },
  { key: "defects_contact_confirmed", label: "Defects Contact Confirmed", type: "boolean" },
  { key: "sseg_status_for_client", label: "SSEG Status for Client", type: "text" },
  { key: "operating_instructions_delivered", label: "Operating Instructions Delivered", type: "boolean" },
  { key: "om_contact_transferred", label: "O&M Contact Transferred", type: "boolean" },
  { key: "client_handover_meeting_date", label: "Client Handover Meeting Date", type: "date", required: true },
  { key: "client_handover_minutes_url", label: "Client Handover Minutes URL", type: "text", placeholder: "Link to meeting minutes" },
  { key: "client_acceptance_status", label: "Client Acceptance Status", type: "select", required: true, options: [
    { value: "accepted", label: "Accepted" },
    { value: "accepted_with_reservations", label: "Accepted with Reservations" },
    { value: "not_accepted", label: "Not Accepted" },
  ]},
  { key: "client_feedback_text", label: "Client Feedback", type: "textarea", placeholder: "Capture client feedback..." },
  { key: "client_handover_gate_status", label: "Client Handover Gate Status", type: "select", options: [
    { value: "not_ready", label: "Not Ready" },
    { value: "ready", label: "Ready" },
    { value: "passed", label: "Passed" },
  ]},
];

interface Stage9Props {
  projectId: number;
  isAdmin?: boolean;
}

export function Stage9ClientHandover({ projectId, isAdmin }: Stage9Props) {
  const { data: stageDetail } = useStageDetail(projectId, STAGE_CODE);
  const { data: stageDataResult } = useStageData(projectId, STAGE_CODE);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [exceptionReqCode, setExceptionReqCode] = useState<string>();

  if (!stageDetail?.stage) return null;

  const stageData = stageDataResult?.data || {};
  const evidence = stageDetail.evidence || [];

  const clientAcceptance = stageData.client_acceptance_status;
  const acceptanceBadge = clientAcceptance === "accepted"
    ? { className: "bg-green-100 text-green-700", icon: CheckCircle2, label: "Client: Accepted" }
    : clientAcceptance === "accepted_with_reservations"
    ? { className: "bg-amber-100 text-amber-700", icon: AlertTriangle, label: "Client: Accepted with Reservations" }
    : clientAcceptance === "not_accepted"
    ? { className: "bg-red-100 text-red-700", icon: XCircle, label: "Client: Not Accepted" }
    : null;

  return (
    <>
      <StageWorkspaceShell
        projectId={projectId}
        stageCode={STAGE_CODE}
        stageName="Stage 9: Client Handover"
        stage={stageDetail.stage}
        isAdmin={isAdmin}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => { setExceptionReqCode(undefined); setExceptionDialogOpen(true); }}>
              <ShieldAlert className="mr-1 h-3 w-3" /> Request Exception
            </Button>
            {acceptanceBadge && (
              <Badge className={acceptanceBadge.className}>
                <acceptanceBadge.icon className="mr-1 h-3 w-3" />
                {acceptanceBadge.label}
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
              title="Client Handover Data"
              fields={FIELDS}
              data={stageData}
            />

            {/* Auto-trigger notice */}
            {clientAcceptance === "accepted" && (
              <Card className="border-green-200 bg-green-50">
                <CardContent className="py-3">
                  <div className="flex items-center gap-2 text-sm text-green-700">
                    <CalendarClock className="h-4 w-4" />
                    <span>Client accepted. A 3-month post-handover review (Stage 10) should be auto-scheduled with review_due_date = handover date + 3 months.</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Evidence */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Evidence & Documents</CardTitle>
              </CardHeader>
              <CardContent>
                {evidence.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Expected: client handover pack, client sign-off form, training records, list of remaining snags
                    and resolution dates, client feedback record, SSEG confirmation letter, operating instructions.
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
                <div className="space-y-2 text-xs text-muted-foreground">
                  <p>
                    Internal O&M acceptance (Stage 8) must happen before external client confidence messaging goes out.
                    O&M acceptance gates Client Handover. Bypass allowed with admin override + reason.
                  </p>
                  <p>
                    When Client Handover is marked as accepted, a 3-month post-handover review record (Stage 10)
                    is automatically created with review_due_date = client_handover_date + 3 months and review_status = scheduled.
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
