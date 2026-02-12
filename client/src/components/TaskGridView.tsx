import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { OperationalTask } from "@shared/schema";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Search, ArrowUpDown, ArrowUp, ArrowDown, Trash2,
  ChevronDown, ChevronRight, Check, MoreHorizontal,
} from "lucide-react";

interface TaskGridViewProps {
  projectName: string;
  onTaskClick: (taskId: number) => void;
}

const STATUSES = ["Not Started", "In Progress", "Blocked", "Done"] as const;
const PRIORITIES = ["Urgent", "High", "Normal", "Low"] as const;

const STATUS_COLORS: Record<string, string> = {
  "Not Started": "bg-gray-100 text-gray-700 border-gray-300",
  "In Progress": "bg-blue-100 text-blue-700 border-blue-300",
  "Blocked": "bg-red-100 text-red-700 border-red-300",
  "Done": "bg-green-100 text-green-700 border-green-300",
};

const PRIORITY_COLORS: Record<string, string> = {
  "Urgent": "bg-red-100 text-red-700 border-red-300",
  "High": "bg-orange-100 text-orange-700 border-orange-300",
  "Normal": "bg-gray-100 text-gray-700 border-gray-300",
  "Low": "bg-blue-100 text-blue-700 border-blue-300",
};

type SortField = "title" | "status" | "priority" | "dueDate" | "percentComplete" | "taskNumber";
type SortDir = "asc" | "desc";
type GroupBy = "none" | "status" | "assignee" | "priority";

export default function TaskGridView({ projectName, onTaskClick }: TaskGridViewProps) {
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [searchText, setSearchText] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [newTaskTitle, setNewTaskTitle] = useState("");

  const { data: tasks = [], isLoading } = useQuery<OperationalTask[]>({
    queryKey: ["operational-tasks", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/operational-tasks/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Record<string, unknown> }) => {
      await apiRequest("PATCH", `/api/operational-tasks/${id}`, updates);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["operational-tasks", projectName] }),
  });

  const createMutation = useMutation({
    mutationFn: async (title: string) => {
      await apiRequest("POST", "/api/operational-tasks", { projectName, title, status: "Not Started" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["operational-tasks", projectName] });
      setNewTaskTitle("");
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ taskIds, updates }: { taskIds: number[]; updates: Record<string, unknown> }) => {
      await apiRequest("POST", "/api/operational-tasks/bulk-update", { taskIds, updates });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["operational-tasks", projectName] });
      setSelectedIds(new Set());
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) {
        await apiRequest("DELETE", `/api/operational-tasks/${id}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["operational-tasks", projectName] });
      setSelectedIds(new Set());
    },
  });

  const filtered = useMemo(() => {
    let result = [...tasks];
    if (statusFilter !== "All") result = result.filter((t) => t.status === statusFilter);
    if (priorityFilter !== "All") result = result.filter((t) => t.priority === priorityFilter);
    if (searchText) {
      const lower = searchText.toLowerCase();
      result = result.filter((t) => t.title.toLowerCase().includes(lower));
    }
    if (sortField) {
      result.sort((a, b) => {
        const av = a[sortField] ?? "";
        const bv = b[sortField] ?? "";
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return result;
  }, [tasks, statusFilter, priorityFilter, searchText, sortField, sortDir]);

  const grouped = useMemo(() => {
    if (groupBy === "none") return null;
    const map = new Map<string, OperationalTask[]>();
    for (const t of filtered) {
      let key: string;
      if (groupBy === "status") key = t.status;
      else if (groupBy === "priority") key = t.priority;
      else key = (t.assignees && t.assignees.length > 0) ? t.assignees.join(", ") : "Unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [filtered, groupBy]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && filtered.every((t) => selectedIds.has(t.id));
  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((t) => t.id)));
  };
  const toggleOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleInlineUpdate = (id: number, field: string, value: unknown) => {
    updateMutation.mutate({ id, updates: { [field]: value } });
  };

  const handleAddTask = () => {
    if (!newTaskTitle.trim()) return;
    createMutation.mutate(newTaskTitle.trim());
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const formatDateForDisplay = (dateStr: string | null | undefined): string => {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toISOString().split("T")[0];
    } catch {
      return dateStr;
    }
  };

  const renderRow = (task: OperationalTask) => {
    return (
      <TableRow key={task.id} data-testid={`row-task-${task.id}`} className="group hover:bg-muted/50">
        <TableCell className="w-10">
          <Checkbox
            data-testid={`checkbox-task-${task.id}`}
            checked={selectedIds.has(task.id)}
            onCheckedChange={() => toggleOne(task.id)}
          />
        </TableCell>
        <TableCell className="w-16 text-xs text-muted-foreground font-mono" data-testid={`text-tasknum-${task.id}`}>
          {task.taskNumber || "—"}
        </TableCell>
        <TableCell className="min-w-[200px]">
          <button
            data-testid={`link-task-${task.id}`}
            className="text-left font-medium text-primary hover:underline cursor-pointer bg-transparent border-none p-0"
            onClick={() => onTaskClick(task.id)}
          >
            {task.title}
          </button>
        </TableCell>
        <TableCell className="w-36">
          <Select
            value={task.status}
            onValueChange={(v) => handleInlineUpdate(task.id, "status", v)}
          >
            <SelectTrigger data-testid={`select-status-${task.id}`} className="h-7 text-xs border-0 shadow-none">
              <Badge variant="outline" className={`text-xs ${STATUS_COLORS[task.status] || ""}`}>
                {task.status}
              </Badge>
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  <Badge variant="outline" className={`text-xs ${STATUS_COLORS[s]}`}>{s}</Badge>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell className="w-28">
          <Select
            value={task.priority}
            onValueChange={(v) => handleInlineUpdate(task.id, "priority", v)}
          >
            <SelectTrigger data-testid={`select-priority-${task.id}`} className="h-7 text-xs border-0 shadow-none">
              <Badge variant="outline" className={`text-xs ${PRIORITY_COLORS[task.priority] || ""}`}>
                {task.priority}
              </Badge>
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  <Badge variant="outline" className={`text-xs ${PRIORITY_COLORS[p]}`}>{p}</Badge>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell className="w-32">
          <Input
            data-testid={`input-assignees-${task.id}`}
            className="h-7 text-xs border-0 shadow-none bg-transparent"
            defaultValue={task.assignees?.join(", ") || ""}
            onBlur={(e) => {
              const val = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
              handleInlineUpdate(task.id, "assignees", val);
            }}
          />
        </TableCell>
        <TableCell className="w-32">
          <Input
            data-testid={`input-startdate-${task.id}`}
            type="date"
            className="h-7 text-xs border-0 shadow-none bg-transparent"
            defaultValue={formatDateForDisplay(task.startDate)}
            onChange={(e) => handleInlineUpdate(task.id, "startDate", e.target.value)}
          />
        </TableCell>
        <TableCell className="w-32">
          <Input
            data-testid={`input-duedate-${task.id}`}
            type="date"
            className="h-7 text-xs border-0 shadow-none bg-transparent"
            defaultValue={formatDateForDisplay(task.dueDate)}
            onChange={(e) => handleInlineUpdate(task.id, "dueDate", e.target.value)}
          />
        </TableCell>
        <TableCell className="w-28">
          <div className="flex items-center gap-1">
            <Input
              data-testid={`input-percent-${task.id}`}
              type="number"
              min={0}
              max={100}
              className="h-7 w-14 text-xs border-0 shadow-none bg-transparent"
              defaultValue={task.percentComplete}
              onBlur={(e) => {
                const v = Math.max(0, Math.min(100, Number(e.target.value)));
                handleInlineUpdate(task.id, "percentComplete", v);
              }}
            />
            <Progress value={task.percentComplete} className="h-2 w-12" data-testid={`progress-${task.id}`} />
          </div>
        </TableCell>
        <TableCell className="w-24">
          <Badge
            data-testid={`badge-source-${task.id}`}
            variant="outline"
            className={task.isBaseline ? "text-xs bg-blue-50 text-blue-700 border-blue-300" : "text-xs bg-green-50 text-green-700 border-green-300"}
          >
            {task.isBaseline ? "BASELINE" : "OPERATIONAL"}
          </Badge>
        </TableCell>
      </TableRow>
    );
  };

  if (isLoading) {
    return (
      <div data-testid="loading-grid" className="flex items-center justify-center py-12 text-muted-foreground">
        Loading tasks…
      </div>
    );
  }

  return (
    <div data-testid="task-grid-view" className="space-y-3">
      {/* Filtering Toolbar */}
      <div className="flex flex-wrap items-center gap-2" data-testid="filter-toolbar">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-search"
            placeholder="Search tasks…"
            className="pl-8 h-8 w-48 text-sm"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger data-testid="select-status-filter" className="h-8 w-36 text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger data-testid="select-priority-filter" className="h-8 w-32 text-sm">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Priorities</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
          <SelectTrigger data-testid="select-groupby" className="h-8 w-36 text-sm">
            <SelectValue placeholder="Group by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Grouping</SelectItem>
            <SelectItem value="status">Group by Status</SelectItem>
            <SelectItem value="assignee">Group by Assignee</SelectItem>
            <SelectItem value="priority">Group by Priority</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div data-testid="bulk-actions-bar" className="flex items-center gap-2 p-2 bg-muted rounded-md text-sm">
          <span className="font-medium">{selectedIds.size} selected</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-bulk-status">
                Change Status <ChevronDown className="ml-1 h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {STATUSES.map((s) => (
                <DropdownMenuItem key={s} onClick={() => bulkUpdateMutation.mutate({ taskIds: Array.from(selectedIds), updates: { status: s } })}>
                  {s}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-bulk-priority">
                Change Priority <ChevronDown className="ml-1 h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {PRIORITIES.map((p) => (
                <DropdownMenuItem key={p} onClick={() => bulkUpdateMutation.mutate({ taskIds: Array.from(selectedIds), updates: { priority: p } })}>
                  {p}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="destructive"
            size="sm"
            data-testid="button-bulk-delete"
            onClick={() => deleteMutation.mutate(Array.from(selectedIds))}
          >
            <Trash2 className="h-3 w-3 mr-1" /> Delete
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-md overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  data-testid="checkbox-select-all"
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead className="w-16 cursor-pointer" onClick={() => toggleSort("taskNumber")}>
                <div className="flex items-center text-xs"># <SortIcon field="taskNumber" /></div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => toggleSort("title")}>
                <div className="flex items-center text-xs">Title <SortIcon field="title" /></div>
              </TableHead>
              <TableHead className="w-36 cursor-pointer" onClick={() => toggleSort("status")}>
                <div className="flex items-center text-xs">Status <SortIcon field="status" /></div>
              </TableHead>
              <TableHead className="w-28 cursor-pointer" onClick={() => toggleSort("priority")}>
                <div className="flex items-center text-xs">Priority <SortIcon field="priority" /></div>
              </TableHead>
              <TableHead className="w-32 text-xs">Assignees</TableHead>
              <TableHead className="w-32 text-xs">Start Date</TableHead>
              <TableHead className="w-32 cursor-pointer" onClick={() => toggleSort("dueDate")}>
                <div className="flex items-center text-xs">Due Date <SortIcon field="dueDate" /></div>
              </TableHead>
              <TableHead className="w-28 cursor-pointer" onClick={() => toggleSort("percentComplete")}>
                <div className="flex items-center text-xs">% Done <SortIcon field="percentComplete" /></div>
              </TableHead>
              <TableHead className="w-24 text-xs">Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground" data-testid="empty-state">
                  No tasks found. Add one below.
                </TableCell>
              </TableRow>
            ) : grouped ? (
              Array.from(grouped.entries()).map(([key, groupTasks]) => (
                <GroupSection
                  key={key}
                  groupKey={key}
                  tasks={groupTasks}
                  collapsed={collapsedGroups.has(key)}
                  onToggle={() => toggleGroup(key)}
                  renderRow={renderRow}
                />
              ))
            ) : (
              filtered.map(renderRow)
            )}
            {/* Quick Add Row */}
            <TableRow data-testid="row-add-task">
              <TableCell colSpan={2} />
              <TableCell colSpan={7}>
                <div className="flex items-center gap-2">
                  <Input
                    data-testid="input-new-task"
                    className="h-7 text-sm flex-1"
                    placeholder="Add a task…"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddTask(); }}
                  />
                  <Button
                    data-testid="button-add-task"
                    variant="ghost"
                    size="sm"
                    onClick={handleAddTask}
                    disabled={!newTaskTitle.trim()}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function GroupSection({
  groupKey, tasks, collapsed, onToggle, renderRow,
}: {
  groupKey: string;
  tasks: OperationalTask[];
  collapsed: boolean;
  onToggle: () => void;
  renderRow: (task: OperationalTask) => React.ReactNode;
}) {
  return (
    <>
      <TableRow
        data-testid={`group-header-${groupKey}`}
        className="bg-muted/60 cursor-pointer hover:bg-muted"
        onClick={onToggle}
      >
        <TableCell colSpan={10}>
          <div className="flex items-center gap-2 font-medium text-sm">
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {groupKey}
            <Badge variant="secondary" className="text-xs">{tasks.length}</Badge>
          </div>
        </TableCell>
      </TableRow>
      {!collapsed && tasks.map(renderRow)}
    </>
  );
}
