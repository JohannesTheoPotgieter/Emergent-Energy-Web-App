import { StageWorkspaceShell } from "./StageWorkspaceShell";
import { StageDataForm, type FieldDef } from "./StageDataForm";
import { DecisionLog } from "./DecisionLog";
import { CurrentGateCard } from "@/components/stage-lifecycle/CurrentGateCard";
import { DependencyList } from "@/components/stage-lifecycle/DependencyList";
import { ExceptionDialog } from "@/components/stage-lifecycle/ExceptionDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStageDetail } from "@/hooks/use-stage-lifecycle";
import { useStageData, useSaveStageData } from "@/hooks/use-stage-data";
import { useState } from "react";
import { FileText, ShieldAlert, Clock, CheckCircle2, XCircle, AlertTriangle, Plus, Trash2 } from "lucide-react";

const STAGE_CODE = "S08_OM_HANDOVER";

const FIELDS: FieldDef[] = [
  { key: "om_handover_checklist_status", label: "O&M Handover Checklist Status", type: "select", options: [
    { value: "not_started", label: "Not Started" },
    { value: "in_progress", label: "In Progress" },
    { value: "complete", label: "Complete" },
  ]},
  { key: "as_builts_uploaded", label: "As-Builts Uploaded", type: "boolean" },
  { key: "warranties_uploaded", label: "Warranties Uploaded", type: "boolean" },
  { key: "om_manual_uploaded", label: "O&M Manual Uploaded", type: "boolean" },
  { key: "serial_numbers_uploaded", label: "Serial Numbers Uploaded", type: "boolean" },
  { key: "targets_confirmed", label: "Targets Confirmed", type: "boolean" },
  { key: "monitoring_access_confirmed", label: "Monitoring Access Confirmed", type: "boolean" },
  { key: "training_complete", label: "Training Complete", type: "boolean" },
  { key: "om_handover_meeting_date", label: "O&M Handover Meeting Date", type: "date", required: true },
  { key: "om_handover_minutes_url", label: "O&M Handover Minutes URL", type: "text", placeholder: "Link to meeting minutes" },
  { key: "matriarch_acceptance_status", label: "Matriarch Acceptance Status", type: "select", required: true, options: [
    { value: "accepted", label: "Accepted" },
    { value: "accepted_with_reservations", label: "Accepted with Reservations" },
    { value: "rejected", label: "Rejected" },
  ]},
  { key: "matriarch_acceptance_date", label: "Matriarch Acceptance Date", type: "date" },
  { key: "matriarch_rejection_reason", label: "Matriarch Rejection Reason", type: "textarea" },
  { key: "asset_manager_assigned_user_id", label: "Asset Manager User ID", type: "number" },
  { key: "soft_monitoring_end_date", label: "Soft Monitoring End Date", type: "date" },
  { key: "review_sla_start_date", label: "Review SLA Start Date", type: "date" },
  { key: "review_sla_due_date", label: "Review SLA Due Date", type: "date" },
  { key: "open_workmanship_items_count", label: "Open Workmanship Items", type: "number" },
];

interface ReservedItem {
  item: string;
  owner: string;
  deadline: string;
  status: string;
}

interface Stage8Props {
  projectId: number;
  isAdmin?: boolean;
}

export function Stage8OmHandover({ projectId, isAdmin }: Stage8Props) {
  const { data: stageDetail } = useStageDetail(projectId, STAGE_CODE);
  const { data: stageDataResult } = useStageData(projectId, STAGE_CODE);
  const saveMutation = useSaveStageData(projectId, STAGE_CODE);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [exceptionReqCode, setExceptionReqCode] = useState<string>();

  if (!stageDetail?.stage) return null;

  const stageData = stageDataResult?.data || {};
  const evidence = stageDetail.evidence || [];

  const acceptanceStatus = stageData.matriarch_acceptance_status;
  const acceptanceBadge = acceptanceStatus === "accepted"
    ? { className: "bg-green-100 text-green-700", icon: CheckCircle2, label: "Matriarch: Accepted" }
    : acceptanceStatus === "accepted_with_reservations"
    ? { className: "bg-amber-100 text-amber-700", icon: AlertTriangle, label: "Matriarch: Accepted with Reservations" }
    : acceptanceStatus === "rejected"
    ? { className: "bg-red-100 text-red-700", icon: XCircle, label: "Matriarch: Rejected" }
    : null;

  // SLA clock logic
  const slaDueDate = stageData.review_sla_due_date ? new Date(stageData.review_sla_due_date) : null;
  const slaStartDate = stageData.review_sla_start_date ? new Date(stageData.review_sla_start_date) : null;
  const now = new Date();
  const slaOverdue = slaDueDate && now > slaDueDate && acceptanceStatus !== "accepted" && acceptanceStatus !== "accepted_with_reservations";
  const slaActive = slaStartDate && slaDueDate && now <= slaDueDate && !acceptanceStatus;

  // Reserved items
  const reservedItems: ReservedItem[] = stageData.reserved_items_json || [];

  const handleAddReservedItem = () => {
    const updated = [...reservedItems, { item: "", owner: "", deadline: "", status: "open" }];
    saveMutation.mutate({ ...stageData, reserved_items_json: updated });
  };

  const handleRemoveReservedItem = (index: number) => {
    const updated = reservedItems.filter((_, i) => i !== index);
    saveMutation.mutate({ ...stageData, reserved_items_json: updated });
  };

  const handleUpdateReservedItem = (index: number, field: keyof ReservedItem, value: string) => {
    const updated = reservedItems.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    );
    saveMutation.mutate({ ...stageData, reserved_items_json: updated });
  };

  return (
    <>
      <StageWorkspaceShell
        projectId={projectId}
        stageCode={STAGE_CODE}
        stageName="Stage 8: O&M Handover"
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
            {slaActive && (
              <Badge className="bg-blue-100 text-blue-700">
                <Clock className="mr-1 h-3 w-3" /> SLA Active
              </Badge>
            )}
            {slaOverdue && (
              <Badge className="bg-red-100 text-red-700">
                <Clock className="mr-1 h-3 w-3" /> SLA Overdue
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
              title="O&M Handover Data"
              fields={FIELDS}
              data={stageData}
            />

            {/* Reserved Items */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Reserved Items</CardTitle>
                  <Button size="sm" variant="outline" onClick={handleAddReservedItem} disabled={saveMutation.isPending}>
                    <Plus className="mr-1 h-3 w-3" /> Add Item
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {reservedItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No reserved items. Add items if handover is accepted with reservations.</p>
                ) : (
                  <div className="space-y-2">
                    {reservedItems.map((item, index) => (
                      <div key={index} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-center text-sm">
                        <Input
                          value={item.item}
                          onChange={(e) => handleUpdateReservedItem(index, "item", e.target.value)}
                          placeholder="Item description"
                          className="h-8 text-xs"
                        />
                        <Input
                          value={item.owner}
                          onChange={(e) => handleUpdateReservedItem(index, "owner", e.target.value)}
                          placeholder="Owner"
                          className="h-8 text-xs"
                        />
                        <Input
                          type="date"
                          value={item.deadline}
                          onChange={(e) => handleUpdateReservedItem(index, "deadline", e.target.value)}
                          className="h-8 text-xs"
                        />
                        <Badge variant="outline" className="text-[10px]">{item.status}</Badge>
                        <Button size="sm" variant="ghost" onClick={() => handleRemoveReservedItem(index)}>
                          <Trash2 className="h-3 w-3 text-red-500" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Evidence */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Evidence & Documents</CardTitle>
              </CardHeader>
              <CardContent>
                {evidence.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Expected: as-built drawings, warranty certificates, O&M manual, serial number register,
                    monitoring access credentials, training records, handover meeting minutes.
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
                    EE soft monitoring must NOT be switched off before O&M acceptance. The soft monitoring end date
                    can only be set AFTER Matriarch acceptance status is accepted or accepted with reservations.
                  </p>
                  <p>
                    Minimum review SLA: 5-7 business days for O&M to review handover pack. PM owns client communication
                    until formal O&M handover is accepted. Bypass allowed with admin override + reason.
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
