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
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FileText, ShieldAlert, CheckCircle2, XCircle, AlertTriangle, ExternalLink } from "lucide-react";

const STAGE_CODE = "S07_COMMISSIONING";

// Gate controls — editable fields (operational, not in workbook)
const FIELDS: FieldDef[] = [
  { key: "commissioning_plan_url", label: "Commissioning Plan URL", type: "text", placeholder: "Link to commissioning plan" },
  { key: "snag_count_open", label: "Open Snags", type: "number" },
  { key: "snag_count_closed", label: "Closed Snags", type: "number" },
  { key: "ncr_count_open", label: "Open NCRs", type: "number" },
  { key: "ncr_count_closed", label: "Closed NCRs", type: "number" },
  { key: "practical_completion_date", label: "Practical Completion Date", type: "date" },
  { key: "techsitter_confirmed", label: "Techsitter Confirmed (EXPLICIT GATE)", type: "boolean", required: true },
  { key: "metering_confirmed", label: "Metering Confirmed (EXPLICIT GATE)", type: "boolean", required: true },
  { key: "monitoring_live", label: "Monitoring Live", type: "boolean" },
  { key: "internet_connectivity_confirmed", label: "Internet Connectivity Confirmed", type: "boolean" },
  { key: "hse_safe_to_energise", label: "HSE Safe to Energise", type: "boolean" },
  { key: "billing_readiness_status", label: "Billing Readiness Status", type: "select", options: [
    { value: "not_ready", label: "Not Ready" },
    { value: "ready", label: "Ready" },
    { value: "confirmed", label: "Confirmed" },
  ]},
  { key: "commissioning_gate_status", label: "Commissioning Gate Status", type: "select", options: [
    { value: "not_ready", label: "Not Ready" },
    { value: "ready", label: "Ready" },
    { value: "passed", label: "Passed" },
  ]},
  { key: "installer_signoff_date", label: "Installer Signoff Date", type: "date" },
  { key: "client_signoff_date", label: "Client Signoff Date", type: "date" },
];

// Fields moved to read-only from commissioning workbook:
// commissioning_date → Project Information sheet D17
// test_results_uploaded → Testing Report section status
// practical_completion_status → derived from overall commissioning
// quality_review_status → QA List section status
// engineering_acceptance_status → Inspection Report section status

interface Stage7Props {
  projectId: number;
  isAdmin?: boolean;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export function Stage7Commissioning({ projectId, isAdmin }: Stage7Props) {
  const { data: stageDetail } = useStageDetail(projectId, STAGE_CODE);
  const { data: stageDataResult } = useStageData(projectId, STAGE_CODE);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [exceptionReqCode, setExceptionReqCode] = useState<string>();

  // Workbook status from commissioning dashboard API (read-only)
  const { data: wbDashboard } = useQuery<any>({
    queryKey: ["commissioning-dashboard", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/commissioning-dashboard/${projectId}`, { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });

  if (!stageDetail?.stage) return null;

  const stageData = stageDataResult?.data || {};
  const evidence = stageDetail.evidence || [];

  const techsitterConfirmed = !!stageData.techsitter_confirmed;
  const meteringConfirmed = !!stageData.metering_confirmed;

  return (
    <>
      <StageWorkspaceShell
        projectId={projectId}
        stageCode={STAGE_CODE}
        stageName="Stage 7: Commissioning"
        stage={stageDetail.stage}
        isAdmin={isAdmin}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => { setExceptionReqCode(undefined); setExceptionDialogOpen(true); }}>
              <ShieldAlert className="mr-1 h-3 w-3" /> Request Exception
            </Button>
            <Badge className={techsitterConfirmed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}>
              {techsitterConfirmed ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
              Techsitter {techsitterConfirmed ? "Confirmed" : "NOT Confirmed"}
            </Badge>
            <Badge className={meteringConfirmed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}>
              {meteringConfirmed ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
              Metering {meteringConfirmed ? "Confirmed" : "NOT Confirmed"}
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
            {/* Workbook Status — read-only, from commissioning dashboard */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  Commissioning Workbook Status
                  <a href={`/commissioning-dashboard/${projectId}`} className="text-xs font-normal text-blue-600 hover:underline flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" /> View full dashboard
                  </a>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {wbDashboard?.sections?.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                    {(wbDashboard.sections as any[]).filter((s: any) => s.isRequired).map((s: any) => (
                      <div key={s.sectionKey} className="border rounded-md p-2">
                        <div className="text-muted-foreground">{s.sectionName}</div>
                        <div className="font-medium mt-0.5 flex items-center gap-1">
                          {s.isCompleteForGate ? <CheckCircle2 className="h-3 w-3 text-green-600" /> : <XCircle className="h-3 w-3 text-red-500" />}
                          {s.rawStatus || s.displayStatus || "Not started"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No commissioning source configured.{" "}
                    <a href={`/commissioning-dashboard/${projectId}`} className="text-blue-600 hover:underline">Configure source</a>
                  </p>
                )}
              </CardContent>
            </Card>

            <StageDataForm
              projectId={projectId}
              stageCode={STAGE_CODE}
              title="Gate Controls"
              fields={FIELDS}
              data={stageData}
            />

            {/* Snag & NCR Summary */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Snag & NCR Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Snags</p>
                    <div className="flex items-center gap-2 mt-1">
                      {(stageData.snag_count_open || 0) > 0 && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          {stageData.snag_count_open} Open
                        </Badge>
                      )}
                      <Badge variant="outline" className="bg-green-50 text-green-700">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        {stageData.snag_count_closed || 0} Closed
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">NCRs</p>
                    <div className="flex items-center gap-2 mt-1">
                      {(stageData.ncr_count_open || 0) > 0 && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          {stageData.ncr_count_open} Open
                        </Badge>
                      )}
                      <Badge variant="outline" className="bg-green-50 text-green-700">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        {stageData.ncr_count_closed || 0} Closed
                      </Badge>
                    </div>
                  </div>
                </div>
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
                    Expected: commissioning plan, test results, snag register, NCR records, practical completion certificate,
                    metering confirmation, monitoring screenshots, HSE safe-to-energise sign-off, COC, PrEng sign-off,
                    datasheets, warranties, O&M agreement, serial number list, photos.
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
                  Commissioning cannot close without: Techsitter/metering confirmation (explicit gates),
                  document pack completeness, quality sign-off, and downstream O&M handover readiness confirmed.
                  Evidence from earlier stages should auto-populate into commissioning evidence requirements.
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
