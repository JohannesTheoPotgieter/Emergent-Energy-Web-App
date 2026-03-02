import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { format } from "date-fns";
import TaskCard, { TaskItem, TaskStatus, TaskPriority, PriorityBadge, StatusIcon, StatusLabel } from "@/components/mytool/TaskCard";
import TaskDetailDrawer from "@/components/mytool/TaskDetailDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus,
  Loader2,
  Search,
  Trash2,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  X,
  Inbox,
  Filter,
  Eye,
  Calendar,
  Building2,
  FolderOpen,
  AlertTriangle,
  ListTodo,
  ClipboardList,
  ShieldCheck,
  FileCheck,
  BookOpen,
  CheckCircle2,
  Circle,
  Clock,
  AlertCircle,
  Wrench,
  Users,
} from "lucide-react";

type SortField = "priority" | "dueDate" | "createdAt" | "status";
type SortDirection = "asc" | "desc";
type SourceFilter = "all" | "personal" | "operational" | "approvals" | "tr_register" | "deliverables";

const priorityOrder: Record<string, number> = { critical: 0, high: 1, urgent: 0, High: 1, Med: 2, Low: 3, normal: 2, low: 3 };
const statusOrder: Record<string, number> = { in_progress: 0, "IN PROGRESS": 0, planned: 1, inbox: 2, "TO DO": 2, blocked: 3, BLOCKED: 3, waiting: 4, "ON HOLD": 4, done: 5, DONE: 5, COMPLETE: 5, cancelled: 6 };
const allStatuses: TaskStatus[] = ["inbox", "planned", "in_progress", "blocked", "waiting", "done", "cancelled"];
const allPriorities: TaskPriority[] = ["critical", "high", "normal", "low"];

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
  trId?: string | null;
}

const SOURCE_CONFIG: Record<SourceFilter, { label: string; icon: any; color: string; bgColor: string }> = {
  all: { label: "All", icon: ListTodo, color: "text-foreground", bgColor: "bg-muted" },
  personal: { label: "Personal", icon: ClipboardList, color: "text-blue-600", bgColor: "bg-blue-50 border-blue-200" },
  operational: { label: "Project Tasks", icon: Building2, color: "text-emerald-600", bgColor: "bg-emerald-50 border-emerald-200" },
  approvals: { label: "Approvals", icon: ShieldCheck, color: "text-amber-600", bgColor: "bg-amber-50 border-amber-200" },
  tr_register: { label: "TR Register", icon: BookOpen, color: "text-purple-600", bgColor: "bg-purple-50 border-purple-200" },
  deliverables: { label: "Deliverables", icon: FileCheck, color: "text-rose-600", bgColor: "bg-rose-50 border-rose-200" },
};

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

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
  const [groomMode, setGroomMode] = useState(false);
  const [drawerTask, setDrawerTask] = useState<TaskItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set());
  const [subtaskDialog, setSubtaskDialog] = useState<{ parentId: number; projectName: string } | null>(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [newSubtaskPriority, setNewSubtaskPriority] = useState("Med");
  const [quickAddText, setQuickAddText] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIndexRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const { data: allTaskData, isLoading } = useQuery<any>({
    queryKey: ["/api/my-work/all-tasks"],
    queryFn: async () => {
      const res = await fetch("/api/my-work/all-tasks", {
        headers: { ...getAuthHeaders() },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return res.json();
    },
  });

  const { data: rawProjectInfos = [] } = useQuery<any[]>({
    queryKey: ["/api/project-info"],
  });

  const projectNames = useMemo(() =>
    rawProjectInfos.map((p: any) => p.projectName || p.project_name).filter(Boolean).sort(),
    [rawProjectInfos]
  );

  const unifiedTasks: UnifiedTask[] = useMemo(() => {
    if (!allTaskData) return [];
    const result: UnifiedTask[] = [];

    for (const t of (allTaskData.personal || [])) {
      result.push({
        _key: `personal-${t.id}`,
        _source: "personal",
        _sourceLabel: "Personal",
        _sourceColor: "bg-blue-50 border-blue-200 text-blue-700",
        _rawId: t.id,
        id: t.id,
        title: t.title || "",
        status: t.status || "inbox",
        priority: t.priority || "normal",
        projectName: t.projectName || t.project_name || null,
        dueAt: t.dueAt || t.due_at || null,
        createdAt: t.createdAt || t.created_at || null,
        notes: t.notes || null,
        nextStep: t.nextStep || t.next_step || null,
        definitionOfDone: t.definitionOfDone || t.definition_of_done || null,
        blockedReason: t.blockedReason || t.blocked_reason || null,
        pinnedToday: t.pinnedToday || t.pinned_today || false,
        pinnedWeek: t.pinnedWeek || t.pinned_week || false,
        isRecurring: t.isRecurring || t.is_recurring || false,
        recurrenceFrequency: t.recurrenceFrequency || t.recurrence_frequency || null,
        sortOrder: t.sortOrder || t.sort_order || 0,
        bucket: t.bucket || null,
        sourceEmailId: t.sourceEmailId || t.source_email_id || null,
        sourceEmailSubject: t.sourceEmailSubject || t.source_email_subject || null,
        completionNote: t.completionNote || t.completion_note || null,
        plannedForDate: t.plannedForDate || t.planned_for_date || null,
        department: t.department || null,
        tag: t.tag || null,
      });
    }

    for (const t of (allTaskData.operational || [])) {
      if (t.parentTaskId) continue;
      result.push({
        _key: `op-${t.id}`,
        _source: "operational",
        _sourceLabel: "Project",
        _sourceColor: "bg-emerald-50 border-emerald-200 text-emerald-700",
        _rawId: t.id,
        id: t.id,
        title: t.title || "",
        status: normalizeStatus(t.status),
        priority: normalizePriority(t.priority),
        projectName: t.projectName || t.project_name || null,
        dueAt: t.dueDate || t.due_date || null,
        createdAt: t.createdAt || t.created_at || null,
        notes: t.description || t.comment || null,
        subtaskCount: t.subtaskCount || 0,
        parentTaskId: t.parentTaskId || t.parent_task_id || null,
        percentComplete: t.percentComplete || t.percent_complete || 0,
        assignees: t.assignees || null,
        description: t.description || null,
      });
    }

    for (const a of (allTaskData.approvals?.engineering || [])) {
      result.push({
        _key: `approval-eng-${a.id}`,
        _source: "approvals",
        _sourceLabel: "Eng Approval",
        _sourceColor: "bg-amber-50 border-amber-200 text-amber-700",
        _rawId: a.id,
        id: a.id,
        title: a.title || "",
        status: normalizeStatus(a.status),
        priority: "high",
        projectName: a.projectName || null,
        dueAt: null,
        createdAt: a.createdAt || null,
        notes: null,
      });
    }
    for (const a of (allTaskData.approvals?.quality || [])) {
      result.push({
        _key: `approval-qc-${a.id}`,
        _source: "approvals",
        _sourceLabel: "QC Review",
        _sourceColor: "bg-amber-50 border-amber-200 text-amber-700",
        _rawId: a.id,
        id: a.id,
        title: a.title || "",
        status: normalizeStatus(a.status),
        priority: "high",
        projectName: a.projectName || null,
        dueAt: null,
        createdAt: a.createdAt || null,
        notes: null,
      });
    }

    for (const t of (allTaskData.trRegister || [])) {
      result.push({
        _key: `tr-${t.id}`,
        _source: "tr_register",
        _sourceLabel: "TR Register",
        _sourceColor: "bg-purple-50 border-purple-200 text-purple-700",
        _rawId: t.id,
        id: t.id,
        title: t.actionDescription || "",
        status: normalizeStatus(t.status),
        priority: t.ragStatus === "Red" ? "critical" : t.ragStatus === "Amber" ? "high" : "normal",
        projectName: null,
        dueAt: t.dueDate || t.due_date || null,
        createdAt: t.createdAt || t.created_at || null,
        notes: t.outcomeComments || t.supportingInfo || null,
        ragStatus: t.ragStatus || null,
        owners: t.owners || null,
        trId: t.trId || null,
        department: t.department || null,
      });
    }

    for (const d of (allTaskData.deliverables || [])) {
      result.push({
        _key: `del-${d.id}`,
        _source: "deliverables",
        _sourceLabel: "Deliverable",
        _sourceColor: "bg-rose-50 border-rose-200 text-rose-700",
        _rawId: d.id,
        id: d.id,
        title: d.title || "",
        status: normalizeStatus(d.status),
        priority: "normal",
        projectName: d.projectName || d.project_name || null,
        dueAt: null,
        createdAt: d.createdAt || d.created_at || null,
        notes: null,
        deliverableType: d.deliverableType || d.deliverable_type || null,
        deliverableStatus: d.status || null,
      });
    }

    return result;
  }, [allTaskData]);

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-work/all-tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/mytool/tasks"] });
  }, []);

  const createTaskMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await apiRequest("POST", "/api/mytool/tasks", body);
    },
    onSuccess: () => invalidateAll(),
    onError: () => { toast({ title: "Failed to create task", variant: "destructive" }); },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, ...body }: Record<string, unknown> & { id: number }) => {
      await apiRequest("PATCH", `/api/mytool/tasks/${id}`, body);
    },
    onSuccess: () => invalidateAll(),
    onError: () => { toast({ title: "Failed to update", variant: "destructive" }); },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/mytool/tasks/${id}`);
    },
    onSuccess: () => invalidateAll(),
    onError: () => { toast({ title: "Failed to delete", variant: "destructive" }); },
  });

  const createSubtaskMutation = useMutation({
    mutationFn: async ({ parentId, title, priority }: { parentId: number; title: string; priority: string }) => {
      const res = await fetch(`/api/eng/tasks/${parentId}/subtasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ title, priority, status: "TO DO" }),
      });
      if (!res.ok) throw new Error("Failed to create subtask");
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      setSubtaskDialog(null);
      setNewSubtaskTitle("");
      setNewSubtaskPriority("Med");
      toast({ title: "Subtask created" });
    },
    onError: () => { toast({ title: "Failed to create subtask", variant: "destructive" }); },
  });

  const handleQuickAdd = useCallback((text: string) => {
    const title = text.trim();
    if (!title) return;
    let priority: TaskPriority = "normal";
    let cleanTitle = title;
    const pMatch = title.match(/\b(p1|p2|p3|p4)\b/i);
    if (pMatch) {
      const p = pMatch[1].toLowerCase();
      priority = p === "p1" ? "critical" : p === "p2" ? "high" : p === "p4" ? "low" : "normal";
      cleanTitle = title.replace(pMatch[0], "").trim();
    }
    createTaskMutation.mutate({ title: cleanTitle, priority, status: "inbox" });
    setQuickAddText("");
    setSearchText("");
  }, [createTaskMutation]);

  const handleStatusChange = useCallback((id: number, status: TaskStatus) => {
    updateTaskMutation.mutate({ id, status });
  }, [updateTaskMutation]);

  const handleOpenDrawer = useCallback((task: UnifiedTask) => {
    if (task._source !== "personal") return;
    setDrawerTask({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      plannedForDate: task.plannedForDate || null,
      dueAt: task.dueAt || null,
      sortOrder: task.sortOrder || 0,
      projectName: task.projectName || null,
      department: task.department || null,
      tag: task.tag || null,
      blockedReason: task.blockedReason || null,
      nextStep: task.nextStep || null,
      definitionOfDone: task.definitionOfDone || null,
      pinnedToday: task.pinnedToday || false,
      pinnedWeek: task.pinnedWeek || false,
      isRecurring: task.isRecurring || false,
      recurrenceFrequency: task.recurrenceFrequency || null,
      notes: task.notes || null,
      completionNote: task.completionNote || null,
      createdAt: task.createdAt || null,
      bucket: task.bucket || null,
      sourceEmailId: task.sourceEmailId || null,
      sourceEmailSubject: task.sourceEmailSubject || null,
    });
    setDrawerOpen(true);
  }, []);

  const allProjects = useMemo(() => {
    const set = new Set<string>();
    unifiedTasks.forEach(t => { if (t.projectName) set.add(t.projectName); });
    projectNames.forEach((p: string) => set.add(p));
    return Array.from(set).sort();
  }, [unifiedTasks, projectNames]);

  const filteredTasks = useMemo(() => {
    let result = [...unifiedTasks];

    if (sourceFilter !== "all") {
      result = result.filter(t => t._source === sourceFilter);
    }
    if (debouncedSearch.trim()) {
      const lower = debouncedSearch.toLowerCase();
      result = result.filter(t =>
        t.title.toLowerCase().includes(lower) ||
        (t.projectName && t.projectName.toLowerCase().includes(lower)) ||
        (t.notes && t.notes.toLowerCase().includes(lower)) ||
        (t.trId && t.trId.toLowerCase().includes(lower))
      );
    }
    if (statusFilter.length > 0) {
      result = result.filter(t => statusFilter.includes(t.status));
    }
    if (priorityFilter.length > 0) {
      result = result.filter(t => priorityFilter.includes(t.priority));
    }
    if (projectFilter) {
      result = result.filter(t => t.projectName === projectFilter);
    }
    if (groomMode) {
      result = result.filter(t =>
        t.status !== "done" && t.status !== "cancelled" &&
        (!t.nextStep || !t.nextStep.trim() || !t.definitionOfDone || !t.definitionOfDone.trim())
      );
    }

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "priority":
          cmp = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
          if (cmp === 0) cmp = (a.dueAt || "9999").localeCompare(b.dueAt || "9999");
          break;
        case "status":
          cmp = (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2);
          break;
        case "dueDate":
          cmp = (a.dueAt || "9999").localeCompare(b.dueAt || "9999");
          break;
        case "createdAt":
          cmp = (b.createdAt || "").localeCompare(a.createdAt || "");
          break;
      }
      return sortDirection === "desc" ? -cmp : cmp;
    });

    return result;
  }, [unifiedTasks, sourceFilter, debouncedSearch, statusFilter, priorityFilter, projectFilter, groomMode, sortField, sortDirection]);

  const toggleStatus = (s: TaskStatus) => {
    setStatusFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const togglePriority = (p: TaskPriority) => {
    setPriorityFilter(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDirection("asc"); }
  };

  const toggleExpand = (taskId: number) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const sourceCounts = useMemo(() => {
    const counts: Record<SourceFilter, number> = { all: 0, personal: 0, operational: 0, approvals: 0, tr_register: 0, deliverables: 0 };
    for (const t of unifiedTasks) counts[t._source]++;
    counts.all = unifiedTasks.length;
    return counts;
  }, [unifiedTasks]);

  const activeFilters = statusFilter.length + priorityFilter.length + (projectFilter ? 1 : 0);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4" data-testid="loading-skeleton">
        <div className="flex items-center gap-3">
          {[1, 2, 3, 4, 5].map(i => (<Skeleton key={i} className="h-8 w-24 rounded-full" />))}
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (<Skeleton key={i} className="h-14 w-full rounded-lg" />))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-6xl mx-auto" data-testid="my-work-tasks-page">
      <div className="flex items-center justify-between" data-testid="tasks-header">
        <div className="flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground" data-testid="text-tasks-title">
            Unified Task Board
          </h2>
          <Badge variant="secondary" className="text-xs" data-testid="badge-total-count">
            {filteredTasks.length}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={groomMode ? "default" : "outline"}
            size="sm"
            className={`h-7 text-xs ${groomMode ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}`}
            onClick={() => setGroomMode(!groomMode)}
            data-testid="button-groom-mode"
          >
            <Eye className="h-3 w-3 mr-1" /> Groom
          </Button>
          <Button
            variant={showFilters ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowFilters(!showFilters)}
            data-testid="button-toggle-filters"
          >
            <Filter className="h-3 w-3 mr-1" /> Filters
            {activeFilters > 0 && <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1">{activeFilters}</Badge>}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap" data-testid="source-filter-tabs">
        {(Object.keys(SOURCE_CONFIG) as SourceFilter[]).map(src => {
          const config = SOURCE_CONFIG[src];
          const Icon = config.icon;
          const count = sourceCounts[src];
          const active = sourceFilter === src;
          return (
            <button
              key={src}
              onClick={() => setSourceFilter(src)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                active
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-background text-muted-foreground border-border/50 hover:bg-muted hover:border-border"
              }`}
              data-testid={`tab-source-${src}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {config.label}
              <span className={`text-[10px] ${active ? "opacity-80" : "opacity-60"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2" data-testid="quick-add-bar">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search all tasks... or type to quick-add a personal task (press Enter)"
            value={quickAddText || searchText}
            onChange={e => {
              const val = e.target.value;
              if (quickAddText !== "") setQuickAddText(val);
              else setSearchText(val);
            }}
            onKeyDown={e => {
              if (e.key === "Enter" && searchText.trim()) {
                handleQuickAdd(searchText);
              }
            }}
            className="pl-9 text-sm h-9"
            data-testid="input-task-search"
          />
        </div>
        <Button
          variant="default"
          size="sm"
          className="h-9"
          onClick={() => { if (searchText.trim()) handleQuickAdd(searchText); }}
          disabled={!searchText.trim() || createTaskMutation.isPending}
          data-testid="button-quick-add"
        >
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap" data-testid="status-filter-chips">
        {allStatuses.map(s => {
          const count = unifiedTasks.filter(t => t.status === s).length;
          const isActive = statusFilter.includes(s);
          return (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border ${
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/50 text-muted-foreground border-border/50 hover:bg-muted hover:border-border"
              }`}
              data-testid={`chip-status-${s}`}
            >
              <StatusIcon status={s} />
              {s.replace("_", " ")}
              <span className="text-[10px] opacity-70">{count}</span>
            </button>
          );
        })}
        {statusFilter.length > 0 && (
          <button onClick={() => setStatusFilter([])} className="text-[10px] text-muted-foreground hover:text-foreground px-1" data-testid="button-clear-status-chips">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg border border-border/50 bg-muted/20" data-testid="filter-bar">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Priority</label>
            <div className="flex gap-1">
              {allPriorities.map(p => {
                const isActive = priorityFilter.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() => togglePriority(p)}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                      isActive ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/50 text-muted-foreground hover:border-border"
                    }`}
                    data-testid={`filter-priority-${p}`}
                  >
                    {p === "critical" ? "P1" : p === "high" ? "P2" : p === "normal" ? "P3" : "P4"}
                  </button>
                );
              })}
            </div>
          </div>
          {allProjects.length > 0 && (
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <FolderOpen className="h-3 w-3" /> Project
              </label>
              <select
                value={projectFilter}
                onChange={e => setProjectFilter(e.target.value)}
                className="text-xs border border-border rounded-md px-2 py-1.5 bg-background h-7"
                data-testid="select-project-filter"
              >
                <option value="">All Projects</option>
                {allProjects.map(p => (
                  <option key={p} value={p}>{p.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
          )}
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
              onClick={() => { setPriorityFilter([]); setProjectFilter(""); }}
              data-testid="button-clear-all-filters"
            >Clear all</Button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="sort-bar">
        <span className="text-[10px] uppercase tracking-wider font-medium">Sort:</span>
        {(["priority", "dueDate", "createdAt", "status"] as SortField[]).map(field => (
          <button
            key={field}
            onClick={() => handleSort(field)}
            className={`flex items-center gap-0.5 px-2 py-1 rounded transition-colors ${
              sortField === field ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
            }`}
            data-testid={`sort-${field}`}
          >
            {field === "priority" ? "Priority" : field === "dueDate" ? "Due Date" : field === "createdAt" ? "Created" : "Status"}
            {sortField === field && <ArrowUpDown className="h-3 w-3" />}
          </button>
        ))}
      </div>

      <div className="space-y-1" data-testid="task-list">
        {filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Inbox className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">No tasks found</p>
            <p className="text-xs mt-1 opacity-70">
              {sourceFilter !== "all" ? "Try switching to 'All' to see all your tasks" : "Use the search bar above to create your first task."}
            </p>
          </div>
        ) : (
          filteredTasks.map(task => (
            <TaskRow
              key={task._key}
              task={task}
              isExpanded={expandedTasks.has(task.id)}
              onToggleExpand={() => task._source === "operational" && task.subtaskCount! > 0 && toggleExpand(task.id)}
              onOpenDrawer={() => handleOpenDrawer(task)}
              onStatusChange={handleStatusChange}
              onDelete={task._source === "personal" ? () => deleteTaskMutation.mutate(task.id) : undefined}
              onAddSubtask={task._source === "operational" ? () => setSubtaskDialog({ parentId: task.id, projectName: task.projectName || "" }) : undefined}
              allTaskData={allTaskData}
              onSubtaskAddForChild={(parentId: number, projectName: string) => setSubtaskDialog({ parentId, projectName })}
            />
          ))
        )}
      </div>

      {drawerOpen && drawerTask && (
        <TaskDetailDrawer
          task={drawerTask}
          open={drawerOpen}
          onOpenChange={(open) => setDrawerOpen(open)}
          onInvalidate={invalidateAll}
        />
      )}

      <Dialog open={!!subtaskDialog} onOpenChange={(open) => { if (!open) setSubtaskDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Subtask</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Title</label>
              <Input
                placeholder="Subtask title..."
                value={newSubtaskTitle}
                onChange={e => setNewSubtaskTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && newSubtaskTitle.trim() && subtaskDialog) {
                    createSubtaskMutation.mutate({ parentId: subtaskDialog.parentId, title: newSubtaskTitle.trim(), priority: newSubtaskPriority });
                  }
                }}
                data-testid="input-subtask-title"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <Select value={newSubtaskPriority} onValueChange={setNewSubtaskPriority}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-subtask-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Med">Medium</SelectItem>
                  <SelectItem value="Low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSubtaskDialog(null)} data-testid="button-cancel-subtask">Cancel</Button>
            <Button
              size="sm"
              onClick={() => {
                if (newSubtaskTitle.trim() && subtaskDialog) {
                  createSubtaskMutation.mutate({ parentId: subtaskDialog.parentId, title: newSubtaskTitle.trim(), priority: newSubtaskPriority });
                }
              }}
              disabled={!newSubtaskTitle.trim() || createSubtaskMutation.isPending}
              data-testid="button-create-subtask"
            >
              {createSubtaskMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskRow({
  task,
  isExpanded,
  onToggleExpand,
  onOpenDrawer,
  onStatusChange,
  onDelete,
  onAddSubtask,
  allTaskData,
  onSubtaskAddForChild,
}: {
  task: UnifiedTask;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenDrawer: () => void;
  onStatusChange: (id: number, status: TaskStatus) => void;
  onDelete?: () => void;
  onAddSubtask?: () => void;
  allTaskData: any;
  onSubtaskAddForChild: (parentId: number, projectName: string) => void;
}) {
  const subtasks = useMemo(() => {
    if (!isExpanded || task._source !== "operational" || !allTaskData?.operational) return [];
    return (allTaskData.operational as any[]).filter(t => t.parentTaskId === task.id || t.parent_task_id === task.id);
  }, [isExpanded, task, allTaskData]);

  const { data: fetchedSubtasks } = useQuery<any[]>({
    queryKey: [`/api/eng/tasks/${task.id}/subtasks`],
    enabled: isExpanded && task._source === "operational" && (task.subtaskCount || 0) > 0,
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/eng/tasks/${task.id}/subtasks`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const displaySubtasks = fetchedSubtasks || subtasks;

  const priorityColor = task.priority === "critical" ? "text-red-600 bg-red-50" :
    task.priority === "high" ? "text-orange-600 bg-orange-50" :
    task.priority === "low" ? "text-slate-400 bg-slate-50" : "text-blue-600 bg-blue-50";

  const statusIcon = task.status === "done" ? <CheckCircle2 className="h-4 w-4 text-green-500" /> :
    task.status === "in_progress" ? <Clock className="h-4 w-4 text-blue-500" /> :
    task.status === "blocked" ? <AlertCircle className="h-4 w-4 text-red-500" /> :
    task.status === "waiting" ? <AlertTriangle className="h-4 w-4 text-amber-500" /> :
    task.status === "cancelled" ? <X className="h-4 w-4 text-slate-400" /> :
    <Circle className="h-4 w-4 text-slate-300" />;

  return (
    <div data-testid={`task-row-${task._key}`}>
      <div
        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all hover:shadow-sm cursor-pointer group ${
          task.status === "done" ? "opacity-60 bg-muted/30 border-border/30" : "bg-background border-border/50 hover:border-border"
        }`}
        onClick={task._source === "personal" ? onOpenDrawer : undefined}
      >
        {task._source === "operational" && (task.subtaskCount || 0) > 0 && (
          <button
            onClick={e => { e.stopPropagation(); onToggleExpand(); }}
            className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors"
            data-testid={`btn-expand-${task._key}`}
          >
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        )}
        {(task._source !== "operational" || !(task.subtaskCount && task.subtaskCount > 0)) && (
          <div className="shrink-0 w-5" />
        )}

        <div className="shrink-0">{statusIcon}</div>

        <span className={`shrink-0 inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${priorityColor}`}>
          {task.priority === "critical" ? "P1" : task.priority === "high" ? "P2" : task.priority === "low" ? "P4" : "P3"}
        </span>

        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className={`text-sm truncate ${task.status === "done" ? "line-through text-muted-foreground" : "text-foreground"}`} data-testid={`text-task-title-${task._key}`}>
            {task.title}
          </span>
          {task.subtaskCount && task.subtaskCount > 0 && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0">
              {task.subtaskCount} subtask{task.subtaskCount > 1 ? "s" : ""}
            </span>
          )}
          {task.percentComplete !== undefined && task.percentComplete > 0 && task._source === "operational" && (
            <div className="hidden sm:flex items-center gap-1 shrink-0">
              <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${task.percentComplete}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground">{task.percentComplete}%</span>
            </div>
          )}
        </div>

        <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${task._sourceColor}`} data-testid={`badge-source-${task._key}`}>
          {task._sourceLabel}
        </span>

        {task.projectName && (
          <span className="hidden md:inline shrink-0 text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded truncate max-w-[120px]" title={task.projectName} data-testid={`badge-project-${task._key}`}>
            {task.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
          </span>
        )}

        {task.ragStatus && (
          <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${
            task.ragStatus === "Red" ? "bg-red-500" : task.ragStatus === "Amber" ? "bg-amber-500" : "bg-green-500"
          }`} title={`RAG: ${task.ragStatus}`} />
        )}

        {task.dueAt && (
          <span className="hidden sm:inline shrink-0 text-[10px] text-muted-foreground" data-testid={`text-due-${task._key}`}>
            {(() => { try { return format(new Date(task.dueAt), "dd MMM"); } catch { return ""; } })()}
          </span>
        )}

        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {task._source === "operational" && onAddSubtask && (
            <button
              onClick={e => { e.stopPropagation(); onAddSubtask(); }}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Add subtask"
              data-testid={`btn-add-subtask-${task._key}`}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
          {task._source === "personal" && onDelete && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
              data-testid={`btn-delete-${task._key}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {isExpanded && displaySubtasks.length > 0 && (
        <div className="ml-8 mt-1 space-y-0.5 border-l-2 border-emerald-200 pl-3" data-testid={`subtasks-${task._key}`}>
          {displaySubtasks.map((st: any) => {
            const stStatus = normalizeStatus(st.status);
            const stIcon = stStatus === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> :
              stStatus === "in_progress" ? <Clock className="h-3.5 w-3.5 text-blue-500" /> :
              <Circle className="h-3.5 w-3.5 text-slate-300" />;
            return (
              <div key={st.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-sm" data-testid={`subtask-${st.id}`}>
                {stIcon}
                <span className={`flex-1 truncate ${stStatus === "done" ? "line-through text-muted-foreground" : ""}`}>
                  {st.title}
                </span>
                <span className="text-[10px] text-muted-foreground">{st.priority}</span>
                {st.dueDate && (
                  <span className="text-[10px] text-muted-foreground">
                    {(() => { try { return format(new Date(st.dueDate || st.due_date), "dd MMM"); } catch { return ""; } })()}
                  </span>
                )}
              </div>
            );
          })}
          <button
            onClick={() => onSubtaskAddForChild(task.id, task.projectName || "")}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-emerald-600 transition-colors"
            data-testid={`btn-add-more-subtask-${task._key}`}
          >
            <Plus className="h-3 w-3" /> Add subtask
          </button>
        </div>
      )}
    </div>
  );
}
