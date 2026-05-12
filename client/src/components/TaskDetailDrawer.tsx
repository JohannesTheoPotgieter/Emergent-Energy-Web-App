import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, invalidateProjectQueries } from "@/lib/queryClient";
import { invalidateAllTaskCaches } from "@/lib/task-cache";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useUserNames } from "@/hooks/use-user-names";
import { getTaskWorkflowBlockReason } from "@/lib/task-workflow-guard";
import {
  WORKSTREAM_OPTIONS,
  resolveWorkstream,
} from "@/lib/workstream-options";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import {
  hasDeliverableRequirementFlag,
  hasDeliverableRequirementTag,
  withDeliverableRequirementTag,
} from "@shared/task-deliverable-requirement";
import type {
  TaskComment,
  TaskChecklist,
  TaskChecklistItem,
  TaskAttachment,
  TaskActivityLog,
} from "@shared/schema";
import type { UnifiedTask } from "@shared/types/unified-task";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import {
  X,
  Calendar,
  User,
  CheckCircle,
  MessageSquare,
  Paperclip,
  Activity,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Clock,
  Flag,
  AlertCircle,
  Hash,
  Diamond,
  ArrowRight,
  Link2,
  Target,
  Eye,
  Layers,
  CornerDownRight,
} from "lucide-react";
import UserAssignmentPicker from "@/components/UserAssignmentPicker";
import DependencyManager from "@/components/DependencyManager";

interface TaskDetailDrawerProps {
  taskId: number | null;
  open: boolean;
  onClose: () => void;
  projectName: string;
  trackingRole?: "assignee" | "creator" | "both" | "viewer" | null;
}

interface TaskDetailResponse {
  task: UnifiedTask & Record<string, any>;
  comments: TaskComment[];
  checklists: Array<TaskChecklist & { items: TaskChecklistItem[] }>;
  attachments: TaskAttachment[];
  activity: TaskActivityLog[];
}

const STATUS_OPTIONS = ["Not Started", "In Progress", "Blocked", "Done"];
const PRIORITY_OPTIONS = ["Urgent", "High", "Normal", "Low"];

const statusColor: Record<string, string> = {
  "Not Started": "bg-muted text-foreground",
  "In Progress": "bg-blue-100 text-blue-800",
  Blocked: "bg-red-100 text-red-800",
  Done: "bg-green-100 text-green-800",
};

const priorityColor: Record<string, string> = {
  Urgent: "bg-red-100 text-red-800",
  High: "bg-orange-100 text-orange-800",
  Normal: "bg-muted text-foreground",
  Low: "bg-blue-100 text-blue-800",
};

export default function TaskDetailDrawer({
  taskId,
  open,
  onClose,
  projectName,
  trackingRole,
}: TaskDetailDrawerProps) {
  const queryClient = useQueryClient();

  const isBaselineTask = taskId !== null && taskId < 0;

  const detailQueryKey = isBaselineTask
    ? ["baseline-task-detail", taskId, projectName]
    : ["operational-task-detail", taskId];

  const { data, isLoading, isError, error } = useQuery<TaskDetailResponse | null>({
    queryKey: detailQueryKey,
    queryFn: async () => {
      if (isBaselineTask) {
        const res = await apiRequest("GET", `/api/planning-tasks/${encodeURIComponent(projectName)}`);
        const raw = await res.json();
        const allTasks: any[] = Array.isArray(raw) ? raw : (raw.tasks || []);
        const match = allTasks.find((t: any) => t.id === taskId);
        if (!match) return null;
        // § 3.7 HARD: actuals are the truth when known. Display falls back to
        // planned only when no actual exists; previous order showed planned
        // even when an actual was recorded.
        const startD = match.actualStart ?? match.actualStartDate ?? match.startDate ?? null;
        const endD = match.actualEnd ?? match.actualEndDate ?? match.dueDate ?? null;
        let computedDuration = match.plannedDurationDays || match.durationDays || 0;
        if (!computedDuration && startD && endD) {
          const sd = new Date(startD);
          const ed = new Date(endD);
          if (!isNaN(sd.getTime()) && !isNaN(ed.getTime())) {
            computedDuration = Math.max(1, differenceInDays(ed, sd));
          }
        }
        const expPct = match.computedExpectedPct ?? match.expectedPercentComplete ?? null;
        const pct = match.percentComplete || 0;
        let ragStatus: string = "neutral";
        if (match.status === "Done" || pct >= 100) ragStatus = "green";
        else if (expPct === null) ragStatus = pct > 0 ? "green" : "neutral";
        else {
          const delta = expPct - pct;
          if (delta <= 5) ragStatus = "green";
          else if (delta <= 20) ragStatus = "amber";
          else ragStatus = "red";
        }
        const predecessorTasks = match.predecessorTaskId
          ? allTasks.filter((t: any) => t.id === match.predecessorTaskId).map((t: any) => ({ id: t.id, title: t.title || t.name || "", taskNumber: t.taskNumber || "" }))
          : [];
        const successorTasks = allTasks
          .filter((t: any) => t.predecessorTaskId === match.id)
          .map((t: any) => ({ id: t.id, title: t.title || t.name || "", taskNumber: t.taskNumber || "" }));
        const task: any = {
          id: match.id,
          workItemId: match.workItemId || Math.abs(match.id),
          title: match.title || match.name || "",
          status: match.status || "Not Started",
          priority: match.priority || "Normal",
          startDate: startD,
          dueDate: endD,
          percentComplete: pct,
          description: match.comment || match.description || null,
          isBaseline: true,
          importedTaskId: match.importedTaskId || Math.abs(taskId!),
          projectName,
          projectId: match.projectId || null,
          assignees: match.assignees || (match.owner ? [match.owner] : []),
          taskNumber: match.taskNumber || null,
          rowNumber: match.rowNumber ?? null,
          durationDays: computedDuration,
          expectedPercentComplete: expPct,
          ragStatus,
          predecessors: match.dependencies || (match.predecessorTaskId ? `${match.predecessorTaskId} FS` : null),
          predecessorTasks,
          successorTasks,
          isMilestone: match.isMilestone || match.isVirtualMilestone || false,
          parentTaskId: match.parentTaskId || null,
          baselineStartDate: match.baselineStart || match.startDate || null,
          baselineEndDate: match.baselineEnd || match.dueDate || null,
          workstream: match.workstream || "PM",
        };
        return { task, comments: [], checklists: [], attachments: [], activity: [] } as TaskDetailResponse;
      }
      const res = await apiRequest("GET", `/api/operational-tasks/task/${taskId}`);
      return res.json();
    },
    enabled: open && taskId !== null,
  });

  const { toast } = useToast();

  const invalidateAll = () => {
    invalidateAllTaskCaches(queryClient);
    queryClient.invalidateQueries({ queryKey: detailQueryKey });
    queryClient.invalidateQueries({ queryKey: ["operational-task-detail"] });
    queryClient.invalidateQueries({ queryKey: ["baseline-task-detail"] });
    queryClient.invalidateQueries({ queryKey: ["planning-tasks", projectName] });
    queryClient.invalidateQueries({ queryKey: ["working-plan", projectName] });
  };

  const toastMutationError = (action: string) => (err: any) => {
    toast({
      title: `${action} failed`,
      description: err?.message || `Could not ${action.toLowerCase()}`,
      variant: "destructive",
    });
  };

  const updateTaskMutation = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      if (isBaselineTask) {
        await apiRequest("PATCH", `/api/planning-tasks/${taskId}`, { projectName, ...updates });
      } else {
        await apiRequest("PATCH", `/api/operational-tasks/${taskId}`, updates);
      }
    },
    onSuccess: invalidateAll,
    onError: toastMutationError("Save"),
  });

  const addCommentMutation = useMutation({
    mutationFn: async (body: string) => {
      await apiRequest("POST", "/api/task-comments", { taskId, body });
    },
    onSuccess: invalidateAll,
    onError: toastMutationError("Add comment"),
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: number) => {
      await apiRequest("DELETE", `/api/task-comments/${commentId}`);
    },
    onSuccess: invalidateAll,
    onError: toastMutationError("Delete comment"),
  });

  const addChecklistMutation = useMutation({
    mutationFn: async (title: string) => {
      await apiRequest("POST", "/api/task-checklists", { taskId, title });
    },
    onSuccess: invalidateAll,
    onError: toastMutationError("Add checklist"),
  });

  const deleteChecklistMutation = useMutation({
    mutationFn: async (checklistId: number) => {
      await apiRequest("DELETE", `/api/task-checklists/${checklistId}`);
    },
    onSuccess: invalidateAll,
    onError: toastMutationError("Delete checklist"),
  });

  const addChecklistItemMutation = useMutation({
    mutationFn: async ({
      checklistId,
      content,
    }: {
      checklistId: number;
      content: string;
    }) => {
      await apiRequest("POST", "/api/task-checklist-items", {
        checklistId,
        content,
      });
    },
    onSuccess: invalidateAll,
    onError: toastMutationError("Add item"),
  });

  const toggleChecklistItemMutation = useMutation({
    mutationFn: async ({
      itemId,
      isDone,
    }: {
      itemId: number;
      isDone: boolean;
    }) => {
      await apiRequest("PATCH", `/api/task-checklist-items/${itemId}`, {
        isDone,
      });
    },
    onSuccess: invalidateAll,
    onError: toastMutationError("Update item"),
  });

  const deleteChecklistItemMutation = useMutation({
    mutationFn: async (itemId: number) => {
      await apiRequest("DELETE", `/api/task-checklist-items/${itemId}`);
    },
    onSuccess: invalidateAll,
    onError: toastMutationError("Delete item"),
  });

  const addAttachmentMutation = useMutation({
    mutationFn: async ({
      filename,
      url,
    }: {
      filename: string;
      url: string;
    }) => {
      await apiRequest("POST", "/api/task-attachments", {
        taskId,
        filename,
        url,
      });
    },
    onSuccess: invalidateAll,
    onError: toastMutationError("Add attachment"),
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: async (attachmentId: number) => {
      await apiRequest("DELETE", `/api/task-attachments/${attachmentId}`);
    },
    onSuccess: invalidateAll,
    onError: toastMutationError("Delete attachment"),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async () => {
      if (!taskId) return;
      if (isBaselineTask) {
        const taskData = data?.task as any;
        const wiId = taskData?.workItemId || Math.abs(taskId);
        await apiRequest("POST", "/api/project-plan/structure", {
          operation: "deleteMilestoneWI",
          projectName,
          data: { workItemId: wiId },
        });
      } else {
        await apiRequest("DELETE", `/api/operational-tasks/${taskId}`);
      }
    },
    onSuccess: () => {
      invalidateAll();
      invalidateProjectQueries(queryClient, projectName);
      toast({ title: "Task deleted" });
      onClose();
    },
    onError: () => {
      toast({ title: "Delete failed", description: "Could not delete the task", variant: "destructive" });
    },
  });

  const convertToMilestoneMutation = useMutation({
    mutationFn: async () => {
      const taskData = data?.task as any;
      const wiId = taskData?.workItemId || Math.abs(taskId!);
      if (!wiId) throw new Error("Task has no work item ID");
      await apiRequest("POST", "/api/project-plan/structure", {
        operation: "convertToMilestoneWI",
        projectName,
        data: { workItemId: wiId, subtaskWorkItemIds: [] },
      });
    },
    onSuccess: () => {
      invalidateAll();
      invalidateProjectQueries(queryClient, projectName);
      toast({ title: "Converted to milestone" });
    },
    onError: (err: any) => {
      toast({ title: "Convert failed", description: err?.message || "Could not convert to milestone", variant: "destructive" });
    },
  });

  const updateDurationMutation = useMutation({
    mutationFn: async (duration: number) => {
      if (isBaselineTask) {
        await apiRequest("PATCH", `/api/planning-tasks/${taskId}`, { projectName, duration });
      } else {
        await apiRequest("PATCH", `/api/operational-tasks/${taskId}`, { duration });
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Duration updated" });
    },
    onError: (err: any) => {
      if (!err?.message?.includes("read-only")) {
        toast({ title: "Update failed", description: err?.message || "Could not update duration", variant: "destructive" });
      }
    },
  });


  const guardedUpdateTask = (
    updates: Record<string, unknown>,
    options?: { onSuccess?: () => void; onError?: (err: any) => void },
  ) => {
    if (typeof updates.status === "string" && data?.task) {
      const blockedReason = getTaskWorkflowBlockReason(data.task as any, updates.status);
      if (blockedReason) {
        toast({ title: "Status change blocked", description: blockedReason, variant: "destructive" });
        return;
      }
    }
    updateTaskMutation.mutate(updates, options);
  };

  // Direct flush helper that targets a specific task id (used to flush dirty edits
  // for the OUTGOING task when the drawer switches to a different task).
  const flushTaskUpdate = useCallback(
    (id: number, updates: Record<string, unknown>) => {
      if (!id || Object.keys(updates).length === 0) return;
      const isBaseline = id < 0;
      const promise = isBaseline
        ? apiRequest("PATCH", `/api/planning-tasks/${id}`, { projectName, ...updates })
        : apiRequest("PATCH", `/api/operational-tasks/${id}`, updates);
      promise
        .then(() => invalidateAll())
        .catch((err: any) => {
          toast({
            title: "Save failed",
            description: err?.message || "Could not save edits",
            variant: "destructive",
          });
        });
    },
    [projectName],
  );

  if (!open || taskId === null) return null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:w-[500px] max-w-full p-0"
        data-testid="task-detail-drawer"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Task Detail</SheetTitle>
          <SheetDescription>View and edit task details</SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-full">
          <div className="p-6 space-y-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12" data-testid="task-detail-loading">
                <span className="text-muted-foreground">Loading…</span>
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2" data-testid="task-detail-error">
                <span className="text-destructive font-medium">Failed to load task</span>
                <span className="text-xs text-muted-foreground max-w-[300px] text-center">
                  {error instanceof Error ? error.message : "A database or network error occurred. Please try again."}
                </span>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => queryClient.invalidateQueries({ queryKey: detailQueryKey })}>
                  Retry
                </Button>
              </div>
            ) : !data ? (
              <div className="flex items-center justify-center py-12" data-testid="task-detail-empty">
                <span className="text-muted-foreground">Task not found</span>
              </div>
            ) : (
              <TaskDetailContent
                data={data}
                updateTask={guardedUpdateTask}
                flushTaskUpdate={flushTaskUpdate}
                addComment={addCommentMutation.mutate}
                deleteComment={deleteCommentMutation.mutate}
                addChecklist={addChecklistMutation.mutate}
                deleteChecklist={deleteChecklistMutation.mutate}
                addChecklistItem={addChecklistItemMutation.mutate}
                toggleChecklistItem={toggleChecklistItemMutation.mutate}
                deleteChecklistItem={deleteChecklistItemMutation.mutate}
                addAttachment={addAttachmentMutation.mutate}
                deleteAttachment={deleteAttachmentMutation.mutate}
                onClose={onClose}
                onDeleteTask={() => deleteTaskMutation.mutate()}
                onConvertToMilestone={() =>
                  convertToMilestoneMutation.mutate(undefined, {
                    onSuccess: () => onClose(),
                  })
                }
                onUpdateDuration={(d) => updateDurationMutation.mutate(d)}
                isDeleting={deleteTaskMutation.isPending}
                isConverting={convertToMilestoneMutation.isPending}
                isBaselineTask={isBaselineTask}
                trackingRole={trackingRole}
              />
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function TaskDetailContent({
  data,
  updateTask,
  flushTaskUpdate,
  addComment,
  deleteComment,
  addChecklist,
  deleteChecklist,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
  addAttachment,
  deleteAttachment,
  onClose,
  onDeleteTask,
  onConvertToMilestone,
  onUpdateDuration,
  isDeleting,
  isConverting,
  isBaselineTask,
  trackingRole,
}: {
  data: TaskDetailResponse;
  updateTask: (
    updates: Record<string, unknown>,
    options?: { onSuccess?: () => void; onError?: (err: any) => void },
  ) => void;
  flushTaskUpdate: (id: number, updates: Record<string, unknown>) => void;
  addComment: (body: string) => void;
  deleteComment: (commentId: number) => void;
  addChecklist: (title: string) => void;
  deleteChecklist: (checklistId: number) => void;
  addChecklistItem: (p: { checklistId: number; content: string }) => void;
  toggleChecklistItem: (p: { itemId: number; isDone: boolean }) => void;
  deleteChecklistItem: (itemId: number) => void;
  addAttachment: (p: { filename: string; url: string }) => void;
  deleteAttachment: (attachmentId: number) => void;
  onClose: () => void;
  onDeleteTask: () => void;
  onConvertToMilestone: () => void;
  onUpdateDuration: (d: number) => void;
  isDeleting: boolean;
  isConverting: boolean;
  trackingRole?: "assignee" | "creator" | "both" | "viewer" | null;
  isBaselineTask: boolean;
}) {
  const { task, comments, checklists, attachments, activity } = data;

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleVal, setTitleVal] = useState(task.title);
  const [descVal, setDescVal] = useState(task.description ?? "");
  const [commentText, setCommentText] = useState("");
  const [newChecklistTitle, setNewChecklistTitle] = useState("");
  const [showNewChecklist, setShowNewChecklist] = useState(false);
  const [newItemInputs, setNewItemInputs] = useState<Record<number, string>>(
    {}
  );
  const [checklistsOpen, setChecklistsOpen] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [attachOpen, setAttachOpen] = useState(true);
  const [activityOpen, setActivityOpen] = useState(false);
  const [showAddLink, setShowAddLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkName, setLinkName] = useState("");

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [editingDuration, setEditingDuration] = useState(false);
  const [durationVal, setDurationVal] = useState(String((task as any).durationDays || 0));
  const [confirmDeleteChecklist, setConfirmDeleteChecklist] = useState<number | null>(null);
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<number | null>(null);
  const [confirmDeleteComment, setConfirmDeleteComment] = useState<number | null>(null);
  const [confirmDeleteAttachment, setConfirmDeleteAttachment] = useState<number | null>(null);

  const { isAdmin } = useAuth();
  const { resolveName } = useUserNames();

  // Refs to support flushing pending edits when the drawer switches tasks or
  // unmounts. We track current dirty values, the last server-known values,
  // and the task id those values belong to.
  const titleRef = useRef(titleVal);
  const descRef = useRef(descVal);
  const taskIdRef = useRef<number>(task.id);
  const baselineTitleRef = useRef<string>(task.title);
  const baselineDescRef = useRef<string>(task.description ?? "");
  const flushRef = useRef(flushTaskUpdate);
  useEffect(() => {
    titleRef.current = titleVal;
  }, [titleVal]);
  useEffect(() => {
    descRef.current = descVal;
  }, [descVal]);
  useEffect(() => {
    flushRef.current = flushTaskUpdate;
  }, [flushTaskUpdate]);

  const computePendingUpdates = (): Record<string, unknown> => {
    const updates: Record<string, unknown> = {};
    const t = (titleRef.current || "").trim();
    if (t && t !== baselineTitleRef.current) updates.title = t;
    if (descRef.current !== baselineDescRef.current) updates.description = descRef.current;
    return updates;
  };

  // Re-sync local edit state when the drawer switches to a different task.
  // Flush pending edits to the OUTGOING task before resetting.
  useEffect(() => {
    if (taskIdRef.current !== task.id) {
      const pending = computePendingUpdates();
      if (Object.keys(pending).length > 0) {
        flushRef.current(taskIdRef.current, pending);
      }
      taskIdRef.current = task.id;
      baselineTitleRef.current = task.title;
      baselineDescRef.current = task.description ?? "";
      setTitleVal(task.title);
      setDescVal(task.description ?? "");
      setEditingTitle(false);
      setEditingDuration(false);
      setDurationVal(String((task as any).durationDays || 0));
      setCommentText("");
      setShowNewChecklist(false);
      setNewChecklistTitle("");
      setNewItemInputs({});
      setShowAddLink(false);
      setLinkUrl("");
      setLinkName("");
      setConfirmDelete(false);
      setConfirmConvert(false);
      setConfirmDeleteChecklist(null);
      setConfirmDeleteItem(null);
      setConfirmDeleteComment(null);
      setConfirmDeleteAttachment(null);
    } else {
      // Same task — pick up upstream changes if user hasn't dirtied locally.
      if (task.title !== baselineTitleRef.current) {
        if (titleRef.current === baselineTitleRef.current) {
          setTitleVal(task.title);
        }
        baselineTitleRef.current = task.title;
      }
      const newDesc = task.description ?? "";
      if (newDesc !== baselineDescRef.current) {
        if (descRef.current === baselineDescRef.current) {
          setDescVal(newDesc);
        }
        baselineDescRef.current = newDesc;
      }
    }
  }, [task.id, task.title, task.description]);

  // Flush dirty edits when the drawer unmounts (close).
  useEffect(() => {
    return () => {
      const pending = computePendingUpdates();
      if (Object.keys(pending).length > 0) {
        flushRef.current(taskIdRef.current, pending);
      }
    };
  }, []);

  const isBaseline = task.isBaseline || task.importedTaskId !== null;
  const isPlanTask = isBaselineTask || isBaseline;
  const taskAny = task as any;
  const wbsNumber = taskAny.taskNumber || null;
  const durationDays = taskAny.durationDays || 0;
  const expectedPct = taskAny.expectedPercentComplete ?? null;
  const ragStatus: string = taskAny.ragStatus || "neutral";
  const predecessors = taskAny.predecessors || null;
  const predecessorTasks: Array<{ id: number; title: string; taskNumber: string }> = taskAny.predecessorTasks || [];
  const successorTasks: Array<{ id: number; title: string; taskNumber: string }> = taskAny.successorTasks || [];
  const isMilestone = taskAny.isMilestone || false;
  const baselineStartDate = taskAny.baselineStartDate || null;
  const baselineEndDate = taskAny.baselineEndDate || null;
  const rowNumber = taskAny.rowNumber ?? null;
  const deliverableRequired = hasDeliverableRequirementFlag(taskAny);
  const explicitDeliverableRequirement = hasDeliverableRequirementTag(taskAny.tags);
  const deliverableRequirementLocked = !!task.linkedDeliverableId;

  const ragDotColor = ragStatus === "green"
    ? "bg-emerald-500"
    : ragStatus === "amber"
      ? "bg-amber-500"
      : ragStatus === "red"
        ? "bg-red-500"
        : "bg-slate-300";

  const ragLabel = ragStatus === "green"
    ? "On Track"
    : ragStatus === "amber"
      ? "At Risk"
      : ragStatus === "red"
        ? "Critical"
        : "Not Started";

  const saveTitle = () => {
    const t = titleVal.trim();
    if (t && t !== baselineTitleRef.current) {
      updateTask(
        { title: t },
        {
          onSuccess: () => {
            // Only advance the baseline once the server has accepted the value;
            // failed saves stay dirty so they can be retried on close/switch/unmount.
            baselineTitleRef.current = t;
          },
        },
      );
    }
    setEditingTitle(false);
  };

  const saveDescription = () => {
    if (descVal !== baselineDescRef.current) {
      const snapshot = descVal;
      updateTask(
        { description: snapshot },
        {
          onSuccess: () => {
            baselineDescRef.current = snapshot;
          },
        },
      );
    }
  };

  const formatDate = (d: string | Date | null) => {
    if (!d) return "";
    try {
      return format(new Date(d), "MMM d, yyyy");
    } catch {
      return String(d);
    }
  };

  const timeAgo = (d: string | Date | null) => {
    if (!d) return "";
    try {
      return formatDistanceToNow(new Date(d), { addSuffix: true });
    } catch {
      return String(d);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {editingTitle && isAdmin ? (
            <Input
              data-testid="input-task-title"
              value={titleVal}
              onChange={(e) => setTitleVal(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => e.key === "Enter" && saveTitle()}
              autoFocus
              className="text-lg font-semibold"
            />
          ) : (
            <h2
              data-testid="text-task-title"
              className={`text-lg font-semibold rounded px-1 -mx-1 ${isAdmin ? "cursor-pointer hover:bg-muted/50" : ""}`}
              onClick={() => { if (isAdmin) setEditingTitle(true); }}
              title={!isAdmin ? "Admins only" : undefined}
            >
              {task.title}
            </h2>
          )}
          {task.parentTaskTitle && (
            <div className="flex items-center gap-1 mt-0.5">
              <CornerDownRight className="h-3 w-3 text-violet-400 shrink-0" />
              <span className="text-xs text-violet-600/80">Sub-task of <span className="font-medium">{task.parentTaskTitle}</span></span>
            </div>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge
              data-testid="badge-status"
              className={statusColor[task.status] ?? ""}
              variant="secondary"
            >
              {task.status}
            </Badge>
            <Badge
              data-testid="badge-priority"
              className={(task.priority && priorityColor[task.priority]) ?? ""}
              variant="secondary"
            >
              <Flag className="h-3 w-3 mr-1" />
              {task.priority}
            </Badge>
            {(trackingRole === "creator" || trackingRole === "both") && (
              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-medium border bg-teal-50 border-teal-200 text-teal-700" data-testid="badge-tracking">
                <Eye className="h-3 w-3" />Tracking
              </span>
            )}
            {trackingRole === "viewer" && (
              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-medium border bg-sky-50 border-sky-200 text-sky-700" data-testid="badge-viewing">
                <Eye className="h-3 w-3" />Viewing
              </span>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          data-testid="button-close-drawer"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {isPlanTask && (
        <>
          <div className="flex items-center gap-2 flex-wrap" data-testid="plan-info-strip">
            {wbsNumber && (
              <Badge variant="outline" className="text-xs font-mono gap-1" data-testid="badge-wbs">
                <Hash className="h-3 w-3" />
                {wbsNumber}
              </Badge>
            )}
            {isMilestone && (
              <Badge className="bg-violet-100 text-violet-800 text-xs gap-1" variant="secondary" data-testid="badge-milestone">
                <Diamond className="h-3 w-3" />
                Milestone
              </Badge>
            )}
            {(() => {
              const wsOpt = resolveWorkstream(taskAny.workstream);
              return (
                <Badge className={`text-xs gap-1 ${wsOpt.badgeClass}`} variant="secondary" data-testid="badge-workstream">
                  <Layers className="h-3 w-3" />
                  {wsOpt.label}
                </Badge>
              );
            })()}
            <Badge
              className={`text-xs gap-1 ${
                ragStatus === "green" ? "bg-emerald-100 text-emerald-800" :
                ragStatus === "amber" ? "bg-amber-100 text-amber-800" :
                ragStatus === "red" ? "bg-red-100 text-red-800" :
                "bg-slate-100 text-slate-600"
              }`}
              variant="secondary"
              data-testid="badge-rag"
            >
              <span className={`inline-block h-2 w-2 rounded-full ${ragDotColor}`} />
              {ragLabel}
            </Badge>
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 space-y-3" data-testid="plan-details-section">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                  <Clock className="h-3 w-3" /> Duration
                </label>
                {editingDuration ? (
                  <div className="flex items-center gap-1">
                    <Input
                      data-testid="input-duration"
                      className="h-7 w-20 text-xs"
                      type="number"
                      min={0}
                      value={durationVal}
                      onChange={(e) => setDurationVal(e.target.value)}
                      onBlur={() => {
                        const v = Math.max(0, parseInt(durationVal) || 0);
                        onUpdateDuration(v);
                        setEditingDuration(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const v = Math.max(0, parseInt(durationVal) || 0);
                          onUpdateDuration(v);
                          setEditingDuration(false);
                        }
                        if (e.key === "Escape") setEditingDuration(false);
                      }}
                      autoFocus
                    />
                    <span className="text-xs text-muted-foreground">days</span>
                  </div>
                ) : (
                  <span
                    className={`text-sm font-medium ${isAdmin ? "cursor-pointer hover:text-primary" : ""}`}
                    onClick={() => { if (isAdmin) { setDurationVal(String(durationDays)); setEditingDuration(true); } }}
                    data-testid="text-duration"
                    title={!isAdmin ? "Admins only" : undefined}
                  >
                    {durationDays > 0 ? `${durationDays} working days` : "—"}
                  </span>
                )}
              </div>
              {expectedPct !== null && (
                <div>
                  <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                    <Target className="h-3 w-3" /> Expected %
                  </label>
                  <span className="text-sm font-medium tabular-nums" data-testid="text-expected-pct">
                    {expectedPct}%
                  </span>
                </div>
              )}
            </div>

            {expectedPct !== null && (
              <div data-testid="progress-comparison">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Progress: Actual vs Expected</span>
                  <span className="tabular-nums">{task.percentComplete ?? 0}% / {expectedPct}%</span>
                </div>
                <div className="relative h-3 rounded-full bg-muted overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-slate-300/60 rounded-full"
                    style={{ width: `${Math.min(expectedPct, 100)}%` }}
                    data-testid="bar-expected"
                  />
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full ${
                      (task.percentComplete ?? 0) >= expectedPct ? "bg-emerald-500" :
                      (task.percentComplete ?? 0) >= expectedPct - 10 ? "bg-amber-500" :
                      "bg-red-500"
                    }`}
                    style={{ width: `${Math.min(task.percentComplete ?? 0, 100)}%` }}
                    data-testid="bar-actual"
                  />
                </div>
              </div>
            )}

            {(predecessorTasks.length > 0 || successorTasks.length > 0 || predecessors) && (
              <div className="space-y-2">
                {(predecessorTasks.length > 0 || predecessors) && (
                  <div>
                    <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                      <Link2 className="h-3 w-3" /> Predecessors
                    </label>
                    <div className="flex flex-wrap gap-1" data-testid="predecessors-list">
                      {predecessorTasks.length > 0 ? predecessorTasks.map((p) => (
                        <Badge key={p.id} variant="outline" className="text-xs gap-1">
                          {p.taskNumber || `#${Math.abs(p.id)}`}
                          <span className="text-muted-foreground truncate max-w-[120px]">{p.title}</span>
                        </Badge>
                      )) : predecessors ? (
                        <Badge variant="outline" className="text-xs">{predecessors}</Badge>
                      ) : null}
                    </div>
                  </div>
                )}
                {successorTasks.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                      <ArrowRight className="h-3 w-3" /> Successors
                    </label>
                    <div className="flex flex-wrap gap-1" data-testid="successors-list">
                      {successorTasks.map((s) => (
                        <Badge key={s.id} variant="outline" className="text-xs gap-1">
                          {s.taskNumber || `#${Math.abs(s.id)}`}
                          <span className="text-muted-foreground truncate max-w-[120px]">{s.title}</span>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {(baselineStartDate || baselineEndDate) && (
              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                  <Calendar className="h-3 w-3" /> Baseline Dates
                </label>
                <div className="flex items-center gap-2 text-xs" data-testid="baseline-dates">
                  <Badge variant="outline" className="text-xs font-mono">
                    {formatDate(baselineStartDate) || "—"}
                  </Badge>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <Badge variant="outline" className="text-xs font-mono">
                    {formatDate(baselineEndDate) || "—"}
                  </Badge>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <Separator />

      {/* Quick Fields */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            <AlertCircle className="h-3 w-3" /> Status
          </label>
          <SearchableSelect
            value={task.status}
            onValueChange={(v) => updateTask({ status: v })}
            data-testid="select-status"
            triggerClassName="h-8 text-xs"
            options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
            disabled={!isAdmin}
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            <Flag className="h-3 w-3" /> Priority
          </label>
          <SearchableSelect
            value={task.priority ?? undefined}
            onValueChange={(v) => updateTask({ priority: v })}
            data-testid="select-priority"
            triggerClassName="h-8 text-xs"
            options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }))}
            disabled={!isAdmin}
          />
        </div>

        {isPlanTask && (
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
              <Layers className="h-3 w-3" /> Workstream
            </label>
            <SearchableSelect
              value={taskAny.workstream || "PM"}
              onValueChange={(v) => updateTask({ workstream: v })}
              data-testid="select-workstream"
              triggerClassName="h-8 text-xs"
              options={WORKSTREAM_OPTIONS.map((w) => ({ value: w.value, label: w.label }))}
              disabled={!isAdmin}
            />
          </div>
        )}

        <div className="col-span-2">
          <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            <User className="h-3 w-3" /> Assignees
          </label>
          {isBaselineTask ? (
            <UserAssignmentPicker
              taskId={(task as any).workItemId || (Number.isFinite(task.id) ? Math.abs(task.id) : 0)}
              taskSource="plan"
              resolvedUsers={task.resolvedAssignees || null}
              textNames={task.assignees || null}
              mode="multi"
              size="sm"
              invalidateKeys={[`baseline-task-detail`, `planning-tasks`]}
              disabled={!isAdmin}
              disabledReason="Admins only"
            />
          ) : (
            <UserAssignmentPicker
              taskId={Number.isFinite(task.id) ? task.id : 0}
              taskSource="operational"
              resolvedUsers={task.resolvedAssignees || null}
              textNames={task.assignees || null}
              mode="multi"
              size="sm"
              invalidateKeys={[`/api/operational-tasks/task/${task.id}`, "/api/my-work/all-tasks"]}
              disabled={!isAdmin}
              disabledReason="Admins only"
            />
          )}
        </div>

        {!isPlanTask && (
          <div className="col-span-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-foreground">Workflow Rules</p>
                <p className="text-[11px] text-muted-foreground">
                  Approval-required work must use Send for Approval. Deliverable-required work must use Send Deliverable.
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={!!task.approvalRequired}
                  onCheckedChange={(checked) => updateTask({ approvalRequired: checked === true })}
                  data-testid="checkbox-approval-required"
                  disabled={!isAdmin}
                />
                Approval required
              </label>
              <label className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={deliverableRequired}
                  disabled={deliverableRequirementLocked || !isAdmin}
                  onCheckedChange={(checked) =>
                    updateTask({
                      tags: withDeliverableRequirementTag(taskAny.tags, checked === true),
                    })
                  }
                  data-testid="checkbox-deliverable-required"
                />
                Deliverable required
              </label>
            </div>
            {deliverableRequirementLocked ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                A linked deliverable already makes this task deliverable-required.
              </p>
            ) : explicitDeliverableRequirement ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                This task is explicitly marked as deliverable-required.
              </p>
            ) : null}
          </div>
        )}

        <div>
          <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            <Calendar className="h-3 w-3" /> Start Date
          </label>
          <Input
            data-testid="input-start-date"
            className="h-8 text-xs"
            type="date"
            key={`start-${task.id}-${task.startDate}`}
            defaultValue={task.startDate ? String(task.startDate).substring(0, 10) : ""}
            onBlur={(e) => updateTask({ startDate: e.target.value || null })}
            disabled={!isAdmin}
            title={!isAdmin ? "Admins only" : undefined}
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            <Calendar className="h-3 w-3" /> Due Date
          </label>
          <Input
            data-testid="input-due-date"
            className="h-8 text-xs"
            type="date"
            key={`due-${task.id}-${task.dueDate}`}
            defaultValue={task.dueDate ? String(task.dueDate).substring(0, 10) : ""}
            onBlur={(e) => updateTask({ dueDate: e.target.value || null })}
            disabled={!isAdmin}
            title={!isAdmin ? "Admins only" : undefined}
          />
        </div>

        <div className="col-span-2">
          <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            <CheckCircle className="h-3 w-3" /> % Complete
          </label>
          <div className="flex items-center gap-3">
            <Slider
              data-testid="slider-percent-complete"
              className="flex-1"
              min={0}
              max={100}
              step={5}
              value={[task.percentComplete ?? 0]}
              onValueCommit={(v) => updateTask({ percentComplete: v[0] })}
              disabled={!isAdmin}
            />
            <Input
              data-testid="input-percent-complete"
              className="h-8 w-[72px] text-xs text-center tabular-nums"
              type="number"
              min={0}
              max={100}
              key={`pct-${task.id}-${task.percentComplete}`}
              defaultValue={task.percentComplete ?? 0}
              onBlur={(e) => {
                const val = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                if (val !== (task.percentComplete ?? 0)) {
                  updateTask({ percentComplete: val });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              disabled={!isAdmin}
              title={!isAdmin ? "Admins only" : undefined}
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>

        <div className="col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">
            Source
          </label>
          {isBaseline ? (
            <Badge
              data-testid="badge-source"
              className="bg-blue-100 text-blue-800"
              variant="secondary"
            >
              BASELINE
            </Badge>
          ) : (
            <Badge
              data-testid="badge-source"
              className="bg-green-100 text-green-800"
              variant="secondary"
            >
              OPERATIONAL
            </Badge>
          )}
        </div>
      </div>

      {isPlanTask && (
        <>
          <Separator />
          <div data-testid="plan-actions-section">
            <label className="text-xs text-muted-foreground mb-2 block font-medium">Plan Actions</label>
            <div className="flex flex-wrap gap-2">
              {!isMilestone && (
                confirmConvert ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-amber-700 font-medium">Convert this task to a milestone?</span>
                    <Button
                      variant="default"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => { onConvertToMilestone(); setConfirmConvert(false); }}
                      disabled={isConverting}
                      data-testid="button-confirm-convert-milestone"
                    >
                      {isConverting ? "Converting…" : "Yes, Convert"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setConfirmConvert(false)}
                      data-testid="button-cancel-convert-milestone"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1"
                    onClick={() => setConfirmConvert(true)}
                    disabled={isConverting || !isAdmin}
                    title={!isAdmin ? "Admins only" : undefined}
                    data-testid="button-convert-milestone"
                  >
                    <Diamond className="h-3 w-3" />
                    Convert to Milestone
                  </Button>
                )
              )}
              {confirmDelete ? (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-red-600 font-medium">Delete this task permanently?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => { onDeleteTask(); setConfirmDelete(false); }}
                    disabled={isDeleting}
                    data-testid="button-confirm-delete"
                  >
                    {isDeleting ? "Deleting…" : "Yes, Delete"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => setConfirmDelete(false)}
                    data-testid="button-cancel-delete"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={() => setConfirmDelete(true)}
                  disabled={!isAdmin}
                  title={!isAdmin ? "Admins only" : undefined}
                  data-testid="button-delete-task"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete Task
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      <Separator />

      {/* Description */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">
          Description
        </label>
        <Textarea
          data-testid="textarea-description"
          className="text-sm min-h-[80px]"
          value={descVal}
          onChange={(e) => setDescVal(e.target.value)}
          onBlur={saveDescription}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              saveDescription();
            }
          }}
          placeholder={isAdmin ? "Add a description…" : "Read-only"}
          disabled={!isAdmin}
          title={!isAdmin ? "Admins only" : undefined}
        />
      </div>

      <Separator />

      {/* Checklists Section */}
      <CollapsibleSection
        title="Checklists"
        icon={<CheckCircle className="h-4 w-4" />}
        count={checklists.length}
        open={checklistsOpen}
        onToggle={() => setChecklistsOpen(!checklistsOpen)}
      >
        {checklists.map((cl) => {
          const total = cl.items.length;
          const done = cl.items.filter((i) => i.isDone).length;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          return (
            <div
              key={cl.id}
              className="mb-4 last:mb-0"
              data-testid={`checklist-${cl.id}`}
            >
              <div className="flex items-center justify-between mb-1 gap-2">
                <span className="text-sm font-medium flex-1 min-w-0 truncate">{cl.title}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {done}/{total}
                </span>
                {isAdmin && (
                  confirmDeleteChecklist === cl.id ? (
                    <span className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => {
                          deleteChecklist(cl.id);
                          setConfirmDeleteChecklist(null);
                        }}
                        data-testid={`button-confirm-delete-checklist-${cl.id}`}
                      >
                        Delete
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => setConfirmDeleteChecklist(null)}
                        data-testid={`button-cancel-delete-checklist-${cl.id}`}
                      >
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                      onClick={() => setConfirmDeleteChecklist(cl.id)}
                      title="Delete checklist"
                      data-testid={`button-delete-checklist-${cl.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )
                )}
              </div>
              <Progress value={pct} className="h-1.5 mb-2" />
              <div className="space-y-1">
                {cl.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 group"
                    data-testid={`checklist-item-${item.id}`}
                  >
                    <Checkbox
                      data-testid={`checkbox-item-${item.id}`}
                      checked={item.isDone}
                      onCheckedChange={(checked) =>
                        toggleChecklistItem({
                          itemId: item.id,
                          isDone: !!checked,
                        })
                      }
                      disabled={!isAdmin}
                    />
                    <span
                      className={`text-sm flex-1 ${item.isDone ? "line-through text-muted-foreground" : ""}`}
                    >
                      {item.content}
                    </span>
                    {isAdmin && (
                      confirmDeleteItem === item.id ? (
                        <span className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => {
                              deleteChecklistItem(item.id);
                              setConfirmDeleteItem(null);
                            }}
                            data-testid={`button-confirm-delete-item-${item.id}`}
                          >
                            Delete
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => setConfirmDeleteItem(null)}
                            data-testid={`button-cancel-delete-item-${item.id}`}
                          >
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 opacity-60 lg:opacity-0 lg:h-6 lg:w-6 lg:group-hover:opacity-100 text-muted-foreground hover:text-red-600"
                          onClick={() => setConfirmDeleteItem(item.id)}
                          title="Delete item"
                          data-testid={`button-delete-item-${item.id}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-2">
                {newItemInputs[cl.id] !== undefined ? (
                  <div className="flex gap-1">
                    <Input
                      data-testid={`input-new-item-${cl.id}`}
                      className="h-7 text-xs"
                      placeholder="Item text"
                      value={newItemInputs[cl.id] ?? ""}
                      onChange={(e) =>
                        setNewItemInputs((p) => ({
                          ...p,
                          [cl.id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          (newItemInputs[cl.id] ?? "").trim()
                        ) {
                          addChecklistItem({
                            checklistId: cl.id,
                            content: newItemInputs[cl.id]!.trim(),
                          });
                          setNewItemInputs((p) => {
                            const n = { ...p };
                            delete n[cl.id];
                            return n;
                          });
                        }
                      }}
                      autoFocus
                    />
                    <Button
                      data-testid={`button-save-item-${cl.id}`}
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => {
                        if ((newItemInputs[cl.id] ?? "").trim()) {
                          addChecklistItem({
                            checklistId: cl.id,
                            content: newItemInputs[cl.id]!.trim(),
                          });
                        }
                        setNewItemInputs((p) => {
                          const n = { ...p };
                          delete n[cl.id];
                          return n;
                        });
                      }}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  isAdmin && (
                    <Button
                      data-testid={`button-add-item-${cl.id}`}
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() =>
                        setNewItemInputs((p) => ({ ...p, [cl.id]: "" }))
                      }
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add Item
                    </Button>
                  )
                )}
              </div>
            </div>
          );
        })}

        {showNewChecklist ? (
          <div className="flex gap-1 mt-2">
            <Input
              data-testid="input-new-checklist"
              className="h-7 text-xs"
              placeholder="Checklist title"
              value={newChecklistTitle}
              onChange={(e) => setNewChecklistTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newChecklistTitle.trim()) {
                  addChecklist(newChecklistTitle.trim());
                  setNewChecklistTitle("");
                  setShowNewChecklist(false);
                }
              }}
              autoFocus
            />
            <Button
              data-testid="button-save-checklist"
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() => {
                if (newChecklistTitle.trim()) {
                  addChecklist(newChecklistTitle.trim());
                }
                setNewChecklistTitle("");
                setShowNewChecklist(false);
              }}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          isAdmin && (
            <Button
              data-testid="button-add-checklist"
              variant="outline"
              size="sm"
              className="mt-2 text-xs"
              onClick={() => setShowNewChecklist(true)}
            >
              <Plus className="h-3 w-3 mr-1" /> Add Checklist
            </Button>
          )
        )}
      </CollapsibleSection>

      <Separator />

      {/* Comments Section */}
      <CollapsibleSection
        title="Comments"
        icon={<MessageSquare className="h-4 w-4" />}
        count={comments.length}
        open={commentsOpen}
        onToggle={() => setCommentsOpen(!commentsOpen)}
      >
        <div className="space-y-3">
          {comments.map((c) => {
            const authorName = c.authorId
              ? resolveName(c.authorId, null) || `User #${c.authorId}`
              : "System";
            return (
              <div
                key={c.id}
                className="text-sm group"
                data-testid={`comment-${c.id}`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium text-xs">{authorName}</span>
                  <span className="text-xs text-muted-foreground">
                    <Clock className="h-3 w-3 inline mr-0.5" />
                    {timeAgo(c.createdAt)}
                  </span>
                  <span className="ml-auto">
                    {isAdmin && (
                      confirmDeleteComment === c.id ? (
                        <span className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => {
                              deleteComment(c.id);
                              setConfirmDeleteComment(null);
                            }}
                            data-testid={`button-confirm-delete-comment-${c.id}`}
                          >
                            Delete
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => setConfirmDeleteComment(null)}
                            data-testid={`button-cancel-delete-comment-${c.id}`}
                          >
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 opacity-60 lg:opacity-0 lg:h-6 lg:w-6 lg:group-hover:opacity-100 text-muted-foreground hover:text-red-600"
                          onClick={() => setConfirmDeleteComment(c.id)}
                          title="Delete comment"
                          data-testid={`button-delete-comment-${c.id}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )
                    )}
                  </span>
                </div>
                <p className="text-muted-foreground whitespace-pre-wrap break-words">{c.body}</p>
              </div>
            );
          })}
        </div>
        {isAdmin && (
          <div className="flex gap-1 mt-3">
            <Input
              data-testid="input-comment"
              className="h-8 text-xs"
              placeholder="Add a comment…"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && commentText.trim()) {
                  addComment(commentText.trim());
                  setCommentText("");
                }
              }}
            />
            <Button
              data-testid="button-add-comment"
              size="sm"
              className="h-8"
              disabled={!commentText.trim()}
              onClick={() => {
                addComment(commentText.trim());
                setCommentText("");
              }}
            >
              Send
            </Button>
          </div>
        )}
      </CollapsibleSection>

      <Separator />

      {/* Attachments Section */}
      <CollapsibleSection
        title="Attachments"
        icon={<Paperclip className="h-4 w-4" />}
        count={attachments.length}
        open={attachOpen}
        onToggle={() => setAttachOpen(!attachOpen)}
      >
        <div className="space-y-2">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-2 text-sm group"
              data-testid={`attachment-${a.id}`}
            >
              <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline truncate flex-1 min-w-0"
                data-testid={`link-attachment-${a.id}`}
              >
                {a.filename}
              </a>
              {isAdmin && (
                confirmDeleteAttachment === a.id ? (
                  <span className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => {
                        deleteAttachment(a.id);
                        setConfirmDeleteAttachment(null);
                      }}
                      data-testid={`button-confirm-delete-attachment-${a.id}`}
                    >
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setConfirmDeleteAttachment(null)}
                      data-testid={`button-cancel-delete-attachment-${a.id}`}
                    >
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 opacity-60 lg:opacity-0 lg:h-6 lg:w-6 lg:group-hover:opacity-100 text-muted-foreground hover:text-red-600"
                    onClick={() => setConfirmDeleteAttachment(a.id)}
                    title="Delete attachment"
                    data-testid={`button-delete-attachment-${a.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )
              )}
            </div>
          ))}
        </div>

        {!isAdmin ? null : showAddLink ? (
          <div className="mt-2 space-y-1">
            <Input
              data-testid="input-link-name"
              className="h-7 text-xs"
              placeholder="Link name"
              value={linkName}
              onChange={(e) => setLinkName(e.target.value)}
            />
            <div className="flex gap-1">
              <Input
                data-testid="input-link-url"
                className="h-7 text-xs"
                placeholder="https://…"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && linkUrl.trim()) {
                    addAttachment({
                      filename: linkName.trim() || linkUrl.trim(),
                      url: linkUrl.trim(),
                    });
                    setLinkUrl("");
                    setLinkName("");
                    setShowAddLink(false);
                  }
                }}
              />
              <Button
                data-testid="button-save-link"
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => {
                  if (linkUrl.trim()) {
                    addAttachment({
                      filename: linkName.trim() || linkUrl.trim(),
                      url: linkUrl.trim(),
                    });
                  }
                  setLinkUrl("");
                  setLinkName("");
                  setShowAddLink(false);
                }}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ) : (
          <Button
            data-testid="button-add-link"
            variant="outline"
            size="sm"
            className="mt-2 text-xs"
            onClick={() => setShowAddLink(true)}
          >
            <Plus className="h-3 w-3 mr-1" /> Add Link
          </Button>
        )}
      </CollapsibleSection>

      <Separator />

      {/* Dependencies Section */}
      {task.projectId && (
        <CollapsibleSection
          title="Dependencies"
          icon={<Link2 className="h-4 w-4" />}
          count={0}
          open={true}
          onToggle={() => {}}
        >
          <DependencyManager taskId={task.id} projectId={task.projectId} />
        </CollapsibleSection>
      )}

      <Separator />

      {/* Activity Log Section */}
      <CollapsibleSection
        title="Activity"
        icon={<Activity className="h-4 w-4" />}
        count={activity.length}
        open={activityOpen}
        onToggle={() => setActivityOpen(!activityOpen)}
      >
        <div className="space-y-2">
          {activity.map((a) => (
            <div
              key={a.id}
              className="text-xs text-muted-foreground"
              data-testid={`activity-${a.id}`}
            >
              <span className="font-medium text-foreground">
                {a.fieldName
                  ? `${a.fieldName} changed`
                  : a.actionType}
              </span>
              {a.oldValue && a.newValue && (
                <span>
                  {" "}
                  from &lsquo;{a.oldValue}&rsquo; to &lsquo;{a.newValue}&rsquo;
                </span>
              )}
              {!a.oldValue && a.newValue && (
                <span> set to &lsquo;{a.newValue}&rsquo;</span>
              )}
              <span className="ml-1">— {timeAgo(a.createdAt)}</span>
            </div>
          ))}
          {activity.length === 0 && (
            <p className="text-xs text-muted-foreground">No activity yet</p>
          )}
        </div>
      </CollapsibleSection>
    </>
  );
}

function CollapsibleSection({
  title,
  icon,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        className="flex items-center gap-2 w-full text-left text-sm font-medium hover:bg-muted/50 rounded px-1 -mx-1 py-1"
        onClick={onToggle}
        data-testid={`toggle-${title.toLowerCase()}`}
      >
        {open ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        {icon}
        {title}
        <Badge variant="secondary" className="ml-auto text-xs">
          {count}
        </Badge>
      </button>
      {open && <div className="mt-2 pl-6">{children}</div>}
    </div>
  );
}
