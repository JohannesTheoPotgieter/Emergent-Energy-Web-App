import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HoldReasonDialog } from "@/components/HoldReasonDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import {
  ListTodo,
  Plus,
  Filter,
  Loader2,
  Zap,
  GanttChart,
  Link2,
  Search,
  X,
  Calendar,
  User,
  MessageSquare,
  Activity,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Columns3,
  List,
  Send,
  FolderKanban,
  Circle,
  UserCircle,
  Timer,
  ArrowRight,
  PauseCircle,
  ChevronsUpDown,
  Check,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  ShieldCheck,
  UserCheck,
  Trash2,
  UserCog,
  ExternalLink,
  Edit3,
  Minimize2,
  Maximize2,
  Eye,
  EyeOff,
  Pencil,
  Paperclip,
  Save,
  RotateCw,
  ArrowRightLeft,
  RefreshCw,
  CornerDownRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePermission } from "@/hooks/use-permissions";
import { PROJECT_PHASE_LABELS, normalizeRoleForPermissions, type ProjectPhase } from "@shared/schema";
import {
  TASK_STATUSES,
  canTransition,
  getTaskStatusBadgeClass,
  getTaskStatusBarClass,
  getTaskStatusColumnClass,
  getTaskStatusLabel,
  getVisibleStatusesForView,
  isTaskComplete,
  isTaskCompleteForReporting,
} from "@/lib/task-status";
import { ActionBar } from "@/components/guidance/ActionBar";
import UserAssignmentPicker from "@/components/UserAssignmentPicker";
import { InlineTip } from "@/components/guidance/InlineTip";
import { MicroWalkthrough, ReplayWalkthrough } from "@/components/guidance/MicroWalkthrough";
import { useRolloutFlag } from "@/hooks/use-rollout-flag";
import type { NextAction, BlockerInfo } from "@/hooks/use-guidance";
import type { Task, Comment, ActivityEntry, TeamMember } from "@/components/tasks/types";
import { formatDate, formatDateShort, isOverdue, isDueThisWeek, daysLabel, getAvatarColor, getInitials, sortTasksForColumn } from "@/lib/task-formatters";
import {
  deriveEngineeringTaskMetrics,
  filterEngineeringTasks,
  type EngineeringDueDateFilter,
  type EngineeringLinkedSourceFilter,
  type EngineeringWorkloadStateFilter,
  useEngineeringTaskFilters,
} from "@/hooks/useEngineeringTaskFilters";
import { fetchRolloutFeatureFlags } from "@/lib/feature-flags";
import { getTaskWorkflowBlockReason } from "@/lib/task-workflow-guard";
import { engFetch } from "@/lib/eng-fetch";
import { TaskDependenciesPanel } from "./engineering/panels/TaskDependenciesPanel";
import { DocumentControlBadge } from "@/components/engineering/DocumentControlBadge";
import { PHASE_COLORS } from "@/lib/phase-colors";
import { invalidateAllTaskCaches, engineeringTicketKeys } from "@/lib/task-cache";
import { canonicalizeTaskStatus } from "@/lib/task-status-compat";
import {
  TASK_PRIORITY_VALUES,
  TASK_PRIORITY_LABELS,
  DEFAULT_TASK_PRIORITY,
  normalizeTaskPriority,
  taskPriorityLabel,
  taskPriorityBadgeClass,
  taskPriorityBorderClass,
  taskPrioritySortOrder,
} from "@shared/task-priorities";

// Filter constants + per-user view localStorage helpers were extracted to
// ./engineering/task-filter-config (UI/UX audit X5 module split). Re-exported
// here so the public surface of this module is unchanged.
export {
  PRIORITIES,
  DUE_DATE_FILTER_OPTIONS,
  WORKLOAD_STATE_OPTIONS,
  LINKED_SOURCE_OPTIONS,
  priorityColors,
  priorityBorderColors,
  SAVED_FILTERS,
  getSavedMyName,
  setSavedMyName,
  getEngViewKey,
  getSavedEngDefaultView,
  saveEngDefaultView,
  clearEngDefaultView,
} from "./engineering/task-filter-config";
import {
  PRIORITIES,
  DUE_DATE_FILTER_OPTIONS,
  WORKLOAD_STATE_OPTIONS,
  LINKED_SOURCE_OPTIONS,
  SAVED_FILTERS,
  getSavedMyName,
  getSavedEngDefaultView,
  saveEngDefaultView,
  clearEngDefaultView,
} from "./engineering/task-filter-config";

// Card/column cluster extracted to ./engineering/engineering-task-cards
// (UI/UX audit module split). Imported for internal use + re-exported so the
// public surface (and ./engineering barrels) is unchanged.
import {
  QuickStatusSelect,
  QuickEditPopover,
  getTaskContextBadges,
  MoveCardMenu,
  TaskCard,
  KanbanColumn,
} from "./engineering/engineering-task-cards";
export {
  QuickStatusSelect,
  QuickEditPopover,
  getTaskContextBadges,
  MoveCardMenu,
  TaskCard,
  KanbanColumn,
} from "./engineering/engineering-task-cards";
// Workload summary strip extracted to ./engineering/engineering-workload-strip.
import { EngineeringWorkloadStrip } from "./engineering/engineering-workload-strip";
export { EngineeringWorkloadStrip } from "./engineering/engineering-workload-strip";


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
      invalidateAllTaskCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: ["task-comments", taskId] });
      queryClient.invalidateQueries({ queryKey: ["task-activity", taskId] });
      setUpdateText("");
      setHoldReason("");
      toast({ title: "Update posted" });
      onDone();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
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

/**
 * DependenciesTab — thin wrapper around TaskDependenciesPanel.
 * Kept as a named export for backward compat with the barrel.
 * @deprecated Use TaskDependenciesPanel directly.
 */
export { TaskDependenciesPanel as DependenciesTab } from "./engineering/panels/TaskDependenciesPanel";

export function TaskDetailDrawer({
  task, onClose, onUpdate
}: {
  task: Task; onClose: () => void; onUpdate: () => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const [activeTab, setActiveTab] = useState<"updates" | "activity" | "subtasks" | "dependencies">("updates");
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [approvalComment, setApprovalComment] = useState("");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [showApprovalActions, setShowApprovalActions] = useState(false);
  const [showSendForApproval, setShowSendForApproval] = useState(false);
  const [sendApprovalNote, setSendApprovalNote] = useState("");
  const [sendApprovalFile, setSendApprovalFile] = useState<File | null>(null);
  const [sendingForApproval, setSendingForApproval] = useState(false);
  const [showSendDeliverable, setShowSendDeliverable] = useState(false);
  const [deliverableFile, setDeliverableFile] = useState<File | null>(null);
  const [deliverableRecipient, setDeliverableRecipient] = useState("");
  const [deliverableNote, setDeliverableNote] = useState("");
  const [sendingDeliverable, setSendingDeliverable] = useState(false);
  const [recipientSuggestion, setRecipientSuggestion] = useState("");
  const [recipientOverrideReason, setRecipientOverrideReason] = useState("");
  const [linkedProjectSuggestion, setLinkedProjectSuggestion] = useState("");
  const [linkedProjectFinal, setLinkedProjectFinal] = useState("");
  const [linkedProjectOverrideReason, setLinkedProjectOverrideReason] = useState("");
  const [approvalProjectSuggestion, setApprovalProjectSuggestion] = useState("");
  const [approvalProjectFinal, setApprovalProjectFinal] = useState("");
  const [approvalProjectOverrideReason, setApprovalProjectOverrideReason] = useState("");
  const [approvalRouteSuggestion, setApprovalRouteSuggestion] = useState("");
  const [approvalRouteFinal, setApprovalRouteFinal] = useState("");
  const [approvalRouteOverrideReason, setApprovalRouteOverrideReason] = useState("");
  const [drawerHoldDialog, setDrawerHoldDialog] = useState(false);
  const [drawerHoldReason, setDrawerHoldReason] = useState("");
  const [drawerBlockedType, setDrawerBlockedType] = useState("");
  // X6: replace window.confirm with the shared ConfirmDialog so the
  // high-severity completion guard matches every other confirm in the app.
  const [drawerCompletionConfirm, setDrawerCompletionConfirm] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
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

  useEffect(() => {
    if (!showSendDeliverable) return;
    const suggestedRecipient = task.ownerUserId ? String(task.ownerUserId) : "";
    setRecipientSuggestion(suggestedRecipient);
    if (!deliverableRecipient && suggestedRecipient) {
      setDeliverableRecipient(suggestedRecipient);
    }
    const projectSuggestion = task.projectName || "";
    setLinkedProjectSuggestion(projectSuggestion);
    if (!linkedProjectFinal) setLinkedProjectFinal(projectSuggestion);
  }, [showSendDeliverable, task.id]);

  useEffect(() => {
    if (!showSendForApproval) return;
    const projectSuggestion = task.projectName || "";
    setApprovalProjectSuggestion(projectSuggestion);
    if (!approvalProjectFinal) setApprovalProjectFinal(projectSuggestion);
    const routeSuggestion = task.ownerUserId ? String(task.ownerUserId) : "owner";
    setApprovalRouteSuggestion(routeSuggestion);
    if (!approvalRouteFinal) setApprovalRouteFinal(routeSuggestion);
  }, [showSendForApproval, task.id]);


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
      invalidateAllTaskCaches(queryClient);
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
      setCommentText("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      engFetch(`/api/eng/tasks/${task.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateAllTaskCaches(queryClient);
      onClose();
      onUpdate();
      toast({ title: "Task deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const runLocalSyncedSaveAttempt = async (file: File | null, suggestedName: string) => {
    if (!localSyncedSaveEnabled) return null;
    if (!file) {
      return { supported: false, status: "failed", error: "No file available for local save." };
    }
    const pickerSupported = typeof window !== "undefined" && "showSaveFilePicker" in window;
    if (!pickerSupported) {
      return { supported: false, status: "failed", error: "showSaveFilePicker is unavailable in this runtime." };
    }
    try {
      // @ts-ignore
      const handle = await window.showSaveFilePicker({ suggestedName });
      const writable = await handle.createWritable();
      await writable.write(await file.arrayBuffer());
      await writable.close();
      const targetPath = `${localSyncedConfig?.mappedPath || "mapped_path"}/${suggestedName}`;
      return { supported: true, status: "succeeded", targetPath };
    } catch (err: any) {
      return { supported: true, status: "failed", error: err?.message || "Local save cancelled or failed." };
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

  const projectDisplay = task.projectName?.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
  const overdue = isOverdue(task.dueDate, task.status);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="task-detail-drawer">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <ErrorBoundary>
      <div className="relative h-full w-full max-w-full sm:max-w-2xl bg-background border-l shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <Badge className={`text-[10px] shrink-0 ${getTaskStatusBadgeClass(task.status)}`}>{task.status}</Badge>
            <span className="text-sm text-muted-foreground truncate">{projectDisplay}</span>
            {task.taskTypeTag === "PROJECT" && <Badge variant="outline" className="text-[9px]">Project</Badge>}
          </div>
          <div className="flex items-center gap-1">
            {canDelete && (
              <Button variant="ghost" size="icon" onClick={() => setShowDeleteConfirm(true)} className="text-red-500 hover:text-red-600 hover:bg-red-50" data-testid="btn-delete-task">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={onClose} data-testid="btn-close-drawer">
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
              <h2 className="text-xl font-bold leading-tight" data-testid="text-drawer-title">{task.title}</h2>
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
                invalidateAllTaskCaches(queryClient);
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
                            className="h-7 text-xs bg-green-600 hover:bg-green-700 gap-1"
                            onClick={() => {
                              if (approvalComment.trim()) {
                                addCommentMutation.mutate(`[Approved] ${approvalComment.trim()}`);
                              }
                              updateMutation.mutate({ status: "qc_approved" });
                              setApprovalComment("");
                              toast({ title: "Task approved", description: "Status set to QC Approved" });
                            }}
                            data-testid="btn-approve-task"
                          >
                            <ThumbsUp className="h-3.5 w-3.5" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-purple-600 border-purple-200 hover:bg-purple-50 gap-1"
                            onClick={() => {
                              if (!approvalComment.trim()) {
                                toast({ title: "Feedback required", description: "Please add a comment explaining what needs to change", variant: "destructive" });
                                return;
                              }
                              addCommentMutation.mutate(`[Feedback] ${approvalComment.trim()}`);
                              updateMutation.mutate({ status: "provide_feedback" });
                              setApprovalComment("");
                              toast({ title: "Feedback sent", description: "Task returned to assignee for changes" });
                            }}
                            data-testid="btn-request-changes"
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> Request Changes
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 gap-1"
                            onClick={() => {
                              if (!approvalComment.trim()) {
                                toast({ title: "Reason required", description: "Please add a comment explaining the rejection", variant: "destructive" });
                                return;
                              }
                              addCommentMutation.mutate(`[Rejected] ${approvalComment.trim()}`);
                              updateMutation.mutate({ status: "to_do" });
                              setApprovalComment("");
                              toast({ title: "Task rejected", description: "Task sent back to the queue" });
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

                  <Dialog open={showSendForApproval} onOpenChange={(open) => {
                    setShowSendForApproval(open);
                    if (!open) { setSendApprovalNote(""); setSendApprovalFile(null); }
                  }}>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                          <Send className="h-4 w-4 text-amber-600" /> Submit for QC Review
                        </DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 pt-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium">Attachment (optional)</Label>
                          <div
                            className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer hover:border-amber-400 hover:bg-amber-50/30 ${sendApprovalFile ? "border-amber-400 bg-amber-50/20" : "border-muted"}`}
                            onClick={() => {
                              const input = document.createElement("input");
                              input.type = "file";
                              input.onchange = (e) => {
                                const file = (e.target as HTMLInputElement).files?.[0];
                                if (file) setSendApprovalFile(file);
                              };
                              input.click();
                            }}
                            data-testid="dropzone-approval-file"
                          >
                            {sendApprovalFile ? (
                              <div className="flex items-center justify-center gap-2 text-sm">
                                <CheckCircle2 className="h-4 w-4 text-amber-600" />
                                <span className="truncate max-w-[200px]">{sendApprovalFile.name}</span>
                                <button onClick={(e) => { e.stopPropagation(); setSendApprovalFile(null); }} className="text-muted-foreground hover:text-red-500">
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground">
                                Click to upload a deliverable file
                              </div>
                            )}
                          </div>
                        </div>
                        {localSyncedSaveEnabled && (
                          <div className="rounded-md border p-2 text-[11px] text-muted-foreground space-y-1">
                            <div>Local synced save mapping: <span className="font-medium">{localSyncedConfig?.mappedPath || "Not configured"}</span></div>
                            {!localSyncedConfig?.mappedPath && <div className="text-amber-700">Fallback will be used; local synced save cannot be confirmed.</div>}
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium">Suggested project</Label>
                          <Input value={approvalProjectFinal} onChange={(e) => setApprovalProjectFinal(e.target.value)} className="h-8 text-xs" />
                          {approvalProjectSuggestion && approvalProjectSuggestion !== approvalProjectFinal && (
                            <Input value={approvalProjectOverrideReason} onChange={(e) => setApprovalProjectOverrideReason(e.target.value)} placeholder="Reason for overriding suggested project (required)" className="h-8 text-xs border-amber-300" />
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium">Suggested approval route</Label>
                          <Input value={approvalRouteFinal} onChange={(e) => setApprovalRouteFinal(e.target.value)} className="h-8 text-xs" />
                          {approvalRouteSuggestion && approvalRouteSuggestion !== approvalRouteFinal && (
                            <Input value={approvalRouteOverrideReason} onChange={(e) => setApprovalRouteOverrideReason(e.target.value)} placeholder="Reason for overriding suggested route (required)" className="h-8 text-xs border-amber-300" />
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium">Note (optional)</Label>
                          <Textarea
                            value={sendApprovalNote}
                            onChange={(e) => setSendApprovalNote(e.target.value)}
                            placeholder="Add context for the reviewer..."
                            className="min-h-[60px] text-sm"
                            data-testid="textarea-send-approval-note"
                          />
                        </div>
                        <div className="flex gap-2 pt-2">
                          <Button
                            className="flex-1 h-9 text-sm bg-amber-600 hover:bg-amber-700 gap-1.5"
                            disabled={sendingForApproval || !!(approvalProjectSuggestion && approvalProjectFinal && approvalProjectSuggestion !== approvalProjectFinal && !approvalProjectOverrideReason.trim()) || !!(approvalRouteSuggestion && approvalRouteFinal && approvalRouteSuggestion !== approvalRouteFinal && !approvalRouteOverrideReason.trim())}
                            onClick={async () => {
                              setSendingForApproval(true);
                              try {
                                const formData = new FormData();
                                formData.append("note", sendApprovalNote);
                                if (sendApprovalFile) formData.append("file", sendApprovalFile);
                                formData.append("projectSuggestion", approvalProjectSuggestion || "");
                                formData.append("projectFinal", approvalProjectFinal || "");
                                formData.append("projectOverrideReason", approvalProjectOverrideReason || "");
                                formData.append("routeSuggestion", approvalRouteSuggestion || "");
                                formData.append("routeFinal", approvalRouteFinal || "");
                                formData.append("routeOverrideReason", approvalRouteOverrideReason || "");

                                const localSave = await runLocalSyncedSaveAttempt(sendApprovalFile, sendApprovalFile?.name || `task_${task.id}_approval.txt`);
                                if (localSave) {
                                  formData.append("localSave", JSON.stringify(localSave));
                                }

                                const token = localStorage.getItem("auth_token");
                                const res = await fetch(`/api/eng/tasks/${task.id}/send-for-approval`, {
                                  method: "POST",
                                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                                  body: formData,
                                  credentials: "include",
                                });
                                if (!res.ok) {
                                  const err = await res.json().catch(() => ({ error: "Failed" }));
                                  throw new Error(err.error);
                                }
                                const payload = await res.json();
                                const canonicalSaved = payload?.sendResult?.canonicalSystemRecord?.saved ? "Yes" : "No";
                                const localSaved = payload?.sendResult?.localSyncedPath?.saved ? "Yes" : "No";
                                toast({ title: "Sent for approval", description: `Saved to system: ${canonicalSaved} • Saved to local synced path: ${localSaved}` });
                                setShowSendForApproval(false);
                                setSendApprovalNote(""); setSendApprovalFile(null);
                                onUpdate();
                                queryClient.invalidateQueries({ queryKey: ["task-comments", task.id] });
                                queryClient.invalidateQueries({ queryKey: ["task-activity", task.id] });
                              } catch (err: any) {
                                toast({ title: "Error", description: err.message, variant: "destructive" });
                              } finally {
                                setSendingForApproval(false);
                              }
                            }}
                            data-testid="btn-confirm-send-approval"
                          >
                            {sendingForApproval ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                            {sendingForApproval ? "Submitting..." : "Submit for QC Review"}
                          </Button>
                          <Button variant="outline" className="h-9 text-sm" onClick={() => setShowSendForApproval(false)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
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
                                } catch (err: any) {
                                  toast({ title: "Error", description: err.message, variant: "destructive" });
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

              <Dialog open={showSendDeliverable} onOpenChange={(open) => {
                setShowSendDeliverable(open);
                if (!open) { setDeliverableFile(null); setDeliverableRecipient(""); setDeliverableNote(""); }
              }}>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                      <Send className="h-4 w-4 text-blue-600" /> Send Document
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Recipient <span className="text-red-500">*</span></Label>
                      <SearchableSelect
                        value={deliverableRecipient}
                        onValueChange={setDeliverableRecipient}
                        placeholder="Select recipient..."
                        triggerClassName="h-9 text-sm"
                        options={teamMembers.filter(m => m.id !== user?.id).map(m => ({
                          value: String(m.id),
                          label: m.fullName,
                        }))}
                        data-testid="select-deliverable-recipient"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">File <span className="text-red-500">*</span></Label>
                      <div
                        className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 ${deliverableFile ? "border-blue-400 bg-blue-50/20" : "border-muted"}`}
                        onClick={() => {
                          const input = document.createElement("input");
                          input.type = "file";
                          input.onchange = (e) => {
                            const file = (e.target as HTMLInputElement).files?.[0];
                            if (file) setDeliverableFile(file);
                          };
                          input.click();
                        }}
                        data-testid="dropzone-deliverable-file"
                      >
                        {deliverableFile ? (
                          <div className="flex items-center justify-center gap-2 text-sm">
                            <CheckCircle2 className="h-4 w-4 text-blue-600" />
                            <span className="truncate max-w-[200px]">{deliverableFile.name}</span>
                            <button onClick={(e) => { e.stopPropagation(); setDeliverableFile(null); }} className="text-muted-foreground hover:text-red-500">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">Click to attach a deliverable file</div>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Recipient suggestion</Label>
                      <div className="text-[11px] text-muted-foreground">Suggested: {recipientSuggestion || "None"}</div>
                      {recipientSuggestion && deliverableRecipient && recipientSuggestion !== deliverableRecipient && (
                        <Input value={recipientOverrideReason} onChange={(e) => setRecipientOverrideReason(e.target.value)} placeholder="Reason for overriding suggested recipient (required)" className="h-8 text-xs border-amber-300" />
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Linked project</Label>
                      <Input value={linkedProjectFinal} onChange={(e) => setLinkedProjectFinal(e.target.value)} className="h-8 text-xs" />
                      {linkedProjectSuggestion && linkedProjectSuggestion !== linkedProjectFinal && (
                        <Input value={linkedProjectOverrideReason} onChange={(e) => setLinkedProjectOverrideReason(e.target.value)} placeholder="Reason for overriding suggested linked project (required)" className="h-8 text-xs border-amber-300" />
                      )}
                    </div>
                    {localSyncedSaveEnabled && (
                      <div className="rounded-md border p-2 text-[11px] text-muted-foreground space-y-1">
                        <div>Local synced save mapping: <span className="font-medium">{localSyncedConfig?.mappedPath || "Not configured"}</span></div>
                        {!localSyncedConfig?.mappedPath && <div className="text-amber-700">Fallback will be used; local synced save cannot be confirmed.</div>}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Note (optional)</Label>
                      <Textarea
                        value={deliverableNote}
                        onChange={(e) => setDeliverableNote(e.target.value)}
                        placeholder="Add context for the recipient..."
                        className="min-h-[60px] text-sm"
                        data-testid="textarea-deliverable-note"
                      />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button
                        className="flex-1 h-9 text-sm bg-blue-600 hover:bg-blue-700 gap-1.5"
                        disabled={!deliverableRecipient || !deliverableFile || sendingDeliverable || !!(recipientSuggestion && deliverableRecipient && recipientSuggestion !== deliverableRecipient && !recipientOverrideReason.trim()) || !!(linkedProjectSuggestion && linkedProjectFinal && linkedProjectSuggestion !== linkedProjectFinal && !linkedProjectOverrideReason.trim())}
                        onClick={async () => {
                          setSendingDeliverable(true);
                          try {
                            const formData = new FormData();
                            formData.append("recipientUserId", deliverableRecipient);
                            formData.append("note", deliverableNote);
                            if (deliverableFile) formData.append("file", deliverableFile);
                            formData.append("recipientSuggestion", recipientSuggestion || "");
                            formData.append("recipientFinal", deliverableRecipient || "");
                            formData.append("recipientOverrideReason", recipientOverrideReason || "");
                            formData.append("linkedProjectSuggestion", linkedProjectSuggestion || "");
                            formData.append("linkedProjectFinal", linkedProjectFinal || "");
                            formData.append("linkedProjectOverrideReason", linkedProjectOverrideReason || "");

                            const localSave = await runLocalSyncedSaveAttempt(deliverableFile, deliverableFile?.name || `task_${task.id}_deliverable.bin`);
                            if (localSave) {
                              formData.append("localSave", JSON.stringify(localSave));
                            }

                            const token = localStorage.getItem("auth_token");
                            const res = await fetch(`/api/eng/tasks/${task.id}/send-deliverable`, {
                              method: "POST",
                              headers: token ? { Authorization: `Bearer ${token}` } : {},
                              body: formData,
                              credentials: "include",
                            });
                            if (!res.ok) {
                              const err = await res.json().catch(() => ({ error: "Failed" }));
                              throw new Error(err.error);
                            }
                            const payload = await res.json();
                            const canonicalSaved = payload?.sendResult?.canonicalSystemRecord?.saved ? "Yes" : "No";
                            const localSaved = payload?.sendResult?.localSyncedPath?.saved ? "Yes" : "No";
                            toast({ title: "Deliverable sent", description: `Saved to system: ${canonicalSaved} • Saved to local synced path: ${localSaved}` });
                            setShowSendDeliverable(false);
                            setDeliverableFile(null); setDeliverableRecipient(""); setDeliverableNote("");
                            queryClient.invalidateQueries({ queryKey: ["task-deliverables", task.id] });
                            queryClient.invalidateQueries({ queryKey: ["task-comments", task.id] });
                            queryClient.invalidateQueries({ queryKey: ["task-activity", task.id] });
                          } catch (err: any) {
                            toast({ title: "Error", description: err.message, variant: "destructive" });
                          } finally {
                            setSendingDeliverable(false);
                          }
                        }}
                        data-testid="btn-confirm-send-deliverable"
                      >
                        {sendingDeliverable ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        {sendingDeliverable ? "Sending..." : "Send Document"}
                      </Button>
                      <Button variant="outline" className="h-9 text-sm" onClick={() => setShowSendDeliverable(false)}>Cancel</Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
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
                <div
                  className="text-sm whitespace-pre-wrap cursor-pointer hover:bg-muted/30 rounded p-2 min-h-[40px]"
                  onClick={() => { setEditValues({ description: task.description || "" }); setEditingField("description"); }}
                  data-testid="text-drawer-description"
                >
                  {task.description || <span className="text-muted-foreground italic">Click to add description...</span>}
                </div>
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

            <div className="flex border-b">
              {(["updates", "activity", "subtasks", "dependencies"] as const).map(tab => (
                <button
                  key={tab}
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
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      value={commentText}
                      onChange={(e) => {
                        setCommentText(e.target.value);
                        const val = e.target.value;
                        const atIdx = val.lastIndexOf("@");
                        if (atIdx >= 0 && atIdx === val.length - 1) {
                          setMentionQuery("");
                          setShowMentions(true);
                        } else if (atIdx >= 0 && !val.substring(atIdx).includes(" ")) {
                          setMentionQuery(val.substring(atIdx + 1).toLowerCase());
                          setShowMentions(true);
                        } else {
                          setShowMentions(false);
                        }
                      }}
                      placeholder="Add a comment... use @ to mention"
                      className="text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Escape" && showMentions) { setShowMentions(false); e.stopPropagation(); return; }
                        if (e.key === "Enter" && !e.shiftKey && commentText.trim() && !showMentions) {
                          addCommentMutation.mutate(commentText.trim());
                        }
                      }}
                      data-testid="input-comment"
                    />
                    {showMentions && (
                      <div className="absolute bottom-full left-0 w-full mb-1 bg-white border rounded-md shadow-lg z-50 max-h-[150px] overflow-y-auto">
                        {teamMembers
                          .filter(m => !mentionQuery || m.fullName.toLowerCase().includes(mentionQuery))
                          .slice(0, 6)
                          .map(m => (
                            <button
                              key={m.id}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-2"
                              onClick={() => {
                                const atIdx = commentText.lastIndexOf("@");
                                setCommentText(commentText.substring(0, atIdx) + `@${m.fullName} `);
                                setShowMentions(false);
                              }}
                            >
                              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white ${getAvatarColor(m.fullName)}`}>
                                {getInitials(m.fullName)}
                              </div>
                              <span className="font-medium">{m.fullName}</span>
                              <span className="text-muted-foreground ml-auto">{m.role}</span>
                            </button>
                          ))}
                        {teamMembers.filter(m => !mentionQuery || m.fullName.toLowerCase().includes(mentionQuery)).length === 0 && (
                          <p className="text-xs text-muted-foreground p-2 text-center">No matches</p>
                        )}
                      </div>
                    )}
                  </div>
                  <Button
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    disabled={!commentText.trim() || addCommentMutation.isPending}
                    onClick={() => commentText.trim() && addCommentMutation.mutate(commentText.trim())}
                    data-testid="btn-send-comment"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
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
                <form
                  className="flex gap-2"
                  data-testid="subtask-create-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const title = newSubtaskTitle.trim();
                    if (!title) return;
                    try {
                      await engFetch(`/api/eng/tasks/${task.id}/subtasks`, {
                        method: "POST",
                        body: JSON.stringify({ title }),
                      });
                      setNewSubtaskTitle("");
                      queryClient.invalidateQueries({ queryKey: ["task-subtasks", task.id] });
                      queryClient.invalidateQueries({ queryKey: ["task-activity", task.id] });
                    } catch {}
                  }}
                >
                  <Input
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    placeholder="Add a subtask..."
                    className="h-8 text-xs"
                    data-testid="subtask-title-input"
                  />
                  <Button type="submit" size="sm" className="h-8 px-3" disabled={!newSubtaskTitle.trim()} data-testid="subtask-add-btn">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </form>
                {subtasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No subtasks yet</p>
                ) : (
                  subtasks.map(st => (
                    <div key={st.id} className="flex items-center gap-2 p-2 border rounded-lg text-sm group" data-testid={`subtask-${st.id}`}>
                      <button
                        className="shrink-0"
                        data-testid={`subtask-toggle-${st.id}`}
                        onClick={async () => {
                          const isComplete = canonicalizeTaskStatus(st.status) === "complete";
                          const newStatus = isComplete ? "to_do" : "complete";
                          try {
                            await engFetch(`/api/eng/tasks/${st.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ status: newStatus }),
                            });
                            queryClient.invalidateQueries({ queryKey: ["task-subtasks", task.id] });
                          } catch {}
                        }}
                      >
                        {canonicalizeTaskStatus(st.status) === "complete" ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground hover:text-primary" />
                        )}
                      </button>
                      <span className={`flex-1 truncate ${canonicalizeTaskStatus(st.status) === "complete" ? "line-through text-muted-foreground" : ""}`}>{st.title}</span>
                      <Badge className={`text-[9px] ${getTaskStatusBadgeClass(st.status)}`}>{st.status}</Badge>
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

// PHASE_COLORS imported from @/lib/phase-colors

// View components extracted to ./engineering/engineering-task-views
// (UI/UX audit module split). Imported for internal use + re-exported so the
// public surface (and ./engineering barrels) is unchanged.
import {
  ProjectKanbanView,
  PersonalKpiStrip,
  TimelineView,
  InlineListView,
  MyTasksView,
} from "./engineering/engineering-task-views";
export {
  ProjectKanbanView,
  PersonalKpiStrip,
  TimelineView,
  InlineListView,
  MyTasksView,
  type ProjectGroup,
} from "./engineering/engineering-task-views";


export default function EngineeringTasksPage() {
  const { enabled: microWalkthroughEnabled } = useRolloutFlag("micro_walkthrough");
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const savedDefaults = useMemo(() => getSavedEngDefaultView(user?.id), [user?.id]);
  const initialUrlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [viewMode, setViewMode] = useState<"board" | "list" | "projects" | "mytasks" | "timeline">(() => {
    const urlView = initialUrlParams.get("view") as any;
    if (urlView && ["board", "list", "projects", "mytasks", "timeline"].includes(urlView)) return urlView;
    return savedDefaults?.viewMode || "board";
  });
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [myName, setMyName] = useState(() => {
    const saved = getSavedMyName();
    if (saved) return saved;
    const fullName = user?.name || "";
    return fullName.split(/\s+/)[0];
  });
  const [showNamePicker, setShowNamePicker] = useState(false);
  // Canonicalise the incoming ?status= param so legacy uppercase links from
  // the dashboard, admin-approvals, or external bookmarks ("HOLD",
  // "NEEDS APPROVAL", "IN PROGRESS") resolve to the snake_case values the
  // filter compares against.
  const initialStatusParam = initialUrlParams.get("status");
  const initialStatus = initialStatusParam ? canonicalizeTaskStatus(initialStatusParam) : (savedDefaults?.statusFilter || "all");
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus);
  const [priorityFilter, setPriorityFilter] = useState<string>(initialUrlParams.get("priority") || savedDefaults?.priorityFilter || "all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>(initialUrlParams.get("assignee") || savedDefaults?.assigneeFilter || "all");
  // ?project=<name> comes from admin-approvals / lifecycle-board and should
  // populate the project *filter*, not the free-text search. Fall back to
  // search if the name doesn't look like a real project (preserves old
  // single-param bookmarks).
  const initialProjectParam = initialUrlParams.get("project") || "";
  const [projectFilter, setProjectFilter] = useState<string>(initialProjectParam || savedDefaults?.projectFilter || "all");
  const [dueDateFilter, setDueDateFilter] = useState<EngineeringDueDateFilter>(
    (initialUrlParams.get("dueDate") as EngineeringDueDateFilter) || (savedDefaults?.dueDateFilter as EngineeringDueDateFilter) || "all",
  );
  const [workloadStateFilter, setWorkloadStateFilter] = useState<EngineeringWorkloadStateFilter>(
    (initialUrlParams.get("workloadState") as EngineeringWorkloadStateFilter) ||
      (savedDefaults?.workloadStateFilter as EngineeringWorkloadStateFilter) ||
      "all",
  );
  const [linkedSourceFilter, setLinkedSourceFilter] = useState<EngineeringLinkedSourceFilter>(
    (initialUrlParams.get("linkedSource") as EngineeringLinkedSourceFilter) ||
      (savedDefaults?.linkedSourceFilter as EngineeringLinkedSourceFilter) ||
      "all",
  );
  const [hasCustomDefault, setHasCustomDefault] = useState(!!savedDefaults);
  const [searchTerm, setSearchTerm] = useState(() => initialUrlParams.get("q") || "");

  // Sync key state to URL for shareable links (without full page reload).
  // ?project= carries the project filter (matches admin-approvals / lifecycle-board links);
  // ?q= carries the free-text search, so the two are no longer conflated.
  useEffect(() => {
    const params = new URLSearchParams();
    if (viewMode !== "board") params.set("view", viewMode);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (priorityFilter !== "all") params.set("priority", priorityFilter);
    if (assigneeFilter !== "all") params.set("assignee", assigneeFilter);
    if (dueDateFilter !== "all") params.set("dueDate", dueDateFilter);
    if (workloadStateFilter !== "all") params.set("workloadState", workloadStateFilter);
    if (linkedSourceFilter !== "all") params.set("linkedSource", linkedSourceFilter);
    if (projectFilter !== "all") params.set("project", projectFilter);
    if (searchTerm) params.set("q", searchTerm);
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    if (url !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", url);
    }
  }, [viewMode, statusFilter, priorityFilter, assigneeFilter, dueDateFilter, workloadStateFilter, linkedSourceFilter, projectFilter, searchTerm]);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTask, setNewTask] = useState({
    projectId: null as number | null,
    projectName: "",
    title: "",
    description: "",
    status: "to_do",
    priority: DEFAULT_TASK_PRIORITY,
    phase: "",
    primaryWorkstream: "",
    dueDate: "",
    assignees: [] as string[],
    ownerUserId: null as number | null,
    ownerDisplayName: "",
  });

  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [holdDialog, setHoldDialog] = useState<{ taskId: number; reason: string; blockedType: string } | null>(null);
  const [completionGuard, setCompletionGuard] = useState<{ taskId: number; reason: string } | null>(null);
  const [boardCompact, setBoardCompact] = useState(savedDefaults?.boardCompact || false);
  const [boardGroupBy, setBoardGroupBy] = useState<"status" | "priority" | "assignee" | "project">("status");
  const [collapsedColumns, setCollapsedColumns] = useState<Set<string>>(() => new Set());
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const bulkMode = selectedTaskIds.size > 0;
  // X6: bulk status/priority changes must be confirmed (with an impact
  // preview) before they fan out. Holds the pending change until the user
  // confirms via the shared ConfirmDialog.
  const [pendingBulk, setPendingBulk] = useState<
    | { kind: "status"; taskIds: number[]; value: string; label: string }
    | { kind: "priority"; taskIds: number[]; value: string; label: string }
    | null
  >(null);

  const toggleTaskSelection = useCallback((taskId: number) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedTaskIds(new Set()), []);

  const toggleColumnCollapse = useCallback((status: string) => {
    setCollapsedColumns(prev => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  }, []);

  // Keyboard shortcuts. Numeric view-switch keys require a `g` prefix
  // (GitHub-style chord) so numbers typed idly after a dialog closes don't
  // accidentally switch views.
  const [showShortcuts, setShowShortcuts] = useState(false);
  const goChordArmedRef = useRef<number | null>(null);
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Clear a stale chord after 1.5s of inactivity.
      const now = Date.now();
      if (goChordArmedRef.current && now - goChordArmedRef.current > 1500) {
        goChordArmedRef.current = null;
      }

      if (e.key === "?") { setShowShortcuts(s => !s); return; }
      if (e.key === "n") { setCreateOpen(true); return; }
      if (e.key === "Escape") {
        goChordArmedRef.current = null;
        if (selectedTask) { setSelectedTask(null); return; }
        if (showShortcuts) { setShowShortcuts(false); return; }
      }
      if (e.key === "g") { goChordArmedRef.current = now; return; }

      if (goChordArmedRef.current) {
        if (e.key === "1") { setViewMode("board"); goChordArmedRef.current = null; return; }
        if (e.key === "2") { setViewMode("mytasks"); goChordArmedRef.current = null; return; }
        if (e.key === "3") { setViewMode("projects"); goChordArmedRef.current = null; return; }
        if (e.key === "4") { setViewMode("list"); goChordArmedRef.current = null; return; }
        if (e.key === "5") { setViewMode("timeline"); goChordArmedRef.current = null; return; }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedTask, showShortcuts]);

  const { data: tasks = [], isLoading, error, refetch } = useQuery<Task[]>({
    queryKey: engineeringTicketKeys.scope("board"),
    queryFn: () => engFetch("/api/eng/tasks"),
    refetchOnMount: "always",
    staleTime: 10_000,
    refetchInterval: 60_000,
  });

  const { data: pageTeamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ["team-members"],
    queryFn: () => engFetch("/api/eng/team-members"),
  });

  const EXCLUDED_PHASES = ["Hold", "Done", "Closed", "Gone"];
  const { data: allProjects = [] } = useQuery<{ id: number; project_name: string }[]>({
    queryKey: ["/api/projects-summary"],
    select: (data: any[]) => data.map((p: any) => ({
      id: p.project_info_id || p.id,
      project_name: p.project_name?.replace(/_Tracker.*$/, "").replace(/_/g, " ") || p.projectName || "",
      phase: p.phase || "",
    })).filter((p: any) => p.project_name && !EXCLUDED_PHASES.includes(p.phase)).sort((a: any, b: any) => a.project_name.localeCompare(b.project_name)),
  });

  // If the initial ?project= value doesn't match any known project name once
  // the project list loads, treat it as free-text search (legacy bookmark
  // compatibility). Runs once per load of allProjects.
  useEffect(() => {
    if (!initialProjectParam) return;
    if (projectFilter !== initialProjectParam) return;
    if (allProjects.length === 0) return;
    const matches = allProjects.some(p => p.project_name === initialProjectParam);
    if (!matches) {
      setProjectFilter("all");
      setSearchTerm(prev => prev || initialProjectParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allProjects.length]);

  const myTasks = useMemo(() => {
    if (!myName) return [];
    const nameLower = myName.toLowerCase();
    return tasks.filter(t =>
      ((t.assignees || []).length > 0 ? (t.assignees || []) : (t.resolvedAssignees || []).map((user) => user.name))
        .some((name) => name && name.toLowerCase().startsWith(nameLower))
    );
  }, [tasks, myName]);

  const createMutation = useMutation({
    mutationFn: (task: typeof newTask) => {
      return engFetch("/api/eng/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: task.projectId,
          projectName: task.projectName,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          phase: task.phase,
          primaryWorkstream: task.primaryWorkstream,
          dueDate: task.dueDate,
          ownerUserId: task.ownerUserId,
          assignees: task.assignees,
        }),
      });
    },
    onSuccess: () => {
      invalidateAllTaskCaches(queryClient);
      setCreateOpen(false);
      setNewTask({
        projectId: null,
        projectName: "",
        title: "",
        description: "",
        status: "to_do",
        priority: DEFAULT_TASK_PRIORITY,
        phase: "",
        primaryWorkstream: "",
        dueDate: "",
        assignees: [],
        ownerUserId: null,
        ownerDisplayName: "",
      });
      toast({ title: "Task created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ taskId, status, holdReason, blockedType }: { taskId: number; status: string; holdReason?: string; blockedType?: string }) =>
      engFetch(`/api/eng/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status, ...(holdReason ? { holdReason } : {}), ...(blockedType ? { blockedType } : {}) }) }),
    onSuccess: () => {
      invalidateAllTaskCaches(queryClient);
      toast({ title: "Status updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updatePriorityMutation = useMutation({
    mutationFn: ({ taskId, priority }: { taskId: number; priority: string }) =>
      engFetch(`/api/eng/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ priority }) }),
    onSuccess: () => {
      invalidateAllTaskCaches(queryClient);
      toast({ title: "Priority updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const requestStatusChange = useCallback((taskId: number, newStatus: string) => {
    const task = tasks.find(t => t.id === taskId);
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
      setHoldDialog({ taskId, reason: "", blockedType: "" });
      return;
    }
    if (newStatus === "projects_assistance" && !task.projectName) {
      setSelectedTask(task);
      toast({ title: "Project required", description: "Link a project to this task before setting Projects Assistance status.", variant: "destructive" });
      return;
    }
    updateStatusMutation.mutate({ taskId, status: newStatus });
  }, [tasks, updateStatusMutation, toast]);

  const handleDrop = useCallback((taskId: number, newStatus: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || canonicalizeTaskStatus(task.status) === newStatus) return;
    requestStatusChange(taskId, newStatus);
  }, [tasks, requestStatusChange]);

  const handleStatusChange = useCallback((taskId: number, newStatus: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || canonicalizeTaskStatus(task.status) === newStatus) return;
    if (newStatus === "complete" && (task.trackingRag === "Red" || normalizeTaskPriority(task.priority) === "Urgent")) {
      setCompletionGuard({ taskId, reason: task.trackingRag === "Red" ? "Red tracking RAG" : "Urgent priority" });
      return;
    }
    requestStatusChange(taskId, newStatus);
  }, [tasks, requestStatusChange]);

  const handlePriorityChange = useCallback((taskId: number, newPriority: string) => {
    updatePriorityMutation.mutate({ taskId, priority: newPriority });
  }, [updatePriorityMutation]);

  // Settle every PATCH independently so a partial failure is reported
  // honestly instead of the previous all-or-nothing toast (X6).
  const runBulkPatch = useCallback(
    async (taskIds: number[], body: Record<string, unknown>) => {
      const results = await Promise.allSettled(
        taskIds.map((id) => engFetch(`/api/eng/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) })),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - ok;
      return { ok, failed };
    },
    [],
  );

  const bulkStatusMutation = useMutation({
    mutationFn: ({ taskIds, status }: { taskIds: number[]; status: string }) => runBulkPatch(taskIds, { status }),
    onSuccess: ({ ok, failed }) => {
      invalidateAllTaskCaches(queryClient);
      if (failed === 0) {
        toast({ title: `${ok} task${ok === 1 ? "" : "s"} updated` });
      } else {
        toast({
          title: `${ok} updated, ${failed} failed`,
          description: "Some tasks could not be updated. Selection kept so you can retry.",
          variant: "destructive",
        });
      }
      if (failed === 0) clearSelection();
    },
    onError: (e: Error) => toast({ title: "Bulk update failed", description: e.message, variant: "destructive" }),
  });

  const bulkPriorityMutation = useMutation({
    mutationFn: ({ taskIds, priority }: { taskIds: number[]; priority: string }) => runBulkPatch(taskIds, { priority }),
    onSuccess: ({ ok, failed }) => {
      invalidateAllTaskCaches(queryClient);
      if (failed === 0) {
        toast({ title: `${ok} task${ok === 1 ? "" : "s"} updated` });
      } else {
        toast({
          title: `${ok} updated, ${failed} failed`,
          description: "Some tasks could not be updated. Selection kept so you can retry.",
          variant: "destructive",
        });
      }
      if (failed === 0) clearSelection();
    },
    onError: (e: Error) => toast({ title: "Bulk update failed", description: e.message, variant: "destructive" }),
  });

  // Confirmed executor — fired by the ConfirmDialog.
  const executePendingBulk = useCallback(() => {
    if (!pendingBulk) return;
    if (pendingBulk.kind === "status") {
      bulkStatusMutation.mutate({ taskIds: pendingBulk.taskIds, status: pendingBulk.value });
    } else {
      bulkPriorityMutation.mutate({ taskIds: pendingBulk.taskIds, priority: pendingBulk.value });
    }
    setPendingBulk(null);
  }, [pendingBulk, bulkStatusMutation, bulkPriorityMutation]);

  const updateDueDateMutation = useMutation({
    mutationFn: ({ taskId, dueDate }: { taskId: number; dueDate: string }) =>
      engFetch(`/api/eng/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ dueDate }) }),
    onSuccess: () => {
      invalidateAllTaskCaches(queryClient);
      toast({ title: "Due date updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleDueDateChange = useCallback((taskId: number, dueDate: string) => {
    updateDueDateMutation.mutate({ taskId, dueDate });
  }, [updateDueDateMutation]);

  const uniqueAssignees = Array.from(
    new Set(
      tasks.flatMap((task) =>
        ((task.assignees || []).length > 0 ? (task.assignees || []) : (task.resolvedAssignees || []).map((user) => user.name)).filter(Boolean),
      ),
    ),
  ).sort();
  const uniqueProjects = useMemo(() => Array.from(new Set(tasks.map(t => t.projectName).filter(Boolean))).sort() as string[], [tasks]);

  const basePool = myTasksOnly ? myTasks : tasks;

  const {
    filtered,
    overdueTasks,
    holdTasks,
    unassignedTasks,
    blockedTasks,
    reviewNeededTasks,
    approvalPendingTasks,
    projectLinkedDeliverableTasks,
    microsoftLinkedTasks,
    microsoftActionTasks,
  } = useEngineeringTaskFilters({
    tasks: basePool,
    statusFilter,
    priorityFilter,
    assigneeFilter,
    projectFilter,
    searchTerm,
    dueDateFilter,
    workloadStateFilter,
    linkedSourceFilter,
  });

  const summaryPool = useMemo(
    () =>
      filterEngineeringTasks({
        tasks: basePool,
        statusFilter,
        priorityFilter,
        assigneeFilter,
        projectFilter,
        searchTerm,
        dueDateFilter: "all",
        workloadStateFilter: "all",
        linkedSourceFilter: "all",
      }),
    [assigneeFilter, basePool, priorityFilter, projectFilter, searchTerm, statusFilter],
  );
  const summaryMetrics = useMemo(() => deriveEngineeringTaskMetrics(summaryPool), [summaryPool]);

  const applyPreset = (preset: typeof SAVED_FILTERS[0]) => {
    setStatusFilter("all");
    setPriorityFilter("all");
    setAssigneeFilter("all");
    setProjectFilter("all");
    setDueDateFilter("all");
    setWorkloadStateFilter("all");
    setLinkedSourceFilter("all");
    setSearchTerm("");
    setMyTasksOnly(false);
    if (preset.filter.status) setStatusFilter(preset.filter.status);
    if (preset.filter.dueDateFilter) setDueDateFilter(preset.filter.dueDateFilter);
    if (preset.filter.workloadStateFilter) setWorkloadStateFilter(preset.filter.workloadStateFilter);
    if (preset.filter.linkedSourceFilter) setLinkedSourceFilter(preset.filter.linkedSourceFilter);
  };

  const resetFilters = useCallback(() => {
    setStatusFilter("all");
    setPriorityFilter("all");
    setAssigneeFilter("all");
    setProjectFilter("all");
    setDueDateFilter("all");
    setWorkloadStateFilter("all");
    setLinkedSourceFilter("all");
    setSearchTerm("");
    setMyTasksOnly(false);
  }, []);

  const focusWorkloadState = useCallback((state: EngineeringWorkloadStateFilter) => {
    setWorkloadStateFilter(state);
    setDueDateFilter("all");
    setLinkedSourceFilter("all");
  }, []);

  const hasActiveFilters = useMemo(() => {
    return (
      statusFilter !== "all" ||
      priorityFilter !== "all" ||
      assigneeFilter !== "all" ||
      projectFilter !== "all" ||
      dueDateFilter !== "all" ||
      workloadStateFilter !== "all" ||
      linkedSourceFilter !== "all" ||
      searchTerm.trim().length > 0 ||
      myTasksOnly
    );
  }, [
    assigneeFilter,
    dueDateFilter,
    linkedSourceFilter,
    myTasksOnly,
    priorityFilter,
    projectFilter,
    searchTerm,
    statusFilter,
    workloadStateFilter,
  ]);

  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string; onClear: () => void }[] = [];
    if (statusFilter !== "all") chips.push({ key: "status", label: `Status: ${getTaskStatusLabel(statusFilter)}`, onClear: () => setStatusFilter("all") });
    if (priorityFilter !== "all") chips.push({ key: "priority", label: `Priority: ${taskPriorityLabel(normalizeTaskPriority(priorityFilter))}`, onClear: () => setPriorityFilter("all") });
    if (assigneeFilter !== "all") chips.push({ key: "assignee", label: `Assignee: ${assigneeFilter}`, onClear: () => setAssigneeFilter("all") });
    if (projectFilter !== "all") chips.push({ key: "project", label: `Project: ${projectFilter}`, onClear: () => setProjectFilter("all") });
    if (dueDateFilter !== "all") {
      const option = DUE_DATE_FILTER_OPTIONS.find((item) => item.value === dueDateFilter);
      chips.push({ key: "dueDate", label: `Due: ${option?.label || dueDateFilter}`, onClear: () => setDueDateFilter("all") });
    }
    if (workloadStateFilter !== "all") {
      const option = WORKLOAD_STATE_OPTIONS.find((item) => item.value === workloadStateFilter);
      chips.push({ key: "workload", label: `Workload: ${option?.label || workloadStateFilter}`, onClear: () => setWorkloadStateFilter("all") });
    }
    if (linkedSourceFilter !== "all") {
      const option = LINKED_SOURCE_OPTIONS.find((item) => item.value === linkedSourceFilter);
      chips.push({ key: "linkedSource", label: `Linked: ${option?.label || linkedSourceFilter}`, onClear: () => setLinkedSourceFilter("all") });
    }
    if (searchTerm.trim()) chips.push({ key: "search", label: `Search: ${searchTerm.trim()}`, onClear: () => setSearchTerm("") });
    if (myTasksOnly) chips.push({ key: "myTasks", label: "My tasks only", onClear: () => setMyTasksOnly(false) });
    return chips;
  }, [assigneeFilter, dueDateFilter, linkedSourceFilter, myTasksOnly, priorityFilter, projectFilter, searchTerm, statusFilter, workloadStateFilter]);

  const isPresetActive = useCallback((preset: typeof SAVED_FILTERS[0]) => {
    return (
      (preset.filter.status || "all") === statusFilter &&
      (preset.filter.dueDateFilter || "all") === dueDateFilter &&
      (preset.filter.workloadStateFilter || "all") === workloadStateFilter &&
      (preset.filter.linkedSourceFilter || "all") === linkedSourceFilter &&
      priorityFilter === "all" &&
      assigneeFilter === "all" &&
      projectFilter === "all" &&
      searchTerm.trim().length === 0 &&
      !myTasksOnly
    );
  }, [
    assigneeFilter,
    dueDateFilter,
    linkedSourceFilter,
    myTasksOnly,
    priorityFilter,
    projectFilter,
    searchTerm,
    statusFilter,
    workloadStateFilter,
  ]);

  const presetBadgeCount = useCallback((preset: typeof SAVED_FILTERS[0]) => {
    if (preset.filter.dueDateFilter === "overdue") return summaryMetrics.overdueTasks.length;
    if (preset.filter.workloadStateFilter === "unassigned") return summaryMetrics.unassignedTasks.length;
    if (preset.filter.workloadStateFilter === "blocked") return summaryMetrics.blockedTasks.length;
    if (preset.filter.workloadStateFilter === "review") return summaryMetrics.reviewNeededTasks.length;
    if (preset.filter.workloadStateFilter === "approval") return summaryMetrics.approvalPendingTasks.length;
    if (preset.filter.workloadStateFilter === "deliverable") return summaryMetrics.projectLinkedDeliverableTasks.length;
    if (preset.filter.linkedSourceFilter === "microsoft_linked") return summaryMetrics.microsoftLinkedTasks.length;
    if (preset.filter.linkedSourceFilter === "microsoft_action_required") return summaryMetrics.microsoftActionTasks.length;
    return 0;
  }, [summaryMetrics]);

  const boardStatuses = getVisibleStatusesForView("board");
  const filterStatuses = getVisibleStatusesForView("list");

  const tasksByStatus = TASK_STATUSES.reduce((acc, status) => {
    acc[status] = filtered.filter((t) => canonicalizeTaskStatus(t.status) === status);
    return acc;
  }, {} as Record<string, Task[]>);

  // Column grouping (#13)
  const boardGroupKeys = useMemo(() => {
    if (boardGroupBy === "status") return boardStatuses;
    if (boardGroupBy === "priority") return [...TASK_PRIORITY_VALUES];
    if (boardGroupBy === "assignee") {
      const names = new Set<string>();
      filtered.forEach(t => (t.assignees || []).forEach(a => { if (a) names.add(a); }));
      return ["Unassigned", ...Array.from(names).sort()];
    }
    if (boardGroupBy === "project") {
      const projs = new Set<string>();
      filtered.forEach(t => { if (t.projectName) projs.add(t.projectName); });
      return ["No Project", ...Array.from(projs).sort()];
    }
    return boardStatuses;
  }, [filtered, boardGroupBy, boardStatuses]);

  const tasksByGroup = useMemo(() => {
    if (boardGroupBy === "status") return tasksByStatus;
    const groups: Record<string, Task[]> = {};
    boardGroupKeys.forEach(k => { groups[k] = []; });
    filtered.forEach(t => {
      if (boardGroupBy === "priority") {
        const key = normalizeTaskPriority(t.priority);
        (groups[key] || (groups[key] = [])).push(t);
      } else if (boardGroupBy === "assignee") {
        const assignees = (t.assignees || []).filter(Boolean);
        if (assignees.length === 0) (groups["Unassigned"] || (groups["Unassigned"] = [])).push(t);
        else assignees.forEach(a => (groups[a] || (groups[a] = [])).push(t));
      } else if (boardGroupBy === "project") {
        const key = t.projectName || "No Project";
        (groups[key] || (groups[key] = [])).push(t);
      }
    });
    return groups;
  }, [filtered, boardGroupBy, boardGroupKeys, tasksByStatus]);

  const engNextAction = useMemo((): NextAction | null => {
    if (overdueTasks.length > 0) return { label: `${overdueTasks.length} overdue task${overdueTasks.length !== 1 ? "s" : ""} — review and update`, severity: "urgent" };
    if (approvalPendingTasks.length > 0) return { label: `${approvalPendingTasks.length} task${approvalPendingTasks.length !== 1 ? "s" : ""} awaiting approval`, severity: "warning" };
    if (reviewNeededTasks.length > 0) return { label: `${reviewNeededTasks.length} task${reviewNeededTasks.length !== 1 ? "s" : ""} need review feedback`, severity: "warning" };
    if (blockedTasks.length > 0) return { label: `${blockedTasks.length} blocked task${blockedTasks.length !== 1 ? "s" : ""} need unblock decisions`, severity: "warning" };
    if (holdTasks.length > 0) return { label: `${holdTasks.length} task${holdTasks.length !== 1 ? "s" : ""} on hold — check if blockers resolved`, severity: "warning" };
    return { label: "All tasks on track — review board for next priorities", severity: "info" };
  }, [approvalPendingTasks, blockedTasks, holdTasks, overdueTasks, reviewNeededTasks]);

  const handleSaveDefaultView = useCallback(() => {
    saveEngDefaultView({
      viewMode,
      statusFilter,
      priorityFilter,
      assigneeFilter,
      projectFilter,
      dueDateFilter,
      workloadStateFilter,
      linkedSourceFilter,
      boardCompact,
    }, user?.id);
    setHasCustomDefault(true);
    toast({ title: "Default view saved", description: "This page will open with your current view settings next time." });
  }, [
    assigneeFilter,
    boardCompact,
    dueDateFilter,
    linkedSourceFilter,
    priorityFilter,
    projectFilter,
    statusFilter,
    toast,
    user?.id,
    viewMode,
    workloadStateFilter,
  ]);

  const handleResetDefaultView = useCallback(() => {
    clearEngDefaultView(user?.id);
    setHasCustomDefault(false);
    setViewMode("board");
    setStatusFilter("all");
    setPriorityFilter("all");
    setAssigneeFilter("all");
    setProjectFilter("all");
    setDueDateFilter("all");
    setWorkloadStateFilter("all");
    setLinkedSourceFilter("all");
    setSearchTerm("");
    setMyTasksOnly(false);
    setBoardCompact(false);
    toast({ title: "Default view reset", description: "This page will open with the standard board view." });
  }, [toast, user?.id]);

  const engBlockers = useMemo((): BlockerInfo[] => {
    const b: BlockerInfo[] = [];
    if (overdueTasks.length > 0) b.push({ label: "Overdue tasks", count: overdueTasks.length, severity: "urgent" });
    if (blockedTasks.length > 0) b.push({ label: "Blocked tasks", count: blockedTasks.length, severity: "urgent" });
    if (reviewNeededTasks.length > 0) b.push({ label: "Review needed", count: reviewNeededTasks.length, severity: "warning" });
    if (approvalPendingTasks.length > 0) b.push({ label: "Pending approval", count: approvalPendingTasks.length, severity: "warning" });
    return b;
  }, [approvalPendingTasks, blockedTasks, overdueTasks, reviewNeededTasks]);

  const engWalkthroughSteps = useMemo(() => [
    { title: "Board or List view", description: "Switch between Kanban board and list view using the toggle buttons in the top bar." },
    { title: "Filter & search", description: "Use filters for status, priority, or assignee. Type in the search box to find tasks by name or project." },
    { title: "Drag to update", description: "In board view, drag task cards between columns to change their status instantly." },
  ], []);

  // Check for taskId in URL query params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get("taskId");
    if (taskId && tasks.length > 0) {
      const task = tasks.find(t => t.id === parseInt(taskId));
      if (task) setSelectedTask(task);
    }
  }, [tasks]);

  return (
    <ErrorBoundary>
    <div data-testid="eng-tasks-page" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
            <ListTodo className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold" data-testid="text-tasks-title">Engineering Task Execution Board</h2>
            <p className="text-xs text-muted-foreground">Detailed execution workspace for moving and closing work.</p>
            <p className="text-xs text-muted-foreground">
              {myTasksOnly ? `${myTasks.length} of your tasks` : `${tasks.length} tasks`} · {overdueTasks.length} overdue
            </p>
          </div>
          {microWalkthroughEnabled ? <ReplayWalkthrough screenId="eng-tasks" /> : null}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex border rounded-md">
            <Button
              variant={viewMode === "mytasks" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => {
                setViewMode("mytasks");
                if (!myName) setShowNamePicker(true);
              }}
              data-testid="btn-view-mytasks"
              title="My Tasks"
            >
              <UserCog className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "board" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => setViewMode("board")}
              data-testid="btn-view-board"
              title="Kanban Board"
            >
              <Columns3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "projects" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => setViewMode("projects")}
              data-testid="btn-view-projects"
              title="Projects View"
            >
              <FolderKanban className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => setViewMode("list")}
              data-testid="btn-view-list"
              title="List View"
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "timeline" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => setViewMode("timeline")}
              data-testid="btn-view-timeline"
              title="Timeline View"
            >
              <GanttChart className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center border rounded-md">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs gap-1"
              onClick={handleSaveDefaultView}
              data-testid="btn-save-default-view"
              title="Save current view as your default"
            >
              <Save className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Save Default</span>
            </Button>
            {hasCustomDefault && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs gap-1 text-muted-foreground"
                onClick={handleResetDefaultView}
                data-testid="btn-reset-default-view"
                title="Reset to standard view"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-orange-600 hover:bg-orange-700 h-8 text-xs" data-testid="button-create-task">
                <Plus className="h-4 w-4 mr-1" /> New Task
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Create Task</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Project Name</Label>
                  <Popover open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={projectPickerOpen}
                        className="w-full justify-between font-normal"
                        data-testid="input-task-project"
                      >
                        {newTask.projectName || "Select a project..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search projects..." />
                        <CommandList>
                          <CommandEmpty>No project found.</CommandEmpty>
                          <CommandGroup>
                            {allProjects.map((proj) => (
                              <CommandItem
                                key={proj.id}
                                value={`${proj.id}-${proj.project_name}`}
                                onSelect={() => {
                                  setNewTask(p => ({ ...p, projectId: proj.id, projectName: proj.project_name }));
                                  setProjectPickerOpen(false);
                                }}
                                data-testid={`option-project-${proj.id}`}
                              >
                                <Check className={`mr-2 h-4 w-4 ${newTask.projectId === proj.id ? "opacity-100" : "opacity-0"}`} />
                                {proj.project_name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input data-testid="input-task-title" value={newTask.title} onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))} placeholder="Task title" />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea data-testid="input-task-description" value={newTask.description} onChange={e => setNewTask(p => ({ ...p, description: e.target.value }))} placeholder="Optional description" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <SearchableSelect
                      value={newTask.priority}
                      onValueChange={v => setNewTask(p => ({ ...p, priority: normalizeTaskPriority(v) }))}
                      placeholder="Priority"
                      options={PRIORITIES.map(p => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))}
                      data-testid="select-task-priority"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Due Date</Label>
                    <Input data-testid="input-task-due" type="date" value={newTask.dueDate} onChange={e => setNewTask(p => ({ ...p, dueDate: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Assign To</Label>
                    <SearchableSelect
                      value={newTask.ownerUserId ? String(newTask.ownerUserId) : "none"}
                      onValueChange={v => {
                        if (v === "none") {
                          setNewTask(p => ({ ...p, assignees: [], ownerUserId: null, ownerDisplayName: "" }));
                          return;
                        }
                        const matchedMember = pageTeamMembers.find((m: any) => String(m.id) === v);
                        const displayName = matchedMember?.fullName || (matchedMember as any)?.name || "";
                        setNewTask(p => ({ ...p, assignees: displayName ? [displayName] : [], ownerUserId: Number(v), ownerDisplayName: displayName }));
                      }}
                      placeholder="Select assignee"
                      options={[
                        { value: "none", label: "Unassigned" },
                        ...pageTeamMembers.map((m: any) => {
                          const label = m.fullName || m.name;
                          return { value: String(m.id), label };
                        }),
                      ]}
                      data-testid="select-task-assignee"
                    />
                  </div>
                </div>
                <Button
                  className="w-full bg-orange-600 hover:bg-orange-700"
                  data-testid="button-submit-task"
                  disabled={!newTask.projectId || !newTask.title || createMutation.isPending}
                  onClick={() => createMutation.mutate(newTask)}
                >
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Create Task
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="shadow-sm border-indigo-200/70 bg-gradient-to-r from-indigo-50/70 to-transparent" data-testid="engineering-execution-handoff">
        <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">Workspace intent</p>
            <p className="text-sm font-medium">Use this page for execution: update statuses, move work, and deliver tasks.</p>
            <p className="text-xs text-muted-foreground">For standup triage, team blockers, and project health, switch to Engineering Overview.</p>
          </div>
          <Link href="/engineering">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="btn-open-engineering-overview">
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Back to Engineering Overview
            </Button>
          </Link>
        </CardContent>
      </Card>

      {error && (
        <Card className="shadow-sm border-red-200 bg-red-50/60" data-testid="engineering-tasks-error-banner">
          <CardContent className="p-3 flex items-start gap-2 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Task data did not refresh cleanly.</p>
              <p className="text-xs text-red-600/90">{(error as Error).message || "Unknown error"}</p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0 h-7 text-xs border-red-300 text-red-700 hover:bg-red-100" onClick={() => refetch()} data-testid="btn-retry-tasks">
              <RefreshCw className="h-3 w-3 mr-1" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {(myTasksOnly || viewMode === "mytasks") && (
        <PersonalKpiStrip tasks={tasks} myTasks={myTasks} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[150px] sm:min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-task-search"
            placeholder="Search tasks..."
            className="pl-9 h-8 text-xs"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <SearchableSelect
          value={statusFilter}
          onValueChange={setStatusFilter}
          placeholder="Status"
          triggerClassName="w-[130px] sm:w-[150px] h-8 text-xs"
          options={[
            { value: "all", label: "All Statuses" },
            ...filterStatuses.map(s => ({ value: s, label: getTaskStatusLabel(s) })),
          ]}
          data-testid="filter-task-status"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="filter-task-more">
              <Filter className="h-3.5 w-3.5" /> More
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-3 space-y-2.5">
            <SearchableSelect
              value={priorityFilter}
              onValueChange={setPriorityFilter}
              placeholder="Priority"
              triggerClassName="w-full h-8 text-xs"
              options={[
                { value: "all", label: "All Priorities" },
                ...PRIORITIES.map(p => ({ value: p, label: TASK_PRIORITY_LABELS[p] })),
              ]}
              data-testid="filter-task-priority"
            />
            {uniqueAssignees.length > 0 && (
              <SearchableSelect
                value={assigneeFilter}
                onValueChange={(val) => {
                  setAssigneeFilter(val);
                  if (val === "all") {
                    setMyTasksOnly(false);
                  } else if (myName && val.toLowerCase() === myName.toLowerCase()) {
                    setMyTasksOnly(true);
                  } else {
                    setMyTasksOnly(false);
                  }
                }}
                placeholder="Assignee"
                triggerClassName="w-full h-8 text-xs"
                options={[
                  { value: "all", label: "All Assignees" },
                  ...uniqueAssignees.map(a => ({ value: a, label: a })),
                ]}
                data-testid="filter-task-assignee"
              />
            )}
            {uniqueProjects.length > 0 && (
              <SearchableSelect
                value={projectFilter}
                onValueChange={setProjectFilter}
                placeholder="Project"
                triggerClassName="w-full h-8 text-xs"
                options={[
                  { value: "all", label: "All Projects" },
                  ...uniqueProjects.map(p => ({ value: p, label: p.replace(/_Tracker.*$/i, "").replace(/_/g, " ") })),
                ]}
                data-testid="filter-task-project"
              />
            )}
            <Separator />
            <SearchableSelect
              value={dueDateFilter}
              onValueChange={(value) => setDueDateFilter(value as EngineeringDueDateFilter)}
              placeholder="Due date"
              triggerClassName="w-full h-8 text-xs"
              options={DUE_DATE_FILTER_OPTIONS}
              data-testid="filter-task-due-date"
            />
            <SearchableSelect
              value={workloadStateFilter}
              onValueChange={(value) => setWorkloadStateFilter(value as EngineeringWorkloadStateFilter)}
              placeholder="Workload state"
              triggerClassName="w-full h-8 text-xs"
              options={WORKLOAD_STATE_OPTIONS}
              data-testid="filter-task-workload-state"
            />
            <SearchableSelect
              value={linkedSourceFilter}
              onValueChange={(value) => setLinkedSourceFilter(value as EngineeringLinkedSourceFilter)}
              placeholder="Linked source"
              triggerClassName="w-full h-8 text-xs"
              options={LINKED_SOURCE_OPTIONS}
              data-testid="filter-task-linked-source"
            />
          </PopoverContent>
        </Popover>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1.5 text-muted-foreground"
            onClick={resetFilters}
            data-testid="btn-clear-task-filters"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      {hasActiveFilters && (
        <p className="text-xs text-muted-foreground" data-testid="engineering-filter-summary">
          Showing {filtered.length} of {basePool.length} tasks in scope.
        </p>
      )}

      {activeFilterChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="engineering-active-filter-chips">
          {activeFilterChips.map((chip) => (
            <Badge key={chip.key} variant="secondary" className="gap-1 pr-1 text-[10px] font-medium">
              <span>{chip.label}</span>
              <button
                type="button"
                aria-label={`Clear ${chip.label}`}
                className="rounded p-0.5 hover:bg-black/10"
                onClick={chip.onClear}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {microWalkthroughEnabled ? <MicroWalkthrough screenId="eng-tasks" steps={engWalkthroughSteps} /> : null}
      <ActionBar nextAction={engNextAction} blockers={engBlockers} />
      <EngineeringWorkloadStrip
        totalOpenWork={summaryMetrics.openTasks.length}
        unassignedCount={summaryMetrics.unassignedTasks.length}
        blockedCount={summaryMetrics.blockedTasks.length}
        reviewCount={summaryMetrics.reviewNeededTasks.length}
        approvalCount={summaryMetrics.approvalPendingTasks.length}
        deliverableCount={summaryMetrics.projectLinkedDeliverableTasks.length}
        microsoftActionCount={summaryMetrics.microsoftActionTasks.length}
        onReset={resetFilters}
        onSelectWorkloadState={focusWorkloadState}
      />

      <div className="flex flex-wrap gap-1.5">
        {SAVED_FILTERS.map(f => (
          <Button
            key={f.label}
            variant="outline"
            size="sm"
            className={`h-6 text-[10px] px-2 ${isPresetActive(f) ? "bg-primary text-primary-foreground" : ""}`}
            onClick={() => applyPreset(f)}
            data-testid={`preset-${f.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {f.label}
            {presetBadgeCount(f) > 0 && (
              <span className="ml-1 rounded-full bg-black/10 px-1 text-[9px] leading-4">
                {presetBadgeCount(f)}
              </span>
            )}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !error && tasks.length === 0 ? (
        <Card className="shadow-sm" data-testid="engineering-tasks-empty-state">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ListTodo className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <h3 className="text-lg font-medium text-muted-foreground">No engineering tasks yet</h3>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">Create your first task to get started, or generate tasks from an engineering stage checklist.</p>
          </CardContent>
        </Card>
      ) : viewMode === "board" ? (
        <>
        <div className="flex items-center gap-2 flex-wrap" data-testid="board-toolbar">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {summaryMetrics.overdueTasks.length > 0 && (
              <button onClick={() => applyPreset(SAVED_FILTERS[0])} className="flex items-center gap-1 text-red-600 hover:text-red-700 font-medium text-xs transition-colors" data-testid="summary-overdue">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{summaryMetrics.overdueTasks.length} overdue</span>
              </button>
            )}
            {summaryMetrics.blockedTasks.length > 0 && (
              <button onClick={() => focusWorkloadState("blocked")} className="flex items-center gap-1 text-amber-600 hover:text-amber-700 font-medium text-xs transition-colors" data-testid="summary-blocked">
                <PauseCircle className="h-3.5 w-3.5" />
                <span>{summaryMetrics.blockedTasks.length} blocked</span>
              </button>
            )}
            {summaryMetrics.reviewNeededTasks.length > 0 && (
              <button onClick={() => focusWorkloadState("review")} className="flex items-center gap-1 text-violet-600 hover:text-violet-700 font-medium text-xs transition-colors" data-testid="summary-review">
                <MessageSquare className="h-3.5 w-3.5" />
                <span>{summaryMetrics.reviewNeededTasks.length} review</span>
              </button>
            )}
            {summaryMetrics.approvalPendingTasks.length > 0 && (
              <button onClick={() => focusWorkloadState("approval")} className="flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium text-xs transition-colors" data-testid="summary-approval">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>{summaryMetrics.approvalPendingTasks.length} approval</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`h-7 text-[10px] px-2 gap-1 ${boardCompact ? "bg-primary text-primary-foreground" : ""}`}
                      onClick={() => setBoardCompact(!boardCompact)}
                      data-testid="btn-board-compact"
                    >
                      {boardCompact ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
                      {boardCompact ? "Expand" : "Compact"}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {boardCompact ? "Expand cards for full details" : "Compact cards to fit more work on screen"}
                </TooltipContent>
              </Tooltip>
              <SearchableSelect
                value={boardGroupBy}
                onValueChange={(v) => setBoardGroupBy(v as any)}
                placeholder="Group by..."
                triggerClassName="h-7 text-[10px] min-w-[90px]"
                options={[
                  { value: "status", label: "Status" },
                  { value: "priority", label: "Priority" },
                  { value: "assignee", label: "Assignee" },
                  { value: "project", label: "Project" },
                ]}
                data-testid="board-group-by"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] px-2 gap-1"
                      onClick={() => setCollapsedColumns(new Set())}
                      disabled={collapsedColumns.size === 0}
                      data-testid="btn-expand-all-cols"
                    >
                      <Eye className="h-3 w-3" />
                      Show all
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {collapsedColumns.size > 0 ? "Expand all collapsed status columns" : "All status columns are already visible"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <span className="text-[10px] text-muted-foreground">{filtered.length} tasks</span>
          </div>
        </div>

        {bulkMode && (
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg" data-testid="bulk-action-bar">
            <span className="text-xs font-semibold text-blue-800">{selectedTaskIds.size} selected</span>
            <div className="h-4 w-px bg-blue-200" />
            <SearchableSelect
              value=""
              onValueChange={(status) => setPendingBulk({ kind: "status", taskIds: Array.from(selectedTaskIds), value: status, label: getTaskStatusLabel(status) })}
              placeholder="Set status..."
              triggerClassName="h-7 text-[10px] min-w-[100px]"
              options={getVisibleStatusesForView("board").map(s => ({ value: s, label: getTaskStatusLabel(s) }))}
              data-testid="bulk-status-select"
            />
            <SearchableSelect
              value=""
              onValueChange={(p) => setPendingBulk({ kind: "priority", taskIds: Array.from(selectedTaskIds), value: p, label: taskPriorityLabel(p) })}
              placeholder="Set priority..."
              triggerClassName="h-7 text-[10px] min-w-[90px]"
              options={PRIORITIES.map(p => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))}
              data-testid="bulk-priority-select"
            />
            <Button variant="ghost" size="sm" className="h-7 text-[10px] text-muted-foreground" onClick={clearSelection}>
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          </div>
        )}

        <div className="h-2 bg-muted/40 rounded-full overflow-hidden flex" data-testid="status-distribution-bar" title="Status distribution">
          {boardStatuses.map(status => {
            const count = (tasksByStatus[status] || []).length;
            if (count === 0) return null;
            const pct = (count / (filtered.length || 1)) * 100;
            return (
              <div
                key={status}
                className={`h-full ${getTaskStatusBarClass(status)} transition-all duration-500 hover:brightness-110 cursor-pointer`}
                style={{ width: `${Math.max(pct, 0.5)}%` }}
                title={`${getTaskStatusLabel(status)}: ${count} (${Math.round(pct)}%)`}
                onClick={() => setStatusFilter(statusFilter === status ? "all" : status)}
                data-testid={`status-bar-${status.toLowerCase().replace(/\s+/g, "-")}`}
              />
            );
          })}
        </div>

        {isMobile && <p className="text-[10px] text-muted-foreground text-center py-1">Swipe to see more columns →</p>}
        <div className="flex gap-1.5 overflow-x-auto pb-4" style={{ minHeight: "400px" }}>
          {boardGroupKeys.map(group => (
            <KanbanColumn
              key={group}
              status={group}
              tasks={tasksByGroup[group] || []}
              onDrop={handleDrop}
              onCardClick={setSelectedTask}
              onStatusChange={handleStatusChange}
              onPriorityChange={handlePriorityChange}
              onDueDateChange={handleDueDateChange}
              compact={boardCompact}
              collapsed={collapsedColumns.has(group)}
              onToggleCollapse={() => toggleColumnCollapse(group)}
              totalTasks={filtered.length}
              selectedTaskIds={selectedTaskIds}
              onToggleSelect={toggleTaskSelection}
            />
          ))}
        </div>
        </>
      ) : viewMode === "mytasks" ? (
        <MyTasksView
          tasks={tasks}
          myName={myName}
          onCardClick={setSelectedTask}
          onStatusChange={handleStatusChange}
          onPriorityChange={handlePriorityChange}
          filterStatuses={filterStatuses}
        />
      ) : viewMode === "projects" ? (
        <ProjectKanbanView
          tasks={filtered}
          onCardClick={setSelectedTask}
          onDrop={handleDrop}
          onStatusChange={handleStatusChange}
          searchTerm={searchTerm}
        />
      ) : viewMode === "timeline" ? (
        <div className="overflow-x-auto">
          <TimelineView tasks={filtered} onCardClick={setSelectedTask} />
        </div>
      ) : (
        <InlineListView
          tasks={filtered}
          onCardClick={setSelectedTask}
          onStatusChange={handleStatusChange}
          onPriorityChange={handlePriorityChange}
          onBulkStatusChange={(ids, status) => setPendingBulk({ kind: "status", taskIds: ids, value: status, label: getTaskStatusLabel(status) })}
          onBulkPriorityChange={(ids, priority) => setPendingBulk({ kind: "priority", taskIds: ids, value: priority, label: taskPriorityLabel(priority) })}
        />
      )}

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={() => {
            invalidateAllTaskCaches(queryClient);
            const updatedTask = tasks.find(t => t.id === selectedTask.id);
            if (updatedTask) setSelectedTask(updatedTask);
          }}
        />
      )}

      <HoldReasonDialog
        open={!!holdDialog}
        onOpenChange={(open) => { if (!open) setHoldDialog(null); }}
        onConfirm={(reason, blockedType) => {
          if (holdDialog) {
            updateStatusMutation.mutate({ taskId: holdDialog.taskId, status: "hold", holdReason: reason, blockedType });
            setHoldDialog(null);
          }
        }}
        testIdPrefix="hold"
      />

      <AlertDialog open={!!completionGuard} onOpenChange={(open) => { if (!open) setCompletionGuard(null); }}>
        <AlertDialogContent data-testid="completion-guard-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Complete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              This task is flagged with <strong>{completionGuard?.reason}</strong>. Marking it complete will bypass the usual review path — please confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="completion-guard-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="completion-guard-confirm"
              onClick={() => {
                if (completionGuard) {
                  const id = completionGuard.taskId;
                  setCompletionGuard(null);
                  requestStatusChange(id, "complete");
                }
              }}
            >
              Mark complete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* X6: bulk status / priority change confirmation with impact preview. */}
      <ConfirmDialog
        open={!!pendingBulk}
        onOpenChange={(open) => { if (!open) setPendingBulk(null); }}
        title={pendingBulk?.kind === "priority" ? "Change priority on multiple tasks?" : "Change status on multiple tasks?"}
        description="This applies the same change to every selected task."
        confirmLabel={pendingBulk ? `Apply to ${pendingBulk.taskIds.length} task${pendingBulk.taskIds.length === 1 ? "" : "s"}` : "Apply"}
        impact={
          pendingBulk ? (
            <p data-testid="bulk-confirm-impact">
              <strong>{pendingBulk.taskIds.length}</strong> task{pendingBulk.taskIds.length === 1 ? "" : "s"} will be set to{" "}
              {pendingBulk.kind === "priority" ? "priority" : "status"} <strong>{pendingBulk.label}</strong>.
            </p>
          ) : undefined
        }
        onConfirm={executePendingBulk}
      />

      {showShortcuts && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setShowShortcuts(false)}>
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm">Keyboard Shortcuts</h3>
              <button onClick={() => setShowShortcuts(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2 text-xs">
              {[
                ["N", "New task"],
                ["G → 1", "Board view"],
                ["G → 2", "My Tasks view"],
                ["G → 3", "Projects view"],
                ["G → 4", "List view"],
                ["G → 5", "Timeline view"],
                ["Esc", "Close drawer / dialog"],
                ["?", "Toggle this help"],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{desc}</span>
                  <kbd className="px-2 py-0.5 bg-muted rounded border text-[10px] font-mono font-bold">{key}</kbd>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground">Press <kbd className="px-1 py-0.5 bg-muted rounded border text-[10px] font-mono">G</kbd> then a number within 1.5s to switch views.</p>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
