import { useState, useMemo, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuCheckboxItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus, Search, Trash2,
  ChevronDown, ChevronRight, Columns, ListFilter,
  AlertTriangle, TrendingUp, TrendingDown, Minus,
  CheckCircle2, Clock, Circle, Ban, Loader2,
} from "lucide-react";

interface TaskGridViewProps {
  projectName: string;
  onTaskClick: (taskId: number) => void;
}

const STATUSES = ["Not Started", "In Progress", "Blocked", "Done"] as const;
const PRIORITIES = ["Urgent", "High", "Normal", "Low"] as const;

type ColumnKey =
  | "taskNumber" | "title" | "status" | "priority" | "escalation" | "assignees"
  | "plannedStart" | "plannedEnd" | "plannedDuration"
  | "actualStart" | "actualEnd" | "actualDuration"
  | "percentComplete" | "expectedPct" | "delta"
  | "comment" | "source";

interface ColumnDef {
  key: ColumnKey;
  label: string;
  shortLabel: string;
  defaultVisible: boolean;
  planningPreset: boolean;
  width: string;
  align: "left" | "center" | "right";
}

const ALL_COLUMNS: ColumnDef[] = [
  { key: "taskNumber", label: "Code", shortLabel: "#", defaultVisible: true, planningPreset: true, width: "56px", align: "center" },
  { key: "title", label: "Task Name", shortLabel: "Task", defaultVisible: true, planningPreset: true, width: "minmax(220px, 1fr)", align: "left" },
  { key: "status", label: "Status", shortLabel: "Status", defaultVisible: true, planningPreset: true, width: "110px", align: "center" },
  { key: "priority", label: "Priority", shortLabel: "Pri", defaultVisible: true, planningPreset: false, width: "90px", align: "center" },
  { key: "escalation", label: "Escalation", shortLabel: "Esc", defaultVisible: true, planningPreset: false, width: "100px", align: "center" },
  { key: "assignees", label: "Assignees", shortLabel: "Assign", defaultVisible: true, planningPreset: false, width: "120px", align: "left" },
  { key: "plannedStart", label: "Planned Start", shortLabel: "P.Start", defaultVisible: false, planningPreset: true, width: "100px", align: "center" },
  { key: "plannedEnd", label: "Planned End", shortLabel: "P.End", defaultVisible: false, planningPreset: true, width: "100px", align: "center" },
  { key: "plannedDuration", label: "Plan Days", shortLabel: "P.Days", defaultVisible: false, planningPreset: true, width: "64px", align: "center" },
  { key: "actualStart", label: "Actual Start", shortLabel: "A.Start", defaultVisible: false, planningPreset: true, width: "100px", align: "center" },
  { key: "actualEnd", label: "Actual End", shortLabel: "A.End", defaultVisible: false, planningPreset: true, width: "100px", align: "center" },
  { key: "actualDuration", label: "Act Days", shortLabel: "A.Days", defaultVisible: false, planningPreset: true, width: "64px", align: "center" },
  { key: "percentComplete", label: "% Complete", shortLabel: "% Done", defaultVisible: true, planningPreset: true, width: "130px", align: "left" },
  { key: "expectedPct", label: "Expected %", shortLabel: "Exp %", defaultVisible: true, planningPreset: true, width: "80px", align: "center" },
  { key: "delta", label: "Variance", shortLabel: "Var", defaultVisible: false, planningPreset: true, width: "110px", align: "center" },
  { key: "comment", label: "Comment", shortLabel: "Note", defaultVisible: false, planningPreset: true, width: "160px", align: "left" },
  { key: "source", label: "Source", shortLabel: "Src", defaultVisible: true, planningPreset: false, width: "64px", align: "center" },
];

type GroupBy = "none" | "status" | "priority";

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

const formatDateCompact = (dateStr: string | null | undefined): string => {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
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

const statusIcon = (s: string) => {
  switch (s) {
    case "Done": return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
    case "In Progress": return <Loader2 className="h-3.5 w-3.5 text-blue-600" />;
    case "Blocked": return <Ban className="h-3.5 w-3.5 text-red-500" />;
    default: return <Circle className="h-3.5 w-3.5 text-slate-400" />;
  }
};

const statusColors: Record<string, string> = {
  "Not Started": "bg-slate-100 text-slate-600",
  "In Progress": "bg-blue-50 text-blue-700",
  "Blocked": "bg-red-50 text-red-700",
  "Done": "bg-emerald-50 text-emerald-700",
};

const priorityDot: Record<string, string> = {
  "Urgent": "bg-red-500",
  "High": "bg-orange-400",
  "Normal": "bg-slate-400",
  "Low": "bg-blue-400",
};

const pctColor = (pct: number) => {
  if (pct >= 100) return "bg-emerald-500";
  if (pct >= 60) return "bg-emerald-400";
  if (pct >= 30) return "bg-blue-400";
  if (pct > 0) return "bg-amber-400";
  return "bg-slate-200";
};

export default function TaskGridView({ projectName, onTaskClick }: TaskGridViewProps) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [searchText, setSearchText] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
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
      for (const id of ids) await apiRequest("DELETE", `/api/operational-tasks/${id}`);
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
    if (statusFilter !== "All") result = result.filter(t => t.status === statusFilter);
    if (priorityFilter !== "All") result = result.filter(t => t.priority === priorityFilter);
    if (searchText) {
      const lower = searchText.toLowerCase();
      result = result.filter(t => t.title.toLowerCase().includes(lower) || (t.taskNumber || "").toLowerCase().includes(lower));
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
    const leafTasks = tasks.filter(t => !t.isParent && !t.childCount);
    const total = tasks.length;
    const done = tasks.filter(t => t.status === "Done").length;
    const inProgress = tasks.filter(t => t.status === "In Progress").length;
    const behind = tasks.filter(t => t.planStatus === "behind" && !t.isParent).length;
    const ahead = tasks.filter(t => t.planStatus === "ahead" && !t.isParent).length;
    const avgPct = leafTasks.length > 0 ? Math.round(leafTasks.reduce((s, t) => s + (t.percentComplete || 0), 0) / leafTasks.length) : 0;
    return { total, done, inProgress, behind, ahead, avgPct };
  }, [tasks]);

  const toggleParent = useCallback((id: number) => {
    setCollapsedParents(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const allSelected = visibleTasks.length > 0 && visibleTasks.every(t => selectedIds.has(t.id));
  const toggleAll = () => allSelected ? setSelectedIds(new Set()) : setSelectedIds(new Set(visibleTasks.map(t => t.id)));
  const toggleOne = (id: number) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleInlineUpdate = (id: number, field: string, value: unknown) => updateMutation.mutate({ id, updates: { [field]: value } });
  const handleAddTask = () => { if (newTaskTitle.trim()) createMutation.mutate(newTaskTitle.trim()); };

  const applyPreset = (preset: "default" | "planning") => {
    setVisibleColumns(new Set(ALL_COLUMNS.filter(c => preset === "planning" ? c.planningPreset : c.defaultVisible).map(c => c.key)));
  };
  const toggleColumn = useCallback((col: ColumnKey) => {
    setVisibleColumns(prev => { const n = new Set(prev); n.has(col) ? n.delete(col) : n.add(col); return n; });
  }, []);

  const activeColumns = ALL_COLUMNS.filter(c => visibleColumns.has(c.key));

  const renderCell = (task: any, col: ColumnDef) => {
    const depth = getTaskDepth(task, taskMap);
    const hasChildren = task.isParent || task.childCount > 0;
    const isCollapsed = collapsedParents.has(task.id);

    switch (col.key) {
      case "taskNumber":
        return (
          <span className={`font-mono text-[11px] tabular-nums ${hasChildren ? "font-bold text-slate-700" : "text-slate-500"}`}>
            {task.taskNumber || ""}
          </span>
        );

      case "title":
        return (
          <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: `${depth * 18}px` }}>
            {hasChildren ? (
              <button
                className="flex items-center justify-center w-5 h-5 rounded hover:bg-slate-200 transition-colors shrink-0"
                onClick={(e) => { e.stopPropagation(); toggleParent(task.id); }}
                data-testid={`button-collapse-${task.id}`}
              >
                {isCollapsed
                  ? <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                  : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
              </button>
            ) : depth > 0 ? (
              <span className="w-5 shrink-0" />
            ) : null}
            <button
              data-testid={`link-task-${task.id}`}
              className={`text-left hover:underline cursor-pointer bg-transparent border-none p-0 truncate leading-tight ${
                hasChildren ? "font-semibold text-slate-800 text-[13px]" : "font-medium text-slate-700 text-[12.5px]"
              }`}
              onClick={() => onTaskClick(task.id)}
              title={task.title}
            >
              {task.title}
            </button>
            {hasChildren && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[16px] rounded-full bg-slate-200 text-slate-600 text-[9px] font-semibold px-1 shrink-0">
                {task.childCount}
              </span>
            )}
          </div>
        );

      case "status":
        return isAdmin ? (
          <Select value={task.status} onValueChange={v => handleInlineUpdate(task.id, "status", v)}>
            <SelectTrigger data-testid={`select-status-${task.id}`} className="h-7 border-0 shadow-none p-0.5 w-full focus:ring-0">
              <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${statusColors[task.status] || "bg-slate-100 text-slate-600"}`}>
                {statusIcon(task.status)}
                <span className="truncate">{task.status}</span>
              </div>
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map(s => (
                <SelectItem key={s} value={s}>
                  <div className="flex items-center gap-2">{statusIcon(s)} <span>{s}</span></div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${statusColors[task.status] || "bg-slate-100 text-slate-600"}`}>
            {statusIcon(task.status)}
            <span className="truncate">{task.status}</span>
          </div>
        );

      case "priority":
        return isAdmin ? (
          <Select value={task.priority} onValueChange={v => handleInlineUpdate(task.id, "priority", v)}>
            <SelectTrigger data-testid={`select-priority-${task.id}`} className="h-7 border-0 shadow-none p-0.5 w-full focus:ring-0">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
                <span className={`w-2 h-2 rounded-full shrink-0 ${priorityDot[task.priority] || "bg-slate-400"}`} />
                {task.priority}
              </div>
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map(p => (
                <SelectItem key={p} value={p}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${priorityDot[p]}`} />
                    {p}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
            <span className={`w-2 h-2 rounded-full shrink-0 ${priorityDot[task.priority] || "bg-slate-400"}`} />
            {task.priority}
          </div>
        );

      case "escalation": {
        const escLevel = task.escalationLevel || "None";
        const escStyles: Record<string, string> = {
          None: "bg-slate-50 text-slate-400 border-slate-200",
          Low: "bg-blue-50 text-blue-600 border-blue-200",
          Medium: "bg-amber-50 text-amber-600 border-amber-200",
          High: "bg-orange-50 text-orange-600 border-orange-200",
          Highest: "bg-red-50 text-red-700 border-red-300",
        };
        const escStyle = escStyles[escLevel] || escStyles.None;
        return isAdmin ? (
          <select
            data-testid={`select-escalation-${task.id}`}
            className={`text-[10px] font-semibold rounded-md border px-1 py-0.5 cursor-pointer outline-none w-full ${escStyle}`}
            value={escLevel}
            onChange={(e) => {
              const val = e.target.value === "None" ? null : e.target.value;
              handleInlineUpdate(task.id, "escalationLevel", val);
            }}
          >
            <option value="None">None</option>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Highest">Highest</option>
          </select>
        ) : (
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-semibold ${escStyle}`}>
            {escLevel}
          </span>
        );
      }

      case "assignees":
        return isAdmin ? (
          <Input
            data-testid={`input-assignees-${task.id}`}
            className="h-7 text-[11px] border-0 shadow-none bg-transparent text-slate-600 placeholder:text-slate-300"
            defaultValue={task.assignees?.join(", ") || ""}
            placeholder="Unassigned"
            onBlur={e => handleInlineUpdate(task.id, "assignees", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
          />
        ) : (
          <span className="text-[11px] text-slate-600">{task.assignees?.join(", ") || "—"}</span>
        );

      case "plannedStart":
        return (task.isBaseline || !isAdmin) ? (
          <span className="text-[11px] text-slate-600 tabular-nums">{formatDateCompact(task.startDate)}</span>
        ) : (
          <Input type="date" data-testid={`input-planned-start-${task.id}`}
            className="h-7 text-[11px] border-0 shadow-none bg-transparent w-full tabular-nums"
            defaultValue={formatDateForDisplay(task.startDate)}
            onChange={e => handleInlineUpdate(task.id, "startDate", e.target.value)} />
        );

      case "plannedEnd":
        return (task.isBaseline || !isAdmin) ? (
          <span className="text-[11px] text-slate-600 tabular-nums">{formatDateCompact(task.dueDate)}</span>
        ) : (
          <Input type="date" data-testid={`input-planned-end-${task.id}`}
            className="h-7 text-[11px] border-0 shadow-none bg-transparent w-full tabular-nums"
            defaultValue={formatDateForDisplay(task.dueDate)}
            onChange={e => handleInlineUpdate(task.id, "dueDate", e.target.value)} />
        );

      case "plannedDuration":
        return (
          <span className={`text-[11px] tabular-nums ${task.plannedDurationDays ? "text-slate-700 font-medium" : "text-slate-300"}`}>
            {task.plannedDurationDays ?? "—"}
          </span>
        );

      case "actualStart":
        return isAdmin ? (
          <Input type="date" data-testid={`input-actual-start-${task.id}`}
            className="h-7 text-[11px] border-0 shadow-none bg-transparent w-full tabular-nums"
            defaultValue={formatDateForDisplay(task.actualStartDate)}
            onChange={e => handleInlineUpdate(task.id, "actualStartDate", e.target.value)} />
        ) : (
          <span className="text-[11px] text-slate-600 tabular-nums">{formatDateCompact(task.actualStartDate)}</span>
        );

      case "actualEnd":
        return isAdmin ? (
          <Input type="date" data-testid={`input-actual-end-${task.id}`}
            className="h-7 text-[11px] border-0 shadow-none bg-transparent w-full tabular-nums"
            defaultValue={formatDateForDisplay(task.actualEndDate)}
            onChange={e => handleInlineUpdate(task.id, "actualEndDate", e.target.value)} />
        ) : (
          <span className="text-[11px] text-slate-600 tabular-nums">{formatDateCompact(task.actualEndDate)}</span>
        );

      case "actualDuration":
        return (
          <span className={`text-[11px] tabular-nums ${task.computedActualDurationDays ? "text-slate-700 font-medium" : "text-slate-300"}`}>
            {task.computedActualDurationDays ?? "—"}
          </span>
        );

      case "percentComplete": {
        const pct = task.percentComplete || 0;
        return (
          <div className="flex items-center gap-2 w-full">
            <div className="flex-1 h-[6px] rounded-full bg-slate-100 overflow-hidden min-w-[40px]">
              <div className={`h-full rounded-full transition-all ${pctColor(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
            <span className={`text-[11px] tabular-nums font-semibold min-w-[28px] text-right ${pct >= 100 ? "text-emerald-600" : pct > 0 ? "text-slate-700" : "text-slate-400"}`}>
              {pct}%
            </span>
          </div>
        );
      }

      case "expectedPct": {
        const exp = task.computedExpectedPct;
        if (exp === null || exp === undefined) return <span className="text-[11px] text-slate-300">—</span>;
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`text-[11px] tabular-nums font-medium ${exp >= 100 ? "text-emerald-600" : "text-slate-600"}`}>
                  {exp}%
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">Time-based expected progress</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      }

      case "delta": {
        const d = task.delta;
        if (d === undefined || d === null) return <span className="text-[11px] text-slate-300">—</span>;
        if (task.planStatus === "behind") {
          return (
            <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-50 border border-red-200">
              <TrendingDown className="h-3 w-3 text-red-500" />
              <span className="text-[10px] font-semibold text-red-700">{Math.abs(d)}% behind</span>
            </div>
          );
        }
        if (task.planStatus === "ahead") {
          return (
            <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200">
              <TrendingUp className="h-3 w-3 text-emerald-500" />
              <span className="text-[10px] font-semibold text-emerald-700">{d}% ahead</span>
            </div>
          );
        }
        return (
          <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200">
            <Minus className="h-3 w-3 text-slate-400" />
            <span className="text-[10px] font-medium text-slate-500">On track</span>
          </div>
        );
      }

      case "comment":
        return isAdmin ? (
          <Input data-testid={`input-comment-${task.id}`}
            className="h-7 text-[11px] border-0 shadow-none bg-transparent text-slate-600 placeholder:text-slate-300"
            defaultValue={task.comment || ""} placeholder="Add note..."
            onBlur={e => handleInlineUpdate(task.id, "comment", e.target.value)} />
        ) : (
          <span className="text-[11px] text-slate-600">{task.comment || "—"}</span>
        );

      case "source":
        return task.isBaseline ? (
          <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-blue-100 text-blue-700">
            BASE
          </span>
        ) : (
          <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-emerald-100 text-emerald-700">
            OPS
          </span>
        );

      default: return "—";
    }
  };

  if (isLoading) {
    return (
      <div data-testid="loading-grid" className="flex items-center justify-center py-16 text-slate-400 gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading tasks...
      </div>
    );
  }

  return (
    <div data-testid="task-grid-view" className="space-y-3">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-white">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100">
            <Clock className="h-4 w-4 text-slate-600" />
          </div>
          <div>
            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Total</p>
            <p className="text-lg font-bold text-slate-800 leading-none">{kpis.total}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-white">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div>
            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Done</p>
            <p className="text-lg font-bold text-emerald-700 leading-none">{kpis.done}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-white">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50">
            <Loader2 className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Avg %</p>
            <p className="text-lg font-bold text-blue-700 leading-none">{kpis.avgPct}%</p>
          </div>
        </div>
        {kpis.behind > 0 && (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-red-200 bg-red-50/50">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-100">
              <AlertTriangle className="h-4 w-4 text-red-600" />
            </div>
            <div>
              <p className="text-[10px] text-red-600 font-medium uppercase tracking-wider">Behind</p>
              <p className="text-lg font-bold text-red-700 leading-none">{kpis.behind}</p>
            </div>
          </div>
        )}
        {kpis.ahead > 0 && (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50/50">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-100">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-[10px] text-emerald-600 font-medium uppercase tracking-wider">Ahead</p>
              <p className="text-lg font-bold text-emerald-700 leading-none">{kpis.ahead}</p>
            </div>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2" data-testid="filter-toolbar">
        <div className="relative flex-1 min-w-[180px] max-w-[260px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input data-testid="input-search" placeholder="Search tasks..." className="pl-8 h-8 text-[12px] bg-white"
            value={searchText} onChange={e => setSearchText(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger data-testid="select-status-filter" className="h-8 w-auto min-w-[120px] text-[12px] bg-white">
            <div className="flex items-center gap-1.5"><ListFilter className="h-3 w-3 text-slate-400" /><SelectValue /></div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Statuses</SelectItem>
            {STATUSES.map(s => <SelectItem key={s} value={s}><div className="flex items-center gap-2">{statusIcon(s)} {s}</div></SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger data-testid="select-priority-filter" className="h-8 w-auto min-w-[110px] text-[12px] bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Priorities</SelectItem>
            {PRIORITIES.map(p => <SelectItem key={p} value={p}><div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${priorityDot[p]}`} />{p}</div></SelectItem>)}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1.5" data-testid="button-columns">
              <Columns className="h-3.5 w-3.5" /> Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => applyPreset("default")} className="text-xs font-medium text-blue-600 cursor-pointer">
              Default View
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => applyPreset("planning")} className="text-xs font-medium text-emerald-600 cursor-pointer">
              Planning View (dates + progress)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {ALL_COLUMNS.map(col => (
              <DropdownMenuCheckboxItem key={col.key} checked={visibleColumns.has(col.key)} onCheckedChange={() => toggleColumn(col.key)} className="text-xs">
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isAdmin && selectedIds.size > 0 && (
        <div data-testid="bulk-actions-bar" className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm">
          <span className="font-semibold text-blue-700">{selectedIds.size} selected</span>
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs" data-testid="button-bulk-status">Status <ChevronDown className="ml-1 h-3 w-3" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {STATUSES.map(s => <DropdownMenuItem key={s} onClick={() => bulkUpdateMutation.mutate({ taskIds: Array.from(selectedIds), updates: { status: s } })}>{s}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs" data-testid="button-bulk-priority">Priority <ChevronDown className="ml-1 h-3 w-3" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {PRIORITIES.map(p => <DropdownMenuItem key={p} onClick={() => bulkUpdateMutation.mutate({ taskIds: Array.from(selectedIds), updates: { priority: p } })}>{p}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="destructive" size="sm" className="h-7 text-xs" data-testid="button-bulk-delete"
            onClick={() => deleteMutation.mutate(Array.from(selectedIds))}>
            <Trash2 className="h-3 w-3 mr-1" /> Delete
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
        <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 380px)" }}>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80 border-b-2 border-slate-200">
                <TableHead className="w-9 px-2 sticky top-0 bg-slate-50/80 z-10">
                  <Checkbox data-testid="checkbox-select-all" checked={allSelected} onCheckedChange={toggleAll} />
                </TableHead>
                {activeColumns.map(col => (
                  <TableHead key={col.key}
                    className={`text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-2 py-2.5 whitespace-nowrap sticky top-0 bg-slate-50/80 z-10 ${col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : "text-left"}`}
                    style={{ width: col.key === "title" ? undefined : col.width, minWidth: col.key === "title" ? "200px" : undefined }}>
                    {col.shortLabel}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleTasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={activeColumns.length + 1} className="text-center py-12" data-testid="empty-state">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <Circle className="h-8 w-8 stroke-1" />
                      <p className="text-sm font-medium">No tasks found</p>
                      <p className="text-xs">Add a task below to get started</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                visibleTasks.map(task => {
                  const hasChildren = task.isParent || task.childCount > 0;
                  const isBehind = task.planStatus === "behind" && !hasChildren;
                  return (
                    <TableRow key={task.id} data-testid={`row-task-${task.id}`}
                      className={[
                        "group transition-colors",
                        hasChildren ? "bg-slate-50/60 hover:bg-slate-100/80" : "hover:bg-slate-50/80",
                        isBehind ? "border-l-[3px] border-l-red-400" : task.planStatus === "ahead" && !hasChildren ? "border-l-[3px] border-l-emerald-400" : "border-l-[3px] border-l-transparent",
                      ].join(" ")}>
                      <TableCell className="w-9 px-2">
                        <Checkbox data-testid={`checkbox-task-${task.id}`} checked={selectedIds.has(task.id)} onCheckedChange={() => toggleOne(task.id)} />
                      </TableCell>
                      {activeColumns.map(col => (
                        <TableCell key={col.key}
                          className={`px-2 py-1.5 ${col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : "text-left"}`}
                          style={{ width: col.key === "title" ? undefined : col.width }}>
                          {renderCell(task, col)}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })
              )}
              {isAdmin && (
                <TableRow data-testid="row-add-task" className="bg-slate-25 border-t-2 border-slate-100">
                  <TableCell className="px-2" />
                  <TableCell colSpan={Math.min(activeColumns.length, 3)} className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <Plus className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <Input data-testid="input-new-task" className="h-8 text-[12px] flex-1 border-dashed"
                        placeholder="Add a new task..." value={newTaskTitle}
                        onChange={e => setNewTaskTitle(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handleAddTask(); }} />
                      <Button data-testid="button-add-task" variant="default" size="sm" className="h-8 px-3 text-xs shrink-0"
                        onClick={handleAddTask} disabled={!newTaskTitle.trim() || createMutation.isPending}>
                        {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
                      </Button>
                    </div>
                  </TableCell>
                  {activeColumns.length > 3 && <TableCell colSpan={activeColumns.length - 3} />}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
