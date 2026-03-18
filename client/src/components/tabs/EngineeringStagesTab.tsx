import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
} from "lucide-react";
import { exportStagePack, exportAllStagesPack } from "@/lib/stage-export";

function engFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { ...(options?.headers as any || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...options, headers, credentials: "include" });
}

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
    <div className="flex gap-4 h-[calc(100vh-300px)] min-h-[500px]" data-testid="eng-stages-panel">
      <div className="w-72 shrink-0 space-y-2 overflow-y-auto pr-2">
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
              <div>
                <span className="font-medium text-orange-700">Failure Modes:</span>
                <ul className="list-disc list-inside mt-0.5 text-orange-600">
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

  const cfg = TASK_STATUS_CONFIG[task.status] || TASK_STATUS_CONFIG.pending;
  const taskDeliverables = allDeliverables.filter((d: any) => d.projectEngTaskId === task.id);
  const hasApprovedDeliverable = taskDeliverables.some((d: any) => d.approvalStatus === "approved");
  const hasPendingDeliverable = taskDeliverables.some((d: any) => d.approvalStatus === "pending");
  const completionBlocked = task.hasDeliverable && !hasApprovedDeliverable && task.status !== "complete";

  async function toggleStatus() {
    const newStatus = task.status === "complete" ? "pending" : "complete";

    if (newStatus === "complete" && task.hasDeliverable && !hasApprovedDeliverable) {
      if (taskDeliverables.length === 0) {
        toast({ title: "Deliverable required", description: "Upload a deliverable before completing this task.", variant: "destructive" });
      } else {
        toast({ title: "Approval required", description: "The deliverable must be approved before this task can be completed.", variant: "destructive" });
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

  const approvalBadge = (status: string) => {
    if (status === "approved") return <Badge className="bg-green-100 text-green-700 text-[9px] px-1">Approved</Badge>;
    if (status === "rejected") return <Badge className="bg-red-100 text-red-700 text-[9px] px-1">Rejected</Badge>;
    return <Badge className="bg-amber-100 text-amber-700 text-[9px] px-1">Pending Approval</Badge>;
  };

  return (
    <Card className="border-l-2" style={{ borderLeftColor: task.status === "complete" ? "#22c55e" : task.isRequired ? "#3b82f6" : "#9ca3af" }}>
      <CardContent className="p-2">
        <div className="flex items-center gap-2">
          <button onClick={toggleStatus} disabled={saving || (completionBlocked && task.status !== "complete")} className="shrink-0" data-testid={`task-check-${task.id}`}
            title={completionBlocked ? "Deliverable must be approved first" : undefined}>
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
              <div className="flex items-center gap-1 mt-0.5">
                <FileText className="h-3 w-3 text-blue-500" />
                <span className="text-[10px] text-blue-600 font-medium">Deliverable required</span>
                {hasApprovedDeliverable && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                {!hasApprovedDeliverable && hasPendingDeliverable && <Clock className="h-3 w-3 text-amber-500" />}
                {!hasApprovedDeliverable && !hasPendingDeliverable && taskDeliverables.length === 0 && (
                  <AlertTriangle className="h-3 w-3 text-red-600" />
                )}
              </div>
            )}
          </div>
          <Badge className={`${cfg.color} text-[10px] px-1.5 py-0`}>{cfg.label}</Badge>
        </div>
        {expanded && (
          <div className="mt-2 pl-6 space-y-3">
            {task.templateDescription && (
              <p className="text-xs text-muted-foreground">{task.templateDescription}</p>
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
                  Task cannot be completed until deliverable is approved
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

                {taskDeliverables.map((d: any) => (
                  <div key={d.id} className="border rounded p-2 bg-card space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      <FileText className="h-3 w-3 text-blue-500 shrink-0" />
                      <span className="flex-1 truncate font-medium">{d.fileName}</span>
                      {approvalBadge(d.approvalStatus)}
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
                        <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 text-green-700 border-green-300 hover:bg-green-50"
                          onClick={() => handleApprove(d.id, "approved")}
                          data-testid={`btn-approve-${d.id}`}>
                          <CheckCircle2 className="h-3 w-3" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 text-red-700 border-red-300 hover:bg-red-50"
                          onClick={() => handleApprove(d.id, "rejected")}
                          data-testid={`btn-reject-${d.id}`}>
                          <AlertTriangle className="h-3 w-3" /> Reject
                        </Button>
                      </div>
                    )}
                    {d.approvalStatus === "approved" && (
                      <p className="text-[10px] text-green-600">Approved — task can now be completed</p>
                    )}
                    {d.approvalStatus === "rejected" && (
                      <p className="text-[10px] text-red-500">Rejected — upload a new version</p>
                    )}
                  </div>
                ))}
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
  } catch {}
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
  );
}
