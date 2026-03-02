import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, Search, Trash2, ChevronDown, ChevronRight,
  CheckCircle2, Clock, Circle, Ban, Loader2,
  Milestone, FolderPlus, Hash, RefreshCw, Target,
  Calendar, AlertCircle, ChevronLeft, ZoomIn, ArrowRight,
} from "lucide-react";
import UserAssignmentPicker from "@/components/UserAssignmentPicker";
import {
  format, addDays, differenceInDays, parseISO, isValid, startOfDay,
  eachWeekOfInterval, startOfWeek, endOfWeek, isSameDay,
} from "date-fns";

interface UnifiedPlanTabProps {
  projectName: string;
  onTaskClick?: (taskId: number) => void;
}

interface ResolvedKeyDate {
  id: number;
  keyDateName: string;
  sourceTaskNameMatch: string | null;
  dateField: string;
  sortOrder: number;
  matchedTaskId: number | null;
  matchedTaskTitle: string | null;
  matchedTaskNumber: string | null;
  plannedDate: string | null;
  actualDate: string | null;
  effectiveDate: string | null;
  mappingValid: boolean;
  source: string;
}

const STATUSES = ["Not Started", "In Progress", "Blocked", "Done"] as const;

const statusIcon = (s: string) => {
  switch (s) {
    case "Done": return <CheckCircle2 className="h-3 w-3 text-emerald-600" />;
    case "In Progress": return <Loader2 className="h-3 w-3 text-blue-600" />;
    case "Blocked": return <Ban className="h-3 w-3 text-red-500" />;
    default: return <Circle className="h-3 w-3 text-slate-400" />;
  }
};

const pctColor = (pct: number) => {
  if (pct >= 100) return "bg-emerald-500";
  if (pct >= 60) return "bg-emerald-400";
  if (pct >= 30) return "bg-blue-400";
  if (pct > 0) return "bg-amber-400";
  return "bg-slate-200";
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

const formatKeyDate = (d: string | null): string => {
  if (!d) return "—";
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
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

function InlinePctEditor({ pct, onCommit }: { pct: number; onCommit: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState(String(pct));

  useEffect(() => { setLocalVal(String(pct)); }, [pct]);

  const commit = () => {
    const parsed = Math.min(100, Math.max(0, parseInt(localVal) || 0));
    setEditing(false);
    onCommit(parsed);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <input
          data-testid="inline-pct-input"
          className="w-10 h-5 text-[10px] tabular-nums text-center border border-primary/40 rounded bg-background outline-none focus:ring-1 focus:ring-primary/30"
          type="number"
          min={0}
          max={100}
          value={localVal}
          onChange={(e) => setLocalVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          autoFocus
        />
        <span className="text-[9px] text-muted-foreground">%</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 cursor-pointer group"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="Click to edit"
      data-testid="inline-pct-display"
    >
      <div className="flex-1 h-[5px] rounded-full bg-slate-100 overflow-hidden min-w-[30px]">
        <div className={`h-full rounded-full transition-all ${pctColor(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`text-[10px] tabular-nums font-semibold min-w-[24px] text-right group-hover:text-primary ${pct >= 100 ? "text-emerald-600" : pct > 0 ? "text-slate-700" : "text-slate-400"}`}>
        {pct}%
      </span>
    </div>
  );
}

type ZoomLevel = "week" | "month";

export default function UnifiedPlanTab({ projectName, onTaskClick }: UnifiedPlanTabProps) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchText, setSearchText] = useState("");
  const [collapsedParents, setCollapsedParents] = useState<Set<number>>(new Set());
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false);
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [showKeyDates, setShowKeyDates] = useState(true);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("week");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const ganttScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);

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

  const { data: keyDates = [] } = useQuery<ResolvedKeyDate[]>({
    queryKey: ["key-dates", projectName],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/key-dates/${encodeURIComponent(projectName)}`, { credentials: 'include', headers });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Record<string, unknown> }) => {
      await apiRequest("PATCH", `/api/planning-tasks/${id}`, { projectName, ...updates });
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

  const structureMutation = useMutation({
    mutationFn: async ({ operation, data }: { operation: string; data: any }) => {
      await apiRequest("POST", "/api/project-plan/structure", { operation, projectName, data });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planning-tasks", projectName] });
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] });
    },
  });

  const renumberMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/project-plan/structure", { operation: "renumber", projectName, data: {} });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planning-tasks", projectName] });
      toast({ title: "Numbering updated" });
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
            await apiRequest("POST", "/api/project-plan/delete-tasks", { projectName: pName, rowNumbers });
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planning-tasks", projectName] });
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
    if (searchText) {
      const lower = searchText.toLowerCase();
      result = result.filter(t => t.title?.toLowerCase().includes(lower) || (t.taskNumber || "").toLowerCase().includes(lower));
    }
    return result;
  }, [tasks, statusFilter, searchText]);

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
    const avgPct = leafTasks.length > 0 ? Math.round(leafTasks.reduce((s, t) => s + (t.percentComplete || 0), 0) / leafTasks.length) : 0;
    const expLeafs = leafTasks.filter(t => t.computedExpectedPct !== null && t.computedExpectedPct !== undefined);
    const avgExpectedPct = expLeafs.length > 0 ? Math.round(expLeafs.reduce((s, t) => s + (t.computedExpectedPct ?? 0), 0) / expLeafs.length) : null;
    return { total, done, avgPct, avgExpectedPct };
  }, [tasks]);

  const ganttRange = useMemo(() => {
    let minDate: Date | null = null;
    let maxDate: Date | null = null;
    for (const t of tasks) {
      const s = t.startDate || t.actualStartDate;
      const e = t.dueDate || t.actualEndDate;
      if (s) {
        const d = new Date(s);
        if (isValid(d) && (!minDate || d < minDate)) minDate = d;
      }
      if (e) {
        const d = new Date(e);
        if (isValid(d) && (!maxDate || d > maxDate)) maxDate = d;
      }
    }
    if (!minDate) minDate = startOfDay(new Date());
    if (!maxDate) maxDate = addDays(minDate, 90);
    return {
      start: addDays(startOfWeek(minDate, { weekStartsOn: 1 }), -7),
      end: addDays(endOfWeek(maxDate, { weekStartsOn: 1 }), 7),
    };
  }, [tasks]);

  const weeks = useMemo(() => {
    return eachWeekOfInterval(
      { start: ganttRange.start, end: ganttRange.end },
      { weekStartsOn: 1 }
    );
  }, [ganttRange]);

  const dayWidth = zoomLevel === "week" ? 28 : 8;
  const totalDays = differenceInDays(ganttRange.end, ganttRange.start);
  const ganttTotalWidth = totalDays * dayWidth;

  const today = startOfDay(new Date());
  const todayOffset = differenceInDays(today, ganttRange.start) * dayWidth;

  const getBarStyle = useCallback((task: any) => {
    const s = task.startDate || task.actualStartDate;
    const e = task.dueDate || task.actualEndDate;
    if (!s || !e) return null;
    const startD = new Date(s);
    const endD = new Date(e);
    if (!isValid(startD) || !isValid(endD)) return null;
    const leftDays = differenceInDays(startD, ganttRange.start);
    const widthDays = Math.max(1, differenceInDays(endD, startD) + 1);
    return {
      left: leftDays * dayWidth,
      width: widthDays * dayWidth,
    };
  }, [ganttRange, dayWidth]);

  const jumpToToday = () => {
    if (ganttScrollRef.current) {
      ganttScrollRef.current.scrollLeft = Math.max(0, todayOffset - 200);
    }
  };

  useEffect(() => {
    if (tasks.length > 0 && ganttScrollRef.current) {
      const timer = setTimeout(jumpToToday, 100);
      return () => clearTimeout(timer);
    }
  }, [tasks.length]);

  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (ganttScrollRef.current) {
      ganttScrollRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  }, []);

  const handleGanttScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  }, []);

  const toggleCollapse = (id: number) => {
    setCollapsedParents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateMilestone = () => {
    if (!milestoneTitle.trim()) return;
    structureMutation.mutate(
      { operation: "createMilestone", data: { title: milestoneTitle.trim() } },
      { onSuccess: () => { setMilestoneDialogOpen(false); setMilestoneTitle(""); } }
    );
  };

  const ROW_HEIGHT = 32;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="loading-unified-plan">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
        <span className="ml-2 text-sm text-muted-foreground">Loading project plan...</span>
      </div>
    );
  }

  const validKeyDates = keyDates.filter(d => d.mappingValid).length;

  return (
    <div className="space-y-3" data-testid="unified-plan-tab">
      <div className="flex items-center gap-3 flex-wrap" data-testid="plan-kpi-bar">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-50 border">
          <Clock className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs text-muted-foreground">Total</span>
          <span className="text-sm font-bold tabular-nums" data-testid="kpi-total">{kpis.total}</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-50 border border-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          <span className="text-xs text-muted-foreground">Done</span>
          <span className="text-sm font-bold tabular-nums text-emerald-700" data-testid="kpi-done">{kpis.done}</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-50 border border-blue-200">
          <Target className="h-3.5 w-3.5 text-blue-600" />
          <span className="text-xs text-muted-foreground">Actual %</span>
          <span className="text-sm font-bold tabular-nums text-blue-700" data-testid="kpi-actual">{kpis.avgPct}%</span>
          {kpis.avgExpectedPct !== null && (
            <Badge
              variant="outline"
              className={`text-[9px] ml-1 ${kpis.avgPct < kpis.avgExpectedPct ? "bg-amber-50 text-amber-700 border-amber-300" : "bg-emerald-50 text-emerald-700 border-emerald-300"}`}
              data-testid="kpi-delta"
            >
              {kpis.avgPct >= kpis.avgExpectedPct ? "+" : ""}{kpis.avgPct - kpis.avgExpectedPct}%
            </Badge>
          )}
        </div>
        {kpis.avgExpectedPct !== null && (
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border ${kpis.avgPct < kpis.avgExpectedPct ? "bg-amber-50 border-amber-200" : "bg-slate-50"}`}>
            <Calendar className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-xs text-muted-foreground">Expected %</span>
            <span className="text-sm font-bold tabular-nums" data-testid="kpi-expected">{kpis.avgExpectedPct}%</span>
          </div>
        )}
        {keyDates.length > 0 && (
          <Button
            size="sm"
            variant={showKeyDates ? "default" : "outline"}
            className="h-7 text-xs ml-auto"
            onClick={() => setShowKeyDates(!showKeyDates)}
            data-testid="toggle-key-dates"
          >
            <Calendar className="h-3 w-3 mr-1" />
            Key Dates ({validKeyDates}/{keyDates.length})
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap" data-testid="plan-toolbar">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-8 h-7 text-xs"
            data-testid="input-search-plan"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px] h-7 text-xs" data-testid="select-status-filter">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Statuses</SelectItem>
            {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {isAdmin && (
          <>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setMilestoneDialogOpen(true)} data-testid="button-create-milestone">
              <Milestone className="h-3 w-3 mr-1" /> Create Milestone
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => renumberMutation.mutate()} disabled={renumberMutation.isPending} data-testid="button-renumber">
              <Hash className="h-3 w-3 mr-1" /> Refresh Numbering
            </Button>
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Select value={zoomLevel} onValueChange={(v) => setZoomLevel(v as ZoomLevel)}>
            <SelectTrigger className="w-[90px] h-7 text-xs" data-testid="select-zoom">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="month">Month</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={jumpToToday} data-testid="button-today">
            <Target className="h-3 w-3 mr-1" /> Today
          </Button>
        </div>
      </div>

      {showKeyDates && keyDates.length > 0 && (
        <div className="flex gap-2 flex-wrap p-2 rounded-md bg-blue-50/50 border border-blue-100" data-testid="key-dates-strip">
          {keyDates.map((kd) => (
            <div
              key={kd.id}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs border ${
                kd.mappingValid ? "bg-white border-emerald-200" : "bg-slate-50 border-slate-200"
              }`}
              data-testid={`key-date-${kd.keyDateName.replace(/\s+/g, '-').toLowerCase()}`}
            >
              {kd.mappingValid ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
              ) : (
                <AlertCircle className="h-3 w-3 text-slate-400 shrink-0" />
              )}
              <span className="font-medium text-[11px]">{kd.keyDateName}</span>
              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />
              <span className={`text-[11px] tabular-nums ${kd.mappingValid ? "text-slate-700" : "text-slate-400"}`}>
                {formatKeyDate(kd.effectiveDate)}
              </span>
            </div>
          ))}
        </div>
      )}

      {selectedIds.size > 0 && isAdmin && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50 border border-amber-200" data-testid="bulk-actions">
          <span className="text-xs font-medium">{selectedIds.size} selected</span>
          <Button size="sm" variant="destructive" className="h-6 text-[10px]" onClick={() => deleteMutation.mutate(Array.from(selectedIds))} data-testid="button-bulk-delete">
            <Trash2 className="h-3 w-3 mr-1" /> Delete
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setSelectedIds(new Set())} data-testid="button-clear-selection">
            Clear
          </Button>
        </div>
      )}

      <div className="flex border rounded-md overflow-hidden bg-white" style={{ height: "calc(100vh - 320px)", minHeight: "400px" }} data-testid="plan-grid-container">
        <div
          ref={bodyScrollRef}
          className="flex-shrink-0 overflow-y-auto overflow-x-auto border-r"
          style={{ width: "clamp(500px, 55%, 700px)" }}
          onScroll={handleBodyScroll}
          data-testid="plan-grid-left"
        >
          <table className="w-full text-[11px] border-collapse">
            <thead className="sticky top-0 z-20 bg-slate-100">
              <tr>
                <th className="w-7 px-1 py-1.5 text-center border-b border-r font-semibold text-slate-600">
                  <Checkbox
                    checked={selectedIds.size === visibleTasks.length && visibleTasks.length > 0}
                    onCheckedChange={(checked) => {
                      if (checked) setSelectedIds(new Set(visibleTasks.map(t => t.id)));
                      else setSelectedIds(new Set());
                    }}
                    className="h-3 w-3"
                    data-testid="checkbox-select-all"
                  />
                </th>
                <th className="w-10 px-1 py-1.5 text-center border-b border-r font-semibold text-slate-600" data-testid="header-wbs">WBS</th>
                <th className="min-w-[160px] px-2 py-1.5 text-left border-b border-r font-semibold text-slate-600" data-testid="header-task">TASK</th>
                <th className="w-[70px] px-1 py-1.5 text-center border-b border-r font-semibold text-slate-600" data-testid="header-lead">LEAD</th>
                <th className="w-[68px] px-1 py-1.5 text-center border-b border-r font-semibold text-slate-600" data-testid="header-start">START</th>
                <th className="w-[68px] px-1 py-1.5 text-center border-b border-r font-semibold text-slate-600" data-testid="header-end">END</th>
                <th className="w-10 px-1 py-1.5 text-center border-b border-r font-semibold text-slate-600" data-testid="header-days">DAYS</th>
                <th className="w-[90px] px-1 py-1.5 text-center border-b border-r font-semibold text-slate-600" data-testid="header-pct-done">% DONE</th>
                <th className="w-14 px-1 py-1.5 text-center border-b font-semibold text-slate-600" data-testid="header-pct-forecast">% FORE</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center text-muted-foreground py-12">
                    <div className="flex flex-col items-center gap-2">
                      <Circle className="h-8 w-8 text-slate-300" />
                      <span className="text-emerald-600 font-medium">No tasks found</span>
                      <span className="text-[10px]">Add a task below to get started</span>
                    </div>
                  </td>
                </tr>
              ) : (
                visibleTasks.map((task) => {
                  const depth = getTaskDepth(task, taskMap);
                  const isMilestone = task.isVirtualMilestone || task.isMilestone;
                  const hasChildren = task.isParent || task.childCount > 0;
                  const isCollapsed = collapsedParents.has(task.id);
                  const pct = task.percentComplete || 0;
                  const expPct = task.computedExpectedPct ?? task.expectedPercentComplete ?? null;
                  const isLate = expPct !== null && pct < expPct && pct < 100;

                  return (
                    <tr
                      key={task.id}
                      className={`
                        border-b transition-colors cursor-pointer
                        ${isMilestone ? "bg-amber-50/80 font-semibold" : "hover:bg-slate-50"}
                        ${isLate && !isMilestone ? "bg-red-50/30" : ""}
                        ${selectedIds.has(task.id) ? "bg-blue-50" : ""}
                      `}
                      style={{ height: ROW_HEIGHT }}
                      onClick={() => onTaskClick?.(task.id)}
                      data-testid={`plan-row-${task.id}`}
                    >
                      <td className="px-1 text-center border-r" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(task.id)}
                          onCheckedChange={(checked) => {
                            setSelectedIds(prev => {
                              const next = new Set(prev);
                              if (checked) next.add(task.id);
                              else next.delete(task.id);
                              return next;
                            });
                          }}
                          className="h-3 w-3"
                          data-testid={`checkbox-task-${task.id}`}
                        />
                      </td>
                      <td className="px-1 text-center border-r text-[10px] tabular-nums text-slate-500" data-testid={`wbs-${task.id}`}>
                        {task.taskNumber || ""}
                      </td>
                      <td className="px-2 border-r truncate" data-testid={`task-name-${task.id}`}>
                        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
                          {hasChildren && (
                            <button
                              className="p-0.5 hover:bg-slate-200 rounded flex-shrink-0"
                              onClick={(e) => { e.stopPropagation(); toggleCollapse(task.id); }}
                              data-testid={`toggle-${task.id}`}
                            >
                              {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                          )}
                          {isMilestone && <Milestone className="h-3 w-3 text-amber-600 flex-shrink-0" />}
                          <span className={`truncate ${isMilestone ? "text-amber-800" : ""}`} title={task.title}>
                            {task.title}
                          </span>
                        </div>
                      </td>
                      <td className="px-1 text-center border-r text-[10px] text-slate-500 truncate" data-testid={`lead-${task.id}`}>
                        {task.assignees ? (
                          <span className="truncate">{typeof task.assignees === 'string' ? task.assignees.split(',')[0] : '—'}</span>
                        ) : "—"}
                      </td>
                      <td className="px-1 text-center border-r text-[10px] tabular-nums" data-testid={`start-${task.id}`}>
                        {formatDateCompact(task.startDate || task.actualStartDate)}
                      </td>
                      <td className="px-1 text-center border-r text-[10px] tabular-nums" data-testid={`end-${task.id}`}>
                        {formatDateCompact(task.dueDate || task.actualEndDate)}
                      </td>
                      <td className="px-1 text-center border-r text-[10px] tabular-nums" data-testid={`days-${task.id}`}>
                        {task.plannedDurationDays || task.durationDays || "—"}
                      </td>
                      <td className="px-1 border-r" onClick={(e) => e.stopPropagation()} data-testid={`pct-done-${task.id}`}>
                        <InlinePctEditor
                          pct={pct}
                          onCommit={(v) => updateMutation.mutate({ id: task.id, updates: { percentComplete: v } })}
                        />
                      </td>
                      <td className={`px-1 text-center text-[10px] tabular-nums font-medium ${isLate ? "text-amber-600" : "text-slate-500"}`} data-testid={`pct-forecast-${task.id}`}>
                        {expPct !== null ? `${expPct}%` : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div
          ref={ganttScrollRef}
          className="flex-1 overflow-auto"
          onScroll={handleGanttScroll}
          data-testid="plan-gantt-right"
        >
          <div style={{ width: ganttTotalWidth, minHeight: "100%" }} className="relative">
            <div className="sticky top-0 z-10 bg-slate-100 border-b flex" style={{ height: 28 }}>
              {weeks.map((weekStart, i) => {
                const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
                const leftPx = differenceInDays(weekStart, ganttRange.start) * dayWidth;
                const widthPx = 7 * dayWidth;
                const weekNum = Math.ceil((differenceInDays(weekStart, new Date(weekStart.getFullYear(), 0, 1)) + 1) / 7);

                return (
                  <div
                    key={i}
                    className="absolute border-r border-slate-200 flex items-center justify-center"
                    style={{ left: leftPx, width: widthPx, height: 28 }}
                  >
                    <span className="text-[9px] text-slate-500 font-medium">
                      {zoomLevel === "week"
                        ? `${format(weekStart, "dd MMM")} - ${format(weekEnd, "dd MMM")}`
                        : `W${weekNum}`
                      }
                    </span>
                  </div>
                );
              })}
            </div>

            {todayOffset >= 0 && todayOffset <= ganttTotalWidth && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20"
                style={{ left: todayOffset }}
                data-testid="gantt-today-line"
              >
                <div className="absolute -top-0 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[8px] px-1 rounded-b font-medium" style={{ top: 28 }}>
                  Today
                </div>
              </div>
            )}

            {weeks.map((weekStart, i) => {
              const leftPx = differenceInDays(weekStart, ganttRange.start) * dayWidth;
              return (
                <div
                  key={`grid-${i}`}
                  className="absolute top-7 bottom-0 border-r border-slate-100"
                  style={{ left: leftPx }}
                />
              );
            })}

            <div style={{ paddingTop: 28 }}>
              {visibleTasks.map((task) => {
                const bar = getBarStyle(task);
                const pct = task.percentComplete || 0;
                const isMilestone = task.isVirtualMilestone || task.isMilestone;
                const expPct = task.computedExpectedPct ?? task.expectedPercentComplete ?? null;
                const isLate = expPct !== null && pct < expPct && pct < 100;

                return (
                  <div
                    key={task.id}
                    className={`relative border-b ${isMilestone ? "bg-amber-50/40" : ""}`}
                    style={{ height: ROW_HEIGHT }}
                    data-testid={`gantt-row-${task.id}`}
                  >
                    {bar && (
                      <div
                        className={`absolute top-1 rounded-sm overflow-hidden ${
                          isLate
                            ? "bg-red-200 border border-red-300"
                            : pct >= 100
                              ? "bg-emerald-200 border border-emerald-300"
                              : isMilestone
                                ? "bg-amber-200 border border-amber-300"
                                : "bg-blue-200 border border-blue-300"
                        }`}
                        style={{
                          left: bar.left,
                          width: Math.max(bar.width, 4),
                          height: ROW_HEIGHT - 8,
                        }}
                        title={`${task.title}: ${pct}% complete`}
                        data-testid={`gantt-bar-${task.id}`}
                      >
                        <div
                          className={`h-full transition-all ${
                            isLate
                              ? "bg-red-500"
                              : pct >= 100
                                ? "bg-emerald-500"
                                : isMilestone
                                  ? "bg-amber-500"
                                  : "bg-blue-500"
                          }`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                        {expPct !== null && expPct > 0 && expPct < 100 && (
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-slate-700"
                            style={{ left: `${expPct}%` }}
                            title={`Expected: ${expPct}%`}
                          />
                        )}
                      </div>
                    )}
                    {!bar && isMilestone && (
                      <div
                        className="absolute top-2"
                        style={{ left: todayOffset }}
                      >
                        <div className="w-3 h-3 bg-amber-500 rotate-45" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="flex items-center gap-2 px-2 py-1.5 border rounded-md bg-slate-50" data-testid="add-task-row">
          <Plus className="h-3.5 w-3.5 text-slate-400" />
          <Input
            placeholder="Add a new task..."
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newTaskTitle.trim()) createMutation.mutate(newTaskTitle.trim()); }}
            className="h-7 text-xs border-none bg-transparent shadow-none focus-visible:ring-0"
            data-testid="input-add-task"
          />
          <Button
            size="sm"
            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
            disabled={!newTaskTitle.trim() || createMutation.isPending}
            onClick={() => { if (newTaskTitle.trim()) createMutation.mutate(newTaskTitle.trim()); }}
            data-testid="button-add-task"
          >
            Add
          </Button>
        </div>
      )}

      <Dialog open={milestoneDialogOpen} onOpenChange={setMilestoneDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Milestone</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Milestone name..."
            value={milestoneTitle}
            onChange={(e) => setMilestoneTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreateMilestone(); }}
            data-testid="input-milestone-title"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMilestoneDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateMilestone} disabled={!milestoneTitle.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
