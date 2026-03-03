import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { format, isPast, parseISO, formatDistanceToNow, differenceInCalendarDays, startOfDay } from "date-fns";
import TaskDetailDrawer from "@/components/mytool/TaskDetailDrawer";
import { TaskItem, TaskStatus, TaskPriority } from "@/components/mytool/TaskCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Plus, Loader2, Search, Trash2, ChevronDown, ChevronRight, ArrowUpDown, X,
  Inbox, Filter, Eye, Calendar, Building2, FolderOpen, AlertTriangle, ListTodo,
  ClipboardList, ShieldCheck, FileCheck, BookOpen, CheckCircle2, Circle, Clock,
  AlertCircle, Wrench, Users, User, LayoutList, Columns3, Link2, GripVertical,
  Save, RotateCw, MoreHorizontal, ArrowRight, Hash, Tag, TrendingUp, Zap,
  Target, Activity,
} from "lucide-react";
import UserAssignmentPicker from "@/components/UserAssignmentPicker";

type SortField = "priority" | "dueDate" | "createdAt" | "status";
type SortDirection = "asc" | "desc";
type SourceFilter = "all" | "personal" | "operational" | "plan" | "engineering_task" | "quality_task" | "approvals" | "tr_register" | "deliverables" | "notifications" | "tracking";
type TrackingRole = "assignee" | "creator" | "both";
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
  _trackingRole?: TrackingRole;
}

const SOURCE_CONFIG: Record<SourceFilter, { label: string; shortLabel: string; icon: any; color: string; bgColor: string; dot: string }> = {
  all: { label: "All", shortLabel: "All", icon: ListTodo, color: "text-foreground", bgColor: "bg-muted", dot: "bg-slate-400" },
  personal: { label: "Personal", shortLabel: "Personal", icon: ClipboardList, color: "text-blue-600", bgColor: "bg-blue-50 border-blue-200", dot: "bg-blue-500" },
  operational: { label: "Project Tasks", shortLabel: "Project", icon: Building2, color: "text-emerald-600", bgColor: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" },
  plan: { label: "Project Plan", shortLabel: "Plan", icon: Calendar, color: "text-violet-600", bgColor: "bg-violet-50 border-violet-200", dot: "bg-violet-500" },
  engineering_task: { label: "Engineering", shortLabel: "Eng", icon: Wrench, color: "text-cyan-600", bgColor: "bg-cyan-50 border-cyan-200", dot: "bg-cyan-500" },
  quality_task: { label: "Quality", shortLabel: "QC", icon: ShieldCheck, color: "text-rose-600", bgColor: "bg-rose-50 border-rose-200", dot: "bg-rose-500" },
  approvals: { label: "Approvals", shortLabel: "Approvals", icon: ShieldCheck, color: "text-amber-600", bgColor: "bg-amber-50 border-amber-200", dot: "bg-amber-500" },
  tr_register: { label: "Actions", shortLabel: "Actions", icon: BookOpen, color: "text-purple-600", bgColor: "bg-purple-50 border-purple-200", dot: "bg-purple-500" },
  tracking: { label: "Tracking", shortLabel: "Tracking", icon: Eye, color: "text-teal-600", bgColor: "bg-teal-50 border-teal-200", dot: "bg-teal-500" },
  deliverables: { label: "Deliverables", shortLabel: "Deliver", icon: FileCheck, color: "text-rose-600", bgColor: "bg-rose-50 border-rose-200", dot: "bg-rose-500" },
  notifications: { label: "Notifications", shortLabel: "Notifs", icon: AlertTriangle, color: "text-orange-600", bgColor: "bg-orange-50 border-orange-200", dot: "bg-orange-500" },
};

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

const DEPARTMENTS = ["Engineering", "Operations", "Finance", "Commercial", "Quality", "HSE", "Legal", "Project Development", "Construction", "Procurement"];

interface MyWorkDefaultView {
  viewMode: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
  sourceFilter: SourceFilter;
}

function getMwViewKey(userId?: number): string {
  return `my_work_default_view_${userId || "default"}`;
}

function getSavedMyWorkDefault(userId?: number): MyWorkDefaultView | null {
  try {
    const raw = localStorage.getItem(getMwViewKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const validViews: ViewMode[] = ["list", "board"];
    if (!validViews.includes(parsed.viewMode)) parsed.viewMode = "list";
    return parsed;
  } catch { return null; }
}

function saveMyWorkDefault(view: MyWorkDefaultView, userId?: number) {
  localStorage.setItem(getMwViewKey(userId), JSON.stringify(view));
}

function clearMyWorkDefault(userId?: number) {
  localStorage.removeItem(getMwViewKey(userId));
}

const PRIORITY_BADGE: Record<string, { label: string; class: string }> = {
  critical: { label: "P1", class: "bg-red-500 text-white" },
  high: { label: "P2", class: "bg-orange-100 text-orange-700 border border-orange-200" },
  normal: { label: "P3", class: "bg-slate-100 text-slate-500 border border-slate-200" },
  low: { label: "P4", class: "bg-slate-50 text-slate-400 border border-slate-100" },
};

function smartDueLabel(dueAt: string | null): { label: string; urgency: "overdue" | "today" | "tomorrow" | "soon" | "future" | "none" } {
  if (!dueAt) return { label: "", urgency: "none" };
  try {
    const d = parseISO(dueAt);
    const now = startOfDay(new Date());
    const diff = differenceInCalendarDays(d, now);
    if (diff < -1) return { label: `${Math.abs(diff)}d overdue`, urgency: "overdue" };
    if (diff === -1) return { label: "Yesterday", urgency: "overdue" };
    if (diff === 0) return { label: "Today", urgency: "today" };
    if (diff === 1) return { label: "Tomorrow", urgency: "tomorrow" };
    if (diff <= 7) return { label: `${diff}d`, urgency: "soon" };
    return { label: format(d, "dd MMM"), urgency: "future" };
  } catch { return { label: "", urgency: "none" }; }
}

const DUE_URGENCY_STYLES: Record<string, string> = {
  overdue: "text-red-600 bg-red-50 border-red-200 font-bold",
  today: "text-amber-700 bg-amber-50 border-amber-200 font-semibold",
  tomorrow: "text-orange-600 bg-orange-50 border-orange-200 font-medium",
  soon: "text-blue-600 bg-blue-50 border-blue-200 font-medium",
  future: "text-muted-foreground bg-muted/30 border-border/50",
  none: "",
};

export default function MyWorkTasksPage() {
  const { toast } = useToast();
  const { user } = useAuth();

  const mwDefaults = useMemo(() => getSavedMyWorkDefault(user?.id), [user?.id]);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>(mwDefaults?.sortField || "priority");
  const [sortDirection, setSortDirection] = useState<SortDirection>(mwDefaults?.sortDirection || "asc");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(mwDefaults?.sourceFilter || "all");
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
  const [viewMode, setViewMode] = useState<ViewMode>(mwDefaults?.viewMode || "list");
  const [hasCustomDefault, setHasCustomDefault] = useState(!!mwDefaults);
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
        _trackingRole: t.trackingRole || "assignee",
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
        _trackingRole: t.trackingRole || "assignee",
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
    if (sourceFilter === "tracking") {
      result = result.filter(t => t._trackingRole === "creator" || t._trackingRole === "both");
    } else if (sourceFilter !== "all") {
      result = result.filter(t => t._source === sourceFilter);
    }
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
    const counts: Record<SourceFilter, number> = { all: 0, personal: 0, operational: 0, plan: 0, engineering_task: 0, quality_task: 0, approvals: 0, tr_register: 0, tracking: 0, deliverables: 0, notifications: 0 };
    for (const t of unifiedTasks) {
      if (counts[t._source] !== undefined) counts[t._source]++;
      if (t._trackingRole === "creator" || t._trackingRole === "both") counts.tracking++;
    }
    counts.all = unifiedTasks.length;
    return counts;
  }, [unifiedTasks]);

  const handleSaveDefaultView = useCallback(() => {
    saveMyWorkDefault({ viewMode, sortField, sortDirection, sourceFilter }, user?.id);
    setHasCustomDefault(true);
    toast({ title: "Default view saved" });
  }, [viewMode, sortField, sortDirection, sourceFilter, toast, user?.id]);

  const handleResetDefaultView = useCallback(() => {
    clearMyWorkDefault(user?.id);
    setHasCustomDefault(false);
    setViewMode("list");
    setSortField("priority");
    setSortDirection("asc");
    setSourceFilter("all");
    toast({ title: "Default view reset" });
  }, [toast, user?.id]);

  const kpiStats = useMemo(() => {
    const active = unifiedTasks.filter(t => t.status !== "done" && t.status !== "cancelled");
    const overdue = active.filter(t => isTaskOverdue(t));
    const critical = active.filter(t => t.priority === "critical" || t.priority === "high");
    const done = unifiedTasks.filter(t => t.status === "done");
    const blocked = active.filter(t => t.status === "blocked");
    const inProgress = active.filter(t => t.status === "in_progress");
    const dueToday = active.filter(t => { try { return t.dueAt && differenceInCalendarDays(parseISO(t.dueAt), startOfDay(new Date())) === 0; } catch { return false; } });
    const dueSoon = active.filter(t => { try { if (!t.dueAt) return false; const diff = differenceInCalendarDays(parseISO(t.dueAt), startOfDay(new Date())); return diff >= 0 && diff <= 3; } catch { return false; } });
    const completionRate = unifiedTasks.length > 0 ? Math.round((done.length / unifiedTasks.length) * 100) : 0;
    return { total: unifiedTasks.length, active: active.length, overdue: overdue.length, critical: critical.length, done: done.length, blocked: blocked.length, inProgress: inProgress.length, dueToday: dueToday.length, dueSoon: dueSoon.length, completionRate };
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
      <div className="p-4 space-y-2 flex-1" data-testid="loading-skeleton">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-8 w-full rounded-lg" />
        <div className="space-y-1">{[1, 2, 3, 4, 5, 6, 7, 8].map(i => (<Skeleton key={i} className="h-10 w-full rounded" />))}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1 max-w-6xl mx-auto w-full" data-testid="my-work-tasks-page">

      <div className="shrink-0 mb-3" data-testid="tasks-header">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-bold tracking-tight text-foreground" data-testid="text-tasks-title">My Tasks</h2>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center border rounded-md overflow-hidden">
              <button onClick={() => setViewMode("list")} className={`p-1.5 transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`} data-testid="btn-view-list" title="List view"><LayoutList className="h-3.5 w-3.5" /></button>
              <button onClick={() => setViewMode("board")} className={`p-1.5 transition-colors ${viewMode === "board" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`} data-testid="btn-view-board" title="Board view"><Columns3 className="h-3.5 w-3.5" /></button>
            </div>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={handleSaveDefaultView} data-testid="btn-save-default-view" title="Save default"><Save className="h-3 w-3" /></Button>
            {hasCustomDefault && <Button variant="ghost" size="sm" className="h-7 px-1.5 text-xs text-muted-foreground" onClick={handleResetDefaultView} data-testid="btn-reset-default-view" title="Reset default"><RotateCw className="h-3 w-3" /></Button>}
            <Button variant={groomMode ? "default" : "ghost"} size="sm" className={`h-7 text-xs px-2 ${groomMode ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}`} onClick={() => setGroomMode(!groomMode)} data-testid="button-groom-mode"><Eye className="h-3 w-3" /></Button>
            <Button size="sm" className="h-7 gap-1 text-xs shadow-sm" onClick={() => setCreateDialogOpen(true)} data-testid="button-new-task"><Plus className="h-3.5 w-3.5" /> New</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="kpi-cards">
          <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-blue-500 to-blue-600 p-3 text-white shadow-sm" data-testid="kpi-active">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-blue-100 uppercase tracking-wider">Active</p>
                <p className="text-2xl font-bold mt-0.5">{kpiStats.active}</p>
                <p className="text-[10px] text-blue-200 mt-0.5">{kpiStats.inProgress} in progress</p>
              </div>
              <div className="rounded-full bg-white/20 p-2"><ListTodo className="h-5 w-5" /></div>
            </div>
            {kpiStats.dueToday > 0 && <div className="mt-1.5 text-[10px] font-semibold bg-white/20 rounded-md px-1.5 py-0.5 inline-flex items-center gap-1"><Zap className="h-2.5 w-2.5" /> {kpiStats.dueToday} due today</div>}
          </div>

          <button onClick={() => setOverdueOnly(!overdueOnly)} className={`relative overflow-hidden rounded-xl border p-3 text-left shadow-sm transition-all ${kpiStats.overdue > 0 ? "bg-gradient-to-br from-red-500 to-red-600 text-white hover:shadow-md" : "bg-gradient-to-br from-slate-100 to-slate-50 text-slate-500 border-slate-200"} ${overdueOnly ? "ring-2 ring-red-300 ring-offset-1" : ""}`} data-testid="kpi-overdue">
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-[10px] font-medium uppercase tracking-wider ${kpiStats.overdue > 0 ? "text-red-100" : "text-slate-400"}`}>Overdue</p>
                <p className="text-2xl font-bold mt-0.5">{kpiStats.overdue}</p>
                <p className={`text-[10px] mt-0.5 ${kpiStats.overdue > 0 ? "text-red-200" : "text-slate-400"}`}>{kpiStats.blocked} blocked</p>
              </div>
              <div className={`rounded-full p-2 ${kpiStats.overdue > 0 ? "bg-white/20" : "bg-slate-200"}`}><AlertCircle className="h-5 w-5" /></div>
            </div>
            {overdueOnly && <div className="mt-1.5 text-[10px] font-semibold bg-white/20 rounded-md px-1.5 py-0.5 inline-flex items-center gap-1"><Filter className="h-2.5 w-2.5" /> Filtering</div>}
          </button>

          <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-amber-500 to-orange-500 p-3 text-white shadow-sm" data-testid="kpi-critical">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-amber-100 uppercase tracking-wider">High Priority</p>
                <p className="text-2xl font-bold mt-0.5">{kpiStats.critical}</p>
                <p className="text-[10px] text-amber-200 mt-0.5">{kpiStats.dueSoon} due within 3d</p>
              </div>
              <div className="rounded-full bg-white/20 p-2"><AlertTriangle className="h-5 w-5" /></div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-emerald-500 to-emerald-600 p-3 text-white shadow-sm" data-testid="kpi-done">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-emerald-100 uppercase tracking-wider">Completed</p>
                <p className="text-2xl font-bold mt-0.5">{kpiStats.done}</p>
                <p className="text-[10px] text-emerald-200 mt-0.5">{kpiStats.completionRate}% rate</p>
              </div>
              <div className="rounded-full bg-white/20 p-2"><CheckCircle2 className="h-5 w-5" /></div>
            </div>
            <div className="mt-1.5 h-1.5 bg-white/20 rounded-full overflow-hidden"><div className="h-full bg-white/60 rounded-full transition-all" style={{ width: `${kpiStats.completionRate}%` }} /></div>
          </div>
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-2 mb-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search tasks..." value={searchText} onChange={e => setSearchText(e.target.value)} className="pl-8 h-8 text-xs" data-testid="input-task-search" />
          {searchText && <button onClick={() => setSearchText("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>}
        </div>

        <div className="flex items-center gap-0.5 overflow-x-auto" data-testid="source-filter-tabs">
          {(Object.keys(SOURCE_CONFIG) as SourceFilter[]).map(src => {
            const config = SOURCE_CONFIG[src]; const count = sourceCounts[src]; const active = sourceFilter === src;
            if (count === 0 && src !== "all") return null;
            return (
              <button key={src} onClick={() => setSourceFilter(src)} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all whitespace-nowrap ${active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"}`} data-testid={`tab-source-${src}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-white/70" : config.dot}`} />
                {config.shortLabel} {count > 0 && <span className={`text-[10px] ${active ? "opacity-80" : "opacity-50"}`}>{count}</span>}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-0.5 ml-auto shrink-0">
          <Button variant={showFilters ? "secondary" : "ghost"} size="sm" className="h-7 px-2 text-xs" onClick={() => setShowFilters(!showFilters)} data-testid="button-toggle-filters">
            <Filter className="h-3 w-3" /> {activeFilters > 0 && <span className="ml-0.5 text-[10px] bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center">{activeFilters}</span>}
          </Button>
          {(["priority", "dueDate", "status"] as SortField[]).map(field => (
            <button key={field} onClick={() => handleSort(field)} className={`px-1.5 py-1 rounded text-[10px] font-medium transition-colors ${sortField === field ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`} data-testid={`sort-${field}`}>
              {field === "priority" ? "Pri" : field === "dueDate" ? "Due" : "Stat"}
              {sortField === field && <span className="ml-0.5">{sortDirection === "asc" ? "↑" : "↓"}</span>}
            </button>
          ))}
        </div>
      </div>

      {overdueOnly && (
        <div className="shrink-0 mb-1.5">
          <Badge variant="destructive" className="cursor-pointer gap-1 text-[10px]" onClick={() => setOverdueOnly(false)} data-testid="badge-overdue-filter">
            <AlertCircle className="h-3 w-3" /> Showing overdue only <X className="h-3 w-3 ml-1" />
          </Badge>
        </div>
      )}

      {showFilters && (
        <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-muted/20 mb-2 text-[10px]" data-testid="filter-bar">
          <div className="flex items-center gap-1">
            <span className="font-semibold text-muted-foreground uppercase tracking-wider mr-1">Status:</span>
            {allStatuses.map(s => { const isActive = statusFilter.includes(s); return (<button key={s} onClick={() => toggleStatus(s)} className={`px-1.5 py-0.5 rounded font-medium border transition-colors ${isActive ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/50 text-muted-foreground hover:border-border"}`} data-testid={`filter-status-${s}`}>{s.replace("_", " ")}</button>); })}
          </div>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-1">
            <span className="font-semibold text-muted-foreground uppercase tracking-wider mr-1">Priority:</span>
            {allPriorities.map(p => { const isActive = priorityFilter.includes(p); return (<button key={p} onClick={() => togglePriority(p)} className={`px-1.5 py-0.5 rounded font-semibold border transition-colors ${isActive ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/50 text-muted-foreground hover:border-border"}`} data-testid={`filter-priority-${p}`}>{p === "critical" ? "P1" : p === "high" ? "P2" : p === "normal" ? "P3" : "P4"}</button>); })}
          </div>
          {allProjects.length > 0 && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="text-[10px] border border-border rounded px-1.5 py-0.5 bg-background h-5" data-testid="select-project-filter">
                <option value="">All Projects</option>
                {allProjects.map(p => (<option key={p} value={p}>{p.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</option>))}
              </select>
            </>
          )}
          {activeFilters > 0 && (<button onClick={() => { setStatusFilter([]); setPriorityFilter([]); setProjectFilter(""); setOverdueOnly(false); }} className="text-[10px] text-red-500 hover:underline ml-1" data-testid="button-clear-all-filters">Clear all</button>)}
        </div>
      )}

      {viewMode === "list" ? (
        <div className="flex-1 min-h-0 overflow-y-auto" data-testid="task-list">
          {filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Inbox className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm font-medium">No tasks found</p>
              <p className="text-xs mt-1 opacity-70">{overdueOnly ? "No overdue tasks" : sourceFilter !== "all" ? "Try 'All' to see everything" : "Click '+ New' to get started"}</p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {filteredTasks.map(task => (
                <CompactTaskRow key={task._key} task={task} isExpanded={expandedTasks.has(task.id)} onToggleExpand={() => task._source === "operational" && task.subtaskCount! > 0 && toggleExpand(task.id)} onOpenDrawer={() => handleOpenDrawer(task)} onStatusChange={handleStatusChange} onDelete={task._source === "personal" ? () => deleteTaskMutation.mutate(task.id) : undefined} onAddSubtask={task._source === "operational" ? () => setSubtaskDialog({ parentId: task.id, projectName: task.projectName || "" }) : undefined} allTaskData={allTaskData} onSubtaskAddForChild={(parentId: number, projectName: string) => setSubtaskDialog({ parentId, projectName })} isOverdue={isTaskOverdue(task)} onQuickStatus={(newStatus) => boardStatusMutation.mutate({ task, newStatus })} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-x-auto">
          <div className="grid grid-cols-4 gap-2 h-full min-w-[800px]">
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
                  className={`flex flex-col min-h-0 rounded-lg border bg-muted/10 border-t-2 ${col.color} transition-all ${isDropTarget ? "border-primary/50 bg-primary/5 shadow-md" : ""}`}
                  onDragOver={(e) => handleBoardDragOver(e, col.key)}
                  onDragLeave={() => setDropTargetCol(null)}
                  onDrop={(e) => handleBoardDrop(e, col.key)}
                  data-testid={`board-col-${col.key}`}
                >
                  <div className={`shrink-0 px-2.5 py-2 flex items-center justify-between ${col.headerBg}`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${col.dotColor}`} />
                      <span className="text-[11px] font-semibold">{col.label}</span>
                    </div>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1 font-semibold">{colTasks.length}</Badge>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-1.5 pt-1 space-y-1">
                    {colTasks.map(task => {
                      const canDrag = ["personal", "operational", "engineering_task", "tr_register"].includes(task._source);
                      const pb = PRIORITY_BADGE[task.priority] || PRIORITY_BADGE.normal;
                      const cardDue = smartDueLabel(task.dueAt);
                      const cardDueStyle = DUE_URGENCY_STYLES[cardDue.urgency] || "";
                      const cardOverdue = isTaskOverdue(task);
                      return (
                        <div
                          key={task._key}
                          draggable={canDrag}
                          onDragStart={(e) => handleBoardDragStart(e, task)}
                          onClick={() => handleOpenDrawer(task)}
                          className={`bg-background rounded-lg border p-2.5 transition-all hover:shadow-md hover:border-primary/30 ${canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${draggedTask?._key === task._key ? "opacity-40" : ""} ${cardOverdue ? "border-l-2 border-l-red-400" : ""}`}
                          data-testid={`board-card-${task._key}`}
                        >
                          <div className="flex items-center gap-1 mb-1.5 flex-wrap">
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold ${pb.class}`}>{pb.label}</span>
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium border ${task._sourceColor}`}>{task._sourceLabel}</span>
                            {(task._trackingRole === "creator" || task._trackingRole === "both") && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium border bg-teal-50 border-teal-200 text-teal-700"><Eye className="h-2.5 w-2.5" />Tracking</span>}
                            {task.ragStatus && <span className={`inline-flex items-center gap-0.5 text-[9px] font-medium ${task.ragStatus === "Red" ? "text-red-600" : task.ragStatus === "Amber" ? "text-amber-600" : "text-green-600"}`}><span className={`w-1.5 h-1.5 rounded-full ${task.ragStatus === "Red" ? "bg-red-500" : task.ragStatus === "Amber" ? "bg-amber-500" : "bg-green-500"}`} />{task.ragStatus}</span>}
                          </div>
                          <p className="text-[12px] font-medium leading-snug line-clamp-2 mb-1.5">{task.title}</p>
                          <div className="flex items-center justify-between gap-1">
                            {task.projectName && <span className="text-[10px] text-muted-foreground truncate max-w-[110px]">{task.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</span>}
                            {cardDue.label && <span className={`inline-flex items-center gap-0.5 px-1 py-px rounded border text-[9px] shrink-0 ${cardDueStyle}`}><Clock className="h-2 w-2" />{cardDue.label}</span>}
                          </div>
                          {task.percentComplete !== undefined && task.percentComplete > 0 && (
                            <div className="mt-1.5 flex items-center gap-1">
                              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${task.percentComplete}%` }} /></div>
                              <span className="text-[9px] font-medium text-muted-foreground">{task.percentComplete}%</span>
                            </div>
                          )}
                          {(task.resolvedAssignees || task.resolvedOwners || task.assignees || task.owners) && (
                            <div className="mt-1.5 flex items-center gap-1">
                              <User className="h-2.5 w-2.5 text-muted-foreground" />
                              <span className="text-[9px] text-muted-foreground truncate">{(task.resolvedAssignees || task.resolvedOwners)?.map(u => u.name).join(", ") || (task.assignees || task.owners)?.join(", ")}</span>
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
      {unifiedDetailOpen && unifiedDetailTask && (<TaskDetailPanel task={unifiedDetailTask} open={unifiedDetailOpen} onOpenChange={setUnifiedDetailOpen} onInvalidate={invalidateAll} allProjects={allProjects} />)}

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><Plus className="h-4 w-4" /> New Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="flex gap-2">
              <button onClick={() => setNewTask(t => ({ ...t, type: "personal" }))} className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${newTask.type === "personal" ? "bg-blue-50 border-blue-300 text-blue-700 shadow-sm" : "border-border text-muted-foreground hover:bg-muted"}`} data-testid="btn-type-personal">
                <ClipboardList className="h-4 w-4 mx-auto mb-0.5" /> Personal Task
              </button>
              <button onClick={() => setNewTask(t => ({ ...t, type: "action" }))} className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${newTask.type === "action" ? "bg-purple-50 border-purple-300 text-purple-700 shadow-sm" : "border-border text-muted-foreground hover:bg-muted"}`} data-testid="btn-type-action">
                <BookOpen className="h-4 w-4 mx-auto mb-0.5" /> Action Item
              </button>
            </div>
            <div>
              <Label className="text-xs font-medium">Title <span className="text-red-500">*</span></Label>
              <Input placeholder={newTask.type === "action" ? "Describe the action..." : "What needs to be done?"} value={newTask.title} onChange={e => setNewTask(t => ({ ...t, title: e.target.value }))} className="mt-1 h-8 text-sm" data-testid="input-new-title" autoFocus />
            </div>
            <div>
              <Label className="text-xs font-medium">Description</Label>
              <Textarea placeholder="Additional details..." value={newTask.description} onChange={e => setNewTask(t => ({ ...t, description: e.target.value }))} className="mt-1 min-h-[50px] text-sm" data-testid="input-new-desc" />
            </div>
            <div className={`grid ${newTask.type === "personal" ? "grid-cols-3" : "grid-cols-2"} gap-2`}>
              <div>
                <Label className="text-xs font-medium">Priority</Label>
                <Select value={newTask.priority} onValueChange={v => setNewTask(t => ({ ...t, priority: v as TaskPriority }))}>
                  <SelectTrigger className="mt-1 h-7 text-xs" data-testid="select-new-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">P1 — Critical</SelectItem>
                    <SelectItem value="high">P2 — High</SelectItem>
                    <SelectItem value="normal">P3 — Normal</SelectItem>
                    <SelectItem value="low">P4 — Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newTask.type === "personal" && (
                <div>
                  <Label className="text-xs font-medium">Status</Label>
                  <Select value={newTask.status} onValueChange={v => setNewTask(t => ({ ...t, status: v as TaskStatus }))}>
                    <SelectTrigger className="mt-1 h-7 text-xs" data-testid="select-new-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inbox">Not Started</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="blocked">Blocked</SelectItem>
                      <SelectItem value="done">Done</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label className="text-xs font-medium">Due Date</Label>
                <Input type="date" value={newTask.dueDate} onChange={e => setNewTask(t => ({ ...t, dueDate: e.target.value }))} className="mt-1 h-7 text-xs" data-testid="input-new-due" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs font-medium">Project</Label>
                <Select value={newTask.projectName} onValueChange={v => setNewTask(t => ({ ...t, projectName: v === "__none" ? "" : v }))}>
                  <SelectTrigger className="mt-1 h-7 text-xs" data-testid="select-new-project"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {allProjects.map(p => (<SelectItem key={p} value={p}>{p.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-medium">Department</Label>
                <Select value={newTask.department} onValueChange={v => setNewTask(t => ({ ...t, department: v === "__none" ? "" : v }))}>
                  <SelectTrigger className="mt-1 h-7 text-xs" data-testid="select-new-dept"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {DEPARTMENTS.map(d => (<SelectItem key={d} value={d}>{d}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs font-medium">Assign To</Label>
              <AssignToSelector selected={newTask.assignees} onChange={a => setNewTask(t => ({ ...t, assignees: a }))} />
            </div>
            {newTask.type === "action" && (
              <div>
                <Label className="text-xs font-medium">RAG Status</Label>
                <div className="flex gap-1.5 mt-1">
                  {["Green", "Amber", "Red"].map(rag => (
                    <button key={rag} onClick={() => setNewTask(t => ({ ...t, ragStatus: rag }))} className={`flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-medium transition-all ${newTask.ragStatus === rag ? (rag === "Red" ? "bg-red-50 border-red-300 text-red-700" : rag === "Amber" ? "bg-amber-50 border-amber-300 text-amber-700" : "bg-emerald-50 border-emerald-300 text-emerald-700") : "border-border text-muted-foreground hover:bg-muted"}`} data-testid={`btn-rag-${rag.toLowerCase()}`}>
                      <span className={`w-2 h-2 rounded-full ${rag === "Red" ? "bg-red-500" : rag === "Amber" ? "bg-amber-500" : "bg-emerald-500"}`} /> {rag}
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
          <DialogHeader><DialogTitle className="text-base">Add Subtask</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><label className="text-xs font-medium text-muted-foreground">Title</label><Input placeholder="Subtask title..." value={newSubtaskTitle} onChange={e => setNewSubtaskTitle(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && newSubtaskTitle.trim() && subtaskDialog) createSubtaskMutation.mutate({ parentId: subtaskDialog.parentId, title: newSubtaskTitle.trim(), priority: newSubtaskPriority }); }} className="h-8" data-testid="input-subtask-title" /></div>
            <div><label className="text-xs font-medium text-muted-foreground">Priority</label><Select value={newSubtaskPriority} onValueChange={setNewSubtaskPriority}><SelectTrigger className="h-7 text-xs" data-testid="select-subtask-priority"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="High">High</SelectItem><SelectItem value="Med">Medium</SelectItem><SelectItem value="Low">Low</SelectItem></SelectContent></Select></div>
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

function CompactTaskRow({ task, isExpanded, onToggleExpand, onOpenDrawer, onStatusChange, onDelete, onAddSubtask, allTaskData, onSubtaskAddForChild, isOverdue, onQuickStatus }: { task: UnifiedTask; isExpanded: boolean; onToggleExpand: () => void; onOpenDrawer: () => void; onStatusChange: (id: number, status: TaskStatus) => void; onDelete?: () => void; onAddSubtask?: () => void; allTaskData: any; onSubtaskAddForChild: (parentId: number, projectName: string) => void; isOverdue: boolean; onQuickStatus: (newStatus: string) => void }) {
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
  const pb = PRIORITY_BADGE[task.priority] || PRIORITY_BADGE.normal;
  const isDone = task.status === "done" || task.status === "cancelled";

  const statusDot = task.status === "done" ? "bg-emerald-500" : task.status === "in_progress" ? "bg-blue-500" : task.status === "blocked" ? "bg-red-500" : task.status === "waiting" ? "bg-amber-500" : task.status === "cancelled" ? "bg-slate-300" : "bg-slate-300";

  const canQuickStatus = ["personal", "operational", "engineering_task", "tr_register"].includes(task._source);

  const due = smartDueLabel(task.dueAt);
  const dueStyle = DUE_URGENCY_STYLES[due.urgency] || "";

  return (
    <div data-testid={`task-row-${task._key}`}>
      <div className={`flex items-center gap-2 px-3 py-2.5 transition-all hover:bg-muted/40 cursor-pointer group ${isDone ? "opacity-50" : ""} ${isOverdue && !isDone ? "bg-red-50/40 border-l-2 border-l-red-400" : ""} ${task.status === "blocked" && !isDone ? "bg-amber-50/30 border-l-2 border-l-amber-400" : ""}`} onClick={onOpenDrawer}>

        {task._source === "operational" && (task.subtaskCount || 0) > 0 ? (
          <button onClick={e => { e.stopPropagation(); onToggleExpand(); }} className="shrink-0 p-0.5 rounded hover:bg-muted" data-testid={`btn-expand-${task._key}`}>
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        ) : (
          <div className="shrink-0 w-4" />
        )}

        <button
          onClick={e => { e.stopPropagation(); if (canQuickStatus) onQuickStatus(isDone ? "inbox" : "done"); }}
          className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
            isDone ? "border-emerald-500 bg-emerald-500" : task.status === "in_progress" ? "border-blue-400 bg-blue-50" : task.status === "blocked" ? "border-red-400 bg-red-50" : "border-slate-300 hover:border-emerald-400 hover:bg-emerald-50"
          }`}
          data-testid={`btn-complete-${task._key}`}
          title={isDone ? "Reopen" : "Complete"}
        >
          {isDone && <CheckCircle2 className="h-3 w-3 text-white" />}
          {!isDone && task.status === "in_progress" && <div className="w-2 h-2 rounded-full bg-blue-400" />}
          {!isDone && task.status === "blocked" && <div className="w-2 h-2 rounded-full bg-red-400" />}
        </button>

        <span className={`shrink-0 inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold leading-none ${pb.class}`}>{pb.label}</span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-[13px] leading-tight truncate ${isDone ? "line-through text-muted-foreground" : "text-foreground font-medium"}`} data-testid={`text-task-title-${task._key}`}>{task.title}</span>
            {task.subtaskCount && task.subtaskCount > 0 && <span className="text-[9px] text-muted-foreground bg-muted px-1 py-px rounded shrink-0">{task.subtaskCount} sub</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {task.projectName && <span className="text-[10px] text-muted-foreground truncate max-w-[140px]" title={task.projectName} data-testid={`badge-project-${task._key}`}>{task.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</span>}
            {task.percentComplete !== undefined && task.percentComplete > 0 && (
              <div className="flex items-center gap-1 shrink-0">
                <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${task.percentComplete}%` }} /></div>
                <span className="text-[9px] text-muted-foreground">{task.percentComplete}%</span>
              </div>
            )}
            {task.ragStatus && <span className={`shrink-0 inline-flex items-center gap-0.5 text-[9px] font-medium ${task.ragStatus === "Red" ? "text-red-600" : task.ragStatus === "Amber" ? "text-amber-600" : "text-green-600"}`}><span className={`w-1.5 h-1.5 rounded-full ${task.ragStatus === "Red" ? "bg-red-500" : task.ragStatus === "Amber" ? "bg-amber-500" : "bg-green-500"}`} />{task.ragStatus}</span>}
          </div>
        </div>

        <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border ${task._sourceColor}`} data-testid={`badge-source-${task._key}`}>{task._sourceLabel}</span>
        {(task._trackingRole === "creator" || task._trackingRole === "both") && <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium border bg-teal-50 border-teal-200 text-teal-700" data-testid={`badge-tracking-${task._key}`}><Eye className="h-2.5 w-2.5" />Tracking</span>}

        <div className="hidden sm:block shrink-0" onClick={e => e.stopPropagation()}>
          <UserAssignmentPicker taskId={task._rawId} taskSource={task._source === "approvals" ? "operational" : task._source} resolvedUsers={task.resolvedAssignees || task.resolvedOwners || null} textNames={task.assignees || task.owners || null} mode={["operational", "tr_register"].includes(task._source) ? "multi" : "single"} size="xs" invalidateKeys={["/api/my-work/all-tasks", "/api/mytool/tasks", "/api/tr-register"]} />
        </div>

        {due.label && (
          <span className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] tabular-nums ${dueStyle}`} data-testid={`text-due-${task._key}`}>
            <Clock className="h-2.5 w-2.5" />{due.label}
          </span>
        )}

        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {canQuickStatus && !isDone && (
            <>
              <button onClick={e => { e.stopPropagation(); onQuickStatus("in_progress"); }} className={`p-1 rounded transition-colors ${task.status === "in_progress" ? "text-blue-500 bg-blue-50" : "text-muted-foreground/40 hover:text-blue-500 hover:bg-blue-50"}`} title="In Progress"><Clock className="h-3 w-3" /></button>
              <button onClick={e => { e.stopPropagation(); onQuickStatus("blocked"); }} className={`p-1 rounded transition-colors ${task.status === "blocked" ? "text-red-500 bg-red-50" : "text-muted-foreground/40 hover:text-red-500 hover:bg-red-50"}`} title="Blocked"><AlertCircle className="h-3 w-3" /></button>
            </>
          )}
          {task._source === "operational" && onAddSubtask && <button onClick={e => { e.stopPropagation(); onAddSubtask(); }} className="p-1 rounded text-muted-foreground/40 hover:text-emerald-500 hover:bg-emerald-50" title="Add subtask" data-testid={`btn-add-subtask-${task._key}`}><Plus className="h-3 w-3" /></button>}
          {task._source === "personal" && onDelete && <button onClick={e => { e.stopPropagation(); onDelete(); }} className="p-1 rounded text-muted-foreground/40 hover:text-red-500 hover:bg-red-50" data-testid={`btn-delete-${task._key}`}><Trash2 className="h-3 w-3" /></button>}
        </div>
      </div>

      {isExpanded && displaySubtasks.length > 0 && (
        <div className="ml-8 border-l-2 border-emerald-200 pl-2" data-testid={`subtasks-${task._key}`}>
          {displaySubtasks.map((st: any) => {
            const stStatus = normalizeStatus(st.status);
            const stDone = stStatus === "done";
            return (
              <div key={st.id} className="flex items-center gap-1.5 px-1.5 py-1 hover:bg-muted/30 text-[12px]" data-testid={`subtask-${st.id}`}>
                <span className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${stDone ? "border-emerald-500 bg-emerald-500" : "border-slate-300"}`}>
                  {stDone && <CheckCircle2 className="h-2 w-2 text-white" />}
                </span>
                <span className={`flex-1 truncate ${stDone ? "line-through text-muted-foreground" : ""}`}>{st.title}</span>
                <span className="text-[9px] text-muted-foreground">{st.priority}</span>
              </div>
            );
          })}
          <button onClick={() => onSubtaskAddForChild(task.id, task.projectName || "")} className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-emerald-600" data-testid={`btn-add-more-subtask-${task._key}`}><Plus className="h-2.5 w-2.5" /> Add subtask</button>
        </div>
      )}
    </div>
  );
}

function TaskDetailPanel({ task, open, onOpenChange, onInvalidate, allProjects }: { task: UnifiedTask; open: boolean; onOpenChange: (open: boolean) => void; onInvalidate: () => void; allProjects: string[] }) {
  const { toast } = useToast();
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState(task.notes || "");
  const [detailTab, setDetailTab] = useState("details");

  const statusLabel = task.status === "done" ? "Done" : task.status === "in_progress" ? "In Progress" : task.status === "blocked" ? "Blocked" : task.status === "waiting" ? "Waiting" : task.status === "cancelled" ? "Cancelled" : task.status === "inbox" ? "To Do" : task.status === "planned" ? "Planned" : task.status;
  const priorityLabel = task.priority === "critical" ? "P1 — Critical" : task.priority === "high" ? "P2 — High" : task.priority === "low" ? "P4 — Low" : "P3 — Normal";
  const priorityColor = task.priority === "critical" ? "text-red-600" : task.priority === "high" ? "text-orange-600" : task.priority === "low" ? "text-slate-400" : "text-blue-600";
  const statusColor = task.status === "done" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : task.status === "in_progress" ? "bg-blue-100 text-blue-700 border-blue-200" : task.status === "blocked" ? "bg-red-100 text-red-700 border-red-200" : task.status === "waiting" ? "bg-amber-100 text-amber-700 border-amber-200" : task.status === "cancelled" ? "bg-slate-100 text-slate-500 border-slate-200" : "bg-slate-100 text-slate-600 border-slate-200";
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

  const detailDue = smartDueLabel(task.dueAt);
  const detailDueStyle = DUE_URGENCY_STYLES[detailDue.urgency] || "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg p-0 flex flex-col" data-testid="unified-task-detail-sheet">
        <div className="px-4 pt-4 pb-3 border-b shrink-0">
          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${task._sourceColor}`}>{task._sourceLabel}</span>
            {(task._trackingRole === "creator" || task._trackingRole === "both") && <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-medium border bg-teal-50 border-teal-200 text-teal-700"><Eye className="h-3 w-3" />Tracking</span>}
            <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold border ${statusColor}`}>{statusLabel}</span>
            <span className={`text-[10px] font-semibold ${priorityColor}`}>{priorityLabel}</span>
            {task.ragStatus && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium ${task.ragStatus === "Red" ? "bg-red-50 border-red-200 text-red-700" : task.ragStatus === "Amber" ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
                <span className={`w-2 h-2 rounded-full ${task.ragStatus === "Red" ? "bg-red-500" : task.ragStatus === "Amber" ? "bg-amber-500" : "bg-green-500"}`} />
                {task.ragStatus}
              </span>
            )}
            {isOverdue && <Badge variant="destructive" className="text-[9px] px-1.5 py-0">Overdue</Badge>}
          </div>
          <h3 className="text-sm font-semibold leading-snug" data-testid="text-unified-task-title">{task.title}</h3>
          <div className="flex items-center flex-wrap gap-2 mt-2.5">
            {task.projectName && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 rounded-md px-1.5 py-0.5" data-testid="text-unified-project">
                <FolderOpen className="h-3 w-3" /> {task.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
              </span>
            )}
            {detailDue.label && (
              <span className={`flex items-center gap-1 text-[10px] rounded-md px-1.5 py-0.5 border ${detailDueStyle}`} data-testid="text-unified-due">
                <Clock className="h-3 w-3" /> {detailDue.label}
                {task.dueAt && <span className="text-[9px] opacity-70 ml-0.5">({(() => { try { return format(new Date(task.dueAt), "dd MMM yyyy"); } catch { return ""; } })()})</span>}
              </span>
            )}
            {task.department && <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 rounded-md px-1.5 py-0.5"><Tag className="h-3 w-3" /> {task.department}</span>}
            {task.trId && <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground bg-muted/50 rounded-md px-1.5 py-0.5"><Hash className="h-3 w-3" /> {task.trId}</span>}
          </div>
        </div>

        <Tabs value={detailTab} onValueChange={setDetailTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="shrink-0 mx-4 mt-2 h-8">
            <TabsTrigger value="details" className="text-xs h-7">Details</TabsTrigger>
            <TabsTrigger value="actions" className="text-xs h-7">Actions</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="flex-1 overflow-y-auto px-4 pb-4 mt-0">
            <div className="space-y-4 pt-3">
              {task.percentComplete !== undefined && task.percentComplete > 0 && (
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Progress</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${task.percentComplete}%` }} /></div>
                    <span className="text-xs font-semibold">{task.percentComplete}%</span>
                  </div>
                </div>
              )}

              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 block">Assigned To</Label>
                <div onClick={e => e.stopPropagation()}>
                  <UserAssignmentPicker taskId={task._rawId} taskSource={task._source === "approvals" ? "operational" : task._source} resolvedUsers={task.resolvedAssignees || task.resolvedOwners || null} textNames={task.assignees || task.owners || null} mode={["operational", "tr_register"].includes(task._source) ? "multi" : "single"} size="sm" invalidateKeys={["/api/my-work/all-tasks", "/api/mytool/tasks", "/api/tr-register"]} />
                </div>
              </div>

              {canEditInline && task._source === "tr_register" && (
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 block">RAG Status</Label>
                  <div className="flex gap-1.5">
                    {["Green", "Amber", "Red"].map(rag => (
                      <button key={rag} onClick={() => updateTrFieldMutation.mutate({ ragStatus: rag })} className={`flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-all ${task.ragStatus === rag ? (rag === "Red" ? "bg-red-50 border-red-300 text-red-700 shadow-sm" : rag === "Amber" ? "bg-amber-50 border-amber-300 text-amber-700 shadow-sm" : "bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm") : "border-border text-muted-foreground hover:bg-muted"}`} disabled={updateTrFieldMutation.isPending} data-testid={`btn-detail-rag-${rag.toLowerCase()}`}>
                        <span className={`w-2 h-2 rounded-full ${rag === "Red" ? "bg-red-500" : rag === "Amber" ? "bg-amber-500" : "bg-emerald-500"}`} /> {rag}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(task.notes || task.description) && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Notes</Label>
                    {canEditInline && editingField !== "notes" && (
                      <button onClick={() => { setEditNotes(task.notes || ""); setEditingField("notes"); }} className="text-[10px] text-primary hover:underline">Edit</button>
                    )}
                  </div>
                  {editingField === "notes" ? (
                    <div className="space-y-1.5">
                      <Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} className="min-h-[60px] text-xs" />
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setEditingField(null)}>Cancel</Button>
                        <Button size="sm" className="h-6 text-xs" onClick={() => updateTrFieldMutation.mutate({ outcomeComments: editNotes })} disabled={updateTrFieldMutation.isPending}>Save</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-foreground whitespace-pre-wrap bg-muted/30 rounded-md p-2.5 leading-relaxed" data-testid="text-unified-notes">{task.notes || task.description}</p>
                  )}
                </div>
              )}

              {task.createdAt && (
                <div className="text-[10px] text-muted-foreground pt-2 border-t">
                  Created {(() => { try { return formatDistanceToNow(new Date(task.createdAt), { addSuffix: true }); } catch { return ""; } })()}
                </div>
              )}

              {task.deliverableType && <div><Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Deliverable Type</Label><p className="text-xs mt-0.5">{task.deliverableType}</p></div>}
            </div>
          </TabsContent>

          <TabsContent value="actions" className="flex-1 overflow-y-auto px-4 pb-4 mt-0">
            <div className="space-y-4 pt-3">
              {canChangeStatus && (
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 block">Change Status</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {task._source === "approvals" && task._key.startsWith("approval-qc-") ? (
                      <>
                        <Button size="sm" variant={task.status === "in_progress" ? "default" : "outline"} className="h-8 text-xs justify-start" onClick={() => updateStatusMutation.mutate("in_progress")} disabled={updateStatusMutation.isPending} data-testid="btn-status-in-progress"><Clock className="h-3 w-3 mr-1.5" /> In Progress</Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs justify-start text-green-600 hover:bg-green-50" onClick={() => updateStatusMutation.mutate("done")} disabled={updateStatusMutation.isPending} data-testid="btn-status-pass"><CheckCircle2 className="h-3 w-3 mr-1.5" /> Pass</Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs justify-start text-red-600 hover:bg-red-50" onClick={() => updateStatusMutation.mutate("blocked")} disabled={updateStatusMutation.isPending} data-testid="btn-status-fail"><AlertCircle className="h-3 w-3 mr-1.5" /> Fail</Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant={task.status === "inbox" ? "default" : "outline"} className="h-8 text-xs justify-start" onClick={() => updateStatusMutation.mutate(task._source === "engineering_task" ? "inbox" : "inbox")} disabled={updateStatusMutation.isPending} data-testid="btn-status-todo"><Circle className="h-3 w-3 mr-1.5" /> To Do</Button>
                        <Button size="sm" variant={task.status === "in_progress" ? "default" : "outline"} className="h-8 text-xs justify-start" onClick={() => updateStatusMutation.mutate(task._source === "tr_register" ? "in_progress" : "In Progress")} disabled={updateStatusMutation.isPending} data-testid="btn-status-in-progress"><Clock className="h-3 w-3 mr-1.5" /> In Progress</Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs justify-start text-emerald-600 hover:bg-emerald-50" onClick={() => updateStatusMutation.mutate("done")} disabled={updateStatusMutation.isPending} data-testid="btn-status-done"><CheckCircle2 className="h-3 w-3 mr-1.5" /> Done</Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs justify-start text-red-600 hover:bg-red-50" onClick={() => updateStatusMutation.mutate(task._source === "tr_register" ? "blocked" : "Blocked")} disabled={updateStatusMutation.isPending} data-testid="btn-status-blocked"><AlertCircle className="h-3 w-3 mr-1.5" /> Blocked</Button>
                      </>
                    )}
                  </div>
                  {updateStatusMutation.isPending && <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Updating...</div>}
                </div>
              )}

              {!canChangeStatus && (
                <div className="text-center py-6 text-muted-foreground">
                  <p className="text-xs">Status changes for this task type must be done from the source.</p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function AssignToSelector({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) {
  const { data: users = [] } = useQuery<{ id: number; name: string; username: string }[]>({
    queryKey: ["/api/users/assignable"],
    queryFn: async () => {
      const res = await fetch("/api/users/assignable", { headers: { ...getAuthHeaders() }, credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = users.filter(u =>
    !search.trim() || u.name?.toLowerCase().includes(search.toLowerCase()) || u.username?.toLowerCase().includes(search.toLowerCase())
  );

  const displayName = (nameVal: string) => {
    const u = users.find(usr => usr.name === nameVal);
    return u?.name || nameVal;
  };

  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter(n => n !== name) : [...selected, name]);
  };

  return (
    <div className="mt-1">
      <div className="flex flex-wrap gap-1 mb-1">
        {selected.map(name => (
          <span key={name} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 border border-blue-200 text-blue-700">
            <User className="h-2.5 w-2.5" /> {displayName(name)}
            <button onClick={() => onChange(selected.filter(n => n !== name))} className="hover:text-red-500" data-testid={`btn-remove-assignee-${name}`}><X className="h-2.5 w-2.5" /></button>
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-dashed border-border text-[10px] text-muted-foreground hover:bg-muted transition-colors"
        data-testid="btn-assign-to-picker"
      >
        <Users className="h-3 w-3" /> {selected.length === 0 ? "Add assignees" : "Edit"}
      </button>
      {open && (
        <div className="mt-1 border rounded-md bg-background shadow-md max-h-36 overflow-y-auto">
          <div className="p-1 border-b">
            <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="h-6 text-[10px]" data-testid="input-assign-search" />
          </div>
          <div className="p-0.5">
            {filtered.map(u => (
              <button key={u.id} onClick={() => toggle(u.name)} className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px] text-left transition-colors ${selected.includes(u.name) ? "bg-blue-50 text-blue-700" : "hover:bg-muted"}`} data-testid={`assign-user-${u.id}`}>
                <span className={`w-3 h-3 rounded border flex items-center justify-center text-[8px] ${selected.includes(u.name) ? "bg-blue-500 border-blue-500 text-white" : "border-border"}`}>
                  {selected.includes(u.name) ? "✓" : ""}
                </span>
                <span className="truncate">{u.name}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="text-[10px] text-muted-foreground text-center py-2">No users found</p>}
          </div>
        </div>
      )}
    </div>
  );
}
