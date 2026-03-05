import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, invalidateProjectQueries } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import type {
  OperationalTask,
  TaskComment,
  TaskChecklist,
  TaskChecklistItem,
  TaskAttachment,
  TaskActivityLog,
} from "@shared/schema";

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
} from "lucide-react";
import UserAssignmentPicker from "@/components/UserAssignmentPicker";

interface TaskDetailDrawerProps {
  taskId: number | null;
  open: boolean;
  onClose: () => void;
  projectName: string;
}

interface TaskDetailResponse {
  task: OperationalTask;
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
}: TaskDetailDrawerProps) {
  const queryClient = useQueryClient();

  const isBaselineTask = taskId !== null && taskId < 0;

  const detailQueryKey = isBaselineTask
    ? ["baseline-task-detail", taskId, projectName]
    : ["operational-task-detail", taskId];

  const { data, isLoading } = useQuery<TaskDetailResponse | null>({
    queryKey: detailQueryKey,
    queryFn: async () => {
      if (isBaselineTask) {
        const res = await apiRequest("GET", `/api/planning-tasks/${encodeURIComponent(projectName)}`);
        const raw = await res.json();
        const allTasks: any[] = Array.isArray(raw) ? raw : (raw.tasks || []);
        const match = allTasks.find((t: any) => t.id === taskId);
        if (!match) return null;
        const startD = match.startDate || match.actualStart || match.actualStartDate || null;
        const endD = match.dueDate || match.actualEnd || match.actualEndDate || null;
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
        };
        return { task, comments: [], checklists: [], attachments: [], activity: [] } as TaskDetailResponse;
      }
      const res = await apiRequest("GET", `/api/operational-tasks/task/${taskId}`);
      return res.json();
    },
    enabled: open && taskId !== null,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: detailQueryKey });
    queryClient.invalidateQueries({
      queryKey: ["operational-tasks", projectName],
    });
    queryClient.invalidateQueries({
      queryKey: ["planning-tasks", projectName],
    });
    queryClient.invalidateQueries({
      queryKey: ["working-plan", projectName],
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
  });

  const addCommentMutation = useMutation({
    mutationFn: async (body: string) => {
      await apiRequest("POST", "/api/task-comments", { taskId, body });
    },
    onSuccess: invalidateAll,
  });

  const addChecklistMutation = useMutation({
    mutationFn: async (title: string) => {
      await apiRequest("POST", "/api/task-checklists", { taskId, title });
    },
    onSuccess: invalidateAll,
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
  });

  const { toast } = useToast();

  const deleteTaskMutation = useMutation({
    mutationFn: async () => {
      if (!taskId) return;
      if (isBaselineTask) {
        const taskData = data?.task as any;
        if (taskData?.rowNumber != null) {
          await apiRequest("POST", "/api/project-plan/delete-tasks", {
            projectName,
            rowNumbers: [taskData.rowNumber],
          });
        } else {
          await apiRequest("POST", "/api/work-items/delete", {
            ids: [Math.abs(taskId)],
          });
        }
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
      if (taskData?.rowNumber == null) throw new Error("Task has no row number");
      await apiRequest("POST", "/api/project-plan/structure", {
        operation: "convertToMilestone",
        projectName,
        data: { milestoneRowNumber: taskData.rowNumber, subtaskRowNumbers: [] },
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
        toast({ title: "Duration is read-only", description: "Baseline task duration comes from the imported plan", variant: "destructive" });
        throw new Error("Baseline task duration is read-only");
      }
      await apiRequest("PATCH", `/api/operational-tasks/${taskId}`, { duration });
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
            ) : !data ? (
              <div className="flex items-center justify-center py-12" data-testid="task-detail-empty">
                <span className="text-muted-foreground">Task not found</span>
              </div>
            ) : (
              <TaskDetailContent
                data={data}
                updateTask={updateTaskMutation.mutate}
                addComment={addCommentMutation.mutate}
                addChecklist={addChecklistMutation.mutate}
                addChecklistItem={addChecklistItemMutation.mutate}
                toggleChecklistItem={toggleChecklistItemMutation.mutate}
                addAttachment={addAttachmentMutation.mutate}
                onClose={onClose}
                onDeleteTask={() => deleteTaskMutation.mutate()}
                onConvertToMilestone={() => convertToMilestoneMutation.mutate()}
                onUpdateDuration={(d) => updateDurationMutation.mutate(d)}
                isDeleting={deleteTaskMutation.isPending}
                isConverting={convertToMilestoneMutation.isPending}
                isBaselineTask={isBaselineTask}
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
  addComment,
  addChecklist,
  addChecklistItem,
  toggleChecklistItem,
  addAttachment,
  onClose,
  onDeleteTask,
  onConvertToMilestone,
  onUpdateDuration,
  isDeleting,
  isConverting,
  isBaselineTask,
}: {
  data: TaskDetailResponse;
  updateTask: (updates: Record<string, unknown>) => void;
  addComment: (body: string) => void;
  addChecklist: (title: string) => void;
  addChecklistItem: (p: { checklistId: number; content: string }) => void;
  toggleChecklistItem: (p: { itemId: number; isDone: boolean }) => void;
  addAttachment: (p: { filename: string; url: string }) => void;
  onClose: () => void;
  onDeleteTask: () => void;
  onConvertToMilestone: () => void;
  onUpdateDuration: (d: number) => void;
  isDeleting: boolean;
  isConverting: boolean;
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
  const [editingDuration, setEditingDuration] = useState(false);
  const [durationVal, setDurationVal] = useState(String((task as any).durationDays || 0));

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
    if (titleVal.trim() && titleVal !== task.title) {
      updateTask({ title: titleVal.trim() });
    }
    setEditingTitle(false);
  };

  const saveDescription = () => {
    if (descVal !== (task.description ?? "")) {
      updateTask({ description: descVal });
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
          {editingTitle ? (
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
              className="text-lg font-semibold cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1"
              onClick={() => setEditingTitle(true)}
            >
              {task.title}
            </h2>
          )}
          <div className="flex items-center gap-2 mt-1">
            <Badge
              data-testid="badge-status"
              className={statusColor[task.status] ?? ""}
              variant="secondary"
            >
              {task.status}
            </Badge>
            <Badge
              data-testid="badge-priority"
              className={priorityColor[task.priority] ?? ""}
              variant="secondary"
            >
              <Flag className="h-3 w-3 mr-1" />
              {task.priority}
            </Badge>
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
                {isBaselineTask ? (
                  <span
                    className="text-sm font-medium text-muted-foreground"
                    title="Baseline task duration is read-only"
                    data-testid="text-duration"
                  >
                    {durationDays > 0 ? `${durationDays} working days` : "—"}
                  </span>
                ) : editingDuration ? (
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
                    className="text-sm font-medium cursor-pointer hover:text-primary"
                    onClick={() => { setDurationVal(String(durationDays)); setEditingDuration(true); }}
                    data-testid="text-duration"
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
                    {baselineStartDate ? format(new Date(baselineStartDate), "MMM d, yyyy") : "—"}
                  </Badge>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <Badge variant="outline" className="text-xs font-mono">
                    {baselineEndDate ? format(new Date(baselineEndDate), "MMM d, yyyy") : "—"}
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
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            <Flag className="h-3 w-3" /> Priority
          </label>
          <SearchableSelect
            value={task.priority}
            onValueChange={(v) => updateTask({ priority: v })}
            data-testid="select-priority"
            triggerClassName="h-8 text-xs"
            options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }))}
          />
        </div>

        <div className="col-span-2">
          <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            <User className="h-3 w-3" /> Assignees
          </label>
          {isBaselineTask ? (
            <span className="text-sm text-muted-foreground" data-testid="text-assignees-readonly">
              {task.assignees?.length ? task.assignees.join(", ") : "Unassigned (from imported plan)"}
            </span>
          ) : (
            <UserAssignmentPicker
              taskId={task.id}
              taskSource="operational"
              resolvedUsers={task.resolvedAssignees || null}
              textNames={task.assignees || null}
              mode="multi"
              size="sm"
              invalidateKeys={[`/api/operational-tasks/task/${task.id}`, "/api/my-work/all-tasks"]}
            />
          )}
        </div>

        <div>
          <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            <Calendar className="h-3 w-3" /> Start Date
          </label>
          <Input
            data-testid="input-start-date"
            className="h-8 text-xs"
            type="text"
            placeholder="YYYY-MM-DD"
            defaultValue={task.startDate ?? ""}
            onBlur={(e) => updateTask({ startDate: e.target.value || null })}
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            <Calendar className="h-3 w-3" /> Due Date
          </label>
          <Input
            data-testid="input-due-date"
            className="h-8 text-xs"
            type="text"
            placeholder="YYYY-MM-DD"
            defaultValue={task.dueDate ?? ""}
            onBlur={(e) => updateTask({ dueDate: e.target.value || null })}
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
            />
            <Input
              data-testid="input-percent-complete"
              className="h-8 w-[72px] text-xs text-center tabular-nums"
              type="number"
              min={0}
              max={100}
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
              {!isMilestone && rowNumber != null && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1"
                  onClick={onConvertToMilestone}
                  disabled={isConverting}
                  data-testid="button-convert-milestone"
                >
                  <Diamond className="h-3 w-3" />
                  {isConverting ? "Converting…" : "Convert to Milestone"}
                </Button>
              )}
              {!isMilestone && rowNumber == null && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1 opacity-50 cursor-not-allowed"
                  disabled
                  data-testid="button-convert-milestone-disabled"
                  title="Task has no row number — cannot convert"
                >
                  <Diamond className="h-3 w-3" />
                  Convert to Milestone
                </Button>
              )}
              {confirmDelete ? (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-red-600 font-medium">Confirm?</span>
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
          placeholder="Add a description…"
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
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{cl.title}</span>
                <span className="text-xs text-muted-foreground">
                  {done}/{total}
                </span>
              </div>
              <Progress value={pct} className="h-1.5 mb-2" />
              <div className="space-y-1">
                {cl.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2"
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
                    />
                    <span
                      className={`text-sm ${item.isDone ? "line-through text-muted-foreground" : ""}`}
                    >
                      {item.content}
                    </span>
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
          <Button
            data-testid="button-add-checklist"
            variant="outline"
            size="sm"
            className="mt-2 text-xs"
            onClick={() => setShowNewChecklist(true)}
          >
            <Plus className="h-3 w-3 mr-1" /> Add Checklist
          </Button>
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
          {comments.map((c) => (
            <div
              key={c.id}
              className="text-sm"
              data-testid={`comment-${c.id}`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-medium text-xs">
                  {c.authorId ? `User #${c.authorId}` : "System"}
                </span>
                <span className="text-xs text-muted-foreground">
                  <Clock className="h-3 w-3 inline mr-0.5" />
                  {timeAgo(c.createdAt)}
                </span>
              </div>
              <p className="text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
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
              className="flex items-center gap-2 text-sm"
              data-testid={`attachment-${a.id}`}
            >
              <Paperclip className="h-3 w-3 text-muted-foreground" />
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline truncate"
                data-testid={`link-attachment-${a.id}`}
              >
                {a.filename}
              </a>
            </div>
          ))}
        </div>

        {showAddLink ? (
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
