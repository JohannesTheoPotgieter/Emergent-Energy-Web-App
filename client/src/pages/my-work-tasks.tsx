import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { format, isPast, parseISO } from "date-fns";
import TaskDetailDrawer from "@/components/mytool/TaskDetailDrawer";
import { TaskItem, TaskStatus, TaskPriority } from "@/components/mytool/TaskCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Plus, Loader2, Search, Trash2, ChevronDown, ChevronRight, ArrowUpDown, X,
  Inbox, Filter, Eye, Calendar, Building2, FolderOpen, AlertTriangle, ListTodo,
  ClipboardList, ShieldCheck, FileCheck, BookOpen, CheckCircle2, Circle, Clock,
  AlertCircle, Wrench, Users, User, LayoutList, Columns3, Link2, GripVertical,
} from "lucide-react";
import UserAssignmentPicker from "@/components/UserAssignmentPicker";

type SortField = "priority" | "dueDate" | "createdAt" | "status";
type SortDirection = "asc" | "desc";
type SourceFilter = "all" | "personal" | "operational" | "plan" | "engineering_task" | "quality_task" | "approvals" | "tr_register" | "deliverables" | "notifications";
type ViewMode = "list" | "board";

const priorityOrder: Record<string, number> = { critical: 0, high: 1, urgent: 0, High: 1, Med: 2, Low: 3, normal: 2, low: 3 };
const statusOrder: Record<string, number> = { in_progress: 0, "IN PROGRESS": 0, planned: 1, inbox: 2, "TO DO": 2, blocked: 3, BLOCKED: 3, waiting: 4, "ON HOLD": 4, done: 5, DONE: 5, COMPLETE: 5, cancelled: 6 };
const allStatuses: TaskStatus[] = ["inbox", "planned", "in_progress", "blocked", "waiting", "done", "cancelled"];
const allPriorities: TaskPriority[] = ["critical", "high", "normal", "low"];
const BOARD_COLUMNS: { key: TaskStatus; label: string; color: string; dotColor: string; headerBg: string }[] = [
  { key: "inbox", label: "To Do", color: "border-t-slate-400", dotColor: "bg-slate-400", headerBg: "bg-slate-50" },
  { key: "in_progress", label: "In Progress", color: "border-t-blue-500", dotColor: "bg-blue-500", headerBg: "bg-blue-50" },
  { key: "blocked", label: "Blocked", color: "border-t-red-500", dotColor: "bg-red-500", headerBg: "bg-red-50" },
  { key: "done", label: "Done", color: "border-t-emerald-500", dotColor: "bg-emerald-500", headerBg: "bg-emerald-50" },
];

function normalizeStatus(status: string): TaskStatus {
  const s = status?.toLowerCase().trim() || "inbox";
  if (s === "done" || s === "complete" || s === "completed") return "done";
  if (s === "in progress" || s === "in_progress") return "in_progress";
  if (s === "to do" || s === "todo" || s === "not started") return "inbox";
  if (s === "blocked") return "blocked";
  if (s === "on hold" || s === "waiting") return "waiting";
  if (s === "planned") return "planned";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "pending" || s === "review" || s === "active") return "in_progress";
  return "inbox";
}

function normalizePriority(priority: string): TaskPriority {
  const p = priority?.toLowerCase().trim() || "normal";
  if (p === "critical" || p === "urgent" || p === "p1") return "critical";
  if (p === "high" || p === "p2") return "high";
  if (p === "low" || p === "p4") return "low";
  return "normal";
}

interface ResolvedUser { id: number; name: string; username: string; role: string; }

interface UnifiedTask {
  _key: string;
  _source: SourceFilter;
  _sourceLabel: string;
  _sourceColor: string;
  _rawId: number;
  id: number;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  projectName: string | null;
  dueAt: string | null;
  createdAt: string | null;
  notes: string | null;
  subtaskCount?: number;
  parentTaskId?: number | null;
  percentComplete?: number;
  assignees?: string[] | null;
  resolvedAssignees?: ResolvedUser[] | null;
  description?: string | null;
  nextStep?: string | null;
  definitionOfDone?: string | null;
  blockedReason?: string | null;
  pinnedToday?: boolean;
  pinnedWeek?: boolean;
  isRecurring?: boolean;
  recurrenceFrequency?: string | null;
  sortOrder?: number;
  bucket?: string | null;
  sourceEmailId?: string | null;
  sourceEmailSubject?: string | null;
  completionNote?: string | null;
  plannedForDate?: string | null;
  department?: string | null;
  tag?: string | null;
  deliverableType?: string | null;
  deliverableStatus?: string | null;
  ragStatus?: string | null;
  owners?: string[] | null;
  resolvedOwners?: ResolvedUser[] | null;
  trId?: string | null;
}

const SOURCE_CONFIG: Record<SourceFilter, { label: string; icon: any; color: string; bgColor: string }> = {
  all: { label: "All", icon: ListTodo, color: "text-foreground", bgColor: "bg-muted" },
  personal: { label: "Personal", icon: ClipboardList, color: "text-blue-600", bgColor: "bg-blue-50 border-blue-200" },
  operational: { label: "Project Tasks", icon: Building2, color: "text-emerald-600", bgColor: "bg-emerald-50 border-emerald-200" },
  plan: { label: "Project Plan", icon: Calendar, color: "text-violet-600", bgColor: "bg-violet-50 border-violet-200" },
  engineering_task: { label: "Engineering", icon: Wrench, color: "text-cyan-600", bgColor: "bg-cyan-50 border-cyan-200" },
  quality_task: { label: "Quality", icon: ShieldCheck, color: "text-rose-600", bgColor: "bg-rose-50 border-rose-200" },
  approvals: { label: "Approvals", icon: ShieldCheck, color: "text-amber-600", bgColor: "bg-amber-50 border-amber-200" },
  tr_register: { label: "Actions", icon: BookOpen, color: "text-purple-600", bgColor: "bg-purple-50 border-purple-200" },
  deliverables: { label: "Deliverables", icon: FileCheck, color: "text-rose-600", bgColor: "bg-rose-50 border-rose-200" },
  notifications: { label: "Notifications", icon: AlertTriangle, color: "text-orange-600", bgColor: "bg-orange-50 border-orange-200" },
};

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

const DEPARTMENTS = ["Engineering", "Operations", "Finance", "Commercial", "Quality", "HSE", "Legal", "Project Development", "Construction", "Procurement"];

export default function MyWorkTasksPage() {
  const { toast } = useToast();
  const { user } = useAuth();

  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("priority");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [groomMode, setGroomMode] = useState(false);
  const [drawerTask, setDrawerTask] = useState<TaskItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unifiedDetailTask, setUnifiedDetailTask] = useState<UnifiedTask | null>(null);
  const [unifiedDetailOpen, setUnifiedDetailOpen] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set());
  const [subtaskDialog, setSubtaskDialog] = useState<{ parentId: number; projectName: string } | null>(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [newSubtaskPriority, setNewSubtaskPriority] = useState("Med");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [draggedTask, setDraggedTask] = useState<UnifiedTask | null>(null);
  const [dropTargetCol, setDropTargetCol] = useState<TaskStatus | null>(null);
  const [newTask, setNewTask] = useState({
    title: "", description: "", priority: "normal" as TaskPriority,
    status: "inbox" as TaskStatus, dueDate: "", projectName: "",
    department: "", ragStatus: "", type: "personal" as "personal" | "action",
    assignees: [] as string[],
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const { data: allTaskData, isLoading } = useQuery<any>({
    queryKey: ["/api/my-work/all-tasks"],
    queryFn: async () => {
      const res = await fetch("/api/my-work/all-tasks", { headers: { ...getAuthHeaders() }, credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return res.json();
    },
  });

  const { data: unreadNotifs = { items: [], total: 0 } } = useQuery<{ items: any[]; total: number }>({
    queryKey: ["/api/notifications", "unread-tasks"],
    queryFn: async () => {
      const res = await fetch("/api/notifications?unreadOnly=true&limit=50", { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return { items: [], total: 0 };
      return res.json();
    },
  });

  const { data: msActionItems = [] } = useQuery<any[]>({
    queryKey: ["/api/ms-objects/mine", "action_required_tasks"],
    queryFn: async () => {
      const res = await fetch("/api/ms-objects/mine?action_required=true", { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: rawProjectInfos = [] } = useQuery<any[]>({ queryKey: ["/api/project-info"] });

  const projectNames = useMemo(() =>
    rawProjectInfos.map((p: any) => p.projectName || p.project_name).filter(Boolean).sort(),
    [rawProjectInfos]
  );

  const unifiedTasks: UnifiedTask[] = useMemo(() => {
    if (!allTaskData) return [];
    const result: UnifiedTask[] = [];

    for (const t of (allTaskData.personal || [])) {
      result.push({
        _key: `personal-${t.id}`, _source: "personal", _sourceLabel: "Personal",
        _sourceColor: "bg-blue-50 border-blue-200 text-blue-700", _rawId: t.id, id: t.id,
        title: t.title || "", status: t.status || "inbox", priority: t.priority || "normal",
        projectName: t.projectName || t.project_name || null, dueAt: t.dueAt || t.due_at || null,
        createdAt: t.createdAt || t.created_at || null, notes: t.notes || null,
        nextStep: t.nextStep || t.next_step || null, definitionOfDone: t.definitionOfDone || t.definition_of_done || null,
        blockedReason: t.blockedReason || t.blocked_reason || null, pinnedToday: t.pinnedToday || t.pinned_today || false,
        pinnedWeek: t.pinnedWeek || t.pinned_week || false, isRecurring: t.isRecurring || t.is_recurring || false,
        recurrenceFrequency: t.recurrenceFrequency || t.recurrence_frequency || null,
        sortOrder: t.sortOrder || t.sort_order || 0, bucket: t.bucket || null,
        sourceEmailId: t.sourceEmailId || t.source_email_id || null,
        sourceEmailSubject: t.sourceEmailSubject || t.source_email_subject || null,
        completionNote: t.completionNote || t.completion_note || null,
        plannedForDate: t.plannedForDate || t.planned_for_date || null,
        department: t.department || null, tag: t.tag || null,
      });
    }

    for (const t of (allTaskData.operational || [])) {
      if (t.parentTaskId) continue;
      result.push({
        _key: `op-${t.id}`, _source: "operational", _sourceLabel: "Project",
        _sourceColor: "bg-emerald-50 border-emerald-200 text-emerald-700", _rawId: t.id, id: t.id,
        title: t.title || "", status: normalizeStatus(t.status), priority: normalizePriority(t.priority),
        projectName: t.projectName || t.project_name || null, dueAt: t.dueDate || t.due_date || null,
        createdAt: t.createdAt || t.created_at || null, notes: t.description || t.comment || null,
        subtaskCount: t.subtaskCount || 0, parentTaskId: t.parentTaskId || t.parent_task_id || null,
        percentComplete: t.percentComplete || t.percent_complete || 0, assignees: t.assignees || null,
        resolvedAssignees: t.resolvedAssignees || null, description: t.description || null,
      });
    }

    for (const a of (allTaskData.approvals?.engineering || [])) {
      result.push({
        _key: `approval-eng-${a.id}`, _source: "approvals", _sourceLabel: "Eng Approval",
        _sourceColor: "bg-amber-50 border-amber-200 text-amber-700", _rawId: a.id, id: a.id,
        title: a.title || "", status: normalizeStatus(a.status), priority: "high",
        projectName: a.projectName || null, dueAt: null, createdAt: a.createdAt || null, notes: null,
      });
    }
    for (const a of (allTaskData.approvals?.quality || [])) {
      result.push({
        _key: `approval-qc-${a.id}`, _source: "approvals", _sourceLabel: "QC Review",
        _sourceColor: "bg-amber-50 border-amber-200 text-amber-700", _rawId: a.id, id: a.id,
        title: a.title || "", status: normalizeStatus(a.status), priority: "high",
        projectName: a.projectName || null, dueAt: null, createdAt: a.createdAt || null, notes: null,
      });
    }

    for (const t of (allTaskData.trRegister || [])) {
      result.push({
        _key: `tr-${t.id}`, _source: "tr_register", _sourceLabel: "Action",
        _sourceColor: "bg-purple-50 border-purple-200 text-purple-700", _rawId: t.id, id: t.id,
        title: t.actionDescription || "", status: normalizeStatus(t.status),
        priority: t.ragStatus === "Red" ? "critical" : t.ragStatus === "Amber" ? "high" : "normal",
        projectName: null, dueAt: t.dueDate || t.due_date || null,
        createdAt: t.createdAt || t.created_at || null, notes: t.outcomeComments || t.supportingInfo || null,
        ragStatus: t.ragStatus || null, owners: t.owners || null, resolvedOwners: t.resolvedOwners || null,
        trId: t.trId || null, department: t.department || null,
      });
    }

    for (const d of (allTaskData.deliverables || [])) {
      result.push({
        _key: `del-${d.id}`, _source: "deliverables", _sourceLabel: "Deliverable",
        _sourceColor: "bg-rose-50 border-rose-200 text-rose-700", _rawId: d.id, id: d.id,
        title: d.title || "", status: normalizeStatus(d.status), priority: "normal",
        projectName: d.projectName || d.project_name || null, dueAt: null,
        createdAt: d.createdAt || d.created_at || null, notes: null,
        deliverableType: d.deliverableType || d.deliverable_type || null, deliverableStatus: d.status || null,
      });
    }

    for (const t of (allTaskData.planTasks || [])) {
      result.push({
        _key: `plan-${t.id}`, _source: "plan", _sourceLabel: "Project Plan",
        _sourceColor: "bg-violet-50 border-violet-200 text-violet-700", _rawId: t.id, id: t.id,
        title: t.title || "", status: normalizeStatus(t.status), priority: "normal",
        projectName: t.projectName || null, dueAt: t.endDate || null, createdAt: null,
        notes: t.phase ? `Phase: ${t.phase}` : null,
        percentComplete: t.pctComplete ? Math.round(t.pctComplete * 100) : 0,
        assignees: t.owner ? [t.owner] : null, resolvedAssignees: t.resolvedAssignee ? [t.resolvedAssignee] : null,
      });
    }

    for (const t of (allTaskData.engineeringTasks || [])) {
      result.push({
        _key: `eng-${t.id}`, _source: "engineering_task", _sourceLabel: "Engineering",
        _sourceColor: "bg-cyan-50 border-cyan-200 text-cyan-700", _rawId: t.id, id: t.id,
        title: t.title || "", status: normalizeStatus(t.status), priority: "normal",
        projectName: t.projectName || null, dueAt: null, createdAt: null,
        notes: t.lifecyclePhase ? `Phase: ${t.lifecyclePhase}` : null,
        assignees: t.assigneeName ? [t.assigneeName] : null, resolvedAssignees: t.resolvedAssignee ? [t.resolvedAssignee] : null,
      });
    }

    for (const t of (allTaskData.qualityTasks || [])) {
      result.push({
        _key: `qc-${t.id}`, _source: "quality_task", _sourceLabel: "Quality",
        _sourceColor: "bg-rose-50 border-rose-200 text-rose-700", _rawId: t.id, id: t.id,
        title: t.title || "", status: normalizeStatus(t.status), priority: "normal",
        projectName: t.projectName || null, dueAt: t.endDate || null, createdAt: null, notes: null,
        resolvedAssignees: t.resolvedAssignee ? [t.resolvedAssignee] : null,
      });
    }

    for (const n of (unreadNotifs.items || [])) {
      result.push({
        _key: `notif-${n.id}`, _source: "notifications", _sourceLabel: "Notification",
        _sourceColor: "bg-orange-50 border-orange-200 text-orange-700", _rawId: n.id, id: n.id,
        title: n.title || "", status: "inbox" as TaskStatus,
        priority: n.eventType === "excel_sync_confirmation" ? "normal" : "high",
        projectName: n.projectName || n.project_name || null, dueAt: null,
        createdAt: n.createdAt || n.created_at || null, notes: n.body || null,
      });
    }

    for (const item of msActionItems) {
      result.push({
        _key: `ms-${item.id}`, _source: "notifications", _sourceLabel: "MS 365",
        _sourceColor: "bg-indigo-50 border-indigo-200 text-indigo-700", _rawId: item.id, id: item.id,
        title: item.subjectOrTitle || item.subject_or_title || "", status: "inbox" as TaskStatus, priority: "normal",
        projectName: null, dueAt: null,
        createdAt: item.receivedOrStartDatetime || item.received_or_start_datetime || null, notes: item.preview || null,
      });
    }

    return result;
  }, [allTaskData, unreadNotifs, msActionItems]);

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-work/all-tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/mytool/tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications", "unread-tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ms-objects/mine", "action_required_tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tr-register"] });
  }, []);

  const createTaskMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await apiRequest("POST", "/api/mytool/tasks", body);
    },
    onSuccess: () => { invalidateAll(); toast({ title: "Task created" }); },
    onError: () => { toast({ title: "Failed to create task", variant: "destructive" }); },
  });

  const createTrItemMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/tr-register", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create action item");
      return res.json();
    },
    onSuccess: () => { invalidateAll(); toast({ title: "Action item created" }); },
    onError: () => { toast({ title: "Failed to create action item", variant: "destructive" }); },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, ...body }: Record<string, unknown> & { id: number }) => {
      await apiRequest("PATCH", `/api/mytool/tasks/${id}`, body);
    },
    onSuccess: () => invalidateAll(),
    onError: () => { toast({ title: "Failed to update", variant: "destructive" }); },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/mytool/tasks/${id}`); },
    onSuccess: () => invalidateAll(),
    onError: () => { toast({ title: "Failed to delete", variant: "destructive" }); },
  });

  const createSubtaskMutation = useMutation({
    mutationFn: async ({ parentId, title, priority }: { parentId: number; title: string; priority: string }) => {
      const res = await fetch(`/api/eng/tasks/${parentId}/subtasks`, {
        method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include", body: JSON.stringify({ title, priority, status: "TO DO" }),
      });
      if (!res.ok) throw new Error("Failed to create subtask");
      return res.json();
    },
    onSuccess: () => { invalidateAll(); setSubtaskDialog(null); setNewSubtaskTitle(""); setNewSubtaskPriority("Med"); toast({ title: "Subtask created" }); },
    onError: () => { toast({ title: "Failed to create subtask", variant: "destructive" }); },
  });

  const boardStatusMutation = useMutation({
    mutationFn: async ({ task, newStatus }: { task: UnifiedTask; newStatus: string }) => {
      if (task._source === "personal") {
        await apiRequest("PATCH", `/api/mytool/tasks/${task._rawId}`, { status: newStatus });
      } else if (task._source === "tr_register") {
        const trStatus = newStatus === "done" ? "Completed" : "Active";
        const endpoint = newStatus === "done" ? `/api/tr-register/${task._rawId}/complete` : `/api/tr-register/${task._rawId}`;
        const res = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify(newStatus === "done" ? {} : { status: trStatus }) });
        if (!res.ok) throw new Error("Failed to update");
      } else if (task._source === "operational") {
        const res = await fetch(`/api/operational-tasks/${task._rawId}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ status: newStatus }) });
        if (!res.ok) throw new Error("Failed to update");
      } else if (task._source === "engineering_task") {
        const engStatus = newStatus === "done" ? "DONE" : newStatus === "in_progress" ? "IN PROGRESS" : newStatus === "blocked" ? "BLOCKED" : "TO DO";
        const res = await fetch(`/api/task-checklist-items/${task._rawId}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ status: engStatus }) });
        if (!res.ok) throw new Error("Failed to update");
      }
    },
    onSuccess: () => { invalidateAll(); toast({ title: "Status updated" }); },
    onError: () => { toast({ title: "Failed to update status", variant: "destructive" }); },
  });

  const handleCreateTask = useCallback(() => {
    if (!newTask.title.trim()) return;
    if (newTask.type === "action") {
      createTrItemMutation.mutate({
        actionDescription: newTask.title.trim(),
        department: newTask.department || "Engineering",
        ragStatus: newTask.ragStatus || "Green",
        dueDate: newTask.dueDate || null,
        owners: newTask.assignees.length > 0 ? newTask.assignees : (user?.name ? [user.name] : []),
        status: "Active",
        supportingInfo: newTask.description || "",
      });
    } else {
      createTaskMutation.mutate({
        title: newTask.title.trim(),
        priority: newTask.priority,
        status: newTask.status,
        dueAt: newTask.dueDate || null,
        projectName: newTask.projectName || null,
        department: newTask.department || null,
        notes: newTask.description || null,
      });
    }
    setNewTask({ title: "", description: "", priority: "normal", status: "inbox", dueDate: "", projectName: "", department: "", ragStatus: "", type: "personal", assignees: [] });
    setCreateDialogOpen(false);
  }, [newTask, createTaskMutation, createTrItemMutation, user]);

  const handleStatusChange = useCallback((id: number, status: TaskStatus) => {
    updateTaskMutation.mutate({ id, status });
  }, [updateTaskMutation]);

  const handleOpenDrawer = useCallback((task: UnifiedTask) => {
    if (task._source === "personal") {
      setDrawerTask({
        id: task.id, title: task.title, status: task.status, priority: task.priority,
        plannedForDate: task.plannedForDate || null, dueAt: task.dueAt || null,
        sortOrder: task.sortOrder || 0, projectName: task.projectName || null,
        department: task.department || null, tag: task.tag || null,
        blockedReason: task.blockedReason || null, nextStep: task.nextStep || null,
        definitionOfDone: task.definitionOfDone || null,
        pinnedToday: task.pinnedToday || false, pinnedWeek: task.pinnedWeek || false,
        isRecurring: task.isRecurring || false, recurrenceFrequency: task.recurrenceFrequency || null,
        notes: task.notes || null, completionNote: task.completionNote || null,
        createdAt: task.createdAt || null, bucket: task.bucket || null,
        sourceEmailId: task.sourceEmailId || null, sourceEmailSubject: task.sourceEmailSubject || null,
      });
      setDrawerOpen(true);
    } else {
      setUnifiedDetailTask(task);
      setUnifiedDetailOpen(true);
    }
  }, []);

  const allProjects = useMemo(() => {
    const set = new Set<string>();
    unifiedTasks.forEach(t => { if (t.projectName) set.add(t.projectName); });
    projectNames.forEach((p: string) => set.add(p));
    return Array.from(set).sort();
  }, [unifiedTasks, projectNames]);

  const isTaskOverdue = useCallback((task: UnifiedTask) => {
    if (!task.dueAt || task.status === "done" || task.status === "cancelled") return false;
    try { return isPast(parseISO(task.dueAt)); } catch { return false; }
  }, []);

  const filteredTasks = useMemo(() => {
    let result = [...unifiedTasks];
    if (sourceFilter !== "all") result = result.filter(t => t._source === sourceFilter);
    if (debouncedSearch.trim()) {
      const lower = debouncedSearch.toLowerCase();
      result = result.filter(t =>
        t.title.toLowerCase().includes(lower) || (t.projectName && t.projectName.toLowerCase().includes(lower)) ||
        (t.notes && t.notes.toLowerCase().includes(lower)) || (t.trId && t.trId.toLowerCase().includes(lower))
      );
    }
    if (statusFilter.length > 0) result = result.filter(t => statusFilter.includes(t.status));
    if (priorityFilter.length > 0) result = result.filter(t => priorityFilter.includes(t.priority));
    if (projectFilter) result = result.filter(t => t.projectName === projectFilter);
    if (overdueOnly) result = result.filter(t => isTaskOverdue(t));
    if (groomMode) result = result.filter(t => t.status !== "done" && t.status !== "cancelled" && (!t.nextStep || !t.nextStep.trim() || !t.definitionOfDone || !t.definitionOfDone.trim()));

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "priority": cmp = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2); if (cmp === 0) cmp = (a.dueAt || "9999").localeCompare(b.dueAt || "9999"); break;
        case "status": cmp = (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2); break;
        case "dueDate": cmp = (a.dueAt || "9999").localeCompare(b.dueAt || "9999"); break;
        case "createdAt": cmp = (b.createdAt || "").localeCompare(a.createdAt || ""); break;
      }
      return sortDirection === "desc" ? -cmp : cmp;
    });
    return result;
  }, [unifiedTasks, sourceFilter, debouncedSearch, statusFilter, priorityFilter, projectFilter, overdueOnly, groomMode, sortField, sortDirection, isTaskOverdue]);

  const toggleStatus = (s: TaskStatus) => setStatusFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  const togglePriority = (p: TaskPriority) => setPriorityFilter(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  const handleSort = (field: SortField) => { if (sortField === field) setSortDirection(prev => prev === "asc" ? "desc" : "asc"); else { setSortField(field); setSortDirection("asc"); } };
  const toggleExpand = (taskId: number) => setExpandedTasks(prev => { const next = new Set(prev); if (next.has(taskId)) next.delete(taskId); else next.add(taskId); return next; });

  const sourceCounts = useMemo(() => {
    const counts: Record<SourceFilter, number> = { all: 0, personal: 0, operational: 0, plan: 0, engineering_task: 0, quality_task: 0, approvals: 0, tr_register: 0, deliverables: 0, notifications: 0 };
    for (const t of unifiedTasks) { if (counts[t._source] !== undefined) counts[t._source]++; }
    counts.all = unifiedTasks.length;
    return counts;
  }, [unifiedTasks]);

  const kpiStats = useMemo(() => {
    const active = unifiedTasks.filter(t => t.status !== "done" && t.status !== "cancelled");
    const overdue = active.filter(t => isTaskOverdue(t));
    const critical = active.filter(t => t.priority === "critical" || t.priority === "high");
    const done = unifiedTasks.filter(t => t.status === "done");
    return { total: unifiedTasks.length, active: active.length, overdue: overdue.length, critical: critical.length, done: done.length };
  }, [unifiedTasks, isTaskOverdue]);

  const activeFilters = statusFilter.length + priorityFilter.length + (projectFilter ? 1 : 0) + (overdueOnly ? 1 : 0);

  const handleBoardDragStart = useCallback((e: React.DragEvent, task: UnifiedTask) => {
    const canDrag = ["personal", "operational", "engineering_task", "tr_register"].includes(task._source);
    if (!canDrag) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task._key);
    setDraggedTask(task);
  }, []);

  const handleBoardDragOver = useCallback((e: React.DragEvent, colKey: TaskStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetCol(colKey);
  }, []);

  const handleBoardDrop = useCallback((e: React.DragEvent, colKey: TaskStatus) => {
    e.preventDefault();
    setDropTargetCol(null);
    if (!draggedTask) return;
    if (normalizeStatus(draggedTask.status) === colKey) { setDraggedTask(null); return; }
    const newStatus = colKey === "inbox" ? "inbox" : colKey;
    boardStatusMutation.mutate({ task: draggedTask, newStatus });
    setDraggedTask(null);
  }, [draggedTask, boardStatusMutation]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 flex-1" data-testid="loading-skeleton">
        <div className="flex items-center gap-3">{[1, 2, 3, 4, 5].map(i => (<Skeleton key={i} className="h-8 w-24 rounded-full" />))}</div>
        <div className="space-y-2">{[1, 2, 3, 4, 5, 6, 7, 8].map(i => (<Skeleton key={i} className="h-14 w-full rounded-lg" />))}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1 max-w-6xl mx-auto w-full" data-testid="my-work-tasks-page">
      <div className="shrink-0 flex items-center justify-between mb-4" data-testid="tasks-header">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold tracking-tight text-foreground" data-testid="text-tasks-title">My Tasks</h2>
          <Badge variant="secondary" className="text-xs tabular-nums font-semibold" data-testid="badge-total-count">{filteredTasks.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center border rounded-lg overflow-hidden shadow-sm">
            <button onClick={() => setViewMode("list")} className={`p-1.5 transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`} data-testid="btn-view-list" title="List view"><LayoutList className="h-4 w-4" /></button>
            <button onClick={() => setViewMode("board")} className={`p-1.5 transition-colors ${viewMode === "board" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`} data-testid="btn-view-board" title="Board view"><Columns3 className="h-4 w-4" /></button>
          </div>
          <Button variant={groomMode ? "default" : "outline"} size="sm" className={`h-8 text-xs ${groomMode ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}`} onClick={() => setGroomMode(!groomMode)} data-testid="button-groom-mode"><Eye className="h-3 w-3 mr-1" /> Groom</Button>
          <Button variant={showFilters ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setShowFilters(!showFilters)} data-testid="button-toggle-filters">
            <Filter className="h-3 w-3 mr-1" /> Filters {activeFilters > 0 && <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1">{activeFilters}</Badge>}
          </Button>
          <Button size="sm" className="h-8 gap-1 shadow-sm" onClick={() => setCreateDialogOpen(true)} data-testid="button-new-task"><Plus className="h-4 w-4" /> New Task</Button>
        </div>
      </div>

      <div className="shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200/60 shadow-sm"><CardContent className="p-3 flex items-center gap-3"><div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center shadow-inner"><ListTodo className="h-4 w-4 text-blue-600" /></div><div><p className="text-[10px] text-blue-600/80 uppercase tracking-wider font-medium">Active</p><p className="text-lg font-bold tabular-nums text-blue-900" data-testid="kpi-active">{kpiStats.active}</p></div></CardContent></Card>
        <Card className={`bg-gradient-to-br from-red-50 to-red-100/50 border-red-200/60 shadow-sm ${kpiStats.overdue > 0 ? "ring-1 ring-red-300" : ""}`}><CardContent className="p-3 flex items-center gap-3 cursor-pointer" onClick={() => { setOverdueOnly(!overdueOnly); setShowFilters(false); }}><div className="h-9 w-9 rounded-lg bg-red-100 flex items-center justify-center shadow-inner"><AlertCircle className="h-4 w-4 text-red-600" /></div><div><p className="text-[10px] text-red-600/80 uppercase tracking-wider font-medium">Overdue</p><p className="text-lg font-bold tabular-nums text-red-700" data-testid="kpi-overdue">{kpiStats.overdue}</p></div></CardContent></Card>
        <Card className="bg-gradient-to-br from-amber-50 to-amber-100/50 border-amber-200/60 shadow-sm"><CardContent className="p-3 flex items-center gap-3"><div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center shadow-inner"><AlertTriangle className="h-4 w-4 text-amber-600" /></div><div><p className="text-[10px] text-amber-600/80 uppercase tracking-wider font-medium">High Priority</p><p className="text-lg font-bold tabular-nums text-amber-900" data-testid="kpi-critical">{kpiStats.critical}</p></div></CardContent></Card>
        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 border-emerald-200/60 shadow-sm"><CardContent className="p-3 flex items-center gap-3"><div className="h-9 w-9 rounded-lg bg-emerald-100 flex items-center justify-center shadow-inner"><CheckCircle2 className="h-4 w-4 text-emerald-600" /></div><div><p className="text-[10px] text-emerald-600/80 uppercase tracking-wider font-medium">Completed</p><p className="text-lg font-bold tabular-nums text-emerald-900" data-testid="kpi-done">{kpiStats.done}</p></div></CardContent></Card>
      </div>

      <div className="shrink-0 flex items-center gap-1.5 flex-wrap mb-3" data-testid="source-filter-tabs">
        {(Object.keys(SOURCE_CONFIG) as SourceFilter[]).map(src => {
          const config = SOURCE_CONFIG[src]; const Icon = config.icon; const count = sourceCounts[src]; const active = sourceFilter === src;
          return (
            <button key={src} onClick={() => setSourceFilter(src)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${active ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-background text-muted-foreground border-border/50 hover:bg-muted hover:border-border"}`} data-testid={`tab-source-${src}`}>
              <Icon className="h-3.5 w-3.5" /> {config.label} <span className={`text-[10px] ${active ? "opacity-80" : "opacity-60"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="shrink-0 flex items-center gap-2 mb-2" data-testid="search-bar">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search tasks, projects, action items..." value={searchText} onChange={e => setSearchText(e.target.value)} className="pl-9 text-sm h-9" data-testid="input-task-search" />
          {searchText && <button onClick={() => setSearchText("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
        </div>
        {overdueOnly && (
          <Badge variant="destructive" className="cursor-pointer gap-1 text-xs" onClick={() => setOverdueOnly(false)} data-testid="badge-overdue-filter">
            <AlertCircle className="h-3 w-3" /> Overdue <X className="h-3 w-3 ml-1" />
          </Badge>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="text-[10px] uppercase tracking-wider font-medium">Sort:</span>
          {(["priority", "dueDate", "status"] as SortField[]).map(field => (
            <button key={field} onClick={() => handleSort(field)} className={`flex items-center gap-0.5 px-2 py-1 rounded transition-colors ${sortField === field ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"}`} data-testid={`sort-${field}`}>
              {field === "priority" ? "Priority" : field === "dueDate" ? "Due" : "Status"} {sortField === field && <ArrowUpDown className="h-3 w-3" />}
            </button>
          ))}
        </div>
      </div>

      {showFilters && (
        <div className="shrink-0 flex flex-wrap items-end gap-3 p-3 rounded-lg border border-border/50 bg-muted/20 mb-2" data-testid="filter-bar">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Status</label>
            <div className="flex gap-1">{allStatuses.map(s => { const isActive = statusFilter.includes(s); return (<button key={s} onClick={() => toggleStatus(s)} className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${isActive ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/50 text-muted-foreground hover:border-border"}`} data-testid={`filter-status-${s}`}>{s.replace("_", " ")}</button>); })}</div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Priority</label>
            <div className="flex gap-1">{allPriorities.map(p => { const isActive = priorityFilter.includes(p); return (<button key={p} onClick={() => togglePriority(p)} className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${isActive ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/50 text-muted-foreground hover:border-border"}`} data-testid={`filter-priority-${p}`}>{p === "critical" ? "P1" : p === "high" ? "P2" : p === "normal" ? "P3" : "P4"}</button>); })}</div>
          </div>
          {allProjects.length > 0 && (
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1"><FolderOpen className="h-3 w-3" /> Project</label>
              <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="text-xs border border-border rounded-md px-2 py-1.5 bg-background h-7" data-testid="select-project-filter">
                <option value="">All Projects</option>
                {allProjects.map(p => (<option key={p} value={p}>{p.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</option>))}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Overdue</label>
            <button onClick={() => setOverdueOnly(!overdueOnly)} className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${overdueOnly ? "bg-red-500 text-white border-red-500" : "bg-background border-border/50 text-muted-foreground hover:border-border"}`} data-testid="filter-overdue-toggle">
              {overdueOnly ? "Showing Overdue" : "Show Overdue"}
            </button>
          </div>
          {activeFilters > 0 && (<Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => { setStatusFilter([]); setPriorityFilter([]); setProjectFilter(""); setOverdueOnly(false); }} data-testid="button-clear-all-filters">Clear all</Button>)}
        </div>
      )}

      {viewMode === "list" ? (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1" data-testid="task-list">
          {filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Inbox className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm font-medium">No tasks found</p>
              <p className="text-xs mt-1 opacity-70">{overdueOnly ? "No overdue tasks — nice work!" : sourceFilter !== "all" ? "Try switching to 'All' to see all your tasks" : "Click '+ New Task' to get started."}</p>
            </div>
          ) : (
            filteredTasks.map(task => (
              <TaskRow key={task._key} task={task} isExpanded={expandedTasks.has(task.id)} onToggleExpand={() => task._source === "operational" && task.subtaskCount! > 0 && toggleExpand(task.id)} onOpenDrawer={() => handleOpenDrawer(task)} onStatusChange={handleStatusChange} onDelete={task._source === "personal" ? () => deleteTaskMutation.mutate(task.id) : undefined} onAddSubtask={task._source === "operational" ? () => setSubtaskDialog({ parentId: task.id, projectName: task.projectName || "" }) : undefined} allTaskData={allTaskData} onSubtaskAddForChild={(parentId: number, projectName: string) => setSubtaskDialog({ parentId, projectName })} isOverdue={isTaskOverdue(task)} />
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-x-auto">
          <div className="grid grid-cols-4 gap-3 h-full min-w-[800px]">
            {BOARD_COLUMNS.map(col => {
              const colTasks = filteredTasks.filter(t => {
                if (col.key === "inbox") return t.status === "inbox" || t.status === "planned";
                if (col.key === "done") return t.status === "done" || t.status === "cancelled";
                return t.status === col.key;
              });
              const isDropTarget = dropTargetCol === col.key;
              return (
                <div
                  key={col.key}
                  className={`flex flex-col min-h-0 rounded-xl border-2 bg-muted/10 border-t-4 ${col.color} transition-all ${isDropTarget ? "border-primary/50 bg-primary/5 shadow-md" : "border-transparent"}`}
                  onDragOver={(e) => handleBoardDragOver(e, col.key)}
                  onDragLeave={() => setDropTargetCol(null)}
                  onDrop={(e) => handleBoardDrop(e, col.key)}
                  data-testid={`board-col-${col.key}`}
                >
                  <div className={`shrink-0 px-3 py-2.5 flex items-center justify-between rounded-t-lg ${col.headerBg}`}>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${col.dotColor}`} />
                      <span className="text-xs font-semibold">{col.label}</span>
                    </div>
                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-semibold">{colTasks.length}</Badge>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 pt-1 space-y-1.5">
                    {colTasks.map(task => {
                      const canDrag = ["personal", "operational", "engineering_task", "tr_register"].includes(task._source);
                      return (
                        <div
                          key={task._key}
                          draggable={canDrag}
                          onDragStart={(e) => handleBoardDragStart(e, task)}
                          onClick={() => handleOpenDrawer(task)}
                          className={`bg-background rounded-lg border p-2.5 transition-all hover:shadow-md hover:border-primary/30 ${canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${draggedTask?._key === task._key ? "opacity-40" : ""}`}
                          data-testid={`board-card-${task._key}`}
                        >
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${task.priority === "critical" ? "text-red-600 bg-red-50" : task.priority === "high" ? "text-orange-600 bg-orange-50" : task.priority === "low" ? "text-slate-400 bg-slate-50" : "text-blue-600 bg-blue-50"}`}>
                              {task.priority === "critical" ? "P1" : task.priority === "high" ? "P2" : task.priority === "low" ? "P4" : "P3"}
                            </span>
                            <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${task._sourceColor}`}>{task._sourceLabel}</span>
                            {task.ragStatus && <span className={`w-2 h-2 rounded-full shrink-0 ${task.ragStatus === "Red" ? "bg-red-500" : task.ragStatus === "Amber" ? "bg-amber-500" : "bg-green-500"}`} />}
                          </div>
                          <p className="text-xs font-medium leading-snug line-clamp-2 mb-1.5">{task.title}</p>
                          <div className="flex items-center justify-between">
                            {task.projectName && <span className="text-[9px] text-muted-foreground truncate max-w-[120px]">{task.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</span>}
                            {task.dueAt && <span className={`text-[9px] ${isTaskOverdue(task) ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>{(() => { try { return format(new Date(task.dueAt), "dd MMM"); } catch { return ""; } })()}</span>}
                          </div>
                          {task.percentComplete !== undefined && task.percentComplete > 0 && (
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${task.percentComplete}%` }} /></div>
                              <span className="text-[9px] text-muted-foreground">{task.percentComplete}%</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {drawerOpen && drawerTask && (<TaskDetailDrawer task={drawerTask} open={drawerOpen} onOpenChange={(open) => setDrawerOpen(open)} onInvalidate={invalidateAll} />)}
      {unifiedDetailOpen && unifiedDetailTask && (<UnifiedTaskDetailSheet task={unifiedDetailTask} open={unifiedDetailOpen} onOpenChange={setUnifiedDetailOpen} onInvalidate={invalidateAll} allProjects={allProjects} />)}

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> New Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="flex gap-2">
              <button onClick={() => setNewTask(t => ({ ...t, type: "personal" }))} className={`flex-1 px-3 py-2.5 rounded-lg border text-xs font-medium transition-all ${newTask.type === "personal" ? "bg-blue-50 border-blue-300 text-blue-700 shadow-sm" : "border-border text-muted-foreground hover:bg-muted"}`} data-testid="btn-type-personal">
                <ClipboardList className="h-4 w-4 mx-auto mb-1" /> Personal Task
              </button>
              <button onClick={() => setNewTask(t => ({ ...t, type: "action" }))} className={`flex-1 px-3 py-2.5 rounded-lg border text-xs font-medium transition-all ${newTask.type === "action" ? "bg-purple-50 border-purple-300 text-purple-700 shadow-sm" : "border-border text-muted-foreground hover:bg-muted"}`} data-testid="btn-type-action">
                <BookOpen className="h-4 w-4 mx-auto mb-1" /> Action Item
              </button>
            </div>
            <div>
              <Label className="text-xs font-medium">Title <span className="text-red-500">*</span></Label>
              <Input placeholder={newTask.type === "action" ? "Describe the action..." : "What needs to be done?"} value={newTask.title} onChange={e => setNewTask(t => ({ ...t, title: e.target.value }))} className="mt-1" data-testid="input-new-title" autoFocus />
            </div>
            <div>
              <Label className="text-xs font-medium">Description</Label>
              <Textarea placeholder="Additional details..." value={newTask.description} onChange={e => setNewTask(t => ({ ...t, description: e.target.value }))} className="mt-1 min-h-[60px]" data-testid="input-new-desc" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium">Priority</Label>
                <Select value={newTask.priority} onValueChange={v => setNewTask(t => ({ ...t, priority: v as TaskPriority }))}>
                  <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-new-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">P1 — Critical</SelectItem>
                    <SelectItem value="high">P2 — High</SelectItem>
                    <SelectItem value="normal">P3 — Normal</SelectItem>
                    <SelectItem value="low">P4 — Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-medium">Due Date</Label>
                <Input type="date" value={newTask.dueDate} onChange={e => setNewTask(t => ({ ...t, dueDate: e.target.value }))} className="mt-1 h-8 text-xs" data-testid="input-new-due" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium">Link to Project</Label>
                <Select value={newTask.projectName} onValueChange={v => setNewTask(t => ({ ...t, projectName: v === "__none" ? "" : v }))}>
                  <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-new-project"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {allProjects.map(p => (<SelectItem key={p} value={p}>{p.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-medium">Department</Label>
                <Select value={newTask.department} onValueChange={v => setNewTask(t => ({ ...t, department: v === "__none" ? "" : v }))}>
                  <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-new-dept"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {DEPARTMENTS.map(d => (<SelectItem key={d} value={d}>{d}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {newTask.type === "action" && (
              <div>
                <Label className="text-xs font-medium">RAG Status</Label>
                <div className="flex gap-2 mt-1">
                  {["Green", "Amber", "Red"].map(rag => (
                    <button key={rag} onClick={() => setNewTask(t => ({ ...t, ragStatus: rag }))} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${newTask.ragStatus === rag ? (rag === "Red" ? "bg-red-50 border-red-300 text-red-700" : rag === "Amber" ? "bg-amber-50 border-amber-300 text-amber-700" : "bg-emerald-50 border-emerald-300 text-emerald-700") : "border-border text-muted-foreground hover:bg-muted"}`} data-testid={`btn-rag-${rag.toLowerCase()}`}>
                      <span className={`w-2.5 h-2.5 rounded-full ${rag === "Red" ? "bg-red-500" : rag === "Amber" ? "bg-amber-500" : "bg-emerald-500"}`} /> {rag}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateDialogOpen(false)} data-testid="button-cancel-create">Cancel</Button>
            <Button size="sm" onClick={handleCreateTask} disabled={!newTask.title.trim() || createTaskMutation.isPending || createTrItemMutation.isPending} data-testid="button-submit-create">
              {(createTaskMutation.isPending || createTrItemMutation.isPending) ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!subtaskDialog} onOpenChange={(open) => { if (!open) setSubtaskDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Subtask</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><label className="text-xs font-medium text-muted-foreground">Title</label><Input placeholder="Subtask title..." value={newSubtaskTitle} onChange={e => setNewSubtaskTitle(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && newSubtaskTitle.trim() && subtaskDialog) createSubtaskMutation.mutate({ parentId: subtaskDialog.parentId, title: newSubtaskTitle.trim(), priority: newSubtaskPriority }); }} data-testid="input-subtask-title" /></div>
            <div><label className="text-xs font-medium text-muted-foreground">Priority</label><Select value={newSubtaskPriority} onValueChange={setNewSubtaskPriority}><SelectTrigger className="h-8 text-xs" data-testid="select-subtask-priority"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="High">High</SelectItem><SelectItem value="Med">Medium</SelectItem><SelectItem value="Low">Low</SelectItem></SelectContent></Select></div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSubtaskDialog(null)} data-testid="button-cancel-subtask">Cancel</Button>
            <Button size="sm" onClick={() => { if (newSubtaskTitle.trim() && subtaskDialog) createSubtaskMutation.mutate({ parentId: subtaskDialog.parentId, title: newSubtaskTitle.trim(), priority: newSubtaskPriority }); }} disabled={!newSubtaskTitle.trim() || createSubtaskMutation.isPending} data-testid="button-create-subtask">{createSubtaskMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />} Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UnifiedTaskDetailSheet({ task, open, onOpenChange, onInvalidate, allProjects }: { task: UnifiedTask; open: boolean; onOpenChange: (open: boolean) => void; onInvalidate: () => void; allProjects: string[] }) {
  const { toast } = useToast();
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState(task.notes || "");

  const statusLabel = task.status === "done" ? "Done" : task.status === "in_progress" ? "In Progress" : task.status === "blocked" ? "Blocked" : task.status === "waiting" ? "Waiting" : task.status === "cancelled" ? "Cancelled" : task.status === "inbox" ? "To Do" : task.status === "planned" ? "Planned" : task.status;
  const priorityLabel = task.priority === "critical" ? "P1 — Critical" : task.priority === "high" ? "P2 — High" : task.priority === "low" ? "P4 — Low" : "P3 — Normal";
  const priorityColor = task.priority === "critical" ? "text-red-600" : task.priority === "high" ? "text-orange-600" : task.priority === "low" ? "text-slate-400" : "text-blue-600";
  const statusColor = task.status === "done" ? "bg-green-100 text-green-700" : task.status === "in_progress" ? "bg-blue-100 text-blue-700" : task.status === "blocked" ? "bg-red-100 text-red-700" : task.status === "waiting" ? "bg-amber-100 text-amber-700" : task.status === "cancelled" ? "bg-slate-100 text-slate-500" : "bg-slate-100 text-slate-600";
  const isOverdue = (() => { if (!task.dueAt || task.status === "done" || task.status === "cancelled") return false; try { return isPast(parseISO(task.dueAt)); } catch { return false; } })();

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      if (task._source === "tr_register") {
        const trStatus = newStatus === "done" ? "Completed" : "Active";
        const endpoint = newStatus === "done" ? `/api/tr-register/${task._rawId}/complete` : `/api/tr-register/${task._rawId}`;
        const res = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify(newStatus === "done" ? {} : { status: trStatus }) });
        if (!res.ok) throw new Error("Failed to update");
      } else if (task._source === "operational") {
        const res = await fetch(`/api/operational-tasks/${task._rawId}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ status: newStatus }) });
        if (!res.ok) throw new Error("Failed to update");
      } else if (task._source === "approvals" && task._key.startsWith("approval-qc-")) {
        const qmStatus = newStatus === "done" ? "pass" : newStatus === "blocked" ? "fail" : newStatus === "in_progress" ? "in_progress" : "review";
        const res = await fetch(`/api/quality/project/${encodeURIComponent(task.projectName || "unknown")}/item/${task._rawId}`, { method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ qmStatus }) });
        if (!res.ok) throw new Error("Failed to update QC status");
      } else if (task._source === "engineering_task") {
        const engStatus = newStatus === "done" ? "DONE" : newStatus === "in_progress" ? "IN PROGRESS" : newStatus === "blocked" ? "BLOCKED" : "TO DO";
        const res = await fetch(`/api/task-checklist-items/${task._rawId}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ status: engStatus }) });
        if (!res.ok) throw new Error("Failed to update");
      }
    },
    onSuccess: () => { onInvalidate(); toast({ title: "Status updated" }); },
    onError: () => { toast({ title: "Failed to update status", variant: "destructive" }); },
  });

  const updateTrFieldMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/tr-register/${task._rawId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include", body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update");
    },
    onSuccess: () => { onInvalidate(); toast({ title: "Updated" }); setEditingField(null); },
    onError: () => { toast({ title: "Failed to update", variant: "destructive" }); },
  });

  const canChangeStatus = ["operational", "approvals", "engineering_task", "quality_task", "tr_register"].includes(task._source);
  const canEditInline = task._source === "tr_register";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto" data-testid="unified-task-detail-sheet">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${task._sourceColor}`}>{task._sourceLabel}</span>
            <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${statusColor}`}>{statusLabel}</span>
            {task.ragStatus && (
              <span className="inline-flex items-center gap-1.5 text-xs">
                <span className={`w-3 h-3 rounded-full ${task.ragStatus === "Red" ? "bg-red-500" : task.ragStatus === "Amber" ? "bg-amber-500" : "bg-green-500"}`} />
                <span className="text-muted-foreground font-medium">{task.ragStatus}</span>
              </span>
            )}
            {isOverdue && <Badge variant="destructive" className="text-[10px]">Overdue</Badge>}
          </div>
          <SheetTitle className="text-left text-base leading-snug" data-testid="text-unified-task-title">{task.title}</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">Priority</Label>
              <p className={`text-sm font-semibold mt-0.5 ${priorityColor}`} data-testid="text-unified-priority">{priorityLabel}</p>
            </div>
            {task.projectName && (
              <div>
                <Label className="text-xs text-muted-foreground">Project</Label>
                <p className="text-sm font-medium mt-0.5" data-testid="text-unified-project">{task.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</p>
              </div>
            )}
            {task.dueAt && (
              <div>
                <Label className="text-xs text-muted-foreground">Due Date</Label>
                <p className={`text-sm mt-0.5 ${isOverdue ? "text-red-600 font-bold" : ""}`} data-testid="text-unified-due">
                  {(() => { try { return format(new Date(task.dueAt), "dd MMM yyyy"); } catch { return task.dueAt; } })()}
                </p>
              </div>
            )}
            {task.createdAt && (
              <div>
                <Label className="text-xs text-muted-foreground">Created</Label>
                <p className="text-sm mt-0.5 text-muted-foreground">{(() => { try { return format(new Date(task.createdAt), "dd MMM yyyy"); } catch { return ""; } })()}</p>
              </div>
            )}
            {task.percentComplete !== undefined && task.percentComplete > 0 && (
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground">Progress</Label>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${task.percentComplete}%` }} /></div>
                  <span className="text-xs font-medium">{task.percentComplete}%</span>
                </div>
              </div>
            )}
            {task.department && <div><Label className="text-xs text-muted-foreground">Department</Label><p className="text-sm mt-0.5">{task.department}</p></div>}
            {task.trId && <div><Label className="text-xs text-muted-foreground">TR ID</Label><p className="text-sm font-mono mt-0.5">{task.trId}</p></div>}
          </div>

          <Separator />

          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Assigned To</Label>
            <div onClick={e => e.stopPropagation()}>
              <UserAssignmentPicker taskId={task._rawId} taskSource={task._source === "approvals" ? "operational" : task._source} resolvedUsers={task.resolvedAssignees || task.resolvedOwners || null} textNames={task.assignees || task.owners || null} mode={["operational", "tr_register"].includes(task._source) ? "multi" : "single"} size="sm" invalidateKeys={["/api/my-work/all-tasks", "/api/mytool/tasks", "/api/tr-register"]} />
            </div>
          </div>

          {canEditInline && task._source === "tr_register" && (
            <>
              <Separator />
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">RAG Status</Label>
                <div className="flex gap-2">
                  {["Green", "Amber", "Red"].map(rag => (
                    <button key={rag} onClick={() => updateTrFieldMutation.mutate({ ragStatus: rag })} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${task.ragStatus === rag ? (rag === "Red" ? "bg-red-50 border-red-300 text-red-700 shadow-sm" : rag === "Amber" ? "bg-amber-50 border-amber-300 text-amber-700 shadow-sm" : "bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm") : "border-border text-muted-foreground hover:bg-muted"}`} disabled={updateTrFieldMutation.isPending} data-testid={`btn-detail-rag-${rag.toLowerCase()}`}>
                      <span className={`w-2.5 h-2.5 rounded-full ${rag === "Red" ? "bg-red-500" : rag === "Amber" ? "bg-amber-500" : "bg-emerald-500"}`} /> {rag}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {(task.notes || task.description) && (
            <>
              <Separator />
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs text-muted-foreground">Notes / Comments</Label>
                  {canEditInline && editingField !== "notes" && (
                    <button onClick={() => { setEditNotes(task.notes || ""); setEditingField("notes"); }} className="text-xs text-primary hover:underline">Edit</button>
                  )}
                </div>
                {editingField === "notes" ? (
                  <div className="space-y-2">
                    <Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} className="min-h-[80px] text-sm" />
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditingField(null)}>Cancel</Button>
                      <Button size="sm" onClick={() => updateTrFieldMutation.mutate({ outcomeComments: editNotes })} disabled={updateTrFieldMutation.isPending}>
                        {updateTrFieldMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null} Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-foreground whitespace-pre-wrap bg-muted/30 rounded-lg p-3" data-testid="text-unified-notes">{task.notes || task.description}</p>
                )}
              </div>
            </>
          )}

          {canChangeStatus && (
            <>
              <Separator />
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Change Status</Label>
                <div className="flex flex-wrap gap-2">
                  {task._source === "approvals" && task._key.startsWith("approval-qc-") ? (
                    <>
                      <Button size="sm" variant={task.status === "in_progress" ? "default" : "outline"} onClick={() => updateStatusMutation.mutate("in_progress")} disabled={updateStatusMutation.isPending} data-testid="btn-status-in-progress"><Clock className="h-3.5 w-3.5 mr-1" /> In Progress</Button>
                      <Button size="sm" variant="outline" className="text-green-600 hover:bg-green-50" onClick={() => updateStatusMutation.mutate("done")} disabled={updateStatusMutation.isPending} data-testid="btn-status-pass"><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Pass</Button>
                      <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50" onClick={() => updateStatusMutation.mutate("blocked")} disabled={updateStatusMutation.isPending} data-testid="btn-status-fail"><AlertCircle className="h-3.5 w-3.5 mr-1" /> Fail</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant={task.status === "inbox" ? "default" : "outline"} onClick={() => updateStatusMutation.mutate(task._source === "engineering_task" ? "inbox" : "inbox")} disabled={updateStatusMutation.isPending} data-testid="btn-status-todo"><Circle className="h-3.5 w-3.5 mr-1" /> To Do</Button>
                      <Button size="sm" variant={task.status === "in_progress" ? "default" : "outline"} onClick={() => updateStatusMutation.mutate(task._source === "tr_register" ? "in_progress" : "In Progress")} disabled={updateStatusMutation.isPending} data-testid="btn-status-in-progress"><Clock className="h-3.5 w-3.5 mr-1" /> In Progress</Button>
                      <Button size="sm" variant="outline" className="text-green-600 hover:bg-green-50" onClick={() => updateStatusMutation.mutate("done")} disabled={updateStatusMutation.isPending} data-testid="btn-status-done"><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Done</Button>
                      <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50" onClick={() => updateStatusMutation.mutate(task._source === "tr_register" ? "blocked" : "Blocked")} disabled={updateStatusMutation.isPending} data-testid="btn-status-blocked"><AlertCircle className="h-3.5 w-3.5 mr-1" /> Blocked</Button>
                    </>
                  )}
                  {updateStatusMutation.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
              </div>
            </>
          )}

          {task.deliverableType && <div><Label className="text-xs text-muted-foreground">Deliverable Type</Label><p className="text-sm mt-0.5">{task.deliverableType}</p></div>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TaskRow({ task, isExpanded, onToggleExpand, onOpenDrawer, onStatusChange, onDelete, onAddSubtask, allTaskData, onSubtaskAddForChild, isOverdue }: { task: UnifiedTask; isExpanded: boolean; onToggleExpand: () => void; onOpenDrawer: () => void; onStatusChange: (id: number, status: TaskStatus) => void; onDelete?: () => void; onAddSubtask?: () => void; allTaskData: any; onSubtaskAddForChild: (parentId: number, projectName: string) => void; isOverdue: boolean }) {
  const subtasks = useMemo(() => {
    if (!isExpanded || task._source !== "operational" || !allTaskData?.operational) return [];
    return (allTaskData.operational as any[]).filter(t => t.parentTaskId === task.id || t.parent_task_id === task.id);
  }, [isExpanded, task, allTaskData]);

  const { data: fetchedSubtasks } = useQuery<any[]>({
    queryKey: [`/api/eng/tasks/${task.id}/subtasks`],
    enabled: isExpanded && task._source === "operational" && (task.subtaskCount || 0) > 0,
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/eng/tasks/${task.id}/subtasks`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const displaySubtasks = fetchedSubtasks || subtasks;

  const priorityColor = task.priority === "critical" ? "text-red-600 bg-red-50" : task.priority === "high" ? "text-orange-600 bg-orange-50" : task.priority === "low" ? "text-slate-400 bg-slate-50" : "text-blue-600 bg-blue-50";
  const statusIcon = task.status === "done" ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : task.status === "in_progress" ? <Clock className="h-4 w-4 text-blue-500" /> : task.status === "blocked" ? <AlertCircle className="h-4 w-4 text-red-500" /> : task.status === "waiting" ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : task.status === "cancelled" ? <X className="h-4 w-4 text-slate-400" /> : <Circle className="h-4 w-4 text-slate-300" />;

  return (
    <div data-testid={`task-row-${task._key}`}>
      <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all hover:shadow-sm cursor-pointer group ${task.status === "done" ? "opacity-60 bg-muted/30 border-border/30" : isOverdue ? "bg-red-50/40 border-red-200/60 hover:border-red-300" : "bg-background border-border/50 hover:border-border"}`} onClick={onOpenDrawer}>
        {task._source === "operational" && (task.subtaskCount || 0) > 0 && (
          <button onClick={e => { e.stopPropagation(); onToggleExpand(); }} className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors" data-testid={`btn-expand-${task._key}`}>
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        )}
        {(task._source !== "operational" || !(task.subtaskCount && task.subtaskCount > 0)) && <div className="shrink-0 w-5" />}

        <div className="shrink-0">{statusIcon}</div>

        <span className={`shrink-0 inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${priorityColor}`}>
          {task.priority === "critical" ? "P1" : task.priority === "high" ? "P2" : task.priority === "low" ? "P4" : "P3"}
        </span>

        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className={`text-sm truncate ${task.status === "done" ? "line-through text-muted-foreground" : "text-foreground"}`} data-testid={`text-task-title-${task._key}`}>{task.title}</span>
          {task.subtaskCount && task.subtaskCount > 0 && <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0">{task.subtaskCount} sub</span>}
          {task.percentComplete !== undefined && task.percentComplete > 0 && task._source === "operational" && (
            <div className="hidden sm:flex items-center gap-1 shrink-0">
              <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${task.percentComplete}%` }} /></div>
              <span className="text-[10px] text-muted-foreground">{task.percentComplete}%</span>
            </div>
          )}
        </div>

        <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${task._sourceColor}`} data-testid={`badge-source-${task._key}`}>{task._sourceLabel}</span>

        <div className="hidden sm:block shrink-0" onClick={e => e.stopPropagation()}>
          <UserAssignmentPicker taskId={task._rawId} taskSource={task._source === "approvals" ? "operational" : task._source} resolvedUsers={task.resolvedAssignees || task.resolvedOwners || null} textNames={task.assignees || task.owners || null} mode={["operational", "tr_register"].includes(task._source) ? "multi" : "single"} size="xs" invalidateKeys={["/api/my-work/all-tasks", "/api/mytool/tasks", "/api/tr-register"]} />
        </div>

        {task.projectName && <span className="hidden md:inline shrink-0 text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded truncate max-w-[120px]" title={task.projectName} data-testid={`badge-project-${task._key}`}>{task.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</span>}
        {task.ragStatus && <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${task.ragStatus === "Red" ? "bg-red-500" : task.ragStatus === "Amber" ? "bg-amber-500" : "bg-green-500"}`} title={`RAG: ${task.ragStatus}`} />}
        {task.dueAt && <span className={`hidden sm:inline shrink-0 text-[10px] ${isOverdue ? "text-red-500 font-semibold" : "text-muted-foreground"}`} data-testid={`text-due-${task._key}`}>{(() => { try { return format(new Date(task.dueAt), "dd MMM"); } catch { return ""; } })()}</span>}

        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {task._source === "operational" && onAddSubtask && <button onClick={e => { e.stopPropagation(); onAddSubtask(); }} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Add subtask" data-testid={`btn-add-subtask-${task._key}`}><Plus className="h-3.5 w-3.5" /></button>}
          {task._source === "personal" && onDelete && <button onClick={e => { e.stopPropagation(); onDelete(); }} className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors" data-testid={`btn-delete-${task._key}`}><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
      </div>

      {isExpanded && displaySubtasks.length > 0 && (
        <div className="ml-8 mt-1 space-y-0.5 border-l-2 border-emerald-200 pl-3" data-testid={`subtasks-${task._key}`}>
          {displaySubtasks.map((st: any) => {
            const stStatus = normalizeStatus(st.status);
            const stIcon = stStatus === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : stStatus === "in_progress" ? <Clock className="h-3.5 w-3.5 text-blue-500" /> : <Circle className="h-3.5 w-3.5 text-slate-300" />;
            return (
              <div key={st.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-sm" data-testid={`subtask-${st.id}`}>
                {stIcon}
                <span className={`flex-1 truncate ${stStatus === "done" ? "line-through text-muted-foreground" : ""}`}>{st.title}</span>
                <span className="text-[10px] text-muted-foreground">{st.priority}</span>
                {st.dueDate && <span className="text-[10px] text-muted-foreground">{(() => { try { return format(new Date(st.dueDate || st.due_date), "dd MMM"); } catch { return ""; } })()}</span>}
              </div>
            );
          })}
          <button onClick={() => onSubtaskAddForChild(task.id, task.projectName || "")} className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-emerald-600 transition-colors" data-testid={`btn-add-more-subtask-${task._key}`}><Plus className="h-3 w-3" /> Add subtask</button>
        </div>
      )}
    </div>
  );
}
