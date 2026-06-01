import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HoldReasonDialog } from "@/components/HoldReasonDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import {
  ListTodo,
  Plus,
  Loader2,
  Link2,
  MessageSquare,
  Activity,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Send,
  FolderKanban,
  Circle,
  UserCircle,
  ArrowRight,
  ChevronsUpDown,
  Check,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  ShieldCheck,
  Trash2,
  ExternalLink,
  Eye,
  Paperclip,
  ArrowRightLeft,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permissions";
import { PROJECT_PHASE_LABELS, normalizeRoleForPermissions, type ProjectPhase } from "@shared/schema";
import {
  TASK_STATUSES,
  canTransition,
  getTaskStatusBadgeClass,
  getTaskStatusLabel,
} from "@/lib/task-status";
import UserAssignmentPicker from "@/components/UserAssignmentPicker";
import type { Task, Comment, ActivityEntry, TeamMember } from "@/components/tasks/types";
import { formatDate, isOverdue, daysLabel, getAvatarColor, getInitials } from "@/lib/task-formatters";
import { fetchRolloutFeatureFlags } from "@/lib/feature-flags";
import { getTaskWorkflowBlockReason } from "@/lib/task-workflow-guard";
import { engFetch } from "@/lib/eng-fetch";
import { TaskDependenciesPanel } from "./panels/TaskDependenciesPanel";
import { SendDeliverableDialog, type LocalSyncedSaveResult } from "./dialogs/SendDeliverableDialog";
import { SendForApprovalDialog } from "./dialogs/SendForApprovalDialog";
import { CommentInputWithMentions } from "./dialogs/CommentInputWithMentions";
import { SubtaskQuickAdd } from "./dialogs/SubtaskQuickAdd";
import { DocumentControlBadge } from "@/components/engineering/DocumentControlBadge";
import { PHASE_COLORS } from "@/lib/phase-colors";
import { invalidateEngineeringTicketCaches } from "@/lib/task-cache";
import { canonicalizeTaskStatus } from "@/lib/task-status-compat";
import {
  TASK_PRIORITY_LABELS,
  normalizeTaskPriority,
} from "@shared/task-priorities";
import { PRIORITIES } from "./task-filter-config";

export function PostUpdateForm({ taskId, currentStatus, hasProject, onDone }: { taskId: number; currentStatus: string; hasProject: boolean; onDone: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [updateText, setUpdateText] = useState("");
  const [newStatus, setNewStatus] = useState(currentStatus);
  const [holdReason, setHoldReason] = useState("");
  const [blockedType, setBlockedType] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const needsHoldReason = newStatus === "hold" && newStatus !== currentStatus;

  const handleSubmit = async () => {
    if (!updateText.trim() && newStatus === currentStatus) return;
    if (needsHoldReason && !holdReason.trim()) {
      toast({ title: "Hold reason required", variant: "destructive" });
      return;
    }
    if (needsHoldReason && !blockedType) {
      toast({ title: "Select blocked type (Internal or External)", variant: "destructive" });
      return;
    }
    if (newStatus === "projects_assistance" && newStatus !== currentStatus && !hasProject) {
      toast({ title: "Project required", description: "Link a project to this task before setting Projects Assistance status.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      if (updateText.trim()) {
        await engFetch(`/api/eng/tasks/${taskId}/comments`, {
          method: "POST",
          body: JSON.stringify({ body: updateText.trim() }),
        });
      }
      if (newStatus !== currentStatus) {
        const patch: Record<string, string> = { status: newStatus };
        if (needsHoldReason) {
          patch.holdReason = holdReason.trim();
          patch.blockedType = blockedType;
        }
        await engFetch(`/api/eng/tasks/${taskId}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
      }
      invalidateEngineeringTicketCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: ["task-comments", taskId] });
      queryClient.invalidateQueries({ queryKey: ["task-activity", taskId] });
      setUpdateText("");
      setHoldReason("");
      toast({ title: "Update posted" });
      onDone();
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-3 bg-blue-50/50 border border-blue-200 rounded-lg space-y-2" data-testid="post-update-form">
      <div className="flex items-center gap-2">
        <ArrowRight className="h-3.5 w-3.5 text-blue-600" />
        <span className="text-xs font-semibold text-blue-700">Post Update</span>
      </div>
      <Textarea
        value={updateText}
        onChange={(e) => setUpdateText(e.target.value)}
        placeholder="What's the latest on this task?"
        className="min-h-[60px] text-sm resize-none"
        data-testid="input-post-update"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Move to:</span>
          <SearchableSelect
            value={newStatus}
            onValueChange={(v) => { setNewStatus(v); if (v !== "hold") { setHoldReason(""); setBlockedType(""); } }}
            placeholder="Status"
            triggerClassName="h-7 text-[10px] w-[140px]"
            options={TASK_STATUSES.map(s => ({ value: s, label: getTaskStatusLabel(s) }))}
            data-testid="select-post-update-status"
          />
        </div>
        <Button
          size="sm"
          className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
          disabled={submitting || (!updateText.trim() && newStatus === currentStatus) || (needsHoldReason && (!holdReason.trim() || !blockedType))}
          onClick={handleSubmit}
          data-testid="btn-post-update"
        >
          {submitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
          Post Update
        </Button>
      </div>
      {needsHoldReason && (
        <div className="pt-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">Blocked:</span>
            <SearchableSelect
              value={blockedType}
              onValueChange={setBlockedType}
              placeholder="Select type..."
              triggerClassName="h-7 text-[10px] w-[120px] border-amber-300"
              options={[
                { value: "Internal", label: "Internal" },
                { value: "External", label: "External" },
              ]}
              data-testid="select-post-update-blocked-type"
            />
          </div>
          <Input
            value={holdReason}
            onChange={(e) => setHoldReason(e.target.value)}
            placeholder="Reason for hold (required)"
            className="h-7 text-xs border-amber-300 focus:ring-amber-400"
            data-testid="input-post-update-hold-reason"
          />
        </div>
      )}
    </div>
  );
}

export function TaskDetailDrawer({
  task, onClose, onUpdate
}: {
  task: Task; onClose: () => void; onUpdate: () => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // Comment text + mentions popover state lives inside CommentInputWithMentions.
  const [activeTab, setActiveTab] = useState<"updates" | "activity" | "subtasks" | "dependencies">("updates");
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [approvalComment, setApprovalComment] = useState("");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [showApprovalActions, setShowApprovalActions] = useState(false);
  // Send-for-Approval state lives inside SendForApprovalDialog.
  const [showSendForApproval, setShowSendForApproval] = useState(false);
  // Send-Deliverable state lives inside SendDeliverableDialog so it only
  // exists while the dialog is mounted. Drawer keeps the visibility flag.
  const [showSendDeliverable, setShowSendDeliverable] = useState(false);
  // Approval project/route suggestion state lives inside SendForApprovalDialog.
  const [drawerHoldDialog, setDrawerHoldDialog] = useState(false);
  const [drawerHoldReason, setDrawerHoldReason] = useState("");
  const [drawerBlockedType, setDrawerBlockedType] = useState("");
  // X6: replace window.confirm with the shared ConfirmDialog so the
  // high-severity completion guard matches every other confirm in the app.
  const [drawerCompletionConfirm, setDrawerCompletionConfirm] = useState(false);
  // Subtask quick-add title state lives inside SubtaskQuickAdd.
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [mappedPathDraft, setMappedPathDraft] = useState("");
  const [fallbackDraft, setFallbackDraft] = useState<"download" | "clipboard">("download");
  const { allowed: canDelete } = usePermission('eng_tasks', 'delete');

  const { data: comments = [] } = useQuery<Comment[]>({
    queryKey: ["task-comments", task.id],
    queryFn: () => engFetch(`/api/eng/tasks/${task.id}/comments`),
  });

  const { data: activity = [] } = useQuery<ActivityEntry[]>({
    queryKey: ["task-activity", task.id],
    queryFn: () => engFetch(`/api/eng/tasks/${task.id}/activity`),
  });

  const { data: subtasks = [] } = useQuery<Task[]>({
    queryKey: ["task-subtasks", task.id],
    queryFn: () => engFetch(`/api/eng/tasks/${task.id}/subtasks`),
  });

  const { data: taskDeliverables = [] } = useQuery<any[]>({
    queryKey: ["task-deliverables", task.id],
    queryFn: () => engFetch(`/api/eng/tasks/${task.id}/deliverables`),
  });

  const { data: rolloutFlags = [] } = useQuery({
    queryKey: ["rollout-feature-flags"],
    queryFn: fetchRolloutFeatureFlags,
  });

  const localSyncedSaveEnabled = rolloutFlags.find((flag) => flag.key === "local_synced_save_flow")?.value === true;

  const { data: localSyncedConfig } = useQuery<{ enabled: boolean; mappedPath: string | null; fallbackPreference: "download" | "clipboard" }>({
    queryKey: ["local-synced-save-config"],
    queryFn: () => engFetch("/api/eng/local-synced-save/config"),
    enabled: localSyncedSaveEnabled,
  });

  const { data: teamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ["team-members"],
    queryFn: () => engFetch("/api/eng/team-members"),
  });

  const EXCLUDED_PHASES_DRAWER = ["Hold", "Done", "Closed", "Gone"];
  const { data: drawerProjects = [] } = useQuery<{ id: number; project_name: string; raw: string }[]>({
    queryKey: ["/api/projects-summary"],
    select: (data: any[]) => data.map((p: any) => ({
      id: p.project_info_id || p.id,
      project_name: p.project_name?.replace(/_Tracker.*$/, "").replace(/_/g, " ") || p.projectName || "",
      raw: p.project_name || "",
      phase: p.phase || "",
    })).filter((p: any) => p.project_name && !EXCLUDED_PHASES_DRAWER.includes(p.phase)).sort((a: any, b: any) => a.project_name.localeCompare(b.project_name)),
  });

  const projectPhaseInfo = useMemo(() => {
    if (!task.projectName) return null;
    const proj = drawerProjects.find((p: any) => p.raw === task.projectName || p.project_name === task.projectName);
    const phase = (proj as any)?.phase as ProjectPhase | undefined;
    const slug = task.projectName.replace(/ /g, "_");
    return {
      phaseLabel: phase ? PROJECT_PHASE_LABELS[phase as keyof typeof PROJECT_PHASE_LABELS] || phase : null,
      phaseColor: phase ? PHASE_COLORS[phase] : null,
      trackerName: slug.endsWith("_Tracker") ? slug : slug + "_Tracker",
    };
  }, [task.projectName, drawerProjects]);

  // Bootstrap for the send-deliverable dialog moved into SendDeliverableDialog.

  // Bootstrap for the send-for-approval dialog moved into SendForApprovalDialog.


  useEffect(() => {
    if (!localSyncedConfig) return;
    setMappedPathDraft(localSyncedConfig.mappedPath || "");
    setFallbackDraft(localSyncedConfig.fallbackPreference || "download");
  }, [localSyncedConfig?.mappedPath, localSyncedConfig?.fallbackPreference]);

  const saveLocalConfigMutation = useMutation({
    mutationFn: () => engFetch("/api/eng/local-synced-save/config", { method: "PUT", body: JSON.stringify({ mappedPath: mappedPathDraft, fallbackPreference: fallbackDraft }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["local-synced-save-config"] });
      toast({ title: "Local synced save config updated" });
    },
    onError: (e: Error) => toast({ title: "Config update failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (updates: Record<string, any>) =>
      engFetch(`/api/eng/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify(updates) }),
    onSuccess: () => {
      invalidateEngineeringTicketCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: ["task-activity", task.id] });
      onUpdate();
      toast({ title: "Task updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addCommentMutation = useMutation({
    mutationFn: (body: string) =>
      engFetch(`/api/eng/tasks/${task.id}/comments`, { method: "POST", body: JSON.stringify({ body }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-comments", task.id] });
      queryClient.invalidateQueries({ queryKey: ["task-activity", task.id] });
      // Input clears its own text after submit (state lives inside the child).
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      engFetch(`/api/eng/tasks/${task.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateEngineeringTicketCaches(queryClient);
      onClose();
      onUpdate();
      toast({ title: "Task deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const runLocalSyncedSaveAttempt = async (file: File | null, suggestedName: string): Promise<LocalSyncedSaveResult | null> => {
    if (!localSyncedSaveEnabled) return null;
    if (!file) {
      return { supported: false, status: "failed", error: "No file available for local save." };
    }
    const picker = typeof window !== "undefined" ? window.showSaveFilePicker : undefined;
    if (!picker) {
      return { supported: false, status: "failed", error: "showSaveFilePicker is unavailable in this runtime." };
    }
    try {
      const handle = await picker({ suggestedName });
      const writable = await handle.createWritable();
      await writable.write(await file.arrayBuffer());
      await writable.close();
      const targetPath = `${localSyncedConfig?.mappedPath || "mapped_path"}/${suggestedName}`;
      return { supported: true, status: "succeeded", targetPath };
    } catch (err) {
      return { supported: true, status: "failed", error: err instanceof Error ? err.message : "Local save cancelled or failed." };
    }
  };

  const handleStatusChange = (newStatus: string) => {
    if (!task) return;
    if (!canTransition(task.status, newStatus)) {
      toast({ title: "Transition not allowed", description: `Cannot move task from ${getTaskStatusLabel(task.status)} to ${getTaskStatusLabel(newStatus)}.`, variant: "destructive" });
      return;
    }
    const blockedReason = getTaskWorkflowBlockReason(task, newStatus);
    if (blockedReason) {
      toast({ title: "Status change blocked", description: blockedReason, variant: "destructive" });
      return;
    }
    if (newStatus === "hold") {
      setDrawerHoldDialog(true);
      setDrawerHoldReason("");
      setDrawerBlockedType("");
      return;
    }
    if (newStatus === "projects_assistance" && !task.projectName) {
      toast({ title: "Project required", description: "Link a project to this task before setting Projects Assistance status.", variant: "destructive" });
      return;
    }
    if (newStatus === "complete") {
      const hasHighWarnings = task.trackingRag === "Red" || normalizeTaskPriority(task.priority) === "Urgent";
      if (hasHighWarnings) {
        setDrawerCompletionConfirm(true);
        return;
      }
    }
    updateMutation.mutate({ status: newStatus });
  };

  const handleInlineEdit = (field: string, value: string) => {
    updateMutation.mutate({ [field]: value || null });
    setEditingField(null);
  };

  // Approval actions previously fired an un-awaited comment + status mutation
  // and toasted success synchronously, so a failed status PATCH still showed a
  // success toast (and a second error toast). Sequence them and only confirm
  // success after the status change actually resolves. The child mutations own
  // their error toasts, so a failure surfaces honestly with no false success.
  const [approvalActionPending, setApprovalActionPending] = useState(false);
  const runApprovalAction = async ({
    status,
    commentPrefix,
    successTitle,
    successDescription,
  }: {
    status: string;
    commentPrefix: string;
    successTitle: string;
    successDescription: string;
  }) => {
    if (approvalActionPending) return;
    setApprovalActionPending(true);
    try {
      const comment = approvalComment.trim();
      if (comment) {
        await addCommentMutation.mutateAsync(`[${commentPrefix}] ${comment}`);
      }
      await updateMutation.mutateAsync({ status });
      setApprovalComment("");
      toast({ title: successTitle, description: successDescription });
    } catch {
      // addCommentMutation / updateMutation already surfaced the error toast.
    } finally {
      setApprovalActionPending(false);
    }
  };

  const projectDisplay = task.projectName?.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
  const overdue = isOverdue(task.dueDate, task.status);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      data-testid="task-detail-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-drawer-title"
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <ErrorBoundary>
      <div className="relative h-full w-full max-w-full sm:max-w-2xl bg-background border-l shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <Badge className={`text-[10px] shrink-0 ${getTaskStatusBadgeClass(task.status)}`}>{getTaskStatusLabel(task.status)}</Badge>
            <span className="text-sm text-muted-foreground truncate">{projectDisplay}</span>
            {task.taskTypeTag === "PROJECT" && <Badge variant="outline" className="text-[9px]">Project</Badge>}
          </div>
          <div className="flex items-center gap-1">
            {canDelete && (
              <Button variant="ghost" size="icon" onClick={() => setShowDeleteConfirm(true)} className="text-red-500 hover:text-red-600 hover:bg-red-50" aria-label="Delete task" data-testid="btn-delete-task">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close task details" data-testid="btn-close-drawer">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {showDeleteConfirm && (
          <div className="px-4 py-3 bg-red-50 border-b border-red-200">
            <p className="text-sm text-red-800 font-medium mb-2">Delete this task permanently?</p>
            <p className="text-xs text-red-600 mb-3">This will remove the task, all comments, and activity history. This cannot be undone.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} data-testid="btn-confirm-delete-task">
                {deleteMutation.isPending ? "Deleting..." : "Yes, delete"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowDeleteConfirm(false)} data-testid="btn-cancel-delete-task">
                Cancel
              </Button>
            </div>
          </div>
        )}

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-5">
            <div>
              <h2 id="task-drawer-title" className="text-xl font-bold leading-tight" data-testid="text-drawer-title">{task.title}</h2>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <span className="inline-flex items-center rounded border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  Work Item #{task.workItemId || task.id}
                </span>
                {task.externalTaskId && (
                  <span className="inline-flex items-center rounded border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    Ref: {task.externalTaskId}
                  </span>
                )}
                {task.projectLinkedDeliverableCount ? (
                  <span className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">
                    {task.projectLinkedDeliverableCount} project deliverable{task.projectLinkedDeliverableCount === 1 ? "" : "s"}
                  </span>
                ) : null}
                {task.microsoftActionRequiredCount ? (
                  <span className="inline-flex items-center rounded border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] text-cyan-700">
                    {task.microsoftActionRequiredCount} Microsoft action{task.microsoftActionRequiredCount === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
              {user && task.assigneeUserId && task.assigneeUserId !== user.id && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-medium border bg-sky-50 border-sky-200 text-sky-700" data-testid="badge-viewing">
                    <Eye className="h-3 w-3" />Viewing
                  </span>
                </div>
              )}
            </div>

            <PostUpdateForm
              taskId={task.id}
              currentStatus={task.status}
              hasProject={!!task.projectName}
              onDone={() => {
                invalidateEngineeringTicketCaches(queryClient);
                onUpdate();
              }}
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</Label>
                <SearchableSelect
                  value={task.status}
                  onValueChange={handleStatusChange}
                  placeholder="Status"
                  triggerClassName="h-8 text-xs"
                  options={TASK_STATUSES.map(s => ({ value: s, label: getTaskStatusLabel(s) }))}
                  data-testid="select-drawer-status"
                />
                {(() => {
                  const validNext = TASK_STATUSES.filter(s => s !== task.status && canTransition(task.status, s));
                  if (validNext.length === 0) return null;
                  return (
                    <p className="text-[9px] text-muted-foreground mt-0.5">
                      Can move to: {validNext.map(s => getTaskStatusLabel(s)).join(" · ")}
                    </p>
                  );
                })()}
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Priority</Label>
                <SearchableSelect
                  value={task.priority}
                  onValueChange={(v) => updateMutation.mutate({ priority: v })}
                  placeholder="Priority"
                  triggerClassName="h-8 text-xs"
                  options={PRIORITIES.map(p => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))}
                  data-testid="select-drawer-priority"
                />
              </div>

              {(canonicalizeTaskStatus(task.status) === "hold" && (task.holdReason || task.blockedType)) && (
                <div className="bg-red-50 border border-red-200 rounded-md p-2.5 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                    <span className="text-[10px] font-semibold text-red-700 uppercase">
                      On Hold{task.blockedType ? ` — ${task.blockedType}` : ""}
                    </span>
                  </div>
                  {task.holdReason && (
                    <p className="text-[11px] text-red-700">{task.holdReason}</p>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Due Date</Label>
                <Input
                  type="date"
                  className={`h-8 text-xs ${overdue ? "border-red-300 text-red-600" : ""}`}
                  value={task.dueDate || ""}
                  onChange={(e) => updateMutation.mutate({ dueDate: e.target.value || null })}
                  data-testid="input-drawer-due-date"
                />
                {task.dueDate && (() => {
                  const label = daysLabel(task.dueDate);
                  if (!label) return null;
                  const isLate = label.includes("late");
                  return (
                    <span className={`text-[10px] font-medium ${isLate ? "text-red-600" : "text-muted-foreground"}`}>
                      {isLate ? <AlertTriangle className="inline h-3 w-3 mr-0.5" /> : <Clock className="inline h-3 w-3 mr-0.5" />}
                      {label}
                    </span>
                  );
                })()}
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Start Date</Label>
                <Input
                  type="date"
                  className="h-8 text-xs"
                  value={task.startDate || ""}
                  onChange={(e) => updateMutation.mutate({ startDate: e.target.value || null })}
                  data-testid="input-drawer-start-date"
                />
              </div>
            </div>

            {task.resolvedOwner && (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Owner</Label>
                <div className="flex items-center gap-2 text-xs">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${getAvatarColor(task.resolvedOwner.name)}`}>
                    {getInitials(task.resolvedOwner.name)}
                  </div>
                  <div>
                    <span className="font-medium">{task.resolvedOwner.name}</span>
                    <span className="text-muted-foreground ml-1.5 text-[10px]">{task.resolvedOwner.role}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Assignee</Label>
              <UserAssignmentPicker
                taskId={Number.isFinite(task.id) ? task.id : 0}
                taskSource="plan"
                resolvedUsers={task.resolvedAssignees || null}
                textNames={task.assignees || null}
                mode="multi"
                size="sm"
                invalidateKeys={["engineering-tickets", "eng-tasks", "/api/my-work/all-tasks"]}
                disableRemove={normalizeRoleForPermissions(user?.role) === "ENGINEER"}
              />
              {task.assignees && task.assignees.length > 1 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {task.assignees.slice(1).map((a, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">{a}</Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Linked Project</Label>
              <Popover open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" aria-expanded={projectPickerOpen} className="w-full h-8 justify-between text-xs font-normal" data-testid="select-drawer-project">
                    {task.projectName ? projectDisplay : "Select project..."}
                    <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search projects..." className="h-8 text-xs" />
                    <CommandList>
                      <CommandEmpty>No project found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem value="no-project" onSelect={() => { updateMutation.mutate({ projectName: null }); setProjectPickerOpen(false); }} className="text-xs">
                          <Check className={`mr-2 h-3 w-3 ${!task.projectName ? "opacity-100" : "opacity-0"}`} />
                          No project
                        </CommandItem>
                        {drawerProjects.map(p => (
                          <CommandItem key={p.id} value={p.project_name} onSelect={() => { updateMutation.mutate({ projectName: p.raw || p.project_name }); setProjectPickerOpen(false); }} className="text-xs">
                            <Check className={`mr-2 h-3 w-3 ${(task.projectName === p.raw || task.projectName === p.project_name) ? "opacity-100" : "opacity-0"}`} />
                            {p.project_name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {task.projectName && projectPhaseInfo && (
                <div className="flex items-center gap-2 mt-1">
                  {projectPhaseInfo.phaseLabel && (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${projectPhaseInfo.phaseColor?.bg || "bg-muted"} ${projectPhaseInfo.phaseColor?.text || "text-foreground"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${projectPhaseInfo.phaseColor?.accent || "bg-slate-500"}`} />
                      {projectPhaseInfo.phaseLabel}
                    </span>
                  )}
                  <a href={`/project/${projectPhaseInfo.trackerName}`} className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 hover:underline">
                    <ExternalLink className="h-3 w-3" /> View Project
                  </a>
                </div>
              )}
            </div>

            <div className="space-y-3 p-3 bg-slate-50/70 rounded-lg border">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <FolderKanban className="h-3.5 w-3.5" /> Context & Traceability
                </Label>
                <div className="flex gap-1.5">
                  {task.sourceHref && (
                    <Button asChild size="sm" variant="outline" className="h-7 text-[10px] gap-1">
                      <a href={task.sourceHref}>
                        <ArrowRightLeft className="h-3 w-3" />
                        Engineering
                      </a>
                    </Button>
                  )}
                  {task.projectHref && (
                    <Button asChild size="sm" variant="outline" className="h-7 text-[10px] gap-1">
                      <a href={task.projectHref}>
                        <FolderKanban className="h-3 w-3" />
                        Project
                      </a>
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {task.isUnassigned ? <Badge variant="outline" className="text-[10px] bg-slate-50 text-slate-700 border-slate-200">Unassigned</Badge> : null}
                {task.isBlocked ? <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200">Blocked</Badge> : null}
                {task.isReviewNeeded ? <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">Review Needed</Badge> : null}
                {task.isApprovalPending ? <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">QC Review Pending</Badge> : null}
                {task.projectName ? <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">Project Linked</Badge> : <Badge variant="outline" className="text-[10px] bg-slate-50 text-slate-700 border-slate-200">No Project</Badge>}
              </div>

              {(task.projectLinkedDeliverableCount || 0) > 0 && (
                <div className="rounded-md border bg-background p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-foreground">Project-linked deliverables</p>
                      <p className="text-[10px] text-muted-foreground">
                        {task.projectLinkedDeliverableCount} linked to this project
                        {task.approvalPendingDeliverableCount ? ` · ${task.approvalPendingDeliverableCount} awaiting QC review` : ""}
                      </p>
                    </div>
                    {task.deliverableContextHref && (
                      <Button asChild size="sm" variant="outline" className="h-7 text-[10px] gap-1">
                        <a href={task.deliverableContextHref}>
                          <Paperclip className="h-3 w-3" />
                          Open flow
                        </a>
                      </Button>
                    )}
                  </div>
                  {(task.projectLinkedDeliverables || []).map((item: any) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-foreground">{item.title}</span>
                      <DocumentControlBadge row={item} compact data-testid={`drawer-doc-control-${item.id}`} />
                    </div>
                  ))}
                </div>
              )}

              {(task.relatedMicrosoftItems?.length || 0) > 0 && (
                <div className="rounded-md border bg-background p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-foreground">Microsoft-linked context</p>
                      <p className="text-[10px] text-muted-foreground">
                        {(task.relatedMicrosoftItems || []).length} recent linked item{(task.relatedMicrosoftItems || []).length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] bg-cyan-50 text-cyan-700 border-cyan-200">
                      {task.microsoftActionRequiredCount || 0} action{(task.microsoftActionRequiredCount || 0) === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  {(task.relatedMicrosoftItems || []).map((item) => (
                    <div key={item.id} className="rounded border p-2 text-xs space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{item.title || item.type}</p>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.type.replace(/_/g, " ")}</p>
                        </div>
                        {item.actionRequired ? <Badge className="bg-cyan-100 text-cyan-700 border-cyan-200 text-[9px]">Action</Badge> : null}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {item.sourceHref && (
                          <Button asChild size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2">
                            <a href={item.sourceHref}>{item.sourceContextLabel || "Project context"}</a>
                          </Button>
                        )}
                        {item.externalHref && (
                          <Button asChild size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2">
                            <a href={item.externalHref} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3 w-3" />
                              Open original
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3 p-3 bg-muted/20 rounded-lg border">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" /> Approval
                </Label>
              </div>

              {(() => {
                const canonicalTaskStatus = canonicalizeTaskStatus(task.status);
                return (
                  <>
                    {(canonicalTaskStatus === "needs_approval" || canonicalTaskStatus === "operational_approval") && (
                      <div className="space-y-2 pt-1">
                        <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700 flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 shrink-0" />
                          Awaiting approval
                        </div>
                        <Textarea
                          value={approvalComment}
                          onChange={(e) => setApprovalComment(e.target.value)}
                          placeholder="Add approval comment (optional)..."
                          className="min-h-[60px] text-xs"
                          data-testid="textarea-approval-comment"
                        />
                        <div className="flex gap-2 flex-wrap">
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 gap-1"
                            disabled={approvalActionPending}
                            onClick={() => runApprovalAction({
                              status: "qc_approved",
                              commentPrefix: "Approved",
                              successTitle: "Task approved",
                              successDescription: "Status set to QC Approved",
                            })}
                            data-testid="btn-approve-task"
                          >
                            <ThumbsUp className="h-3.5 w-3.5" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-purple-600 border-purple-200 hover:bg-purple-50 gap-1"
                            disabled={approvalActionPending}
                            onClick={() => {
                              if (!approvalComment.trim()) {
                                toast({ title: "Feedback required", description: "Please add a comment explaining what needs to change", variant: "destructive" });
                                return;
                              }
                              runApprovalAction({
                                status: "provide_feedback",
                                commentPrefix: "Feedback",
                                successTitle: "Feedback sent",
                                successDescription: "Task returned to assignee for changes",
                              });
                            }}
                            data-testid="btn-request-changes"
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> Request Changes
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 gap-1"
                            disabled={approvalActionPending}
                            onClick={() => {
                              if (!approvalComment.trim()) {
                                toast({ title: "Reason required", description: "Please add a comment explaining the rejection", variant: "destructive" });
                                return;
                              }
                              runApprovalAction({
                                status: "to_do",
                                commentPrefix: "Rejected",
                                successTitle: "Task rejected",
                                successDescription: "Task sent back to the queue",
                              });
                            }}
                            data-testid="btn-reject-task"
                          >
                            <ThumbsDown className="h-3.5 w-3.5" /> Reject
                          </Button>
                        </div>
                      </div>
                    )}

                    {canonicalTaskStatus === "provide_feedback" && (
                      <div className="p-2 bg-purple-50 border border-purple-200 rounded text-xs text-purple-700 flex items-center gap-2">
                        <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                        Changes requested — address feedback and resubmit for approval
                      </div>
                    )}

                    {canonicalTaskStatus === "qc_approved" && (
                      <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-700 flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        QC Approved — ready for operational sign-off or completion
                      </div>
                    )}

                    {canonicalTaskStatus !== "needs_approval" && canonicalTaskStatus !== "operational_approval" && canonicalTaskStatus !== "qc_approved" && canonicalTaskStatus !== "complete" && (
                <>
                  <Button
                    size="sm"
                    className="h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white gap-1.5 w-full"
                    onClick={() => setShowSendForApproval(true)}
                    data-testid="btn-send-for-approval"
                  >
                    <Send className="h-3.5 w-3.5" /> Submit for QC Review
                  </Button>

                  <SendForApprovalDialog
                    task={task}
                    localSyncedSaveEnabled={localSyncedSaveEnabled}
                    localSyncedConfig={localSyncedConfig ? { mappedPath: localSyncedConfig.mappedPath } : undefined}
                    runLocalSyncedSaveAttempt={runLocalSyncedSaveAttempt}
                    onUpdate={onUpdate}
                    open={showSendForApproval}
                    onClose={() => setShowSendForApproval(false)}
                  />
                </>
              )}
                  </>
                );
              })()}
            </div>

            {localSyncedSaveEnabled && (
              <div className="space-y-2 p-3 bg-muted/30 rounded-lg border">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Local Synced Save Mapping</Label>
                <Input value={mappedPathDraft} onChange={(e) => setMappedPathDraft(e.target.value)} placeholder="e.g. C:\Users\you\OneDrive - Org\Project Deliverables" className="h-8 text-xs" />
                <div className="flex gap-2 items-center">
                  <SearchableSelect
                    value={fallbackDraft}
                    onValueChange={(v) => setFallbackDraft((v as "download" | "clipboard") || "download")}
                    placeholder="Fallback"
                    triggerClassName="h-8 text-xs w-[180px]"
                    options={[{ value: "download", label: "Manual download" }, { value: "clipboard", label: "Copy path + manual save" }]}
                  />
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => saveLocalConfigMutation.mutate()} disabled={saveLocalConfigMutation.isPending}>
                    {saveLocalConfigMutation.isPending ? "Saving..." : "Save mapping"}
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-3 p-3 bg-blue-50/30 rounded-lg border border-blue-200/50/30">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Paperclip className="h-3.5 w-3.5" /> Deliverables
                </Label>
                <Badge variant="outline" className="text-[10px]">{taskDeliverables.length}</Badge>
              </div>

              <Button
                size="sm"
                className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1.5 w-full"
                onClick={() => setShowSendDeliverable(true)}
                data-testid="btn-send-deliverable"
              >
                <Send className="h-3.5 w-3.5" /> Send Document
              </Button>

              {taskDeliverables.length > 0 && (
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {taskDeliverables.map((del: any) => (
                    <div key={del.id} className="p-2 bg-card rounded border text-xs space-y-1" data-testid={`deliverable-item-${del.id}`}>
                      {/* Inline preview for images */}
                      {/\.(png|jpe?g|gif|webp|svg)$/i.test(del.originalName || "") && (
                        <div className="rounded overflow-hidden border mb-1 bg-muted/20">
                          <img
                            src={`/api/eng/deliverables/${del.id}/download`}
                            alt={del.originalName}
                            className="max-h-[200px] w-full object-contain"
                            loading="lazy"
                          />
                        </div>
                      )}
                      {/* PDF inline preview */}
                      {/\.pdf$/i.test(del.originalName || "") && (
                        <div className="rounded overflow-hidden border mb-1">
                          <iframe
                            src={`/api/eng/deliverables/${del.id}/download#toolbar=0`}
                            className="w-full h-[200px]"
                            title={del.originalName}
                          />
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <a
                          href={`/api/eng/deliverables/${del.id}/download`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 truncate text-blue-600 hover:underline"
                          data-testid={`link-download-deliverable-${del.id}`}
                        >
                          <Paperclip className="h-3 w-3 text-blue-500 shrink-0" />
                          <span className="font-medium truncate">{del.originalName}</span>
                          {del.fileSize && <span className="text-[9px] text-muted-foreground shrink-0">({(del.fileSize / 1024).toFixed(0)}KB)</span>}
                        </a>
                        {del.acknowledged ? (
                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-[9px] shrink-0">Acknowledged</Badge>
                        ) : (
                          del.recipientUserId === user?.id ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] border-blue-300 text-blue-700 hover:bg-blue-50 gap-1 shrink-0"
                              onClick={async () => {
                                try {
                                  const token = localStorage.getItem("auth_token");
                                  const res = await fetch(`/api/eng/deliverables/${del.id}/acknowledge`, {
                                    method: "PATCH",
                                    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
                                    credentials: "include",
                                  });
                                  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
                                  toast({ title: "Acknowledged", description: `Deliverable "${del.originalName}" acknowledged` });
                                  queryClient.invalidateQueries({ queryKey: ["task-deliverables", task.id] });
                                  queryClient.invalidateQueries({ queryKey: ["task-comments", task.id] });
                                  queryClient.invalidateQueries({ queryKey: ["task-activity", task.id] });
                                } catch (err) {
                                  toast({ title: "Error", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
                                }
                              }}
                              data-testid={`btn-acknowledge-${del.id}`}
                            >
                              <CheckCircle2 className="h-3 w-3" /> Acknowledge
                            </Button>
                          ) : (
                            <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-300 shrink-0">Pending</Badge>
                          )
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span>{del.senderName} → {del.recipientName}</span>
                        <span>·</span>
                        <span>{del.createdAt ? new Date(del.createdAt).toLocaleDateString() : ""}</span>
                      </div>
                      {del.note && <p className="text-muted-foreground italic">{del.note}</p>}
                      {del.acknowledged && del.acknowledgedAt && (
                        <p className="text-emerald-600 text-[10px]">Acknowledged {new Date(del.acknowledgedAt).toLocaleDateString()}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <SendDeliverableDialog
                task={task}
                currentUserId={user?.id}
                teamMembers={teamMembers}
                localSyncedSaveEnabled={localSyncedSaveEnabled}
                localSyncedConfig={localSyncedConfig ? { mappedPath: localSyncedConfig.mappedPath } : undefined}
                runLocalSyncedSaveAttempt={runLocalSyncedSaveAttempt}
                open={showSendDeliverable}
                onClose={() => setShowSendDeliverable(false)}
              />
            </div>

            {task.holdReason && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs font-semibold text-red-700 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Hold Reason
                  {task.blockedType && <Badge variant="outline" className={`ml-1 text-[10px] ${task.blockedType === "External" ? "border-orange-400 text-orange-700" : "border-purple-400 text-purple-700"}`}>{task.blockedType}</Badge>}
                </p>
                <p className="text-sm mt-1">{task.holdReason}</p>
              </div>
            )}

            <Separator />

            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Description</Label>
              {editingField === "description" ? (
                <div className="space-y-2">
                  <Textarea
                    value={editValues.description ?? task.description ?? ""}
                    onChange={(e) => setEditValues(v => ({ ...v, description: e.target.value }))}
                    className="min-h-[100px] text-sm"
                    data-testid="textarea-drawer-description"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" className="h-7 text-xs" onClick={() => handleInlineEdit("description", editValues.description || "")}>Save</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingField(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="w-full text-left text-sm whitespace-pre-wrap cursor-pointer hover:bg-muted/30 rounded p-2 min-h-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => { setEditValues({ description: task.description || "" }); setEditingField("description"); }}
                  aria-label="Edit description"
                  data-testid="text-drawer-description"
                >
                  {task.description || <span className="text-muted-foreground italic">Click to add description...</span>}
                </button>
              )}
            </div>

            {task.summaryText && (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Summary</Label>
                <p className="text-sm whitespace-pre-wrap bg-muted/20 rounded p-2">{task.summaryText}</p>
              </div>
            )}

            {task.trackingRag && (
              <div className="flex items-center gap-2">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Tracking</Label>
                <div className={`w-3 h-3 rounded-full ${task.trackingRag === "Green" ? "bg-green-500" : task.trackingRag === "Amber" ? "bg-amber-500" : task.trackingRag === "Red" ? "bg-red-500" : "bg-gray-400"}`} />
                <span className="text-sm">{task.trackingRag}</span>
              </div>
            )}

            <Separator />

            <div className="flex border-b" role="tablist" aria-label="Task details">
              {(["updates", "activity", "subtasks", "dependencies"] as const).map(tab => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setActiveTab(tab)}
                  data-testid={`tab-${tab}`}
                >
                  {tab === "updates" && <MessageSquare className="h-3.5 w-3.5 inline mr-1" />}
                  {tab === "activity" && <Activity className="h-3.5 w-3.5 inline mr-1" />}
                  {tab === "subtasks" && <ListTodo className="h-3.5 w-3.5 inline mr-1" />}
                  {tab === "dependencies" && <Link2 className="h-3.5 w-3.5 inline mr-1" />}
                  {tab === "updates" ? "Comments" : tab === "dependencies" ? "Deps" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {tab === "updates" && comments.length > 0 && <span className="ml-1 text-muted-foreground">({comments.length})</span>}
                  {tab === "activity" && activity.length > 0 && <span className="ml-1 text-muted-foreground">({activity.length})</span>}
                  {tab === "subtasks" && subtasks.length > 0 && <span className="ml-1 text-muted-foreground">({subtasks.length})</span>}
                </button>
              ))}
            </div>

            {activeTab === "updates" && (
              <div className="space-y-3">
                <CommentInputWithMentions
                  teamMembers={teamMembers}
                  submitting={addCommentMutation.isPending}
                  onSubmit={(body) => addCommentMutation.mutate(body)}
                />
                {comments.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No updates yet - post the first one above!</p>
                ) : (
                  <div className="space-y-2">
                    {comments.map(c => (
                      <div key={c.id} className="p-2.5 bg-muted/30 rounded-lg" data-testid={`comment-${c.id}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium flex items-center gap-1">
                            <UserCircle className="h-3.5 w-3.5 text-muted-foreground" />
                            {c.authorName || "Team"}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{formatDate(c.createdAt)}</span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "activity" && (
              <div className="space-y-1">
                {activity.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No activity yet</p>
                ) : (
                  activity.map(a => (
                    <div key={a.id} className="flex items-start gap-2 py-1.5 text-xs" data-testid={`activity-${a.id}`}>
                      <Activity className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <span className="font-medium">{a.actorName || "System"}</span>
                        {" "}
                        {a.actionType === "created" && <span>created this task</span>}
                        {a.actionType === "field_changed" && (
                          <span>changed <span className="font-medium">{a.fieldName}</span> from "{a.oldValue}" to "{a.newValue}"</span>
                        )}
                        {a.actionType === "comment_added" && <span>added a comment</span>}
                        {!["created", "field_changed", "comment_added"].includes(a.actionType) && (
                          <span>{a.actionType}: {a.newValue}</span>
                        )}
                        <span className="text-muted-foreground ml-1">{formatDate(a.createdAt)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "subtasks" && (
              <div className="space-y-2">
                <SubtaskQuickAdd taskId={task.id} />
                {subtasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No subtasks yet</p>
                ) : (
                  subtasks.map(st => (
                    <div key={st.id} className="flex items-center gap-2 p-2 border rounded-lg text-sm group" data-testid={`subtask-${st.id}`}>
                      <button
                        className="shrink-0"
                        data-testid={`subtask-toggle-${st.id}`}
                        aria-label={canonicalizeTaskStatus(st.status) === "complete" ? `Mark subtask "${st.title}" incomplete` : `Mark subtask "${st.title}" complete`}
                        onClick={async () => {
                          const isComplete = canonicalizeTaskStatus(st.status) === "complete";
                          const newStatus = isComplete ? "to_do" : "complete";
                          try {
                            await engFetch(`/api/eng/tasks/${st.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ status: newStatus }),
                            });
                            queryClient.invalidateQueries({ queryKey: ["task-subtasks", task.id] });
                          } catch (err) {
                            toast({ title: "Could not update subtask", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
                          }
                        }}
                      >
                        {canonicalizeTaskStatus(st.status) === "complete" ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground hover:text-primary" />
                        )}
                      </button>
                      <span className={`flex-1 truncate ${canonicalizeTaskStatus(st.status) === "complete" ? "line-through text-muted-foreground" : ""}`}>{st.title}</span>
                      <Badge className={`text-[9px] ${getTaskStatusBadgeClass(st.status)}`}>{getTaskStatusLabel(st.status)}</Badge>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "dependencies" && (
              <TaskDependenciesPanel task={task} />
            )}

            {(task.linkedPlanItemId || task.linkedDeliverableId || task.linkedQualityItemInstanceId) && (
              <>
                <Separator />
                <div className="space-y-2">
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Linked Items</Label>
                  {task.linkedPlanItemId && (
                    <div className="flex items-center gap-2 text-xs p-2 bg-muted/20 rounded">
                      <ChevronRight className="h-3 w-3" /> Plan Item #{task.linkedPlanItemId}
                    </div>
                  )}
                  {task.linkedDeliverableId && (
                    <div className="flex items-center gap-2 text-xs p-2 bg-muted/20 rounded">
                      <ChevronRight className="h-3 w-3" /> Deliverable #{task.linkedDeliverableId}
                    </div>
                  )}
                  {task.linkedQualityItemInstanceId && (
                    <div className="flex items-center gap-2 text-xs p-2 bg-muted/20 rounded">
                      <ChevronRight className="h-3 w-3" /> Quality Item #{task.linkedQualityItemInstanceId}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      <HoldReasonDialog
        open={drawerHoldDialog}
        onOpenChange={setDrawerHoldDialog}
        onConfirm={(reason, blockedType) => {
          updateMutation.mutate({ status: "hold", holdReason: reason, blockedType });
        }}
        testIdPrefix="drawer-hold"
      />

      <ConfirmDialog
        open={drawerCompletionConfirm}
        onOpenChange={setDrawerCompletionConfirm}
        title="Complete this task?"
        description="This task is flagged with high-severity warnings. Marking it complete will bypass the usual review path."
        confirmLabel="Mark complete"
        impact={
          <p data-testid="drawer-completion-impact">
            Flags:{" "}
            <strong>
              {[
                task.trackingRag === "Red" ? "Red tracking RAG" : null,
                normalizeTaskPriority(task.priority) === "Urgent" ? "Urgent priority" : null,
              ]
                .filter(Boolean)
                .join(", ")}
            </strong>
          </p>
        }
        onConfirm={() => updateMutation.mutate({ status: "complete" })}
      />
      </ErrorBoundary>
    </div>
  );
}
