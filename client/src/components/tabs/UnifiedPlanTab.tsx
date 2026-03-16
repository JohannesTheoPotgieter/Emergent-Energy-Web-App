import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, invalidateProjectQueries } from "@/lib/queryClient";
import { createMilestoneFlow, invalidateMilestoneCreationQueries } from "@/lib/milestone-create-flow";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Search, Trash2, ChevronDown, ChevronRight,
  CheckCircle2, Clock, Circle, Ban, Loader2,
  Milestone, FolderPlus, Hash, RefreshCw, Target,
  Calendar, AlertCircle, ChevronLeft, ZoomIn, ArrowRight,
  GripVertical, MoreHorizontal, ArrowDownToLine, Unlink,
  ArrowUp, ArrowDown, Diamond, FolderOpen, Link2, Link2Off,
  Columns3, Save, RotateCcw, X, Eye, EyeOff, Info, Filter,
} from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import UserAssignmentPicker from "@/components/UserAssignmentPicker";
import {
  format, addDays, differenceInDays, parseISO, isValid, startOfDay,
  eachWeekOfInterval, startOfWeek, endOfWeek, isSameDay,
} from "date-fns";

const getSAPublicHolidays = (year: number): Set<string> => {
  const holidays = new Set<string>();
  const add = (m: number, d: number) => holidays.add(`${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  add(1, 1);
  add(3, 21);
  add(4, 27);
  add(5, 1);
  add(6, 16);
  add(8, 9);
  add(9, 24);
  add(12, 16);
  add(12, 25);
  add(12, 26);

  const easterSunday = (y: number): Date => {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  };
  const easter = easterSunday(year);
  const goodFriday = new Date(easter); goodFriday.setDate(easter.getDate() - 2);
  const familyDay = new Date(easter); familyDay.setDate(easter.getDate() + 1);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  holidays.add(fmt(goodFriday));
  holidays.add(fmt(familyDay));

  const substituteIfSunday = (m: number, d: number) => {
    const dt = new Date(year, m - 1, d);
    if (dt.getDay() === 0) add(m, d + 1);
  };
  substituteIfSunday(1, 1); substituteIfSunday(3, 21); substituteIfSunday(4, 27);
  substituteIfSunday(5, 1); substituteIfSunday(6, 16); substituteIfSunday(8, 9);
  substituteIfSunday(9, 24); substituteIfSunday(12, 16); substituteIfSunday(12, 25); substituteIfSunday(12, 26);

  return holidays;
};

const _holidayCache = new Map<number, Set<string>>();
const getHolidaysForYear = (y: number) => {
  if (!_holidayCache.has(y)) _holidayCache.set(y, getSAPublicHolidays(y));
  return _holidayCache.get(y)!;
};

const countWorkingDays = (startDate: Date, endDate: Date): number => {
  if (startDate >= endDate) return 0;
  let count = 0;
  const cur = new Date(startDate);
  while (cur < endDate) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      if (!getHolidaysForYear(cur.getFullYear()).has(key)) {
        count++;
      }
    }
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(count, 1);
};

interface UnifiedPlanTabProps {
  projectName: string;
  onTaskClick?: (taskId: number, assignmentRole?: string | null) => void;
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
    default: return <Circle className="h-3 w-3 text-slate-500" />;
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

const MILESTONE_GROUP_COLORS = [
  { bg: "bg-blue-200", border: "border-blue-300", fill: "bg-blue-500", light: "bg-blue-50/40" },
  { bg: "bg-violet-200", border: "border-violet-300", fill: "bg-violet-500", light: "bg-violet-50/40" },
  { bg: "bg-teal-200", border: "border-teal-300", fill: "bg-teal-500", light: "bg-teal-50/40" },
  { bg: "bg-amber-200", border: "border-amber-300", fill: "bg-amber-500", light: "bg-amber-50/40" },
  { bg: "bg-rose-200", border: "border-rose-300", fill: "bg-rose-500", light: "bg-rose-50/40" },
  { bg: "bg-cyan-200", border: "border-cyan-300", fill: "bg-cyan-500", light: "bg-cyan-50/40" },
  { bg: "bg-orange-200", border: "border-orange-300", fill: "bg-orange-500", light: "bg-orange-50/40" },
  { bg: "bg-indigo-200", border: "border-indigo-300", fill: "bg-indigo-500", light: "bg-indigo-50/40" },
  { bg: "bg-lime-200", border: "border-lime-300", fill: "bg-lime-500", light: "bg-lime-50/40" },
  { bg: "bg-pink-200", border: "border-pink-300", fill: "bg-pink-500", light: "bg-pink-50/40" },
];

const getRootParentId = (task: any, taskMap: Map<number, any>): number => {
  let current = task;
  const seen = new Set<number>();
  while (current?.parentTaskId && taskMap.has(current.parentTaskId)) {
    if (seen.has(current.id)) return current.id;
    seen.add(current.id);
    current = taskMap.get(current.parentTaskId);
  }
  return current?.id ?? task.id;
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
      <div className="flex-1 h-[5px] rounded-full bg-muted overflow-hidden min-w-[30px]">
        <div className={`h-full rounded-full transition-all ${pctColor(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`text-[10px] tabular-nums font-semibold min-w-[24px] text-right group-hover:text-primary ${pct >= 100 ? "text-emerald-600" : pct > 0 ? "text-foreground" : "text-slate-500"}`}>
        {pct}%
      </span>
    </div>
  );
}

function InlineWbsEditor({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState(value);

  useEffect(() => { setLocalVal(value); }, [value]);

  const commit = () => {
    setEditing(false);
    if (localVal.trim() !== value) onCommit(localVal.trim());
  };

  if (editing) {
    return (
      <input
        data-testid="inline-wbs-input"
        className="w-full h-5 text-[10px] tabular-nums text-center border border-primary/40 rounded bg-background outline-none focus:ring-1 focus:ring-primary/30"
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setLocalVal(value); setEditing(false); } }}
        onClick={(e) => e.stopPropagation()}
        autoFocus
      />
    );
  }

  return (
    <span
      className="cursor-pointer hover:text-primary hover:underline"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="Click to edit WBS number"
    >
      {value || "—"}
    </span>
  );
}

function InlineDateEditor({ value, onCommit }: { value: string | null; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const displayVal = value ? value.substring(0, 10) : "";
  const [localVal, setLocalVal] = useState(displayVal);

  useEffect(() => { setLocalVal(value ? value.substring(0, 10) : ""); }, [value]);

  const commit = () => {
    setEditing(false);
    if (localVal !== displayVal && localVal) onCommit(localVal);
  };

  if (editing) {
    return (
      <input
        data-testid="inline-date-input"
        className="w-full h-5 text-[10px] tabular-nums text-center border border-primary/40 rounded bg-background outline-none focus:ring-1 focus:ring-primary/30"
        type="date"
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setLocalVal(displayVal); setEditing(false); } }}
        onClick={(e) => e.stopPropagation()}
        autoFocus
      />
    );
  }

  return (
    <span
      className="cursor-pointer hover:text-primary hover:underline"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="Click to edit date"
    >
      {formatDateCompact(value) || "—"}
    </span>
  );
}

function InlineDurationEditor({ value, onCommit }: { value: number | string; onCommit: (v: number) => void }) {
  const numVal = typeof value === 'number' ? value : parseInt(String(value)) || 0;
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState(String(numVal));

  useEffect(() => { setLocalVal(String(numVal)); }, [numVal]);

  const commit = () => {
    const parsed = Math.max(0, parseInt(localVal) || 0);
    setEditing(false);
    onCommit(parsed);
  };

  if (editing) {
    return (
      <input
        data-testid="inline-duration-input"
        className="w-12 h-5 text-[10px] tabular-nums text-center border border-primary/40 rounded bg-background outline-none focus:ring-1 focus:ring-primary/30"
        type="number"
        min={0}
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setLocalVal(String(numVal)); setEditing(false); } }}
        onClick={(e) => e.stopPropagation()}
        autoFocus
      />
    );
  }

  return (
    <span
      className="cursor-pointer hover:text-primary hover:underline"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="Click to edit duration (working days)"
    >
      {numVal > 0 ? `${numVal}d` : "—"}
    </span>
  );
}

interface DependencyRecord {
  id: number;
  predecessorId: number;
  successorId: number;
  depType: string;
  lagDays: number;
}

function InlinePredecessorEditor({
  task,
  allTasks,
  dependencies,
  onAdd,
  onRemove,
  isPending,
}: {
  task: any;
  allTasks: any[];
  dependencies: DependencyRecord[];
  onAdd: (predecessorWorkItemId: number, successorWorkItemId: number) => void;
  onRemove: (depId: number) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const workItemId = task.workItemId || Math.abs(task.id);

  const predecessorDeps = dependencies.filter(d => d.successorId === workItemId);

  const wiToRowMap = useMemo(() => {
    const m = new Map<number, number>();
    allTasks.forEach((t, idx) => {
      const wi = t.workItemId || Math.abs(t.id);
      m.set(wi, idx + 1);
    });
    return m;
  }, [allTasks]);

  const predDisplay = predecessorDeps.map(d => {
    const row = wiToRowMap.get(d.predecessorId);
    const suffix = d.depType && d.depType !== "FS" ? d.depType : "";
    const lag = d.lagDays && d.lagDays !== 0 ? `+${d.lagDays}d` : "";
    return `${row ?? "?"}${suffix}${lag}`;
  }).join(", ");

  const existingPredIds = new Set(predecessorDeps.map(d => d.predecessorId));

  const availableTasks = allTasks.filter(t => {
    const wi = t.workItemId || Math.abs(t.id);
    if (wi === workItemId) return false;
    if (existingPredIds.has(wi)) return false;
    if (search) {
      const s = search.toLowerCase();
      const row = wiToRowMap.get(wi);
      if (String(row) === s) return true;
      return (t.title || "").toLowerCase().includes(s);
    }
    return true;
  });

  useEffect(() => {
    if (open && inputRef.current) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          className="cursor-pointer hover:text-primary hover:underline block truncate"
          onClick={(e) => { e.stopPropagation(); setOpen(true); }}
          title={predDisplay || "Click to set predecessor"}
          data-testid={`pred-trigger-${task.id}`}
        >
          {predDisplay || "—"}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start" side="bottom" onClick={(e) => e.stopPropagation()}>
        {predecessorDeps.length > 0 && (
          <div className="mb-2 space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Current</p>
            {predecessorDeps.map(d => {
              const row = wiToRowMap.get(d.predecessorId);
              const predTask = allTasks.find(t => (t.workItemId || Math.abs(t.id)) === d.predecessorId);
              return (
                <div key={d.id} className="flex items-center justify-between gap-1 px-1.5 py-1 rounded bg-blue-50 border border-blue-200 text-[10px]">
                  <span className="truncate text-blue-800">
                    <span className="font-bold">#{row}</span> {predTask?.title || "Unknown"} <span className="text-blue-500">({d.depType || "FS"})</span>
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(d.id); }}
                    className="text-red-400 hover:text-red-600 shrink-0"
                    disabled={isPending}
                    data-testid={`pred-remove-${d.id}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-1.5 mb-1.5">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 h-6 text-xs border-0 bg-transparent outline-none placeholder:text-muted-foreground"
            placeholder="Row # or task name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            data-testid={`pred-search-${task.id}`}
          />
        </div>
        <div className="max-h-40 overflow-y-auto space-y-0.5">
          {availableTasks.slice(0, 30).map(t => {
            const wi = t.workItemId || Math.abs(t.id);
            const row = wiToRowMap.get(wi);
            return (
              <button
                key={t.id}
                className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-[10px] hover:bg-muted text-foreground transition-colors text-left"
                onClick={(e) => {
                  e.stopPropagation();
                  onAdd(wi, workItemId);
                  setSearch("");
                }}
                disabled={isPending}
                data-testid={`pred-add-${t.id}`}
              >
                <span className="font-bold text-primary shrink-0">#{row}</span>
                <span className="truncate">{t.title}</span>
              </button>
            );
          })}
          {availableTasks.length === 0 && <p className="text-[10px] text-muted-foreground text-center py-2">No tasks available</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type ZoomLevel = "week" | "month";

interface PlanColumn {
  id: string;
  label: string;
  width: string;
  alwaysVisible?: boolean;
}

const ALL_COLUMNS: PlanColumn[] = [
  { id: "rowNum", label: "#", width: "w-8", alwaysVisible: true },
  { id: "indicator", label: "Type", width: "w-6" },
  { id: "wbs", label: "WBS", width: "w-12" },
  { id: "taskName", label: "Task Name", width: "min-w-[140px]", alwaysVisible: true },
  { id: "duration", label: "Duration", width: "w-14" },
  { id: "start", label: "Start", width: "w-[68px]" },
  { id: "finish", label: "Finish", width: "w-[68px]" },
  { id: "predecessors", label: "Pred.", width: "w-[60px]" },
  { id: "resource", label: "Resource", width: "w-[70px]" },
  { id: "workstream", label: "Workstream", width: "w-[80px]" },
  { id: "pctComplete", label: "% Complete", width: "w-[90px]" },
  { id: "expectedPct", label: "Expected %", width: "w-[70px]" },
  { id: "status", label: "Status", width: "w-10" },
];

const DEFAULT_VISIBLE_COLUMNS = ALL_COLUMNS.map(c => c.id);

interface SavedView {
  name: string;
  columns: string[];
}

const STORAGE_KEY_COLUMNS = "planTab_visibleColumns";
const STORAGE_KEY_VIEWS = "planTab_savedViews";

function loadVisibleColumns(): string[] {
  const alwaysOn = ALL_COLUMNS.filter(c => c.alwaysVisible).map(c => c.id);
  try {
    const stored = localStorage.getItem(STORAGE_KEY_COLUMNS);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const merged = [...new Set([...alwaysOn, ...parsed])];
        return merged;
      }
    }
  } catch {}
  return DEFAULT_VISIBLE_COLUMNS;
}

function saveVisibleColumns(cols: string[]) {
  localStorage.setItem(STORAGE_KEY_COLUMNS, JSON.stringify(cols));
}

function loadSavedViews(): SavedView[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_VIEWS);
    if (stored) return JSON.parse(stored);
  } catch {}
  return [];
}

function saveSavedViews(views: SavedView[]) {
  localStorage.setItem(STORAGE_KEY_VIEWS, JSON.stringify(views));
}

export default function UnifiedPlanTab({ projectName, onTaskClick }: UnifiedPlanTabProps) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("All");
  const [workstreamFilter, setWorkstreamFilter] = useState("All");
  const [searchText, setSearchText] = useState("");
  const [collapsedParents, setCollapsedParents] = useState<Set<number>>(new Set());
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false);
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [isCreatingMilestone, setIsCreatingMilestone] = useState(false);
  const [showKeyDates, setShowKeyDates] = useState(true);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("month");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [dragTaskId, setDragTaskId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ taskId: number; position: "above" | "below" | "child" } | null>(null);
  const [convertMilestoneDialogOpen, setConvertMilestoneDialogOpen] = useState(false);
  const [convertMilestoneTask, setConvertMilestoneTask] = useState<any>(null);
  const [groupUnderDialogOpen, setGroupUnderDialogOpen] = useState(false);
  const [groupUnderTask, setGroupUnderTask] = useState<any>(null);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(loadVisibleColumns);
  const [savedViews, setSavedViews] = useState<SavedView[]>(loadSavedViews);
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");

  const isColumnVisible = useCallback((id: string) => {
    const col = ALL_COLUMNS.find(c => c.id === id);
    if (col?.alwaysVisible) return true;
    return visibleColumns.includes(id);
  }, [visibleColumns]);
  const toggleColumn = useCallback((id: string) => {
    const col = ALL_COLUMNS.find(c => c.id === id);
    if (col?.alwaysVisible) return;
    setVisibleColumns(prev => {
      const next = prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id];
      saveVisibleColumns(next);
      return next;
    });
  }, []);
  const resetColumns = useCallback(() => {
    setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
    saveVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
  }, []);
  const saveCurrentView = useCallback((name: string) => {
    if (!name.trim()) return;
    const existing = savedViews.filter(v => v.name !== name.trim());
    const updated = [...existing, { name: name.trim(), columns: visibleColumns }];
    setSavedViews(updated);
    saveSavedViews(updated);
    setNewViewName("");
    toast({ title: `View "${name.trim()}" saved` });
  }, [visibleColumns, savedViews, toast]);
  const loadView = useCallback((view: SavedView) => {
    setVisibleColumns(view.columns);
    saveVisibleColumns(view.columns);
    toast({ title: `View "${view.name}" loaded` });
  }, [toast]);
  const deleteView = useCallback((name: string) => {
    const updated = savedViews.filter(v => v.name !== name);
    setSavedViews(updated);
    saveSavedViews(updated);
  }, [savedViews]);
  const visibleColCount = useMemo(() => {
    let count = visibleColumns.length;
    if (isAdmin) count += 2;
    return count;
  }, [visibleColumns, isAdmin]);

  const ganttScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitPct, setSplitPct] = useState(55);
  const isDraggingSplit = useRef(false);

  const handleSplitMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplit.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!isDraggingSplit.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.max(20, Math.min(80, pct)));
    };
    const onUp = () => {
      isDraggingSplit.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const { data: planData, isLoading } = useQuery<{ tasks: any[]; unlinkedOperationalCount: number }>({
    queryKey: ["planning-tasks", projectName],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/planning-tasks/${encodeURIComponent(projectName)}`, { credentials: "include", headers });
      if (!res.ok) {
        const fallback = await fetch(`/api/operational-tasks/${encodeURIComponent(projectName)}`, { credentials: "include", headers });
        if (!fallback.ok) return { tasks: [], unlinkedOperationalCount: 0 };
        const fallbackData = await fallback.json();
        return { tasks: Array.isArray(fallbackData) ? fallbackData : [], unlinkedOperationalCount: 0 };
      }
      const data = await res.json();
      if (Array.isArray(data)) return { tasks: data, unlinkedOperationalCount: 0 };
      return { tasks: data.tasks || [], unlinkedOperationalCount: data.unlinkedOperationalCount || 0 };
    },
  });
  const tasks = planData?.tasks ?? [];
  const unlinkedOperationalCount = planData?.unlinkedOperationalCount ?? 0;

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

  const { data: projectDependencies = [] } = useQuery<DependencyRecord[]>({
    queryKey: ["project-dependencies", projectName],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/dependencies/project-name/${encodeURIComponent(projectName)}`, { credentials: "include", headers });
      if (!res.ok) return [];
      const data = await res.json();
      return data.dependencies || [];
    },
    enabled: !!projectName,
  });

  const addDependencyMutation = useMutation({
    mutationFn: async ({ predecessorId, successorId }: { predecessorId: number; successorId: number }) => {
      await apiRequest("POST", "/api/dependencies", { predecessorId, successorId, depType: "FS", lagDays: 0 });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-dependencies", projectName] });
      toast({ title: "Predecessor added" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add predecessor", description: err?.message || "Could not create dependency", variant: "destructive" });
    },
  });

  const removeDependencyMutation = useMutation({
    mutationFn: async (depId: number) => {
      await apiRequest("DELETE", `/api/dependencies/${depId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-dependencies", projectName] });
      toast({ title: "Predecessor removed" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to remove predecessor", description: err?.message || "Could not delete dependency", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Record<string, unknown> }) => {
      await apiRequest("PATCH", `/api/planning-tasks/${id}`, { projectName, ...updates });
    },
    onSuccess: (_data, variables) => {
      invalidateProjectQueries(qc, projectName);
    invalidateMilestoneCreationQueries((queryKey) => qc.invalidateQueries({ queryKey }), projectName);
      const field = Object.keys(variables.updates)[0];
      if (field === "percentComplete") toast({ title: "Progress updated" });
      else if (field === "startDate" || field === "dueDate") toast({ title: "Date updated" });
    },
    onError: () => {
      toast({ title: "Update failed", description: "Could not save the change", variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (title: string) => {
      await apiRequest("POST", "/api/planning-tasks", { projectName, title, status: "Not Started" });
    },
    onSuccess: () => {
      invalidateProjectQueries(qc, projectName);
      setNewTaskTitle("");
      toast({ title: "Task created" });
    },
    onError: (err: any) => {
      toast({ title: "Create task failed", description: err?.message || "Could not create task", variant: "destructive" });
    },
  });

  const structureMutation = useMutation({
    mutationFn: async ({ operation, data }: { operation: string; data: any }) => {
      await apiRequest("POST", "/api/project-plan/structure", { operation, projectName, data });
    },
    onSuccess: () => {
      invalidateProjectQueries(qc, projectName);
    },
    onError: (err: any) => {
      toast({ title: "Structure change failed", description: err?.message || "Could not update plan structure", variant: "destructive" });
    },
  });

  const renumberMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/project-plan/structure", { operation: "renumberWI", projectName, data: {} });
    },
    onSuccess: () => {
      invalidateProjectQueries(qc, projectName);
      toast({ title: "WBS numbering refreshed" });
    },
    onError: (err: any) => {
      toast({ title: "Refresh WBS failed", description: err?.message || "Could not renumber tasks", variant: "destructive" });
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
        const matchedTasks = tasks.filter(t => baselineIds.includes(t.id));
        const withRowNumber = matchedTasks.filter(t => t.rowNumber != null);
        const withoutRowNumber = matchedTasks.filter(t => t.rowNumber == null);
        if (withRowNumber.length > 0) {
          const byPlanProject = new Map<string, number[]>();
          for (const t of withRowNumber) {
            const pName = (t as any).planProjectName || projectName;
            if (!byPlanProject.has(pName)) byPlanProject.set(pName, []);
            byPlanProject.get(pName)!.push(t.rowNumber);
          }
          for (const [pName, rowNumbers] of Array.from(byPlanProject.entries())) {
            await apiRequest("POST", "/api/project-plan/delete-tasks", { projectName: pName, rowNumbers });
          }
        }
        if (withoutRowNumber.length > 0) {
          const workItemIds = withoutRowNumber.map(t => (t as any).workItemId || Math.abs(t.id));
          await apiRequest("POST", "/api/work-items/delete", { ids: workItemIds });
        }
      }
    },
    onSuccess: (_data, ids) => {
      invalidateProjectQueries(qc, projectName);
      setSelectedIds(new Set());
      toast({ title: `${ids.length} task(s) deleted` });
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err?.message || "Could not delete task(s)", variant: "destructive" });
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
    if (workstreamFilter !== "All") {
      const wsMap: Record<string, string> = { "Project": "PM", "Engineering": "ENG", "Quality": "QUALITY" };
      const targetWs = wsMap[workstreamFilter];
      if (targetWs) {
        result = result.filter(t => {
          const ws = t.workstream || "PM";
          if (targetWs === "PM") return ws === "PM" || ws === "SMART_IMPORT" || !ws;
          return ws === targetWs;
        });
      }
    }
    if (searchText) {
      const lower = searchText.toLowerCase();
      result = result.filter(t => t.title?.toLowerCase().includes(lower) || (t.taskNumber || "").toLowerCase().includes(lower));
    }
    return result;
  }, [tasks, statusFilter, workstreamFilter, searchText]);

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

    let totalProjectDays: number | null = null;
    let elapsedDays: number | null = null;
    let earliestStart: Date | null = null;
    let latestEnd: Date | null = null;
    for (const t of tasks) {
      const s = t.actualStartDate || t.startDate;
      const e = t.actualEndDate || t.dueDate;
      if (s) {
        const sd = new Date(s);
        if (!isNaN(sd.getTime()) && (!earliestStart || sd < earliestStart)) earliestStart = sd;
      }
      if (e) {
        const ed = new Date(e);
        if (!isNaN(ed.getTime()) && (!latestEnd || ed > latestEnd)) latestEnd = ed;
      }
    }
    if (earliestStart && latestEnd) {
      totalProjectDays = countWorkingDays(earliestStart, latestEnd);
      const now = new Date();
      const clamped = now > latestEnd ? latestEnd : now;
      elapsedDays = countWorkingDays(earliestStart, clamped);
    }

    return { total, done, avgPct, avgExpectedPct, totalProjectDays, elapsedDays };
  }, [tasks]);

  const ganttRange = useMemo(() => {
    let minDate: Date | null = null;
    let maxDate: Date | null = null;
    for (const t of tasks) {
      const s = t.actualStartDate || t.startDate;
      const e = t.actualEndDate || t.dueDate;
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

  const milestoneColorMap = useMemo(() => {
    const colorMap = new Map<number, typeof MILESTONE_GROUP_COLORS[0]>();
    const rootIds: number[] = [];
    for (const t of tasks) {
      const isMil = t.isVirtualMilestone || t.isMilestone;
      const hasCh = t.isParent || t.childCount > 0;
      if ((isMil || hasCh) && !t.parentTaskId) {
        rootIds.push(t.id);
      }
    }
    rootIds.forEach((id, idx) => {
      colorMap.set(id, MILESTONE_GROUP_COLORS[idx % MILESTONE_GROUP_COLORS.length]);
    });
    return colorMap;
  }, [tasks]);

  const summaryRollup = useMemo(() => {
    const rollup = new Map<number, { pct: number; start: string | null; finish: string | null; duration: number }>();
    const childrenOf = new Map<number, any[]>();
    for (const t of tasks) {
      if (t.parentTaskId) {
        if (!childrenOf.has(t.parentTaskId)) childrenOf.set(t.parentTaskId, []);
        childrenOf.get(t.parentTaskId)!.push(t);
      }
    }
    for (const t of tasks) {
      const hasChildren = t.isParent || t.childCount > 0;
      if (!hasChildren) continue;
      const children = childrenOf.get(t.id) || [];
      if (children.length === 0) continue;

      let minStart: string | null = null;
      let maxFinish: string | null = null;
      let totalWeightedPct = 0;
      let totalWeight = 0;
      let totalDuration = 0;

      for (const c of children) {
        const cs = c.actualStartDate || c.startDate;
        const ce = c.actualEndDate || c.dueDate;
        if (cs && (!minStart || cs < minStart)) minStart = cs;
        if (ce && (!maxFinish || ce > maxFinish)) maxFinish = ce;
        const cDur = (() => {
          if (cs && ce) {
            const sd = new Date(cs);
            const ed = new Date(ce);
            if (!isNaN(sd.getTime()) && !isNaN(ed.getTime())) return countWorkingDays(sd, ed);
          }
          return c.plannedDurationDays || c.durationDays || 1;
        })();
        totalDuration += cDur;
        const weight = cDur || 1;
        totalWeightedPct += (c.percentComplete || 0) * weight;
        totalWeight += weight;
      }

      rollup.set(t.id, {
        pct: totalWeight > 0 ? Math.round(totalWeightedPct / totalWeight) : 0,
        start: minStart,
        finish: maxFinish,
        duration: totalDuration,
      });
    }
    return rollup;
  }, [tasks]);

  const getGroupColor = useCallback((task: any): typeof MILESTONE_GROUP_COLORS[0] | null => {
    const rootId = getRootParentId(task, taskMap);
    return milestoneColorMap.get(rootId) || null;
  }, [taskMap, milestoneColorMap]);

  const dayWidth = zoomLevel === "week" ? 28 : 8;
  const totalDays = differenceInDays(ganttRange.end, ganttRange.start);
  const ganttTotalWidth = totalDays * dayWidth;

  const today = startOfDay(new Date());
  const todayOffset = differenceInDays(today, ganttRange.start) * dayWidth;

  const getBarStyle = useCallback((task: any) => {
    const s = task.actualStartDate || task.startDate;
    const e = task.actualEndDate || task.dueDate;
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

  const handleCreateMilestone = async () => {
    setIsCreatingMilestone(true);
    const result = await createMilestoneFlow({
      title: milestoneTitle,
      projectName,
      request: apiRequest,
    });
    setIsCreatingMilestone(false);

    if (!result.ok) {
      toast({
        title: result.kind === "validation" ? "Validation error" : "Create milestone failed",
        description: result.message,
        variant: result.kind === "validation" ? "default" : "destructive",
      });
      return;
    }

    invalidateProjectQueries(qc, projectName);
    invalidateMilestoneCreationQueries((queryKey) => qc.invalidateQueries({ queryKey }), projectName);
    toast({ title: "Milestone created" });
    setMilestoneDialogOpen(false);
    setMilestoneTitle("");
  };

  const setTaskNumberMutation = useMutation({
    mutationFn: async ({ rowNumber, taskNumber }: { rowNumber: number; taskNumber: string }) => {
      await apiRequest("POST", "/api/project-plan/structure", {
        operation: "setTaskNumber", projectName, data: { rowNumber, taskNumber },
      });
    },
    onSuccess: () => {
      invalidateProjectQueries(qc, projectName);
      toast({ title: "Task number updated" });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err?.message || "Could not update task number", variant: "destructive" });
    },
  });

  const convertToMilestoneMutation = useMutation({
    mutationFn: async ({ workItemId, subtaskWorkItemIds }: { workItemId: number; subtaskWorkItemIds: number[] }) => {
      await apiRequest("POST", "/api/project-plan/structure", {
        operation: "convertToMilestoneWI", projectName,
        data: { workItemId, subtaskWorkItemIds },
      });
      await apiRequest("POST", "/api/project-plan/structure", {
        operation: "renumberWI", projectName, data: {},
      });
    },
    onSuccess: () => {
      invalidateProjectQueries(qc, projectName);
      toast({ title: "Converted to milestone" });
      setConvertMilestoneDialogOpen(false);
      setConvertMilestoneTask(null);
    },
    onError: (err: any) => {
      toast({ title: "Convert to milestone failed", description: err?.message || "Could not convert task", variant: "destructive" });
    },
  });

  const convertToTaskMutation = useMutation({
    mutationFn: async (workItemId: number) => {
      await apiRequest("POST", "/api/project-plan/structure", {
        operation: "convertToTaskWI", projectName,
        data: { workItemId },
      });
    },
    onSuccess: () => {
      invalidateProjectQueries(qc, projectName);
      toast({ title: "Converted to regular task" });
    },
    onError: (err: any) => {
      toast({ title: "Convert failed", description: err?.message || "Could not convert milestone", variant: "destructive" });
    },
  });

  const setParentMutation = useMutation({
    mutationFn: async ({ workItemIds, parentWorkItemId }: { workItemIds: number[]; parentWorkItemId: number }) => {
      await apiRequest("POST", "/api/project-plan/structure", {
        operation: "setParentWI", projectName,
        data: { workItemIds, parentWorkItemId },
      });
      await apiRequest("POST", "/api/project-plan/structure", {
        operation: "renumberWI", projectName, data: {},
      });
    },
    onSuccess: () => {
      invalidateProjectQueries(qc, projectName);
      toast({ title: "Tasks grouped & WBS renumbered" });
      setGroupUnderDialogOpen(false);
      setGroupUnderTask(null);
    },
    onError: (err: any) => {
      toast({ title: "Group tasks failed", description: err?.message || "Could not group tasks under parent", variant: "destructive" });
    },
  });

  const removeMilestoneMutation = useMutation({
    mutationFn: async (workItemIds: number[]) => {
      await apiRequest("POST", "/api/project-plan/structure", {
        operation: "removeParentWI", projectName,
        data: { workItemIds },
      });
      await apiRequest("POST", "/api/project-plan/structure", {
        operation: "renumberWI", projectName, data: {},
      });
    },
    onSuccess: () => {
      invalidateProjectQueries(qc, projectName);
      toast({ title: "Task ungrouped & WBS renumbered" });
    },
    onError: (err: any) => {
      toast({ title: "Ungroup failed", description: err?.message || "Could not remove from group", variant: "destructive" });
    },
  });

  const bulkReorderMutation = useMutation({
    mutationFn: async (items: Array<{ workItemId: number; sortOrder: number }>) => {
      await apiRequest("POST", "/api/project-plan/structure", {
        operation: "reorderWI", projectName, data: { items },
      });
      await apiRequest("POST", "/api/project-plan/structure", {
        operation: "renumberWI", projectName, data: {},
      });
    },
    onSuccess: () => {
      invalidateProjectQueries(qc, projectName);
      toast({ title: "Tasks reordered" });
    },
    onError: (err: any) => {
      toast({ title: "Reorder failed", description: err?.message || "Could not reorder tasks", variant: "destructive" });
    },
  });

  const handleDragStart = (e: React.DragEvent, task: any) => {
    if (!isAdmin) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(task.id));
    setDragTaskId(task.id);
  };

  const handleDragOver = (e: React.DragEvent, task: any) => {
    if (!isAdmin || dragTaskId === null || dragTaskId === task.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;
    if (y < height * 0.25) {
      setDropTarget({ taskId: task.id, position: "above" });
    } else if (y > height * 0.75) {
      setDropTarget({ taskId: task.id, position: "below" });
    } else {
      setDropTarget({ taskId: task.id, position: "child" });
    }
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = (e: React.DragEvent, targetTask: any) => {
    e.preventDefault();
    if (!isAdmin || dragTaskId === null || !dropTarget) {
      setDragTaskId(null);
      setDropTarget(null);
      return;
    }
    const draggedTask = taskMap.get(dragTaskId);
    if (!draggedTask || !targetTask) {
      setDragTaskId(null);
      setDropTarget(null);
      return;
    }
    const dragWiId = draggedTask.workItemId;
    const targetWiId = targetTask.workItemId;
    if (!dragWiId || !targetWiId) {
      toast({ title: "Cannot reorder", description: "This task is missing its work item reference.", variant: "destructive" });
      setDragTaskId(null);
      setDropTarget(null);
      return;
    }
    if (dragWiId === targetWiId) {
      setDragTaskId(null);
      setDropTarget(null);
      return;
    }

    if (dropTarget.position === "child") {
      setParentMutation.mutate({
        workItemIds: [dragWiId],
        parentWorkItemId: targetWiId,
      });
    } else {
      const items: Array<{ workItemId: number; sortOrder: number }> = [];

      const allSiblings = tasks.filter(t => {
        return t.parentTaskId === targetTask.parentTaskId && t.id !== dragTaskId && t.workItemId != null;
      }).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

      const insertIdx = dropTarget.position === "above"
        ? allSiblings.findIndex(t => t.id === targetTask.id)
        : allSiblings.findIndex(t => t.id === targetTask.id) + 1;

      const reordered = [...allSiblings];
      reordered.splice(Math.max(0, insertIdx), 0, draggedTask);

      for (let i = 0; i < reordered.length; i++) {
        if (reordered[i].workItemId) {
          items.push({ workItemId: reordered[i].workItemId, sortOrder: (i + 1) * 10 });
        }
      }

      if (items.length > 0) bulkReorderMutation.mutate(items);
    }

    setDragTaskId(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDragTaskId(null);
    setDropTarget(null);
  };

  const getDropIndicatorClass = (taskId: number) => {
    if (!dropTarget || dropTarget.taskId !== taskId) return "";
    if (dropTarget.position === "above") return "border-t-2 border-t-emerald-500";
    if (dropTarget.position === "below") return "border-b-2 border-b-emerald-500";
    return "bg-emerald-50 ring-1 ring-emerald-400 ring-inset";
  };

  const getChildTasks = (parentId: number) => {
    return tasks.filter(t => t.parentTaskId === parentId);
  };

  const parentCandidates = useMemo(() => {
    return tasks.filter(t => {
      const isMilestone = t.isVirtualMilestone || t.isMilestone;
      const hasChildren = t.isParent || t.childCount > 0;
      return isMilestone || hasChildren || t.indentLevel === 0;
    });
  }, [tasks]);

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
      <div className="flex items-center gap-3 flex-wrap overflow-x-auto scrollbar-hide" data-testid="plan-kpi-bar">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted border">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Total</span>
          <span className="text-sm font-bold tabular-nums" data-testid="kpi-total">{kpis.total}</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-50 border border-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          <span className="text-xs text-muted-foreground">Done</span>
          <span className="text-sm font-bold tabular-nums text-emerald-700" data-testid="kpi-done">{kpis.done}</span>
        </div>
        {kpis.totalProjectDays !== null && kpis.elapsedDays !== null && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-50 border border-violet-200">
            <Calendar className="h-3.5 w-3.5 text-violet-500" />
            <span className="text-xs text-muted-foreground">Day</span>
            <span className="text-sm font-bold tabular-nums text-violet-700" data-testid="kpi-elapsed-days">{kpis.elapsedDays}</span>
            <span className="text-xs text-muted-foreground">of</span>
            <span className="text-sm font-bold tabular-nums text-violet-700" data-testid="kpi-total-days">{kpis.totalProjectDays}</span>
          </div>
        )}
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
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border ${kpis.avgPct < kpis.avgExpectedPct ? "bg-amber-50 border-amber-200" : "bg-muted"}`}>
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
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

      <div className="flex items-center gap-2 flex-wrap overflow-x-auto scrollbar-hide" data-testid="plan-toolbar">
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
        <SearchableSelect
          value={statusFilter}
          onValueChange={setStatusFilter}
          placeholder="All Statuses"
          triggerClassName="w-[130px] h-7 text-xs"
          data-testid="select-status-filter"
          options={[
            { value: "All", label: "All Statuses" },
            ...STATUSES.map(s => ({ value: s, label: s })),
          ]}
        />
        <SearchableSelect
          value={workstreamFilter}
          onValueChange={setWorkstreamFilter}
          placeholder="All Workstreams"
          triggerClassName="w-[140px] h-7 text-xs"
          data-testid="select-workstream-filter"
          options={[
            { value: "All", label: "All Workstreams" },
            { value: "Project", label: "Project" },
            { value: "Engineering", label: "Engineering" },
            { value: "Quality", label: "Quality" },
          ]}
        />

        <div className="flex items-center border rounded-md overflow-hidden bg-card shadow-sm" data-testid="toolbar-actions">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="h-7 px-2 text-xs border-r hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  disabled={!isAdmin}
                  onClick={() => { if (!createMutation.isPending) { if (newTaskTitle.trim()) createMutation.mutate(newTaskTitle.trim()); else { setNewTaskTitle("New Task"); createMutation.mutate("New Task"); } } }}
                  data-testid="toolbar-add-task"
                >
                  <Plus className="h-3.5 w-3.5 text-emerald-600" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">Add Task</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="h-7 px-2 text-xs border-r hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  disabled={!isAdmin}
                  onClick={() => setMilestoneDialogOpen(true)}
                  data-testid="button-create-milestone"
                >
                  <Diamond className="h-3.5 w-3.5 text-amber-600" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">Add Milestone</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="h-7 px-2 text-xs border-r hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  disabled={!isAdmin || selectedIds.size === 0}
                  onClick={() => {
                    const selArr = Array.from(selectedIds);
                    const selTasks = selArr.map(id => taskMap.get(id)).filter(Boolean);
                    if (selTasks.length === 0) return;
                    const firstSel = selTasks[0];
                    const idx = visibleTasks.findIndex(t => t.id === firstSel.id);
                    if (idx <= 0) return;
                    const above = visibleTasks[idx - 1];
                    const parentWiId = above?.workItemId;
                    if (!parentWiId) return;
                    const wiIds = selTasks.map((t: any) => t.workItemId).filter(Boolean);
                    if (wiIds.length > 0) setParentMutation.mutate({ workItemIds: wiIds, parentWorkItemId: parentWiId });
                  }}
                  data-testid="toolbar-indent"
                >
                  <ArrowRight className="h-3.5 w-3.5 text-blue-600" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">Indent</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="h-7 px-2 text-xs border-r hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  disabled={!isAdmin || selectedIds.size === 0}
                  onClick={() => {
                    const selArr = Array.from(selectedIds);
                    const selTasks = selArr.map(id => taskMap.get(id)).filter(Boolean);
                    const wiIds = selTasks.filter((t: any) => t.parentTaskId && t.workItemId).map((t: any) => t.workItemId);
                    if (wiIds.length > 0) removeMilestoneMutation.mutate(wiIds);
                  }}
                  data-testid="toolbar-outdent"
                >
                  <ChevronLeft className="h-3.5 w-3.5 text-blue-600" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">Outdent</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="h-7 px-2 text-xs border-r hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  disabled={!isAdmin || selectedIds.size !== 1}
                  onClick={() => {
                    const selId = Array.from(selectedIds)[0];
                    const idx = visibleTasks.findIndex(t => t.id === selId);
                    if (idx <= 0) return;
                    const task = visibleTasks[idx];
                    const above = visibleTasks[idx - 1];
                    if (!task?.workItemId || !above?.workItemId) return;
                    bulkReorderMutation.mutate([
                      { workItemId: task.workItemId, sortOrder: (above.sortOrder ?? 0) - 1 },
                    ]);
                  }}
                  data-testid="toolbar-move-up"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">Move Up</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="h-7 px-2 text-xs border-r hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  disabled={!isAdmin || selectedIds.size !== 1}
                  onClick={() => {
                    const selId = Array.from(selectedIds)[0];
                    const idx = visibleTasks.findIndex(t => t.id === selId);
                    if (idx < 0 || idx >= visibleTasks.length - 1) return;
                    const task = visibleTasks[idx];
                    const below = visibleTasks[idx + 1];
                    if (!task?.workItemId || !below?.workItemId) return;
                    bulkReorderMutation.mutate([
                      { workItemId: task.workItemId, sortOrder: (below.sortOrder ?? 0) + 1 },
                    ]);
                  }}
                  data-testid="toolbar-move-down"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">Move Down</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="h-7 px-2 text-xs border-r hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 text-red-600"
                  disabled={!isAdmin || selectedIds.size === 0}
                  onClick={() => deleteMutation.mutate(Array.from(selectedIds))}
                  data-testid="toolbar-delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">Delete</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="h-7 px-2 text-xs hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  disabled={!isAdmin || renumberMutation.isPending}
                  onClick={() => renumberMutation.mutate()}
                  data-testid="button-renumber"
                >
                  <Hash className="h-3.5 w-3.5 text-violet-600" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">Renumber WBS</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Popover open={columnPickerOpen} onOpenChange={setColumnPickerOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid="button-column-chooser">
                <Columns3 className="h-3 w-3" />
                Columns
                {visibleColumns.length < ALL_COLUMNS.length && (
                  <Badge variant="secondary" className="h-4 px-1 text-[9px] ml-0.5">{visibleColumns.length}/{ALL_COLUMNS.length}</Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[260px] p-0" data-testid="column-chooser-popover">
              <div className="p-3 border-b">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold">Show/Hide Columns</span>
                  <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]" onClick={resetColumns} data-testid="button-reset-columns">
                    <RotateCcw className="h-2.5 w-2.5 mr-1" /> Reset
                  </Button>
                </div>
                <div className="space-y-1">
                  {ALL_COLUMNS.map(col => (
                    <label
                      key={col.id}
                      className={`flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer hover:bg-muted ${col.alwaysVisible ? "opacity-50 cursor-not-allowed" : ""}`}
                      data-testid={`column-toggle-${col.id}`}
                    >
                      <Checkbox
                        checked={isColumnVisible(col.id)}
                        onCheckedChange={() => toggleColumn(col.id)}
                        disabled={col.alwaysVisible}
                        className="h-3 w-3"
                      />
                      <span>{col.label}</span>
                      {isColumnVisible(col.id) ? (
                        <Eye className="h-3 w-3 text-emerald-500 ml-auto" />
                      ) : (
                        <EyeOff className="h-3 w-3 text-slate-400 ml-auto" />
                      )}
                    </label>
                  ))}
                </div>
              </div>
              <div className="p-3 border-b">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Save View</span>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Input
                    placeholder="View name..."
                    value={newViewName}
                    onChange={(e) => setNewViewName(e.target.value)}
                    className="h-6 text-xs flex-1"
                    onKeyDown={(e) => { if (e.key === "Enter" && newViewName.trim()) saveCurrentView(newViewName); }}
                    data-testid="input-view-name"
                  />
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    disabled={!newViewName.trim()}
                    onClick={() => saveCurrentView(newViewName)}
                    data-testid="button-save-view"
                  >
                    <Save className="h-2.5 w-2.5 mr-1" /> Save
                  </Button>
                </div>
              </div>
              {savedViews.length > 0 && (
                <div className="p-3">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Saved Views</span>
                  <div className="space-y-1 mt-1.5">
                    {savedViews.map(view => (
                      <div key={view.name} className="flex items-center gap-1 group" data-testid={`saved-view-${view.name}`}>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs flex-1 justify-start px-2"
                          onClick={() => loadView(view)}
                          data-testid={`button-load-view-${view.name}`}
                        >
                          {view.name}
                          <span className="text-[9px] text-muted-foreground ml-auto">{view.columns.length} cols</span>
                        </Button>
                        <button
                          className="h-5 w-5 rounded hover:bg-red-100 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => deleteView(view.name)}
                          data-testid={`button-delete-view-${view.name}`}
                        >
                          <X className="h-2.5 w-2.5 text-red-500" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </PopoverContent>
          </Popover>
          <SearchableSelect
            value={zoomLevel}
            onValueChange={(v) => setZoomLevel(v as ZoomLevel)}
            triggerClassName="w-[90px] h-7 text-xs"
            data-testid="select-zoom"
            options={[
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
          />
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
                kd.mappingValid ? "bg-card border-emerald-200" : "bg-muted border-border"
              }`}
              data-testid={`key-date-${kd.keyDateName.replace(/\s+/g, '-').toLowerCase()}`}
            >
              {kd.mappingValid ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
              ) : (
                <AlertCircle className="h-3 w-3 text-slate-500 shrink-0" />
              )}
              <span className="font-medium text-[11px]">{kd.keyDateName}</span>
              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />
              <span className={`text-[11px] tabular-nums ${kd.mappingValid ? "text-foreground" : "text-slate-500"}`}>
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

      {unlinkedOperationalCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-50 border border-blue-200 text-xs text-blue-700" data-testid="unlinked-ops-banner">
          <Info className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{unlinkedOperationalCount} operational task{unlinkedOperationalCount !== 1 ? "s" : ""} not linked to the project plan — view in My Tasks</span>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .plan-grid-table { border-collapse: collapse; }
        .plan-grid-table tbody tr { height: ${ROW_HEIGHT}px; }
        .plan-grid-table tbody td {
          height: ${ROW_HEIGHT}px;
          max-height: ${ROW_HEIGHT}px;
          overflow: hidden;
          box-sizing: border-box;
          vertical-align: middle;
          padding-top: 0;
          padding-bottom: 0;
        }
        .plan-grid-table thead tr { height: 28px; }
        .plan-grid-table thead th {
          height: 28px;
          max-height: 28px;
          overflow: hidden;
          box-sizing: border-box;
          vertical-align: middle;
          padding-top: 0;
          padding-bottom: 0;
        }
        @media (max-width: 640px) {
          .plan-grid-table { font-size: 10px; }
          .plan-grid-table tbody td,
          .plan-grid-table thead th {
            padding-left: 2px;
            padding-right: 2px;
          }
          .plan-grid-left-panel { width: 100% !important; }
          .plan-grid-gantt-panel { display: none !important; }
          .plan-grid-split-handle { display: none !important; }
        }
      `}} />
      <div ref={containerRef} className="flex border rounded-md overflow-hidden bg-card" style={{ height: "calc(100vh - 320px)", minHeight: "400px" }} data-testid="plan-grid-container">
        <div
          ref={bodyScrollRef}
          className="plan-grid-left-panel flex-shrink-0 overflow-y-auto overflow-x-auto"
          style={{ width: `${splitPct}%` }}
          onScroll={handleBodyScroll}
          data-testid="plan-grid-left"
        >
          <table className="plan-grid-table text-[11px] border-collapse" style={{ tableLayout: "auto", minWidth: "100%" }}>
            <thead className="sticky top-0 z-20 bg-muted">
              <tr style={{ height: 28, maxHeight: 28 }}>
                {isAdmin && <th className="w-5 px-0 py-0 border-b border-r overflow-hidden" style={{ height: 28 }} />}
                <th className="w-7 px-1 py-0 text-center border-b border-r font-semibold text-muted-foreground overflow-hidden" style={{ height: 28 }}>
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
                {isColumnVisible("rowNum") && <th className="w-8 px-1 py-0 text-center border-b border-r font-semibold text-muted-foreground overflow-hidden" style={{ height: 28 }} data-testid="header-row-num">#</th>}
                {isColumnVisible("indicator") && <th className="w-6 px-0 py-0 text-center border-b border-r font-semibold text-muted-foreground overflow-hidden" style={{ height: 28 }} data-testid="header-indicator"></th>}
                {isColumnVisible("wbs") && <th className="w-12 px-1 py-0 text-center border-b border-r font-semibold text-muted-foreground overflow-hidden" style={{ height: 28 }} data-testid="header-wbs">WBS</th>}
                {isColumnVisible("taskName") && <th className="px-2 py-0 text-left border-b border-r font-semibold text-muted-foreground overflow-hidden" style={{ height: 28, minWidth: 140 }} data-testid="header-task">Task Name</th>}
                {isColumnVisible("duration") && <th className="w-14 px-1 py-0 text-center border-b border-r font-semibold text-muted-foreground overflow-hidden" style={{ height: 28 }} data-testid="header-duration">Duration</th>}
                {isColumnVisible("start") && <th className="w-[68px] px-1 py-0 text-center border-b border-r font-semibold text-muted-foreground overflow-hidden" style={{ height: 28 }} data-testid="header-start">Start</th>}
                {isColumnVisible("finish") && <th className="w-[68px] px-1 py-0 text-center border-b border-r font-semibold text-muted-foreground overflow-hidden" style={{ height: 28 }} data-testid="header-end">Finish</th>}
                {isColumnVisible("predecessors") && <th className="w-[60px] px-1 py-0 text-center border-b border-r font-semibold text-muted-foreground overflow-hidden" style={{ height: 28 }} data-testid="header-predecessors">Pred.</th>}
                {isColumnVisible("resource") && <th className="w-[70px] px-1 py-0 text-center border-b border-r font-semibold text-muted-foreground overflow-hidden" style={{ height: 28 }} data-testid="header-lead">Resource</th>}
                {isColumnVisible("workstream") && <th className="w-[80px] px-1 py-0 text-center border-b border-r font-semibold text-muted-foreground overflow-hidden" style={{ height: 28 }} data-testid="header-workstream">Workstream</th>}
                {isColumnVisible("pctComplete") && <th className="w-[90px] px-1 py-0 text-center border-b border-r font-semibold text-muted-foreground overflow-hidden" style={{ height: 28 }} data-testid="header-pct-done">% Complete</th>}
                {isColumnVisible("expectedPct") && <th className="w-[70px] px-1 py-0 text-center border-b border-r font-semibold text-muted-foreground overflow-hidden" style={{ height: 28 }} data-testid="header-expected-pct">Expected %</th>}
                {isColumnVisible("status") && <th className="w-10 px-1 py-0 text-center border-b border-r font-semibold text-muted-foreground overflow-hidden" style={{ height: 28 }} data-testid="header-status">Status</th>}
                {isAdmin && <th className="w-7 px-0 py-0 border-b font-semibold text-muted-foreground overflow-hidden" style={{ height: 28 }} />}
              </tr>
            </thead>
            <tbody>
              {visibleTasks.length === 0 ? (
                <tr>
                  <td colSpan={visibleColCount + 1} className="text-center text-muted-foreground py-12">
                    <div className="flex flex-col items-center gap-2">
                      <Circle className="h-8 w-8 text-slate-600" />
                      <span className="text-emerald-600 font-medium">No tasks found</span>
                      <span className="text-[10px]">Create your first delivery task to start planning.</span>
                      {isAdmin ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            if (createMutation.isPending) return;
                            const title = newTaskTitle.trim() || "New Task";
                            setNewTaskTitle(title);
                            createMutation.mutate(title);
                          }}
                          data-testid="button-empty-add-task"
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" /> Add Task
                        </Button>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">Ask a project admin to add a task.</span>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                visibleTasks.map((task, rowIndex) => {
                  const depth = getTaskDepth(task, taskMap);
                  const isMilestone = task.isVirtualMilestone || task.isMilestone;
                  const hasChildren = task.isParent || task.childCount > 0;
                  const isCollapsed = collapsedParents.has(task.id);
                  const rollup = hasChildren ? summaryRollup.get(task.id) : null;
                  const pct = rollup ? rollup.pct : (task.percentComplete || 0);
                  const expPct = task.computedExpectedPct ?? task.expectedPercentComplete ?? null;
                  const isLate = expPct !== null && pct < expPct && pct < 100;
                  const isDragging = dragTaskId === task.id;
                  const dropClass = getDropIndicatorClass(task.id);

                  const taskStart = rollup?.start || task.actualStartDate || task.startDate || null;
                  const taskFinish = rollup?.finish || task.actualEndDate || task.dueDate || null;
                  const taskDuration = (() => {
                    if (rollup) return rollup.duration;
                    const s = task.actualStartDate || task.startDate;
                    const e = task.actualEndDate || task.dueDate;
                    if (s && e) {
                      const sd = new Date(s);
                      const ed = new Date(e);
                      if (!isNaN(sd.getTime()) && !isNaN(ed.getTime())) return countWorkingDays(sd, ed);
                    }
                    return task.plannedDurationDays || task.durationDays || 0;
                  })();

                  const ragStatus = (() => {
                    if (task.status === "Done" || pct >= 100) return "green";
                    if (expPct === null) return pct > 0 ? "green" : "neutral";
                    const delta = expPct - pct;
                    if (delta <= 5) return "green";
                    if (delta <= 20) return "amber";
                    return "red";
                  })();

                  const ragDot = ragStatus === "green"
                    ? "bg-emerald-500"
                    : ragStatus === "amber"
                      ? "bg-amber-500"
                      : ragStatus === "red"
                        ? "bg-red-500"
                        : "bg-slate-300";

                  const ragTooltip = expPct !== null
                    ? `Expected: ${expPct}% | Actual: ${pct}%${isLate ? ' (Behind schedule)' : ''}`
                    : `${pct}% complete`;

                  return (
                    <tr
                      key={task.id}
                      className={`
                        border-b transition-colors cursor-pointer
                        ${hasChildren && !isMilestone ? "bg-muted font-semibold" : ""}
                        ${isMilestone ? "bg-amber-50/60 font-semibold" : ""}
                        ${!hasChildren && !isMilestone ? "hover:bg-blue-50/30" : ""}
                        ${selectedIds.has(task.id) ? "!bg-blue-100/50" : ""}
                        ${isLate && !isMilestone && !hasChildren ? "border-l-2 border-l-red-400" : ""}
                        ${isDragging ? "opacity-40" : ""}
                        ${dropClass}
                      `}
                      style={{ height: ROW_HEIGHT, maxHeight: ROW_HEIGHT, overflow: "hidden" }}
                      onClick={() => onTaskClick?.(task.id, task.assignmentRole)}
                      draggable={isAdmin}
                      onDragStart={(e) => handleDragStart(e, task)}
                      onDragOver={(e) => handleDragOver(e, task)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, task)}
                      onDragEnd={handleDragEnd}
                      data-testid={`plan-row-${task.id}`}
                    >
                      {isAdmin && (
                        <td className="px-0 text-center border-r cursor-grab active:cursor-grabbing" onClick={(e) => e.stopPropagation()} data-testid={`drag-handle-${task.id}`}>
                          <GripVertical className="h-3 w-3 text-slate-600 mx-auto" />
                        </td>
                      )}
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
                      {isColumnVisible("rowNum") && (
                      <td className="px-1 text-center border-r text-[10px] tabular-nums text-slate-500" data-testid={`row-num-${task.id}`}>
                        {rowIndex + 1}
                      </td>
                      )}
                      {isColumnVisible("indicator") && (
                      <td className="px-0 text-center border-r" data-testid={`indicator-${task.id}`}>
                        {isMilestone ? (
                          <span className="text-amber-600 text-[11px]" title="Milestone">◆</span>
                        ) : hasChildren ? (
                          <FolderOpen className="h-3 w-3 text-blue-500 mx-auto" />
                        ) : (
                          <span className="text-slate-500 text-[10px]" title="Task">▬</span>
                        )}
                      </td>
                      )}
                      {isColumnVisible("wbs") && (
                      <td className="px-1 text-center border-r text-[10px] tabular-nums text-muted-foreground" data-testid={`wbs-${task.id}`}>
                        {isAdmin && task.rowNumber ? (
                          <InlineWbsEditor
                            value={task.taskNumber || ""}
                            onCommit={(v) => setTaskNumberMutation.mutate({ rowNumber: task.rowNumber, taskNumber: v })}
                          />
                        ) : (
                          task.taskNumber || ""
                        )}
                      </td>
                      )}
                      {isColumnVisible("taskName") && (
                      <td className="px-2 border-r" style={{ minWidth: 140 }} data-testid={`task-name-${task.id}`}>
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
                          {isMilestone && !hasChildren && <Diamond className="h-3 w-3 text-amber-500 flex-shrink-0" />}
                          <span className={`truncate ${isMilestone ? "font-medium text-amber-800" : hasChildren ? "text-foreground" : ""}`} title={task.title}>
                            {task.title}
                          </span>
                          {task.assignmentRole === "VIEWER" && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 px-1 py-0 rounded text-[8px] font-medium border bg-sky-50 border-sky-200 text-sky-700 ml-1" data-testid={`badge-viewing-${task.id}`}>
                              <Eye className="h-2 w-2" />Viewing
                            </span>
                          )}
                        </div>
                      </td>
                      )}
                      {isColumnVisible("duration") && (
                      <td className="px-1 text-center border-r text-[10px] tabular-nums" onClick={(e) => e.stopPropagation()} data-testid={`duration-${task.id}`}>
                        {hasChildren ? (
                          <span className="text-slate-500">{taskDuration > 0 ? `${taskDuration}d` : "—"}</span>
                        ) : (
                          <InlineDurationEditor
                            value={taskDuration}
                            onCommit={(v) => updateMutation.mutate({ id: task.id, updates: { duration: v } })}
                          />
                        )}
                      </td>
                      )}
                      {isColumnVisible("start") && (
                      <td className={`px-1 text-center border-r text-[10px] tabular-nums ${hasChildren ? "text-slate-500" : ""}`} onClick={(e) => e.stopPropagation()} data-testid={`start-${task.id}`}>
                        {hasChildren ? (
                          <span>{formatDateCompact(taskStart)}</span>
                        ) : (
                          <InlineDateEditor
                            value={taskStart}
                            onCommit={(v) => updateMutation.mutate({ id: task.id, updates: { startDate: v } })}
                          />
                        )}
                      </td>
                      )}
                      {isColumnVisible("finish") && (
                      <td className={`px-1 text-center border-r text-[10px] tabular-nums ${hasChildren ? "text-slate-500" : ""}`} onClick={(e) => e.stopPropagation()} data-testid={`end-${task.id}`}>
                        {hasChildren ? (
                          <span>{formatDateCompact(taskFinish)}</span>
                        ) : (
                          <InlineDateEditor
                            value={taskFinish}
                            onCommit={(v) => updateMutation.mutate({ id: task.id, updates: { dueDate: v } })}
                          />
                        )}
                      </td>
                      )}
                      {isColumnVisible("predecessors") && (
                      <td className="px-1 text-center border-r text-[10px] text-slate-500 truncate" onClick={(e) => e.stopPropagation()} data-testid={`predecessors-${task.id}`}>
                        <InlinePredecessorEditor
                          task={task}
                          allTasks={tasks}
                          dependencies={projectDependencies}
                          onAdd={(predWI, succWI) => addDependencyMutation.mutate({ predecessorId: predWI, successorId: succWI })}
                          onRemove={(depId) => removeDependencyMutation.mutate(depId)}
                          isPending={addDependencyMutation.isPending || removeDependencyMutation.isPending}
                        />
                      </td>
                      )}
                      {isColumnVisible("resource") && (
                      <td className="px-1 text-center border-r text-[10px] text-muted-foreground truncate" data-testid={`lead-${task.id}`}>
                        {task.assignees ? (
                          <span className="truncate">{typeof task.assignees === 'string' ? task.assignees.split(',')[0] : '—'}</span>
                        ) : "—"}
                      </td>
                      )}
                      {isColumnVisible("workstream") && (
                      <td className="px-1 text-center border-r" data-testid={`workstream-${task.id}`}>
                        {(() => {
                          const ws = task.workstream || "PM";
                          if (ws === "ENG") return <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-blue-50 text-blue-700 border-blue-200">Engineering</Badge>;
                          if (ws === "QUALITY") return <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-purple-50 text-purple-700 border-purple-200">Quality</Badge>;
                          return <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-emerald-50 text-emerald-700 border-emerald-200">Project</Badge>;
                        })()}
                      </td>
                      )}
                      {isColumnVisible("pctComplete") && (
                      <td className="px-1 border-r" onClick={(e) => e.stopPropagation()} data-testid={`pct-done-${task.id}`}>
                        {hasChildren ? (
                          <div className="flex items-center gap-1.5">
                            <div className="flex-1 h-[5px] rounded-full bg-slate-200 overflow-hidden min-w-[30px]">
                              <div className={`h-full rounded-full transition-all ${pctColor(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                            <span className="text-[10px] tabular-nums text-slate-500 min-w-[24px] text-right">{pct}%</span>
                          </div>
                        ) : (
                          <InlinePctEditor
                            pct={pct}
                            onCommit={(v) => updateMutation.mutate({ id: task.id, updates: { percentComplete: v } })}
                          />
                        )}
                      </td>
                      )}
                      {isColumnVisible("expectedPct") && (
                      <td className="px-1 text-center border-r text-[10px] tabular-nums" data-testid={`expected-pct-${task.id}`}>
                        {expPct !== null ? (
                          <span className={isLate ? "text-red-600 font-semibold" : "text-muted-foreground"}>{expPct}%</span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      )}
                      {isColumnVisible("status") && (
                      <td className="px-1 text-center border-r" data-testid={`status-${task.id}`}>
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className={`w-3 h-3 rounded-full mx-auto ${ragDot}`} />
                            </TooltipTrigger>
                            <TooltipContent side="left"><p className="text-xs">{ragTooltip}</p></TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </td>
                      )}
                      {isAdmin && (
                        <td className="px-0 text-center" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="p-0.5 hover:bg-slate-200 rounded" data-testid={`actions-${task.id}`}>
                                <MoreHorizontal className="h-3 w-3 text-slate-500" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="text-xs min-w-[180px]">
                              {!isMilestone && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setConvertMilestoneTask(task);
                                    setConvertMilestoneDialogOpen(true);
                                  }}
                                  data-testid={`action-convert-milestone-${task.id}`}
                                >
                                  <Milestone className="h-3 w-3 mr-2 text-amber-600" />
                                  Convert to Milestone
                                </DropdownMenuItem>
                              )}
                              {isMilestone && task.workItemId && (
                                <DropdownMenuItem
                                  onClick={() => convertToTaskMutation.mutate(task.workItemId)}
                                  data-testid={`action-convert-task-${task.id}`}
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-2 text-emerald-600" />
                                  Convert to Task
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => {
                                  setGroupUnderTask(task);
                                  setGroupUnderDialogOpen(true);
                                }}
                                data-testid={`action-group-under-${task.id}`}
                              >
                                <ArrowDownToLine className="h-3 w-3 mr-2 text-blue-600" />
                                Move Under Parent...
                              </DropdownMenuItem>
                              {task.parentTaskId && task.workItemId && (
                                <DropdownMenuItem
                                  onClick={() => removeMilestoneMutation.mutate([task.workItemId])}
                                  data-testid={`action-ungroup-${task.id}`}
                                >
                                  <Unlink className="h-3 w-3 mr-2 text-muted-foreground" />
                                  Remove from Group
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-red-600"
                                onClick={() => deleteMutation.mutate([task.id])}
                                data-testid={`action-delete-${task.id}`}
                              >
                                <Trash2 className="h-3 w-3 mr-2" />
                                Delete Task
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div
          className="plan-grid-split-handle flex-shrink-0 w-1.5 bg-border hover:bg-primary/30 cursor-col-resize transition-colors relative group"
          onMouseDown={handleSplitMouseDown}
          data-testid="plan-split-handle"
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
          <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-1 h-8 rounded-full bg-muted-foreground/30 group-hover:bg-primary/50 transition-colors" />
        </div>

        <div
          ref={ganttScrollRef}
          className="plan-grid-gantt-panel flex-1 overflow-auto"
          onScroll={handleGanttScroll}
          data-testid="plan-gantt-right"
        >
          <div style={{ width: ganttTotalWidth, minHeight: "100%" }} className="relative">
            <div className="sticky top-0 z-10 bg-muted border-b flex" style={{ height: 28 }}>
              {weeks.map((weekStart, i) => {
                const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
                const leftPx = differenceInDays(weekStart, ganttRange.start) * dayWidth;
                const widthPx = 7 * dayWidth;
                const weekNum = Math.ceil((differenceInDays(weekStart, new Date(weekStart.getFullYear(), 0, 1)) + 1) / 7);

                return (
                  <div
                    key={i}
                    className="absolute border-r border-border flex items-center justify-center"
                    style={{ left: leftPx, width: widthPx, height: 28 }}
                  >
                    <span className="text-[9px] text-muted-foreground font-medium">
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
                  className="absolute top-7 bottom-0 border-r border-border"
                  style={{ left: leftPx }}
                />
              );
            })}

            <div>
              {visibleTasks.map((task) => {
                const bar = getBarStyle(task);
                const pct = task.percentComplete || 0;
                const isMilestone = task.isVirtualMilestone || task.isMilestone;
                const expPct = task.computedExpectedPct ?? task.expectedPercentComplete ?? null;
                const isLate = expPct !== null && pct < expPct && pct < 100;
                const groupColor = getGroupColor(task);
                const defaultColor = { bg: "bg-slate-200", border: "border-border", fill: "bg-slate-400", light: "" };
                const gc = groupColor || defaultColor;

                return (
                  <div
                    key={task.id}
                    className={`relative border-b ${isMilestone && groupColor ? groupColor.light : isMilestone ? "bg-amber-50/40" : ""}`}
                    style={{ height: ROW_HEIGHT }}
                    data-testid={`gantt-row-${task.id}`}
                  >
                    {bar && isMilestone && (
                      <div
                        className="absolute top-1.5"
                        style={{ left: bar.left + (bar.width / 2) - 6 }}
                        title={`${task.title}${pct >= 100 ? " (Done)" : ""}`}
                        data-testid={`gantt-bar-${task.id}`}
                      >
                        <div className={`w-3 h-3 rotate-45 border ${pct >= 100 ? "bg-emerald-500 border-emerald-600" : "bg-amber-500 border-amber-600"}`} />
                      </div>
                    )}
                    {bar && !isMilestone && (
                      <div
                        className={`absolute top-1 rounded-sm overflow-hidden border ${
                          isLate
                            ? "bg-red-200 border-red-300"
                            : pct >= 100
                              ? "bg-emerald-200 border-emerald-300"
                              : `${gc.bg} ${gc.border}`
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
                                : gc.fill
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
                        <div className={`w-3 h-3 rotate-45 bg-amber-400 border border-amber-600`} />
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
        <div className="flex items-center gap-2 px-2 py-1.5 border rounded-md bg-muted" data-testid="add-task-row">
          <Plus className="h-3.5 w-3.5 text-slate-500" />
          <Input
            placeholder="Add a new task..."
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newTaskTitle.trim() && !createMutation.isPending) createMutation.mutate(newTaskTitle.trim()); }}
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
            onKeyDown={(e) => { if (e.key === "Enter" && !isCreatingMilestone) handleCreateMilestone(); }}
            data-testid="input-milestone-title"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMilestoneDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateMilestone} disabled={isCreatingMilestone}>
              {isCreatingMilestone ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={convertMilestoneDialogOpen} onOpenChange={(open) => { if (!open) { setConvertMilestoneDialogOpen(false); setConvertMilestoneTask(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert to Milestone</DialogTitle>
          </DialogHeader>
          {convertMilestoneTask && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Convert <span className="font-semibold text-foreground">"{convertMilestoneTask.title}"</span> into a milestone heading.
                Select which tasks should become its subtasks:
              </p>
              <div className="max-h-60 overflow-y-auto border rounded-md p-2 space-y-1">
                {tasks
                  .filter(t => t.id !== convertMilestoneTask.id && !t.isVirtualMilestone && !t.isMilestone)
                  .map(t => {
                    const isSelected = selectedIds.has(t.id);
                    return (
                      <label key={t.id} className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer text-xs">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            setSelectedIds(prev => {
                              const next = new Set(prev);
                              if (checked) next.add(t.id);
                              else next.delete(t.id);
                              return next;
                            });
                          }}
                          className="h-3 w-3"
                        />
                        <span className="truncate">{t.taskNumber ? `${t.taskNumber} — ` : ""}{t.title}</span>
                      </label>
                    );
                  })}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {selectedIds.size} task(s) selected as subtasks
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConvertMilestoneDialogOpen(false); setConvertMilestoneTask(null); setSelectedIds(new Set()); }}>Cancel</Button>
            <Button
              onClick={() => {
                const wiId = convertMilestoneTask?.workItemId;
                if (!wiId) {
                  toast({ title: "Cannot convert", description: "This task is missing its work item reference.", variant: "destructive" });
                  return;
                }
                const subtaskWiIds = Array.from(selectedIds)
                  .map(id => taskMap.get(id)?.workItemId)
                  .filter((wid): wid is number => wid !== undefined && wid !== null);
                convertToMilestoneMutation.mutate({
                  workItemId: wiId,
                  subtaskWorkItemIds: subtaskWiIds,
                });
                setSelectedIds(new Set());
              }}
              disabled={convertToMilestoneMutation.isPending}
              data-testid="button-confirm-convert-milestone"
            >
              Convert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={groupUnderDialogOpen} onOpenChange={(open) => { if (!open) { setGroupUnderDialogOpen(false); setGroupUnderTask(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move Under Parent</DialogTitle>
          </DialogHeader>
          {groupUnderTask && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Move <span className="font-semibold text-foreground">"{groupUnderTask.title}"</span> under a milestone or parent task:
              </p>
              <div className="max-h-60 overflow-y-auto border rounded-md p-2 space-y-0.5">
                {tasks
                  .filter(t => t.id !== groupUnderTask.id && t.workItemId != null)
                  .map(t => {
                    const isMil = t.isVirtualMilestone || t.isMilestone;
                    const hasCh = t.isParent || t.childCount > 0;
                    return (
                      <button
                        key={t.id}
                        className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted flex items-center gap-2 ${isMil ? "font-semibold" : ""}`}
                        onClick={() => {
                          if (groupUnderTask.workItemId && t.workItemId) {
                            setParentMutation.mutate({
                              workItemIds: [groupUnderTask.workItemId],
                              parentWorkItemId: t.workItemId,
                            });
                          }
                        }}
                        data-testid={`group-option-${t.id}`}
                      >
                        {isMil ? <Milestone className="h-3 w-3 text-amber-600 flex-shrink-0" /> :
                         hasCh ? <FolderPlus className="h-3 w-3 text-blue-500 flex-shrink-0" /> :
                         <Circle className="h-2.5 w-2.5 text-slate-600 flex-shrink-0" />}
                        <span className="truncate">{t.taskNumber ? `${t.taskNumber} — ` : ""}{t.title}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setGroupUnderDialogOpen(false); setGroupUnderTask(null); }}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
