import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { createMilestoneFlow, invalidateMilestoneCreationQueries } from "@/lib/milestone-create-flow";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
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
  Milestone, FolderPlus, Ungroup, X, ArrowUpDown, GripVertical, Hash, RefreshCw, Target,
} from "lucide-react";
import UserAssignmentPicker from "@/components/UserAssignmentPicker";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

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
  const seen = new Set<number>();
  while (current?.parentTaskId && taskMap.has(current.parentTaskId)) {
    if (seen.has(current.id)) return depth;
    seen.add(current.id);
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
    default: return <Circle className="h-3.5 w-3.5 text-slate-500" />;
  }
};

const statusColors: Record<string, string> = {
  "Not Started": "bg-muted text-muted-foreground",
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

function InlinePctEditor({ pct, onCommit }: { pct: number; onCommit: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState(String(pct));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setLocalVal(String(pct)); }, [pct]);

  const commit = () => {
    const parsed = Math.min(100, Math.max(0, parseInt(localVal) || 0));
    setEditing(false);
    onCommit(parsed);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          data-testid="inline-pct-input"
          className="w-12 h-5 text-[11px] tabular-nums text-center border border-primary/40 rounded bg-background outline-none focus:ring-1 focus:ring-primary/30"
          type="number"
          min={0}
          max={100}
          value={localVal}
          onChange={(e) => setLocalVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          autoFocus
        />
        <span className="text-[10px] text-muted-foreground">%</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 w-full cursor-pointer group"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="Click to edit % complete"
      data-testid="inline-pct-display"
    >
      <div className="flex-1 h-[6px] rounded-full bg-muted overflow-hidden min-w-[40px]">
        <div className={`h-full rounded-full transition-all ${pctColor(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`text-[11px] tabular-nums font-semibold min-w-[28px] text-right group-hover:text-primary group-hover:underline ${pct >= 100 ? "text-emerald-600" : pct > 0 ? "text-foreground" : "text-slate-500"}`}>
        {pct}%
      </span>
    </div>
  );
}

export default function TaskGridView({ projectName, onTaskClick }: TaskGridViewProps) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [searchText, setSearchText] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [collapsedParents, setCollapsedParents] = useState<Set<number>>(new Set());
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false);
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneCreateError, setMilestoneCreateError] = useState<string | null>(null);
  const [milestoneCreateSuccess, setMilestoneCreateSuccess] = useState<string | null>(null);
  const [isCreatingMilestone, setIsCreatingMilestone] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [chosenMilestoneId, setChosenMilestoneId] = useState<number | null>(null);
  const [groupNewMilestoneTitle, setGroupNewMilestoneTitle] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() =>
    new Set(ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key))
  );

  const [dragId, setDragId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [showRenumberPrompt, setShowRenumberPrompt] = useState(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: tasks = [], isLoading } = useQuery<any[]>({
    queryKey: ["planning-tasks", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/planning-tasks/${encodeURIComponent(projectName)}`, { credentials: "include" });
      if (!res.ok) {
        const fallback = await fetch(`/api/operational-tasks/${encodeURIComponent(projectName)}`, { credentials: "include" });
        if (!fallback.ok) return [];
        return fallback.json();
      }
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Record<string, unknown> }) => {
      const isBaseline = id < 0;
      if (isBaseline) {
        await apiRequest("PATCH", `/api/planning-tasks/${id}`, { projectName, ...updates });
      } else {
        await apiRequest("PATCH", `/api/planning-tasks/${id}`, { projectName, ...updates });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planning-tasks", projectName] });
      qc.invalidateQueries({ queryKey: ["operational-tasks", projectName] });
      qc.invalidateQueries({ queryKey: ["working-plan", projectName] });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (title: string) => {
      await apiRequest("POST", "/api/planning-tasks", { projectName, title, status: "Not Started" });
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
      const opsIds = ids.filter(id => id > 0);
      const baselineIds = ids.filter(id => id < 0);

      if (opsIds.length > 0) {
        for (const id of opsIds) await apiRequest("DELETE", `/api/operational-tasks/${id}`);
      }

      if (baselineIds.length > 0) {
        const baselineTasks = tasks.filter(t => baselineIds.includes(t.id) && t.isBaseline && t.rowNumber);
        if (baselineTasks.length > 0) {
          const byPlanProject = new Map<string, number[]>();
          for (const t of baselineTasks) {
            const pName = (t as any).planProjectName || projectName;
            if (!byPlanProject.has(pName)) byPlanProject.set(pName, []);
            byPlanProject.get(pName)!.push(t.rowNumber);
          }
          for (const [pName, rowNumbers] of byPlanProject) {
            await apiRequest("POST", "/api/project-plan/delete-tasks", {
              projectName: pName,
              rowNumbers,
            });
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planning-tasks", projectName] });
      qc.invalidateQueries({ queryKey: ["operational-tasks", projectName] });
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      setSelectedIds(new Set());
    },
  });

  const structureMutation = useMutation({
    mutationFn: async ({ operation, data }: { operation: string; data: any }) => {
      await apiRequest("POST", "/api/project-plan/structure", { operation, projectName, data });
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["planning-tasks", projectName] });
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      setSelectedIds(new Set());
      if (["setParent", "convertToMilestone", "createMilestone", "removeMilestone", "deleteMilestone"].includes(variables.operation)) {
        setShowRenumberPrompt(true);
      }
    },
  });

  const renumberMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/project-plan/structure", { operation: "renumber", projectName, data: {} });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planning-tasks", projectName] });
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      setShowRenumberPrompt(false);
      toast({ title: "Numbering updated", description: "Task numbers now reflect the current structure." });
    },
  });

  const handleCreateMilestone = async () => {
    setMilestoneCreateError(null);
    setMilestoneCreateSuccess(null);
    setIsCreatingMilestone(true);

    const result = await createMilestoneFlow({
      title: milestoneTitle,
      projectName,
      request: apiRequest,
    });

    setIsCreatingMilestone(false);
    if (!result.ok) {
      setMilestoneCreateError(result.message);
      return;
    }

    invalidateMilestoneCreationQueries((queryKey) => qc.invalidateQueries({ queryKey }), projectName);
    setSelectedIds(new Set());
    setMilestoneCreateSuccess("Milestone created successfully.");
    setMilestoneDialogOpen(false);
    setMilestoneTitle("");
    setShowRenumberPrompt(true);
    toast({ title: "Milestone created" });
  };

  const milestones = useMemo(() => {
    return tasks.filter((t: any) => t.isVirtualMilestone || t.isMilestone);
  }, [tasks]);

  const handleGroupUnderMilestone = (milestoneRowNumber: number) => {
    const selected = Array.from(selectedIds);
    const rowNumbers = selected
      .map(id => tasks.find((t: any) => t.id === id))
      .filter(Boolean)
      .map((t: any) => t.rowNumber)
      .filter((rn: any) => rn != null);
    if (rowNumbers.length === 0) return;
    structureMutation.mutate(
      { operation: "setParent", data: { taskRowNumbers: rowNumbers, parentRowNumber: milestoneRowNumber } },
      { onSuccess: () => setGroupDialogOpen(false) }
    );
  };

  const createAndGroupMutation = useMutation({
    mutationFn: async (title: string) => {
      const selected = Array.from(selectedIds);
      const rowNumbers = selected
        .map(id => tasks.find((t: any) => t.id === id))
        .filter(Boolean)
        .map((t: any) => t.rowNumber)
        .filter((rn: any) => rn != null);

      const result = await createMilestoneFlow({
        title,
        projectName,
        request: apiRequest,
        selectedRowNumbers: rowNumbers,
      });

      if (!result.ok) {
        throw new Error(result.message);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planning-tasks", projectName] });
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      setSelectedIds(new Set());
      setGroupDialogOpen(false);
      setGroupNewMilestoneTitle("");
      setShowRenumberPrompt(true);
      toast({ title: "Milestone created and tasks grouped" });
    },
    onError: (err: any) => {
      toast({
        title: "Create milestone failed",
        description: err?.message || "Could not create milestone",
        variant: "destructive",
      });
    },
  });

  const handleCreateAndGroup = () => {
    if (!groupNewMilestoneTitle.trim()) return;
    createAndGroupMutation.mutate(groupNewMilestoneTitle.trim());
  };

  const handleUngroupTasks = () => {
    const selected = Array.from(selectedIds);
    const rowNumbers = selected
      .map(id => tasks.find((t: any) => t.id === id))
      .filter(Boolean)
      .map((t: any) => t.rowNumber)
      .filter((rn: any) => rn != null);
    if (rowNumbers.length === 0) return;
    structureMutation.mutate({ operation: "removeMilestone", data: { taskRowNumbers: rowNumbers } });
  };

  const handleDeleteMilestone = (milestoneRowNumber: number) => {
    structureMutation.mutate({ operation: "deleteMilestone", data: { milestoneRowNumber } });
  };

  const selectedTasksForConvert = useMemo(() => {
    if (!convertDialogOpen) return [];
    return Array.from(selectedIds)
      .map(id => tasks.find((t: any) => t.id === id))
      .filter((t: any) => t && t.rowNumber != null);
  }, [convertDialogOpen, selectedIds, tasks]);

  const handleConvertToMilestone = () => {
    if (chosenMilestoneId == null) return;
    const chosen = tasks.find((t: any) => t.id === chosenMilestoneId);
    if (!chosen || chosen.rowNumber == null) return;
    const subtaskRowNumbers = selectedTasksForConvert
      .filter((t: any) => t.id !== chosenMilestoneId)
      .map((t: any) => t.rowNumber);
    if (subtaskRowNumbers.length === 0) return;
    structureMutation.mutate(
      { operation: "convertToMilestone", data: { milestoneRowNumber: chosen.rowNumber, subtaskRowNumbers } },
      { onSuccess: () => { setConvertDialogOpen(false); setChosenMilestoneId(null); } }
    );
  };

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
      const seen = new Set<number>();
      while (parentId) {
        if (parentId === t.id || seen.has(parentId)) return true;
        seen.add(parentId);
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
    const expLeafs = leafTasks.filter(t => t.computedExpectedPct !== null && t.computedExpectedPct !== undefined);
    const avgExpectedPct = expLeafs.length > 0 ? Math.round(expLeafs.reduce((s, t) => s + (t.computedExpectedPct ?? 0), 0) / expLeafs.length) : null;
    const overallDelta = avgExpectedPct !== null ? avgPct - avgExpectedPct : null;
    return { total, done, inProgress, behind, ahead, avgPct, avgExpectedPct, overallDelta };
  }, [tasks]);

  const handleDragStart = useCallback((e: React.DragEvent, task: any) => {
    if (!isAdmin) return;
    const ids = selectedIds.has(task.id) ? Array.from(selectedIds) : [task.id];
    e.dataTransfer.setData("text/plain", JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
    setDragId(task.id);
  }, [isAdmin, selectedIds]);

  const handleDragOver = useCallback((e: React.DragEvent, task: any) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (task.id !== dragId) setDropTargetId(task.id);
  }, [dragId]);

  const handleDragLeave = useCallback(() => {
    if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    dragTimeoutRef.current = setTimeout(() => setDropTargetId(null), 50);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetTask: any) => {
    e.preventDefault();
    setDragId(null);
    setDropTargetId(null);
    if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    try {
      const draggedIds: number[] = JSON.parse(e.dataTransfer.getData("text/plain"));
      if (!draggedIds.length || draggedIds.includes(targetTask.id)) return;
      const draggedTasks = draggedIds.map(id => tasks.find((t: any) => t.id === id)).filter(Boolean);
      const dragRowNumbers = draggedTasks.map((t: any) => t.rowNumber).filter((rn: any) => rn != null);
      if (dragRowNumbers.length === 0) return;

      const targetIsParent = targetTask.isParent || targetTask.isMilestone || targetTask.isVirtualMilestone || targetTask.childCount > 0;
      if (targetIsParent && targetTask.rowNumber != null) {
        structureMutation.mutate(
          { operation: "setParent", data: { taskRowNumbers: dragRowNumbers, parentRowNumber: targetTask.rowNumber } },
          { onSuccess: () => toast({ title: "Tasks grouped", description: `${dragRowNumbers.length} task(s) added under "${targetTask.title || "milestone"}"` }) }
        );
      } else {
        const allRowNumbers = [...dragRowNumbers, targetTask.rowNumber].filter((rn: any) => rn != null);
        if (allRowNumbers.length < 2) return;
        structureMutation.mutate(
          { operation: "convertToMilestone", data: { milestoneRowNumber: targetTask.rowNumber, subtaskRowNumbers: dragRowNumbers } },
          { onSuccess: () => toast({ title: "Milestone created", description: `"${targetTask.title || "Task"}" is now a milestone with ${dragRowNumbers.length} subtask(s)` }) }
        );
      }
      setSelectedIds(new Set());
    } catch {}
  }, [tasks, structureMutation]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDropTargetId(null);
  }, []);

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
          <span className={`font-mono text-[11px] tabular-nums ${hasChildren ? "font-bold text-foreground" : "text-muted-foreground"}`}>
            {task.taskNumber || ""}
          </span>
        );

      case "title":
        return (
          <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: `${depth * 18}px` }}>
            {isAdmin && (
              <GripVertical className="h-3.5 w-3.5 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-grab" />
            )}
            {hasChildren ? (
              <button
                className="flex items-center justify-center w-5 h-5 rounded hover:bg-slate-200 transition-colors shrink-0"
                onClick={(e) => { e.stopPropagation(); toggleParent(task.id); }}
                data-testid={`button-collapse-${task.id}`}
              >
                {isCollapsed
                  ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
            ) : depth > 0 ? (
              <span className="w-5 shrink-0" />
            ) : null}
            <button
              data-testid={`link-task-${task.id}`}
              className={`text-left hover:underline cursor-pointer bg-transparent border-none p-0 truncate leading-tight ${
                hasChildren ? "font-semibold text-foreground text-[13px]" : "font-medium text-foreground text-[12.5px]"
              }`}
              onClick={() => onTaskClick(task.id)}
              title={task.title}
            >
              {task.title}
            </button>
            {hasChildren && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[16px] rounded-full bg-slate-200 text-muted-foreground text-[9px] font-semibold px-1 shrink-0">
                {task.childCount}
              </span>
            )}
          </div>
        );

      case "status":
        return isAdmin ? (
          <SearchableSelect
            value={task.status}
            onValueChange={v => handleInlineUpdate(task.id, "status", v)}
            data-testid={`select-status-${task.id}`}
            triggerClassName="h-7 border-0 shadow-none p-0.5 w-full focus:ring-0"
            options={STATUSES.map(s => ({ value: s, label: s }))}
          />
        ) : (
          <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${statusColors[task.status] || "bg-muted text-muted-foreground"}`}>
            {statusIcon(task.status)}
            <span className="truncate">{task.status}</span>
          </div>
        );

      case "priority":
        return isAdmin ? (
          <SearchableSelect
            value={task.priority}
            onValueChange={v => handleInlineUpdate(task.id, "priority", v)}
            data-testid={`select-priority-${task.id}`}
            triggerClassName="h-7 border-0 shadow-none p-0.5 w-full focus:ring-0"
            options={PRIORITIES.map(p => ({ value: p, label: p }))}
          />
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span className={`w-2 h-2 rounded-full shrink-0 ${priorityDot[task.priority] || "bg-slate-400"}`} />
            {task.priority}
          </div>
        );

      case "escalation": {
        const escLevel = task.escalationLevel || "None";
        const escStyles: Record<string, string> = {
          None: "bg-muted text-slate-500 border-border",
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
        return (
          <UserAssignmentPicker
            taskId={task.id > 0 ? task.id : -task.id}
            taskSource={task.id > 0 ? "operational" : "plan"}
            resolvedUsers={task.resolvedAssignees || null}
            textNames={task.assignees || null}
            mode="multi"
            size="xs"
            invalidateKeys={[`/api/operational-tasks/${projectName}`, "/api/my-work/all-tasks"]}
          />
        );

      case "plannedStart":
        return (task.isBaseline || !isAdmin) ? (
          <span className="text-[11px] text-muted-foreground tabular-nums">{formatDateCompact(task.startDate)}</span>
        ) : (
          <Input type="date" data-testid={`input-planned-start-${task.id}`}
            className="h-7 text-[11px] border-0 shadow-none bg-transparent w-full tabular-nums"
            defaultValue={formatDateForDisplay(task.startDate)}
            onChange={e => handleInlineUpdate(task.id, "startDate", e.target.value)} />
        );

      case "plannedEnd":
        return (task.isBaseline || !isAdmin) ? (
          <span className="text-[11px] text-muted-foreground tabular-nums">{formatDateCompact(task.dueDate)}</span>
        ) : (
          <Input type="date" data-testid={`input-planned-end-${task.id}`}
            className="h-7 text-[11px] border-0 shadow-none bg-transparent w-full tabular-nums"
            defaultValue={formatDateForDisplay(task.dueDate)}
            onChange={e => handleInlineUpdate(task.id, "dueDate", e.target.value)} />
        );

      case "plannedDuration":
        return (
          <span className={`text-[11px] tabular-nums ${task.plannedDurationDays ? "text-foreground font-medium" : "text-slate-600"}`}>
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
          <span className="text-[11px] text-muted-foreground tabular-nums">{formatDateCompact(task.actualStartDate)}</span>
        );

      case "actualEnd":
        return isAdmin ? (
          <Input type="date" data-testid={`input-actual-end-${task.id}`}
            className="h-7 text-[11px] border-0 shadow-none bg-transparent w-full tabular-nums"
            defaultValue={formatDateForDisplay(task.actualEndDate)}
            onChange={e => handleInlineUpdate(task.id, "actualEndDate", e.target.value)} />
        ) : (
          <span className="text-[11px] text-muted-foreground tabular-nums">{formatDateCompact(task.actualEndDate)}</span>
        );

      case "actualDuration":
        return (
          <span className={`text-[11px] tabular-nums ${task.computedActualDurationDays ? "text-foreground font-medium" : "text-slate-600"}`}>
            {task.computedActualDurationDays ?? "—"}
          </span>
        );

      case "percentComplete": {
        const pct = task.percentComplete || 0;
        return (
          <InlinePctEditor
            pct={pct}
            onCommit={(newPct) => {
              if (newPct !== pct) {
                updateMutation.mutate({ id: task.id, updates: { percentComplete: newPct } });
              }
            }}
          />
        );
      }

      case "expectedPct": {
        const exp = task.computedExpectedPct;
        if (exp === null || exp === undefined) return <span className="text-[11px] text-slate-600">—</span>;
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`text-[11px] tabular-nums font-medium ${exp >= 100 ? "text-emerald-600" : "text-muted-foreground"}`}>
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
        if (d === undefined || d === null) return <span className="text-[11px] text-slate-600">—</span>;
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
          <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted border border-border">
            <Minus className="h-3 w-3 text-slate-500" />
            <span className="text-[10px] font-medium text-muted-foreground">On track</span>
          </div>
        );
      }

      case "comment":
        return isAdmin ? (
          <Input data-testid={`input-comment-${task.id}`}
            className="h-7 text-[11px] border-0 shadow-none bg-transparent text-muted-foreground placeholder:text-slate-600"
            defaultValue={task.comment || ""} placeholder="Add note..."
            onBlur={e => handleInlineUpdate(task.id, "comment", e.target.value)} />
        ) : (
          <span className="text-[11px] text-muted-foreground">{task.comment || "—"}</span>
        );

      case "source":
        if (task.isVirtualMilestone) {
          return (
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-indigo-100 text-indigo-700">
                MS
              </span>
              {isAdmin && (
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-red-600 hover:text-red-600"
                  onClick={(e) => { e.stopPropagation(); handleDeleteMilestone(task.rowNumber); }}
                  title="Delete milestone"
                  data-testid={`button-delete-milestone-${task.id}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        }
        if (task.isMilestone && !task.isVirtualMilestone) {
          return (
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-indigo-100 text-indigo-700">
                MS
              </span>
              {isAdmin && (
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-muted-foreground"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const childRows = tasks
                      .filter((t: any) => t.parentRowNumber === task.rowNumber)
                      .map((t: any) => t.rowNumber)
                      .filter(Boolean);
                    const allRows = [...childRows, task.rowNumber].filter(Boolean);
                    structureMutation.mutate({
                      operation: "removeMilestone",
                      data: { taskRowNumbers: allRows },
                    });
                  }}
                  title="Ungroup all children"
                  data-testid={`button-ungroup-milestone-${task.id}`}
                >
                  <Ungroup className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        }
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
      <div data-testid="loading-grid" className="flex items-center justify-center py-16 text-slate-500 gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading tasks...
      </div>
    );
  }

  return (
    <div data-testid="task-grid-view" className="space-y-3">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-card card-hover animate-float-in stagger-1">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted">
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Total</p>
            <p className="text-lg font-bold text-foreground leading-none animate-number-pop">{kpis.total}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-card card-hover animate-float-in stagger-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Done</p>
            <p className="text-lg font-bold text-emerald-700 leading-none animate-number-pop">{kpis.done}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-card card-hover animate-float-in stagger-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50">
            <Loader2 className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Actual %</p>
            <div className="flex items-center gap-1.5">
              <p className="text-lg font-bold text-blue-700 leading-none animate-number-pop">{kpis.avgPct}%</p>
              {kpis.overallDelta !== null && kpis.overallDelta !== 0 && (
                <span className={`text-[10px] font-semibold px-1 py-0.5 rounded ${kpis.overallDelta > 0 ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50"}`}>
                  {kpis.overallDelta > 0 ? "+" : ""}{kpis.overallDelta}%
                </span>
              )}
            </div>
          </div>
        </div>
        {kpis.avgExpectedPct !== null && (
          <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border card-hover animate-float-in stagger-4 ${
            kpis.overallDelta !== null && kpis.overallDelta < 0 ? "border-amber-200 bg-amber-50/30" : "bg-card"
          }`}>
            <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${
              kpis.overallDelta !== null && kpis.overallDelta < 0 ? "bg-amber-100" : "bg-violet-50"
            }`}>
              <Target className={`h-4 w-4 ${
                kpis.overallDelta !== null && kpis.overallDelta < 0 ? "text-amber-600" : "text-violet-600"
              }`} />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Expected %</p>
              <p className={`text-lg font-bold leading-none animate-number-pop ${
                kpis.overallDelta !== null && kpis.overallDelta < 0 ? "text-amber-700" : "text-violet-700"
              }`}>{kpis.avgExpectedPct}%</p>
            </div>
          </div>
        )}
        {kpis.behind > 0 && (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-red-200 bg-red-50/50 card-hover animate-float-in stagger-5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-100">
              <AlertTriangle className="h-4 w-4 text-red-600" />
            </div>
            <div>
              <p className="text-[10px] text-red-600 font-medium uppercase tracking-wider">Behind</p>
              <p className="text-lg font-bold text-red-700 leading-none animate-number-pop">{kpis.behind}</p>
            </div>
          </div>
        )}
        {kpis.ahead > 0 && (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50/50 card-hover animate-float-in stagger-6">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-100">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-[10px] text-emerald-600 font-medium uppercase tracking-wider">Ahead</p>
              <p className="text-lg font-bold text-emerald-700 leading-none animate-number-pop">{kpis.ahead}</p>
            </div>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2" data-testid="filter-toolbar">
        <div className="relative flex-1 min-w-[180px] max-w-[260px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <Input data-testid="input-search" placeholder="Search tasks..." className="pl-8 h-8 text-[12px] bg-card"
            value={searchText} onChange={e => setSearchText(e.target.value)} />
        </div>
        <SearchableSelect
          value={statusFilter}
          onValueChange={setStatusFilter}
          data-testid="select-status-filter"
          triggerClassName="h-8 w-auto min-w-[120px] text-[12px] bg-card"
          options={[
            { value: "All", label: "All Statuses" },
            ...STATUSES.map(s => ({ value: s, label: s })),
          ]}
        />
        <SearchableSelect
          value={priorityFilter}
          onValueChange={setPriorityFilter}
          data-testid="select-priority-filter"
          triggerClassName="h-8 w-auto min-w-[110px] text-[12px] bg-card"
          options={[
            { value: "All", label: "All Priorities" },
            ...PRIORITIES.map(p => ({ value: p, label: p })),
          ]}
        />

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

      {isAdmin && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="button-create-milestone"
            onClick={() => setMilestoneDialogOpen(true)}>
            <Milestone className="h-3.5 w-3.5" /> Create Milestone
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="button-renumber"
            onClick={() => renumberMutation.mutate()}
            disabled={renumberMutation.isPending}>
            {renumberMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Hash className="h-3.5 w-3.5" />}
            Refresh Numbering
          </Button>
        </div>
      )}

      {showRenumberPrompt && isAdmin && (
        <div data-testid="renumber-prompt" className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm animate-slide-up-fade">
          <RefreshCw className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-amber-800 font-medium flex-1">
            Structure changed — task numbering may be out of date.
          </span>
          <Button size="sm" className="h-7 text-xs gap-1 bg-amber-600 hover:bg-amber-700" data-testid="button-renumber-now"
            onClick={() => renumberMutation.mutate()}
            disabled={renumberMutation.isPending}>
            {renumberMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Hash className="h-3 w-3" />}
            Update Numbers
          </Button>
          <button className="text-amber-600 hover:text-amber-600" onClick={() => setShowRenumberPrompt(false)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {isAdmin && selectedIds.size > 0 && (
        <div data-testid="bulk-actions-bar" className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm animate-slide-up-fade">
          <span className="font-semibold text-blue-700">{selectedIds.size} selected</span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid="button-group-tasks"
            onClick={() => { setGroupDialogOpen(true); setGroupNewMilestoneTitle(""); }}>
            <FolderPlus className="h-3 w-3" /> Group
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid="button-ungroup-tasks"
            onClick={handleUngroupTasks}>
            <Ungroup className="h-3 w-3" /> Ungroup
          </Button>
          {selectedIds.size >= 2 && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid="button-convert-milestone"
              onClick={() => { setConvertDialogOpen(true); setChosenMilestoneId(null); }}>
              <ArrowUpDown className="h-3 w-3" /> Convert to Milestone
            </Button>
          )}
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
      <div className="border rounded-lg overflow-hidden bg-card shadow-sm animate-fade-in stagger-3">
        <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 380px)" }}>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/80 border-b-2 border-border">
                <TableHead className="w-9 px-2 sticky top-0 bg-muted/80 z-10">
                  <Checkbox data-testid="checkbox-select-all" checked={allSelected} onCheckedChange={toggleAll} />
                </TableHead>
                {activeColumns.map(col => (
                  <TableHead key={col.key}
                    className={`text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-2.5 whitespace-nowrap sticky top-0 bg-muted/80 z-10 ${col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : "text-left"}`}
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
                    <div className="flex flex-col items-center gap-2 text-slate-500">
                      <Circle className="h-8 w-8 stroke-1" />
                      <p className="text-sm font-medium">No tasks found</p>
                      <p className="text-xs">Add a task below to get started</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                visibleTasks.map(task => {
                  const hasChildren = task.isParent || task.childCount > 0;
                  const isMsRow = task.isVirtualMilestone || task.isMilestone;
                  const isBehind = task.planStatus === "behind" && !hasChildren;
                  return (
                    <TableRow key={task.id} data-testid={`row-task-${task.id}`}
                      draggable={isAdmin}
                      onDragStart={e => handleDragStart(e, task)}
                      onDragOver={e => handleDragOver(e, task)}
                      onDragLeave={handleDragLeave}
                      onDrop={e => handleDrop(e, task)}
                      onDragEnd={handleDragEnd}
                      className={[
                        "group transition-colors",
                        dragId === task.id ? "opacity-40" : "",
                        dropTargetId === task.id ? "ring-2 ring-indigo-400 ring-inset bg-indigo-50/80" : "",
                        isMsRow ? "bg-indigo-50/60 hover:bg-indigo-100/60 border-l-[3px] border-l-indigo-400" :
                        hasChildren ? "bg-muted/60 hover:bg-muted/80" : "hover:bg-muted/80",
                        !isMsRow && isBehind ? "border-l-[3px] border-l-red-400" : !isMsRow && task.planStatus === "ahead" && !hasChildren ? "border-l-[3px] border-l-emerald-400" : !isMsRow && !hasChildren ? "border-l-[3px] border-l-transparent" : "",
                        isAdmin ? "cursor-grab active:cursor-grabbing" : "",
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
                <TableRow data-testid="row-add-task" className="bg-slate-25 border-t-2 border-border">
                  <TableCell className="px-2" />
                  <TableCell colSpan={Math.min(activeColumns.length, 3)} className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <Plus className="h-3.5 w-3.5 text-slate-500 shrink-0" />
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

      <Dialog open={milestoneDialogOpen} onOpenChange={setMilestoneDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Milestone</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="e.g. DC Scope - Ground Mount"
              value={milestoneTitle}
              onChange={e => setMilestoneTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !isCreatingMilestone) handleCreateMilestone(); }}
              data-testid="input-milestone-title"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Milestones group related tasks together. Dates and progress are rolled up automatically from subtasks.
            </p>
            {milestoneCreateError && (
              <p className="text-xs text-red-600" data-testid="milestone-create-error">{milestoneCreateError}</p>
            )}
            {milestoneCreateSuccess && (
              <p className="text-xs text-emerald-700" data-testid="milestone-create-success">{milestoneCreateSuccess}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMilestoneDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreateMilestone}
              disabled={isCreatingMilestone}
              data-testid="button-save-milestone">
              {isCreatingMilestone ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Milestone className="h-3 w-3 mr-1" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Group Under Milestone</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Group the {selectedIds.size} selected task{selectedIds.size !== 1 ? "s" : ""} under an existing or new milestone:
            </p>
            <div className="flex items-center gap-2">
              <Input
                placeholder="New milestone name..."
                value={groupNewMilestoneTitle}
                onChange={e => setGroupNewMilestoneTitle(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCreateAndGroup(); }}
                className="h-8 text-xs flex-1"
                data-testid="input-group-new-milestone"
              />
              <Button size="sm" className="h-8 text-xs gap-1 shrink-0" data-testid="button-create-and-group"
                onClick={handleCreateAndGroup} disabled={!groupNewMilestoneTitle.trim() || createAndGroupMutation.isPending}>
                {createAndGroupMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Create & Group
              </Button>
            </div>
            {milestones.length > 0 && (
              <>
                <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                  <div className="flex-1 h-px bg-slate-200" />
                  <span>or choose existing</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
                <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
                  {milestones.map((ms: any) => (
                    <button
                      key={ms.id}
                      className="w-full text-left px-3 py-2.5 rounded-lg border border-border hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors flex items-center gap-2"
                      onClick={() => handleGroupUnderMilestone(ms.rowNumber)}
                      data-testid={`button-group-under-${ms.id}`}
                    >
                      <Milestone className="h-4 w-4 text-indigo-500 shrink-0" />
                      <span className="font-medium text-sm text-foreground">{ms.title}</span>
                      {ms.childCount > 0 && (
                        <span className="ml-auto text-[10px] text-slate-500">{ms.childCount} tasks</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={convertDialogOpen} onOpenChange={(open) => { setConvertDialogOpen(open); if (!open) setChosenMilestoneId(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Convert to Milestone</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Choose which task becomes the <strong>milestone</strong> (parent). The remaining {selectedTasksForConvert.length > 1 ? `${selectedTasksForConvert.length - 1} tasks` : "task"} will become its subtasks.
            </p>
            <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
              {selectedTasksForConvert.map((t: any) => {
                const isChosen = chosenMilestoneId === t.id;
                return (
                  <button
                    key={t.id}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors flex items-center gap-2 ${
                      isChosen
                        ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300"
                        : "border-border hover:border-border hover:bg-muted/50"
                    }`}
                    onClick={() => setChosenMilestoneId(t.id)}
                    data-testid={`button-choose-milestone-${t.id}`}
                  >
                    {isChosen ? (
                      <Milestone className="h-4 w-4 text-indigo-600 shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 text-slate-600 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-medium truncate block ${isChosen ? "text-indigo-700" : "text-foreground"}`}>
                        {t.title || t.taskName || `Task #${t.id}`}
                      </span>
                      {t.taskNumber && <span className="text-[10px] text-slate-500">#{t.taskNumber}</span>}
                    </div>
                    {isChosen && (
                      <Badge className="bg-indigo-100 text-indigo-700 text-[10px] px-1.5 shrink-0">Milestone</Badge>
                    )}
                  </button>
                );
              })}
            </div>
            {chosenMilestoneId != null && (
              <div className="bg-muted rounded-lg px-3 py-2 text-xs text-muted-foreground border border-border">
                <strong>{tasks.find((t: any) => t.id === chosenMilestoneId)?.title || "Selected task"}</strong> will become a milestone.
                The other {selectedTasksForConvert.length - 1} task{selectedTasksForConvert.length - 1 !== 1 ? "s" : ""} will be grouped as subtasks underneath.
                Dates and progress will roll up automatically.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConvertDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleConvertToMilestone}
              disabled={chosenMilestoneId == null || structureMutation.isPending}
              data-testid="button-confirm-convert">
              {isCreatingMilestone ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Milestone className="h-3 w-3 mr-1" />}
              Convert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
