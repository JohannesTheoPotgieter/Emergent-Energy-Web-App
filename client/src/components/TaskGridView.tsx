import { useState, useMemo, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus, Search, ArrowUpDown, ArrowUp, ArrowDown, Trash2,
  ChevronDown, ChevronRight, MoreHorizontal, Columns,
  AlertTriangle, TrendingUp, TrendingDown, Minus,
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

type ColumnKey =
  | "taskNumber" | "title" | "status" | "priority" | "assignees"
  | "plannedStart" | "plannedEnd" | "plannedDuration"
  | "actualStart" | "actualEnd" | "actualDuration"
  | "percentComplete" | "expectedPct" | "delta"
  | "comment" | "source";

interface ColumnDef {
  key: ColumnKey;
  label: string;
  defaultVisible: boolean;
  planningPreset: boolean;
  minWidth: string;
}

const ALL_COLUMNS: ColumnDef[] = [
  { key: "taskNumber", label: "Code", defaultVisible: true, planningPreset: true, minWidth: "60px" },
  { key: "title", label: "Task Name", defaultVisible: true, planningPreset: true, minWidth: "200px" },
  { key: "status", label: "Status", defaultVisible: true, planningPreset: true, minWidth: "120px" },
  { key: "priority", label: "Priority", defaultVisible: true, planningPreset: false, minWidth: "100px" },
  { key: "assignees", label: "Assignees", defaultVisible: true, planningPreset: false, minWidth: "120px" },
  { key: "plannedStart", label: "Planned Start", defaultVisible: false, planningPreset: true, minWidth: "110px" },
  { key: "plannedEnd", label: "Planned End", defaultVisible: false, planningPreset: true, minWidth: "110px" },
  { key: "plannedDuration", label: "Plan Days", defaultVisible: false, planningPreset: true, minWidth: "70px" },
  { key: "actualStart", label: "Actual Start", defaultVisible: false, planningPreset: true, minWidth: "110px" },
  { key: "actualEnd", label: "Actual End", defaultVisible: false, planningPreset: true, minWidth: "110px" },
  { key: "actualDuration", label: "Act Days", defaultVisible: false, planningPreset: true, minWidth: "70px" },
  { key: "percentComplete", label: "% Complete", defaultVisible: true, planningPreset: true, minWidth: "110px" },
  { key: "expectedPct", label: "Expected %", defaultVisible: false, planningPreset: true, minWidth: "90px" },
  { key: "delta", label: "Δ (Act-Exp)", defaultVisible: false, planningPreset: true, minWidth: "90px" },
  { key: "comment", label: "Comment", defaultVisible: false, planningPreset: true, minWidth: "140px" },
  { key: "source", label: "Source", defaultVisible: true, planningPreset: false, minWidth: "90px" },
];

type SortField = "title" | "status" | "priority" | "dueDate" | "percentComplete" | "taskNumber";
type SortDir = "asc" | "desc";
type GroupBy = "none" | "status" | "assignee" | "priority";

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

const formatDateShort = (dateStr: string | null | undefined): string => {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" });
  } catch {
    return dateStr;
  }
};

const getTaskDepth = (task: any, taskMap: Map<number, any>): number => {
  let depth = 0;
  let current = task;
  while (current?.parentTaskId && taskMap.has(current.parentTaskId)) {
    depth++;
    current = taskMap.get(current.parentTaskId);
  }
  return depth;
};

export default function TaskGridView({ projectName, onTaskClick }: TaskGridViewProps) {
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [searchText, setSearchText] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [collapsedParents, setCollapsedParents] = useState<Set<number>>(new Set());
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() =>
    new Set(ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key))
  );

  const { data: tasks = [], isLoading } = useQuery<any[]>({
    queryKey: ["planning-tasks", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/planning-tasks/${encodeURIComponent(projectName)}`);
      if (!res.ok) {
        const fallback = await fetch(`/api/operational-tasks/${encodeURIComponent(projectName)}`);
        if (!fallback.ok) return [];
        return fallback.json();
      }
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Record<string, unknown> }) => {
      await apiRequest("PATCH", `/api/operational-tasks/${id}`, updates);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planning-tasks", projectName] });
      qc.invalidateQueries({ queryKey: ["operational-tasks", projectName] });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (title: string) => {
      await apiRequest("POST", "/api/operational-tasks", { projectName, title, status: "Not Started" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planning-tasks", projectName] });
      qc.invalidateQueries({ queryKey: ["operational-tasks", projectName] });
      setNewTaskTitle("");
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ taskIds, updates }: { taskIds: number[]; updates: Record<string, unknown> }) => {
      await apiRequest("POST", "/api/operational-tasks/bulk-update", { taskIds, updates });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planning-tasks", projectName] });
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
      qc.invalidateQueries({ queryKey: ["planning-tasks", projectName] });
      qc.invalidateQueries({ queryKey: ["operational-tasks", projectName] });
      setSelectedIds(new Set());
    },
  });

  const taskMap = useMemo(() => {
    const map = new Map<number, any>();
    for (const t of tasks) map.set(t.id, t);
    return map;
  }, [tasks]);

  const filtered = useMemo(() => {
    let result = [...tasks];
    if (statusFilter !== "All") result = result.filter((t) => t.status === statusFilter);
    if (priorityFilter !== "All") result = result.filter((t) => t.priority === priorityFilter);
    if (searchText) {
      const lower = searchText.toLowerCase();
      result = result.filter((t) => t.title.toLowerCase().includes(lower) || (t.taskNumber || '').toLowerCase().includes(lower));
    }
    return result;
  }, [tasks, statusFilter, priorityFilter, searchText]);

  const visibleTasks = useMemo(() => {
    return filtered.filter(t => {
      let parentId = t.parentTaskId;
      while (parentId) {
        if (collapsedParents.has(parentId)) return false;
        const parent = taskMap.get(parentId);
        parentId = parent?.parentTaskId || null;
      }
      return true;
    });
  }, [filtered, collapsedParents, taskMap]);

  const kpis = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter(t => t.status === "Done").length;
    const behind = tasks.filter(t => t.planStatus === "behind").length;
    const ahead = tasks.filter(t => t.planStatus === "ahead").length;
    const avgPct = total > 0 ? Math.round(tasks.reduce((s, t) => s + (t.percentComplete || 0), 0) / total) : 0;
    return { total, done, behind, ahead, avgPct };
  }, [tasks]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  };

  const toggleParent = useCallback((id: number) => {
    setCollapsedParents(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const allSelected = visibleTasks.length > 0 && visibleTasks.every((t) => selectedIds.has(t.id));
  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(visibleTasks.map((t) => t.id)));
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

  const applyPreset = (preset: 'default' | 'planning') => {
    if (preset === 'planning') {
      setVisibleColumns(new Set(ALL_COLUMNS.filter(c => c.planningPreset).map(c => c.key)));
    } else {
      setVisibleColumns(new Set(ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key)));
    }
  };

  const toggleColumn = useCallback((col: ColumnKey) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });
  }, []);

  const activeColumns = ALL_COLUMNS.filter(c => visibleColumns.has(c.key));

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const getDeltaBadge = (task: any) => {
    const delta = task.delta;
    if (delta === undefined || delta === null) return null;
    if (task.planStatus === 'behind') {
      return (
        <Badge variant="outline" className="text-[9px] bg-red-50 text-red-700 border-red-300 gap-0.5 px-1 py-0">
          <TrendingDown className="h-3 w-3" /> {Math.abs(delta)}% behind
        </Badge>
      );
    }
    if (task.planStatus === 'ahead') {
      return (
        <Badge variant="outline" className="text-[9px] bg-green-50 text-green-700 border-green-300 gap-0.5 px-1 py-0">
          <TrendingUp className="h-3 w-3" /> {delta}% ahead
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-[9px] bg-gray-50 text-gray-600 border-gray-200 gap-0.5 px-1 py-0">
        <Minus className="h-3 w-3" /> On track
      </Badge>
    );
  };

  const renderCellValue = (task: any, col: ColumnDef) => {
    const depth = getTaskDepth(task, taskMap);
    const hasChildren = task.isParent || task.childCount > 0;
    const isCollapsed = collapsedParents.has(task.id);

    switch (col.key) {
      case "taskNumber":
        return <span className="font-mono text-xs text-muted-foreground">{task.taskNumber || "—"}</span>;
      case "title":
        return (
          <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 20}px` }}>
            {hasChildren && (
              <button
                className="p-0.5 rounded hover:bg-muted/80 shrink-0"
                onClick={(e) => { e.stopPropagation(); toggleParent(task.id); }}
                data-testid={`button-collapse-${task.id}`}
              >
                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
            )}
            {!hasChildren && depth > 0 && <span className="w-4 shrink-0" />}
            <button
              data-testid={`link-task-${task.id}`}
              className={`text-left hover:underline cursor-pointer bg-transparent border-none p-0 truncate max-w-[220px] ${hasChildren ? "font-semibold text-foreground" : "font-medium text-primary"}`}
              onClick={() => onTaskClick(task.id)}
            >
              {task.title}
            </button>
            {hasChildren && <Badge variant="secondary" className="text-[8px] px-1 py-0 ml-1 shrink-0">{task.childCount}</Badge>}
          </div>
        );
      case "status":
        return (
          <Select value={task.status} onValueChange={(v) => handleInlineUpdate(task.id, "status", v)}>
            <SelectTrigger data-testid={`select-status-${task.id}`} className="h-7 text-xs border-0 shadow-none p-1">
              <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[task.status] || ""}`}>{task.status}</Badge>
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}><Badge variant="outline" className={`text-xs ${STATUS_COLORS[s]}`}>{s}</Badge></SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case "priority":
        return (
          <Select value={task.priority} onValueChange={(v) => handleInlineUpdate(task.id, "priority", v)}>
            <SelectTrigger data-testid={`select-priority-${task.id}`} className="h-7 text-xs border-0 shadow-none p-1">
              <Badge variant="outline" className={`text-[10px] ${PRIORITY_COLORS[task.priority] || ""}`}>{task.priority}</Badge>
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}><Badge variant="outline" className={`text-xs ${PRIORITY_COLORS[p]}`}>{p}</Badge></SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case "assignees":
        return (
          <Input
            data-testid={`input-assignees-${task.id}`}
            className="h-7 text-xs border-0 shadow-none bg-transparent"
            defaultValue={task.assignees?.join(", ") || ""}
            onBlur={(e) => handleInlineUpdate(task.id, "assignees", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
          />
        );
      case "plannedStart":
        return task.isBaseline ? (
          <span className="text-xs text-muted-foreground">{formatDateShort(task.startDate)}</span>
        ) : (
          <Input type="date" data-testid={`input-planned-start-${task.id}`}
            className="h-7 text-xs border-0 shadow-none bg-transparent w-full"
            defaultValue={formatDateForDisplay(task.startDate)}
            onChange={(e) => handleInlineUpdate(task.id, "startDate", e.target.value)} />
        );
      case "plannedEnd":
        return task.isBaseline ? (
          <span className="text-xs text-muted-foreground">{formatDateShort(task.dueDate)}</span>
        ) : (
          <Input type="date" data-testid={`input-planned-end-${task.id}`}
            className="h-7 text-xs border-0 shadow-none bg-transparent w-full"
            defaultValue={formatDateForDisplay(task.dueDate)}
            onChange={(e) => handleInlineUpdate(task.id, "dueDate", e.target.value)} />
        );
      case "plannedDuration":
        return <span className="text-xs text-center block">{task.plannedDurationDays ?? "—"}</span>;
      case "actualStart":
        return (
          <Input type="date" data-testid={`input-actual-start-${task.id}`}
            className="h-7 text-xs border-0 shadow-none bg-transparent w-full"
            defaultValue={formatDateForDisplay(task.actualStartDate)}
            onChange={(e) => handleInlineUpdate(task.id, "actualStartDate", e.target.value)} />
        );
      case "actualEnd":
        return (
          <Input type="date" data-testid={`input-actual-end-${task.id}`}
            className="h-7 text-xs border-0 shadow-none bg-transparent w-full"
            defaultValue={formatDateForDisplay(task.actualEndDate)}
            onChange={(e) => handleInlineUpdate(task.id, "actualEndDate", e.target.value)} />
        );
      case "actualDuration":
        return <span className="text-xs text-center block">{task.computedActualDurationDays ?? "—"}</span>;
      case "percentComplete":
        return (
          <div className="flex items-center gap-1">
            <Input type="number" min={0} max={100}
              data-testid={`input-percent-${task.id}`}
              className="h-7 w-12 text-xs border-0 shadow-none bg-transparent"
              defaultValue={task.percentComplete}
              onBlur={(e) => handleInlineUpdate(task.id, "percentComplete", Math.max(0, Math.min(100, Number(e.target.value))))} />
            <Progress value={task.percentComplete} className="h-2 w-10" data-testid={`progress-${task.id}`} />
          </div>
        );
      case "expectedPct":
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-muted-foreground text-center block">
                  {task.computedExpectedPct !== null && task.computedExpectedPct !== undefined ? `${task.computedExpectedPct}%` : "—"}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <p>Auto-calculated from planned dates</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case "delta":
        return getDeltaBadge(task);
      case "comment":
        return (
          <Input data-testid={`input-comment-${task.id}`}
            className="h-7 text-xs border-0 shadow-none bg-transparent"
            defaultValue={task.comment || ""}
            placeholder="Note..."
            onBlur={(e) => handleInlineUpdate(task.id, "comment", e.target.value)} />
        );
      case "source":
        return (
          <Badge data-testid={`badge-source-${task.id}`} variant="outline"
            className={task.isBaseline ? "text-[9px] bg-blue-50 text-blue-700 border-blue-300" : "text-[9px] bg-green-50 text-green-700 border-green-300"}>
            {task.isBaseline ? "BASE" : "OPS"}
          </Badge>
        );
      default:
        return "—";
    }
  };

  if (isLoading) {
    return <div data-testid="loading-grid" className="flex items-center justify-center py-12 text-muted-foreground">Loading tasks…</div>;
  }

  return (
    <div data-testid="task-grid-view" className="space-y-3">
      {/* KPI Summary Bar */}
      <div className="flex items-center gap-4 px-3 py-2 bg-muted/40 rounded-md border text-sm">
        <span className="font-medium">{kpis.total} tasks</span>
        <span className="text-green-700">{kpis.done} done</span>
        <span className="text-muted-foreground">Avg {kpis.avgPct}%</span>
        {kpis.behind > 0 && (
          <span className="flex items-center gap-1 text-red-600">
            <AlertTriangle className="h-3.5 w-3.5" /> {kpis.behind} behind
          </span>
        )}
        {kpis.ahead > 0 && (
          <span className="flex items-center gap-1 text-green-600">
            <TrendingUp className="h-3.5 w-3.5" /> {kpis.ahead} ahead
          </span>
        )}
      </div>

      {/* Filtering Toolbar */}
      <div className="flex flex-wrap items-center gap-2" data-testid="filter-toolbar">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input data-testid="input-search" placeholder="Search tasks…" className="pl-8 h-8 w-48 text-sm"
            value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger data-testid="select-status-filter" className="h-8 w-36 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger data-testid="select-priority-filter" className="h-8 w-32 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Priorities</SelectItem>
            {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
          <SelectTrigger data-testid="select-groupby" className="h-8 w-36 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Grouping</SelectItem>
            <SelectItem value="status">Group by Status</SelectItem>
            <SelectItem value="assignee">Group by Assignee</SelectItem>
            <SelectItem value="priority">Group by Priority</SelectItem>
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8" data-testid="button-columns">
              <Columns className="h-4 w-4 mr-1" /> Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => applyPreset('default')} className="text-xs font-medium text-blue-600">
              Default Preset
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => applyPreset('planning')} className="text-xs font-medium text-emerald-600">
              Planning Preset
            </DropdownMenuItem>
            <div className="border-t my-1" />
            {ALL_COLUMNS.map((col) => (
              <DropdownMenuCheckboxItem key={col.key} checked={visibleColumns.has(col.key)} onCheckedChange={() => toggleColumn(col.key)}>
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div data-testid="bulk-actions-bar" className="flex items-center gap-2 p-2 bg-muted rounded-md text-sm">
          <span className="font-medium">{selectedIds.size} selected</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-bulk-status">Change Status <ChevronDown className="ml-1 h-3 w-3" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {STATUSES.map((s) => (
                <DropdownMenuItem key={s} onClick={() => bulkUpdateMutation.mutate({ taskIds: Array.from(selectedIds), updates: { status: s } })}>{s}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-bulk-priority">Change Priority <ChevronDown className="ml-1 h-3 w-3" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {PRIORITIES.map((p) => (
                <DropdownMenuItem key={p} onClick={() => bulkUpdateMutation.mutate({ taskIds: Array.from(selectedIds), updates: { priority: p } })}>{p}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="destructive" size="sm" data-testid="button-bulk-delete"
            onClick={() => deleteMutation.mutate(Array.from(selectedIds))}>
            <Trash2 className="h-3 w-3 mr-1" /> Delete
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-md overflow-auto" style={{ maxHeight: "calc(100vh - 350px)" }}>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-slate-50">
            <TableRow>
              <TableHead className="w-10">
                <Checkbox data-testid="checkbox-select-all" checked={allSelected} onCheckedChange={toggleAll} />
              </TableHead>
              {activeColumns.map((col) => (
                <TableHead key={col.key} className="text-xs whitespace-nowrap" style={{ minWidth: col.minWidth }}>
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleTasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={activeColumns.length + 1} className="text-center py-8 text-muted-foreground" data-testid="empty-state">
                  No tasks found. Add one below.
                </TableCell>
              </TableRow>
            ) : (
              visibleTasks.map((task) => {
                const hasChildren = task.isParent || task.childCount > 0;
                return (
                  <TableRow key={task.id} data-testid={`row-task-${task.id}`}
                    className={`group hover:bg-muted/50 ${hasChildren ? "bg-slate-50/80" : ""} ${task.planStatus === 'behind' ? 'border-l-2 border-l-red-400' : task.planStatus === 'ahead' ? 'border-l-2 border-l-green-400' : ''}`}>
                    <TableCell className="w-10">
                      <Checkbox data-testid={`checkbox-task-${task.id}`} checked={selectedIds.has(task.id)} onCheckedChange={() => toggleOne(task.id)} />
                    </TableCell>
                    {activeColumns.map((col) => (
                      <TableCell key={col.key} style={{ minWidth: col.minWidth }}>
                        {renderCellValue(task, col)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
            {/* Quick Add Row */}
            <TableRow data-testid="row-add-task">
              <TableCell />
              <TableCell colSpan={Math.min(activeColumns.length, 3)}>
                <div className="flex items-center gap-2">
                  <Input data-testid="input-new-task" className="h-7 text-sm flex-1"
                    placeholder="Add a task…" value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddTask(); }} />
                  <Button data-testid="button-add-task" variant="ghost" size="sm"
                    onClick={handleAddTask} disabled={!newTaskTitle.trim()}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
              {activeColumns.length > 3 && <TableCell colSpan={activeColumns.length - 3} />}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
