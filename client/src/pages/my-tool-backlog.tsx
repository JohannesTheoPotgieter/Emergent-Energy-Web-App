import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import {
  Plus,
  Loader2,
  CalendarDays,
  Settings,
  ListTodo,
  Target,
  Search,
  Trash2,
  ChevronDown,
  ArrowUpDown,
  X,
  CheckCircle2,
  ExternalLink,
  Calendar,
  Inbox,
} from "lucide-react";

type Priority = "critical" | "important" | "normal" | "low";
type TaskStatus = "inbox" | "planned" | "in_progress" | "blocked" | "waiting" | "done" | "cancelled";
type SortField = "createdAt" | "dueDate" | "priority" | "status";
type SortDirection = "asc" | "desc";

interface MyToolTask {
  id: number;
  title: string;
  status: TaskStatus;
  priority: Priority;
  plannedForDate: string | null;
  dueDate: string | null;
  sortOrder: number;
  projectName: string | null;
  tag: string | null;
  blockedReason: string | null;
  companyPriorityId: number | null;
  createdAt: string | null;
}

const priorityOrder: Record<string, number> = { critical: 0, important: 1, normal: 2, low: 3 };
const statusOrder: Record<string, number> = { in_progress: 0, planned: 1, inbox: 2, blocked: 3, waiting: 4, done: 5, cancelled: 6 };
const allStatuses: TaskStatus[] = ["inbox", "planned", "in_progress", "blocked", "waiting", "done", "cancelled"];
const allPriorities: Priority[] = ["critical", "important", "normal", "low"];

const severityColors: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
  important: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  normal: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  low: { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" },
};

const statusColors: Record<string, string> = {
  inbox: "bg-gray-100 text-gray-700",
  planned: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  blocked: "bg-red-100 text-red-700",
  waiting: "bg-orange-100 text-orange-700",
  done: "bg-emerald-100 text-emerald-700",
};

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = severityColors[severity] || severityColors.normal;
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${cfg.bg} ${cfg.text} ${cfg.border} border`}
      data-testid={`badge-severity-${severity}`}
    >
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${statusColors[status] || statusColors.inbox}`}
      data-testid={`badge-status-${status}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

const navTabs = [
  { label: "Today", path: "/my-tool", icon: Target },
  { label: "Week", path: "/my-tool/week", icon: CalendarDays },
  { label: "Backlog", path: "/my-tool/backlog", icon: ListTodo },
  { label: "Settings", path: "/my-tool/settings", icon: Settings },
];

export default function MyToolBacklogPage() {
  const { user } = useAuth();
  const [location] = useLocation();

  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<Priority[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("priority");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<Priority>("normal");
  const [newStatus, setNewStatus] = useState<TaskStatus>("inbox");
  const [showStatusFilter, setShowStatusFilter] = useState(false);
  const [showPriorityFilter, setShowPriorityFilter] = useState(false);
  const [editingDateTaskId, setEditingDateTaskId] = useState<number | null>(null);
  const [editingDateValue, setEditingDateValue] = useState("");

  const { data: tasks = [], isLoading } = useQuery<MyToolTask[]>({
    queryKey: ["/api/mytool/tasks"],
  });

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/mytool/tasks"] });
  }, []);

  const createTaskMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await apiRequest("POST", "/api/mytool/tasks", body);
    },
    onSuccess: () => {
      invalidateAll();
      setShowCreateForm(false);
      setNewTitle("");
      setNewPriority("normal");
      setNewStatus("inbox");
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, ...body }: Record<string, unknown> & { id: number }) => {
      await apiRequest("PATCH", `/api/mytool/tasks/${id}`, body);
    },
    onSuccess: () => invalidateAll(),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/mytool/tasks/${id}`);
    },
    onSuccess: () => invalidateAll(),
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
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(ids.map((id) => apiRequest("DELETE", `/api/mytool/tasks/${id}`)));
    },
    onSuccess: () => {
      invalidateAll();
      setSelectedIds(new Set());
    },
  });

  const handleCreateTask = () => {
    const title = newTitle.trim();
    if (!title) return;
    createTaskMutation.mutate({ title, status: newStatus, priority: newPriority });
  };

  const handleSetPlannedDate = (taskId: number) => {
    if (editingDateValue) {
      updateTaskMutation.mutate({ id: taskId, plannedForDate: editingDateValue });
    }
    setEditingDateTaskId(null);
    setEditingDateValue("");
  };

  const toggleStatus = (s: TaskStatus) => {
    setStatusFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const togglePriority = (p: Priority) => {
    setPriorityFilter((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredTasks.length) {
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

  const projects = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => { if (t.projectName) set.add(t.projectName); });
    return Array.from(set).sort();
  }, [tasks]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => { if (t.tag) set.add(t.tag); });
    return Array.from(set).sort();
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = [...tasks];

    if (searchText.trim()) {
      const lower = searchText.toLowerCase();
      result = result.filter((t) => t.title.toLowerCase().includes(lower));
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
    if (tagFilter) {
      result = result.filter((t) => t.tag === tagFilter);
    }

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "priority":
          cmp = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
          break;
        case "status":
          cmp = (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2);
          break;
        case "dueDate":
          cmp = (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
          break;
        case "createdAt":
          cmp = (a.createdAt || "").localeCompare(b.createdAt || "");
          break;
      }
      return sortDirection === "desc" ? -cmp : cmp;
    });

    return result;
  }, [tasks, searchText, statusFilter, priorityFilter, projectFilter, tagFilter, sortField, sortDirection]);

  const selectedArray = Array.from(selectedIds);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto" data-testid="mytool-backlog-page">
      <header className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50" data-testid="text-page-title">
              My Tool
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1" data-testid="text-backlog-subtitle">
              All Tasks · Backlog
            </p>
          </div>
          {user && (
            <p className="text-sm text-gray-400" data-testid="text-user-greeting">
              Hey, {user.name}
            </p>
          )}
        </div>
        <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-700" data-testid="nav-tabs">
          {navTabs.map((tab) => {
            const isActive = location === tab.path;
            return (
              <Link
                key={tab.path}
                href={tab.path}
                data-testid={`nav-tab-${tab.label.toLowerCase()}`}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search tasks..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9 text-sm"
            data-testid="input-search"
          />
          {searchText && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
              onClick={() => setSearchText("")}
              data-testid="button-clear-search"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowStatusFilter(!showStatusFilter); setShowPriorityFilter(false); }}
              className="text-xs"
              data-testid="button-filter-status"
            >
              Status
              {statusFilter.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1">{statusFilter.length}</Badge>
              )}
              <ChevronDown className="h-3 w-3 ml-1" />
            </Button>
            {showStatusFilter && (
              <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 p-2 min-w-[160px]" data-testid="dropdown-status-filter">
                {allStatuses.map((s) => (
                  <label key={s} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 rounded cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={statusFilter.includes(s)}
                      onChange={() => toggleStatus(s)}
                      className="rounded"
                      data-testid={`checkbox-status-${s}`}
                    />
                    <StatusBadge status={s} />
                  </label>
                ))}
                <div className="border-t mt-1 pt-1">
                  <Button variant="ghost" size="sm" className="w-full h-6 text-[10px]" onClick={() => setStatusFilter([])} data-testid="button-clear-status-filter">
                    Clear
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowPriorityFilter(!showPriorityFilter); setShowStatusFilter(false); }}
              className="text-xs"
              data-testid="button-filter-priority"
            >
              Priority
              {priorityFilter.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1">{priorityFilter.length}</Badge>
              )}
              <ChevronDown className="h-3 w-3 ml-1" />
            </Button>
            {showPriorityFilter && (
              <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 p-2 min-w-[160px]" data-testid="dropdown-priority-filter">
                {allPriorities.map((p) => (
                  <label key={p} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 rounded cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={priorityFilter.includes(p)}
                      onChange={() => togglePriority(p)}
                      className="rounded"
                      data-testid={`checkbox-priority-${p}`}
                    />
                    <SeverityBadge severity={p} />
                  </label>
                ))}
                <div className="border-t mt-1 pt-1">
                  <Button variant="ghost" size="sm" className="w-full h-6 text-[10px]" onClick={() => setPriorityFilter([])} data-testid="button-clear-priority-filter">
                    Clear
                  </Button>
                </div>
              </div>
            )}
          </div>

          {projects.length > 0 && (
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-900"
              data-testid="select-project-filter"
            >
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
              ))}
            </select>
          )}

          {tags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-900"
              data-testid="select-tag-filter"
            >
              <option value="">All Tags</option>
              {tags.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}

          <Button
            variant="default"
            size="sm"
            className="text-xs"
            onClick={() => setShowCreateForm(!showCreateForm)}
            data-testid="button-create-task"
          >
            <Plus className="h-3 w-3 mr-1" />
            Create Task
          </Button>
        </div>
      </div>

      {showCreateForm && (
        <Card data-testid="card-create-task">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                placeholder="Task title..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateTask()}
                className="flex-1 text-sm"
                autoFocus
                data-testid="input-new-task-title"
              />
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value as Priority)}
                className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-900"
                data-testid="select-new-task-priority"
              >
                {allPriorities.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value as TaskStatus)}
                className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-900"
                data-testid="select-new-task-status"
              >
                {allStatuses.map((s) => (
                  <option key={s} value={s}>{s.replace("_", " ")}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleCreateTask}
                  disabled={!newTitle.trim() || createTaskMutation.isPending}
                  data-testid="button-submit-new-task"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreateForm(false)}
                  data-testid="button-cancel-new-task"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedIds.size > 0 && (
        <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800" data-testid="card-bulk-actions">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300" data-testid="text-selected-count">
                {selectedIds.size} selected
              </span>
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    bulkUpdateMutation.mutate({ ids: selectedArray, changes: { status: e.target.value } });
                    e.target.value = "";
                  }
                }}
                className="text-xs border rounded-md px-2 py-1.5 bg-white dark:bg-gray-900"
                defaultValue=""
                data-testid="select-bulk-status"
              >
                <option value="" disabled>Change Status</option>
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
                className="text-xs border rounded-md px-2 py-1.5 bg-white dark:bg-gray-900"
                defaultValue=""
                data-testid="select-bulk-priority"
              >
                <option value="" disabled>Change Priority</option>
                {allPriorities.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <Button
                variant="destructive"
                size="sm"
                className="text-xs"
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
                className="text-xs"
                onClick={() => setSelectedIds(new Set())}
                data-testid="button-clear-selection"
              >
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {filteredTasks.length === 0 ? (
        <Card data-testid="card-empty-state">
          <CardContent className="p-12 text-center">
            <Inbox className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-600 dark:text-gray-300 mb-2" data-testid="text-empty-title">
              {tasks.length === 0 ? "No tasks yet" : "No matching tasks"}
            </h3>
            <p className="text-sm text-gray-400 mb-4" data-testid="text-empty-description">
              {tasks.length === 0
                ? "Start by adding tasks from your Today page."
                : "Try adjusting your filters or search term."}
            </p>
            {tasks.length === 0 && (
              <Link href="/my-tool">
                <Button variant="outline" size="sm" data-testid="button-go-to-today">
                  <Target className="h-4 w-4 mr-2" />
                  Go to Today
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="hidden md:block">
            <Card data-testid="card-backlog-table">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-backlog">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-3 py-2 text-left w-8">
                          <input
                            type="checkbox"
                            checked={selectedIds.size === filteredTasks.length && filteredTasks.length > 0}
                            onChange={toggleSelectAll}
                            className="rounded"
                            data-testid="checkbox-select-all"
                          />
                        </th>
                        <th className="px-3 py-2 text-left">
                          <button onClick={() => handleSort("priority")} className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase" data-testid="sort-priority">
                            Priority <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Title</th>
                        <th className="px-3 py-2 text-left">
                          <button onClick={() => handleSort("status")} className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase" data-testid="sort-status">
                            Status <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Project</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Tag</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Planned</th>
                        <th className="px-3 py-2 text-left">
                          <button onClick={() => handleSort("dueDate")} className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase" data-testid="sort-due-date">
                            Due <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-left">
                          <button onClick={() => handleSort("createdAt")} className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase" data-testid="sort-created">
                            Created <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTasks.map((task) => (
                        <tr
                          key={task.id}
                          className={`border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${selectedIds.has(task.id) ? "bg-blue-50 dark:bg-blue-900/10" : ""}`}
                          data-testid={`backlog-row-${task.id}`}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(task.id)}
                              onChange={() => toggleSelect(task.id)}
                              className="rounded"
                              data-testid={`checkbox-task-${task.id}`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={task.priority}
                              onChange={(e) => updateTaskMutation.mutate({ id: task.id, priority: e.target.value })}
                              className="text-[10px] border-0 bg-transparent cursor-pointer p-0"
                              data-testid={`select-priority-${task.id}`}
                            >
                              {allPriorities.map((p) => (
                                <option key={p} value={p}>{p}</option>
                              ))}
                            </select>
                            <SeverityBadge severity={task.priority} />
                          </td>
                          <td className="px-3 py-2">
                            <span className={`text-sm ${task.status === "done" ? "line-through text-gray-400" : "text-gray-800 dark:text-gray-200"}`} data-testid={`text-task-title-${task.id}`}>
                              {task.title}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={task.status}
                              onChange={(e) => updateTaskMutation.mutate({ id: task.id, status: e.target.value })}
                              className="text-[10px] border-0 bg-transparent cursor-pointer p-0"
                              data-testid={`select-status-${task.id}`}
                            >
                              {allStatuses.map((s) => (
                                <option key={s} value={s}>{s.replace("_", " ")}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            {task.projectName ? (
                              <Link
                                href={`/project/${encodeURIComponent(task.projectName)}`}
                                className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                                data-testid={`link-project-${task.id}`}
                              >
                                <ExternalLink className="h-3 w-3" />
                                {task.projectName.replace(/_/g, " ")}
                              </Link>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {task.tag ? (
                              <Badge variant="outline" className="text-[10px]" data-testid={`badge-tag-${task.id}`}>{task.tag}</Badge>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {editingDateTaskId === task.id ? (
                              <div className="flex gap-1">
                                <Input
                                  type="date"
                                  value={editingDateValue}
                                  onChange={(e) => setEditingDateValue(e.target.value)}
                                  className="h-6 text-xs w-32"
                                  autoFocus
                                  onBlur={() => handleSetPlannedDate(task.id)}
                                  onKeyDown={(e) => { if (e.key === "Enter") handleSetPlannedDate(task.id); if (e.key === "Escape") { setEditingDateTaskId(null); setEditingDateValue(""); } }}
                                  data-testid={`input-planned-date-${task.id}`}
                                />
                              </div>
                            ) : (
                              <button
                                onClick={() => { setEditingDateTaskId(task.id); setEditingDateValue(task.plannedForDate || ""); }}
                                className="text-xs text-gray-600 dark:text-gray-400 hover:text-blue-600 flex items-center gap-1"
                                data-testid={`button-set-planned-${task.id}`}
                              >
                                <Calendar className="h-3 w-3" />
                                {task.plannedForDate ? format(new Date(task.plannedForDate + "T00:00:00"), "d MMM") : "Set date"}
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {task.dueDate ? format(new Date(task.dueDate + "T00:00:00"), "d MMM") : "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {task.createdAt ? format(new Date(task.createdAt), "d MMM") : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              {task.status !== "done" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-emerald-600 hover:text-emerald-700"
                                  onClick={() => updateTaskMutation.mutate({ id: task.id, status: "done" })}
                                  title="Mark done"
                                  data-testid={`button-done-${task.id}`}
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                                onClick={() => deleteTaskMutation.mutate(task.id)}
                                disabled={deleteTaskMutation.isPending}
                                title="Delete"
                                data-testid={`button-delete-${task.id}`}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="md:hidden space-y-2" data-testid="backlog-card-list">
            {filteredTasks.map((task) => (
              <Card
                key={task.id}
                className={selectedIds.has(task.id) ? "ring-2 ring-blue-500" : ""}
                data-testid={`backlog-card-${task.id}`}
              >
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(task.id)}
                      onChange={() => toggleSelect(task.id)}
                      className="rounded mt-1"
                      data-testid={`checkbox-task-mobile-${task.id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <SeverityBadge severity={task.priority} />
                        <StatusBadge status={task.status} />
                      </div>
                      <p className={`text-sm font-medium ${task.status === "done" ? "line-through text-gray-400" : "text-gray-800 dark:text-gray-200"}`} data-testid={`text-task-title-mobile-${task.id}`}>
                        {task.title}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-1.5 text-xs text-gray-500">
                        {task.projectName && (
                          <Link
                            href={`/project/${encodeURIComponent(task.projectName)}`}
                            className="text-blue-600 flex items-center gap-1"
                            data-testid={`link-project-mobile-${task.id}`}
                          >
                            <ExternalLink className="h-3 w-3" />
                            {task.projectName.replace(/_/g, " ")}
                          </Link>
                        )}
                        {task.tag && <Badge variant="outline" className="text-[10px]">{task.tag}</Badge>}
                        {task.plannedForDate && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(task.plannedForDate + "T00:00:00"), "d MMM")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 justify-end border-t pt-2">
                    <select
                      value={task.status}
                      onChange={(e) => updateTaskMutation.mutate({ id: task.id, status: e.target.value })}
                      className="text-xs border rounded px-1.5 py-1 bg-white dark:bg-gray-900"
                      data-testid={`select-status-mobile-${task.id}`}
                    >
                      {allStatuses.map((s) => (
                        <option key={s} value={s}>{s.replace("_", " ")}</option>
                      ))}
                    </select>
                    <select
                      value={task.priority}
                      onChange={(e) => updateTaskMutation.mutate({ id: task.id, priority: e.target.value })}
                      className="text-xs border rounded px-1.5 py-1 bg-white dark:bg-gray-900"
                      data-testid={`select-priority-mobile-${task.id}`}
                    >
                      {allPriorities.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    {task.status !== "done" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-emerald-600"
                        onClick={() => updateTaskMutation.mutate({ id: task.id, status: "done" })}
                        data-testid={`button-done-mobile-${task.id}`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-red-500"
                      onClick={() => deleteTaskMutation.mutate(task.id)}
                      data-testid={`button-delete-mobile-${task.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <div className="flex items-center justify-between text-xs text-gray-400 pb-4">
        <span data-testid="text-task-count">
          {filteredTasks.length} of {tasks.length} tasks
        </span>
        <div className="flex gap-2">
          <button onClick={() => handleSort("priority")} className={`hover:text-gray-600 ${sortField === "priority" ? "text-blue-600 font-medium" : ""}`} data-testid="sort-footer-priority">
            Priority {sortField === "priority" && (sortDirection === "asc" ? "↑" : "↓")}
          </button>
          <button onClick={() => handleSort("status")} className={`hover:text-gray-600 ${sortField === "status" ? "text-blue-600 font-medium" : ""}`} data-testid="sort-footer-status">
            Status {sortField === "status" && (sortDirection === "asc" ? "↑" : "↓")}
          </button>
          <button onClick={() => handleSort("dueDate")} className={`hover:text-gray-600 ${sortField === "dueDate" ? "text-blue-600 font-medium" : ""}`} data-testid="sort-footer-due">
            Due {sortField === "dueDate" && (sortDirection === "asc" ? "↑" : "↓")}
          </button>
          <button onClick={() => handleSort("createdAt")} className={`hover:text-gray-600 ${sortField === "createdAt" ? "text-blue-600 font-medium" : ""}`} data-testid="sort-footer-created">
            Created {sortField === "createdAt" && (sortDirection === "asc" ? "↑" : "↓")}
          </button>
        </div>
      </div>
    </div>
  );
}
