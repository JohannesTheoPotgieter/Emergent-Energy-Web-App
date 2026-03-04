import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import MyToolLayout from "@/components/mytool/MyToolLayout";
import TaskCard, { TaskItem, TaskStatus, TaskPriority, PriorityBadge, StatusIcon, StatusLabel } from "@/components/mytool/TaskCard";
import TaskDetailDrawer from "@/components/mytool/TaskDetailDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  Loader2,
  Search,
  Trash2,
  ChevronDown,
  ArrowUpDown,
  X,
  Inbox,
  Mail,
  ExternalLink,
  Filter,
  Eye,
  Calendar,
  Building2,
  FolderOpen,
  AlertTriangle,
} from "lucide-react";

type SortField = "priority" | "dueDate" | "createdAt" | "status";
type SortDirection = "asc" | "desc";

interface OutlookEmail {
  id: string;
  subject: string;
  sender: string | null;
  senderEmail: string | null;
  receivedAt: string;
  snippet: string | null;
  webLink: string | null;
  isRead: boolean;
  hasAttachments: boolean;
}

const priorityOrder: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const statusOrder: Record<string, number> = { in_progress: 0, planned: 1, inbox: 2, blocked: 3, waiting: 4, done: 5, cancelled: 6 };
const allStatuses: TaskStatus[] = ["inbox", "planned", "in_progress", "blocked", "waiting", "done", "cancelled"];
const allPriorities: TaskPriority[] = ["critical", "high", "normal", "low"];
const priorityLabels: Record<string, string> = { critical: "P1", high: "P2", normal: "P3", low: "P4" };

const DEPARTMENTS = [
  "Engineering", "Finance", "Operations", "Sales",
  "Procurement", "Legal", "HR", "Executive",
  "Project Delivery", "O&M",
];

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

export default function MyToolBacklogPage() {
  const { toast } = useToast();

  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [dueDateFrom, setDueDateFrom] = useState("");
  const [dueDateTo, setDueDateTo] = useState("");
  const [sortField, setSortField] = useState<SortField>("priority");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [groomMode, setGroomMode] = useState(false);
  const [drawerTask, setDrawerTask] = useState<TaskItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const [emailInboxOpen, setEmailInboxOpen] = useState(false);
  const [emailInboxSearch, setEmailInboxSearch] = useState("");
  const [debouncedInboxSearch, setDebouncedInboxSearch] = useState("");
  const [taskListDropOver, setTaskListDropOver] = useState(false);

  const [bulkDueDate, setBulkDueDate] = useState("");

  const lastSelectedIndexRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedInboxSearch(emailInboxSearch), 400);
    return () => clearTimeout(timer);
  }, [emailInboxSearch]);

  const { data: rawTasks = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/mytool/tasks"],
  });

  const tasks: TaskItem[] = useMemo(() =>
    rawTasks.map((t: any) => ({
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
    })),
  [rawTasks]);

  const { data: inboxEmails = [], isLoading: inboxEmailsLoading } = useQuery<OutlookEmail[]>({
    queryKey: ["/api/outlook/messages", "backlog-inbox", debouncedInboxSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ top: "15" });
      if (debouncedInboxSearch.trim()) params.set("search", debouncedInboxSearch.trim());
      const bh: Record<string, string> = {};
      const bt = localStorage.getItem('auth_token');
      if (bt) bh["Authorization"] = `Bearer ${bt}`;
      const res = await fetch(`/api/outlook/messages?${params.toString()}`, { credentials: "include", headers: bh });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : data.value || [];
    },
    enabled: emailInboxOpen,
  });

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

  const handleDropEmail = async (emailData: OutlookEmail) => {
    try {
      await apiRequest("POST", "/api/mytool/tasks", {
        title: emailData.subject || "(No subject)",
        status: "inbox",
        priority: "normal",
        notes: `Email from: ${emailData.sender || emailData.senderEmail || "unknown"}\n\n${emailData.snippet || ""}`,
        sortOrder: 0,
      });
      await apiRequest("POST", "/api/outlook/email-to-task", {
        outlookMessageId: emailData.id,
        subject: emailData.subject,
        sender: emailData.sender || emailData.senderEmail || "",
        receivedAt: emailData.receivedAt,
        snippet: emailData.snippet?.slice(0, 200) || "",
        webLink: emailData.webLink || "",
        targetType: "new",
      });
      invalidateAll();
      toast({ title: "Task created from email" });
    } catch {
      toast({ title: "Failed to create task from email", variant: "destructive" });
    }
  };

  const projects = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => { if (t.projectName) set.add(t.projectName); });
    return Array.from(set).sort();
  }, [tasks]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => { if (t.department) set.add(t.department); });
    return Array.from(set).sort();
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = [...tasks];

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
    if (departmentFilter) {
      result = result.filter((t) => t.department === departmentFilter);
    }
    if (dueDateFrom) {
      result = result.filter((t) => t.dueAt && t.dueAt >= dueDateFrom);
    }
    if (dueDateTo) {
      result = result.filter((t) => t.dueAt && t.dueAt <= dueDateTo + "T23:59:59");
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
  }, [tasks, debouncedSearch, statusFilter, priorityFilter, projectFilter, departmentFilter, dueDateFrom, dueDateTo, groomMode, sortField, sortDirection]);

  const toggleStatus = (s: TaskStatus) => {
    setStatusFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const togglePriority = (p: TaskPriority) => {
    setPriorityFilter((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const toggleSelect = (id: number, e?: React.MouseEvent) => {
    const idx = filteredTasks.findIndex((t) => t.id === id);

    if (e?.shiftKey && lastSelectedIndexRef.current !== null) {
      const start = Math.min(lastSelectedIndexRef.current, idx);
      const end = Math.max(lastSelectedIndexRef.current, idx);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          next.add(filteredTasks[i].id);
        }
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
    lastSelectedIndexRef.current = idx;
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredTasks.length && filteredTasks.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTasks.map((t) => t.id)));
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

  const selectedArray = Array.from(selectedIds);
  const activeFilters = statusFilter.length + priorityFilter.length + (projectFilter ? 1 : 0) + (departmentFilter ? 1 : 0) + (dueDateFrom ? 1 : 0) + (dueDateTo ? 1 : 0);

  const handleGroomUpdate = (id: number, field: "nextStep" | "definitionOfDone", value: string) => {
    updateTaskMutation.mutate({ id, [field]: value || null });
  };

  if (isLoading) {
    return (
      <MyToolLayout onQuickAdd={handleQuickAdd} onSearchChange={setSearchText} searchValue={searchText}>
        <div className="space-y-4" data-testid="loading-skeleton">
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
      </MyToolLayout>
    );
  }

  return (
    <MyToolLayout onQuickAdd={handleQuickAdd} onSearchChange={setSearchText} searchValue={searchText}>
      <div className="space-y-4" data-testid="mytool-backlog-page">
        <div className="flex items-center justify-between" data-testid="backlog-header">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground" data-testid="text-backlog-title">
              All Tasks
            </h2>
            <Badge variant="secondary" className="text-xs" data-testid="badge-task-count">
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
                <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1 bg-card/20 text-white">
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

        <div className="flex items-center gap-1.5 flex-wrap" data-testid="status-filter-chips">
          {allStatuses.map((s) => {
            const count = tasks.filter((t) => t.status === s).length;
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

            {projects.length > 0 && (
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
                  <option value="">All</option>
                  {projects.map((p) => (
                    <option key={p} value={p}>{p.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Building2 className="h-3 w-3" /> Department
              </label>
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                className="text-xs border border-border rounded-md px-2 py-1.5 bg-background h-7"
                data-testid="select-department-filter"
              >
                <option value="">All</option>
                {(departments.length > 0 ? departments : DEPARTMENTS).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Due Date
              </label>
              <div className="flex items-center gap-1">
                <Input
                  type="date"
                  value={dueDateFrom}
                  onChange={(e) => setDueDateFrom(e.target.value)}
                  className="h-7 text-xs w-32"
                  data-testid="input-due-date-from"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={dueDateTo}
                  onChange={(e) => setDueDateTo(e.target.value)}
                  className="h-7 text-xs w-32"
                  data-testid="input-due-date-to"
                />
              </div>
            </div>

            {activeFilters > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => {
                  setPriorityFilter([]);
                  setProjectFilter("");
                  setDepartmentFilter("");
                  setDueDateFrom("");
                  setDueDateTo("");
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

        {selectedIds.size > 0 && (
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
                  bulkUpdateMutation.mutate({ ids: selectedArray, changes: { status: e.target.value } });
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
                  bulkUpdateMutation.mutate({ ids: selectedArray, changes: { priority: e.target.value } });
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
            <div className="flex items-center gap-1">
              <Input
                type="date"
                value={bulkDueDate}
                onChange={(e) => setBulkDueDate(e.target.value)}
                className="h-7 text-xs w-32"
                data-testid="input-bulk-due-date"
              />
              {bulkDueDate && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    bulkUpdateMutation.mutate({
                      ids: selectedArray,
                      changes: { dueAt: new Date(bulkDueDate).toISOString() },
                    });
                    setBulkDueDate("");
                  }}
                  data-testid="button-apply-bulk-due-date"
                >
                  Apply
                </Button>
              )}
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="h-7 text-xs"
              onClick={() => bulkDeleteMutation.mutate(selectedArray)}
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

        <div
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setTaskListDropOver(true); }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setTaskListDropOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setTaskListDropOver(false);
            try {
              const emailData = JSON.parse(e.dataTransfer.getData("application/json"));
              if (emailData.id && emailData.subject !== undefined) handleDropEmail(emailData);
            } catch {}
          }}
          className={`transition-all rounded-lg ${taskListDropOver ? "ring-2 ring-primary ring-offset-2 bg-primary/5" : ""}`}
          data-testid="task-list-drop-zone"
        >
          {taskListDropOver && (
            <div className="text-center py-2 text-xs text-primary font-medium bg-primary/10 rounded-t-lg border-b border-primary/20" data-testid="drop-indicator">
              Drop email here to create a task
            </div>
          )}

          {filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-state">
              <Inbox className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <h3 className="text-sm font-medium text-muted-foreground mb-1" data-testid="text-empty-title">
                {tasks.length === 0 ? "No tasks yet" : groomMode ? "All tasks are groomed!" : "No matching tasks"}
              </h3>
              <p className="text-xs text-muted-foreground/60" data-testid="text-empty-description">
                {tasks.length === 0
                  ? "Use Quick Add (⌘K) to create your first task."
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
                const needsGroom = groomMode && (
                  (!task.nextStep || !task.nextStep.trim()) ||
                  (!task.definitionOfDone || !task.definitionOfDone.trim())
                );

                return (
                  <div
                    key={task.id}
                    className={`group/row relative ${needsGroom ? "ring-1 ring-amber-400 rounded-lg" : ""}`}
                    data-testid={`task-row-${task.id}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className={`pt-3 pl-2 shrink-0 transition-opacity ${selectedIds.has(task.id) ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"}`}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(task.id)}
                          onChange={() => {}}
                          onClick={(e) => toggleSelect(task.id, e as any)}
                          className="rounded border-border cursor-pointer"
                          data-testid={`checkbox-task-${task.id}`}
                        />
                      </div>
                      <div className="flex-1">
                        <TaskCard
                          task={task}
                          onStatusChange={handleStatusChange}
                          onOpenDrawer={handleOpenDrawer}
                          onQuickDone={handleQuickDone}
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

        <div className="border-t border-border/40 pt-4" data-testid="email-inbox-section">
          <button
            className="flex items-center gap-2 text-left w-full mb-3"
            onClick={() => setEmailInboxOpen(!emailInboxOpen)}
            data-testid="toggle-email-inbox"
          >
            {emailInboxOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <Mail className="h-4 w-4 text-muted-foreground" />}
            <Mail className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Email Inbox</span>
            <span className="text-[10px] text-muted-foreground">(drag to task list)</span>
          </button>

          {emailInboxOpen && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search emails..."
                  value={emailInboxSearch}
                  onChange={(e) => setEmailInboxSearch(e.target.value)}
                  className="pl-9 text-sm h-8"
                  data-testid="input-inbox-email-search"
                />
              </div>
              <div className="max-h-[300px] overflow-y-auto space-y-1" data-testid="email-inbox-list">
                {inboxEmailsLoading && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!inboxEmailsLoading && inboxEmails.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3" data-testid="text-no-inbox-emails">
                    {emailInboxSearch ? "No emails found" : "No emails. Connect Outlook in Settings."}
                  </p>
                )}
                {inboxEmails.map((email) => (
                  <div
                    key={email.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/json", JSON.stringify(email));
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className="px-3 py-2 rounded-md border border-border/50 hover:border-border hover:bg-muted/30 cursor-grab active:cursor-grabbing transition-colors group/email"
                    data-testid={`backlog-inbox-email-${email.id}`}
                  >
                    <div className="flex items-start gap-2">
                      <Mail className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{email.subject || "(No subject)"}</p>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className="truncate">{email.sender || email.senderEmail || "Unknown"}</span>
                          <span>·</span>
                          <span className="shrink-0">{email.receivedAt ? format(new Date(email.receivedAt), "d MMM") : ""}</span>
                        </div>
                        {email.snippet && (
                          <p className="text-[10px] text-muted-foreground/60 truncate mt-0.5">{email.snippet.slice(0, 80)}</p>
                        )}
                      </div>
                      {email.webLink && (
                        <a
                          href={email.webLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:text-primary/80 shrink-0 opacity-0 group-hover/email:opacity-100"
                          data-testid={`link-backlog-inbox-email-${email.id}`}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <p className="text-[9px] text-primary/60 mt-1 select-none">↕ Drag to task list</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <TaskDetailDrawer
        task={drawerTask}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onInvalidate={invalidateAll}
      />
    </MyToolLayout>
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
