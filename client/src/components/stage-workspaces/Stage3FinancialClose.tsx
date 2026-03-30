import { StageWorkspaceShell } from "./StageWorkspaceShell";
import { StageDataForm, type FieldDef } from "./StageDataForm";
import { DecisionLog } from "./DecisionLog";
import { CurrentGateCard } from "@/components/stage-lifecycle/CurrentGateCard";
import { DependencyList } from "@/components/stage-lifecycle/DependencyList";
import { ExceptionDialog } from "@/components/stage-lifecycle/ExceptionDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useStageDetail } from "@/hooks/use-stage-lifecycle";
import { useStageData, useSaveStageData } from "@/hooks/use-stage-data";
import { useState } from "react";
import { FileText, ShieldAlert, ChevronDown, ChevronRight, CheckCircle2, Circle } from "lucide-react";
import { EvidenceRequestPanel } from "./EvidenceRequestPanel";
import { QueryRouter } from "./QueryRouter";
import { ClientCommitmentTracker } from "./ClientCommitmentTracker";

const STAGE_CODE = "S03_SIGNATURE_FINANCIAL_CLOSE";

interface TrackConfig {
  key: string;
  label: string;
  fields: FieldDef[];
}

const TRACKS: TrackConfig[] = [
  {
    key: "cost_proposal",
    label: "Track 1 — Cost Proposal Signed",
    fields: [
      { key: "cost_proposal_signed", label: "Signed", type: "boolean" },
      { key: "cost_proposal_signed_date", label: "Signed Date", type: "date" },
      { key: "cost_proposal_document_url", label: "Document URL", type: "text", placeholder: "Link to signed document" },
    ],
  },
  {
    key: "epc",
    label: "Track 2 — EPC Contract Signed",
    fields: [
      { key: "epc_contract_signed", label: "Signed", type: "boolean" },
      { key: "epc_contract_signed_date", label: "Signed Date", type: "date" },
      { key: "epc_contract_document_url", label: "Document URL", type: "text", placeholder: "Link to signed document" },
    ],
  },
  {
    key: "funding",
    label: "Track 3 — Funding Contract Signed",
    fields: [
      { key: "funding_contract_signed", label: "Signed", type: "boolean" },
      { key: "funding_contract_signed_date", label: "Signed Date", type: "date" },
      { key: "funding_contract_document_url", label: "Document URL", type: "text", placeholder: "Link to signed document" },
      { key: "funding_type", label: "Funding Type", type: "select", options: [
        { value: "self_funded", label: "Self-funded" },
        { value: "fedgroup", label: "FedGroup" },
        { value: "other", label: "Other" },
      ]},
      { key: "funding_partner_status", label: "Partner Status", type: "text" },
    ],
  },
  {
    key: "om",
    label: "Track 4 — O&M Contract Signed",
    fields: [
      { key: "om_contract_signed", label: "Signed", type: "boolean" },
      { key: "om_contract_signed_date", label: "Signed Date", type: "date" },
      { key: "om_contract_document_url", label: "Document URL", type: "text", placeholder: "Link to signed document" },
    ],
  },
];

const ADDITIONAL_FIELDS: FieldDef[] = [
  { key: "financial_close_status", label: "Financial Close Status", type: "select", options: [
    { value: "pending", label: "Pending" },
    { value: "in_progress", label: "In Progress" },
    { value: "conditions_open", label: "Conditions Open" },
    { value: "closed", label: "Closed" },
  ]},
  { key: "conditions_precedent_open_count", label: "Open Conditions Precedent", type: "number" },
  { key: "conditions_precedent_notes", label: "Conditions Precedent Notes", type: "textarea" },
  { key: "commercial_exception_count", label: "Commercial Exception Count", type: "number" },
  { key: "contract_changes_from_proposal_text", label: "Changes from Proposal", type: "textarea", placeholder: "Summary of changes from original proposal" },
  { key: "margin_bridge_text", label: "Margin Bridge (Proposal vs Contracted)", type: "textarea" },
  { key: "key_obligations_for_pm_text", label: "Key Obligations for PM", type: "textarea", placeholder: "Key delivery obligations to handover" },
  { key: "execution_enablement_status", label: "Execution Enablement Status", type: "select", options: [
    { value: "not_ready", label: "Not Ready" },
    { value: "partially_ready", label: "Partially Ready" },
    { value: "ready", label: "Ready" },
  ]},
  { key: "contractual_dates_text", label: "Contractual Dates", type: "textarea" },
  { key: "fedgroup_status", label: "FedGroup Status (if applicable)", type: "text" },
  { key: "ppa_status", label: "PPA Status (if applicable)", type: "text" },
  { key: "isa_status", label: "ISA Status (if applicable)", type: "text" },
];

interface Stage3Props {
  projectId: number;
  isAdmin?: boolean;
}

export function Stage3FinancialClose({ projectId, isAdmin }: Stage3Props) {
  const { data: stageDetail } = useStageDetail(projectId, STAGE_CODE);
  const { data: stageDataResult } = useStageData(projectId, STAGE_CODE);
  const saveMutation = useSaveStageData(projectId, STAGE_CODE);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [exceptionReqCode, setExceptionReqCode] = useState<string>();
  const [expandedTracks, setExpandedTracks] = useState<Set<string>>(new Set(["cost_proposal"]));

  if (!stageDetail?.stage) return null;

  const stageData = stageDataResult?.data || {};
  const evidence = stageDetail.evidence || [];
  const tracksEnabled = (stageData.tracks_enabled || {}) as Record<string, boolean>;

  const toggleTrackEnabled = (trackKey: string) => {
    const updated = { ...tracksEnabled, [trackKey]: !tracksEnabled[trackKey] };
    saveMutation.mutate({ tracks_enabled: updated });
  };

  const toggleExpanded = (key: string) => {
    setExpandedTracks(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <>
      <StageWorkspaceShell
        projectId={projectId}
        stageCode={STAGE_CODE}
        stageName="Stage 3: Signature & Financial Close"
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
            {/* Deliverable Tracks */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Deliverable Tracks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {TRACKS.map(track => {
                  const enabled = tracksEnabled[track.key] !== false; // default enabled
                  const signed = stageData[track.fields[0].key];
                  const isExpanded = expandedTracks.has(track.key);

                  return (
                    <div key={track.key} className="rounded border">
                      <div className="flex items-center gap-2 p-2">
                        <Switch
                          checked={enabled}
                          onCheckedChange={() => toggleTrackEnabled(track.key)}
                          className="scale-75"
                        />
                        <Collapsible open={isExpanded && enabled} onOpenChange={() => toggleExpanded(track.key)} className="flex-1">
                          <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium w-full text-left" disabled={!enabled}>
                            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            <span className={!enabled ? "text-muted-foreground line-through" : ""}>{track.label}</span>
                            <span className="ml-auto">
                              {signed ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Circle className="h-4 w-4 text-gray-300" />}
                            </span>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="p-2 pt-1">
                              <StageDataForm
                                projectId={projectId}
                                stageCode={STAGE_CODE}
                                title=""
                                fields={track.fields}
                                data={stageData}
                              />
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Additional Fields */}
            <StageDataForm
              projectId={projectId}
              stageCode={STAGE_CODE}
              title="Financial Close Details"
              fields={ADDITIONAL_FIELDS}
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
                    Expected: signed agreements, financial close notice, conditions precedent list, commercial exceptions register.
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
                  PM cannot receive a clean handover (Stage 4) if commercial changes are not translated into delivery implications.
                  Financial Close gates PD-PM Handover. Bypass allowed with admin override + reason.
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
