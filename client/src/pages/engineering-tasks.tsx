import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import {
  ListTodo,
  Plus,
  Filter,
  Loader2,
  Search,
  X,
  Calendar,
  User,
  MessageSquare,
  Activity,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  GripVertical,
  Columns3,
  List,
  Send,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

async function engFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

const TASK_STATUSES = [
  "TO DO", "IN PROGRESS", "HOLD", "PROJECTS ASSISTANCE", "NEEDS APPROVAL",
  "QC APPROVED", "PROVIDE FEEDBACK", "OPERATIONAL APPROVAL", "COMPLETE"
];

const PRIORITIES = ["Critical", "Urgent", "High", "Medium", "Low"];

const statusColors: Record<string, string> = {
  "TO DO": "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  "IN PROGRESS": "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  "HOLD": "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  "NEEDS APPROVAL": "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  "QC APPROVED": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  "PROVIDE FEEDBACK": "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  "OPERATIONAL APPROVAL": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  "PROJECTS ASSISTANCE": "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
  "COMPLETE": "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
};

const statusColumnColors: Record<string, string> = {
  "TO DO": "border-t-gray-400",
  "IN PROGRESS": "border-t-blue-500",
  "HOLD": "border-t-red-500",
  "NEEDS APPROVAL": "border-t-amber-500",
  "QC APPROVED": "border-t-emerald-500",
  "PROVIDE FEEDBACK": "border-t-purple-500",
  "OPERATIONAL APPROVAL": "border-t-indigo-500",
  "PROJECTS ASSISTANCE": "border-t-cyan-500",
  "COMPLETE": "border-t-green-500",
};

const priorityColors: Record<string, string> = {
  Critical: "bg-red-600 text-white",
  Urgent: "bg-orange-100 text-orange-700",
  High: "bg-amber-100 text-amber-700",
  Medium: "bg-blue-100 text-blue-700",
  Low: "bg-gray-100 text-gray-600",
};

interface Task {
  id: number;
  projectName: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  phase: string | null;
  primaryWorkstream: string | null;
  ownerUserId: number | null;
  approverUserId: number | null;
  dueDate: string | null;
  startDate: string | null;
  percentComplete: number;
  holdReason: string | null;
  trackingRag: string | null;
  summaryText: string | null;
  taskTypeTag: string | null;
  externalSource: string | null;
  externalTaskId: string | null;
  parentTaskId: number | null;
  linkedPlanItemId: number | null;
  linkedDeliverableId: number | null;
  linkedQualityItemInstanceId: number | null;
  assignees: string[] | null;
  watchers: string[] | null;
  tags: string[] | null;
  createdAt: string;
  updatedAt: string;
}

interface Comment {
  id: number;
  taskId: number;
  authorId: number | null;
  body: string;
  createdAt: string;
  authorName?: string;
}

interface ActivityEntry {
  id: number;
  taskId: number;
  actorId: number | null;
  actionType: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  actorName?: string;
}

const SAVED_FILTERS: { label: string; filter: Record<string, string> }[] = [
  { label: "Overdue", filter: { preset: "overdue" } },
  { label: "Needs Approval", filter: { status: "NEEDS APPROVAL" } },
  { label: "Provide Feedback", filter: { status: "PROVIDE FEEDBACK" } },
  { label: "On Hold", filter: { status: "HOLD" } },
  { label: "QC Approved", filter: { status: "QC APPROVED" } },
];

function formatDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return d; }
}

function isOverdue(dueDate: string | null, status: string) {
  if (!dueDate || status === "COMPLETE") return false;
  return new Date(dueDate) < new Date();
}

function TaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  const overdue = isOverdue(task.dueDate, task.status);
  const projectDisplay = task.projectName?.replace(/_Tracker.*$/i, "").replace(/_/g, " ");

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("taskId", String(task.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onClick}
      className="bg-card border rounded-lg p-3 cursor-pointer hover:shadow-md transition-all duration-200 group"
      data-testid={`kanban-card-${task.id}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-sm font-medium leading-tight line-clamp-2 flex-1" data-testid={`text-card-title-${task.id}`}>
          {task.title}
        </h4>
        <GripVertical className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 shrink-0" />
      </div>
      <p className="text-xs text-muted-foreground mb-2 truncate">{projectDisplay}</p>
      <div className="flex items-center justify-between gap-1 flex-wrap">
        <Badge className={`text-[9px] px-1.5 py-0 ${priorityColors[task.priority] || "bg-gray-100"}`}>
          {task.priority}
        </Badge>
        {task.dueDate && (
          <span className={`text-[10px] flex items-center gap-0.5 ${overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
            <Calendar className="h-3 w-3" />
            {formatDate(task.dueDate)}
            {overdue && <AlertTriangle className="h-3 w-3" />}
          </span>
        )}
      </div>
      {task.assignees && task.assignees.length > 0 && (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
          <User className="h-3 w-3" />
          <span className="truncate">{task.assignees[0]}</span>
        </div>
      )}
      {task.trackingRag && (
        <div className="mt-1.5 flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${task.trackingRag === "Green" ? "bg-green-500" : task.trackingRag === "Amber" ? "bg-amber-500" : task.trackingRag === "Red" ? "bg-red-500" : "bg-gray-400"}`} />
          <span className="text-[10px] text-muted-foreground">{task.trackingRag}</span>
        </div>
      )}
    </div>
  );
}

function KanbanColumn({
  status, tasks, onDrop, onCardClick
}: {
  status: string; tasks: Task[]; onDrop: (taskId: number, newStatus: string) => void; onCardClick: (task: Task) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`flex flex-col min-w-[260px] max-w-[300px] bg-muted/30 rounded-lg border-t-4 ${statusColumnColors[status] || "border-t-gray-300"} ${dragOver ? "ring-2 ring-primary/40" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const taskId = parseInt(e.dataTransfer.getData("taskId"));
        if (taskId) onDrop(taskId, status);
      }}
      data-testid={`kanban-column-${status.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge className={`text-[10px] ${statusColors[status] || "bg-gray-100"}`}>{status}</Badge>
          <span className="text-xs text-muted-foreground font-medium">{tasks.length}</span>
        </div>
      </div>
      <ScrollArea className="flex-1 px-2 pb-2" style={{ maxHeight: "calc(100vh - 280px)" }}>
        <div className="space-y-2">
          {tasks.map(task => (
            <TaskCard key={task.id} task={task} onClick={() => onCardClick(task)} />
          ))}
          {tasks.length === 0 && (
            <div className="text-center py-8 text-xs text-muted-foreground/50">No tasks</div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function TaskDetailDrawer({
  task, onClose, onUpdate
}: {
  task: Task; onClose: () => void; onUpdate: () => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const [activeTab, setActiveTab] = useState<"comments" | "activity" | "subtasks">("comments");
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

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

  const updateMutation = useMutation({
    mutationFn: (updates: Record<string, any>) =>
      engFetch(`/api/eng/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify(updates) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eng-tasks"] });
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

  const handleStatusChange = (newStatus: string) => {
    if (newStatus === "COMPLETE") {
      const hasHighWarnings = task.trackingRag === "Red" || task.priority === "Critical";
      if (hasHighWarnings) {
        if (!window.confirm("This task has high-severity warnings. Proceed with completion anyway?")) {
          return;
        }
      }
    }
    updateMutation.mutate({ status: newStatus });
  };

  const handleInlineEdit = (field: string, value: string) => {
    updateMutation.mutate({ [field]: value || null });
    setEditingField(null);
  };

  const projectDisplay = task.projectName?.replace(/_Tracker.*$/i, "").replace(/_/g, " ");

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="task-detail-drawer">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-background border-l shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <Badge className={`text-[10px] shrink-0 ${statusColors[task.status] || "bg-gray-100"}`}>{task.status}</Badge>
            <span className="text-sm text-muted-foreground truncate">{projectDisplay}</span>
            {task.taskTypeTag === "PROJECT" && <Badge variant="outline" className="text-[9px]">Project</Badge>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="btn-close-drawer">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-5">
            <div>
              <h2 className="text-xl font-bold leading-tight" data-testid="text-drawer-title">{task.title}</h2>
              {task.externalTaskId && (
                <p className="text-[10px] text-muted-foreground mt-1">ClickUp: {task.externalTaskId}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</Label>
                <Select value={task.status} onValueChange={handleStatusChange}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-drawer-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_STATUSES.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Priority</Label>
                <Select value={task.priority} onValueChange={(v) => updateMutation.mutate({ priority: v })}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-drawer-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Due Date</Label>
                <Input
                  type="date"
                  className="h-8 text-xs"
                  value={task.dueDate || ""}
                  onChange={(e) => updateMutation.mutate({ dueDate: e.target.value || null })}
                  data-testid="input-drawer-due-date"
                />
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

            {task.assignees && task.assignees.length > 0 && (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Assignees</Label>
                <div className="flex flex-wrap gap-1">
                  {task.assignees.map((a, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">{a}</Badge>
                  ))}
                </div>
              </div>
            )}

            {task.holdReason && (
              <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Hold Reason
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
              {(["comments", "activity", "subtasks"] as const).map(tab => (
                <button
                  key={tab}
                  className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setActiveTab(tab)}
                  data-testid={`tab-${tab}`}
                >
                  {tab === "comments" && <MessageSquare className="h-3.5 w-3.5 inline mr-1" />}
                  {tab === "activity" && <Activity className="h-3.5 w-3.5 inline mr-1" />}
                  {tab === "subtasks" && <ListTodo className="h-3.5 w-3.5 inline mr-1" />}
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {tab === "comments" && comments.length > 0 && <span className="ml-1 text-muted-foreground">({comments.length})</span>}
                  {tab === "subtasks" && subtasks.length > 0 && <span className="ml-1 text-muted-foreground">({subtasks.length})</span>}
                </button>
              ))}
            </div>

            {activeTab === "comments" && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Add a comment..."
                    className="text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && commentText.trim()) {
                        addCommentMutation.mutate(commentText.trim());
                      }
                    }}
                    data-testid="input-comment"
                  />
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
                  <p className="text-xs text-muted-foreground text-center py-4">No comments yet</p>
                ) : (
                  <div className="space-y-2">
                    {comments.map(c => (
                      <div key={c.id} className="p-2.5 bg-muted/30 rounded-lg" data-testid={`comment-${c.id}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium">{c.authorName || "System"}</span>
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
                        {a.actionType === "bulk_updated" && <span>updated task</span>}
                        {!["created", "field_changed", "comment_added", "bulk_updated"].includes(a.actionType) && (
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
                {subtasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No subtasks</p>
                ) : (
                  subtasks.map(st => (
                    <div key={st.id} className="flex items-center gap-2 p-2 border rounded-lg text-sm" data-testid={`subtask-${st.id}`}>
                      {st.status === "COMPLETE" ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                      ) : (
                        <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="flex-1 truncate">{st.title}</span>
                      <Badge className={`text-[9px] ${statusColors[st.status] || "bg-gray-100"}`}>{st.status}</Badge>
                    </div>
                  ))
                )}
              </div>
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
    </div>
  );
}

export default function EngineeringTasksPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTask, setNewTask] = useState({
    projectName: "",
    title: "",
    description: "",
    status: "TO DO",
    priority: "Medium",
    phase: "",
    primaryWorkstream: "",
    dueDate: "",
  });

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ["eng-tasks"],
    queryFn: () => engFetch("/api/eng/tasks"),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: (task: typeof newTask) => engFetch("/api/eng/tasks", {
      method: "POST",
      body: JSON.stringify(task),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eng-tasks"] });
      setCreateOpen(false);
      setNewTask({ projectName: "", title: "", description: "", status: "TO DO", priority: "Medium", phase: "", primaryWorkstream: "", dueDate: "" });
      toast({ title: "Task created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: number; status: string }) =>
      engFetch(`/api/eng/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eng-tasks"] });
      toast({ title: "Status updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleDrop = useCallback((taskId: number, newStatus: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status === newStatus) return;
    updateStatusMutation.mutate({ taskId, status: newStatus });
  }, [tasks, updateStatusMutation]);

  const uniqueAssignees = [...new Set(tasks.flatMap(t => t.assignees || []).filter(Boolean))].sort();

  const filtered = tasks.filter(t => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (assigneeFilter !== "all" && !(t.assignees || []).includes(assigneeFilter)) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return t.title.toLowerCase().includes(term) || t.projectName.toLowerCase().includes(term);
    }
    return true;
  });

  const applyPreset = (preset: typeof SAVED_FILTERS[0]) => {
    setStatusFilter("all");
    setPriorityFilter("all");
    setAssigneeFilter("all");
    setSearchTerm("");
    if (preset.filter.status) setStatusFilter(preset.filter.status);
  };

  const tasksByStatus = TASK_STATUSES.reduce((acc, status) => {
    acc[status] = filtered.filter(t => t.status === status);
    return acc;
  }, {} as Record<string, Task[]>);

  const overdueTasks = filtered.filter(t => isOverdue(t.dueDate, t.status));

  return (
    <div data-testid="eng-tasks-page" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <ListTodo className="h-7 w-7 text-blue-500" />
          <div>
            <h2 className="text-2xl font-heading font-bold" data-testid="text-tasks-title">Task Board</h2>
            <p className="text-xs text-muted-foreground">{tasks.length} tasks · {overdueTasks.length} overdue</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-md">
            <Button
              variant={viewMode === "board" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => setViewMode("board")}
              data-testid="btn-view-board"
            >
              <Columns3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => setViewMode("list")}
              data-testid="btn-view-list"
            >
              <List className="h-4 w-4" />
            </Button>
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
                  <Input data-testid="input-task-project" value={newTask.projectName} onChange={e => setNewTask(p => ({ ...p, projectName: e.target.value }))} placeholder="e.g. Riverside Mall" />
                </div>
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input data-testid="input-task-title" value={newTask.title} onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))} placeholder="Task title" />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea data-testid="input-task-description" value={newTask.description} onChange={e => setNewTask(p => ({ ...p, description: e.target.value }))} placeholder="Optional description" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Select value={newTask.priority} onValueChange={v => setNewTask(p => ({ ...p, priority: v }))}>
                      <SelectTrigger data-testid="select-task-priority"><SelectValue /></SelectTrigger>
                      <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Due Date</Label>
                    <Input data-testid="input-task-due" type="date" value={newTask.dueDate} onChange={e => setNewTask(p => ({ ...p, dueDate: e.target.value }))} />
                  </div>
                </div>
                <Button
                  className="w-full bg-orange-600 hover:bg-orange-700"
                  data-testid="button-submit-task"
                  disabled={!newTask.projectName || !newTask.title || createMutation.isPending}
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-task-search"
            placeholder="Search tasks..."
            className="pl-9 h-8 text-xs"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px] h-8 text-xs" data-testid="filter-task-status">
            <Filter className="h-3 w-3 mr-1" /><SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {TASK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[130px] h-8 text-xs" data-testid="filter-task-priority">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        {uniqueAssignees.length > 0 && (
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="filter-task-assignee">
              <User className="h-3 w-3 mr-1" /><SelectValue placeholder="Assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assignees</SelectItem>
              {uniqueAssignees.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SAVED_FILTERS.map(f => (
          <Button
            key={f.label}
            variant="outline"
            size="sm"
            className={`h-6 text-[10px] px-2 ${f.filter.status && statusFilter === f.filter.status ? "bg-primary text-primary-foreground" : ""}`}
            onClick={() => applyPreset(f)}
            data-testid={`preset-${f.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {f.label}
            {f.filter.preset === "overdue" && overdueTasks.length > 0 && (
              <span className="ml-1 px-1 bg-red-500 text-white rounded-full text-[9px]">{overdueTasks.length}</span>
            )}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : viewMode === "board" ? (
        <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: "400px" }}>
          {TASK_STATUSES.map(status => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={tasksByStatus[status] || []}
              onDrop={handleDrop}
              onCardClick={setSelectedTask}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-[11px] text-muted-foreground">
                    <th className="text-left p-2 pl-3">Title</th>
                    <th className="text-left p-2">Project</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Priority</th>
                    <th className="text-left p-2">Assignee</th>
                    <th className="text-left p-2">Due Date</th>
                    <th className="text-center p-2">RAG</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(task => (
                    <tr
                      key={task.id}
                      className="border-b hover:bg-muted/10 cursor-pointer transition-colors"
                      onClick={() => setSelectedTask(task)}
                      data-testid={`row-task-${task.id}`}
                    >
                      <td className="p-2 pl-3 font-medium max-w-[250px] truncate" data-testid={`text-task-title-${task.id}`}>
                        {task.title}
                        {task.holdReason && <p className="text-[10px] text-red-500 truncate">{task.holdReason}</p>}
                      </td>
                      <td className="p-2 text-muted-foreground text-xs">
                        {task.projectName?.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                      </td>
                      <td className="p-2">
                        <Badge className={`text-[10px] ${statusColors[task.status] || "bg-gray-100"}`}>{task.status}</Badge>
                      </td>
                      <td className="p-2">
                        <Badge className={`text-[10px] ${priorityColors[task.priority] || "bg-gray-100"}`}>{task.priority}</Badge>
                      </td>
                      <td className="p-2 text-xs text-muted-foreground truncate max-w-[120px]">
                        {task.assignees?.[0] || "—"}
                      </td>
                      <td className={`p-2 text-xs ${isOverdue(task.dueDate, task.status) ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                        {formatDate(task.dueDate)}
                      </td>
                      <td className="p-2 text-center">
                        {task.trackingRag && (
                          <div className={`w-3 h-3 rounded-full mx-auto ${task.trackingRag === "Green" ? "bg-green-500" : task.trackingRag === "Amber" ? "bg-amber-500" : task.trackingRag === "Red" ? "bg-red-500" : "bg-gray-400"}`} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <ListTodo className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-lg font-medium">No tasks found</p>
                  <p className="text-sm mt-1">Create a new task or adjust your filters</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={() => {
            queryClient.invalidateQueries({ queryKey: ["eng-tasks"] });
            const updatedTask = tasks.find(t => t.id === selectedTask.id);
            if (updatedTask) setSelectedTask(updatedTask);
          }}
        />
      )}
    </div>
  );
}
