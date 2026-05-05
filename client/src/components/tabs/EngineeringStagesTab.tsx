import { useState, useRef } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Lock,
  Upload,
  Download,
  Trash2,
  FileText,
  ChevronDown,
  ChevronRight,
  Shield,
  Users,
  Target,
  Loader2,
  FolderDown,
  Play,
  FolderOpen,
  HardDrive,
  FileSignature,
  Mail,
} from "lucide-react";
import { exportStagePack, exportAllStagesPack } from "@/lib/stage-export";
import { engFetchRaw as engFetch } from "@/lib/eng-fetch";
import { useAuth } from "@/hooks/use-auth";
import {
  DocumentControlBadge,
  NotForConstructionHint,
} from "@/components/engineering/DocumentControlBadge";
import { DeliverableControlActions } from "@/components/engineering/DeliverableControlActions";
import { deriveControlState, CONTROL_STATE_META } from "@/lib/engineering-control-state";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  not_started: { label: "Not Started", color: "bg-muted text-foreground", icon: Circle },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-700", icon: Clock },
  blocked: { label: "Blocked", color: "bg-red-100 text-red-700", icon: Lock },
  ready_for_review: { label: "Ready for Review", color: "bg-amber-100 text-amber-700", icon: AlertTriangle },
  complete: { label: "Complete", color: "bg-green-100 text-green-700", icon: CheckCircle2 },
};

const TASK_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-muted text-muted-foreground" },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-600" },
  complete: { label: "Complete", color: "bg-green-100 text-green-600" },
  skipped: { label: "Skipped", color: "bg-yellow-100 text-yellow-600" },
};
const STAGE_TO_WORK_ITEM_STATUS: Record<string, string> = {
  pending: "TO DO",
  in_progress: "IN PROGRESS",
  complete: "COMPLETE",
  skipped: "COMPLETE",
};

interface EngineeringStagesTabProps {
  projectId: number;
  projectName: string;
  isAdmin: boolean;
  userRole: string;
}

export default function EngineeringStagesTab({ projectId, projectName, isAdmin, userRole }: EngineeringStagesTabProps) {
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const isCoo = ["COO_ADMIN", "CEO_ADMIN", "admin"].includes(userRole);

  const { data: stagesData, isLoading } = useQuery({
    queryKey: ["eng-stages", projectId],
    queryFn: async () => {
      const res = await engFetch(`/api/projects/${projectId}/eng-stages`);
      if (!res.ok) throw new Error("Failed to fetch stages");
      return res.json();
    },
  });

  const stages = stagesData?.stages || [];

  // CP Signed gate
  const [cpDialogOpen, setCpDialogOpen] = useState(false);
  const [cpEvidenceType, setCpEvidenceType] = useState<"file_upload" | "email_reference">("email_reference");
  const [cpEmailSubject, setCpEmailSubject] = useState("");
  const [cpEmailDate, setCpEmailDate] = useState("");

  const { data: cpStatus } = useQuery<{
    cpSigned: boolean;
    cpSignedDate: string | null;
    cpSignedByName: string | null;
    cpEvidenceType: string | null;
    pmTaskPackCreated: boolean;
    engPostCpTaskPackCreated: boolean;
  }>({
    queryKey: ["cp-status", projectId],
    queryFn: async () => {
      const res = await engFetch(`/api/projects/${projectId}/cp-status`);
      if (!res.ok) return { cpSigned: false, cpSignedDate: null, cpSignedByName: null, cpEvidenceType: null, pmTaskPackCreated: false, engPostCpTaskPackCreated: false };
      return res.json();
    },
  });

  const cpMutation = useMutation({
    mutationFn: async (data: { evidenceType: string; emailSubject?: string; emailDate?: string }) => {
      const res = await engFetch(`/api/projects/${projectId}/mark-cp-signed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed to mark CP signed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["cp-status", projectId] });
      qc.invalidateQueries({ queryKey: ["eng-tasks"] });
      setCpDialogOpen(false);
      setCpEmailSubject("");
      setCpEmailDate("");
      const msg = data.alreadySigned
        ? "CP was already signed."
        : `CP Signed! Created ${data.pmTasksCreated} PM tasks and ${data.engTasksCreated} engineering tasks.`;
      toast({ title: "CP Signed", description: msg });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await engFetch(`/api/projects/${projectId}/eng-stages/generate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast({ title: "Stages generated", description: `${data.stagesCreated} stages with ${data.tasksCreated} tasks created` });
      qc.invalidateQueries({ queryKey: ["eng-stages", projectId] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  if (stages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-lg" data-testid="eng-stages-empty">
        <Target className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No Engineering Stages</h3>
        <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
          Generate the engineering checklist to create all 5 stage templates for this project.
        </p>
        <Button onClick={handleGenerate} disabled={generating} data-testid="btn-generate-stages">
          {generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
          Generate Engineering Checklist
        </Button>
      </div>
    );
  }

  return (
    <>
    <div className="flex gap-4 h-[calc(100vh-300px)] min-h-[500px]" data-testid="eng-stages-panel">
      <div className="w-72 shrink-0 space-y-2 overflow-y-auto pr-2">
        {/* CP Signed Status */}
        <Card className={`${cpStatus?.cpSigned ? "border-green-300 bg-green-50/50 dark:bg-green-950/20" : "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20"}`}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <FileSignature className={`h-4 w-4 ${cpStatus?.cpSigned ? "text-green-600" : "text-amber-600"}`} />
                <span className="text-xs font-semibold">Cost Proposal</span>
              </div>
              <Badge className={`text-[10px] ${cpStatus?.cpSigned ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                {cpStatus?.cpSigned ? "Signed" : "Pending"}
              </Badge>
            </div>
            {cpStatus?.cpSigned ? (
              <div className="text-[10px] text-muted-foreground space-y-0.5">
                <p>Signed {cpStatus.cpSignedDate} by {cpStatus.cpSignedByName || "COO"}</p>
                <p>Evidence: {cpStatus.cpEvidenceType === "email_reference" ? "Email" : "File upload"}</p>
                <div className="flex gap-1 mt-1">
                  {cpStatus.pmTaskPackCreated && <Badge variant="outline" className="text-[9px]">PM Pack</Badge>}
                  {cpStatus.engPostCpTaskPackCreated && <Badge variant="outline" className="text-[9px]">Eng Pack</Badge>}
                </div>
              </div>
            ) : isCoo ? (
              <Button size="sm" className="w-full h-7 text-xs mt-1 bg-amber-600 hover:bg-amber-700" onClick={() => setCpDialogOpen(true)} data-testid="btn-mark-cp-signed">
                Mark CP Signed
              </Button>
            ) : (
              <p className="text-[10px] text-muted-foreground mt-1">COO must mark the Cost Proposal as signed.</p>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Stages</h3>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => exportAllStagesPack(projectId, projectName, stages)}
            data-testid="btn-export-all-stages"
          >
            <FolderDown className="h-3 w-3 mr-1" /> Export All
          </Button>
        </div>
        {stages.map((stage: any) => {
          const cfg = STATUS_CONFIG[stage.status] || STATUS_CONFIG.not_started;
          const Icon = cfg.icon;
          const pct = stage.totalTasks > 0 ? Math.round((stage.completedTasks / stage.totalTasks) * 100) : 0;
          const isSelected = selectedStageId === stage.id;

          return (
            <Card
              key={stage.id}
              className={`cursor-pointer transition-all hover:shadow-md ${isSelected ? "ring-2 ring-primary" : ""}`}
              onClick={() => setSelectedStageId(stage.id)}
              data-testid={`stage-card-${stage.id}`}
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between mb-1">
                  <span className="text-sm font-medium leading-tight">{stage.templateName}</span>
                  <Icon className="h-4 w-4 shrink-0 ml-1" />
                </div>
                <Badge className={`${cfg.color} text-[10px] px-1.5 py-0 mb-2`}>{cfg.label}</Badge>
                <Progress value={pct} className="h-1.5 mb-1" />
                <span className="text-[10px] text-muted-foreground">{stage.completedTasks}/{stage.totalTasks} tasks</span>
                {stage.deliverableCount > 0 && (
                  <span className="text-[10px] text-muted-foreground ml-2">{stage.deliverableCount} files</span>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto border rounded-lg">
        {selectedStageId ? (
          <StageDetail
            stageId={selectedStageId}
            projectId={projectId}
            projectName={projectName}
            isCoo={isCoo}
            userRole={userRole}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="text-sm">Select a stage to view details</p>
          </div>
        )}
      </div>
    </div>

    {/* CP Signed Evidence Dialog */}
    <Dialog open={cpDialogOpen} onOpenChange={setCpDialogOpen}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-amber-600" />
            Mark Cost Proposal as Signed
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (cpMutation.isPending) return;
            if (cpEvidenceType === "email_reference" && !cpEmailSubject.trim()) return;
            cpMutation.mutate({
              evidenceType: cpEvidenceType,
              emailSubject: cpEmailSubject.trim() || undefined,
              emailDate: cpEmailDate || undefined,
            });
          }}
        >
          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="cp-evidence-type" className="text-xs">Evidence Type <span className="text-red-500">*</span></Label>
              <SearchableSelect
                value={cpEvidenceType}
                onValueChange={(v) => setCpEvidenceType(v as any)}
                placeholder="Select..."
                triggerClassName="h-9 mt-1"
                options={[
                  { value: "email_reference", label: "Email Reference" },
                  { value: "file_upload", label: "File Upload" },
                ]}
                data-testid="select-cp-evidence-type"
              />
            </div>
            {cpEvidenceType === "email_reference" && (
              <>
                <div>
                  <Label htmlFor="cp-email-subject" className="text-xs">Email Subject <span className="text-red-500">*</span></Label>
                  <Input
                    id="cp-email-subject"
                    value={cpEmailSubject}
                    onChange={e => setCpEmailSubject(e.target.value)}
                    placeholder="e.g. RE: Cost Proposal - Approved"
                    className="h-9 mt-1"
                    required
                    data-testid="input-cp-email-subject"
                  />
                </div>
                <div>
                  <Label htmlFor="cp-email-date" className="text-xs">Email Date</Label>
                  <Input
                    id="cp-email-date"
                    type="date"
                    value={cpEmailDate}
                    onChange={e => setCpEmailDate(e.target.value)}
                    className="h-9 mt-1"
                    data-testid="input-cp-email-date"
                  />
                </div>
              </>
            )}
            {cpEvidenceType === "file_upload" && (
              <p className="text-xs text-muted-foreground">Upload the signed CP document via the deliverables section, then reference it here.</p>
            )}
            <p className="text-xs text-muted-foreground bg-muted p-2 rounded">
              This will create PM default tasks (6) and Engineering post-CP tasks (4) for this project.
            </p>
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" size="sm" onClick={() => setCpDialogOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              size="sm"
              className="bg-amber-600 hover:bg-amber-700"
              disabled={cpMutation.isPending || (cpEvidenceType === "email_reference" && !cpEmailSubject.trim())}
              data-testid="btn-confirm-cp-signed"
            >
              {cpMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <FileSignature className="h-3.5 w-3.5 mr-1" />}
              Confirm CP Signed
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}

function StageDetail({ stageId, projectId, projectName, isCoo, userRole }: {
  stageId: number; projectId: number; projectName: string; isCoo: boolean; userRole: string;
}) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    tasks: true, deliverables: true, approvals: true, info: false,
  });
  const [completing, setCompleting] = useState(false);
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [missingItems, setMissingItems] = useState<string[]>([]);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["eng-stage-detail", stageId],
    queryFn: async () => {
      const res = await engFetch(`/api/projects/${projectId}/eng-stages/${stageId}`);
      if (!res.ok) throw new Error("Failed to fetch stage detail");
      return res.json();
    },
  });

  function toggleSection(key: string) {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleComplete() {
    setCompleting(true);
    try {
      const res = await engFetch(`/api/eng-stages/stages/${stageId}/complete`, { method: "POST" });
      const result = await res.json();
      if (result.success) {
        toast({ title: "Stage completed" });
        qc.invalidateQueries({ queryKey: ["eng-stages", projectId] });
        qc.invalidateQueries({ queryKey: ["eng-stage-detail", stageId] });
      } else {
        setMissingItems(result.missing || []);
        toast({ title: "Cannot complete stage", description: `${result.missing?.length || 0} items remaining`, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setCompleting(false);
    }
  }

  async function handleOverrideComplete() {
    if (!overrideReason.trim()) return;
    try {
      const res = await engFetch(`/api/eng-stages/stages/${stageId}/override-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: overrideReason }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      toast({ title: "Stage completed (override)" });
      setOverrideDialogOpen(false);
      setOverrideReason("");
      setMissingItems([]);
      qc.invalidateQueries({ queryKey: ["eng-stages", projectId] });
      qc.invalidateQueries({ queryKey: ["eng-stage-detail", stageId] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  if (isLoading || !data) {
    return <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const { stage, tasks, deliverableTemplates, uploadedDeliverables, approvals } = data;
  const statusCfg = STATUS_CONFIG[stage.status] || STATUS_CONFIG.not_started;

  // Document-control roll-up: count uploaded deliverables by control
  // state so the reviewer can tell at a glance whether the stage has
  // anything actually released for construction, not just "approved".
  const controlRollup = uploadedDeliverables.reduce(
    (acc: Record<string, number>, d: any) => {
      const s = deriveControlState(d);
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const ifcCount = (controlRollup.issued_for_construction ?? 0) + (controlRollup.as_built ?? 0);
  const approvedForReviewCount = controlRollup.approved_for_review ?? 0;
  const stageRules = (stage.stageGateRules ?? {}) as Record<string, unknown>;
  const requiresIfc = Boolean(stageRules.requireIfcIssuance);
  const requiresAsBuilt = Boolean(stageRules.requireAsBuilt);

  return (
    <div className="p-4 space-y-4" data-testid="stage-detail">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" data-testid="stage-name">{stage.templateName}</h2>
          <Badge className={`${statusCfg.color} mt-1`}>{statusCfg.label}</Badge>
          {stage.overrideReason && (
            <p className="text-xs text-orange-600 mt-1">Override: {stage.overrideReason}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportStagePack(stageId, projectId, projectName, stage.templateName)}
            data-testid="btn-export-stage"
          >
            <FolderDown className="h-3.5 w-3.5 mr-1" /> Export
          </Button>
          {stage.status !== "complete" && (
            <Button size="sm" onClick={handleComplete} disabled={completing} data-testid="btn-complete-stage">
              {completing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Complete Stage
            </Button>
          )}
        </div>
      </div>

      {missingItems.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-3">
            <h4 className="text-sm font-medium text-red-800 mb-2">Stage cannot be completed — missing items:</h4>
            <ul className="text-xs text-red-700 space-y-1">
              {missingItems.map((m, i) => (
                <li key={i} className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" /> {m}
                </li>
              ))}
            </ul>
            {isCoo && (
              <div className="mt-3 border-t border-red-200 pt-3">
                {!overrideDialogOpen ? (
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => setOverrideDialogOpen(true)} data-testid="btn-override-open">
                    COO Override Complete
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Mandatory: reason for overriding stage gate..."
                      value={overrideReason}
                      onChange={e => setOverrideReason(e.target.value)}
                      className="text-xs"
                      data-testid="input-override-reason"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleOverrideComplete} disabled={!overrideReason.trim()} data-testid="btn-override-confirm">
                        Confirm Override
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setOverrideDialogOpen(false); setOverrideReason(""); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Document-control roll-up: makes visible what is actually
          released for construction vs. merely QC-approved. Always
          rendered when there are uploaded deliverables so operators
          cannot miss it. */}
      {uploadedDeliverables.length > 0 && (
        <Card
          className="border-l-4"
          style={{ borderLeftColor: requiresIfc && ifcCount === 0 ? "#f59e0b" : "#3b82f6" }}
          data-testid="document-control-rollup"
        >
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <FileSignature className="h-4 w-4 text-blue-600" />
              <span className="text-xs font-semibold">Document Control</span>
              {requiresIfc && (
                <Badge className="bg-emerald-100 text-emerald-800 text-[9px] px-1">
                  IFC required to complete
                </Badge>
              )}
              {requiresAsBuilt && (
                <Badge className="bg-emerald-100 text-emerald-800 text-[9px] px-1">
                  As-built required to complete
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              {(Object.keys(controlRollup) as string[]).map((k) => {
                const meta = CONTROL_STATE_META[k as keyof typeof CONTROL_STATE_META];
                if (!meta) return null;
                return (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1"
                    data-testid={`rollup-${k}`}
                  >
                    <DocumentControlBadge state={k as any} compact />
                    <span className="text-muted-foreground">× {controlRollup[k]}</span>
                  </span>
                );
              })}
            </div>
            {requiresIfc && ifcCount === 0 && approvedForReviewCount > 0 && (
              <div
                className="flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2"
                data-testid="missing-ifc-warning"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  {approvedForReviewCount} deliverable{approvedForReviewCount === 1 ? " has" : "s have"} passed QC review but
                  none have been issued for construction. Use <strong>Issue for Construction</strong> on the approved
                  row(s) before completing this stage.
                </span>
              </div>
            )}
            {stage.definitionOfDone && Array.isArray(stage.definitionOfDone) && stage.definitionOfDone.length > 0 && (
              <details className="text-[11px]">
                <summary className="cursor-pointer font-medium text-foreground hover:text-blue-700">
                  Definition of Done
                </summary>
                <ul className="list-disc list-inside mt-1 text-muted-foreground space-y-0.5">
                  {stage.definitionOfDone.map((line: string, i: number) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      <SectionHeader title="Information" icon={<Target className="h-4 w-4" />} expanded={expandedSections.info} onToggle={() => toggleSection("info")} />
      {expandedSections.info && (
        <Card>
          <CardContent className="p-3 space-y-3 text-xs">
            {stage.templatePurpose && (
              <div>
                <span className="font-medium">Purpose:</span>
                <p className="text-muted-foreground mt-0.5">{stage.templatePurpose}</p>
              </div>
            )}
            {stage.templateInputs?.length > 0 && (
              <div>
                <span className="font-medium">Inputs Required:</span>
                <ul className="list-disc list-inside mt-0.5 text-muted-foreground">
                  {stage.templateInputs.map((inp: string, i: number) => <li key={i}>{inp}</li>)}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div><span className="font-medium">Responsible:</span> <span className="text-muted-foreground">{stage.raciResponsible}</span></div>
              <div><span className="font-medium">Accountable:</span> <span className="text-muted-foreground">{stage.raciAccountable}</span></div>
              <div><span className="font-medium">Consulted:</span> <span className="text-muted-foreground">{stage.raciConsulted}</span></div>
              <div><span className="font-medium">Informed:</span> <span className="text-muted-foreground">{stage.raciInformed}</span></div>
            </div>
            {stage.failureModes?.length > 0 && (
              <div className="bg-orange-50 border-l-4 border-orange-400 p-3 rounded">
                <div className="flex items-center gap-2 mb-1.5">
                  <AlertTriangle className="h-4 w-4 text-orange-600" />
                  <span className="font-semibold text-orange-900 text-xs">Potential Risk Areas</span>
                </div>
                <ul className="list-disc list-inside text-orange-700 text-xs space-y-0.5">
                  {stage.failureModes.map((fm: string, i: number) => <li key={i}>{fm}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <SectionHeader title={`Tasks (${tasks.filter((t: any) => t.status === "complete").length}/${tasks.length})`} icon={<CheckCircle2 className="h-4 w-4" />} expanded={expandedSections.tasks} onToggle={() => toggleSection("tasks")} />
      {expandedSections.tasks && (
        <div className="space-y-1">
          {tasks.map((task: any) => (
            <TaskRow key={task.id} task={task} projectId={projectId} stageId={stageId} allDeliverables={uploadedDeliverables} isCoo={isCoo} userRole={userRole} />
          ))}
        </div>
      )}

      <SectionHeader title={`Deliverables (${uploadedDeliverables.length} uploaded)`} icon={<FileText className="h-4 w-4" />} expanded={expandedSections.deliverables} onToggle={() => toggleSection("deliverables")} />
      {expandedSections.deliverables && (
        <DeliverablesSection
          stageId={stageId}
          projectId={projectId}
          templates={deliverableTemplates}
          uploaded={uploadedDeliverables}
        />
      )}

      {approvals.length > 0 && (
        <>
          <SectionHeader title="Approvals" icon={<Shield className="h-4 w-4" />} expanded={expandedSections.approvals} onToggle={() => toggleSection("approvals")} />
          {expandedSections.approvals && (
            <div className="space-y-2">
              {approvals.map((a: any) => (
                <ApprovalRow key={a.id} approval={a} projectId={projectId} stageId={stageId} userRole={userRole} isCoo={isCoo} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SectionHeader({ title, icon, expanded, onToggle }: {
  title: string; icon: React.ReactNode; expanded: boolean; onToggle: () => void;
}) {
  return (
    <button className="flex items-center gap-2 w-full text-left py-1.5 hover:bg-muted/50 rounded px-2 transition-colors" onClick={onToggle}>
      {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      {icon}
      <span className="text-sm font-medium">{title}</span>
    </button>
  );
}

function TaskRow({ task, projectId, stageId, allDeliverables, isCoo, userRole }: {
  task: any; projectId: number; stageId: number; allDeliverables: any[]; isCoo: boolean; userRole: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(task.notes || "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [spDialogOpen, setSpDialogOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [spPath, setSpPath] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [savedPaths, setSavedPaths] = useState<string[]>(getSavedFolderPaths);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const currentUserId = user?.id ?? 0;

  const cfg = TASK_STATUS_CONFIG[task.status] || TASK_STATUS_CONFIG.pending;
  const taskDeliverables = allDeliverables.filter((d: any) => d.projectEngTaskId === task.id);
  const hasLinkedWorkItem = Boolean(task.workItemId);
  const statusSynced = hasLinkedWorkItem && task.workItemStatus === STAGE_TO_WORK_ITEM_STATUS[task.status];
  // `hasApprovedDeliverable` here means "has passed QC review" — not
  // "has been issued for construction". Keep the variable name locally
  // stable but the user-facing copy says "QC review".
  const hasApprovedDeliverable = taskDeliverables.some((d: any) => d.approvalStatus === "approved");
  const hasPendingDeliverable = taskDeliverables.some((d: any) => d.approvalStatus === "pending");
  const hasIfcDeliverable = taskDeliverables.some((d: any) => {
    const s = deriveControlState(d);
    return s === "issued_for_construction" || s === "as_built";
  });
  const completionBlocked = task.hasDeliverable && !hasApprovedDeliverable && task.status !== "complete";

  async function toggleStatus() {
    const newStatus = task.status === "complete" ? "pending" : "complete";

    if (newStatus === "complete" && task.hasDeliverable && !hasApprovedDeliverable) {
      if (taskDeliverables.length === 0) {
        toast({ title: "Deliverable required", description: "Upload a deliverable before completing this task.", variant: "destructive" });
      } else {
        toast({
          title: "QC review required",
          description: "The deliverable must pass QC review before this task can be completed. (This is a review gate — a separate step is required before the document can be issued for construction.)",
          variant: "destructive",
        });
      }
      return;
    }

    setSaving(true);
    try {
      const res = await engFetch(`/api/eng-stages/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update");
      }
      qc.invalidateQueries({ queryKey: ["eng-stage-detail", stageId] });
      qc.invalidateQueries({ queryKey: ["eng-stages", projectId] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleHasDeliverable() {
    setSaving(true);
    try {
      const res = await engFetch(`/api/eng-stages/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hasDeliverable: !task.hasDeliverable }),
      });
      if (!res.ok) throw new Error("Failed to update");
      qc.invalidateQueries({ queryKey: ["eng-stage-detail", stageId] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function saveNotes() {
    setSaving(true);
    try {
      const res = await engFetch(`/api/eng-stages/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw new Error("Failed to save notes");
      toast({ title: "Notes saved" });
      qc.invalidateQueries({ queryKey: ["eng-stage-detail", stageId] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setSpPath(savedPaths[0] || "");
    setCustomPath("");
    setSpDialogOpen(true);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleConfirmUpload() {
    if (!pendingFile) return;
    const folderPath = spPath === "__custom__" ? customPath.trim() : spPath;

    if (folderPath && spPath === "__custom__" && customPath.trim()) {
      if (!savedPaths.includes(customPath.trim())) {
        const updated = [...savedPaths, customPath.trim()];
        setSavedPaths(updated);
        saveFolderPaths(updated);
      }
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", pendingFile);
      if (folderPath) formData.append("sharepointFolderPath", folderPath);

      const res = await engFetch(`/api/eng-stages/tasks/${task.id}/deliverables`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      toast({ title: "Deliverable uploaded", description: "Pending approval before task can be completed." });
      qc.invalidateQueries({ queryKey: ["eng-stage-detail", stageId] });
      setSpDialogOpen(false);
      setPendingFile(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleApprove(deliverableId: number, status: "approved" | "rejected") {
    try {
      const res = await engFetch(`/api/eng-stages/deliverables/${deliverableId}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update");
      }
      toast({ title: status === "approved" ? "Deliverable approved" : "Deliverable rejected" });
      qc.invalidateQueries({ queryKey: ["eng-stage-detail", stageId] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  // NOTE: Review/QC badge only — intentionally does NOT say a bare
  // "Approved" because that was being conflated with "issued for
  // construction". The document-control state is rendered separately via
  // <DocumentControlBadge />.
  const reviewBadge = (status: string) => {
    if (status === "approved")
      return <Badge className="bg-blue-100 text-blue-700 text-[9px] px-1">QC passed (review)</Badge>;
    if (status === "rejected")
      return <Badge className="bg-red-100 text-red-700 text-[9px] px-1">QC rejected</Badge>;
    return <Badge className="bg-amber-100 text-amber-700 text-[9px] px-1">Awaiting QC review</Badge>;
  };

  return (
    <Card className="border-l-2" style={{ borderLeftColor: task.status === "complete" ? "#22c55e" : task.isRequired ? "#3b82f6" : "#9ca3af" }}>
      <CardContent className="p-2">
        <div className="flex items-center gap-2">
          <button onClick={toggleStatus} disabled={saving || (completionBlocked && task.status !== "complete")} className="shrink-0" data-testid={`task-check-${task.id}`}
            title={completionBlocked ? "Deliverable must pass QC review first" : undefined}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : task.status === "complete" ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : completionBlocked ? (
              <Lock className="h-4 w-4 text-amber-500" />
            ) : (
              <Circle className="h-4 w-4 text-gray-400" />
            )}
          </button>
          <div className="flex-1 min-w-0">
            <button className="text-xs font-medium text-left w-full hover:underline" onClick={() => setExpanded(!expanded)}>
              <span className={task.status === "complete" ? "line-through text-muted-foreground" : ""}>
                {task.sequence}. {task.templateTitle}
              </span>
              {!task.isRequired && <span className="ml-1 text-[10px] text-muted-foreground">(optional)</span>}
            </button>
            {task.hasDeliverable && (
              <div
                className="flex items-center gap-1 mt-0.5"
                data-testid={`task-deliverable-indicator-${task.id}`}
              >
                <FileText className="h-3 w-3 text-blue-500" />
                <span className="text-[10px] text-blue-600 font-medium">Deliverable required</span>
                {hasIfcDeliverable && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] text-emerald-700 font-semibold" title="Deliverable is Issued For Construction">
                    <Shield className="h-3 w-3" /> IFC
                  </span>
                )}
                {!hasIfcDeliverable && hasApprovedDeliverable && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] text-blue-700 font-semibold" title="Deliverable passed QC review but is NOT yet issued for construction">
                    <CheckCircle2 className="h-3 w-3" /> QC
                  </span>
                )}
                {!hasApprovedDeliverable && hasPendingDeliverable && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-700" title="Deliverable uploaded, awaiting QC review">
                    <Clock className="h-3 w-3" /> Review
                  </span>
                )}
                {!hasApprovedDeliverable && !hasPendingDeliverable && taskDeliverables.length === 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] text-red-700 font-semibold" title="No deliverable uploaded for this task">
                    <AlertTriangle className="h-3 w-3" /> Missing
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center gap-1 mt-1">
              {hasLinkedWorkItem ? (
                <Badge variant="outline" className="text-[9px] px-1">Linked to Task Board</Badge>
              ) : (
                <Badge className="bg-amber-100 text-amber-800 text-[9px] px-1">Unlinked legacy task</Badge>
              )}
              {statusSynced && (
                <Badge className="bg-emerald-100 text-emerald-800 text-[9px] px-1">Status synced</Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {task.dueDate && (
              <span className={`text-[10px] ${new Date(task.dueDate) < new Date() && task.status !== "complete" ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                {new Date(task.dueDate).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}
              </span>
            )}
            <Badge className={`${cfg.color} text-[10px] px-1.5 py-0`}>{cfg.label}</Badge>
          </div>
        </div>
        {expanded && (
          <div className="mt-2 pl-6 space-y-3">
            {task.templateDescription && (
              <p className="text-xs text-muted-foreground">{task.templateDescription}</p>
            )}
            {task.ownerUserName && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Users className="h-3 w-3" /> Assigned to: <span className="font-medium text-foreground">{task.ownerUserName}</span>
              </p>
            )}
            {task.status === "complete" && task.completedAt && (
              <p className="text-[10px] text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Completed {new Date(task.completedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}
                {task.completedByName && <span> by {task.completedByName}</span>}
              </p>
            )}

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={task.hasDeliverable}
                  onChange={toggleHasDeliverable}
                  className="h-3.5 w-3.5 rounded border-border"
                  data-testid={`toggle-deliverable-${task.id}`}
                />
                <span className="text-[11px] font-medium text-foreground">Has Deliverable</span>
              </label>
              {task.hasDeliverable && (
                <span className="text-[10px] text-amber-600">
                  Task cannot be completed until the deliverable passes QC review (separate step: issue for construction)
                </span>
              )}
            </div>

            {task.hasDeliverable && (
              <div className="border rounded-lg p-2 bg-muted/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-foreground flex items-center gap-1">
                    <FileText className="h-3 w-3" /> Task Deliverables
                  </span>
                  <Button
                    size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    data-testid={`btn-task-upload-${task.id}`}
                  >
                    <Upload className="h-3 w-3" /> Upload
                  </Button>
                </div>

                {taskDeliverables.length === 0 && (
                  <p className="text-[10px] text-muted-foreground italic">No deliverables uploaded yet. Upload a file to proceed.</p>
                )}

                {taskDeliverables.map((d: any) => {
                  const controlState = deriveControlState(d);
                  const controlMeta = CONTROL_STATE_META[controlState];
                  return (
                    <div key={d.id} className="border rounded p-2 bg-card space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <FileText className="h-3 w-3 text-blue-500 shrink-0" />
                        <span className="flex-1 truncate font-medium">{d.fileName}</span>
                        {reviewBadge(d.approvalStatus)}
                        <DocumentControlBadge
                          row={d}
                          compact
                          data-testid={`doc-control-${d.id}`}
                        />
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                          onClick={() => window.open(`/api/eng-stages/deliverables/${d.id}/download`, "_blank")}
                          data-testid={`btn-dl-task-del-${d.id}`}>
                          <Download className="h-3 w-3" />
                        </Button>
                      </div>
                      {d.sharepointFolderPath && (
                        <div className="flex items-center gap-1 text-[10px] text-blue-600">
                          <FolderOpen className="h-2.5 w-2.5" />
                          <span className="truncate">{d.sharepointFolderPath}</span>
                        </div>
                      )}
                      {d.approvalStatus === "pending" && (isCoo || userRole === "PROGRAM_MANAGER" || userRole === "ENGINEER") && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 text-blue-700 border-blue-300 hover:bg-blue-50"
                            onClick={() => handleApprove(d.id, "approved")}
                            data-testid={`btn-approve-${d.id}`}
                            title="Approve for review. This is QC signoff only — it does NOT issue the document for construction.">
                            <CheckCircle2 className="h-3 w-3" /> Pass QC review
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 text-red-700 border-red-300 hover:bg-red-50"
                            onClick={() => handleApprove(d.id, "rejected")}
                            data-testid={`btn-reject-${d.id}`}>
                            <AlertTriangle className="h-3 w-3" /> Reject
                          </Button>
                        </div>
                      )}
                      {d.approvalStatus === "approved" && (
                        <div className="space-y-1">
                          <p className="text-[10px] text-blue-700" data-testid={`qc-passed-note-${d.id}`}>
                            QC-approved for review. NOT yet issued for construction — a separate action is required.
                          </p>
                          {!controlMeta.isConstructionSafe && <NotForConstructionHint state={controlState} />}
                          <DeliverableControlActions
                            deliverable={d}
                            userRole={userRole}
                            userId={currentUserId}
                            invalidateKeys={[["eng-stage-detail", stageId], ["eng-stages", projectId]]}
                            testIdPrefix={`deliverable-${d.id}`}
                          />
                        </div>
                      )}
                      {d.approvalStatus === "rejected" && (
                        <p className="text-[10px] text-red-500">QC rejected — upload a revised version.</p>
                      )}
                    </div>
                  );
                })}
                <input ref={fileRef} type="file" className="hidden" onChange={handleFileSelect} />
              </div>
            )}

            <div className="flex gap-2 items-end">
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Add notes..."
                className="text-xs min-h-[60px]"
                data-testid={`task-notes-${task.id}`}
              />
              <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={saveNotes} disabled={saving}>
                Save
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={spDialogOpen} onOpenChange={(open) => {
        if (!open) { setSpDialogOpen(false); setPendingFile(null); }
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-blue-600" />
              Upload Task Deliverable
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {pendingFile && (
              <div className="flex items-center gap-3 p-3 bg-muted rounded-lg border">
                <FileText className="h-8 w-8 text-blue-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{pendingFile.name}</p>
                  <p className="text-[11px] text-muted-foreground">{(pendingFile.size / 1024).toFixed(1)} KB</p>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 text-blue-600" />
                Local SharePoint Sync Folder
              </Label>
              <SearchableSelect
                value={spPath}
                onValueChange={setSpPath}
                placeholder="Select a folder path..."
                triggerClassName="h-9 text-xs"
                data-testid="select-task-sp-folder"
                options={[
                  ...savedPaths.map((p, i) => ({ value: p, label: p })),
                  { value: "__custom__", label: "Enter custom path..." },
                  { value: "", label: "Skip (no SharePoint path)" },
                ]}
              />
              {spPath === "__custom__" && (
                <Input className="h-8 text-xs font-mono" placeholder="e.g. S:\Emergent Energy\Projects\..." value={customPath}
                  onChange={e => setCustomPath(e.target.value)} data-testid="input-task-custom-sp" autoFocus />
              )}
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded p-2">
              <p className="text-[11px] text-amber-700">
                This deliverable will require approval before the task can be marked as complete.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setSpDialogOpen(false); setPendingFile(null); }}>Cancel</Button>
            <Button size="sm" onClick={handleConfirmUpload}
              disabled={uploading || !pendingFile || (spPath === "__custom__" && !customPath.trim())}
              data-testid="btn-confirm-task-upload">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
              Upload & Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const SP_FOLDER_KEY = "eng_sp_folder_paths";
const DEFAULT_SP_FOLDERS = [
  "S:\\Emergent Energy\\Engineering\\Deliverables",
  "S:\\Emergent Energy\\Projects",
  "C:\\Users\\Shared\\SharePoint\\Emergent Energy\\Engineering",
];

function getSavedFolderPaths(): string[] {
  try {
    const saved = localStorage.getItem(SP_FOLDER_KEY);
    if (saved) return JSON.parse(saved);
  } catch (err) {
    console.error("[EngineeringStages] Error loading saved folder paths:", err);
  }
  return DEFAULT_SP_FOLDERS;
}

function saveFolderPaths(paths: string[]) {
  localStorage.setItem(SP_FOLDER_KEY, JSON.stringify(paths));
}

function DeliverablesSection({ stageId, projectId, templates, uploaded }: {
  stageId: number; projectId: number; templates: any[]; uploaded: any[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [spFolderPath, setSpFolderPath] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [savedPaths, setSavedPaths] = useState<string[]>(getSavedFolderPaths);
  const { toast } = useToast();
  const qc = useQueryClient();

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setSpFolderPath(savedPaths[0] || "");
    setCustomPath("");
    setUploadDialogOpen(true);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleConfirmUpload() {
    if (!pendingFile) return;
    const folderPath = spFolderPath === "__custom__" ? customPath.trim() : spFolderPath;

    if (folderPath && spFolderPath === "__custom__" && customPath.trim()) {
      if (!savedPaths.includes(customPath.trim())) {
        const updated = [...savedPaths, customPath.trim()];
        setSavedPaths(updated);
        saveFolderPaths(updated);
      }
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", pendingFile);
      if (selectedTemplateId) formData.append("deliverableTemplateId", String(selectedTemplateId));
      formData.append("versionTag", "v1");
      if (folderPath) formData.append("sharepointFolderPath", folderPath);

      const res = await engFetch(`/api/eng-stages/stages/${stageId}/deliverables`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      toast({
        title: "File uploaded",
        description: folderPath ? `SharePoint sync folder: ${folderPath}` : undefined,
      });
      qc.invalidateQueries({ queryKey: ["eng-stage-detail", stageId] });
      setUploadDialogOpen(false);
      setPendingFile(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      setSelectedTemplateId(null);
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await engFetch(`/api/eng-stages/deliverables/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast({ title: "File removed" });
      qc.invalidateQueries({ queryKey: ["eng-stage-detail", stageId] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  function handleRemoveSavedPath(pathToRemove: string) {
    const updated = savedPaths.filter(p => p !== pathToRemove);
    setSavedPaths(updated);
    saveFolderPaths(updated);
    if (spFolderPath === pathToRemove) {
      setSpFolderPath(updated[0] || "__custom__");
    }
  }

  return (
    <ErrorBoundary>
    <div className="space-y-3">
      {templates.map((dt: any) => {
        const files = uploaded.filter((u: any) => u.deliverableTemplateId === dt.id);
        return (
          <Card key={dt.id} className={dt.isRequired ? "border-l-2 border-l-blue-500" : ""}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <span className="text-xs font-medium">{dt.name}</span>
                  {dt.isRequired && <span className="text-[10px] text-red-500 ml-1">*required</span>}
                </div>
                <Badge variant={files.length >= dt.requiredCount ? "default" : "secondary"} className="text-[10px]">
                  {files.length}/{dt.requiredCount}
                </Badge>
              </div>
              {dt.description && <p className="text-[10px] text-muted-foreground mb-2">{dt.description}</p>}
              {files.map((f: any) => (
                <div key={f.id} className="flex flex-col gap-0.5 py-1.5 border-t">
                  <div className="flex items-center gap-2 text-xs">
                    <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate font-medium">{f.fileName}</span>
                    {f.versionTag && <Badge variant="outline" className="text-[10px]">{f.versionTag}</Badge>}
                    <DocumentControlBadge row={f} compact data-testid={`stage-doc-control-${f.id}`} />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => window.open(`/api/eng-stages/deliverables/${f.id}/download`, "_blank")}
                      data-testid={`btn-download-${f.id}`}
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-red-500"
                      onClick={() => handleDelete(f.id)}
                      data-testid={`btn-delete-${f.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  {f.sharepointFolderPath && (
                    <div className="flex items-center gap-1.5 ml-5 text-[10px] text-blue-600">
                      <FolderOpen className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate" title={f.sharepointFolderPath}>
                        SharePoint: {f.sharepointFolderPath}
                      </span>
                    </div>
                  )}
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs mt-1"
                onClick={() => { setSelectedTemplateId(dt.id); fileRef.current?.click(); }}
                disabled={uploading}
                data-testid={`btn-upload-${dt.id}`}
              >
                <Upload className="h-3 w-3 mr-1" /> Upload
              </Button>
            </CardContent>
          </Card>
        );
      })}
      <input ref={fileRef} type="file" className="hidden" onChange={handleFileSelect} />

      <Dialog open={uploadDialogOpen} onOpenChange={(open) => {
        if (!open) { setUploadDialogOpen(false); setPendingFile(null); }
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-blue-600" />
              Upload Deliverable
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {pendingFile && (
              <div className="flex items-center gap-3 p-3 bg-muted rounded-lg border">
                <FileText className="h-8 w-8 text-blue-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{pendingFile.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {(pendingFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 text-blue-600" />
                Local SharePoint Sync Folder
              </Label>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Choose the local folder path where this file should be saved for SharePoint sync.
                This is the folder on your machine that syncs with SharePoint.
              </p>

              <SearchableSelect
                value={spFolderPath}
                onValueChange={setSpFolderPath}
                placeholder="Select a folder path..."
                triggerClassName="h-9 text-xs"
                data-testid="select-sp-folder"
                options={[
                  ...savedPaths.map((p, i) => ({ value: p, label: p })),
                  { value: "__custom__", label: "Enter custom path..." },
                  { value: "", label: "Skip (no SharePoint path)" },
                ]}
              />

              {spFolderPath === "__custom__" && (
                <div className="space-y-1.5">
                  <Input
                    className="h-8 text-xs font-mono"
                    placeholder="e.g. S:\Emergent Energy\Projects\ProjectName\Deliverables"
                    value={customPath}
                    onChange={e => setCustomPath(e.target.value)}
                    data-testid="input-custom-sp-path"
                    autoFocus
                  />
                  <p className="text-[10px] text-muted-foreground">
                    This path will be saved for future uploads.
                  </p>
                </div>
              )}

              {savedPaths.length > 0 && (
                <details className="text-[10px]">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Manage saved paths ({savedPaths.length})
                  </summary>
                  <div className="mt-1.5 space-y-1">
                    {savedPaths.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 py-0.5">
                        <span className="flex-1 truncate font-mono text-muted-foreground">{p}</span>
                        <button
                          className="text-red-600 hover:text-red-600 shrink-0"
                          onClick={() => handleRemoveSavedPath(p)}
                          title="Remove saved path"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setUploadDialogOpen(false); setPendingFile(null); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmUpload}
              disabled={uploading || !pendingFile || (spFolderPath === "__custom__" && !customPath.trim())}
              data-testid="btn-confirm-upload"
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Upload className="h-3.5 w-3.5 mr-1" />
              )}
              Upload & Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </ErrorBoundary>
  );
}

function ApprovalRow({ approval, projectId, stageId, userRole, isCoo }: {
  approval: any; projectId: number; stageId: number; userRole: string; isCoo: boolean;
}) {
  const [comments, setComments] = useState(approval.comments || "");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const roleName = approval.approverRole === "QA_REVIEW" ? "QA Review" : "Technical Signoff";
  const roleLabel = approval.approverUserName ? `${roleName} (${approval.approverUserName})` : roleName;
  const canApprove = isCoo || (approval.approverRole === "QA_REVIEW" && userRole === "QUALITY_MANAGER") ||
    (approval.approverRole === "TECHNICAL_SIGNOFF" && (userRole === "ENGINEER" || userRole === "PROGRAM_MANAGER"));

  async function handleApproval(status: "approved" | "rejected") {
    setSaving(true);
    try {
      const res = await engFetch(`/api/eng-stages/approvals/${approval.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, comments }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      toast({ title: `Approval ${status}` });
      qc.invalidateQueries({ queryKey: ["eng-stage-detail", stageId] });
      qc.invalidateQueries({ queryKey: ["eng-stages", projectId] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const statusColor = approval.status === "approved" ? "bg-green-100 text-green-700" :
    approval.status === "rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";

  return (
    <ErrorBoundary>
    <Card data-testid={`approval-${approval.id}`}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            <span className="text-xs font-medium">{roleLabel}</span>
          </div>
          <Badge className={`${statusColor} text-[10px]`}>{approval.status}</Badge>
        </div>
        {canApprove && approval.status === "pending" && (
          <div className="space-y-2">
            <Textarea
              value={comments}
              onChange={e => setComments(e.target.value)}
              placeholder="Comments (optional)..."
              className="text-xs min-h-[40px]"
              data-testid={`approval-comments-${approval.id}`}
            />
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700" onClick={() => handleApproval("approved")} disabled={saving} data-testid={`btn-approve-${approval.id}`}>
                Approve
              </Button>
              <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => handleApproval("rejected")} disabled={saving} data-testid={`btn-reject-${approval.id}`}>
                Reject
              </Button>
            </div>
          </div>
        )}
        {approval.comments && approval.status !== "pending" && (
          <p className="text-xs text-muted-foreground mt-1">"{approval.comments}"</p>
        )}
      </CardContent>
    </Card>
    </ErrorBoundary>
  );
}
