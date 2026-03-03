import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateDashboardQueries, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle, RotateCcw, Save, Trash2, Link, ChevronLeft, ChevronRight, Calendar, GitBranch, Search, ZoomIn, Target, Split, X, AlertCircle } from "lucide-react";
import { format, addDays, differenceInDays, eachDayOfInterval, parseISO, isValid, startOfDay, isBefore, isAfter, differenceInCalendarDays } from "date-fns";

interface ProjectPlanTabProps {
  projectName: string;
}

interface CPMTask {
  id: number;
  taskNo: string;
  name: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  slack: number;
  isCritical: boolean;
  predecessorIds: number[];
  successorIds: number[];
  isMilestone: boolean;
  type: string;
  percentComplete?: number;
}

interface CPMDependency {
  id: number;
  predecessorTaskId: number;
  successorTaskId: number;
  dependencyType: string;
  lagDays: number;
}

interface WorkingPlanResponse {
  scenario: { id: number; projectName: string; name: string };
  tasks: CPMTask[];
  dependencies: CPMDependency[];
  criticalPath: number[];
  projectFinish: number;
  hasCircularDependency: boolean;
  warnings: string[];
  keyDates: {
    pdHandoverDate: string | null;
    constructionStartDate: string | null;
    commissioningDate: string | null;
    omHandoverDate: string | null;
    clientHandoverDate: string | null;
  };
  overrideCounts: {
    taskOverrides: number;
    dependencyOverrides: number;
  };
}

interface ScheduleChangeNotice {
  id: number;
  summary: string;
  oldFinishDate: string | null;
  newFinishDate: string | null;
  changedTasks: string | null;
  userNote: string | null;
  clientNotified: number;
  documentationUpdated: number;
  createdAt: string;
}

type ZoomLevel = "week" | "month" | "quarter";
type FilterType = "all" | "critical" | "late" | "blocked";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function CompactProgress({ actual, expected, size = "sm" }: { actual: number; expected: number | null; size?: "sm" | "md" }) {
  const barHeight = size === "sm" ? "h-1.5" : "h-2";
  const isLate = expected !== null && actual < expected;
  
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <span className={`text-xs font-medium w-8 text-right ${isLate ? "text-amber-600" : ""}`}>
        {actual}%
      </span>
      <div className="flex-1 relative">
        <div className={`w-full bg-muted rounded ${barHeight}`}>
          <div 
            className={`${barHeight} rounded transition-all ${isLate ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${actual}%` }}
          />
        </div>
        {expected !== null && (
          <div 
            className="absolute top-0 w-0.5 h-3 bg-slate-600 -translate-y-0.5"
            style={{ left: `${expected}%` }}
            title={`Expected: ${expected}%`}
          />
        )}
      </div>
    </div>
  );
}

function InlinePctEditor({ taskId, pct, projectName }: { taskId: number; pct: number; projectName: string }) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState(String(pct));
  const queryClient = useQueryClient();

  useEffect(() => { setLocalVal(String(pct)); }, [pct]);

  const pctMutation = useMutation({
    mutationFn: async (newPct: number) => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/planning-tasks/${taskId}`, {
        method: "PATCH",
        credentials: "include",
        headers,
        body: JSON.stringify({ projectName, percentComplete: newPct }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["working-plan", projectName] });
      invalidateDashboardQueries(queryClient);
    },
  });

  const commit = () => {
    const parsed = Math.min(100, Math.max(0, parseInt(localVal) || 0));
    setEditing(false);
    if (parsed !== pct) {
      pctMutation.mutate(parsed);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <input
          className="w-12 h-6 text-xs tabular-nums text-center border border-primary/40 rounded bg-background outline-none focus:ring-1 focus:ring-primary/30"
          type="number"
          min={0}
          max={100}
          value={localVal}
          onChange={(e) => setLocalVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { setEditing(false); setLocalVal(String(pct)); } }}
          autoFocus
          data-testid={`input-pct-inline-${taskId}`}
        />
        <span className="text-[9px] text-muted-foreground">%</span>
      </div>
    );
  }

  return (
    <button
      className="text-xs tabular-nums font-medium hover:bg-muted/60 px-1.5 py-0.5 rounded cursor-pointer transition-colors"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      data-testid={`btn-pct-${taskId}`}
    >
      {pctMutation.isPending ? "..." : `${pct}%`}
    </button>
  );
}

export function ProjectPlanTab({ projectName }: ProjectPlanTabProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("grid");
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<{ startDate?: string; endDate?: string; name?: string }>({});
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [pendingChange, setPendingChange] = useState<{ taskId: number; changes: any } | null>(null);
  const [warningNote, setWarningNote] = useState("");
  const [showAddDependency, setShowAddDependency] = useState(false);
  const [newDep, setNewDep] = useState({ predecessorId: "", successorId: "", type: "FS", lag: 0 });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<CPMTask | null>(null);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [splitView, setSplitView] = useState(true);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("month");
  const [hoveredTaskId, setHoveredTaskId] = useState<number | null>(null);
  const [selectedTask, setSelectedTask] = useState<CPMTask | null>(null);
  const [showTaskDetail, setShowTaskDetail] = useState(false);
  
  const [ganttStart, setGanttStart] = useState<Date | null>(null);
  const [ganttEnd, setGanttEnd] = useState<Date | null>(null);

  const { data: workingPlan, isLoading, error } = useQuery<WorkingPlanResponse>({
    queryKey: ["working-plan", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/working-plan`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch working plan");
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: changeNotices = [] } = useQuery<ScheduleChangeNotice[]>({
    queryKey: ["change-notices", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/change-notices`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch change notices");
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: qualityPlanLinks = [] } = useQuery<any[]>({
    queryKey: ["/api/quality/project", projectName, "plan-links"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `/api/quality/project/${encodeURIComponent(projectName)}/plan-links`);
        return res.json();
      } catch { return []; }
    },
    enabled: !!projectName,
  });

  const { data: qualityChecklistData } = useQuery<any>({
    queryKey: ["/api/quality/project", projectName, "checklist"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `/api/quality/project/${encodeURIComponent(projectName)}/checklist`);
        return res.json();
      } catch { return null; }
    },
    enabled: !!projectName,
  });

  const qualityWarningTaskIds = useMemo(() => {
    if (!qualityPlanLinks.length || !qualityChecklistData?.itemInstances) return new Set<number>();
    const itemInstances = qualityChecklistData.itemInstances as any[];
    const ids = new Set<number>();
    qualityPlanLinks.forEach((link: any) => {
      if (link.itemInstanceId) {
        const instance = itemInstances.find((ii: any) => ii.id === link.itemInstanceId);
        if (instance && !instance.approved) {
          ids.add(link.planItemId);
        }
      }
    });
    return ids;
  }, [qualityPlanLinks, qualityChecklistData]);

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, changes }: { taskId: number; changes: any }) => {
      const res = await fetch(`/api/working-plan/tasks/${taskId}`, {
        credentials: "include",
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, ...changes }),
      });
      if (!res.ok) throw new Error("Failed to update task");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["working-plan", projectName] });
      invalidateDashboardQueries(queryClient);
      setEditingTaskId(null);
      setEditValues({});
    },
  });

  const resetPlanMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/working-plan/reset`, {
        credentials: "include",
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to reset plan");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["working-plan", projectName] });
      invalidateDashboardQueries(queryClient);
    },
  });

  const createDependencyMutation = useMutation({
    mutationFn: async (dep: { predecessorTaskId: number; successorTaskId: number; dependencyType: string; lagDays: number }) => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/dependencies`, {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dep),
      });
      if (!res.ok) throw new Error("Failed to create dependency");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["working-plan", projectName] });
      invalidateDashboardQueries(queryClient);
      setShowAddDependency(false);
      setNewDep({ predecessorId: "", successorId: "", type: "FS", lag: 0 });
    },
  });

  const deleteDependencyMutation = useMutation({
    mutationFn: async (depId: number) => {
      const res = await fetch(`/api/dependencies/${depId}`, { credentials: "include",
        method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete dependency");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["working-plan", projectName] });
      invalidateDashboardQueries(queryClient);
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async ({ taskId, isNewTask }: { taskId: number; isNewTask: boolean }) => {
      const res = await fetch(`/api/working-plan/tasks/${taskId}`, {
        credentials: "include",
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, isNewTask }),
      });
      if (!res.ok) throw new Error("Failed to delete task");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["working-plan", projectName] });
      invalidateDashboardQueries(queryClient);
      setShowDeleteConfirm(false);
      setTaskToDelete(null);
      setShowTaskDetail(false);
    },
  });

  const createChangeNoticeMutation = useMutation({
    mutationFn: async (notice: { summary: string; oldFinishDate?: string; newFinishDate?: string; changedTasks?: string; userNote?: string }) => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/change-notices`, {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notice),
      });
      if (!res.ok) throw new Error("Failed to create change notice");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["change-notices", projectName] });
      invalidateDashboardQueries(queryClient);
    },
  });

  const tasks = workingPlan?.tasks || [];
  const dependencies = workingPlan?.dependencies || [];
  const criticalPath = workingPlan?.criticalPath || [];
  const hasOverrides = (workingPlan?.overrideCounts.taskOverrides || 0) > 0;

  const projectStats = useMemo(() => {
    if (tasks.length === 0) return null;
    
    const today = startOfDay(new Date());
    let minStart: Date | null = null;
    let maxEnd: Date | null = null;
    let totalActualPercent = 0;
    let totalExpectedPercent = 0;
    let countWithDates = 0;
    let lateTasks = 0;
    
    tasks.forEach(task => {
      if (task.startDate) {
        const start = parseISO(task.startDate);
        if (isValid(start) && (!minStart || isBefore(start, minStart))) {
          minStart = start;
        }
      }
      if (task.endDate) {
        const end = parseISO(task.endDate);
        if (isValid(end) && (!maxEnd || isAfter(end, maxEnd))) {
          maxEnd = end;
        }
      }
      
      const actualPct = Math.round((task.percentComplete || 0) * 100);
      totalActualPercent += actualPct;
      
      if (task.startDate && task.endDate) {
        const start = parseISO(task.startDate);
        const end = parseISO(task.endDate);
        if (isValid(start) && isValid(end)) {
          countWithDates++;
          const totalDuration = differenceInCalendarDays(end, start);
          const elapsed = differenceInCalendarDays(today, start);
          const expectedPct = totalDuration > 0 ? clamp(elapsed / totalDuration, 0, 1) * 100 : 100;
          totalExpectedPercent += expectedPct;
          
          if (actualPct < expectedPct && isAfter(today, start)) {
            lateTasks++;
          }
        }
      }
    });
    
    const durationDays = minStart && maxEnd ? differenceInCalendarDays(maxEnd, minStart) + 1 : 0;
    const overallActual = tasks.length > 0 ? Math.round(totalActualPercent / tasks.length) : 0;
    const overallExpected = countWithDates > 0 ? Math.round(totalExpectedPercent / countWithDates) : null;
    
    return {
      projectStart: minStart,
      projectEnd: maxEnd,
      durationDays,
      totalTasks: tasks.length,
      criticalTasks: criticalPath.length,
      overallActual,
      overallExpected,
      lateTasks,
    };
  }, [tasks, criticalPath]);

  // Initialize gantt date range when project stats change
  const projectStartTime = projectStats?.projectStart ? projectStats.projectStart.getTime() : undefined;
  const projectEndTime = projectStats?.projectEnd ? projectStats.projectEnd.getTime() : undefined;
  
  useEffect(() => {
    if (projectStats?.projectStart && projectStats?.projectEnd) {
      const padding = 14;
      setGanttStart(addDays(projectStats.projectStart, -padding));
      setGanttEnd(addDays(projectStats.projectEnd, padding));
    } else if (tasks.length > 0) {
      const today = startOfDay(new Date());
      setGanttStart(addDays(today, -30));
      setGanttEnd(addDays(today, 60));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectStartTime, projectEndTime, tasks.length]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(t => 
        t.name?.toLowerCase().includes(query) || 
        t.taskNo?.toLowerCase().includes(query)
      );
    }
    
    const today = startOfDay(new Date());
    
    if (filter === "critical") {
      result = result.filter(t => t.isCritical);
    } else if (filter === "late") {
      result = result.filter(t => {
        if (!t.endDate || !t.startDate) return false;
        const end = parseISO(t.endDate);
        const start = parseISO(t.startDate);
        const actualPct = Math.round((t.percentComplete || 0) * 100);
        const totalDuration = differenceInCalendarDays(end, start);
        const elapsed = differenceInCalendarDays(today, start);
        const expectedPct = totalDuration > 0 ? clamp(elapsed / totalDuration, 0, 1) * 100 : 100;
        return actualPct < expectedPct && isAfter(today, start) && actualPct < 100;
      });
    } else if (filter === "blocked") {
      result = result.filter(t => t.predecessorIds.length > 0 && (t.percentComplete || 0) === 0);
    }
    
    return result;
  }, [tasks, searchQuery, filter]);

  const zoomConfig = useMemo(() => {
    switch (zoomLevel) {
      case "week": return { daysPerUnit: 7, unitLabel: "Week" };
      case "month": return { daysPerUnit: 30, unitLabel: "Month" };
      case "quarter": return { daysPerUnit: 90, unitLabel: "Quarter" };
    }
  }, [zoomLevel]);

  const ganttDays = useMemo(() => {
    if (!ganttStart || !ganttEnd) return [];
    return eachDayOfInterval({ start: ganttStart, end: ganttEnd });
  }, [ganttStart, ganttEnd]);

  const getExpectedPercent = useCallback((task: CPMTask): number | null => {
    if (!task.startDate || !task.endDate) return null;
    const start = parseISO(task.startDate);
    const end = parseISO(task.endDate);
    if (!isValid(start) || !isValid(end)) return null;
    
    const today = startOfDay(new Date());
    const totalDuration = differenceInCalendarDays(end, start);
    const elapsed = differenceInCalendarDays(today, start);
    
    if (totalDuration <= 0) return 100;
    return Math.round(clamp(elapsed / totalDuration, 0, 1) * 100);
  }, []);

  const checkScheduleImpact = useCallback((taskId: number, changes: any) => {
    if (!workingPlan) return false;
    const task = workingPlan.tasks.find(t => t.id === taskId);
    if (!task || !task.isCritical) return false;
    const commissioningDate = workingPlan.keyDates.commissioningDate;
    const clientHandoverDate = workingPlan.keyDates.clientHandoverDate;
    if (!commissioningDate && !clientHandoverDate) return false;
    const newEndDate = changes.endDate || task.endDate;
    const oldEndDate = task.endDate;
    return newEndDate > oldEndDate;
  }, [workingPlan]);

  const handleSaveEdit = useCallback((taskId: number) => {
    if (!editValues.startDate && !editValues.endDate && !editValues.name) {
      setEditingTaskId(null);
      return;
    }
    if (checkScheduleImpact(taskId, editValues)) {
      setPendingChange({ taskId, changes: editValues });
      setShowWarningModal(true);
    } else {
      updateTaskMutation.mutate({ taskId, changes: editValues });
    }
  }, [editValues, checkScheduleImpact, updateTaskMutation]);

  const confirmWarningChange = useCallback(() => {
    if (!pendingChange || !workingPlan) return;
    const task = workingPlan.tasks.find(t => t.id === pendingChange.taskId);
    createChangeNoticeMutation.mutate({
      summary: `Schedule change: ${task?.name || "Task"} end date modified`,
      oldFinishDate: task?.endDate,
      newFinishDate: pendingChange.changes.endDate,
      changedTasks: task?.name,
      userNote: warningNote,
    });
    updateTaskMutation.mutate(pendingChange);
    setShowWarningModal(false);
    setPendingChange(null);
    setWarningNote("");
  }, [pendingChange, workingPlan, warningNote, createChangeNoticeMutation, updateTaskMutation]);

  const fitToProject = useCallback(() => {
    if (projectStats?.projectStart && projectStats?.projectEnd) {
      setGanttStart(addDays(projectStats.projectStart, -14));
      setGanttEnd(addDays(projectStats.projectEnd, 14));
    }
  }, [projectStats]);

  const jumpToToday = useCallback(() => {
    const today = startOfDay(new Date());
    const currentRange = ganttStart && ganttEnd ? differenceInDays(ganttEnd, ganttStart) : 60;
    setGanttStart(addDays(today, -Math.floor(currentRange / 2)));
    setGanttEnd(addDays(today, Math.ceil(currentRange / 2)));
  }, [ganttStart, ganttEnd]);

  const handleTaskClick = useCallback((task: CPMTask) => {
    setSelectedTask(task);
    setShowTaskDetail(true);
  }, []);

  const getTaskBarStyle = useCallback((task: CPMTask) => {
    if (!task.startDate || !task.endDate || !ganttStart || !ganttEnd) return { display: "none" as const };
    
    const start = parseISO(task.startDate);
    const end = parseISO(task.endDate);
    
    if (!isValid(start) || !isValid(end)) return { display: "none" as const };
    if (isAfter(start, ganttEnd) || isBefore(end, ganttStart)) return { display: "none" as const };
    
    const totalDays = differenceInDays(ganttEnd, ganttStart) + 1;
    const startOffset = Math.max(0, differenceInDays(start, ganttStart));
    const endOffset = Math.min(totalDays - 1, differenceInDays(end, ganttStart));
    const width = endOffset - startOffset + 1;
    
    return {
      left: `${(startOffset / totalDays) * 100}%`,
      width: `${(width / totalDays) * 100}%`,
    };
  }, [ganttStart, ganttEnd]);

  const getTodayPosition = useCallback(() => {
    if (!ganttStart || !ganttEnd) return null;
    const today = startOfDay(new Date());
    if (isBefore(today, ganttStart) || isAfter(today, ganttEnd)) return null;
    const totalDays = differenceInDays(ganttEnd, ganttStart) + 1;
    const offset = differenceInDays(today, ganttStart);
    return `${(offset / totalDays) * 100}%`;
  }, [ganttStart, ganttEnd]);

  if (isLoading) {
    return (
      <Card data-testid="card-loading">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="spinner-loading" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="card-error">
        <CardContent className="py-12">
          <p className="text-center text-destructive" data-testid="text-error">Failed to load project plan data</p>
        </CardContent>
      </Card>
    );
  }

  const todayPosition = getTodayPosition();

  const renderTaskGrid = (showInSplit = false) => (
    <div className={showInSplit ? "flex-1 overflow-auto" : ""}>
      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8"
            data-testid="input-search-tasks"
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
          <SelectTrigger className="w-[140px] h-8" data-testid="select-filter">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tasks</SelectItem>
            <SelectItem value="critical">Critical Only</SelectItem>
            <SelectItem value="late">Late Tasks</SelectItem>
            <SelectItem value="blocked">Blocked</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch
            id="split-view"
            checked={splitView}
            onCheckedChange={setSplitView}
            data-testid="switch-split-view"
          />
          <Label htmlFor="split-view" className="text-xs cursor-pointer">
            <Split className="h-4 w-4" />
          </Label>
        </div>
      </div>

      <div className="rounded-md border overflow-auto max-h-[400px]">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-14 sticky left-0 bg-background z-20">No.</TableHead>
              <TableHead className="min-w-[200px] sticky left-14 bg-background z-20">Task Name</TableHead>
              <TableHead className="w-24">Start</TableHead>
              <TableHead className="w-24">End</TableHead>
              <TableHead className="w-16">Days</TableHead>
              <TableHead className="w-28">% Complete</TableHead>
              <TableHead className="w-28">Expected %</TableHead>
              <TableHead className="w-16">Slack</TableHead>
              <TableHead className="w-20">Status</TableHead>
              <TableHead className="w-20">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  {searchQuery || filter !== "all" ? "No tasks match your filters" : "No project plan data available"}
                </TableCell>
              </TableRow>
            ) : (
              filteredTasks.map((task, idx) => {
                const isEditing = editingTaskId === task.id;
                const isCritical = task.isCritical;
                const isHovered = hoveredTaskId === task.id;
                const actualPct = Math.round((task.percentComplete || 0) * 100);
                const expectedPct = getExpectedPercent(task);
                const isLate = expectedPct !== null && actualPct < expectedPct && actualPct < 100;
                const hasQualityWarning = actualPct >= 100 && qualityWarningTaskIds.has(task.id);
                
                return (
                  <TableRow 
                    key={task.id} 
                    className={`
                      ${hasQualityWarning ? "!bg-red-100 dark:!bg-red-950/30 ring-1 ring-inset ring-red-500/40" : ""}
                      ${isCritical && !hasQualityWarning ? "bg-red-50/50 dark:bg-red-950/10" : ""} 
                      ${isHovered && !hasQualityWarning ? "bg-emerald-50 dark:bg-emerald-950/20" : ""}
                      ${!hasQualityWarning && idx % 2 === 1 ? "bg-muted/20" : ""}
                      hover:bg-muted/40 cursor-pointer transition-colors
                    `}
                    onMouseEnter={() => setHoveredTaskId(task.id)}
                    onMouseLeave={() => setHoveredTaskId(null)}
                    onClick={() => !isEditing && handleTaskClick(task)}
                    data-testid={`row-task-${task.id}`}
                  >
                    <TableCell className="font-mono text-xs sticky left-0 bg-inherit" data-testid={`text-taskno-${task.id}`}>
                      {task.taskNo || "-"}
                    </TableCell>
                    <TableCell className="sticky left-14 bg-inherit">
                      {isEditing ? (
                        <Input
                          value={editValues.name ?? task.name}
                          onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                          className="h-7 text-sm"
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`input-name-${task.id}`}
                        />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          {isCritical && (
                            <Badge variant="destructive" className="text-[10px] px-1 py-0" data-testid={`badge-crit-${task.id}`}>
                              CRIT
                            </Badge>
                          )}
                          {hasQualityWarning && (
                            <Badge variant="destructive" className="text-[10px] px-1 py-0 bg-red-600" data-testid={`badge-qwarn-${task.id}`}>
                              QC
                            </Badge>
                          )}
                          {isLate && (
                            <AlertCircle className="h-3.5 w-3.5 text-amber-500" data-testid={`icon-late-${task.id}`} />
                          )}
                          <span className={`text-sm ${isCritical ? "font-medium" : ""} ${hasQualityWarning ? "text-red-600 dark:text-red-400 font-medium" : ""}`} data-testid={`text-name-${task.id}`}>
                            {task.name || "-"}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {isEditing ? (
                        <Input
                          type="date"
                          value={editValues.startDate ?? task.startDate}
                          onChange={(e) => setEditValues({ ...editValues, startDate: e.target.value })}
                          className="h-7 text-xs"
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`input-start-${task.id}`}
                        />
                      ) : (
                        <span data-testid={`text-start-${task.id}`}>
                          {task.startDate ? format(parseISO(task.startDate), "dd MMM yy") : "-"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {isEditing ? (
                        <Input
                          type="date"
                          value={editValues.endDate ?? task.endDate}
                          onChange={(e) => setEditValues({ ...editValues, endDate: e.target.value })}
                          className="h-7 text-xs"
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`input-end-${task.id}`}
                        />
                      ) : (
                        <span data-testid={`text-end-${task.id}`}>
                          {task.endDate ? format(parseISO(task.endDate), "dd MMM yy") : "-"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs" data-testid={`text-duration-${task.id}`}>
                      {task.durationDays}d
                    </TableCell>
                    <TableCell data-testid={`text-actual-pct-${task.id}`}>
                      <InlinePctEditor taskId={task.id} pct={actualPct} projectName={projectName} />
                    </TableCell>
                    <TableCell data-testid={`text-expected-pct-${task.id}`}>
                      {expectedPct !== null ? (
                        <span className="text-xs text-muted-foreground">{expectedPct}%</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs ${task.slack === 0 ? "text-destructive font-medium" : "text-muted-foreground"}`} data-testid={`text-slack-${task.id}`}>
                        {task.slack}d
                      </span>
                    </TableCell>
                    <TableCell>
                      {isCritical ? (
                        <Badge variant="destructive" className="text-[10px]" data-testid={`badge-critical-${task.id}`}>Critical</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]" data-testid={`badge-normal-${task.id}`}>Normal</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {isEditing ? (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={(e) => { e.stopPropagation(); handleSaveEdit(task.id); }}
                            disabled={updateTaskMutation.isPending}
                            data-testid={`button-save-${task.id}`}
                          >
                            <Save className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={(e) => { e.stopPropagation(); setEditingTaskId(null); setEditValues({}); }}
                            data-testid={`button-cancel-${task.id}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTaskId(task.id);
                              setEditValues({
                                name: task.name,
                                startDate: task.startDate,
                                endDate: task.endDate,
                              });
                            }}
                            data-testid={`button-edit-${task.id}`}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTaskToDelete(task);
                              setShowDeleteConfirm(true);
                            }}
                            data-testid={`button-delete-${task.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  const renderGanttChart = (compact = false) => (
    <div className={compact ? "flex-1" : ""}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fitToProject} data-testid="button-fit-project">
            <ZoomIn className="h-4 w-4 mr-1" />
            Fit to Project
          </Button>
          <Button variant="outline" size="sm" onClick={jumpToToday} data-testid="button-jump-today">
            <Target className="h-4 w-4 mr-1" />
            Today
          </Button>
          <div className="flex items-center gap-1 ml-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (ganttStart && ganttEnd) {
                  const shift = Math.floor(differenceInDays(ganttEnd, ganttStart) / 4);
                  setGanttStart(addDays(ganttStart, -shift));
                  setGanttEnd(addDays(ganttEnd, -shift));
                }
              }}
              data-testid="button-gantt-prev"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (ganttStart && ganttEnd) {
                  const shift = Math.floor(differenceInDays(ganttEnd, ganttStart) / 4);
                  setGanttStart(addDays(ganttStart, shift));
                  setGanttEnd(addDays(ganttEnd, shift));
                }
              }}
              data-testid="button-gantt-next"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={zoomLevel} onValueChange={(v) => setZoomLevel(v as ZoomLevel)}>
            <SelectTrigger className="w-[100px] h-8" data-testid="select-zoom">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="quarter">Quarter</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-3 text-xs" data-testid="gantt-legend">
            <div className="flex items-center gap-1">
              <div className="w-4 h-2.5 bg-destructive rounded border-2 border-destructive" />
              <span data-testid="text-legend-critical">Critical</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-2.5 bg-emerald-500 rounded" />
              <span data-testid="text-legend-normal">Normal</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-0.5 h-4 bg-blue-500" />
              <span>Today</span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-md border overflow-hidden">
        <div className="flex border-b bg-muted/50">
          <div className="w-40 flex-shrink-0 p-1.5 border-r text-xs font-medium">Task</div>
          <div className="flex-1 flex relative">
            {ganttStart && ganttEnd && (
              <>
                <span className="absolute left-1 top-0.5 text-[10px] text-muted-foreground">
                  {format(ganttStart, "dd MMM yy")}
                </span>
                <span className="absolute right-1 top-0.5 text-[10px] text-muted-foreground">
                  {format(ganttEnd, "dd MMM yy")}
                </span>
              </>
            )}
            <div className="flex-1 h-6" />
          </div>
        </div>

        <div className={`overflow-y-auto ${compact ? "max-h-[250px]" : "max-h-[500px]"}`} data-testid="gantt-task-list">
          {filteredTasks.map((task, idx) => {
            const isHovered = hoveredTaskId === task.id;
            const actualPct = Math.round((task.percentComplete || 0) * 100);
            const expectedPct = getExpectedPercent(task);
            const barStyle = getTaskBarStyle(task);
            const ganttQualityWarning = actualPct >= 100 && qualityWarningTaskIds.has(task.id);
            
            return (
              <div 
                key={task.id} 
                className={`flex border-b transition-colors cursor-pointer
                  ${ganttQualityWarning ? "!bg-red-100 dark:!bg-red-950/30 ring-1 ring-inset ring-red-500/40" : ""}
                  ${task.isCritical && !ganttQualityWarning ? "bg-red-50/30 dark:bg-red-950/10" : ""}
                  ${isHovered && !ganttQualityWarning ? "bg-emerald-50 dark:bg-emerald-950/20" : ""}
                  ${!ganttQualityWarning && idx % 2 === 1 && !isHovered ? "bg-muted/10" : ""}
                  hover:bg-muted/30
                `}
                onMouseEnter={() => setHoveredTaskId(task.id)}
                onMouseLeave={() => setHoveredTaskId(null)}
                onClick={() => handleTaskClick(task)}
                data-testid={`gantt-row-${task.id}`}
              >
                <div className={`w-40 flex-shrink-0 p-1.5 border-r text-xs truncate flex items-center gap-1 ${ganttQualityWarning ? "text-red-600 dark:text-red-400 font-medium" : ""}`} data-testid={`gantt-label-${task.id}`}>
                  {task.isCritical && (
                    <span className="text-destructive font-bold">!</span>
                  )}
                  {ganttQualityWarning && (
                    <span className="text-red-600 font-bold text-[10px]">QC</span>
                  )}
                  <span className="truncate">{task.name || task.taskNo || "-"}</span>
                </div>
                <div className="flex-1 relative h-7">
                  {todayPosition && (
                    <div 
                      className="absolute top-0 bottom-0 w-0.5 bg-blue-500 z-10"
                      style={{ left: todayPosition }}
                      data-testid="gantt-today-line"
                    />
                  )}
                  {barStyle.display !== "none" && (
                    <div
                      className={`absolute top-1 h-5 rounded-sm overflow-hidden
                        ${task.isCritical 
                          ? "bg-red-200 dark:bg-red-900/50 border-2 border-destructive" 
                          : "bg-emerald-200 dark:bg-emerald-900/30"
                        }`}
                      style={barStyle}
                      title={`${task.name}: ${task.startDate} - ${task.endDate} (${actualPct}% complete)`}
                      data-testid={`gantt-bar-${task.id}`}
                    >
                      <div 
                        className={`h-full transition-all ${task.isCritical ? "bg-destructive" : "bg-emerald-500"}`}
                        style={{ width: `${actualPct}%` }}
                      />
                      {expectedPct !== null && expectedPct > 0 && (
                        <div 
                          className="absolute top-0 bottom-0 w-0.5 bg-slate-700 dark:bg-slate-300"
                          style={{ left: `${expectedPct}%` }}
                          title={`Expected: ${expectedPct}%`}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {projectStats && (
        <Card className="bg-gradient-to-r from-emerald-50 to-white dark:from-emerald-950/20 dark:to-background" data-testid="card-summary">
          <CardContent className="py-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Start:</span>
                <span className="font-medium" data-testid="text-project-start">
                  {projectStats.projectStart ? format(projectStats.projectStart, "dd MMM yy") : "—"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Finish:</span>
                <span className="font-medium" data-testid="text-project-end">
                  {projectStats.projectEnd ? format(projectStats.projectEnd, "dd MMM yy") : "—"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Duration:</span>
                <span className="font-medium" data-testid="text-project-duration">{projectStats.durationDays} days</span>
              </div>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Tasks:</span>
                <span className="font-medium" data-testid="text-total-tasks">{projectStats.totalTasks}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Critical:</span>
                <span className="font-medium text-destructive" data-testid="text-critical-count">{projectStats.criticalTasks}</span>
              </div>
              {projectStats.lateTasks > 0 && (
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  <span className="text-amber-600 font-medium" data-testid="text-late-count">{projectStats.lateTasks} late</span>
                </div>
              )}
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Overall:</span>
                <div className="flex items-center gap-2">
                  <Progress value={projectStats.overallActual} className="w-20 h-2" />
                  <span className="font-medium" data-testid="text-overall-actual">{projectStats.overallActual}%</span>
                  {projectStats.overallExpected !== null && (
                    <span className="text-muted-foreground text-xs" data-testid="text-overall-expected">
                      (exp: {projectStats.overallExpected}%)
                    </span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2" data-testid="title-project-plan">
                Project Plan
                {hasOverrides && (
                  <Badge variant="secondary" className="ml-2" data-testid="badge-modified">Modified</Badge>
                )}
              </CardTitle>
              <CardDescription>
                {workingPlan?.hasCircularDependency && (
                  <span className="text-destructive" data-testid="text-circular-warning">⚠ Circular dependency detected</span>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddDependency(true)}
                data-testid="button-add-dependency"
              >
                <Link className="h-4 w-4 mr-1" />
                Add Link
              </Button>
              {hasOverrides && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => resetPlanMutation.mutate()}
                  disabled={resetPlanMutation.isPending}
                  data-testid="button-reset-plan"
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="grid" data-testid="tab-task-grid">
                <Calendar className="h-4 w-4 mr-1" />
                Task Grid
              </TabsTrigger>
              <TabsTrigger value="gantt" data-testid="tab-gantt">
                <GitBranch className="h-4 w-4 mr-1" />
                Gantt Chart
              </TabsTrigger>
              <TabsTrigger value="deps" data-testid="tab-dependencies">
                <Link className="h-4 w-4 mr-1" />
                Dependencies ({dependencies.length})
              </TabsTrigger>
              <TabsTrigger value="changes" data-testid="tab-changes">
                <AlertTriangle className="h-4 w-4 mr-1" />
                Changes ({changeNotices.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="grid" className="mt-4">
              {splitView ? (
                <div className="flex flex-col gap-4">
                  {renderTaskGrid(true)}
                  <div className="border-t pt-4">
                    {renderGanttChart(true)}
                  </div>
                </div>
              ) : (
                renderTaskGrid()
              )}
            </TabsContent>

            <TabsContent value="gantt" className="mt-4">
              {renderGanttChart()}
            </TabsContent>

            <TabsContent value="deps" className="mt-4">
              {dependencies.length === 0 ? (
                <p className="text-center text-muted-foreground py-8" data-testid="text-no-dependencies">
                  No dependencies defined. Use "Add Link" to create task relationships.
                </p>
              ) : (
                <div className="rounded-md border overflow-auto max-h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Predecessor</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Successor</TableHead>
                        <TableHead className="w-20">Lag</TableHead>
                        <TableHead className="w-16">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dependencies.map((dep) => {
                        const predTask = tasks.find(t => t.id === dep.predecessorTaskId);
                        const succTask = tasks.find(t => t.id === dep.successorTaskId);
                        const typeLabels: Record<string, string> = {
                          FS: "Finish→Start",
                          SS: "Start→Start",
                          FF: "Finish→Finish",
                          SF: "Start→Finish",
                        };
                        
                        return (
                          <TableRow key={dep.id} data-testid={`row-dependency-${dep.id}`}>
                            <TableCell data-testid={`text-predecessor-${dep.id}`}>
                              {predTask?.taskNo} - {predTask?.name || "Unknown"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" data-testid={`badge-dep-type-${dep.id}`}>{typeLabels[dep.dependencyType] || dep.dependencyType}</Badge>
                            </TableCell>
                            <TableCell data-testid={`text-successor-${dep.id}`}>
                              {succTask?.taskNo} - {succTask?.name || "Unknown"}
                            </TableCell>
                            <TableCell data-testid={`text-lag-${dep.id}`}>{dep.lagDays}d</TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deleteDependencyMutation.mutate(dep.id)}
                                disabled={deleteDependencyMutation.isPending}
                                data-testid={`button-delete-dependency-${dep.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="changes" className="mt-4">
              {changeNotices.length === 0 ? (
                <p className="text-center text-muted-foreground py-8" data-testid="text-no-changes">
                  No schedule changes recorded
                </p>
              ) : (
                <div className="space-y-3">
                  {changeNotices.map((notice) => (
                    <Card key={notice.id} data-testid={`card-change-notice-${notice.id}`}>
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium" data-testid={`text-notice-summary-${notice.id}`}>{notice.summary}</p>
                            {notice.oldFinishDate && notice.newFinishDate && (
                              <p className="text-sm text-muted-foreground" data-testid={`text-date-change-${notice.id}`}>
                                Date change: {notice.oldFinishDate} → {notice.newFinishDate}
                              </p>
                            )}
                            {notice.userNote && (
                              <p className="text-sm mt-1" data-testid={`text-user-note-${notice.id}`}>{notice.userNote}</p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Badge variant={notice.clientNotified ? "default" : "outline"} data-testid={`badge-notification-${notice.id}`}>
                              {notice.clientNotified ? "Client Notified" : "Pending Notification"}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2" data-testid={`text-notice-date-${notice.id}`}>
                          {format(parseISO(notice.createdAt), "dd MMM yyyy HH:mm")}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {workingPlan?.warnings && workingPlan.warnings.length > 0 && (
        <Card className="border-yellow-500">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              Warnings
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="text-sm space-y-1" data-testid="list-warnings">
              {workingPlan.warnings.map((w, i) => (
                <li key={i} className="text-muted-foreground" data-testid={`text-warning-${i}`}>{w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Sheet open={showTaskDetail} onOpenChange={setShowTaskDetail}>
        <SheetContent className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {selectedTask?.isCritical && (
                <Badge variant="destructive" className="text-xs">CRITICAL</Badge>
              )}
              {selectedTask?.name || "Task Details"}
            </SheetTitle>
            <SheetDescription>
              Task #{selectedTask?.taskNo}
            </SheetDescription>
          </SheetHeader>
          {selectedTask && (
            <div className="mt-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground">Start Date</label>
                  <p className="font-medium">
                    {selectedTask.startDate ? format(parseISO(selectedTask.startDate), "dd MMM yyyy") : "—"}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">End Date</label>
                  <p className="font-medium">
                    {selectedTask.endDate ? format(parseISO(selectedTask.endDate), "dd MMM yyyy") : "—"}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Duration</label>
                  <p className="font-medium">{selectedTask.durationDays} days</p>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Slack</label>
                  <p className={`font-medium ${selectedTask.slack === 0 ? "text-destructive" : ""}`}>
                    {selectedTask.slack} days
                  </p>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground">Progress</label>
                <div className="mt-2">
                  <CompactProgress 
                    actual={Math.round((selectedTask.percentComplete || 0) * 100)} 
                    expected={getExpectedPercent(selectedTask)}
                    size="md"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Actual: {Math.round((selectedTask.percentComplete || 0) * 100)}%</span>
                    <span>Expected: {getExpectedPercent(selectedTask) ?? "—"}%</span>
                  </div>
                </div>
              </div>

              {(selectedTask.predecessorIds.length > 0 || selectedTask.successorIds.length > 0) && (
                <div>
                  <label className="text-xs text-muted-foreground">Dependencies</label>
                  <div className="mt-2 space-y-2">
                    {selectedTask.predecessorIds.length > 0 && (
                      <div>
                        <span className="text-xs font-medium">Predecessors:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selectedTask.predecessorIds.map(id => {
                            const t = tasks.find(task => task.id === id);
                            return (
                              <Badge key={id} variant="outline" className="text-xs">
                                {t?.taskNo || id}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {selectedTask.successorIds.length > 0 && (
                      <div>
                        <span className="text-xs font-medium">Successors:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selectedTask.successorIds.map(id => {
                            const t = tasks.find(task => task.id === id);
                            return (
                              <Badge key={id} variant="outline" className="text-xs">
                                {t?.taskNo || id}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-4 border-t flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingTaskId(selectedTask.id);
                    setEditValues({
                      name: selectedTask.name,
                      startDate: selectedTask.startDate,
                      endDate: selectedTask.endDate,
                    });
                    setShowTaskDetail(false);
                    setActiveTab("grid");
                  }}
                  data-testid="button-edit-from-detail"
                >
                  Edit Task
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setTaskToDelete(selectedTask);
                    setShowDeleteConfirm(true);
                  }}
                  data-testid="button-delete-from-detail"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={showWarningModal} onOpenChange={setShowWarningModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Schedule Change Warning
            </DialogTitle>
            <DialogDescription>
              This change affects a task on the critical path and may impact project delivery dates.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm">
              Changing this task may affect:
            </p>
            <ul className="text-sm list-disc pl-5 space-y-1" data-testid="list-affected-dates">
              {workingPlan?.keyDates.commissioningDate && (
                <li data-testid="text-commissioning-date">Commissioning Date: {workingPlan.keyDates.commissioningDate}</li>
              )}
              {workingPlan?.keyDates.clientHandoverDate && (
                <li data-testid="text-client-handover-date">Client Handover Date: {workingPlan.keyDates.clientHandoverDate}</li>
              )}
            </ul>
            <div>
              <label className="text-sm font-medium">Add a note (optional):</label>
              <Textarea
                value={warningNote}
                onChange={(e) => setWarningNote(e.target.value)}
                placeholder="Reason for change, mitigation actions, etc."
                className="mt-2"
                data-testid="input-warning-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWarningModal(false)} data-testid="button-warning-cancel">
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmWarningChange} data-testid="button-warning-confirm">
              Confirm Change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Delete Task
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this task? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {taskToDelete && (
            <div className="py-2">
              <p className="text-sm font-medium">{taskToDelete.taskNo} — {taskToDelete.name}</p>
              {taskToDelete.isCritical && (
                <Badge variant="destructive" className="mt-2 text-xs">This task is on the critical path</Badge>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDeleteConfirm(false); setTaskToDelete(null); }} data-testid="button-delete-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (taskToDelete) {
                  deleteTaskMutation.mutate({ taskId: taskToDelete.id, isNewTask: taskToDelete.id < 0 });
                }
              }}
              disabled={deleteTaskMutation.isPending}
              data-testid="button-delete-confirm"
            >
              {deleteTaskMutation.isPending ? "Deleting..." : "Delete Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddDependency} onOpenChange={setShowAddDependency}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Task Dependency</DialogTitle>
            <DialogDescription>
              Create a link between two tasks
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Predecessor Task</label>
              <select
                className="w-full mt-1 p-2 border rounded"
                value={newDep.predecessorId}
                onChange={(e) => setNewDep({ ...newDep, predecessorId: e.target.value })}
                data-testid="select-predecessor"
              >
                <option value="">Select task...</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.taskNo} - {t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Successor Task</label>
              <select
                className="w-full mt-1 p-2 border rounded"
                value={newDep.successorId}
                onChange={(e) => setNewDep({ ...newDep, successorId: e.target.value })}
                data-testid="select-successor"
              >
                <option value="">Select task...</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.taskNo} - {t.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Type</label>
                <select
                  className="w-full mt-1 p-2 border rounded"
                  value={newDep.type}
                  onChange={(e) => setNewDep({ ...newDep, type: e.target.value })}
                  data-testid="select-dep-type"
                >
                  <option value="FS">Finish-to-Start</option>
                  <option value="SS">Start-to-Start</option>
                  <option value="FF">Finish-to-Finish</option>
                  <option value="SF">Start-to-Finish</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Lag (days)</label>
                <Input
                  type="number"
                  value={newDep.lag}
                  onChange={(e) => setNewDep({ ...newDep, lag: parseInt(e.target.value) || 0 })}
                  className="mt-1"
                  data-testid="input-dep-lag"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDependency(false)} data-testid="button-dep-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (newDep.predecessorId && newDep.successorId) {
                  createDependencyMutation.mutate({
                    predecessorTaskId: parseInt(newDep.predecessorId),
                    successorTaskId: parseInt(newDep.successorId),
                    dependencyType: newDep.type,
                    lagDays: newDep.lag,
                  });
                }
              }}
              disabled={!newDep.predecessorId || !newDep.successorId || createDependencyMutation.isPending}
              data-testid="button-dep-create"
            >
              Create Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
