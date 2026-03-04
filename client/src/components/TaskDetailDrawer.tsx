import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { format, formatDistanceToNow } from "date-fns";
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
        const allTasks: any[] = await res.json();
        const match = allTasks.find((t: any) => t.id === taskId);
        if (!match) return null;
        const task: any = {
          id: match.id,
          title: match.title || match.name || "",
          status: match.status || "Not Started",
          priority: match.priority || "Normal",
          startDate: match.startDate || match.actualStart || null,
          dueDate: match.dueDate || match.actualEnd || null,
          percentComplete: match.percentComplete || 0,
          description: match.comment || match.description || null,
          isBaseline: true,
          importedTaskId: match.importedTaskId || Math.abs(taskId!),
          projectName,
          assignees: match.assignees || (match.owner ? [match.owner] : []),
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

  if (!open || taskId === null) return null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-[500px] max-w-full p-0 sm:max-w-[500px]"
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
}: {
  data: TaskDetailResponse;
  updateTask: (updates: Record<string, unknown>) => void;
  addComment: (body: string) => void;
  addChecklist: (title: string) => void;
  addChecklistItem: (p: { checklistId: number; content: string }) => void;
  toggleChecklistItem: (p: { itemId: number; isDone: boolean }) => void;
  addAttachment: (p: { filename: string; url: string }) => void;
  onClose: () => void;
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

  const isBaseline = task.isBaseline || task.importedTaskId !== null;

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
          <UserAssignmentPicker
            taskId={task.id}
            taskSource="operational"
            resolvedUsers={task.resolvedAssignees || null}
            textNames={task.assignees || null}
            mode="multi"
            size="sm"
            invalidateKeys={[`/api/operational-tasks/task/${task.id}`, "/api/my-work/all-tasks"]}
          />
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
