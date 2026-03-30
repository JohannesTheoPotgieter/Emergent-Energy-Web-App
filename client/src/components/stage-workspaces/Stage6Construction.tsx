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
import { FileText, ShieldAlert, HardHat } from "lucide-react";

const STAGE_CODE = "S06_CONSTRUCTION";

const FIELDS: FieldDef[] = [
  { key: "construction_start_date_planned", label: "Planned Start Date", type: "date", required: true },
  { key: "construction_start_date_actual", label: "Actual Start Date", type: "date" },
  { key: "construction_schedule_url", label: "Construction Schedule URL", type: "text", placeholder: "Link to schedule (Gantt or equivalent)" },
  { key: "installer_name", label: "Installer Name", type: "text", required: true },
  { key: "installer_contract_status", label: "Installer Contract Status", type: "select", options: [
    { value: "not_started", label: "Not Started" },
    { value: "in_progress", label: "In Progress" },
    { value: "signed", label: "Signed" },
    { value: "active", label: "Active" },
  ]},
  { key: "installer_mobilised", label: "Installer Mobilised", type: "boolean" },
  { key: "material_inflow_status", label: "Material Inflow Status", type: "select", options: [
    { value: "on_track", label: "On Track" },
    { value: "delayed", label: "Delayed" },
    { value: "critical", label: "Critical" },
  ]},
  { key: "key_equipment_status", label: "Key Equipment Status", type: "select", options: [
    { value: "on_track", label: "On Track" },
    { value: "delayed", label: "Delayed" },
    { value: "critical", label: "Critical" },
  ]},
  { key: "site_access_confirmed", label: "Site Access Confirmed", type: "boolean" },
  { key: "weekly_progress_reporting_active", label: "Weekly Progress Reporting Active", type: "boolean" },
  { key: "open_tq_count", label: "Open Technical Queries (TQ)", type: "number" },
  { key: "open_variation_count", label: "Open Variation Orders", type: "number" },
  { key: "hse_plan_approved", label: "HSE Plan Approved", type: "boolean" },
  { key: "hse_induction_complete", label: "HSE Induction Complete", type: "boolean" },
  { key: "sseg_application_status", label: "SSEG Application Status", type: "text" },
  { key: "practical_completion_target", label: "Practical Completion Target", type: "date", required: true },
  { key: "construction_progress_pct", label: "Construction Progress %", type: "number", required: true },
  { key: "construction_gate_status", label: "Construction Gate Status", type: "select", options: [
    { value: "not_ready", label: "Not Ready" },
    { value: "ready", label: "Ready" },
    { value: "passed", label: "Passed" },
  ]},
];

interface Stage6Props {
  projectId: number;
  isAdmin?: boolean;
}

export function Stage6Construction({ projectId, isAdmin }: Stage6Props) {
  const { data: stageDetail } = useStageDetail(projectId, STAGE_CODE);
  const { data: stageDataResult } = useStageData(projectId, STAGE_CODE);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [exceptionReqCode, setExceptionReqCode] = useState<string>();

  if (!stageDetail?.stage) return null;

  const stageData = stageDataResult?.data || {};
  const evidence = stageDetail.evidence || [];
  const progressPct = stageData.construction_progress_pct || 0;

  const progressColor =
    progressPct >= 75 ? "bg-green-100 text-green-700" :
    progressPct >= 25 ? "bg-amber-100 text-amber-700" :
    "bg-red-100 text-red-700";

  return (
    <>
      <StageWorkspaceShell
        projectId={projectId}
        stageCode={STAGE_CODE}
        stageName="Stage 6: Construction"
        stage={stageDetail.stage}
        isAdmin={isAdmin}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => { setExceptionReqCode(undefined); setExceptionDialogOpen(true); }}>
              <ShieldAlert className="mr-1 h-3 w-3" /> Request Exception
            </Button>
            <Badge className={progressColor}>
              <HardHat className="mr-1 h-3 w-3" />
              Progress: {progressPct}%
            </Badge>
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
              title="Construction Data"
              fields={FIELDS}
              data={stageData}
            />

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Evidence & Documents</CardTitle>
              </CardHeader>
              <CardContent>
                {evidence.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Expected: construction schedule, IFC drawings, material delivery confirmations, site progress photos, HSE induction records, PO confirmations, weekly progress reports, TQ log, variation register.
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
                  Construction cannot progress to Commissioning until: practical completion target is set,
                  installer sign-off received, HSE safe-to-energise checklist started, and critical equipment
                  confirmed on site. Weekly client updates are enforced from this stage onward.
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
