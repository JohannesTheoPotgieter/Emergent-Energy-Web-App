import { useState, useRef, useCallback, useMemo, useEffect } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
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
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  Clock,
  GripVertical,
  Columns3,
  List,
  Send,
  FolderKanban,
  Circle,
  UserCircle,
  Timer,
  ArrowRight,
  PauseCircle,
  MoreVertical,
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permissions";
import { PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";
import { ActionBar } from "@/components/guidance/ActionBar";
import { InlineTip } from "@/components/guidance/InlineTip";
import { MicroWalkthrough, ReplayWalkthrough } from "@/components/guidance/MicroWalkthrough";
import type { NextAction, BlockerInfo } from "@/hooks/use-guidance";

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

const priorityBorderColors: Record<string, string> = {
  Critical: "border-l-red-600",
  Urgent: "border-l-orange-500",
  High: "border-l-amber-500",
  Medium: "border-l-blue-400",
  Low: "border-l-gray-300",
};

const priorityOrder: Record<string, number> = { Critical: 0, Urgent: 1, High: 2, Medium: 3, Low: 4 };

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function getAvatarColor(name: string) {
  const colors = [
    "bg-blue-500", "bg-emerald-500", "bg-purple-500", "bg-amber-500",
    "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-teal-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function sortTasksForColumn(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const aOverdue = isOverdue(a.dueDate, a.status) ? 0 : 1;
    const bOverdue = isOverdue(b.dueDate, b.status) ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    const aPri = priorityOrder[a.priority] ?? 5;
    const bPri = priorityOrder[b.priority] ?? 5;
    if (aPri !== bPri) return aPri - bPri;
    const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return aDate - bDate;
  });
}

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
  blockedType: string | null;
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

function getSavedMyName(): string {
  return localStorage.getItem("eng_my_name") || "";
}

function setSavedMyName(name: string) {
  localStorage.setItem("eng_my_name", name);
}

function formatDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return d; }
}

function formatDateShort(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" });
  } catch { return d; }
}

function isOverdue(dueDate: string | null, status: string) {
  if (!dueDate || status === "COMPLETE") return false;
  return new Date(dueDate) < new Date();
}

function isDueThisWeek(dueDate: string | null, status: string) {
  if (!dueDate || status === "COMPLETE") return false;
  const due = new Date(dueDate);
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return due >= now && due <= weekFromNow;
}

function daysLabel(d: string | null) {
  if (!d) return null;
  const diff = Math.round((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return `${Math.abs(diff)}d late`;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${diff}d`;
}

function QuickStatusSelect({ task, onStatusChange }: { task: Task; onStatusChange: (id: number, status: string) => void }) {
  return (
    <Select
      value={task.status}
      onValueChange={(v) => {
        if (v !== task.status) onStatusChange(task.id, v);
      }}
    >
      <SelectTrigger
        className="h-6 text-[9px] px-1.5 w-auto min-w-0 border-none shadow-none bg-transparent hover:bg-muted/40"
        onClick={(e) => e.stopPropagation()}
        data-testid={`quick-status-${task.id}`}
      >
        <Badge className={`text-[9px] px-1.5 py-0 ${statusColors[task.status] || "bg-gray-100"}`}>
          {task.status}
        </Badge>
      </SelectTrigger>
      <SelectContent>
        {TASK_STATUSES.map(s => (
          <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TaskCard({ task, onClick, onStatusChange, onPriorityChange }: { task: Task; onClick: () => void; onStatusChange: (id: number, status: string) => void; onPriorityChange?: (id: number, priority: string) => void }) {
  const overdue = isOverdue(task.dueDate, task.status);
  const dueSoon = isDueThisWeek(task.dueDate, task.status);
  const projectDisplay = task.projectName?.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
  const label = daysLabel(task.dueDate);
  const isCritical = task.priority === "Critical" || task.priority === "Urgent";

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("taskId", String(task.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onClick}
      className={`bg-card border-l-[3px] border border-b-border border-r-border border-t-border rounded-md px-2.5 py-2 cursor-pointer hover:shadow-md hover:translate-y-[-1px] transition-all duration-150 group relative
        ${priorityBorderColors[task.priority] || "border-l-gray-300"}
        ${overdue ? "bg-red-50/60 dark:bg-red-950/20 border-r-red-200 border-t-red-200 border-b-red-200 dark:border-r-red-900 dark:border-t-red-900 dark:border-b-red-900" : ""}
        ${isCritical && !overdue ? "bg-orange-50/30 dark:bg-orange-950/10" : ""}
      `}
      data-testid={`kanban-card-${task.id}`}
    >
      <div className="flex items-start gap-1.5 mb-1">
        <h4 className="text-[13px] font-medium leading-snug line-clamp-2 flex-1 min-w-0" data-testid={`text-card-title-${task.id}`}>
          {task.title}
        </h4>
        {task.trackingRag && task.trackingRag !== "Green" && (
          <div className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${task.trackingRag === "Amber" ? "bg-amber-500" : task.trackingRag === "Red" ? "bg-red-500 animate-pulse" : "bg-gray-400"}`} title={`RAG: ${task.trackingRag}`} />
        )}
      </div>

      <p className="text-[10px] text-muted-foreground/70 mb-1.5 truncate">{projectDisplay}</p>

      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <div onClick={(e) => e.stopPropagation()}>
          {onPriorityChange ? (
            <Select value={task.priority} onValueChange={(v) => { if (v !== task.priority) onPriorityChange(task.id, v); }}>
              <SelectTrigger className="h-5 text-[9px] px-0 w-auto min-w-0 border-none shadow-none bg-transparent p-0 gap-0" data-testid={`card-priority-${task.id}`}>
                <Badge className={`text-[9px] px-1.5 py-0 leading-tight cursor-pointer hover:ring-1 hover:ring-offset-1 ring-current ${priorityColors[task.priority] || "bg-gray-100"}`}>
                  {task.priority}
                </Badge>
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Badge className={`text-[9px] px-1.5 py-0 leading-tight ${priorityColors[task.priority] || "bg-gray-100"}`}>
              {task.priority}
            </Badge>
          )}
        </div>
        {task.dueDate && (
          <span className={`text-[10px] flex items-center gap-0.5 font-medium px-1 py-0 rounded
            ${overdue ? "text-red-700 bg-red-100 dark:bg-red-900/40 dark:text-red-300" : dueSoon ? "text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300" : "text-muted-foreground"}`}
          >
            {overdue && <AlertTriangle className="h-3 w-3 shrink-0" />}
            {!overdue && dueSoon && <Clock className="h-3 w-3 shrink-0" />}
            {!overdue && !dueSoon && <Calendar className="h-2.5 w-2.5 shrink-0" />}
            {label || formatDateShort(task.dueDate)}
          </span>
        )}
        {task.percentComplete > 0 && task.percentComplete < 100 && (
          <span className="text-[9px] text-muted-foreground font-medium">{Math.round(task.percentComplete)}%</span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 min-w-0">
          {task.assignees && task.assignees.length > 0 ? (
            <div className="flex items-center gap-1 min-w-0">
              <div className="flex -space-x-1">
                {task.assignees.slice(0, 2).map((name, i) => (
                  <div key={i} className={`w-5 h-5 rounded-full ${getAvatarColor(name)} flex items-center justify-center text-[8px] font-bold text-white ring-1 ring-card`} title={name}>
                    {getInitials(name)}
                  </div>
                ))}
                {task.assignees.length > 2 && (
                  <div className="w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center text-[8px] font-bold text-gray-600 ring-1 ring-card">
                    +{task.assignees.length - 2}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground truncate max-w-[70px]">{task.assignees[0]?.split(" ")[0]}</span>
            </div>
          ) : (
            <span className="text-[10px] text-muted-foreground/40 italic">Unassigned</span>
          )}
        </div>
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <QuickStatusSelect task={task} onStatusChange={onStatusChange} />
        </div>
      </div>

      {task.holdReason && (
        <div className="mt-1.5 px-1.5 py-1 bg-red-50 dark:bg-red-950/30 rounded text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1 border border-red-100 dark:border-red-900">
          <PauseCircle className="h-3 w-3 shrink-0" />
          {task.blockedType && <span className={`px-1 py-0 rounded text-[9px] font-bold ${task.blockedType === "External" ? "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" : "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"}`}>{task.blockedType}</span>}
          <span className="truncate">{task.holdReason}</span>
        </div>
      )}
    </div>
  );
}

function KanbanColumn({
  status, tasks, onDrop, onCardClick, onStatusChange, onPriorityChange
}: {
  status: string; tasks: Task[]; onDrop: (taskId: number, newStatus: string) => void; onCardClick: (task: Task) => void; onStatusChange: (id: number, status: string) => void; onPriorityChange?: (id: number, priority: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const sorted = useMemo(() => sortTasksForColumn(tasks), [tasks]);
  const overdueCount = useMemo(() => tasks.filter(t => isOverdue(t.dueDate, t.status)).length, [tasks]);
  const criticalCount = useMemo(() => tasks.filter(t => t.priority === "Critical" || t.priority === "Urgent").length, [tasks]);

  return (
    <div
      className={`flex flex-col min-w-[260px] max-w-[300px] bg-muted/20 rounded-lg border-t-4 transition-all ${statusColumnColors[status] || "border-t-gray-300"} ${dragOver ? "ring-2 ring-primary/40 bg-primary/5" : ""}`}
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
      <div className="px-3 pt-3 pb-2 flex items-center justify-between sticky top-0 bg-inherit z-10 rounded-t-lg">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{status}</span>
          <span className="text-[11px] text-muted-foreground/60 font-medium">{tasks.length}</span>
        </div>
        <div className="flex items-center gap-1">
          {overdueCount > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] font-bold text-red-600 bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 rounded-full" title={`${overdueCount} overdue`}>
              <AlertTriangle className="h-2.5 w-2.5" />
              {overdueCount}
            </span>
          )}
          {criticalCount > 0 && overdueCount === 0 && (
            <span className="flex items-center gap-0.5 text-[9px] font-bold text-orange-600 bg-orange-100 dark:bg-orange-900/40 px-1.5 py-0.5 rounded-full" title={`${criticalCount} critical/urgent`}>
              {criticalCount}
            </span>
          )}
        </div>
      </div>
      <ScrollArea className="flex-1 px-2 pb-2" style={{ maxHeight: "calc(100vh - 300px)" }}>
        <div className="space-y-1.5">
          {sorted.map(task => (
            <TaskCard key={task.id} task={task} onClick={() => onCardClick(task)} onStatusChange={onStatusChange} onPriorityChange={onPriorityChange} />
          ))}
          {tasks.length === 0 && (
            <div className="text-center py-10 text-xs text-muted-foreground/40">
              <Circle className="h-6 w-6 mx-auto mb-1.5 opacity-30" />
              No tasks
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function PostUpdateForm({ taskId, currentStatus, hasProject, onDone }: { taskId: number; currentStatus: string; hasProject: boolean; onDone: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [updateText, setUpdateText] = useState("");
  const [newStatus, setNewStatus] = useState(currentStatus);
  const [holdReason, setHoldReason] = useState("");
  const [blockedType, setBlockedType] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const needsHoldReason = newStatus === "HOLD" && newStatus !== currentStatus;

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
    if (newStatus === "PROJECTS ASSISTANCE" && newStatus !== currentStatus && !hasProject) {
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
      queryClient.invalidateQueries({ queryKey: ["eng-tasks"] });
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
    <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg space-y-2" data-testid="post-update-form">
      <div className="flex items-center gap-2">
        <ArrowRight className="h-3.5 w-3.5 text-blue-600" />
        <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">Post Update</span>
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
          <Select value={newStatus} onValueChange={(v) => { setNewStatus(v); if (v !== "HOLD") { setHoldReason(""); setBlockedType(""); } }}>
            <SelectTrigger className="h-7 text-[10px] w-[140px]" data-testid="select-post-update-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.map(s => (
                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            <Select value={blockedType} onValueChange={setBlockedType}>
              <SelectTrigger className="h-7 text-[10px] w-[120px] border-amber-300" data-testid="select-post-update-blocked-type">
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Internal" className="text-xs">Internal</SelectItem>
                <SelectItem value="External" className="text-xs">External</SelectItem>
              </SelectContent>
            </Select>
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

interface TeamMember {
  id: number;
  name: string;
  email: string;
  role: string;
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
  const [activeTab, setActiveTab] = useState<"updates" | "activity" | "subtasks">("updates");
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [approvalComment, setApprovalComment] = useState("");
  const [showApprovalActions, setShowApprovalActions] = useState(false);
  const [showSendForApproval, setShowSendForApproval] = useState(false);
  const [sendApprovalApprover, setSendApprovalApprover] = useState("");
  const [sendApprovalNote, setSendApprovalNote] = useState("");
  const [sendApprovalFile, setSendApprovalFile] = useState<File | null>(null);
  const [sendingForApproval, setSendingForApproval] = useState(false);
  const [drawerHoldDialog, setDrawerHoldDialog] = useState(false);
  const [drawerHoldReason, setDrawerHoldReason] = useState("");
  const [drawerBlockedType, setDrawerBlockedType] = useState("");
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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

  const { data: teamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ["team-members"],
    queryFn: () => engFetch("/api/eng/team-members"),
  });

  const EXCLUDED_PHASES_DRAWER = ["Hold", "Closed", "Gone"];
  const { data: drawerProjects = [] } = useQuery<{ id: number; project_name: string; raw: string }[]>({
    queryKey: ["/api/projects-summary"],
    select: (data: any[]) => data.map((p: any) => ({
      id: p.project_info_id || p.id,
      project_name: p.project_name?.replace(/_Tracker.*$/, "").replace(/_/g, " ") || p.projectName || "",
      raw: p.project_name || "",
      phase: p.phase || "",
    })).filter((p: any) => p.project_name && !EXCLUDED_PHASES_DRAWER.includes(p.phase)).sort((a: any, b: any) => a.project_name.localeCompare(b.project_name)),
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

  const deleteMutation = useMutation({
    mutationFn: () =>
      engFetch(`/api/eng/tasks/${task.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eng-tasks"] });
      onClose();
      onUpdate();
      toast({ title: "Task deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleStatusChange = (newStatus: string) => {
    if (newStatus === "HOLD") {
      setDrawerHoldDialog(true);
      setDrawerHoldReason("");
      setDrawerBlockedType("");
      return;
    }
    if (newStatus === "PROJECTS ASSISTANCE" && !task.projectName) {
      toast({ title: "Project required", description: "Link a project to this task before setting Projects Assistance status.", variant: "destructive" });
      return;
    }
    if (newStatus === "NEEDS APPROVAL" && !task.approverUserId) {
      toast({ title: "Set an approver first", description: "Assign an approver below before requesting approval.", variant: "destructive" });
      return;
    }
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
  const overdue = isOverdue(task.dueDate, task.status);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="task-detail-drawer">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-full sm:max-w-2xl bg-background border-l shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <Badge className={`text-[10px] shrink-0 ${statusColors[task.status] || "bg-gray-100"}`}>{task.status}</Badge>
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

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-5">
            <div>
              <h2 className="text-xl font-bold leading-tight" data-testid="text-drawer-title">{task.title}</h2>
              {task.externalTaskId && (
                <p className="text-[10px] text-muted-foreground mt-1">Ref: {task.externalTaskId}</p>
              )}
            </div>

            <PostUpdateForm
              taskId={task.id}
              currentStatus={task.status}
              hasProject={!!task.projectName}
              onDone={() => {
                queryClient.invalidateQueries({ queryKey: ["eng-tasks"] });
                onUpdate();
              }}
            />

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
                  className={`h-8 text-xs ${overdue ? "border-red-300 text-red-600" : ""}`}
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

            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Assignee</Label>
              <Select
                value={task.assignees?.[0] || "none"}
                onValueChange={(v) => {
                  const newAssignees = v === "none" ? [] : [v];
                  const matchedUser = v !== "none" ? teamMembers.find(m => m.name === v) : null;
                  updateMutation.mutate({ assignees: newAssignees, ownerUserId: matchedUser?.id || null });
                }}
              >
                <SelectTrigger className="h-8 text-xs" data-testid="select-drawer-assignee">
                  <SelectValue placeholder="Select assignee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {teamMembers.map(m => (
                    <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              {(() => {
                const currentRaw = task.projectName || "";
                const matchesExisting = !currentRaw || drawerProjects.some(p => (p.raw || p.project_name) === currentRaw);
                return (
                  <Select
                    value={currentRaw || "none"}
                    onValueChange={(v) => {
                      const newName = v === "none" ? null : v;
                      updateMutation.mutate({ projectName: newName });
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs" data-testid="select-drawer-project">
                      <SelectValue placeholder="Select project">
                        {currentRaw ? projectDisplay : "No project"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No project</SelectItem>
                      {!matchesExisting && currentRaw && (
                        <SelectItem value={currentRaw}>{projectDisplay} (current)</SelectItem>
                      )}
                      {drawerProjects.map(p => (
                        <SelectItem key={p.id} value={p.raw || p.project_name}>{p.project_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}
            </div>

            <div className="space-y-3 p-3 bg-muted/20 rounded-lg border">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" /> Approval
                </Label>
                {task.approverUserId && (
                  <Badge variant="outline" className="text-[10px]">
                    <UserCheck className="h-3 w-3 mr-1" />
                    {teamMembers.find(m => m.id === task.approverUserId)?.name || `User #${task.approverUserId}`}
                  </Badge>
                )}
              </div>

              {(task.status === "NEEDS APPROVAL" || task.status === "OPERATIONAL APPROVAL") && (
                <div className="space-y-2 pt-1">
                  <div className="p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    Awaiting approval from {teamMembers.find(m => m.id === task.approverUserId)?.name || "approver"}
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
                        updateMutation.mutate({ status: "QC APPROVED" });
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
                        updateMutation.mutate({ status: "PROVIDE FEEDBACK" });
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
                        updateMutation.mutate({ status: "TO DO" });
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

              {task.status === "PROVIDE FEEDBACK" && (
                <div className="p-2 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 rounded text-xs text-purple-700 dark:text-purple-300 flex items-center gap-2">
                  <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                  Changes requested — address feedback and resubmit for approval
                </div>
              )}

              {task.status === "QC APPROVED" && (
                <div className="p-2 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  QC Approved — ready for operational sign-off or completion
                </div>
              )}

              {task.status !== "NEEDS APPROVAL" && task.status !== "OPERATIONAL APPROVAL" && task.status !== "QC APPROVED" && task.status !== "COMPLETE" && (
                <>
                  <Button
                    size="sm"
                    className="h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white gap-1.5 w-full"
                    onClick={() => setShowSendForApproval(true)}
                    data-testid="btn-send-for-approval"
                  >
                    <Send className="h-3.5 w-3.5" /> Send for Approval
                  </Button>

                  <Dialog open={showSendForApproval} onOpenChange={(open) => {
                    setShowSendForApproval(open);
                    if (!open) { setSendApprovalApprover(""); setSendApprovalNote(""); setSendApprovalFile(null); }
                  }}>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                          <Send className="h-4 w-4 text-amber-600" /> Send for Approval
                        </DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 pt-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium">Approver <span className="text-red-500">*</span></Label>
                          <Select value={sendApprovalApprover} onValueChange={setSendApprovalApprover}>
                            <SelectTrigger className="h-9 text-sm" data-testid="select-send-approver">
                              <SelectValue placeholder="Select approver..." />
                            </SelectTrigger>
                            <SelectContent>
                              {teamMembers.filter(m => m.id !== user?.id).map(m => (
                                <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium">Attachment (optional)</Label>
                          <div
                            className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer hover:border-amber-400 hover:bg-amber-50/30 dark:hover:bg-amber-950/10 ${sendApprovalFile ? "border-amber-400 bg-amber-50/20" : "border-muted"}`}
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
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium">Note (optional)</Label>
                          <Textarea
                            value={sendApprovalNote}
                            onChange={(e) => setSendApprovalNote(e.target.value)}
                            placeholder="Add context for the approver..."
                            className="min-h-[60px] text-sm"
                            data-testid="textarea-send-approval-note"
                          />
                        </div>
                        <div className="flex gap-2 pt-2">
                          <Button
                            className="flex-1 h-9 text-sm bg-amber-600 hover:bg-amber-700 gap-1.5"
                            disabled={!sendApprovalApprover || sendingForApproval}
                            onClick={async () => {
                              setSendingForApproval(true);
                              try {
                                const formData = new FormData();
                                formData.append("approverUserId", sendApprovalApprover);
                                formData.append("note", sendApprovalNote);
                                if (sendApprovalFile) formData.append("file", sendApprovalFile);
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
                                toast({ title: "Sent for approval", description: "The approver has been notified" });
                                setShowSendForApproval(false);
                                setSendApprovalApprover(""); setSendApprovalNote(""); setSendApprovalFile(null);
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
                            {sendingForApproval ? "Sending..." : "Send for Approval"}
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
            </div>

            {task.holdReason && (
              <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-1">
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
              {(["updates", "activity", "subtasks"] as const).map(tab => (
                <button
                  key={tab}
                  className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setActiveTab(tab)}
                  data-testid={`tab-${tab}`}
                >
                  {tab === "updates" && <MessageSquare className="h-3.5 w-3.5 inline mr-1" />}
                  {tab === "activity" && <Activity className="h-3.5 w-3.5 inline mr-1" />}
                  {tab === "subtasks" && <ListTodo className="h-3.5 w-3.5 inline mr-1" />}
                  {tab === "updates" ? "Updates" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {tab === "updates" && comments.length > 0 && <span className="ml-1 text-muted-foreground">({comments.length})</span>}
                  {tab === "subtasks" && subtasks.length > 0 && <span className="ml-1 text-muted-foreground">({subtasks.length})</span>}
                </button>
              ))}
            </div>

            {activeTab === "updates" && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Add a quick comment..."
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
                          const newStatus = st.status === "COMPLETE" ? "TO DO" : "COMPLETE";
                          try {
                            await engFetch(`/api/eng/tasks/${st.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ status: newStatus }),
                            });
                            queryClient.invalidateQueries({ queryKey: ["task-subtasks", task.id] });
                          } catch {}
                        }}
                      >
                        {st.status === "COMPLETE" ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground hover:text-primary" />
                        )}
                      </button>
                      <span className={`flex-1 truncate ${st.status === "COMPLETE" ? "line-through text-muted-foreground" : ""}`}>{st.title}</span>
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

      <Dialog open={drawerHoldDialog} onOpenChange={setDrawerHoldDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PauseCircle className="h-5 w-5 text-amber-500" />
              Hold Reason Required
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">Please provide a reason for putting this task on hold.</p>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Blocked Type *</label>
              <Select value={drawerBlockedType} onValueChange={setDrawerBlockedType}>
                <SelectTrigger className="h-9" data-testid="select-drawer-blocked-type">
                  <SelectValue placeholder="Internal or External..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Internal">Internal</SelectItem>
                  <SelectItem value="External">External</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea
              value={drawerHoldReason}
              onChange={(e) => setDrawerHoldReason(e.target.value)}
              placeholder="e.g. Waiting for client approval, materials delayed..."
              className="min-h-[80px]"
              data-testid="input-drawer-hold-reason"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDrawerHoldDialog(false)} data-testid="btn-drawer-hold-cancel">Cancel</Button>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700"
                disabled={!drawerHoldReason.trim() || !drawerBlockedType}
                onClick={() => {
                  updateMutation.mutate({ status: "HOLD", holdReason: drawerHoldReason.trim(), blockedType: drawerBlockedType });
                  setDrawerHoldDialog(false);
                  setDrawerHoldReason("");
                  setDrawerBlockedType("");
                }}
                data-testid="btn-drawer-hold-confirm"
              >
                Put on Hold
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const PHASE_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  P0_FIRST_ASSESSMENT: { bg: "bg-slate-50 dark:bg-slate-900/30", text: "text-slate-700 dark:text-slate-300", accent: "bg-slate-500" },
  P1_COST_PROPOSAL_DESIGN: { bg: "bg-violet-50 dark:bg-violet-900/30", text: "text-violet-700 dark:text-violet-300", accent: "bg-violet-500" },
  P2_PD_PM_HANDOVER: { bg: "bg-indigo-50 dark:bg-indigo-900/30", text: "text-indigo-700 dark:text-indigo-300", accent: "bg-indigo-500" },
  P3_DETAILED_DESIGN_PROC_RELEASE: { bg: "bg-blue-50 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300", accent: "bg-blue-500" },
  P4_CONSTRUCTION_INSTALLATION: { bg: "bg-amber-50 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-300", accent: "bg-amber-500" },
  P5_COMMISSIONING_TESTING: { bg: "bg-orange-50 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-300", accent: "bg-orange-500" },
  P6_HANDOVER_CLIENT_MATRIARCH: { bg: "bg-teal-50 dark:bg-teal-900/30", text: "text-teal-700 dark:text-teal-300", accent: "bg-teal-500" },
  P7_CLOSEOUT_POSTMORTEM: { bg: "bg-emerald-50 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-300", accent: "bg-emerald-500" },
};

interface ProjectGroup {
  projectName: string;
  displayName: string;
  phase: string;
  phaseLabel: string;
  tasks: Task[];
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
}

function ProjectKanbanView({
  tasks,
  onCardClick,
  onDrop,
  onStatusChange,
  searchTerm,
}: {
  tasks: Task[];
  onCardClick: (task: Task) => void;
  onDrop: (taskId: number, newStatus: string) => void;
  onStatusChange: (id: number, status: string) => void;
  searchTerm: string;
}) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(["all"]));

  const { data: dashboardData } = useQuery<{
    projects: { projectName: string; displayName: string; phase: string; phaseLabel: string }[];
  }>({
    queryKey: ["eng-dashboard-projects"],
    queryFn: () => engFetch("/api/eng/dashboard/projects"),
    staleTime: 30000,
  });

  const projectGroups: ProjectGroup[] = useMemo(() => {
    const byProject = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = t.projectName || "Unassigned";
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(t);
    }

    const dashProjects = dashboardData?.projects || [];
    const phaseMap = new Map<string, { phase: string; phaseLabel: string; displayName: string }>();
    for (const dp of dashProjects) {
      const norm = dp.projectName.replace(/_Tracker$/i, "").replace(/_/g, " ").toLowerCase();
      phaseMap.set(norm, dp);
    }

    const groups: ProjectGroup[] = [];
    for (const entry of Array.from(byProject.entries())) {
      const projectName = entry[0];
      const projectTasks = entry[1];
      const norm = projectName.replace(/_Tracker$/i, "").replace(/_/g, " ").toLowerCase();
      const dashInfo = phaseMap.get(norm);
      const phase = dashInfo?.phase || "UNKNOWN";
      const phaseLabel = dashInfo?.phaseLabel || PROJECT_PHASE_LABELS[phase as ProjectPhase] || "Unknown Phase";
      const displayName = dashInfo?.displayName || projectName.replace(/_Tracker$/i, "").replace(/_/g, " ");

      const completedTasks = projectTasks.filter((t: Task) => t.status === "COMPLETE" || t.status === "QC APPROVED").length;
      const overdueTasks = projectTasks.filter((t: Task) => isOverdue(t.dueDate, t.status)).length;

      groups.push({
        projectName,
        displayName,
        phase,
        phaseLabel,
        tasks: projectTasks,
        totalTasks: projectTasks.length,
        completedTasks,
        overdueTasks,
      });
    }

    groups.sort((a, b) => {
      const phaseOrder = (a.phase || "ZZZ").localeCompare(b.phase || "ZZZ");
      if (phaseOrder !== 0) return phaseOrder;
      return a.displayName.localeCompare(b.displayName);
    });

    return groups;
  }, [tasks, dashboardData]);

  const phaseGrouped = useMemo(() => {
    const map = new Map<string, ProjectGroup[]>();
    for (const g of projectGroups) {
      const key = g.phase;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    return map;
  }, [projectGroups]);

  const toggleProject = (name: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const togglePhase = (phase: string) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase); else next.add(phase);
      return next;
    });
  };

  useEffect(() => {
    if (searchTerm) {
      const matching = new Set<string>();
      for (const g of projectGroups) {
        const term = searchTerm.toLowerCase();
        if (g.displayName.toLowerCase().includes(term) ||
            g.tasks.some(t => t.title.toLowerCase().includes(term))) {
          matching.add(g.projectName);
        }
      }
      setExpandedProjects(matching);
      setExpandedPhases(new Set(Array.from(phaseGrouped.keys())));
    }
  }, [searchTerm]);

  const STATUS_MINI = ["TO DO", "IN PROGRESS", "HOLD", "NEEDS APPROVAL", "QC APPROVED", "COMPLETE"];

  return (
    <div className="space-y-4" data-testid="projects-view">
      {Array.from(phaseGrouped.entries()).map(([phase, groups]) => {
        const colors = PHASE_COLORS[phase] || PHASE_COLORS.P0_FIRST_ASSESSMENT;
        const phaseLabel = groups[0]?.phaseLabel || phase;
        const isPhaseExpanded = expandedPhases.has(phase) || expandedPhases.has("all");
        const totalInPhase = groups.reduce((s, g) => s + g.totalTasks, 0);
        const completedInPhase = groups.reduce((s, g) => s + g.completedTasks, 0);
        const phasePct = totalInPhase > 0 ? Math.round((completedInPhase / totalInPhase) * 100) : 0;

        return (
          <div key={phase} className="border rounded-xl overflow-hidden" data-testid={`phase-group-${phase}`}>
            <button
              className={`w-full flex items-center gap-3 px-4 py-3 ${colors.bg} hover:opacity-90 transition-opacity`}
              onClick={() => togglePhase(phase)}
              data-testid={`toggle-phase-${phase}`}
            >
              {isPhaseExpanded
                ? <ChevronDown className={`h-4 w-4 ${colors.text}`} />
                : <ChevronRight className={`h-4 w-4 ${colors.text}`} />
              }
              <div className={`w-2 h-2 rounded-full ${colors.accent}`} />
              <span className={`font-semibold text-sm ${colors.text}`}>{phaseLabel}</span>
              <Badge variant="secondary" className="text-[10px]">{groups.length} project{groups.length !== 1 ? "s" : ""}</Badge>
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 bg-black/10 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${colors.accent}`} style={{ width: `${phasePct}%` }} />
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">{phasePct}%</span>
              </div>
            </button>

            {isPhaseExpanded && (
              <div className="divide-y">
                {groups.map(group => {
                  const isExpanded = expandedProjects.has(group.projectName);
                  const completion = group.totalTasks > 0
                    ? Math.round((group.completedTasks / group.totalTasks) * 100) : 0;

                  return (
                    <div key={group.projectName} data-testid={`project-group-${group.projectName}`}>
                      <button
                        className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-muted/40 transition-colors text-left"
                        onClick={() => toggleProject(group.projectName)}
                        data-testid={`toggle-project-${group.projectName}`}
                      >
                        {isExpanded
                          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        }
                        <span className="font-medium text-sm flex-1 truncate">{group.displayName}</span>
                        <div className="flex items-center gap-3 shrink-0">
                          {group.overdueTasks > 0 && (
                            <span className="flex items-center gap-1 text-[10px] text-red-600 font-bold">
                              <AlertTriangle className="h-3 w-3" />
                              {group.overdueTasks}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {group.completedTasks}/{group.totalTasks}
                          </span>
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${completion >= 80 ? "bg-emerald-500" : completion >= 40 ? "bg-blue-500" : "bg-slate-400"}`}
                              style={{ width: `${completion}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-muted-foreground w-7 text-right">{completion}%</span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-5 pb-3">
                          <div className="flex gap-2 overflow-x-auto pb-2 pt-1" style={{ minHeight: "120px" }}>
                            {STATUS_MINI.map(status => {
                              const statusTasks = group.tasks.filter(t => {
                                if (status === "COMPLETE") return t.status === "COMPLETE" || t.status === "QC APPROVED";
                                return t.status === status;
                              });
                              if (status !== "TO DO" && status !== "IN PROGRESS" && statusTasks.length === 0) return null;

                              return (
                                <div
                                  key={status}
                                  className={`flex-shrink-0 w-[200px] bg-muted/20 rounded-lg border-t-2 ${statusColumnColors[status] || "border-t-gray-300"}`}
                                  onDragOver={(e) => e.preventDefault()}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    const taskId = parseInt(e.dataTransfer.getData("taskId"));
                                    if (taskId) onDrop(taskId, status);
                                  }}
                                  data-testid={`mini-col-${group.projectName}-${status}`}
                                >
                                  <div className="px-2 py-1.5 flex items-center justify-between">
                                    <span className="text-[10px] font-medium text-muted-foreground truncate">{status}</span>
                                    <span className="text-[10px] text-muted-foreground">{statusTasks.length}</span>
                                  </div>
                                  <div className="px-1.5 pb-1.5 space-y-1 max-h-[250px] overflow-y-auto">
                                    {statusTasks.map(task => (
                                      <div
                                        key={task.id}
                                        draggable
                                        onDragStart={(e) => {
                                          e.dataTransfer.setData("taskId", String(task.id));
                                          e.dataTransfer.effectAllowed = "move";
                                        }}
                                        onClick={() => onCardClick(task)}
                                        className="bg-card border rounded p-2 cursor-pointer hover:shadow-sm transition-all text-xs"
                                        data-testid={`mini-card-${task.id}`}
                                      >
                                        <p className="font-medium leading-tight line-clamp-2 mb-1">{task.title}</p>
                                        <div className="flex items-center gap-1 flex-wrap">
                                          <Badge className={`text-[8px] px-1 py-0 ${priorityColors[task.priority] || "bg-gray-100"}`}>
                                            {task.priority}
                                          </Badge>
                                          {task.dueDate && (
                                            <span className={`text-[9px] flex items-center gap-0.5 ${isOverdue(task.dueDate, task.status) ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                                              <Calendar className="h-2.5 w-2.5" />
                                              {formatDateShort(task.dueDate)}
                                            </span>
                                          )}
                                        </div>
                                        {task.assignees?.[0] && (
                                          <div className="mt-1 flex items-center gap-0.5 text-[9px] text-muted-foreground">
                                            <User className="h-2.5 w-2.5" />
                                            <span className="truncate">{task.assignees[0]}</span>
                                          </div>
                                        )}
                                        {task.trackingRag && (
                                          <div className="mt-0.5 flex items-center gap-0.5">
                                            <Circle className={`h-2 w-2 fill-current ${task.trackingRag === "Green" ? "text-green-500" : task.trackingRag === "Amber" ? "text-amber-500" : task.trackingRag === "Red" ? "text-red-500" : "text-gray-400"}`} />
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                    {statusTasks.length === 0 && (
                                      <div className="text-center py-4 text-[10px] text-muted-foreground/40">—</div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {projectGroups.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <FolderKanban className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No projects found</p>
          <p className="text-sm mt-1">Create tasks to see them grouped by project</p>
        </div>
      )}
    </div>
  );
}

function PersonalKpiStrip({ tasks, myTasks }: { tasks: Task[]; myTasks: Task[] }) {
  const myActive = myTasks.filter(t => t.status !== "COMPLETE").length;
  const myOverdue = myTasks.filter(t => isOverdue(t.dueDate, t.status)).length;
  const myDueThisWeek = myTasks.filter(t => isDueThisWeek(t.dueDate, t.status)).length;
  const myHold = myTasks.filter(t => t.status === "HOLD").length;
  const myInProgress = myTasks.filter(t => t.status === "IN PROGRESS").length;

  const stats = [
    { label: "My Active", value: myActive, icon: <ListTodo className="w-3.5 h-3.5" />, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "In Progress", value: myInProgress, icon: <ArrowRight className="w-3.5 h-3.5" />, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Due This Week", value: myDueThisWeek, icon: <Timer className="w-3.5 h-3.5" />, color: "text-indigo-600", bg: "bg-indigo-50" },
    { label: "Overdue", value: myOverdue, icon: <AlertTriangle className="w-3.5 h-3.5" />, color: myOverdue > 0 ? "text-red-600" : "text-muted-foreground", bg: myOverdue > 0 ? "bg-red-50" : "bg-muted" },
    { label: "On Hold", value: myHold, icon: <PauseCircle className="w-3.5 h-3.5" />, color: myHold > 0 ? "text-amber-600" : "text-muted-foreground", bg: myHold > 0 ? "bg-amber-50" : "bg-muted" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2" data-testid="personal-kpi-strip">
      {stats.map(s => (
        <div key={s.label} className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card">
          <div className={`w-7 h-7 rounded-md ${s.bg} flex items-center justify-center`}>
            <span className={s.color}>{s.icon}</span>
          </div>
          <div>
            <p className={`text-base font-bold leading-none ${s.color}`} data-testid={`my-kpi-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>{s.value}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function InlineListView({ tasks, onCardClick, onStatusChange, onPriorityChange }: {
  tasks: Task[];
  onCardClick: (task: Task) => void;
  onStatusChange: (id: number, status: string) => void;
  onPriorityChange: (id: number, priority: string) => void;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
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
              {tasks.map(task => (
                <tr
                  key={task.id}
                  className="border-b hover:bg-muted/10 transition-colors"
                  data-testid={`row-task-${task.id}`}
                >
                  <td
                    className="p-2 pl-3 font-medium max-w-[250px] truncate cursor-pointer hover:text-blue-600"
                    onClick={() => onCardClick(task)}
                    data-testid={`text-task-title-${task.id}`}
                  >
                    {task.title}
                    {task.holdReason && <p className="text-[10px] text-red-500 truncate">{task.blockedType && <span className={`px-1 py-0 rounded text-[9px] font-semibold mr-0.5 ${task.blockedType === "External" ? "bg-orange-100 text-orange-700" : "bg-purple-100 text-purple-700"}`}>{task.blockedType}</span>}{task.holdReason}</p>}
                  </td>
                  <td className="p-2 text-muted-foreground text-xs">
                    {task.projectName?.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                  </td>
                  <td className="p-2" onClick={(e) => e.stopPropagation()}>
                    <Select value={task.status} onValueChange={(v) => onStatusChange(task.id, v)}>
                      <SelectTrigger className="h-7 text-[10px] w-[130px] border-none shadow-none p-0" data-testid={`inline-status-${task.id}`}>
                        <Badge className={`text-[10px] ${statusColors[task.status] || "bg-gray-100"}`}>{task.status}</Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {TASK_STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-2" onClick={(e) => e.stopPropagation()}>
                    <Select value={task.priority} onValueChange={(v) => onPriorityChange(task.id, v)}>
                      <SelectTrigger className="h-7 text-[10px] w-[90px] border-none shadow-none p-0" data-testid={`inline-priority-${task.id}`}>
                        <Badge className={`text-[10px] ${priorityColors[task.priority] || "bg-gray-100"}`}>{task.priority}</Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITIES.map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-2 text-xs text-muted-foreground truncate max-w-[120px]">
                    {task.assignees?.[0] || "—"}
                  </td>
                  <td className={`p-2 text-xs ${isOverdue(task.dueDate, task.status) ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                    <div className="flex items-center gap-1">
                      {formatDateShort(task.dueDate)}
                      {isOverdue(task.dueDate, task.status) && <AlertTriangle className="h-3 w-3" />}
                    </div>
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
          {tasks.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <ListTodo className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">No tasks found</p>
              <p className="text-sm mt-1">Create a new task or adjust your filters</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MyTasksView({
  tasks,
  myName,
  onCardClick,
  onStatusChange,
  onPriorityChange,
}: {
  tasks: Task[];
  myName: string;
  onCardClick: (task: Task) => void;
  onStatusChange: (id: number, status: string) => void;
  onPriorityChange: (id: number, priority: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<string>>(new Set());
  const [quickNotes, setQuickNotes] = useState<Record<number, string>>({});
  const [postingNote, setPostingNote] = useState<Record<number, boolean>>({});
  const [dueDates, setDueDates] = useState<Record<number, string>>({});
  const [myStatusFilter, setMyStatusFilter] = useState<string>("all");
  const [myPriorityFilter, setMyPriorityFilter] = useState<string>("all");
  const [myProjectFilter, setMyProjectFilter] = useState<string>("all");
  const [myDueFilter, setMyDueFilter] = useState<string>("all");
  const [mySearch, setMySearch] = useState("");

  const nameLower = myName.toLowerCase();
  const myTasks = useMemo(() => {
    return tasks.filter(t =>
      (t.assignees || []).some(a => a && a.toLowerCase().startsWith(nameLower))
    );
  }, [tasks, nameLower]);

  const filteredMyTasks = useMemo(() => {
    return myTasks.filter(t => {
      if (myStatusFilter !== "all" && t.status !== myStatusFilter) return false;
      if (myPriorityFilter !== "all" && t.priority !== myPriorityFilter) return false;
      if (myProjectFilter !== "all" && t.projectName !== myProjectFilter) return false;
      if (myDueFilter === "overdue" && !isOverdue(t.dueDate, t.status)) return false;
      if (myDueFilter === "today") {
        if (!t.dueDate) return false;
        const d = new Date(t.dueDate).toDateString();
        if (d !== new Date().toDateString()) return false;
      }
      if (myDueFilter === "week" && !isDueThisWeek(t.dueDate, t.status) && !isOverdue(t.dueDate, t.status)) return false;
      if (mySearch) {
        const term = mySearch.toLowerCase();
        return t.title.toLowerCase().includes(term) || t.projectName.toLowerCase().includes(term);
      }
      return true;
    });
  }, [myTasks, myStatusFilter, myPriorityFilter, myProjectFilter, myDueFilter, mySearch]);

  const uniqueProjects = useMemo(() => {
    return Array.from(new Set(myTasks.map(t => t.projectName).filter(Boolean))).sort();
  }, [myTasks]);

  const buckets = useMemo(() => {
    const overdue: Task[] = [];
    const dueSoon: Task[] = [];
    const hold: Task[] = [];
    const inProgress: Task[] = [];
    const rest: Task[] = [];

    for (const t of filteredMyTasks) {
      if (isOverdue(t.dueDate, t.status)) {
        overdue.push(t);
      } else if (isDueThisWeek(t.dueDate, t.status) || (t.dueDate && new Date(t.dueDate).toDateString() === new Date().toDateString())) {
        dueSoon.push(t);
      } else if (t.status === "HOLD") {
        hold.push(t);
      } else if (t.status === "IN PROGRESS") {
        inProgress.push(t);
      } else if (t.status !== "COMPLETE") {
        rest.push(t);
      }
    }

    const priorityOrder: Record<string, number> = { Critical: 0, Urgent: 1, High: 2, Medium: 3, Low: 4 };
    const sortByPriority = (a: Task, b: Task) => (priorityOrder[a.priority] ?? 5) - (priorityOrder[b.priority] ?? 5);
    overdue.sort((a, b) => {
      const aDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;
      const bDate = b.dueDate ? new Date(b.dueDate).getTime() : 0;
      return aDate - bDate || sortByPriority(a, b);
    });
    dueSoon.sort((a, b) => {
      const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return aDate - bDate || sortByPriority(a, b);
    });
    hold.sort(sortByPriority);
    inProgress.sort(sortByPriority);
    rest.sort(sortByPriority);

    return [
      { key: "overdue", label: "Overdue", icon: <AlertTriangle className="h-4 w-4 text-red-500" />, tasks: overdue, color: "border-l-red-500 bg-red-50/30 dark:bg-red-950/10" },
      { key: "due-soon", label: "Due Today / Due Soon", icon: <Timer className="h-4 w-4 text-amber-500" />, tasks: dueSoon, color: "border-l-amber-500 bg-amber-50/30 dark:bg-amber-950/10" },
      { key: "hold", label: "On Hold", icon: <PauseCircle className="h-4 w-4 text-red-400" />, tasks: hold, color: "border-l-red-400 bg-red-50/20 dark:bg-red-950/10" },
      { key: "in-progress", label: "In Progress", icon: <ArrowRight className="h-4 w-4 text-blue-500" />, tasks: inProgress, color: "border-l-blue-500 bg-blue-50/30 dark:bg-blue-950/10" },
      { key: "everything-else", label: "Everything Else", icon: <Circle className="h-4 w-4 text-gray-400" />, tasks: rest, color: "border-l-gray-400 bg-gray-50/30 dark:bg-gray-800/10" },
    ];
  }, [filteredMyTasks]);

  const toggleBucket = (key: string) => {
    setCollapsedBuckets(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const updateDueDateMutation = useMutation({
    mutationFn: ({ taskId, dueDate }: { taskId: number; dueDate: string }) =>
      engFetch(`/api/eng/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ dueDate: dueDate || null }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eng-tasks"] });
      toast({ title: "Due date updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const postQuickNote = async (taskId: number) => {
    const note = quickNotes[taskId]?.trim();
    if (!note) return;
    setPostingNote(prev => ({ ...prev, [taskId]: true }));
    try {
      await engFetch(`/api/eng/tasks/${taskId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: note }),
      });
      queryClient.invalidateQueries({ queryKey: ["eng-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task-comments", taskId] });
      queryClient.invalidateQueries({ queryKey: ["task-activity", taskId] });
      setQuickNotes(prev => ({ ...prev, [taskId]: "" }));
      toast({ title: "Note posted" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setPostingNote(prev => ({ ...prev, [taskId]: false }));
    }
  };

  return (
    <div className="space-y-4" data-testid="my-tasks-view">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[150px] max-w-xs">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="my-tasks-search"
            placeholder="Search my tasks..."
            className="pl-9 h-8 text-xs"
            value={mySearch}
            onChange={e => setMySearch(e.target.value)}
          />
        </div>
        <Select value={myStatusFilter} onValueChange={setMyStatusFilter}>
          <SelectTrigger className="w-[130px] h-8 text-xs" data-testid="my-tasks-filter-status">
            <Filter className="h-3 w-3 mr-1" /><SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {TASK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={myPriorityFilter} onValueChange={setMyPriorityFilter}>
          <SelectTrigger className="w-[110px] h-8 text-xs" data-testid="my-tasks-filter-priority">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        {uniqueProjects.length > 0 && (
          <Select value={myProjectFilter} onValueChange={setMyProjectFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="my-tasks-filter-project">
              <FolderKanban className="h-3 w-3 mr-1" /><SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {uniqueProjects.map(p => (
                <SelectItem key={p} value={p}>{p.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={myDueFilter} onValueChange={setMyDueFilter}>
          <SelectTrigger className="w-[120px] h-8 text-xs" data-testid="my-tasks-filter-due">
            <Calendar className="h-3 w-3 mr-1" /><SelectValue placeholder="Due" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Due Dates</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="today">Due Today</SelectItem>
            <SelectItem value="week">Due This Week</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {buckets.map(bucket => {
        if (bucket.tasks.length === 0) return null;
        const isCollapsed = collapsedBuckets.has(bucket.key);

        return (
          <div key={bucket.key} className={`border-l-4 rounded-lg border ${bucket.color}`} data-testid={`bucket-${bucket.key}`}>
            <button
              className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/20 transition-colors"
              onClick={() => toggleBucket(bucket.key)}
              data-testid={`toggle-bucket-${bucket.key}`}
            >
              {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              {bucket.icon}
              <span className="font-semibold text-sm">{bucket.label}</span>
              <Badge variant="secondary" className="text-[10px] ml-1">{bucket.tasks.length}</Badge>
            </button>
            {!isCollapsed && (
              <div className="px-2 pb-2">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[800px]">
                    <thead>
                      <tr className="text-[10px] text-muted-foreground border-b">
                        <th className="text-left p-2 pl-3 w-[30%]">Task</th>
                        <th className="text-left p-2 w-[14%]">Project</th>
                        <th className="text-left p-2 w-[12%]">Status</th>
                        <th className="text-left p-2 w-[10%]">Priority</th>
                        <th className="text-left p-2 w-[10%]">Due Date</th>
                        <th className="text-left p-2 w-[20%]">Quick Note</th>
                        <th className="text-center p-2 w-[4%]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bucket.tasks.map(task => {
                        const projectDisplay = task.projectName?.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
                        const overdue = isOverdue(task.dueDate, task.status);
                        return (
                          <tr key={task.id} className="border-b hover:bg-muted/10 transition-colors" data-testid={`my-task-row-${task.id}`}>
                            <td className="p-2 pl-3">
                              <div className="flex flex-col">
                                <span className="font-medium text-sm truncate max-w-[280px]" data-testid={`my-task-title-${task.id}`}>{task.title}</span>
                                {task.holdReason && (
                                  <span className="text-[10px] text-red-500 flex items-center gap-0.5 mt-0.5">
                                    <PauseCircle className="h-3 w-3 shrink-0" />
                                    {task.blockedType && <span className={`px-1 py-0 rounded text-[9px] font-semibold mr-0.5 ${task.blockedType === "External" ? "bg-orange-100 text-orange-700" : "bg-purple-100 text-purple-700"}`}>{task.blockedType}</span>}
                                    {task.holdReason}
                                  </span>
                                )}
                                {task.dueDate && overdue && (
                                  <span className="text-[10px] text-red-600 font-semibold">{daysLabel(task.dueDate)}</span>
                                )}
                              </div>
                            </td>
                            <td className="p-2 text-xs text-muted-foreground truncate max-w-[120px]">{projectDisplay}</td>
                            <td className="p-2" onClick={e => e.stopPropagation()}>
                              <Select value={task.status} onValueChange={v => { if (v !== task.status) onStatusChange(task.id, v); }}>
                                <SelectTrigger className="h-7 text-[10px] w-[130px] border-none shadow-none p-0" data-testid={`my-task-status-${task.id}`}>
                                  <Badge className={`text-[10px] ${statusColors[task.status] || "bg-gray-100"}`}>{task.status}</Badge>
                                </SelectTrigger>
                                <SelectContent>
                                  {TASK_STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="p-2" onClick={e => e.stopPropagation()}>
                              <Select value={task.priority} onValueChange={v => { if (v !== task.priority) onPriorityChange(task.id, v); }}>
                                <SelectTrigger className="h-7 text-[10px] w-[90px] border-none shadow-none p-0" data-testid={`my-task-priority-${task.id}`}>
                                  <Badge className={`text-[10px] ${priorityColors[task.priority] || "bg-gray-100"}`}>{task.priority}</Badge>
                                </SelectTrigger>
                                <SelectContent>
                                  {PRIORITIES.map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="p-2" onClick={e => e.stopPropagation()}>
                              <Input
                                type="date"
                                className="h-7 text-[10px] w-[120px] border-dashed"
                                value={dueDates[task.id] ?? (task.dueDate ? task.dueDate.split("T")[0] : "")}
                                onChange={e => setDueDates(prev => ({ ...prev, [task.id]: e.target.value }))}
                                onBlur={() => {
                                  const val = dueDates[task.id];
                                  if (val !== undefined && val !== (task.dueDate ? task.dueDate.split("T")[0] : "")) {
                                    updateDueDateMutation.mutate({ taskId: task.id, dueDate: val });
                                  }
                                }}
                                data-testid={`my-task-due-${task.id}`}
                              />
                            </td>
                            <td className="p-2" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                <Input
                                  placeholder="Add note..."
                                  className="h-7 text-[10px] flex-1 min-w-0"
                                  value={quickNotes[task.id] || ""}
                                  onChange={e => setQuickNotes(prev => ({ ...prev, [task.id]: e.target.value }))}
                                  onKeyDown={e => { if (e.key === "Enter" && quickNotes[task.id]?.trim()) postQuickNote(task.id); }}
                                  data-testid={`my-task-note-${task.id}`}
                                />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 shrink-0"
                                  disabled={!quickNotes[task.id]?.trim() || postingNote[task.id]}
                                  onClick={() => postQuickNote(task.id)}
                                  data-testid={`my-task-note-send-${task.id}`}
                                >
                                  {postingNote[task.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                </Button>
                              </div>
                            </td>
                            <td className="p-2 text-center">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => onCardClick(task)}
                                title="Open details"
                                data-testid={`my-task-open-${task.id}`}
                              >
                                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {filteredMyTasks.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <UserCog className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No tasks found</p>
          <p className="text-sm mt-1">{myTasks.length === 0 ? "You have no assigned tasks" : "Adjust your filters to see tasks"}</p>
        </div>
      )}
    </div>
  );
}

export default function EngineeringTasksPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<"board" | "list" | "projects" | "mytasks">("board");
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [myName, setMyName] = useState(() => {
    const saved = getSavedMyName();
    if (saved) return saved;
    const fullName = user?.name || "";
    return fullName.split(/\s+/)[0];
  });
  const [showNamePicker, setShowNamePicker] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("project") || "";
  });
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
    assignees: [] as string[],
    approverUserId: null as number | null,
  });

  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [holdDialog, setHoldDialog] = useState<{ taskId: number; reason: string; blockedType: string } | null>(null);

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ["eng-tasks"],
    queryFn: () => engFetch("/api/eng/tasks"),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const { data: pageTeamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ["team-members"],
    queryFn: () => engFetch("/api/eng/team-members"),
  });

  const EXCLUDED_PHASES = ["Hold", "Closed", "Gone"];
  const { data: allProjects = [] } = useQuery<{ id: number; project_name: string }[]>({
    queryKey: ["/api/projects-summary"],
    select: (data: any[]) => data.map((p: any) => ({
      id: p.project_info_id || p.id,
      project_name: p.project_name?.replace(/_Tracker.*$/, "").replace(/_/g, " ") || p.projectName || "",
      phase: p.phase || "",
    })).filter((p: any) => p.project_name && !EXCLUDED_PHASES.includes(p.phase)).sort((a: any, b: any) => a.project_name.localeCompare(b.project_name)),
  });

  const myTasks = useMemo(() => {
    if (!myName) return [];
    const nameLower = myName.toLowerCase();
    return tasks.filter(t =>
      (t.assignees || []).some(a => a && a.toLowerCase().startsWith(nameLower))
    );
  }, [tasks, myName]);

  const createMutation = useMutation({
    mutationFn: (task: typeof newTask) => {
      const assigneeName = task.assignees?.[0];
      const matchedUser = assigneeName ? pageTeamMembers.find(m => m.name === assigneeName) : null;
      return engFetch("/api/eng/tasks", {
        method: "POST",
        body: JSON.stringify({ ...task, ownerUserId: matchedUser?.id || null }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eng-tasks"] });
      setCreateOpen(false);
      setNewTask({ projectName: "", title: "", description: "", status: "TO DO", priority: "Medium", phase: "", primaryWorkstream: "", dueDate: "", assignees: [], approverUserId: null });
      toast({ title: "Task created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ taskId, status, holdReason, blockedType }: { taskId: number; status: string; holdReason?: string; blockedType?: string }) =>
      engFetch(`/api/eng/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status, ...(holdReason ? { holdReason } : {}), ...(blockedType ? { blockedType } : {}) }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eng-tasks"] });
      toast({ title: "Status updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updatePriorityMutation = useMutation({
    mutationFn: ({ taskId, priority }: { taskId: number; priority: string }) =>
      engFetch(`/api/eng/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ priority }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eng-tasks"] });
      toast({ title: "Priority updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const requestStatusChange = useCallback((taskId: number, newStatus: string) => {
    if (newStatus === "HOLD") {
      setHoldDialog({ taskId, reason: "", blockedType: "" });
      return;
    }
    if (newStatus === "PROJECTS ASSISTANCE") {
      const task = tasks.find(t => t.id === taskId);
      if (task && !task.projectName) {
        setSelectedTask(task);
        toast({ title: "Project required", description: "Link a project to this task before setting Projects Assistance status.", variant: "destructive" });
        return;
      }
    }
    if (newStatus === "NEEDS APPROVAL") {
      const task = tasks.find(t => t.id === taskId);
      if (task && !task.approverUserId) {
        setSelectedTask(task);
        toast({ title: "Set an approver first", description: "Open the task and assign an approver before requesting approval.", variant: "destructive" });
        return;
      }
    }
    updateStatusMutation.mutate({ taskId, status: newStatus });
  }, [tasks, updateStatusMutation, toast]);

  const handleDrop = useCallback((taskId: number, newStatus: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status === newStatus) return;
    requestStatusChange(taskId, newStatus);
  }, [tasks, requestStatusChange]);

  const handleStatusChange = useCallback((taskId: number, newStatus: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status === newStatus) return;
    if (newStatus === "COMPLETE" && (task.trackingRag === "Red" || task.priority === "Critical")) {
      if (!window.confirm("This task has high-severity warnings. Proceed with completion?")) return;
    }
    requestStatusChange(taskId, newStatus);
  }, [tasks, requestStatusChange]);

  const handlePriorityChange = useCallback((taskId: number, newPriority: string) => {
    updatePriorityMutation.mutate({ taskId, priority: newPriority });
  }, [updatePriorityMutation]);

  const uniqueAssignees = Array.from(new Set(tasks.flatMap(t => t.assignees || []).filter(Boolean))).sort();

  const basePool = myTasksOnly ? myTasks : tasks;

  const filtered = basePool.filter(t => {
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
    setMyTasksOnly(false);
    if (preset.filter.status) setStatusFilter(preset.filter.status);
  };

  const tasksByStatus = TASK_STATUSES.reduce((acc, status) => {
    acc[status] = filtered.filter(t => t.status === status);
    return acc;
  }, {} as Record<string, Task[]>);

  const overdueTasks = filtered.filter(t => isOverdue(t.dueDate, t.status));
  const needsApprovalTasks = filtered.filter(t => t.status === "NEEDS APPROVAL");
  const holdTasks = filtered.filter(t => t.status === "HOLD");

  const engNextAction = useMemo((): NextAction | null => {
    if (overdueTasks.length > 0) return { label: `${overdueTasks.length} overdue task${overdueTasks.length !== 1 ? "s" : ""} — review and update`, severity: "urgent" };
    if (needsApprovalTasks.length > 0) return { label: `${needsApprovalTasks.length} task${needsApprovalTasks.length !== 1 ? "s" : ""} awaiting approval`, severity: "warning" };
    if (holdTasks.length > 0) return { label: `${holdTasks.length} task${holdTasks.length !== 1 ? "s" : ""} on hold — check if blockers resolved`, severity: "warning" };
    return { label: "All tasks on track — review board for next priorities", severity: "info" };
  }, [overdueTasks, needsApprovalTasks, holdTasks]);

  const engBlockers = useMemo((): BlockerInfo[] => {
    const b: BlockerInfo[] = [];
    if (overdueTasks.length > 0) b.push({ label: "Overdue tasks", count: overdueTasks.length, severity: "urgent" });
    if (holdTasks.length > 0) b.push({ label: "Tasks on hold", count: holdTasks.length, severity: "warning" });
    if (needsApprovalTasks.length > 0) b.push({ label: "Pending approval", count: needsApprovalTasks.length, severity: "warning" });
    return b;
  }, [overdueTasks, holdTasks, needsApprovalTasks]);

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
    <div data-testid="eng-tasks-page" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
            <ListTodo className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold" data-testid="text-tasks-title">Task Board</h2>
            <p className="text-xs text-muted-foreground">
              {myTasksOnly ? `${myTasks.length} of your tasks` : `${tasks.length} tasks`} · {overdueTasks.length} overdue
            </p>
          </div>
          <ReplayWalkthrough screenId="eng-tasks" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Button
              variant={myTasksOnly ? "default" : "outline"}
              size="sm"
              className={`h-8 text-xs gap-1.5 ${myTasksOnly ? "bg-blue-600 hover:bg-blue-700" : ""}`}
              onClick={() => {
                if (!myName) {
                  setShowNamePicker(true);
                } else {
                  const next = !myTasksOnly;
                  setMyTasksOnly(next);
                  if (next) {
                    setAssigneeFilter(myName);
                  } else {
                    setAssigneeFilter("all");
                  }
                }
              }}
              data-testid="btn-my-tasks"
            >
              <UserCircle className="h-4 w-4" />
              {myName ? `${myName.split(" ")[0]}'s Tasks` : "My Tasks"}
              {myTasks.length > 0 && (
                <span className={`px-1.5 py-0 rounded-full text-[10px] font-bold ${myTasksOnly ? "bg-white/20" : "bg-blue-100 text-blue-700"}`}>
                  {myTasks.length}
                </span>
              )}
            </Button>
            {myTasksOnly && myName && (
              <button
                className="absolute -top-1 -right-1 w-4 h-4 bg-muted hover:bg-red-100 rounded-full flex items-center justify-center text-muted-foreground hover:text-red-600 text-[8px] border"
                onClick={(e) => { e.stopPropagation(); setMyTasksOnly(false); setAssigneeFilter("all"); }}
                title="Clear filter"
                data-testid="btn-clear-my-tasks"
              >
                ×
              </button>
            )}
          </div>
          <Dialog open={showNamePicker} onOpenChange={setShowNamePicker}>
            <DialogContent className="sm:max-w-[340px]">
              <DialogHeader>
                <DialogTitle className="text-base">Who are you?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">Select your name to see your personal tasks.</p>
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {uniqueAssignees.map(name => (
                  <button
                    key={name}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-muted transition-colors flex items-center gap-2 ${myName === name ? "bg-blue-50 text-blue-700 font-medium" : ""}`}
                    onClick={() => {
                      setMyName(name);
                      setSavedMyName(name);
                      setMyTasksOnly(true);
                      setAssigneeFilter(name);
                      setShowNamePicker(false);
                    }}
                    data-testid={`pick-name-${name}`}
                  >
                    <UserCircle className="h-4 w-4 text-muted-foreground" />
                    {name}
                  </button>
                ))}
              </div>
            </DialogContent>
          </Dialog>
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
                                value={proj.project_name}
                                onSelect={() => {
                                  setNewTask(p => ({ ...p, projectName: proj.project_name }));
                                  setProjectPickerOpen(false);
                                }}
                                data-testid={`option-project-${proj.id}`}
                              >
                                <Check className={`mr-2 h-4 w-4 ${newTask.projectName === proj.project_name ? "opacity-100" : "opacity-0"}`} />
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
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Assign To</Label>
                    <Select
                      value={newTask.assignees[0] || "none"}
                      onValueChange={v => setNewTask(p => ({ ...p, assignees: v === "none" ? [] : [v] }))}
                    >
                      <SelectTrigger data-testid="select-task-assignee"><SelectValue placeholder="Select assignee" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {pageTeamMembers.map(m => (
                          <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Approver</Label>
                    <Select
                      value={newTask.approverUserId ? String(newTask.approverUserId) : "none"}
                      onValueChange={v => setNewTask(p => ({ ...p, approverUserId: v === "none" ? null : parseInt(v) }))}
                    >
                      <SelectTrigger data-testid="select-task-approver"><SelectValue placeholder="Select approver" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No approver</SelectItem>
                        {pageTeamMembers.filter(m => ["COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER", "QUALITY_MANAGER", "CONSTRUCTION_MANAGER"].includes(m.role)).map(m => (
                          <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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

      {(myTasksOnly || viewMode === "mytasks") && (
        <PersonalKpiStrip tasks={tasks} myTasks={myTasks} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[150px] sm:min-w-[200px] max-w-xs">
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
          <SelectTrigger className="w-[130px] sm:w-[150px] h-8 text-xs" data-testid="filter-task-status">
            <Filter className="h-3 w-3 mr-1" /><SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {TASK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[110px] sm:w-[130px] h-8 text-xs" data-testid="filter-task-priority">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        {uniqueAssignees.length > 0 && (
          <Select value={assigneeFilter} onValueChange={(val) => {
            setAssigneeFilter(val);
            if (val === "all") {
              setMyTasksOnly(false);
            } else if (myName && val.toLowerCase() === myName.toLowerCase()) {
              setMyTasksOnly(true);
            } else {
              setMyTasksOnly(false);
            }
          }}>
            <SelectTrigger className="w-[120px] sm:w-[140px] h-8 text-xs" data-testid="filter-task-assignee">
              <User className="h-3 w-3 mr-1" /><SelectValue placeholder="Assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assignees</SelectItem>
              {uniqueAssignees.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      <MicroWalkthrough screenId="eng-tasks" steps={engWalkthroughSteps} />
      <ActionBar nextAction={engNextAction} blockers={engBlockers} />

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
        <>
        {(overdueTasks.length > 0 || holdTasks.length > 0 || needsApprovalTasks.length > 0) && (
          <div className="flex items-center gap-3 px-3 py-1.5 bg-muted/30 rounded-lg border text-xs" data-testid="board-summary-strip">
            {overdueTasks.length > 0 && (
              <button onClick={() => applyPreset(SAVED_FILTERS[0])} className="flex items-center gap-1 text-red-600 hover:text-red-700 font-medium transition-colors" data-testid="summary-overdue">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{overdueTasks.length} overdue</span>
              </button>
            )}
            {holdTasks.length > 0 && (
              <button onClick={() => applyPreset(SAVED_FILTERS[3])} className="flex items-center gap-1 text-amber-600 hover:text-amber-700 font-medium transition-colors" data-testid="summary-hold">
                <PauseCircle className="h-3.5 w-3.5" />
                <span>{holdTasks.length} on hold</span>
              </button>
            )}
            {needsApprovalTasks.length > 0 && (
              <button onClick={() => applyPreset(SAVED_FILTERS[1])} className="flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium transition-colors" data-testid="summary-approval">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>{needsApprovalTasks.length} need approval</span>
              </button>
            )}
            <span className="text-muted-foreground/50 ml-auto">{filtered.length} total</span>
          </div>
        )}
        <div className="flex gap-2.5 overflow-x-auto pb-4" style={{ minHeight: "400px" }}>
          {TASK_STATUSES.map(status => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={tasksByStatus[status] || []}
              onDrop={handleDrop}
              onCardClick={setSelectedTask}
              onStatusChange={handleStatusChange}
              onPriorityChange={handlePriorityChange}
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
        />
      ) : viewMode === "projects" ? (
        <ProjectKanbanView
          tasks={filtered}
          onCardClick={setSelectedTask}
          onDrop={handleDrop}
          onStatusChange={handleStatusChange}
          searchTerm={searchTerm}
        />
      ) : (
        <InlineListView
          tasks={filtered}
          onCardClick={setSelectedTask}
          onStatusChange={handleStatusChange}
          onPriorityChange={handlePriorityChange}
        />
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

      <Dialog open={!!holdDialog} onOpenChange={(open) => { if (!open) setHoldDialog(null); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PauseCircle className="h-5 w-5 text-amber-500" />
              Hold Reason Required
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">Please provide a reason for putting this task on hold.</p>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Blocked Type *</label>
              <Select value={holdDialog?.blockedType || ""} onValueChange={(v) => setHoldDialog(prev => prev ? { ...prev, blockedType: v } : null)}>
                <SelectTrigger className="h-9" data-testid="select-hold-blocked-type">
                  <SelectValue placeholder="Internal or External..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Internal">Internal</SelectItem>
                  <SelectItem value="External">External</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea
              value={holdDialog?.reason || ""}
              onChange={(e) => setHoldDialog(prev => prev ? { ...prev, reason: e.target.value } : null)}
              placeholder="e.g. Waiting for client approval, materials delayed..."
              className="min-h-[80px]"
              data-testid="input-hold-reason"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setHoldDialog(null)} data-testid="btn-hold-cancel">Cancel</Button>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700"
                disabled={!holdDialog?.reason?.trim() || !holdDialog?.blockedType}
                onClick={() => {
                  if (holdDialog && holdDialog.reason.trim() && holdDialog.blockedType) {
                    updateStatusMutation.mutate({ taskId: holdDialog.taskId, status: "HOLD", holdReason: holdDialog.reason.trim(), blockedType: holdDialog.blockedType });
                    setHoldDialog(null);
                  }
                }}
                data-testid="btn-hold-confirm"
              >
                Put on Hold
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
