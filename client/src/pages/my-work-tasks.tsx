import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { createTaskRequestId } from "@/lib/idempotency";
import { useToast } from "@/hooks/use-toast";
import { getTaskWorkflowBlockReason } from "@/lib/task-workflow-guard";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Plus, Loader2, Search, Trash2, ChevronDown, ChevronRight, ArrowUpDown, X,
  Inbox, Filter, Eye, Calendar, Building2, FolderOpen, AlertTriangle, ListTodo,
  ClipboardList, ShieldCheck, FileCheck, BookOpen, CheckCircle2, Circle, Clock,
  AlertCircle, Wrench, Users, User, UserPlus, LayoutList, Columns3, Link2, GripVertical,
  Save, RotateCw, MoreHorizontal, ArrowRight, Hash, Tag, TrendingUp, Zap, ExternalLink,
  Target, Activity,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageShell, SectionHeader, WorkspaceNotice } from "@/components/layout/page-shell";
import UserAssignmentPicker from "@/components/UserAssignmentPicker";
import { canReassignTask as canReassignTaskByRole, getTaskAssigneeNames, isTaskDueSoon, isTaskOverdue as isTaskOverdueLogic } from "@/pages/my-work-tasks-logic";
import { useLocation } from "wouter";

type SortField = "priority" | "dueDate" | "createdAt" | "status" | "smart";
type SortDirection = "asc" | "desc";
type SourceFilter = "all" | "personal" | "operational" | "plan" | "engineering_task" | "quality_task" | "approvals" | "tr_register" | "deliverables" | "notifications" | "microsoft" | "tracking";
type TrackingRole = "assignee" | "creator" | "both" | "viewer" | "admin_overview";
type ViewMode = "list" | "board";

const priorityOrder: Record<string, number> = { critical: 0, high: 1, urgent: 0, High: 1, Med: 2, Low: 3, normal: 2, low: 3 };
const statusOrder: Record<string, number> = { in_progress: 0, review: 1, todo: 2, inbox: 2, blocked: 3, complete: 4, done: 4, cancelled: 5 };
const allStatuses: TaskStatus[] = ["todo", "in_progress", "review", "blocked", "complete", "cancelled"];
const allPriorities: TaskPriority[] = ["critical", "high", "normal", "low"];
const BOARD_COLUMNS: { key: TaskStatus; label: string; color: string; dotColor: string; headerBg: string }[] = [
  { key: "todo", label: "To Do", color: "border-t-slate-400", dotColor: "bg-slate-400", headerBg: "bg-muted" },
  { key: "in_progress", label: "In Progress", color: "border-t-blue-500", dotColor: "bg-blue-500", headerBg: "bg-blue-50" },
  { key: "review", label: "Review", color: "border-t-amber-500", dotColor: "bg-amber-500", headerBg: "bg-amber-50" },
  { key: "blocked", label: "Blocked", color: "border-t-red-500", dotColor: "bg-red-500", headerBg: "bg-red-50" },
  { key: "complete", label: "Complete", color: "border-t-emerald-500", dotColor: "bg-emerald-500", headerBg: "bg-emerald-50" },
];

function normalizeStatus(status: string): TaskStatus {
  const s = status?.toLowerCase().trim() || "todo";
  if (s === "todo" || s === "to do" || s === "to_do" || s === "not started" || s === "not_started" || s === "inbox" || s === "planned" || s === "new" || s === "open") return "todo";
  if (s === "in progress" || s === "in_progress" || s === "active" || s === "pending" || s === "started" || s === "wip") return "in_progress";
  if (s === "blocked" || s === "on hold" || s === "on_hold" || s === "waiting") return "blocked";
  if (s === "review" || s === "in review" || s === "in_review" || s === "qa_review" || s === "needs review") return "review";
  if (s === "done" || s === "complete" || s === "completed" || s === "closed" || s === "finished" || s === "resolved" || s === "pass") return "complete";
  if (s === "cancelled" || s === "canceled" || s === "archived" || s === "removed") return "cancelled";
  return "todo";
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
  updatedAt?: string | null;
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
  projectId?: number | null;
  sourceHref?: string | null;
  projectHref?: string | null;
  externalHref?: string | null;
  sourceContextLabel?: string | null;
  sourceTypeLabel?: string | null;
  assigneeDisplay?: string | null;
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
  microsoft: { label: "Microsoft", shortLabel: "MS", icon: Link2, color: "text-indigo-600", bgColor: "bg-indigo-50 border-indigo-200", dot: "bg-indigo-500" },
};

const SOURCE_FILTER_VALUES: SourceFilter[] = ["all", "personal", "operational", "plan", "engineering_task", "quality_task", "approvals", "tr_register", "deliverables", "notifications", "microsoft", "tracking"];

function isSourceFilter(value: string | null): value is SourceFilter {
  return value != null && SOURCE_FILTER_VALUES.includes(value as SourceFilter);
}

function isExternalHref(value?: string | null) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

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
  normal: { label: "P3", class: "bg-muted text-muted-foreground border border-border" },
  low: { label: "P4", class: "bg-muted text-slate-500 border border-border" },
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
  const [, navigate] = useLocation();

  const mwDefaults = useMemo(() => getSavedMyWorkDefault(user?.id), [user?.id]);
  const queryDefaults = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        sourceFilter: null as SourceFilter | null,
        projectFilter: "",
        overdueOnly: false,
        dueThisWeekOnly: false,
        blockedOnly: false,
      };
    }

    const params = new URLSearchParams(window.location.search);
    return {
      sourceFilter: isSourceFilter(params.get("source")) ? params.get("source") : null,
      projectFilter: params.get("project") || "",
      overdueOnly: params.get("overdue") === "1",
      dueThisWeekOnly: params.get("dueSoon") === "1" || params.get("dueThisWeek") === "1",
      blockedOnly: params.get("blocked") === "1",
    };
  }, []);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority[]>([]);
  const [projectFilter, setProjectFilter] = useState(queryDefaults.projectFilter);
  const [sortField, setSortField] = useState<SortField>(mwDefaults?.sortField || "smart");
  const [sortDirection, setSortDirection] = useState<SortDirection>(mwDefaults?.sortDirection || "asc");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(queryDefaults.sourceFilter || mwDefaults?.sourceFilter || "all");
  const [showFilters, setShowFilters] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(queryDefaults.overdueOnly);
  const [dueThisWeekOnly, setDueThisWeekOnly] = useState(queryDefaults.dueThisWeekOnly);
  const [assignedScope, setAssignedScope] = useState<"all" | "assigned_to_me" | "unassigned" | "created_by_me">("all");
  const [blockedOnly, setBlockedOnly] = useState(queryDefaults.blockedOnly);
  const [groomMode, setGroomMode] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
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
  const createTaskSubmitLockRef = useRef(false);
  const createTaskRequestIdRef = useRef<string | null>(null);
  const openedQueryItemKeyRef = useRef<string | null>(null);
  const [draggedTask, setDraggedTask] = useState<UnifiedTask | null>(null);
  const [dropTargetCol, setDropTargetCol] = useState<TaskStatus | null>(null);
  const [newTask, setNewTask] = useState({
    title: "", description: "", priority: "normal" as TaskPriority,
    status: "todo" as TaskStatus, dueDate: "", projectName: "",
    department: "", ragStatus: "", type: "personal" as "personal" | "action",
    assignees: [] as { id: number; name: string }[],
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

  const microsoftItems = useMemo(() => {
    if (Array.isArray(allTaskData?.microsoftItems) && allTaskData.microsoftItems.length > 0) {
      return allTaskData.microsoftItems;
    }
    return msActionItems;
  }, [allTaskData?.microsoftItems, msActionItems]);

  const projectNames = useMemo(() =>
    rawProjectInfos.map((p: any) => p.projectName || p.project_name).filter(Boolean).sort(),
    [rawProjectInfos]
  );

  const unifiedTasks: UnifiedTask[] = useMemo(() => {
    if (!allTaskData) return [];
    const result: UnifiedTask[] = [];
    const safeId = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const withSourceMeta = <T extends UnifiedTask>(task: T, raw: any): T => ({
      ...task,
      projectId: raw?.projectId ?? raw?.project_id ?? null,
      sourceHref: raw?.sourceHref || null,
      projectHref: raw?.projectHref || null,
      externalHref: raw?.externalHref || null,
      sourceContextLabel: raw?.sourceContextLabel || null,
      sourceTypeLabel: raw?.sourceTypeLabel || null,
      assigneeDisplay: raw?.assigneeDisplay || null,
    });

    for (const t of (allTaskData.personal || [])) {
      result.push(withSourceMeta({
        _key: `personal-${t.id}`, _source: "personal", _sourceLabel: "Personal",
        _sourceColor: "bg-blue-50 border-blue-200 text-blue-700", _rawId: safeId(t.id), id: safeId(t.id),
        title: t.title || "", status: t.status || "todo", priority: t.priority || "normal",
        projectName: t.projectName || t.project_name || null, dueAt: t.dueAt || t.due_at || null,
        createdAt: t.createdAt || t.created_at || null, updatedAt: t.updatedAt || t.updated_at || null, notes: t.notes || null,
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
        resolvedAssignees: t.resolvedOwner ? [t.resolvedOwner] : null,
        _trackingRole: "assignee" as TrackingRole,
      }, t));
    }

    for (const t of (allTaskData.operational || [])) {
      if (t.parentTaskId) continue;
      result.push(withSourceMeta({
        _key: `op-${t.id}`, _source: "operational", _sourceLabel: "Project",
        _sourceColor: "bg-emerald-50 border-emerald-200 text-emerald-700", _rawId: safeId(t.id), id: safeId(t.id),
        title: t.title || "", status: normalizeStatus(t.status), priority: normalizePriority(t.priority),
        projectName: t.projectName || t.project_name || null, dueAt: t.dueDate || t.due_date || null,
        createdAt: t.createdAt || t.created_at || null, updatedAt: t.updatedAt || t.updated_at || null, notes: t.description || t.comment || null,
        subtaskCount: t.subtaskCount || 0, parentTaskId: t.parentTaskId || t.parent_task_id || null,
        percentComplete: t.percentComplete || t.percent_complete || 0, assignees: t.assignees || null,
        resolvedAssignees: t.resolvedAssignees || null, description: t.description || null,
        _trackingRole: t.trackingRole || "assignee",
      }, t));
    }

    for (const a of (allTaskData.approvals?.engineering || [])) {
      result.push(withSourceMeta({
        _key: `approval-eng-${a.id}`, _source: "approvals", _sourceLabel: "Eng Approval",
        _sourceColor: "bg-amber-50 border-amber-200 text-amber-700", _rawId: safeId(a.id), id: safeId(a.id),
        title: a.title || "", status: normalizeStatus(a.status), priority: "high",
        projectName: a.projectName || null, dueAt: null, createdAt: a.createdAt || null, notes: null,
      }, a));
    }
    for (const a of (allTaskData.approvals?.quality || [])) {
      result.push(withSourceMeta({
        _key: `approval-qc-${a.id}`, _source: "approvals", _sourceLabel: "QC Review",
        _sourceColor: "bg-amber-50 border-amber-200 text-amber-700", _rawId: safeId(a.id), id: safeId(a.id),
        title: a.title || "", status: normalizeStatus(a.status), priority: "high",
        projectName: a.projectName || null, dueAt: null, createdAt: a.createdAt || null, notes: null,
      }, a));
    }
    for (const a of (allTaskData.approvals?.general || [])) {
      result.push(withSourceMeta({
        _key: `approval-gen-${a.id}`, _source: "approvals", _sourceLabel: "Approval",
        _sourceColor: "bg-amber-50 border-amber-200 text-amber-700", _rawId: safeId(a.id), id: safeId(a.id),
        title: a.title || "", status: normalizeStatus(a.status), priority: "high",
        projectName: a.projectName || null, dueAt: null, createdAt: a.createdAt || null, notes: null,
      }, a));
    }

    for (const t of (allTaskData.trRegister || [])) {
      result.push(withSourceMeta({
        _key: `tr-${t.id}`, _source: "tr_register", _sourceLabel: "Action",
        _sourceColor: "bg-purple-50 border-purple-200 text-purple-700", _rawId: safeId(t.id), id: safeId(t.id),
        title: t.actionDescription || "", status: normalizeStatus(t.status),
        priority: t.ragStatus === "Red" ? "critical" : t.ragStatus === "Amber" ? "high" : "normal",
        projectName: null, dueAt: t.dueDate || t.due_date || null,
        createdAt: t.createdAt || t.created_at || null, updatedAt: t.updatedAt || t.updated_at || null, notes: t.outcomeComments || t.supportingInfo || null,
        ragStatus: t.ragStatus || null, owners: t.owners || null, resolvedOwners: t.resolvedOwners || null,
        trId: t.trId || null, department: t.department || null,
        _trackingRole: t.trackingRole || "assignee",
      }, t));
    }

    for (const d of (allTaskData.deliverables || [])) {
      result.push(withSourceMeta({
        _key: `del-${d.id}`, _source: "deliverables", _sourceLabel: "Deliverable",
        _sourceColor: "bg-rose-50 border-rose-200 text-rose-700", _rawId: safeId(d.id), id: safeId(d.id),
        title: d.title || "", status: normalizeStatus(d.status), priority: "normal",
        projectName: d.projectName || d.project_name || null, dueAt: null,
        createdAt: d.createdAt || d.created_at || null, updatedAt: d.updatedAt || d.updated_at || null, notes: null,
        deliverableType: d.deliverableType || d.deliverable_type || null, deliverableStatus: d.status || null,
      }, d));
    }

    for (const t of (allTaskData.planTasks || [])) {
      result.push(withSourceMeta({
        _key: `plan-${t.id}`, _source: "plan", _sourceLabel: "Project Plan",
        _sourceColor: "bg-violet-50 border-violet-200 text-violet-700", _rawId: safeId(t.id), id: safeId(t.id),
        title: t.title || "", status: normalizeStatus(t.status), priority: "normal",
        projectName: t.projectName || null, dueAt: t.endDate || null, createdAt: null,
        notes: t.phase ? `Phase: ${t.phase}` : null,
        percentComplete: t.pctComplete ? Math.round(t.pctComplete * 100) : 0,
        assignees: t.owner ? [t.owner] : null, resolvedAssignees: t.resolvedAssignee ? [t.resolvedAssignee] : null,
        _trackingRole: t.trackingRole || "assignee",
      }, t));
    }

    for (const t of (allTaskData.engineeringTasks || [])) {
      result.push(withSourceMeta({
        _key: `eng-${t.id}`, _source: "engineering_task", _sourceLabel: "Engineering",
        _sourceColor: "bg-cyan-50 border-cyan-200 text-cyan-700", _rawId: safeId(t.id), id: safeId(t.id),
        title: t.title || "", status: normalizeStatus(t.status), priority: "normal",
        projectName: t.projectName || null, dueAt: null, createdAt: null,
        notes: t.lifecyclePhase ? `Phase: ${t.lifecyclePhase}` : null,
        assignees: t.assigneeName ? [t.assigneeName] : null, resolvedAssignees: t.resolvedAssignee ? [t.resolvedAssignee] : null,
      }, t));
    }

    for (const t of (allTaskData.qualityTasks || [])) {
      result.push(withSourceMeta({
        _key: `qc-${t.id}`, _source: "quality_task", _sourceLabel: "Quality",
        _sourceColor: "bg-rose-50 border-rose-200 text-rose-700", _rawId: safeId(t.id), id: safeId(t.id),
        title: t.title || "", status: normalizeStatus(t.status), priority: "normal",
        projectName: t.projectName || null, dueAt: t.endDate || null, createdAt: null, notes: null,
        resolvedAssignees: t.resolvedAssignee ? [t.resolvedAssignee] : null,
      }, t));
    }

    for (const n of (unreadNotifs.items || [])) {
      result.push(withSourceMeta({
        _key: `notif-${n.id}`, _source: "notifications", _sourceLabel: "Notification",
        _sourceColor: "bg-orange-50 border-orange-200 text-orange-700", _rawId: safeId(n.id), id: safeId(n.id),
        title: n.title || "", status: "todo" as TaskStatus,
        priority: n.eventType === "excel_sync_confirmation" ? "normal" : "high",
        projectName: n.projectName || n.project_name || null, dueAt: null,
        createdAt: n.createdAt || n.created_at || null, updatedAt: n.updatedAt || n.updated_at || null, notes: n.body || null,
      }, n));
    }

    for (const item of microsoftItems) {
      result.push(withSourceMeta({
        _key: `ms-${item.id}`, _source: "microsoft", _sourceLabel: "Microsoft",
        _sourceColor: "bg-indigo-50 border-indigo-200 text-indigo-700", _rawId: safeId(item.id), id: safeId(item.id),
        title: item.subjectOrTitle || item.subject_or_title || "", status: "todo" as TaskStatus, priority: "normal",
        projectName: item.linkedProjectName || item.linked_project_name || null, dueAt: null,
        createdAt: item.receivedOrStartDatetime || item.received_or_start_datetime || null, notes: item.preview || null,
      }, item));
    }

    return result;
  }, [allTaskData, unreadNotifs, microsoftItems]);

  const unifiedDetailTaskFresh = useMemo(() => {
    if (!unifiedDetailOpen || !unifiedDetailTask) return unifiedDetailTask;
    return unifiedTasks.find(t => t._key === unifiedDetailTask._key) || unifiedDetailTask;
  }, [unifiedTasks, unifiedDetailOpen, unifiedDetailTask?._key]);

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-work/all-tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/mytool/tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications", "unread-tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ms-objects/mine", "action_required_tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tr-register"] });
  }, []);

  const createTaskMutation = useMutation({
    mutationFn: async ({ body, requestId }: { body: Record<string, unknown>; requestId: string }) => {
      const res = await apiRequest("POST", "/api/mytool/tasks", body, { headers: { "x-idempotency-key": requestId } });
      return res.json();
    },
    onSuccess: (data: any) => {
      invalidateAll();
      toast({
        title: data?.idempotentReplay ? "Task already created" : "Task created",
        description: data?.idempotentReplay ? "Duplicate submit ignored and existing task returned." : "Your task was successfully created.",
      });
    },
    onError: (err: any) => {
      const message = err?.message || "Failed to create task";
      toast({ title: "Failed to create task", description: message, variant: "destructive" });
    },
    onSettled: () => {
      createTaskSubmitLockRef.current = false;
      createTaskRequestIdRef.current = null;
    },
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
        const trStatus = newStatus === "complete" ? "Completed" : "Active";
        const endpoint = newStatus === "complete" ? `/api/tr-register/${task._rawId}/complete` : `/api/tr-register/${task._rawId}`;
        const res = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify(newStatus === "complete" ? {} : { status: trStatus }) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || "Failed to update"); }
      } else if (task._source === "operational") {
        const blockedReason = getTaskWorkflowBlockReason(task as any, newStatus);
        if (blockedReason) throw new Error(blockedReason);
        const res = await fetch(`/api/operational-tasks/${task._rawId}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ status: newStatus }) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || "Failed to update"); }
      } else if (task._source === "engineering_task") {
        const engStatus = newStatus === "complete" ? "DONE" : newStatus === "in_progress" ? "IN PROGRESS" : newStatus === "blocked" ? "BLOCKED" : "TO DO";
        const res = await fetch(`/api/task-checklist-items/${task._rawId}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ status: engStatus }) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || "Failed to update"); }
      } else if (task._source === "quality_task") {
        const qmStatus = newStatus === "complete" ? "pass" : newStatus === "blocked" ? "fail" : newStatus === "in_progress" ? "in_progress" : "review";
        const res = await fetch(`/api/quality/project/${encodeURIComponent(task.projectName || "unknown")}/item/${task._rawId}`, { method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ qmStatus }) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || "Failed to update"); }
      } else if (task._source === "plan") {
        const planStatus = newStatus === "complete" ? "Done" : newStatus === "in_progress" ? "In Progress" : newStatus === "blocked" ? "Blocked" : "Not Started";
        const pct = newStatus === "complete" ? 100 : undefined;
        const res = await fetch(`/api/planning-tasks/${task._rawId}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ projectName: task.projectName || "", status: planStatus, ...(pct !== undefined ? { percentComplete: pct } : {}) }) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || "Failed to update"); }
      }
    },
    onSuccess: () => { invalidateAll(); toast({ title: "Status updated" }); },
    onError: (err: any) => { toast({ title: err.message || "Failed to update status", variant: "destructive" }); },
  });

  const dismissNotifMutation = useMutation({
    mutationFn: async (task: UnifiedTask) => {
      if (task._key.startsWith("ms-")) {
        const res = await fetch(`/api/ms-objects/${task._rawId}/dismiss`, { method: "PATCH", headers: { ...getAuthHeaders() }, credentials: "include" });
        if (!res.ok) throw new Error("Failed to dismiss");
      } else if (task._key.startsWith("notif-")) {
        const res = await fetch("/api/notifications/mark-read", { method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ notificationIds: [task._rawId] }) });
        if (!res.ok) throw new Error("Failed to dismiss");
      }
    },
    onSuccess: () => { invalidateAll(); toast({ title: "Notification dismissed" }); },
    onError: () => { toast({ title: "Failed to dismiss", variant: "destructive" }); },
  });

  const handleCreateTask = useCallback(() => {
    if (!newTask.title.trim()) return;
    if (createTaskSubmitLockRef.current || createTaskMutation.isPending || createTrItemMutation.isPending) {
      return;
    }
    if (newTask.type === "action") {
      createTrItemMutation.mutate({
        actionDescription: newTask.title.trim(),
        department: newTask.department || "Engineering",
        ragStatus: newTask.ragStatus || "Green",
        dueDate: newTask.dueDate || null,
        owners: newTask.assignees.length > 0 ? newTask.assignees.map(a => a.name) : (user?.name ? [user.name] : []),
        ownerUserIds: newTask.assignees.length > 0 ? newTask.assignees.map(a => a.id) : (user?.id ? [user.id] : []),
        status: "Active",
        supportingInfo: newTask.description || "",
      });
    } else {
      createTaskSubmitLockRef.current = true;
      const requestId = createTaskRequestIdRef.current || createTaskRequestId();
      createTaskRequestIdRef.current = requestId;
      createTaskMutation.mutate({
        requestId,
        body: {
          title: newTask.title.trim(),
          priority: newTask.priority,
          status: newTask.status,
          dueAt: newTask.dueDate || null,
          projectName: newTask.projectName || null,
          department: newTask.department || null,
          notes: newTask.description || null,
          clientRequestId: requestId,
        },
      });
    }
    setNewTask({ title: "", description: "", priority: "normal", status: "todo", dueDate: "", projectName: "", department: "", ragStatus: "", type: "personal", assignees: [] as { id: number; name: string }[] });
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

  const handleOpenSource = useCallback((task: UnifiedTask) => {
    const href = task.sourceHref || (task._source === "personal" ? `/my-work/tasks?itemKey=${encodeURIComponent(task._key)}` : null);
    if (!href) {
      handleOpenDrawer(task);
      return;
    }

    if (isExternalHref(href)) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }

    navigate(href);
  }, [handleOpenDrawer, navigate]);

  useEffect(() => {
    if (typeof window === "undefined" || unifiedTasks.length === 0) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const itemKey = params.get("itemKey");
    if (!itemKey || itemKey === openedQueryItemKeyRef.current) {
      return;
    }

    const target = unifiedTasks.find((task) => task._key === itemKey);
    if (!target) {
      return;
    }

    openedQueryItemKeyRef.current = itemKey;
    handleOpenDrawer(target);

    params.delete("itemKey");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash || ""}`;
    window.history.replaceState({}, "", nextUrl);
  }, [handleOpenDrawer, unifiedTasks]);

  const allProjects = useMemo(() => {
    const set = new Set<string>();
    unifiedTasks.forEach(t => { if (t.projectName) set.add(t.projectName); });
    projectNames.forEach((p: string) => set.add(p));
    return Array.from(set).sort();
  }, [unifiedTasks, projectNames]);

  const isTaskOverdue = useCallback((task: UnifiedTask) => isTaskOverdueLogic(task), []);

  const isDueSoon = useCallback((task: UnifiedTask) => isTaskDueSoon(task), []);

  const taskTypeLabel = useCallback((task: UnifiedTask) => {
    if (task.sourceTypeLabel) return task.sourceTypeLabel;
    if (task._source === "approvals") return task._key.startsWith("approval-qc-") ? "Quality Approval" : "Engineering Approval";
    return task._sourceLabel;
  }, []);

  const isTaskAssignedToCurrentUser = useCallback((task: UnifiedTask) => {
    const me = (user?.name || "").trim().toLowerCase();
    const myUsername = (user?.username || "").trim().toLowerCase();
    if (!me && !myUsername) return false;
    return getTaskAssigneeNames(task).some((name) => {
      const lower = name.toLowerCase();
      return lower === me || lower === myUsername || lower.startsWith(me + " ") || lower === me.split(" ")[0];
    });
  }, [user?.name, user?.username]);

  const canReassignTask = useCallback((task: UnifiedTask) => canReassignTaskByRole(task, user?.role || ""), [user?.role]);

  const filteredTasks = useMemo(() => {
    let result = [...unifiedTasks];
    if (sourceFilter === "tracking") {
      result = result.filter(t => t._trackingRole === "creator" || t._trackingRole === "both" || t._trackingRole === "viewer");
    } else if (sourceFilter !== "all") {
      result = result.filter(t => t._source === sourceFilter);
    }

    if (debouncedSearch.trim()) {
      const lower = debouncedSearch.toLowerCase();
      result = result.filter(t => {
        const assigneeText = getTaskAssigneeNames(t).join(" ").toLowerCase();
        return t.title.toLowerCase().includes(lower)
          || (t.projectName && t.projectName.toLowerCase().includes(lower))
          || (t.notes && t.notes.toLowerCase().includes(lower))
          || (t.description && t.description.toLowerCase().includes(lower))
          || (t.trId && t.trId.toLowerCase().includes(lower))
          || assigneeText.includes(lower);
      });
    }

    if (statusFilter.length > 0) result = result.filter(t => statusFilter.includes(t.status));
    if (priorityFilter.length > 0) result = result.filter(t => priorityFilter.includes(t.priority));
    if (projectFilter) result = result.filter(t => t.projectName === projectFilter);
    if (overdueOnly) result = result.filter(t => isTaskOverdue(t));
    if (dueThisWeekOnly) result = result.filter(t => isDueSoon(t));
    if (blockedOnly) result = result.filter(t => t.status === "blocked");
    if (assignedScope === "assigned_to_me") result = result.filter(t => isTaskAssignedToCurrentUser(t));
    if (assignedScope === "unassigned") result = result.filter(t => getTaskAssigneeNames(t).length === 0);
    if (assignedScope === "created_by_me") result = result.filter(t => t._trackingRole === "creator" || t._trackingRole === "both");
    if (groomMode) result = result.filter(t => t.status !== "complete" && t.status !== "done" && t.status !== "cancelled" && (!t.nextStep || !t.nextStep.trim() || !t.definitionOfDone || !t.definitionOfDone.trim()));
    if (!showCompleted && statusFilter.length === 0) {
      result = result.filter(t => t.status !== "complete" && t.status !== "done" && t.status !== "cancelled");
    }

    result.sort((a, b) => {
      let cmp = 0;
      const aOverdue = isTaskOverdue(a) ? 1 : 0;
      const bOverdue = isTaskOverdue(b) ? 1 : 0;
      if (aOverdue !== bOverdue) return bOverdue - aOverdue;

      const aDueSoon = isDueSoon(a) ? 1 : 0;
      const bDueSoon = isDueSoon(b) ? 1 : 0;
      if (aDueSoon !== bDueSoon) return bDueSoon - aDueSoon;

      const priorityCmp = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
      if (sortField === "smart" && priorityCmp !== 0) return priorityCmp;

      const aBlocked = a.status === "blocked" ? 1 : 0;
      const bBlocked = b.status === "blocked" ? 1 : 0;
      if (aBlocked !== bBlocked) return bBlocked - aBlocked;

      switch (sortField) {
        case "smart":
        case "priority":
          cmp = priorityCmp;
          if (cmp === 0) cmp = (a.dueAt || "9999").localeCompare(b.dueAt || "9999");
          break;
        case "status": cmp = (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2); break;
        case "dueDate": cmp = (a.dueAt || "9999").localeCompare(b.dueAt || "9999"); break;
        case "createdAt": cmp = (b.createdAt || "").localeCompare(a.createdAt || ""); break;
      }
      return sortDirection === "desc" ? -cmp : cmp;
    });

    return result;
  }, [unifiedTasks, sourceFilter, debouncedSearch, statusFilter, priorityFilter, projectFilter, overdueOnly, dueThisWeekOnly, blockedOnly, assignedScope, groomMode, showCompleted, sortField, sortDirection, isTaskOverdue, isDueSoon, isTaskAssignedToCurrentUser]);

  const sourceCounts = useMemo(() => {
    const counts: Record<SourceFilter, number> = { all: 0, personal: 0, operational: 0, plan: 0, engineering_task: 0, quality_task: 0, approvals: 0, tr_register: 0, tracking: 0, deliverables: 0, notifications: 0, microsoft: 0 };
    for (const t of unifiedTasks) {
      if (counts[t._source] !== undefined) counts[t._source]++;
      if (t._trackingRole === "creator" || t._trackingRole === "both" || t._trackingRole === "viewer") counts.tracking++;
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
    setSortField("smart");
    setSortDirection("asc");
    setSourceFilter("all");
    toast({ title: "Default view reset" });
  }, [toast, user?.id]);

  const kpiStats = useMemo(() => {
    const active = unifiedTasks.filter(t => t.status !== "complete" && t.status !== "done" && t.status !== "cancelled");
    const overdue = active.filter(t => isTaskOverdue(t));
    const critical = active.filter(t => t.priority === "critical" || t.priority === "high");
    const done = unifiedTasks.filter(t => t.status === "complete" || t.status === "done");
    const blocked = active.filter(t => t.status === "blocked");
    const inProgress = active.filter(t => t.status === "in_progress");
    const dueToday = active.filter(t => { try { return t.dueAt && differenceInCalendarDays(parseISO(t.dueAt), startOfDay(new Date())) === 0; } catch { return false; } });
    const dueSoon = active.filter(t => { try { if (!t.dueAt) return false; const diff = differenceInCalendarDays(parseISO(t.dueAt), startOfDay(new Date())); return diff >= 0 && diff <= 3; } catch { return false; } });
    const dueThisWeek = active.filter(t => { try { if (!t.dueAt) return false; const diff = differenceInCalendarDays(parseISO(t.dueAt), startOfDay(new Date())); return diff >= 0 && diff <= 7; } catch { return false; } });
    const approvalsPending = active.filter(t => t._source === "approvals" || t.status === "review");
    const completionRate = unifiedTasks.length > 0 ? Math.round((done.length / unifiedTasks.length) * 100) : 0;
    return { total: unifiedTasks.length, active: active.length, overdue: overdue.length, critical: critical.length, done: done.length, blocked: blocked.length, inProgress: inProgress.length, dueToday: dueToday.length, dueSoon: dueSoon.length, dueThisWeek: dueThisWeek.length, approvalsPending: approvalsPending.length, completionRate };
  }, [unifiedTasks, isTaskOverdue]);

  const activeFilters = statusFilter.length + priorityFilter.length + (projectFilter ? 1 : 0) + (overdueOnly ? 1 : 0) + (dueThisWeekOnly ? 1 : 0) + (blockedOnly ? 1 : 0) + (assignedScope !== "all" ? 1 : 0);

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
    const newStatus = colKey;
    boardStatusMutation.mutate({ task: draggedTask, newStatus });
    setDraggedTask(null);
  }, [draggedTask, boardStatusMutation]);

  if (isLoading) {
    return (
      <PageShell className="max-w-6xl p-4 md:p-6" data-testid="my-work-tasks-page">
        <SectionHeader
          icon={<ListTodo className="h-5 w-5" />}
          eyebrow="My Work"
          title="My Tasks"
          description="Loading personal, project, and Microsoft-linked tasks..."
        />
        <div className="space-y-2" data-testid="loading-skeleton">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-8 w-full rounded-lg" />
          <div className="space-y-1">{[1, 2, 3, 4, 5, 6, 7, 8].map(i => (<Skeleton key={i} className="h-10 w-full rounded" />))}</div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell className="max-w-6xl p-4 md:p-6" data-testid="my-work-tasks-page">

      <div className="shrink-0 mb-3" data-testid="tasks-header">
        <SectionHeader
          icon={<ListTodo className="h-5 w-5" />}
          eyebrow="My Work"
          title="My Tasks"
          description="Your single action workspace for personal work, project delivery items, and Microsoft-linked follow-ups."
          badges={[
            { label: `${filteredTasks.length} visible`, icon: <ListTodo className="h-3.5 w-3.5" /> },
            { label: `${kpiStats.overdue} overdue`, icon: <AlertCircle className="h-3.5 w-3.5" /> },
            { label: `${microsoftItems.length} Microsoft items`, icon: <Link2 className="h-3.5 w-3.5" /> },
          ]}
          actions={
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="flex items-center border rounded-md overflow-hidden">
                <button onClick={() => setViewMode("list")} className={`p-1.5 transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`} data-testid="btn-view-list" title="List view"><LayoutList className="h-3.5 w-3.5" /></button>
                <button onClick={() => setViewMode("board")} className={`p-1.5 transition-colors ${viewMode === "board" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`} data-testid="btn-view-board" title="Board view"><Columns3 className="h-3.5 w-3.5" /></button>
              </div>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 hidden sm:inline-flex" onClick={handleSaveDefaultView} data-testid="btn-save-default-view" title="Save default"><Save className="h-3 w-3" /></Button>
              {hasCustomDefault && <Button variant="ghost" size="sm" className="h-7 px-1.5 text-xs text-muted-foreground hidden sm:inline-flex" onClick={handleResetDefaultView} data-testid="btn-reset-default-view" title="Reset default"><RotateCw className="h-3 w-3" /></Button>}
              <Button variant={showCompleted ? "default" : "ghost"} size="sm" className={`h-7 text-xs px-2 gap-1 hidden sm:inline-flex ${showCompleted ? "bg-emerald-500 hover:bg-emerald-600 text-white" : ""}`} onClick={() => setShowCompleted(!showCompleted)} data-testid="button-show-completed"><CheckCircle2 className="h-3 w-3" /><span>{showCompleted ? `Done (${kpiStats.done})` : "Show Done"}</span></Button>
              <Button variant={groomMode ? "default" : "ghost"} size="sm" className={`h-7 text-xs px-2 gap-1 hidden sm:inline-flex ${groomMode ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}`} onClick={() => setGroomMode(!groomMode)} data-testid="button-groom-mode"><Eye className="h-3 w-3" /><span>{groomMode ? "Grooming" : "Groom"}</span></Button>
              <Button size="sm" className="h-7 gap-1 text-xs shadow-sm" onClick={() => setCreateDialogOpen(true)} data-testid="button-new-task"><Plus className="h-3.5 w-3.5" /> <span className="hidden xs:inline">New</span></Button>
            </div>
          }
        />
        <span className="sr-only" data-testid="text-tasks-title">My Tasks</span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="kpi-cards">
          <div className="relative overflow-hidden rounded-xl border border-border bg-card p-3.5 shadow-sm" data-testid="kpi-active">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Active</p>
                <p className="text-2xl font-bold mt-1 text-foreground tabular-nums">{kpiStats.active}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{kpiStats.inProgress} in progress</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600"><ListTodo className="h-4 w-4" /></div>
            </div>
            {kpiStats.dueToday > 0 && <div className="mt-2 text-[10px] font-semibold bg-emerald-50 text-emerald-700 rounded px-1.5 py-0.5 inline-flex items-center gap-1"><Zap className="h-2.5 w-2.5" /> {kpiStats.dueToday} due today</div>}
          </div>

          <button onClick={() => setOverdueOnly(!overdueOnly)} className={`relative overflow-hidden rounded-xl border p-3.5 text-left shadow-sm transition-all hover:shadow-md ${kpiStats.overdue > 0 ? "border-red-200/80 bg-card" : "border-border bg-card"} ${overdueOnly ? "ring-2 ring-primary ring-offset-1" : ""}`} data-testid="kpi-overdue">
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-[10px] font-semibold uppercase tracking-widest ${kpiStats.overdue > 0 ? "text-red-600" : "text-muted-foreground"}`}>Overdue</p>
                <p className={`text-2xl font-bold mt-1 tabular-nums ${kpiStats.overdue > 0 ? "text-red-600" : "text-foreground"}`}>{kpiStats.overdue}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{kpiStats.blocked} blocked</p>
              </div>
              <div className={`rounded-lg p-2 ${kpiStats.overdue > 0 ? "bg-red-50 text-red-500" : "bg-muted text-muted-foreground"}`}><AlertCircle className="h-4 w-4" /></div>
            </div>
            {overdueOnly && <div className="mt-2 text-[10px] font-semibold bg-primary/10 text-primary rounded px-1.5 py-0.5 inline-flex items-center gap-1"><Filter className="h-2.5 w-2.5" /> Filtering</div>}
          </button>

          <div className="relative overflow-hidden rounded-xl border border-border bg-card p-3.5 shadow-sm" data-testid="kpi-critical">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">High Priority</p>
                <p className="text-2xl font-bold mt-1 text-foreground tabular-nums">{kpiStats.critical}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{kpiStats.dueSoon} due within 3d</p>
              </div>
              <div className="rounded-lg bg-amber-50 p-2 text-amber-500"><AlertTriangle className="h-4 w-4" /></div>
            </div>
          </div>

          <div className={`relative overflow-hidden rounded-xl border p-3.5 shadow-sm ${kpiStats.dueThisWeek > 0 ? "border-border bg-card" : "border-border bg-card"}`} data-testid="kpi-due-this-week">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Due This Week</p>
                <p className="text-2xl font-bold mt-1 text-foreground tabular-nums">{kpiStats.dueThisWeek}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{kpiStats.approvalsPending} awaiting review</p>
              </div>
              <div className={`rounded-lg p-2 ${kpiStats.dueThisWeek > 0 ? "bg-blue-50 text-blue-500" : "bg-muted text-muted-foreground"}`}><Target className="h-4 w-4" /></div>
            </div>
          </div>
        </div>
      </div>

      {(activeFilters > 0 || sourceFilter !== "all" || overdueOnly || dueThisWeekOnly || blockedOnly || groomMode || showCompleted) && (
        <div className="shrink-0 flex items-center gap-1.5 mb-1.5 px-2 py-1 rounded-md bg-emerald-50/60 border border-emerald-200/50 text-[10px] text-emerald-800" data-testid="active-filter-summary">
          <Filter className="h-3 w-3 shrink-0" />
          <span className="font-medium">Showing:</span>
          {sourceFilter !== "all" && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-white/70">{SOURCE_CONFIG[sourceFilter]?.shortLabel}</Badge>}
          {statusFilter.length > 0 && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-white/70">{statusFilter.length} status</Badge>}
          {priorityFilter.length > 0 && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-white/70">{priorityFilter.length} priority</Badge>}
          {projectFilter && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-white/70 truncate max-w-[100px]">{projectFilter.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</Badge>}
          {overdueOnly && <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">Overdue</Badge>}
          {dueThisWeekOnly && <Badge className="text-[9px] px-1 py-0 h-4 bg-emerald-600 text-white">Due 7d</Badge>}
          {blockedOnly && <Badge className="text-[9px] px-1 py-0 h-4 bg-orange-500 text-white">Blocked</Badge>}
          {showCompleted && <Badge className="text-[9px] px-1 py-0 h-4 bg-emerald-500 text-white">+Done</Badge>}
          {groomMode && <Badge className="text-[9px] px-1 py-0 h-4 bg-amber-500">Groom</Badge>}
          <span className="text-muted-foreground ml-auto">{filteredTasks.length} task{filteredTasks.length !== 1 ? "s" : ""}</span>
        </div>
      )}

      <div className="shrink-0 space-y-2.5 mb-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search tasks..." value={searchText} onChange={e => setSearchText(e.target.value)} className="pl-9 h-9 text-sm rounded-lg border-border/80 bg-card shadow-sm" data-testid="input-task-search" />
            {searchText && <button onClick={() => setSearchText("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <Button variant={showFilters ? "secondary" : "ghost"} size="sm" className="h-7 px-2 text-xs" onClick={() => setShowFilters(!showFilters)} data-testid="button-toggle-filters">
              <Filter className="h-3 w-3" /> {activeFilters > 0 && <span className="ml-0.5 text-[10px] bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center">{activeFilters}</span>}
            </Button>
            {(["smart", "priority", "dueDate", "status"] as SortField[]).map(field => (
              <button key={field} onClick={() => handleSort(field)} className={`px-1.5 py-1 rounded text-[10px] font-medium transition-colors ${sortField === field ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`} data-testid={`sort-${field}`}>
                {field === "smart" ? "Smart" : field === "priority" ? "Pri" : field === "dueDate" ? "Due" : "Stat"}
                {sortField === field && <span className="ml-0.5">{sortDirection === "asc" ? "↑" : "↓"}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto pb-1 -mb-1 scrollbar-thin" data-testid="source-filter-tabs">
          {(Object.keys(SOURCE_CONFIG) as SourceFilter[]).map(src => {
            const config = SOURCE_CONFIG[src]; const count = sourceCounts[src]; const active = sourceFilter === src;
            if (count === 0 && src !== "all") return null;
            return (
              <button key={src} onClick={() => setSourceFilter(src)} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all whitespace-nowrap border ${active ? "bg-emerald-600 text-white border-emerald-600 shadow-sm" : "text-muted-foreground hover:bg-muted border-transparent"}`} data-testid={`tab-source-${src}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-white/70" : config.dot}`} />
                {config.shortLabel} {count > 0 && <span className={`text-[10px] ${active ? "opacity-80" : "opacity-50"}`}>{count}</span>}
              </button>
            );
          })}
          <div className="w-px h-4 bg-border mx-1 shrink-0" />
          <button onClick={() => { setOverdueOnly(!overdueOnly); if (!overdueOnly) { setDueThisWeekOnly(false); setBlockedOnly(false); } }} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap border transition-all ${overdueOnly ? "bg-red-500 text-white border-red-500" : kpiStats.overdue > 0 ? "text-red-600 border-red-200 hover:bg-red-50" : "text-muted-foreground border-transparent hover:bg-muted"}`} data-testid="quick-filter-overdue">
            <AlertCircle className="h-3 w-3" /> Overdue {kpiStats.overdue > 0 && <span className="opacity-80">{kpiStats.overdue}</span>}
          </button>
          <button onClick={() => { setDueThisWeekOnly(!dueThisWeekOnly); if (!dueThisWeekOnly) { setOverdueOnly(false); setBlockedOnly(false); } }} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap border transition-all ${dueThisWeekOnly ? "bg-emerald-600 text-white border-emerald-600" : kpiStats.dueThisWeek > 0 ? "text-emerald-700 border-emerald-200 hover:bg-emerald-50" : "text-muted-foreground border-transparent hover:bg-muted"}`} data-testid="quick-filter-due-week">
            <Target className="h-3 w-3" /> Due 7d {kpiStats.dueThisWeek > 0 && <span className="opacity-80">{kpiStats.dueThisWeek}</span>}
          </button>
          <button onClick={() => { setBlockedOnly(!blockedOnly); if (!blockedOnly) { setOverdueOnly(false); setDueThisWeekOnly(false); } }} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap border transition-all ${blockedOnly ? "bg-orange-500 text-white border-orange-500" : kpiStats.blocked > 0 ? "text-orange-600 border-orange-200 hover:bg-orange-50" : "text-muted-foreground border-transparent hover:bg-muted"}`} data-testid="quick-filter-blocked">
            <AlertTriangle className="h-3 w-3" /> Blocked {kpiStats.blocked > 0 && <span className="opacity-80">{kpiStats.blocked}</span>}
          </button>
          <div className="w-px h-4 bg-border mx-1 shrink-0" />
          {[
            { key: "all", label: "All" },
            { key: "assigned_to_me", label: "Assigned to me" },
            { key: "unassigned", label: "Unassigned" },
            { key: "created_by_me", label: "Created by me" },
          ].map((scope) => (
            <button
              key={scope.key}
              onClick={() => setAssignedScope(scope.key as typeof assignedScope)}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap border transition-all ${assignedScope === scope.key ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-transparent hover:bg-muted"}`}
              data-testid={`quick-filter-assigned-${scope.key}`}
            >
              {scope.label}
            </button>
          ))}
        </div>
      </div>

      {(overdueOnly || dueThisWeekOnly || blockedOnly || assignedScope !== "all") && (
        <div className="shrink-0 mb-1.5 flex gap-1">
          {overdueOnly && <Badge variant="destructive" className="cursor-pointer gap-1 text-[10px]" onClick={() => setOverdueOnly(false)} data-testid="badge-overdue-filter">
            <AlertCircle className="h-3 w-3" /> Overdue only <X className="h-3 w-3 ml-1" />
          </Badge>}
          {dueThisWeekOnly && <Badge className="cursor-pointer gap-1 text-[10px] bg-emerald-600 hover:bg-emerald-700" onClick={() => setDueThisWeekOnly(false)} data-testid="badge-due-week-filter">
            <Target className="h-3 w-3" /> Due this week <X className="h-3 w-3 ml-1" />
          </Badge>}
          {blockedOnly && <Badge className="cursor-pointer gap-1 text-[10px] bg-orange-500 hover:bg-orange-600" onClick={() => setBlockedOnly(false)} data-testid="badge-blocked-filter">
            <AlertTriangle className="h-3 w-3" /> Blocked only <X className="h-3 w-3 ml-1" />
          </Badge>}
          {assignedScope !== "all" && <Badge variant="outline" className="cursor-pointer gap-1 text-[10px]" onClick={() => setAssignedScope("all")} data-testid="badge-assigned-scope">
            <Users className="h-3 w-3" /> {assignedScope === "assigned_to_me" ? "Assigned to me" : assignedScope === "unassigned" ? "Unassigned" : "Created by me"} <X className="h-3 w-3 ml-1" />
          </Badge>}
        </div>
      )}

      {showFilters && (
        <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-muted/20 mb-2 text-[10px] overflow-x-auto" data-testid="filter-bar">
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
              <SearchableSelect
                value={projectFilter}
                onValueChange={setProjectFilter}
                placeholder="All Projects"
                triggerClassName="h-5 text-[10px] w-[140px] border-border"
                options={[
                  { value: "", label: "All Projects" },
                  ...allProjects.map(p => ({ value: p, label: p.replace(/_Tracker.*$/i, "").replace(/_/g, " ") })),
                ]}
                data-testid="select-project-filter"
              />
            </>
          )}
          {activeFilters > 0 && (<button onClick={() => { setStatusFilter([]); setPriorityFilter([]); setProjectFilter(""); setOverdueOnly(false); setDueThisWeekOnly(false); setBlockedOnly(false); setAssignedScope("all"); }} className="text-[10px] text-red-500 hover:underline ml-1" data-testid="button-clear-all-filters">Clear all</button>)}
        </div>
      )}

      {viewMode === "list" ? (
        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-border bg-card shadow-sm" data-testid="task-list">
          {filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Inbox className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm font-medium">No tasks found</p>
              <p className="text-xs mt-1 opacity-70">{overdueOnly ? "No overdue tasks" : assignedScope !== "all" ? "Try resetting assignment scope" : sourceFilter !== "all" ? "Try 'All' to see everything" : "Click '+ New' to get started"}</p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {filteredTasks.map(task => (
                <CompactTaskRow key={task._key} task={task} isExpanded={expandedTasks.has(task.id)} onToggleExpand={() => task._source === "operational" && task.subtaskCount! > 0 && toggleExpand(task.id)} onPrimaryAction={() => handleOpenSource(task)} onOpenDrawer={() => handleOpenDrawer(task)} onStatusChange={handleStatusChange} onDelete={task._source === "personal" ? () => deleteTaskMutation.mutate(task.id) : undefined} onDismiss={task._source === "notifications" || task._source === "microsoft" ? () => dismissNotifMutation.mutate(task) : undefined} onAddSubtask={task._source === "operational" ? () => setSubtaskDialog({ parentId: task.id, projectName: task.projectName || "" }) : undefined} allTaskData={allTaskData} onSubtaskAddForChild={(parentId: number, projectName: string) => setSubtaskDialog({ parentId, projectName })} isOverdue={isTaskOverdue(task)} onQuickStatus={(newStatus) => boardStatusMutation.mutate({ task, newStatus })} canReassign={canReassignTask(task)} taskTypeLabel={taskTypeLabel(task)} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-x-auto -mx-2 px-2">
          <div className="grid grid-cols-5 gap-2 h-full min-w-[900px] sm:min-w-[1000px]">
            {BOARD_COLUMNS.map(col => {
              const colTasks = filteredTasks.filter(t => {
                if (col.key === "todo") return t.status === "todo" || t.status === "inbox" || t.status === "planned";
                if (col.key === "complete") return t.status === "complete" || t.status === "done" || t.status === "cancelled";
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
                          onClick={() => handleOpenSource(task)}
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
      {unifiedDetailOpen && unifiedDetailTaskFresh && (<TaskDetailPanel task={unifiedDetailTaskFresh} open={unifiedDetailOpen} onOpenChange={setUnifiedDetailOpen} onInvalidate={invalidateAll} allProjects={allProjects} canReassign={canReassignTask(unifiedDetailTaskFresh)} taskTypeLabel={taskTypeLabel(unifiedDetailTaskFresh)} />)}

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
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
                <SearchableSelect
                  value={newTask.priority}
                  onValueChange={v => setNewTask(t => ({ ...t, priority: v as TaskPriority }))}
                  triggerClassName="mt-1 h-7 text-xs"
                  data-testid="select-new-priority"
                  options={[
                    { value: "critical", label: "P1 — Critical" },
                    { value: "high", label: "P2 — High" },
                    { value: "normal", label: "P3 — Normal" },
                    { value: "low", label: "P4 — Low" },
                  ]}
                />
              </div>
              {newTask.type === "personal" && (
                <div>
                  <Label className="text-xs font-medium">Status</Label>
                  <SearchableSelect
                    value={newTask.status}
                    onValueChange={v => setNewTask(t => ({ ...t, status: v as TaskStatus }))}
                    triggerClassName="mt-1 h-7 text-xs"
                    data-testid="select-new-status"
                    options={[
                      { value: "todo", label: "To Do" },
                      { value: "in_progress", label: "In Progress" },
                      { value: "review", label: "Review" },
                      { value: "blocked", label: "Blocked" },
                      { value: "complete", label: "Complete" },
                    ]}
                  />
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
                <SearchableSelect
                  value={newTask.projectName}
                  onValueChange={v => setNewTask(t => ({ ...t, projectName: v === "__none" ? "" : v }))}
                  placeholder="None"
                  triggerClassName="mt-1 h-7 text-xs"
                  data-testid="select-new-project"
                  options={[
                    { value: "__none", label: "None" },
                    ...allProjects.map(p => ({ value: p, label: p.replace(/_Tracker.*$/i, "").replace(/_/g, " ") })),
                  ]}
                />
              </div>
              <div>
                <Label className="text-xs font-medium">Department</Label>
                <SearchableSelect
                  value={newTask.department}
                  onValueChange={v => setNewTask(t => ({ ...t, department: v === "__none" ? "" : v }))}
                  placeholder="None"
                  triggerClassName="mt-1 h-7 text-xs"
                  data-testid="select-new-dept"
                  options={[
                    { value: "__none", label: "None" },
                    ...DEPARTMENTS.map(d => ({ value: d, label: d })),
                  ]}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs font-medium">Assign To</Label>
              <AssignToSelector selected={newTask.assignees} onChange={(a: { id: number; name: string }[]) => setNewTask(t => ({ ...t, assignees: a }))} />
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
            <div><label className="text-xs font-medium text-muted-foreground">Priority</label><SearchableSelect value={newSubtaskPriority} onValueChange={setNewSubtaskPriority} triggerClassName="h-7 text-xs" data-testid="select-subtask-priority" options={[{ value: "High", label: "High" }, { value: "Med", label: "Medium" }, { value: "Low", label: "Low" }]} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSubtaskDialog(null)} data-testid="button-cancel-subtask">Cancel</Button>
            <Button size="sm" onClick={() => { if (newSubtaskTitle.trim() && subtaskDialog) createSubtaskMutation.mutate({ parentId: subtaskDialog.parentId, title: newSubtaskTitle.trim(), priority: newSubtaskPriority }); }} disabled={!newSubtaskTitle.trim() || createSubtaskMutation.isPending} data-testid="button-create-subtask">{createSubtaskMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />} Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function CompactTaskRow({ task, isExpanded, onToggleExpand, onPrimaryAction, onOpenDrawer, onStatusChange, onDelete, onDismiss, onAddSubtask, allTaskData, onSubtaskAddForChild, isOverdue, onQuickStatus, canReassign, taskTypeLabel }: { task: UnifiedTask; isExpanded: boolean; onToggleExpand: () => void; onPrimaryAction: () => void; onOpenDrawer: () => void; onStatusChange: (id: number, status: TaskStatus) => void; onDelete?: () => void; onDismiss?: () => void; onAddSubtask?: () => void; allTaskData: any; onSubtaskAddForChild: (parentId: number, projectName: string) => void; isOverdue: boolean; onQuickStatus: (newStatus: string) => void; canReassign: boolean; taskTypeLabel: string }) {
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
  const isDone = task.status === "complete" || task.status === "done" || task.status === "cancelled";

  const statusDot = task.status === "complete" || task.status === "done" ? "bg-emerald-500" : task.status === "in_progress" ? "bg-blue-500" : task.status === "blocked" ? "bg-red-500" : task.status === "review" ? "bg-amber-500" : task.status === "cancelled" ? "bg-slate-300" : "bg-slate-300";

  const canQuickStatus = ["personal", "operational", "engineering_task", "tr_register", "quality_task", "plan"].includes(task._source);

  const due = smartDueLabel(task.dueAt);
  const dueStyle = DUE_URGENCY_STYLES[due.urgency] || "";

  return (
    <div data-testid={`task-row-${task._key}`}>
      <div className={`flex items-center gap-2 sm:gap-2.5 px-3 sm:px-4 py-2.5 sm:py-3 transition-all hover:bg-muted/30 cursor-pointer group ${isDone ? "opacity-40" : ""} ${isOverdue && !isDone ? "bg-red-50/30 border-l-[3px] border-l-red-400" : ""} ${task.status === "blocked" && !isDone ? "bg-amber-50/20 border-l-[3px] border-l-amber-400" : ""}`} onClick={onPrimaryAction}>

        {task._source === "operational" && (task.subtaskCount || 0) > 0 ? (
          <button onClick={e => { e.stopPropagation(); onToggleExpand(); }} className="shrink-0 p-0.5 rounded hover:bg-muted" data-testid={`btn-expand-${task._key}`}>
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        ) : (
          <div className="shrink-0 w-4" />
        )}

        <button
          onClick={e => { e.stopPropagation(); if (canQuickStatus) onQuickStatus(isDone ? "todo" : "complete"); }}
          className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
            isDone ? "border-emerald-500 bg-emerald-500" : task.status === "in_progress" ? "border-blue-400 bg-blue-50" : task.status === "blocked" ? "border-red-400 bg-red-50" : "border-border hover:border-emerald-400 hover:bg-emerald-50"
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
            <span className="text-[10px] text-muted-foreground/80" data-testid={`badge-type-${task._key}`}>{taskTypeLabel}</span>
            {task.percentComplete !== undefined && task.percentComplete > 0 && (
              <div className="flex items-center gap-1 shrink-0">
                <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${task.percentComplete}%` }} /></div>
                <span className="text-[9px] text-muted-foreground">{task.percentComplete}%</span>
              </div>
            )}
            {task.ragStatus && <span className={`shrink-0 inline-flex items-center gap-0.5 text-[9px] font-medium ${task.ragStatus === "Red" ? "text-red-600" : task.ragStatus === "Amber" ? "text-amber-600" : "text-green-600"}`}><span className={`w-1.5 h-1.5 rounded-full ${task.ragStatus === "Red" ? "bg-red-500" : task.ragStatus === "Amber" ? "bg-amber-500" : "bg-green-500"}`} />{task.ragStatus}</span>}
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground border border-border/50 rounded px-1 py-px" data-testid={`badge-status-${task._key}`}>{task.status.replace("_", " ")}</span>
          </div>
        </div>

        <span className={`shrink-0 hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border ${task._sourceColor}`} data-testid={`badge-source-${task._key}`}>{task._sourceLabel}</span>
        {(task._trackingRole === "creator" || task._trackingRole === "both") && <span className="shrink-0 hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium border bg-teal-50 border-teal-200 text-teal-700" data-testid={`badge-tracking-${task._key}`}><Eye className="h-2.5 w-2.5" />Tracking</span>}
        {task._trackingRole === "viewer" && <span className="shrink-0 hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium border bg-sky-50 border-sky-200 text-sky-700" data-testid={`badge-viewing-${task._key}`}><Eye className="h-2.5 w-2.5" />Viewing</span>}

        {["personal", "operational", "plan", "engineering_task", "quality_task", "tr_register"].includes(task._source) && (
        <div className="hidden sm:block shrink-0" onClick={e => e.stopPropagation()}>
          <UserAssignmentPicker taskId={task._rawId} taskSource={task._source} resolvedUsers={task.resolvedAssignees || task.resolvedOwners || null} textNames={task.assignees || task.owners || null} mode={["operational", "tr_register"].includes(task._source) ? "multi" : "single"} size="xs" invalidateKeys={["/api/my-work/all-tasks", "/api/mytool/tasks", "/api/tr-register"]} disabled={!canReassign} disabledReason="You do not have permission to reassign this task" />
        </div>
        )}

        {due.label && (
          <span className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] tabular-nums ${dueStyle}`} data-testid={`text-due-${task._key}`}>
            <Clock className="h-2.5 w-2.5" />{due.label}
          </span>
        )}

        <div className="shrink-0 flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <button onClick={e => { e.stopPropagation(); onOpenDrawer(); }} className="p-1 rounded text-muted-foreground/40 hover:text-foreground hover:bg-muted" title="Quick details" data-testid={`btn-open-detail-${task._key}`}><Eye className="h-3 w-3" /></button>
          {canQuickStatus && !isDone && (
            <>
              <button onClick={e => { e.stopPropagation(); onQuickStatus("in_progress"); }} className={`p-1 rounded transition-colors ${task.status === "in_progress" ? "text-blue-500 bg-blue-50" : "text-muted-foreground/40 hover:text-blue-500 hover:bg-blue-50"}`} title="In Progress"><Clock className="h-3 w-3" /></button>
              <button onClick={e => { e.stopPropagation(); onQuickStatus("blocked"); }} className={`p-1 rounded transition-colors ${task.status === "blocked" ? "text-red-500 bg-red-50" : "text-muted-foreground/40 hover:text-red-500 hover:bg-red-50"}`} title="Blocked"><AlertCircle className="h-3 w-3" /></button>
            </>
          )}
          {task._source === "operational" && onAddSubtask && <button onClick={e => { e.stopPropagation(); onAddSubtask(); }} className="p-1 rounded text-muted-foreground/40 hover:text-emerald-500 hover:bg-emerald-50" title="Add subtask" data-testid={`btn-add-subtask-${task._key}`}><Plus className="h-3 w-3" /></button>}
          {task._source === "personal" && onDelete && <button onClick={e => { e.stopPropagation(); onDelete(); }} className="p-1 rounded text-muted-foreground/40 hover:text-red-500 hover:bg-red-50" data-testid={`btn-delete-${task._key}`}><Trash2 className="h-3 w-3" /></button>}
          {(task._source === "notifications" || task._source === "microsoft") && onDismiss && <button onClick={e => { e.stopPropagation(); onDismiss(); }} className="p-1 rounded text-muted-foreground/40 hover:text-red-500 hover:bg-red-50" title="Dismiss" data-testid={`btn-dismiss-${task._key}`}><X className="h-3 w-3" /></button>}
        </div>
      </div>

      {isExpanded && displaySubtasks.length > 0 && (
        <div className="ml-8 border-l-2 border-emerald-200 pl-2" data-testid={`subtasks-${task._key}`}>
          {displaySubtasks.map((st: any) => {
            const stStatus = normalizeStatus(st.status);
            const stDone = stStatus === "complete" || stStatus === "done";
            return (
              <div key={st.id} className="flex items-center gap-1.5 px-1.5 py-1 hover:bg-muted/30 text-[12px]" data-testid={`subtask-${st.id}`}>
                <span className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${stDone ? "border-emerald-500 bg-emerald-500" : "border-border"}`}>
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

function ViewerManagement({ taskId, onInvalidate }: { taskId: number; onInvalidate: () => void }) {
  const { toast } = useToast();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerSearch, setViewerSearch] = useState("");
  const viewerInputRef = useRef<HTMLInputElement>(null);

  const { data: allUsers = [] } = useQuery<{ id: number; name: string; username: string; role: string }[]>({
    queryKey: ["/api/users/assignable"],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const h: Record<string, string> = {};
      if (token) h["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/users/assignable", { credentials: "include", headers: h });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60000,
  });

  const { data: viewers = [], refetch: refetchViewers } = useQuery<{ id: number; user_id: number; role: string }[]>({
    queryKey: [`/api/work-items/${taskId}/viewers`],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const h: Record<string, string> = {};
      if (token) h["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/work-items/${taskId}/viewers`, { credentials: "include", headers: h });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30000,
  });

  const addViewerMutation = useMutation({
    mutationFn: async (userId: number) => {
      const token = localStorage.getItem("auth_token");
      const h: Record<string, string> = { "Content-Type": "application/json" };
      if (token) h["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/tasks/reassign", { method: "PATCH", credentials: "include", headers: h, body: JSON.stringify({ taskId, taskSource: "plan_viewer", userId }) });
      if (!res.ok) throw new Error("Failed to add viewer");
    },
    onSuccess: () => { refetchViewers(); onInvalidate(); toast({ title: "Viewer added" }); setViewerOpen(false); },
    onError: () => { toast({ title: "Failed to add viewer", variant: "destructive" }); },
  });

  const removeViewerMutation = useMutation({
    mutationFn: async (userId: number) => {
      const token = localStorage.getItem("auth_token");
      const h: Record<string, string> = { "Content-Type": "application/json" };
      if (token) h["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/tasks/reassign", { method: "PATCH", credentials: "include", headers: h, body: JSON.stringify({ taskId, taskSource: "remove_viewer", userId }) });
      if (!res.ok) throw new Error("Failed to remove viewer");
    },
    onSuccess: () => { refetchViewers(); onInvalidate(); toast({ title: "Viewer removed" }); },
    onError: () => { toast({ title: "Failed to remove viewer", variant: "destructive" }); },
  });

  useEffect(() => {
    if (viewerOpen && viewerInputRef.current) setTimeout(() => viewerInputRef.current?.focus(), 100);
  }, [viewerOpen]);

  const viewerUserIds = new Set(viewers.map(v => v.user_id));
  const filteredUsers = allUsers.filter(u => {
    if (viewerUserIds.has(u.id)) return false;
    if (viewerSearch) {
      const s = viewerSearch.toLowerCase();
      return u.name.toLowerCase().includes(s) || u.username.toLowerCase().includes(s);
    }
    return true;
  });

  const getInitials = (name: string) => name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

  return (
    <div>
      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 block">Viewers</Label>
      <div className="flex items-center gap-1 flex-wrap">
        {viewers.map(v => {
          const user = allUsers.find(u => u.id === v.user_id);
          if (!user) return null;
          return (
            <span key={v.user_id} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-full bg-sky-50 text-sky-700 border border-sky-200 font-medium" data-testid={`viewer-chip-${v.user_id}`}>
              <Eye className="h-3 w-3" />
              {user.name}
              <button onClick={() => removeViewerMutation.mutate(v.user_id)} className="ml-0.5 hover:text-red-600" data-testid={`btn-remove-viewer-${v.user_id}`}><X className="h-3 w-3" /></button>
            </span>
          );
        })}
        {viewers.length === 0 && <span className="text-[10px] text-muted-foreground italic">No viewers</span>}
        <Popover open={viewerOpen} onOpenChange={setViewerOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full hover:bg-sky-50 text-muted-foreground hover:text-sky-600" data-testid="btn-add-viewer" title="Add viewer">
              <UserPlus className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start" side="bottom">
            <div className="flex items-center gap-1.5 mb-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <Input ref={viewerInputRef} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0" placeholder="Search users..." value={viewerSearch} onChange={e => setViewerSearch(e.target.value)} data-testid="input-viewer-search" />
            </div>
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {filteredUsers.map(u => (
                <button key={u.id} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted text-foreground transition-colors" onClick={() => addViewerMutation.mutate(u.id)} data-testid={`btn-add-viewer-${u.id}`}>
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-sky-500 text-white text-[9px] font-bold">{getInitials(u.name)}</span>
                  <span className="flex-1 text-left truncate">{u.name}</span>
                </button>
              ))}
              {filteredUsers.length === 0 && <p className="text-xs text-muted-foreground text-center py-3">No users found</p>}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

function TaskDetailPanel({ task, open, onOpenChange, onInvalidate, allProjects, canReassign, taskTypeLabel }: { task: UnifiedTask; open: boolean; onOpenChange: (open: boolean) => void; onInvalidate: () => void; allProjects: string[]; canReassign: boolean; taskTypeLabel: string }) {
  const { toast } = useToast();
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState(task.notes || "");
  const [detailTab, setDetailTab] = useState("details");

  const STATUS_LABEL_MAP: Record<string, string> = { todo: "To Do", in_progress: "In Progress", blocked: "Blocked", review: "Review", complete: "Complete", cancelled: "Cancelled", inbox: "To Do", done: "Complete", planned: "To Do", waiting: "Blocked" };
  const STATUS_COLOR_MAP: Record<string, string> = { todo: "bg-muted text-muted-foreground border-border", in_progress: "bg-blue-100 text-blue-700 border-blue-200", blocked: "bg-red-100 text-red-700 border-red-200", review: "bg-amber-100 text-amber-700 border-amber-200", complete: "bg-emerald-100 text-emerald-700 border-emerald-200", cancelled: "bg-muted text-muted-foreground border-border", inbox: "bg-muted text-muted-foreground border-border", done: "bg-emerald-100 text-emerald-700 border-emerald-200", waiting: "bg-amber-100 text-amber-700 border-amber-200" };
  const statusLabel = STATUS_LABEL_MAP[task.status] || task.status;
  const priorityLabel = task.priority === "critical" ? "P1 — Critical" : task.priority === "high" ? "P2 — High" : task.priority === "low" ? "P4 — Low" : "P3 — Normal";
  const priorityColor = task.priority === "critical" ? "text-red-600" : task.priority === "high" ? "text-orange-600" : task.priority === "low" ? "text-slate-500" : "text-blue-600";
  const statusColor = STATUS_COLOR_MAP[task.status] || "bg-muted text-muted-foreground border-border";
  const isOverdue = (() => { if (!task.dueAt || task.status === "complete" || task.status === "done" || task.status === "cancelled") return false; try { return isPast(parseISO(task.dueAt)); } catch { return false; } })();

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      if (task._source === "tr_register") {
        const trStatus = newStatus === "complete" ? "Completed" : "Active";
        const endpoint = newStatus === "complete" ? `/api/tr-register/${task._rawId}/complete` : `/api/tr-register/${task._rawId}`;
        const res = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify(newStatus === "complete" ? {} : { status: trStatus }) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || "Failed to update"); }
      } else if (task._source === "operational") {
        const blockedReason = getTaskWorkflowBlockReason(task as any, newStatus);
        if (blockedReason) throw new Error(blockedReason);
        const res = await fetch(`/api/operational-tasks/${task._rawId}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ status: newStatus }) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || "Failed to update"); }
      } else if (task._source === "approvals" && task._key.startsWith("approval-qc-")) {
        const qmStatus = newStatus === "complete" ? "pass" : newStatus === "blocked" ? "fail" : newStatus === "in_progress" ? "in_progress" : "review";
        const res = await fetch(`/api/quality/project/${encodeURIComponent(task.projectName || "unknown")}/item/${task._rawId}`, { method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ qmStatus }) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || "Failed to update QC status"); }
      } else if (task._source === "engineering_task") {
        const engStatus = newStatus === "complete" ? "DONE" : newStatus === "in_progress" ? "IN PROGRESS" : newStatus === "blocked" ? "BLOCKED" : "TO DO";
        const res = await fetch(`/api/task-checklist-items/${task._rawId}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ status: engStatus }) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || "Failed to update"); }
      } else if (task._source === "quality_task") {
        const qmStatus = newStatus === "complete" ? "pass" : newStatus === "blocked" ? "fail" : newStatus === "in_progress" ? "in_progress" : "review";
        const res = await fetch(`/api/quality/project/${encodeURIComponent(task.projectName || "unknown")}/item/${task._rawId}`, { method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ qmStatus }) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || "Failed to update"); }
      } else if (task._source === "plan") {
        const planStatus = newStatus === "complete" ? "Done" : newStatus === "in_progress" ? "In Progress" : newStatus === "blocked" ? "Blocked" : "Not Started";
        const pct = newStatus === "complete" ? 100 : undefined;
        const res = await fetch(`/api/planning-tasks/${task._rawId}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ projectName: task.projectName || "", status: planStatus, ...(pct !== undefined ? { percentComplete: pct } : {}) }) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || "Failed to update"); }
      }
    },
    onSuccess: () => { onInvalidate(); toast({ title: "Status updated" }); },
    onError: (err: any) => { toast({ title: err.message || "Failed to update status", variant: "destructive" }); },
  });

  const dismissMutation = useMutation({
    mutationFn: async () => {
      if (task._key.startsWith("ms-")) {
        const res = await fetch(`/api/ms-objects/${task._rawId}/dismiss`, { method: "PATCH", headers: { ...getAuthHeaders() }, credentials: "include" });
        if (!res.ok) throw new Error("Failed to dismiss");
      } else if (task._key.startsWith("notif-")) {
        const res = await fetch("/api/notifications/mark-read", { method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ notificationIds: [task._rawId] }) });
        if (!res.ok) throw new Error("Failed to dismiss");
      }
    },
    onSuccess: () => { onInvalidate(); onOpenChange(false); toast({ title: "Notification dismissed" }); },
    onError: () => { toast({ title: "Failed to dismiss", variant: "destructive" }); },
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

  const canChangeStatus = ["operational", "approvals", "engineering_task", "quality_task", "tr_register", "plan"].includes(task._source);
  const canEditInline = task._source === "tr_register" || task._source === "plan";

  const detailDue = smartDueLabel(task.dueAt);
  const detailDueStyle = DUE_URGENCY_STYLES[detailDue.urgency] || "";
  const openHref = useCallback((href?: string | null) => {
    if (!href) return;
    if (isExternalHref(href)) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    window.location.assign(href);
  }, []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg p-0 flex flex-col" data-testid="unified-task-detail-sheet">
        <div className="px-4 pt-4 pb-3 border-b shrink-0">
          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${task._sourceColor}`}>{task._sourceLabel}</span>
            {(task._trackingRole === "creator" || task._trackingRole === "both") && <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-medium border bg-teal-50 border-teal-200 text-teal-700"><Eye className="h-3 w-3" />Tracking</span>}
            {task._trackingRole === "viewer" && <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-medium border bg-sky-50 border-sky-200 text-sky-700"><Eye className="h-3 w-3" />Viewing</span>}
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
              <button className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 rounded-md px-1.5 py-0.5 hover:bg-muted" data-testid="text-unified-project" onClick={() => openHref(task.projectHref || `/projects?search=${encodeURIComponent(task.projectName || "")}`)}>
                <FolderOpen className="h-3 w-3" /> {task.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")} <Link2 className="h-3 w-3" />
              </button>
            )}
            {detailDue.label && (
              <span className={`flex items-center gap-1 text-[10px] rounded-md px-1.5 py-0.5 border ${detailDueStyle}`} data-testid="text-unified-due">
                <Clock className="h-3 w-3" /> {detailDue.label}
                {task.dueAt && <span className="text-[9px] opacity-70 ml-0.5">({(() => { try { return format(new Date(task.dueAt), "dd MMM yyyy"); } catch { return ""; } })()})</span>}
              </span>
            )}
            {task.department && <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 rounded-md px-1.5 py-0.5"><Tag className="h-3 w-3" /> {task.department}</span>}
            {task.trId && <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground bg-muted/50 rounded-md px-1.5 py-0.5"><Hash className="h-3 w-3" /> {task.trId}</span>}
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 rounded-md px-1.5 py-0.5" data-testid="text-unified-type"><ListTodo className="h-3 w-3" /> {taskTypeLabel}</span>
            {task.assigneeDisplay && <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 rounded-md px-1.5 py-0.5"><Users className="h-3 w-3" /> {task.assigneeDisplay}</span>}
          </div>
          {(task.sourceHref || task.projectHref || task.externalHref) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {task.sourceHref && <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => openHref(task.sourceHref)} data-testid="button-open-source-context"><Link2 className="h-3 w-3" /> {task.sourceContextLabel || "Open source"}</Button>}
              {task.projectHref && task.projectHref !== task.sourceHref && <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={() => openHref(task.projectHref)} data-testid="button-open-project-context"><FolderOpen className="h-3 w-3" /> Open project</Button>}
              {task.externalHref && task.externalHref !== task.sourceHref && <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={() => openHref(task.externalHref)} data-testid="button-open-origin-context"><ExternalLink className="h-3 w-3" /> Open original</Button>}
            </div>
          )}
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

              {["personal", "operational", "plan", "engineering_task", "quality_task", "tr_register"].includes(task._source) && (
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 block">Assigned To</Label>
                  <div onClick={e => e.stopPropagation()}>
                    <UserAssignmentPicker taskId={task._rawId} taskSource={task._source} resolvedUsers={task.resolvedAssignees || task.resolvedOwners || null} textNames={task.assignees || task.owners || null} mode={["operational", "tr_register"].includes(task._source) ? "multi" : "single"} size="sm" invalidateKeys={["/api/my-work/all-tasks", "/api/mytool/tasks", "/api/tr-register"]} disabled={!canReassign} disabledReason="You do not have permission to reassign this task" />
                  </div>
                  {!canReassign && <p className="text-[10px] text-muted-foreground mt-2 italic">Read-only access for this task.</p>}
                </div>
              )}

              {task._source === "plan" && (
                <ViewerManagement taskId={task._rawId} onInvalidate={onInvalidate} />
              )}

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
                        <Button size="sm" className="h-6 text-xs" onClick={() => {
                          if (task._source === "plan") {
                            fetch(`/api/planning-tasks/${task._rawId}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ projectName: task.projectName || "", comment: editNotes }) }).then(r => { if (r.ok) { onInvalidate(); toast({ title: "Updated" }); setEditingField(null); } else { toast({ title: "Failed to update", variant: "destructive" }); } });
                          } else {
                            updateTrFieldMutation.mutate({ outcomeComments: editNotes });
                          }
                        }} disabled={updateTrFieldMutation.isPending}>Save</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-foreground whitespace-pre-wrap bg-muted/30 rounded-md p-2.5 leading-relaxed" data-testid="text-unified-notes">{task.notes || task.description}</p>
                  )}
                </div>
              )}

              {(task.createdAt || task.updatedAt) && (
                <div className="text-[10px] text-muted-foreground pt-2 border-t space-y-1">
                  {task.createdAt && <div>Created {(() => { try { return formatDistanceToNow(new Date(task.createdAt), { addSuffix: true }); } catch { return ""; } })()}</div>}
                  {task.updatedAt && <div>Updated {(() => { try { return formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true }); } catch { return ""; } })()}</div>}
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
                        <Button size="sm" variant="outline" className="h-8 text-xs justify-start text-green-600 hover:bg-green-50" onClick={() => updateStatusMutation.mutate("complete")} disabled={updateStatusMutation.isPending} data-testid="btn-status-pass"><CheckCircle2 className="h-3 w-3 mr-1.5" /> Pass</Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs justify-start text-red-600 hover:bg-red-50" onClick={() => updateStatusMutation.mutate("blocked")} disabled={updateStatusMutation.isPending} data-testid="btn-status-fail"><AlertCircle className="h-3 w-3 mr-1.5" /> Fail</Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant={task.status === "todo" || task.status === "inbox" ? "default" : "outline"} className="h-8 text-xs justify-start" onClick={() => updateStatusMutation.mutate("todo")} disabled={updateStatusMutation.isPending} data-testid="btn-status-todo"><Circle className="h-3 w-3 mr-1.5" /> To Do</Button>
                        <Button size="sm" variant={task.status === "in_progress" ? "default" : "outline"} className="h-8 text-xs justify-start" onClick={() => updateStatusMutation.mutate("in_progress")} disabled={updateStatusMutation.isPending} data-testid="btn-status-in-progress"><Clock className="h-3 w-3 mr-1.5" /> In Progress</Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs justify-start text-emerald-600 hover:bg-emerald-50" onClick={() => updateStatusMutation.mutate("complete")} disabled={updateStatusMutation.isPending} data-testid="btn-status-done"><CheckCircle2 className="h-3 w-3 mr-1.5" /> Complete</Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs justify-start text-red-600 hover:bg-red-50" onClick={() => updateStatusMutation.mutate("blocked")} disabled={updateStatusMutation.isPending} data-testid="btn-status-blocked"><AlertCircle className="h-3 w-3 mr-1.5" /> Blocked</Button>
                      </>
                    )}
                  </div>
                  {updateStatusMutation.isPending && <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Updating...</div>}
                </div>
              )}

              {!canChangeStatus && task._source !== "notifications" && (
                <div className="text-center py-6 text-muted-foreground">
                  <p className="text-xs">Status changes for this task type must be done from the source.</p>
                </div>
              )}

              {(task._source === "notifications" || task._source === "microsoft") && (
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 block">Dismiss</Label>
                  <Button size="sm" variant="outline" className="h-8 text-xs justify-start text-red-600 hover:bg-red-50 w-full" onClick={() => { dismissMutation.mutate(); }} disabled={dismissMutation.isPending} data-testid="btn-dismiss-notif"><X className="h-3 w-3 mr-1.5" /> Dismiss Notification</Button>
                  {dismissMutation.isPending && <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Dismissing...</div>}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function AssignToSelector({ selected, onChange }: { selected: { id: number; name: string }[]; onChange: (v: { id: number; name: string }[]) => void }) {
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

  const selectedIds = new Set(selected.map(s => s.id));

  const filtered = users.filter(u =>
    !search.trim() || u.name?.toLowerCase().includes(search.toLowerCase()) || u.username?.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (user: { id: number; name: string }) => {
    onChange(selectedIds.has(user.id) ? selected.filter(s => s.id !== user.id) : [...selected, { id: user.id, name: user.name }]);
  };

  return (
    <div className="mt-1">
      <div className="flex flex-wrap gap-1 mb-1">
        {selected.map(s => (
          <span key={s.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 border border-blue-200 text-blue-700">
            <User className="h-2.5 w-2.5" /> {s.name}
            <button onClick={() => onChange(selected.filter(x => x.id !== s.id))} className="hover:text-red-500" data-testid={`btn-remove-assignee-${s.id}`}><X className="h-2.5 w-2.5" /></button>
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
              <button key={u.id} onClick={() => toggle(u)} className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px] text-left transition-colors ${selectedIds.has(u.id) ? "bg-blue-50 text-blue-700" : "hover:bg-muted"}`} data-testid={`assign-user-${u.id}`}>
                <span className={`w-3 h-3 rounded border flex items-center justify-center text-[8px] ${selectedIds.has(u.id) ? "bg-blue-500 border-blue-500 text-white" : "border-border"}`}>
                  {selectedIds.has(u.id) ? "✓" : ""}
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
