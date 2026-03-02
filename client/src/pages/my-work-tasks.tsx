import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import TaskCard, { TaskItem, TaskStatus, TaskPriority, PriorityBadge, StatusIcon, StatusLabel } from "@/components/mytool/TaskCard";
import TaskDetailDrawer from "@/components/mytool/TaskDetailDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  Loader2,
  Search,
  Trash2,
  ChevronDown,
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
} from "lucide-react";

type SortField = "priority" | "dueDate" | "createdAt" | "status";
type SortDirection = "asc" | "desc";
type TaskSource = "all" | "personal" | "operational";

const priorityOrder: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const statusOrder: Record<string, number> = { in_progress: 0, planned: 1, inbox: 2, blocked: 3, waiting: 4, done: 5, cancelled: 6 };
const allStatuses: TaskStatus[] = ["inbox", "planned", "in_progress", "blocked", "waiting", "done", "cancelled"];
const allPriorities: TaskPriority[] = ["critical", "high", "normal", "low"];
const priorityLabels: Record<string, string> = { critical: "P1", high: "P2", normal: "P3", low: "P4" };

function normalizeOperationalStatus(status: string): TaskStatus {
  const s = status.toLowerCase().trim();
  if (s === "done" || s === "complete" || s === "completed") return "done";
  if (s === "in progress" || s === "in_progress") return "in_progress";
  if (s === "to do" || s === "todo" || s === "not started") return "inbox";
  if (s === "blocked") return "blocked";
  if (s === "on hold" || s === "waiting") return "waiting";
  if (s === "planned") return "planned";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return "inbox";
}

function normalizeOperationalPriority(priority: string): TaskPriority {
  const p = priority.toLowerCase().trim();
  if (p === "critical" || p === "urgent" || p === "p1") return "critical";
  if (p === "high" || p === "p2") return "high";
  if (p === "low" || p === "p4") return "low";
  return "normal";
}

function parseQuickAdd(text: string): { title: string; priority?: TaskPriority; status?: TaskStatus } {
  let title = text;
  let priority: TaskPriority | undefined;
  let status: TaskStatus = "inbox";

  const p1Match = title.match(/\bp1\b/i);
  const p2Match = title.match(/\bp2\b/i);
  const p3Match = title.match(/\bp3\b/i);
  const p4Match = title.match(/\bp4\b/i);
  if (p1Match) { priority = "critical"; title = title.replace(p1Match[0], ""); }
  else if (p2Match) { priority = "high"; title = title.replace(p2Match[0], ""); }
  else if (p3Match) { priority = "normal"; title = title.replace(p3Match[0], ""); }
  else if (p4Match) { priority = "low"; title = title.replace(p4Match[0], ""); }

  return { title: title.trim(), priority, status };
}

interface OperationalTaskRaw {
  id: number;
  projectName: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  due_date?: string | null;
  startDate: string | null;
  start_date?: string | null;
  percentComplete: number;
  percent_complete?: number;
  assignees: string[] | null;
  tags: string[] | null;
  description: string | null;
  phase: string | null;
  createdAt: string | null;
  created_at?: string | null;
  isBaseline?: boolean;
  is_baseline?: boolean;
}

export default function MyWorkTasksPage() {
  const { toast } = useToast();

  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("priority");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groomMode, setGroomMode] = useState(false);
  const [drawerTask, setDrawerTask] = useState<TaskItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<TaskSource>("all");
  const [quickAddText, setQuickAddText] = useState("");

  const lastSelectedIndexRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const { data: rawMyToolTasks = [], isLoading: myToolLoading } = useQuery<any[]>({
    queryKey: ["/api/mytool/tasks"],
  });

  const { data: rawProjectInfos = [] } = useQuery<any[]>({
    queryKey: ["/api/project-info"],
  });

  const projectNames = useMemo(() =>
    rawProjectInfos.map((p: any) => p.projectName || p.project_name).filter(Boolean).sort(),
    [rawProjectInfos]
  );

  const myToolTasks: (TaskItem & { _source: "personal" })[] = useMemo(() =>
    rawMyToolTasks.map((t: any) => ({
      id: t.id,
      title: t.title || "",
      status: t.status || "inbox",
      priority: t.priority || "normal",
      plannedForDate: t.plannedForDate || t.planned_for_date || null,
      dueAt: t.dueAt || t.due_at || null,
      sortOrder: t.sortOrder || t.sort_order || 0,
      projectName: t.projectName || t.project_name || null,
      department: t.department || null,
      tag: t.tag || null,
      blockedReason: t.blockedReason || t.blocked_reason || null,
      nextStep: t.nextStep || t.next_step || null,
      definitionOfDone: t.definitionOfDone || t.definition_of_done || null,
      pinnedToday: t.pinnedToday || t.pinned_today || false,
      pinnedWeek: t.pinnedWeek || t.pinned_week || false,
      isRecurring: t.isRecurring || t.is_recurring || false,
      recurrenceFrequency: t.recurrenceFrequency || t.recurrence_frequency || null,
      notes: t.notes || null,
      completionNote: t.completionNote || t.completion_note || null,
      createdAt: t.createdAt || t.created_at || null,
      bucket: t.bucket || null,
      sourceEmailId: t.sourceEmailId || t.source_email_id || null,
      sourceEmailSubject: t.sourceEmailSubject || t.source_email_subject || null,
      _source: "personal" as const,
    })),
  [rawMyToolTasks]);

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/mytool/tasks"] });
  }, []);

  const createTaskMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await apiRequest("POST", "/api/mytool/tasks", body);
    },
    onSuccess: () => invalidateAll(),
    onError: () => {
      toast({ title: "Failed to create task", variant: "destructive" });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, ...body }: Record<string, unknown> & { id: number }) => {
      await apiRequest("PATCH", `/api/mytool/tasks/${id}`, body);
    },
    onSuccess: () => invalidateAll(),
    onError: () => {
      toast({ title: "Failed to update task", variant: "destructive" });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/mytool/tasks/${id}`);
    },
    onSuccess: () => invalidateAll(),
    onError: () => {
      toast({ title: "Failed to delete task", variant: "destructive" });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async (updates: { ids: number[]; changes: Record<string, unknown> }) => {
      await Promise.all(
        updates.ids.map((id) => apiRequest("PATCH", `/api/mytool/tasks/${id}`, updates.changes))
      );
    },
    onSuccess: () => {
      invalidateAll();
      setSelectedIds(new Set());
    },
    onError: () => {
      toast({ title: "Failed to update tasks", variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(ids.map((id) => apiRequest("DELETE", `/api/mytool/tasks/${id}`)));
    },
    onSuccess: () => {
      invalidateAll();
      setSelectedIds(new Set());
    },
    onError: () => {
      toast({ title: "Failed to delete tasks", variant: "destructive" });
    },
  });

  const handleQuickAdd = useCallback((text: string) => {
    const parsed = parseQuickAdd(text);
    if (!parsed.title) return;
    createTaskMutation.mutate({
      title: parsed.title,
      priority: parsed.priority || "normal",
      status: parsed.status || "inbox",
    });
    setQuickAddText("");
  }, [createTaskMutation]);

  const handleStatusChange = useCallback((id: number, status: TaskStatus) => {
    updateTaskMutation.mutate({ id, status });
  }, [updateTaskMutation]);

  const handleQuickDone = useCallback((task: TaskItem) => {
    updateTaskMutation.mutate({ id: task.id, status: "done" });
  }, [updateTaskMutation]);

  const handleOpenDrawer = useCallback((task: TaskItem) => {
    setDrawerTask(task);
    setDrawerOpen(true);
  }, []);

  const allProjects = useMemo(() => {
    const set = new Set<string>();
    myToolTasks.forEach((t) => { if (t.projectName) set.add(t.projectName); });
    projectNames.forEach((p: string) => set.add(p));
    return Array.from(set).sort();
  }, [myToolTasks, projectNames]);

  const combinedTasks = useMemo(() => {
    let result: (TaskItem & { _source: string; _key: string })[] = [];

    if (sourceFilter === "all" || sourceFilter === "personal") {
      result.push(...myToolTasks.map(t => ({ ...t, _key: `personal-${t.id}` })));
    }

    return result;
  }, [myToolTasks, sourceFilter]);

  const filteredTasks = useMemo(() => {
    let result = [...combinedTasks];

    if (debouncedSearch.trim()) {
      const lower = debouncedSearch.toLowerCase();
      result = result.filter((t) =>
        t.title.toLowerCase().includes(lower) ||
        (t.projectName && t.projectName.toLowerCase().includes(lower)) ||
        (t.notes && t.notes.toLowerCase().includes(lower))
      );
    }
    if (statusFilter.length > 0) {
      result = result.filter((t) => statusFilter.includes(t.status));
    }
    if (priorityFilter.length > 0) {
      result = result.filter((t) => priorityFilter.includes(t.priority));
    }
    if (projectFilter) {
      result = result.filter((t) => t.projectName === projectFilter);
    }
    if (groomMode) {
      result = result.filter((t) =>
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
          if (cmp === 0) cmp = (b.createdAt || "").localeCompare(a.createdAt || "");
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
  }, [combinedTasks, debouncedSearch, statusFilter, priorityFilter, projectFilter, groomMode, sortField, sortDirection]);

  const toggleStatus = (s: TaskStatus) => {
    setStatusFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const togglePriority = (p: TaskPriority) => {
    setPriorityFilter((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const toggleSelect = (key: string, e?: React.MouseEvent) => {
    const idx = filteredTasks.findIndex((t) => t._key === key);

    if (e?.shiftKey && lastSelectedIndexRef.current !== null) {
      const start = Math.min(lastSelectedIndexRef.current, idx);
      const end = Math.max(lastSelectedIndexRef.current, idx);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          next.add(filteredTasks[i]._key);
        }
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }
    lastSelectedIndexRef.current = idx;
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredTasks.length && filteredTasks.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTasks.map((t) => t._key)));
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const selectedPersonalIds = Array.from(selectedIds)
    .filter(k => k.startsWith("personal-"))
    .map(k => parseInt(k.replace("personal-", "")));
  const activeFilters = statusFilter.length + priorityFilter.length + (projectFilter ? 1 : 0);

  const handleGroomUpdate = (id: number, field: "nextStep" | "definitionOfDone", value: string) => {
    updateTaskMutation.mutate({ id, [field]: value || null });
  };

  const personalCount = combinedTasks.filter(t => t._source === "personal").length;

  const isLoading = myToolLoading;

  if (isLoading) {
    return (
      <div className="p-6 space-y-4" data-testid="loading-skeleton">
        <div className="flex items-center gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-full" />
          ))}
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto" data-testid="my-work-tasks-page">
      <div className="flex items-center justify-between" data-testid="tasks-header">
        <div className="flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground" data-testid="text-tasks-title">
            Task Backlog
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
            <Eye className="h-3 w-3 mr-1" />
            Groom
            {groomMode && (
              <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1 bg-white/20 text-white">
                {filteredTasks.length}
              </Badge>
            )}
          </Button>
          <Button
            variant={showFilters ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowFilters(!showFilters)}
            data-testid="button-toggle-filters"
          >
            <Filter className="h-3 w-3 mr-1" />
            Filters
            {activeFilters > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1">{activeFilters}</Badge>
            )}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2" data-testid="quick-add-bar">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search tasks... or type to quick-add (press Enter)"
            value={quickAddText || searchText}
            onChange={(e) => {
              const val = e.target.value;
              if (quickAddText !== "") {
                setQuickAddText(val);
              } else {
                setSearchText(val);
              }
            }}
            onKeyDown={(e) => {
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
          onClick={() => {
            if (searchText.trim()) {
              handleQuickAdd(searchText);
            }
          }}
          disabled={!searchText.trim() || createTaskMutation.isPending}
          data-testid="button-quick-add"
        >
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap" data-testid="status-filter-chips">
        {allStatuses.map((s) => {
          const count = combinedTasks.filter((t) => t.status === s).length;
          const isActive = statusFilter.includes(s);
          return (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border
                ${isActive
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
          <button
            onClick={() => setStatusFilter([])}
            className="text-[10px] text-muted-foreground hover:text-foreground px-1"
            data-testid="button-clear-status-chips"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg border border-border/50 bg-muted/20" data-testid="filter-bar">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Priority</label>
            <div className="flex gap-1">
              {allPriorities.map((p) => {
                const isActive = priorityFilter.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() => togglePriority(p)}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors
                      ${isActive ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/50 text-muted-foreground hover:border-border"}`}
                    data-testid={`filter-priority-${p}`}
                  >
                    {priorityLabels[p]}
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
                onChange={(e) => setProjectFilter(e.target.value)}
                className="text-xs border border-border rounded-md px-2 py-1.5 bg-background h-7"
                data-testid="select-project-filter"
              >
                <option value="">All Projects</option>
                {allProjects.map((p) => (
                  <option key={p} value={p}>{p.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
          )}

          {activeFilters > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => {
                setPriorityFilter([]);
                setProjectFilter("");
              }}
              data-testid="button-clear-all-filters"
            >
              Clear all
            </Button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="sort-bar">
        <span className="text-[10px] uppercase tracking-wider font-medium">Sort:</span>
        {(["priority", "dueDate", "createdAt", "status"] as SortField[]).map((field) => (
          <button
            key={field}
            onClick={() => handleSort(field)}
            className={`flex items-center gap-0.5 px-2 py-1 rounded transition-colors
              ${sortField === field ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"}`}
            data-testid={`sort-${field}`}
          >
            {field === "priority" ? "Priority" : field === "dueDate" ? "Due Date" : field === "createdAt" ? "Created" : "Status"}
            {sortField === field && (
              <ArrowUpDown className="h-3 w-3" />
            )}
          </button>
        ))}
      </div>

      {selectedIds.size > 0 && selectedPersonalIds.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20"
          data-testid="bulk-actions-bar"
        >
          <span className="text-sm font-medium text-primary" data-testid="text-selected-count">
            {selectedIds.size} selected
          </span>
          <select
            onChange={(e) => {
              if (e.target.value) {
                bulkUpdateMutation.mutate({ ids: selectedPersonalIds, changes: { status: e.target.value } });
                e.target.value = "";
              }
            }}
            className="text-xs border border-border rounded-md px-2 py-1.5 bg-background h-7"
            defaultValue=""
            data-testid="select-bulk-status"
          >
            <option value="" disabled>Set Status</option>
            {allStatuses.map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
          <select
            onChange={(e) => {
              if (e.target.value) {
                bulkUpdateMutation.mutate({ ids: selectedPersonalIds, changes: { priority: e.target.value } });
                e.target.value = "";
              }
            }}
            className="text-xs border border-border rounded-md px-2 py-1.5 bg-background h-7"
            defaultValue=""
            data-testid="select-bulk-priority"
          >
            <option value="" disabled>Set Priority</option>
            {allPriorities.map((p) => (
              <option key={p} value={p}>{priorityLabels[p]} — {p}</option>
            ))}
          </select>
          <Button
            variant="destructive"
            size="sm"
            className="h-7 text-xs"
            onClick={() => bulkDeleteMutation.mutate(selectedPersonalIds)}
            disabled={bulkDeleteMutation.isPending}
            data-testid="button-bulk-delete"
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Delete
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs ml-auto"
            onClick={() => setSelectedIds(new Set())}
            data-testid="button-clear-selection"
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        </div>
      )}

      <div data-testid="task-list-container">
        {filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-state">
            <Inbox className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <h3 className="text-sm font-medium text-muted-foreground mb-1" data-testid="text-empty-title">
              {combinedTasks.length === 0 ? "No tasks yet" : groomMode ? "All tasks are groomed!" : "No matching tasks"}
            </h3>
            <p className="text-xs text-muted-foreground/60" data-testid="text-empty-description">
              {combinedTasks.length === 0
                ? "Use the search bar above to create your first task."
                : groomMode
                ? "Every task has a Next Step and Definition of Done."
                : "Try adjusting your filters or search."}
            </p>
          </div>
        ) : (
          <div className="space-y-1" data-testid="task-list">
            {filteredTasks.length > 0 && (
              <div className="flex items-center px-3 py-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filteredTasks.length && filteredTasks.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-border"
                    data-testid="checkbox-select-all"
                  />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Select all</span>
                </label>
              </div>
            )}

            {filteredTasks.map((task) => {
              const needsGroom = groomMode && task._source === "personal" && (
                (!task.nextStep || !task.nextStep.trim()) ||
                (!task.definitionOfDone || !task.definitionOfDone.trim())
              );

              return (
                <div
                  key={task._key}
                  className={`group/row relative ${needsGroom ? "ring-1 ring-amber-400 rounded-lg" : ""}`}
                  data-testid={`task-row-${task._key}`}
                >
                  <div className="flex items-start gap-2">
                    <div className={`pt-3 pl-2 shrink-0 transition-opacity ${selectedIds.has(task._key) ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"}`}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(task._key)}
                        onChange={() => {}}
                        onClick={(e) => toggleSelect(task._key, e as any)}
                        className="rounded border-border cursor-pointer"
                        data-testid={`checkbox-task-${task._key}`}
                      />
                    </div>
                    <div className="flex-1">
                      <TaskCard
                        task={task}
                        onStatusChange={task._source === "personal" ? handleStatusChange : undefined}
                        onOpenDrawer={task._source === "personal" ? handleOpenDrawer : undefined}
                        onQuickDone={task._source === "personal" ? handleQuickDone : undefined}
                        showProject={true}
                        showNextStep={true}
                      />
                    </div>
                  </div>

                  {needsGroom && (
                    <GroomInline
                      task={task}
                      onUpdate={handleGroomUpdate}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <TaskDetailDrawer
        task={drawerTask}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onInvalidate={invalidateAll}
      />
    </div>
  );
}

function GroomInline({
  task,
  onUpdate,
}: {
  task: TaskItem;
  onUpdate: (id: number, field: "nextStep" | "definitionOfDone", value: string) => void;
}) {
  const [nextStep, setNextStep] = useState(task.nextStep || "");
  const [dod, setDod] = useState(task.definitionOfDone || "");
  const missingNext = !task.nextStep || !task.nextStep.trim();
  const missingDod = !task.definitionOfDone || !task.definitionOfDone.trim();

  return (
    <div className="ml-10 mr-3 mb-2 flex gap-2" data-testid={`groom-inline-${task.id}`}>
      {missingNext && (
        <div className="flex-1">
          <label className="text-[10px] text-amber-600 font-medium flex items-center gap-1 mb-0.5">
            <AlertTriangle className="h-2.5 w-2.5" /> Next Step missing
          </label>
          <Input
            placeholder="What's the next action?"
            value={nextStep}
            onChange={(e) => setNextStep(e.target.value)}
            onBlur={() => { if (nextStep.trim()) onUpdate(task.id, "nextStep", nextStep); }}
            onKeyDown={(e) => { if (e.key === "Enter" && nextStep.trim()) { onUpdate(task.id, "nextStep", nextStep); } }}
            className="h-7 text-xs border-amber-300 focus:border-amber-500"
            data-testid={`input-groom-nextstep-${task.id}`}
          />
        </div>
      )}
      {missingDod && (
        <div className="flex-1">
          <label className="text-[10px] text-amber-600 font-medium flex items-center gap-1 mb-0.5">
            <AlertTriangle className="h-2.5 w-2.5" /> DoD missing
          </label>
          <Input
            placeholder="What does done look like?"
            value={dod}
            onChange={(e) => setDod(e.target.value)}
            onBlur={() => { if (dod.trim()) onUpdate(task.id, "definitionOfDone", dod); }}
            onKeyDown={(e) => { if (e.key === "Enter" && dod.trim()) { onUpdate(task.id, "definitionOfDone", dod); } }}
            className="h-7 text-xs border-amber-300 focus:border-amber-500"
            data-testid={`input-groom-dod-${task.id}`}
          />
        </div>
      )}
    </div>
  );
}
