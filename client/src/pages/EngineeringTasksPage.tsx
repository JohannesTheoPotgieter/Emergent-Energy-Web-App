import { useState, useRef, useCallback, useMemo, useEffect, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HoldReasonDialog } from "@/components/HoldReasonDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import {
  ListTodo,
  Plus,
  Filter,
  Loader2,
  Zap,
  GanttChart,
  Search,
  X,
  Calendar,
  User,
  MessageSquare,
  ChevronDown,
  AlertTriangle,
  Columns3,
  List,
  FolderKanban,
  Timer,
  PauseCircle,
  ChevronsUpDown,
  Check,
  ShieldCheck,
  UserCheck,
  UserCog,
  Edit3,
  Minimize2,
  Maximize2,
  Eye,
  EyeOff,
  Pencil,
  Save,
  RotateCw,
  ArrowRightLeft,
  RefreshCw,
  CornerDownRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  TASK_STATUSES,
  canTransition,
  getTaskStatusBarClass,
  getTaskStatusColumnClass,
  getTaskStatusLabel,
  getVisibleStatusesForView,
  isTaskComplete,
  isTaskCompleteForReporting,
} from "@/lib/task-status";
import { ActionBar } from "@/components/guidance/ActionBar";
import { InlineTip } from "@/components/guidance/InlineTip";
import { MicroWalkthrough, ReplayWalkthrough } from "@/components/guidance/MicroWalkthrough";
import { useRolloutFlag } from "@/hooks/use-rollout-flag";
import type { NextAction, BlockerInfo } from "@/hooks/use-guidance";
import type { Task, TeamMember } from "@/components/tasks/types";
import { formatDateShort, isDueThisWeek, sortTasksForColumn } from "@/lib/task-formatters";
import {
  deriveEngineeringTaskMetrics,
  filterEngineeringTasks,
  type EngineeringDueDateFilter,
  type EngineeringLinkedSourceFilter,
  type EngineeringWorkloadStateFilter,
  useEngineeringTaskFilters,
} from "@/hooks/useEngineeringTaskFilters";
import { getTaskWorkflowBlockReason } from "@/lib/task-workflow-guard";
import { engFetch } from "@/lib/eng-fetch";
import { invalidateEngineeringTicketCaches, engineeringTicketKeys } from "@/lib/task-cache";
import { canonicalizeTaskStatus } from "@/lib/task-status-compat";
import {
  TASK_PRIORITY_VALUES,
  TASK_PRIORITY_LABELS,
  DEFAULT_TASK_PRIORITY,
  normalizeTaskPriority,
  taskPriorityLabel,
  taskPriorityBadgeClass,
  taskPriorityBorderClass,
  taskPrioritySortOrder,
} from "@shared/task-priorities";

// Filter constants + per-user view localStorage helpers were extracted to
// ./engineering/task-filter-config (UI/UX audit X5 module split). Re-exported
// here so the public surface of this module is unchanged.
export {
  PRIORITIES,
  DUE_DATE_FILTER_OPTIONS,
  WORKLOAD_STATE_OPTIONS,
  LINKED_SOURCE_OPTIONS,
  priorityColors,
  priorityBorderColors,
  SAVED_FILTERS,
  getSavedMyName,
  setSavedMyName,
  getEngViewKey,
  getSavedEngDefaultView,
  saveEngDefaultView,
  clearEngDefaultView,
} from "./engineering/task-filter-config";
import {
  PRIORITIES,
  DUE_DATE_FILTER_OPTIONS,
  WORKLOAD_STATE_OPTIONS,
  LINKED_SOURCE_OPTIONS,
  SAVED_FILTERS,
  getSavedMyName,
  setSavedMyName,
  getSavedEngDefaultView,
  saveEngDefaultView,
  clearEngDefaultView,
} from "./engineering/task-filter-config";

// Card/column cluster extracted to ./engineering/engineering-task-cards
// (UI/UX audit module split). Imported for internal use + re-exported so the
// public surface (and ./engineering barrels) is unchanged.
import {
  QuickStatusSelect,
  QuickEditPopover,
  getTaskContextBadges,
  MoveCardMenu,
  TaskCard,
  KanbanColumn,
} from "./engineering/engineering-task-cards";
export {
  QuickStatusSelect,
  QuickEditPopover,
  getTaskContextBadges,
  MoveCardMenu,
  TaskCard,
  KanbanColumn,
} from "./engineering/engineering-task-cards";
// Workload summary strip extracted to ./engineering/engineering-workload-strip.
import { EngineeringWorkloadStrip } from "./engineering/engineering-workload-strip";
export { EngineeringWorkloadStrip } from "./engineering/engineering-workload-strip";



// TaskDetailDrawer is heavy (~89 KB) and only renders when a task is opened,
// so it is lazy-loaded as its own chunk rather than bundled into this page.
// The previous static re-export of PostUpdateForm / TaskDetailDrawer had no
// external consumers and was removed — it pinned the drawer back into this
// chunk and defeated the split.
import { lazyWithRetry } from "@/lib/lazy-with-retry";

const TaskDetailDrawer = lazyWithRetry(() =>
  import("./engineering/EngineeringTaskDrawer").then((m) => ({ default: m.TaskDetailDrawer })),
);


/**
 * DependenciesTab — thin wrapper around TaskDependenciesPanel.
 * Kept as a named export for backward compat with the barrel.
 * @deprecated Use TaskDependenciesPanel directly.
 */
export { TaskDependenciesPanel as DependenciesTab } from "./engineering/panels/TaskDependenciesPanel";


// PHASE_COLORS imported from @/lib/phase-colors

// View components extracted to ./engineering/engineering-task-views
// (UI/UX audit module split). Imported for internal use + re-exported so the
// public surface (and ./engineering barrels) is unchanged.
import {
  ProjectKanbanView,
  PersonalKpiStrip,
  TimelineView,
  InlineListView,
  MyTasksView,
} from "./engineering/engineering-task-views";
export {
  ProjectKanbanView,
  PersonalKpiStrip,
  TimelineView,
  InlineListView,
  MyTasksView,
  type ProjectGroup,
} from "./engineering/engineering-task-views";


export default function EngineeringTasksPage({
  embedded = false,
  lockedProjectId,
  lockedProjectName,
}: {
  /** When true, suppress page-level chrome (hero title, saved-view controls,
   *  walkthroughs, URL sync, keyboard shortcuts) so the board can be embedded. */
  embedded?: boolean;
  /** Pin the board to a single project (by id). Hides the project filter. */
  lockedProjectId?: number;
  /** Project name, used to pre-fill the create-task dialog when locked. */
  lockedProjectName?: string;
} = {}) {
  const { enabled: microWalkthroughEnabled } = useRolloutFlag("micro_walkthrough");
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const savedDefaults = useMemo(() => getSavedEngDefaultView(user?.id), [user?.id]);
  const initialUrlParams = useMemo(() => new URLSearchParams(embedded ? "" : window.location.search), [embedded]);
  const [viewMode, setViewMode] = useState<"board" | "list" | "projects" | "mytasks" | "timeline">(() => {
    if (embedded) return "board";
    const urlView = initialUrlParams.get("view") as any;
    if (urlView && ["board", "list", "projects", "mytasks", "timeline"].includes(urlView)) return urlView;
    return savedDefaults?.viewMode || "board";
  });
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [myName, setMyName] = useState(() => {
    const saved = getSavedMyName();
    if (saved) return saved;
    const fullName = user?.name || "";
    return fullName.split(/\s+/)[0];
  });
  const [showNamePicker, setShowNamePicker] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const openNamePicker = useCallback(() => {
    setNameDraft(myName);
    setShowNamePicker(true);
  }, [myName]);
  const saveMyName = useCallback(() => {
    const next = nameDraft.trim();
    setMyName(next);
    setSavedMyName(next);
    setShowNamePicker(false);
  }, [nameDraft]);
  // Canonicalise the incoming ?status= param so legacy uppercase links from
  // the dashboard, admin-approvals, or external bookmarks ("HOLD",
  // "NEEDS APPROVAL", "IN PROGRESS") resolve to the snake_case values the
  // filter compares against.
  const initialStatusParam = initialUrlParams.get("status");
  const initialStatus = initialStatusParam ? canonicalizeTaskStatus(initialStatusParam) : (savedDefaults?.statusFilter || "all");
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus);
  const [priorityFilter, setPriorityFilter] = useState<string>(initialUrlParams.get("priority") || savedDefaults?.priorityFilter || "all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>(initialUrlParams.get("assignee") || savedDefaults?.assigneeFilter || "all");
  // ?project=<name> comes from admin-approvals / lifecycle-board and should
  // populate the project *filter*, not the free-text search. Fall back to
  // search if the name doesn't look like a real project (preserves old
  // single-param bookmarks).
  const initialProjectParam = initialUrlParams.get("project") || "";
  const [projectFilter, setProjectFilter] = useState<string>(initialProjectParam || savedDefaults?.projectFilter || "all");
  const [dueDateFilter, setDueDateFilter] = useState<EngineeringDueDateFilter>(
    (initialUrlParams.get("dueDate") as EngineeringDueDateFilter) || (savedDefaults?.dueDateFilter as EngineeringDueDateFilter) || "all",
  );
  const [workloadStateFilter, setWorkloadStateFilter] = useState<EngineeringWorkloadStateFilter>(
    (initialUrlParams.get("workloadState") as EngineeringWorkloadStateFilter) ||
      (savedDefaults?.workloadStateFilter as EngineeringWorkloadStateFilter) ||
      "all",
  );
  const [linkedSourceFilter, setLinkedSourceFilter] = useState<EngineeringLinkedSourceFilter>(
    (initialUrlParams.get("linkedSource") as EngineeringLinkedSourceFilter) ||
      (savedDefaults?.linkedSourceFilter as EngineeringLinkedSourceFilter) ||
      "all",
  );
  const [hasCustomDefault, setHasCustomDefault] = useState(!!savedDefaults);
  const [searchTerm, setSearchTerm] = useState(() => initialUrlParams.get("q") || "");

  // Sync key state to URL for shareable links (without full page reload).
  // ?project= carries the project filter (matches admin-approvals / lifecycle-board links);
  // ?q= carries the free-text search, so the two are no longer conflated.
  useEffect(() => {
    if (embedded) return;
    const params = new URLSearchParams();
    if (viewMode !== "board") params.set("view", viewMode);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (priorityFilter !== "all") params.set("priority", priorityFilter);
    if (assigneeFilter !== "all") params.set("assignee", assigneeFilter);
    if (dueDateFilter !== "all") params.set("dueDate", dueDateFilter);
    if (workloadStateFilter !== "all") params.set("workloadState", workloadStateFilter);
    if (linkedSourceFilter !== "all") params.set("linkedSource", linkedSourceFilter);
    if (projectFilter !== "all") params.set("project", projectFilter);
    if (searchTerm) params.set("q", searchTerm);
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    if (url !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", url);
    }
  }, [embedded, viewMode, statusFilter, priorityFilter, assigneeFilter, dueDateFilter, workloadStateFilter, linkedSourceFilter, projectFilter, searchTerm]);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTask, setNewTask] = useState({
    projectId: (lockedProjectId ?? null) as number | null,
    projectName: lockedProjectName ?? "",
    title: "",
    description: "",
    status: "to_do",
    priority: DEFAULT_TASK_PRIORITY,
    phase: "",
    primaryWorkstream: "",
    dueDate: "",
    assignees: [] as string[],
    ownerUserId: null as number | null,
    ownerDisplayName: "",
  });

  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [holdDialog, setHoldDialog] = useState<{ taskId: number; reason: string; blockedType: string } | null>(null);
  const [completionGuard, setCompletionGuard] = useState<{ taskId: number; reason: string } | null>(null);
  const [boardCompact, setBoardCompact] = useState(savedDefaults?.boardCompact || false);
  const [boardGroupBy, setBoardGroupBy] = useState<"status" | "priority" | "assignee" | "project">("status");
  const [collapsedColumns, setCollapsedColumns] = useState<Set<string>>(() => new Set());
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const bulkMode = selectedTaskIds.size > 0;
  // X6: bulk status/priority changes must be confirmed (with an impact
  // preview) before they fan out. Holds the pending change until the user
  // confirms via the shared ConfirmDialog.
  const [pendingBulk, setPendingBulk] = useState<
    | { kind: "status"; taskIds: number[]; value: string; label: string }
    | { kind: "priority"; taskIds: number[]; value: string; label: string }
    | null
  >(null);

  const toggleTaskSelection = useCallback((taskId: number) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedTaskIds(new Set()), []);

  const toggleColumnCollapse = useCallback((status: string) => {
    setCollapsedColumns(prev => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  }, []);

  // Keyboard shortcuts. Numeric view-switch keys require a `g` prefix
  // (GitHub-style chord) so numbers typed idly after a dialog closes don't
  // accidentally switch views.
  const [showShortcuts, setShowShortcuts] = useState(false);
  const goChordArmedRef = useRef<number | null>(null);
  useEffect(() => {
    if (embedded) return;
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Clear a stale chord after 1.5s of inactivity.
      const now = Date.now();
      if (goChordArmedRef.current && now - goChordArmedRef.current > 1500) {
        goChordArmedRef.current = null;
      }

      if (e.key === "?") { setShowShortcuts(s => !s); return; }
      if (e.key === "n") { setCreateOpen(true); return; }
      if (e.key === "Escape") {
        goChordArmedRef.current = null;
        if (selectedTask) { setSelectedTask(null); return; }
        if (showShortcuts) { setShowShortcuts(false); return; }
      }
      if (e.key === "g") { goChordArmedRef.current = now; return; }

      if (goChordArmedRef.current) {
        if (e.key === "1") { setViewMode("board"); goChordArmedRef.current = null; return; }
        if (e.key === "2") { setViewMode("mytasks"); goChordArmedRef.current = null; return; }
        if (e.key === "3") { setViewMode("projects"); goChordArmedRef.current = null; return; }
        if (e.key === "4") { setViewMode("list"); goChordArmedRef.current = null; return; }
        if (e.key === "5") { setViewMode("timeline"); goChordArmedRef.current = null; return; }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [embedded, selectedTask, showShortcuts]);

  const { data: rawTasks = [], isLoading, error, refetch } = useQuery<Task[]>({
    queryKey: engineeringTicketKeys.scope("board"),
    queryFn: () => engFetch("/api/eng/tasks"),
    refetchOnMount: "always",
    staleTime: 10_000,
    refetchInterval: 60_000,
  });
  // When embedded in a single project's Engineering tab, scope the entire board
  // to that project at the source (by projectId) so every column, count, metric
  // and filter is project-local without touching the board's filter machinery.
  const tasks = useMemo(
    () => (lockedProjectId != null ? rawTasks.filter((t) => t.projectId === lockedProjectId) : rawTasks),
    [rawTasks, lockedProjectId],
  );

  const { data: pageTeamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ["team-members"],
    queryFn: () => engFetch("/api/eng/team-members"),
  });

  const EXCLUDED_PHASES = ["Hold", "Done", "Closed", "Gone"];
  const { data: allProjects = [] } = useQuery<{ id: number; project_name: string }[]>({
    queryKey: ["/api/projects-summary"],
    select: (data: any[]) => data.map((p: any) => ({
      id: p.project_info_id || p.id,
      project_name: p.project_name?.replace(/_Tracker.*$/, "").replace(/_/g, " ") || p.projectName || "",
      phase: p.phase || "",
    })).filter((p: any) => p.project_name && !EXCLUDED_PHASES.includes(p.phase)).sort((a: any, b: any) => a.project_name.localeCompare(b.project_name)),
  });

  // If the initial ?project= value doesn't match any known project name once
  // the project list loads, treat it as free-text search (legacy bookmark
  // compatibility). Runs once per load of allProjects.
  useEffect(() => {
    if (!initialProjectParam) return;
    if (projectFilter !== initialProjectParam) return;
    if (allProjects.length === 0) return;
    const matches = allProjects.some(p => p.project_name === initialProjectParam);
    if (!matches) {
      setProjectFilter("all");
      setSearchTerm(prev => prev || initialProjectParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allProjects.length]);

  const myTasks = useMemo(() => {
    if (!myName) return [];
    const nameLower = myName.toLowerCase();
    return tasks.filter(t =>
      ((t.assignees || []).length > 0 ? (t.assignees || []) : (t.resolvedAssignees || []).map((user) => user.name))
        .some((name) => name && name.toLowerCase().startsWith(nameLower))
    );
  }, [tasks, myName]);

  const createMutation = useMutation({
    mutationFn: (task: typeof newTask) => {
      return engFetch("/api/eng/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: task.projectId,
          projectName: task.projectName,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          phase: task.phase,
          primaryWorkstream: task.primaryWorkstream,
          dueDate: task.dueDate,
          ownerUserId: task.ownerUserId,
          assignees: task.assignees,
        }),
      });
    },
    onSuccess: () => {
      invalidateEngineeringTicketCaches(queryClient);
      setCreateOpen(false);
      setNewTask({
        projectId: null,
        projectName: "",
        title: "",
        description: "",
        status: "to_do",
        priority: DEFAULT_TASK_PRIORITY,
        phase: "",
        primaryWorkstream: "",
        dueDate: "",
        assignees: [],
        ownerUserId: null,
        ownerDisplayName: "",
      });
      toast({ title: "Task created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Optimistic helper for the per-card hot paths (status / priority / due
  // date). Patches the board cache immediately so a drag or quick-edit lands
  // instantly, snapshots the previous list for rollback, and reconciles with
  // the server in onSettled. The board query is the single source the board /
  // list / projects / timeline / my-tasks views all derive from.
  const boardKey = engineeringTicketKeys.scope("board");
  const optimisticTaskPatch = useCallback(async (taskId: number, patch: Partial<Task>) => {
    await queryClient.cancelQueries({ queryKey: boardKey });
    const previousTasks = queryClient.getQueryData<Task[]>(boardKey);
    queryClient.setQueryData<Task[]>(boardKey, (old) =>
      (old || []).map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
    );
    return { previousTasks };
  }, [queryClient, boardKey]);

  const rollbackTasks = useCallback((ctx?: { previousTasks?: Task[] }) => {
    if (ctx?.previousTasks) queryClient.setQueryData(boardKey, ctx.previousTasks);
  }, [queryClient, boardKey]);

  const updateStatusMutation = useMutation({
    mutationFn: ({ taskId, status, holdReason, blockedType }: { taskId: number; status: string; holdReason?: string; blockedType?: string }) =>
      engFetch(`/api/eng/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status, ...(holdReason ? { holdReason } : {}), ...(blockedType ? { blockedType } : {}) }) }),
    onMutate: ({ taskId, status, holdReason, blockedType }) =>
      optimisticTaskPatch(taskId, { status, ...(holdReason ? { holdReason } : {}), ...(blockedType ? { blockedType } : {}) } as Partial<Task>),
    onSuccess: () => {
      toast({ title: "Status updated" });
    },
    onError: (e: Error, _vars, ctx) => {
      rollbackTasks(ctx);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
    onSettled: () => invalidateEngineeringTicketCaches(queryClient),
  });

  const updatePriorityMutation = useMutation({
    mutationFn: ({ taskId, priority }: { taskId: number; priority: string }) =>
      engFetch(`/api/eng/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ priority }) }),
    onMutate: ({ taskId, priority }) => optimisticTaskPatch(taskId, { priority } as Partial<Task>),
    onSuccess: () => {
      toast({ title: "Priority updated" });
    },
    onError: (e: Error, _vars, ctx) => {
      rollbackTasks(ctx);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
    onSettled: () => invalidateEngineeringTicketCaches(queryClient),
  });

  const requestStatusChange = useCallback((taskId: number, newStatus: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    if (!canTransition(task.status, newStatus)) {
      toast({ title: "Transition not allowed", description: `Cannot move task from ${getTaskStatusLabel(task.status)} to ${getTaskStatusLabel(newStatus)}.`, variant: "destructive" });
      return;
    }
    const blockedReason = getTaskWorkflowBlockReason(task, newStatus);
    if (blockedReason) {
      toast({ title: "Status change blocked", description: blockedReason, variant: "destructive" });
      return;
    }
    if (newStatus === "hold") {
      setHoldDialog({ taskId, reason: "", blockedType: "" });
      return;
    }
    if (newStatus === "projects_assistance" && !task.projectName) {
      setSelectedTask(task);
      toast({ title: "Project required", description: "Link a project to this task before setting Projects Assistance status.", variant: "destructive" });
      return;
    }
    updateStatusMutation.mutate({ taskId, status: newStatus });
  }, [tasks, updateStatusMutation, toast]);

  const handleDrop = useCallback((taskId: number, newStatus: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || canonicalizeTaskStatus(task.status) === newStatus) return;
    requestStatusChange(taskId, newStatus);
  }, [tasks, requestStatusChange]);

  const handleStatusChange = useCallback((taskId: number, newStatus: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || canonicalizeTaskStatus(task.status) === newStatus) return;
    if (newStatus === "complete" && (task.trackingRag === "Red" || normalizeTaskPriority(task.priority) === "Urgent")) {
      setCompletionGuard({ taskId, reason: task.trackingRag === "Red" ? "Red tracking RAG" : "Urgent priority" });
      return;
    }
    requestStatusChange(taskId, newStatus);
  }, [tasks, requestStatusChange]);

  const handlePriorityChange = useCallback((taskId: number, newPriority: string) => {
    updatePriorityMutation.mutate({ taskId, priority: newPriority });
  }, [updatePriorityMutation]);

  // Settle every PATCH independently so a partial failure is reported
  // honestly instead of the previous all-or-nothing toast (X6).
  const runBulkPatch = useCallback(
    async (taskIds: number[], body: Record<string, unknown>) => {
      const results = await Promise.allSettled(
        taskIds.map((id) => engFetch(`/api/eng/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) })),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - ok;
      return { ok, failed };
    },
    [],
  );

  const bulkStatusMutation = useMutation({
    mutationFn: ({ taskIds, status }: { taskIds: number[]; status: string }) => runBulkPatch(taskIds, { status }),
    onSuccess: ({ ok, failed }) => {
      invalidateEngineeringTicketCaches(queryClient);
      if (failed === 0) {
        toast({ title: `${ok} task${ok === 1 ? "" : "s"} updated` });
      } else {
        toast({
          title: `${ok} updated, ${failed} failed`,
          description: "Some tasks could not be updated. Selection kept so you can retry.",
          variant: "destructive",
        });
      }
      if (failed === 0) clearSelection();
    },
    onError: (e: Error) => toast({ title: "Bulk update failed", description: e.message, variant: "destructive" }),
  });

  const bulkPriorityMutation = useMutation({
    mutationFn: ({ taskIds, priority }: { taskIds: number[]; priority: string }) => runBulkPatch(taskIds, { priority }),
    onSuccess: ({ ok, failed }) => {
      invalidateEngineeringTicketCaches(queryClient);
      if (failed === 0) {
        toast({ title: `${ok} task${ok === 1 ? "" : "s"} updated` });
      } else {
        toast({
          title: `${ok} updated, ${failed} failed`,
          description: "Some tasks could not be updated. Selection kept so you can retry.",
          variant: "destructive",
        });
      }
      if (failed === 0) clearSelection();
    },
    onError: (e: Error) => toast({ title: "Bulk update failed", description: e.message, variant: "destructive" }),
  });

  // Confirmed executor — fired by the ConfirmDialog.
  const executePendingBulk = useCallback(() => {
    if (!pendingBulk) return;
    if (pendingBulk.kind === "status") {
      bulkStatusMutation.mutate({ taskIds: pendingBulk.taskIds, status: pendingBulk.value });
    } else {
      bulkPriorityMutation.mutate({ taskIds: pendingBulk.taskIds, priority: pendingBulk.value });
    }
    setPendingBulk(null);
  }, [pendingBulk, bulkStatusMutation, bulkPriorityMutation]);

  const updateDueDateMutation = useMutation({
    mutationFn: ({ taskId, dueDate }: { taskId: number; dueDate: string }) =>
      engFetch(`/api/eng/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ dueDate }) }),
    onMutate: ({ taskId, dueDate }) => optimisticTaskPatch(taskId, { dueDate } as Partial<Task>),
    onSuccess: () => {
      toast({ title: "Due date updated" });
    },
    onError: (e: Error, _vars, ctx) => {
      rollbackTasks(ctx);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
    onSettled: () => invalidateEngineeringTicketCaches(queryClient),
  });

  const handleDueDateChange = useCallback((taskId: number, dueDate: string) => {
    updateDueDateMutation.mutate({ taskId, dueDate });
  }, [updateDueDateMutation]);

  const uniqueAssignees = useMemo(() => Array.from(
    new Set(
      tasks.flatMap((task) =>
        ((task.assignees || []).length > 0 ? (task.assignees || []) : (task.resolvedAssignees || []).map((user) => user.name)).filter(Boolean),
      ),
    ),
  ).sort(), [tasks]);
  const uniqueProjects = useMemo(() => Array.from(new Set(tasks.map(t => t.projectName).filter(Boolean))).sort() as string[], [tasks]);

  const basePool = myTasksOnly ? myTasks : tasks;

  const {
    filtered,
    overdueTasks,
    holdTasks,
    unassignedTasks,
    blockedTasks,
    reviewNeededTasks,
    approvalPendingTasks,
    projectLinkedDeliverableTasks,
    microsoftLinkedTasks,
    microsoftActionTasks,
  } = useEngineeringTaskFilters({
    tasks: basePool,
    statusFilter,
    priorityFilter,
    assigneeFilter,
    projectFilter,
    searchTerm,
    dueDateFilter,
    workloadStateFilter,
    linkedSourceFilter,
  });

  const summaryPool = useMemo(
    () =>
      filterEngineeringTasks({
        tasks: basePool,
        statusFilter,
        priorityFilter,
        assigneeFilter,
        projectFilter,
        searchTerm,
        dueDateFilter: "all",
        workloadStateFilter: "all",
        linkedSourceFilter: "all",
      }),
    [assigneeFilter, basePool, priorityFilter, projectFilter, searchTerm, statusFilter],
  );
  const summaryMetrics = useMemo(() => deriveEngineeringTaskMetrics(summaryPool), [summaryPool]);

  const applyPreset = (preset: typeof SAVED_FILTERS[0]) => {
    setStatusFilter("all");
    setPriorityFilter("all");
    setAssigneeFilter("all");
    setProjectFilter("all");
    setDueDateFilter("all");
    setWorkloadStateFilter("all");
    setLinkedSourceFilter("all");
    setSearchTerm("");
    setMyTasksOnly(false);
    if (preset.filter.status) setStatusFilter(preset.filter.status);
    if (preset.filter.dueDateFilter) setDueDateFilter(preset.filter.dueDateFilter);
    if (preset.filter.workloadStateFilter) setWorkloadStateFilter(preset.filter.workloadStateFilter);
    if (preset.filter.linkedSourceFilter) setLinkedSourceFilter(preset.filter.linkedSourceFilter);
  };

  const resetFilters = useCallback(() => {
    setStatusFilter("all");
    setPriorityFilter("all");
    setAssigneeFilter("all");
    setProjectFilter("all");
    setDueDateFilter("all");
    setWorkloadStateFilter("all");
    setLinkedSourceFilter("all");
    setSearchTerm("");
    setMyTasksOnly(false);
  }, []);

  const focusWorkloadState = useCallback((state: EngineeringWorkloadStateFilter) => {
    setWorkloadStateFilter(state);
    setDueDateFilter("all");
    setLinkedSourceFilter("all");
  }, []);

  const hasActiveFilters = useMemo(() => {
    return (
      statusFilter !== "all" ||
      priorityFilter !== "all" ||
      assigneeFilter !== "all" ||
      projectFilter !== "all" ||
      dueDateFilter !== "all" ||
      workloadStateFilter !== "all" ||
      linkedSourceFilter !== "all" ||
      searchTerm.trim().length > 0 ||
      myTasksOnly
    );
  }, [
    assigneeFilter,
    dueDateFilter,
    linkedSourceFilter,
    myTasksOnly,
    priorityFilter,
    projectFilter,
    searchTerm,
    statusFilter,
    workloadStateFilter,
  ]);

  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string; onClear: () => void }[] = [];
    if (statusFilter !== "all") chips.push({ key: "status", label: `Status: ${getTaskStatusLabel(statusFilter)}`, onClear: () => setStatusFilter("all") });
    if (priorityFilter !== "all") chips.push({ key: "priority", label: `Priority: ${taskPriorityLabel(normalizeTaskPriority(priorityFilter))}`, onClear: () => setPriorityFilter("all") });
    if (assigneeFilter !== "all") chips.push({ key: "assignee", label: `Assignee: ${assigneeFilter}`, onClear: () => setAssigneeFilter("all") });
    if (projectFilter !== "all") chips.push({ key: "project", label: `Project: ${projectFilter}`, onClear: () => setProjectFilter("all") });
    if (dueDateFilter !== "all") {
      const option = DUE_DATE_FILTER_OPTIONS.find((item) => item.value === dueDateFilter);
      chips.push({ key: "dueDate", label: `Due: ${option?.label || dueDateFilter}`, onClear: () => setDueDateFilter("all") });
    }
    if (workloadStateFilter !== "all") {
      const option = WORKLOAD_STATE_OPTIONS.find((item) => item.value === workloadStateFilter);
      chips.push({ key: "workload", label: `Workload: ${option?.label || workloadStateFilter}`, onClear: () => setWorkloadStateFilter("all") });
    }
    if (linkedSourceFilter !== "all") {
      const option = LINKED_SOURCE_OPTIONS.find((item) => item.value === linkedSourceFilter);
      chips.push({ key: "linkedSource", label: `Linked: ${option?.label || linkedSourceFilter}`, onClear: () => setLinkedSourceFilter("all") });
    }
    if (searchTerm.trim()) chips.push({ key: "search", label: `Search: ${searchTerm.trim()}`, onClear: () => setSearchTerm("") });
    if (myTasksOnly) chips.push({ key: "myTasks", label: "My tasks only", onClear: () => setMyTasksOnly(false) });
    return chips;
  }, [assigneeFilter, dueDateFilter, linkedSourceFilter, myTasksOnly, priorityFilter, projectFilter, searchTerm, statusFilter, workloadStateFilter]);

  const isPresetActive = useCallback((preset: typeof SAVED_FILTERS[0]) => {
    return (
      (preset.filter.status || "all") === statusFilter &&
      (preset.filter.dueDateFilter || "all") === dueDateFilter &&
      (preset.filter.workloadStateFilter || "all") === workloadStateFilter &&
      (preset.filter.linkedSourceFilter || "all") === linkedSourceFilter &&
      priorityFilter === "all" &&
      assigneeFilter === "all" &&
      projectFilter === "all" &&
      searchTerm.trim().length === 0 &&
      !myTasksOnly
    );
  }, [
    assigneeFilter,
    dueDateFilter,
    linkedSourceFilter,
    myTasksOnly,
    priorityFilter,
    projectFilter,
    searchTerm,
    statusFilter,
    workloadStateFilter,
  ]);

  const presetBadgeCount = useCallback((preset: typeof SAVED_FILTERS[0]) => {
    if (preset.filter.dueDateFilter === "overdue") return summaryMetrics.overdueTasks.length;
    if (preset.filter.workloadStateFilter === "unassigned") return summaryMetrics.unassignedTasks.length;
    if (preset.filter.workloadStateFilter === "blocked") return summaryMetrics.blockedTasks.length;
    if (preset.filter.workloadStateFilter === "review") return summaryMetrics.reviewNeededTasks.length;
    if (preset.filter.workloadStateFilter === "approval") return summaryMetrics.approvalPendingTasks.length;
    if (preset.filter.workloadStateFilter === "deliverable") return summaryMetrics.projectLinkedDeliverableTasks.length;
    if (preset.filter.linkedSourceFilter === "microsoft_linked") return summaryMetrics.microsoftLinkedTasks.length;
    if (preset.filter.linkedSourceFilter === "microsoft_action_required") return summaryMetrics.microsoftActionTasks.length;
    return 0;
  }, [summaryMetrics]);

  const boardStatuses = getVisibleStatusesForView("board");
  const filterStatuses = getVisibleStatusesForView("list");

  const tasksByStatus = useMemo(() => TASK_STATUSES.reduce((acc, status) => {
    acc[status] = filtered.filter((t) => canonicalizeTaskStatus(t.status) === status);
    return acc;
  }, {} as Record<string, Task[]>), [filtered]);

  // Column grouping (#13)
  const boardGroupKeys = useMemo(() => {
    if (boardGroupBy === "status") return boardStatuses;
    if (boardGroupBy === "priority") return [...TASK_PRIORITY_VALUES];
    if (boardGroupBy === "assignee") {
      const names = new Set<string>();
      filtered.forEach(t => (t.assignees || []).forEach(a => { if (a) names.add(a); }));
      return ["Unassigned", ...Array.from(names).sort()];
    }
    if (boardGroupBy === "project") {
      const projs = new Set<string>();
      filtered.forEach(t => { if (t.projectName) projs.add(t.projectName); });
      return ["No Project", ...Array.from(projs).sort()];
    }
    return boardStatuses;
  }, [filtered, boardGroupBy, boardStatuses]);

  const tasksByGroup = useMemo(() => {
    if (boardGroupBy === "status") return tasksByStatus;
    const groups: Record<string, Task[]> = {};
    boardGroupKeys.forEach(k => { groups[k] = []; });
    filtered.forEach(t => {
      if (boardGroupBy === "priority") {
        const key = normalizeTaskPriority(t.priority);
        (groups[key] || (groups[key] = [])).push(t);
      } else if (boardGroupBy === "assignee") {
        const assignees = (t.assignees || []).filter(Boolean);
        if (assignees.length === 0) (groups["Unassigned"] || (groups["Unassigned"] = [])).push(t);
        else assignees.forEach(a => (groups[a] || (groups[a] = [])).push(t));
      } else if (boardGroupBy === "project") {
        const key = t.projectName || "No Project";
        (groups[key] || (groups[key] = [])).push(t);
      }
    });
    return groups;
  }, [filtered, boardGroupBy, boardGroupKeys, tasksByStatus]);

  const engNextAction = useMemo((): NextAction | null => {
    if (overdueTasks.length > 0) return { label: `${overdueTasks.length} overdue task${overdueTasks.length !== 1 ? "s" : ""} — review and update`, severity: "urgent" };
    if (approvalPendingTasks.length > 0) return { label: `${approvalPendingTasks.length} task${approvalPendingTasks.length !== 1 ? "s" : ""} awaiting approval`, severity: "warning" };
    if (reviewNeededTasks.length > 0) return { label: `${reviewNeededTasks.length} task${reviewNeededTasks.length !== 1 ? "s" : ""} need review feedback`, severity: "warning" };
    if (blockedTasks.length > 0) return { label: `${blockedTasks.length} blocked task${blockedTasks.length !== 1 ? "s" : ""} need unblock decisions`, severity: "warning" };
    if (holdTasks.length > 0) return { label: `${holdTasks.length} task${holdTasks.length !== 1 ? "s" : ""} on hold — check if blockers resolved`, severity: "warning" };
    return { label: "All tasks on track — review board for next priorities", severity: "info" };
  }, [approvalPendingTasks, blockedTasks, holdTasks, overdueTasks, reviewNeededTasks]);

  const handleSaveDefaultView = useCallback(() => {
    saveEngDefaultView({
      viewMode,
      statusFilter,
      priorityFilter,
      assigneeFilter,
      projectFilter,
      dueDateFilter,
      workloadStateFilter,
      linkedSourceFilter,
      boardCompact,
    }, user?.id);
    setHasCustomDefault(true);
    toast({ title: "Default view saved", description: "This page will open with your current view settings next time." });
  }, [
    assigneeFilter,
    boardCompact,
    dueDateFilter,
    linkedSourceFilter,
    priorityFilter,
    projectFilter,
    statusFilter,
    toast,
    user?.id,
    viewMode,
    workloadStateFilter,
  ]);

  const handleResetDefaultView = useCallback(() => {
    clearEngDefaultView(user?.id);
    setHasCustomDefault(false);
    setViewMode("board");
    setStatusFilter("all");
    setPriorityFilter("all");
    setAssigneeFilter("all");
    setProjectFilter("all");
    setDueDateFilter("all");
    setWorkloadStateFilter("all");
    setLinkedSourceFilter("all");
    setSearchTerm("");
    setMyTasksOnly(false);
    setBoardCompact(false);
    toast({ title: "Default view reset", description: "This page will open with the standard board view." });
  }, [toast, user?.id]);

  const engBlockers = useMemo((): BlockerInfo[] => {
    const b: BlockerInfo[] = [];
    if (overdueTasks.length > 0) b.push({ label: "Overdue tasks", count: overdueTasks.length, severity: "urgent" });
    if (blockedTasks.length > 0) b.push({ label: "Blocked tasks", count: blockedTasks.length, severity: "urgent" });
    if (reviewNeededTasks.length > 0) b.push({ label: "Review needed", count: reviewNeededTasks.length, severity: "warning" });
    if (approvalPendingTasks.length > 0) b.push({ label: "Pending approval", count: approvalPendingTasks.length, severity: "warning" });
    return b;
  }, [approvalPendingTasks, blockedTasks, overdueTasks, reviewNeededTasks]);

  const engWalkthroughSteps = useMemo(() => [
    { title: "Board or List view", description: "Switch between Kanban board and list view using the toggle buttons in the top bar." },
    { title: "Filter & search", description: "Use filters for status, priority, or assignee. Type in the search box to find tasks by name or project." },
    { title: "Drag to update", description: "In board view, drag task cards between columns to change their status instantly." },
  ], []);

  // Check for taskId in URL query params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get("taskId");
    if (taskId && tasks.length > 0) {
      const task = tasks.find(t => t.id === parseInt(taskId));
      if (task) setSelectedTask(task);
    }
  }, [tasks]);

  return (
    <ErrorBoundary>
    <div data-testid="eng-tasks-page" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {!embedded && (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-sm">
            <ListTodo className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold" data-testid="text-tasks-title">Engineering Task Execution Board</h2>
            <p className="text-xs text-muted-foreground">Detailed execution workspace for moving and closing work.</p>
            <p className="text-xs text-muted-foreground">
              {myTasksOnly ? `${myTasks.length} of your tasks` : `${tasks.length} tasks`} · {overdueTasks.length} overdue
            </p>
          </div>
          {microWalkthroughEnabled ? <ReplayWalkthrough screenId="eng-tasks" /> : null}
        </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex border rounded-md">
            <Button
              variant={viewMode === "mytasks" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => {
                setViewMode("mytasks");
                if (!myName) openNamePicker();
              }}
              data-testid="btn-view-mytasks"
              title="My Tasks"
              aria-label="My Tasks view"
              aria-pressed={viewMode === "mytasks"}
            >
              <UserCog className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "board" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => setViewMode("board")}
              data-testid="btn-view-board"
              title="Kanban Board"
              aria-label="Kanban board view"
              aria-pressed={viewMode === "board"}
            >
              <Columns3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "projects" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => setViewMode("projects")}
              data-testid="btn-view-projects"
              title="Projects View"
              aria-label="Projects view"
              aria-pressed={viewMode === "projects"}
            >
              <FolderKanban className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => setViewMode("list")}
              data-testid="btn-view-list"
              title="List View"
              aria-label="List view"
              aria-pressed={viewMode === "list"}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "timeline" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => setViewMode("timeline")}
              data-testid="btn-view-timeline"
              title="Timeline View"
              aria-label="Timeline view"
              aria-pressed={viewMode === "timeline"}
            >
              <GanttChart className="h-4 w-4" />
            </Button>
          </div>
          {!embedded && (
          <div className="flex items-center border rounded-md">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs gap-1"
              onClick={handleSaveDefaultView}
              data-testid="btn-save-default-view"
              title="Save current view as your default"
            >
              <Save className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Save Default</span>
            </Button>
            {hasCustomDefault && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs gap-1 text-muted-foreground"
                onClick={handleResetDefaultView}
                data-testid="btn-reset-default-view"
                title="Reset to standard view"
                aria-label="Reset to standard view"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          )}
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs" data-testid="button-create-task">
                <Plus className="h-4 w-4 mr-1" /> New Task
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Create Task</DialogTitle>
                <DialogDescription>Add an engineering task. A project and title are required.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Project Name</Label>
                  <Popover open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={projectPickerOpen}
                        className="w-full justify-between font-normal"
                        data-testid="input-task-project"
                      >
                        {newTask.projectName || "Select a project..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search projects..." />
                        <CommandList>
                          <CommandEmpty>No project found.</CommandEmpty>
                          <CommandGroup>
                            {allProjects.map((proj) => (
                              <CommandItem
                                key={proj.id}
                                value={`${proj.id}-${proj.project_name}`}
                                onSelect={() => {
                                  setNewTask(p => ({ ...p, projectId: proj.id, projectName: proj.project_name }));
                                  setProjectPickerOpen(false);
                                }}
                                data-testid={`option-project-${proj.id}`}
                              >
                                <Check className={`mr-2 h-4 w-4 ${newTask.projectId === proj.id ? "opacity-100" : "opacity-0"}`} />
                                {proj.project_name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input data-testid="input-task-title" value={newTask.title} onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))} placeholder="Task title" />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea data-testid="input-task-description" value={newTask.description} onChange={e => setNewTask(p => ({ ...p, description: e.target.value }))} placeholder="Optional description" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <SearchableSelect
                      value={newTask.priority}
                      onValueChange={v => setNewTask(p => ({ ...p, priority: normalizeTaskPriority(v) }))}
                      placeholder="Priority"
                      options={PRIORITIES.map(p => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))}
                      data-testid="select-task-priority"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Due Date</Label>
                    <Input data-testid="input-task-due" type="date" value={newTask.dueDate} onChange={e => setNewTask(p => ({ ...p, dueDate: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Assign To</Label>
                    <SearchableSelect
                      value={newTask.ownerUserId ? String(newTask.ownerUserId) : "none"}
                      onValueChange={v => {
                        if (v === "none") {
                          setNewTask(p => ({ ...p, assignees: [], ownerUserId: null, ownerDisplayName: "" }));
                          return;
                        }
                        const matchedMember = pageTeamMembers.find((m: any) => String(m.id) === v);
                        const displayName = matchedMember?.fullName || (matchedMember as any)?.name || "";
                        setNewTask(p => ({ ...p, assignees: displayName ? [displayName] : [], ownerUserId: Number(v), ownerDisplayName: displayName }));
                      }}
                      placeholder="Select assignee"
                      options={[
                        { value: "none", label: "Unassigned" },
                        ...pageTeamMembers.map((m: any) => {
                          const label = m.fullName || m.name;
                          return { value: String(m.id), label };
                        }),
                      ]}
                      data-testid="select-task-assignee"
                    />
                  </div>
                </div>
                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                  data-testid="button-submit-task"
                  disabled={!newTask.projectId || !newTask.title || createMutation.isPending}
                  onClick={() => createMutation.mutate(newTask)}
                >
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Create Task
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="shadow-sm border-indigo-200/70 bg-gradient-to-r from-indigo-50/70 to-transparent" data-testid="engineering-execution-handoff">
        <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">Workspace intent</p>
            <p className="text-sm font-medium">Use this page for execution: update statuses, move work, and deliver tasks.</p>
            <p className="text-xs text-muted-foreground">For standup triage, team blockers, and project health, switch to Engineering Overview.</p>
          </div>
          <Link href="/engineering">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="btn-open-engineering-overview">
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Back to Engineering Overview
            </Button>
          </Link>
        </CardContent>
      </Card>

      {error && (
        <Card className="shadow-sm border-red-200 bg-red-50/60" data-testid="engineering-tasks-error-banner">
          <CardContent className="p-3 flex items-start gap-2 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Task data did not refresh cleanly.</p>
              <p className="text-xs text-red-600/90">{(error as Error).message || "Unknown error"}</p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0 h-7 text-xs border-red-300 text-red-700 hover:bg-red-100" onClick={() => refetch()} data-testid="btn-retry-tasks">
              <RefreshCw className="h-3 w-3 mr-1" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {(myTasksOnly || viewMode === "mytasks") && (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="my-tasks-identity">
            <span>
              {myName ? <>Showing tasks for <span className="font-medium text-foreground">{myName}</span></> : "No name set — My Tasks can't match your work yet"}
            </span>
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={openNamePicker} data-testid="btn-change-my-name">
              {myName ? "Change" : "Set your name"}
            </Button>
          </div>
          <PersonalKpiStrip tasks={tasks} myTasks={myTasks} />
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[150px] sm:min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-task-search"
            placeholder="Search tasks..."
            className="pl-9 h-8 text-xs"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <SearchableSelect
          value={statusFilter}
          onValueChange={setStatusFilter}
          placeholder="Status"
          triggerClassName="w-[130px] sm:w-[150px] h-8 text-xs"
          options={[
            { value: "all", label: "All Statuses" },
            ...filterStatuses.map(s => ({ value: s, label: getTaskStatusLabel(s) })),
          ]}
          data-testid="filter-task-status"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="filter-task-more">
              <Filter className="h-3.5 w-3.5" /> More
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-3 space-y-2.5">
            <SearchableSelect
              value={priorityFilter}
              onValueChange={setPriorityFilter}
              placeholder="Priority"
              triggerClassName="w-full h-8 text-xs"
              options={[
                { value: "all", label: "All Priorities" },
                ...PRIORITIES.map(p => ({ value: p, label: TASK_PRIORITY_LABELS[p] })),
              ]}
              data-testid="filter-task-priority"
            />
            {uniqueAssignees.length > 0 && (
              <SearchableSelect
                value={assigneeFilter}
                onValueChange={(val) => {
                  setAssigneeFilter(val);
                  if (val === "all") {
                    setMyTasksOnly(false);
                  } else if (myName && val.toLowerCase() === myName.toLowerCase()) {
                    setMyTasksOnly(true);
                  } else {
                    setMyTasksOnly(false);
                  }
                }}
                placeholder="Assignee"
                triggerClassName="w-full h-8 text-xs"
                options={[
                  { value: "all", label: "All Assignees" },
                  ...uniqueAssignees.map(a => ({ value: a, label: a })),
                ]}
                data-testid="filter-task-assignee"
              />
            )}
            {uniqueProjects.length > 0 && lockedProjectId == null && (
              <SearchableSelect
                value={projectFilter}
                onValueChange={setProjectFilter}
                placeholder="Project"
                triggerClassName="w-full h-8 text-xs"
                options={[
                  { value: "all", label: "All Projects" },
                  ...uniqueProjects.map(p => ({ value: p, label: p.replace(/_Tracker.*$/i, "").replace(/_/g, " ") })),
                ]}
                data-testid="filter-task-project"
              />
            )}
            <Separator />
            <SearchableSelect
              value={dueDateFilter}
              onValueChange={(value) => setDueDateFilter(value as EngineeringDueDateFilter)}
              placeholder="Due date"
              triggerClassName="w-full h-8 text-xs"
              options={DUE_DATE_FILTER_OPTIONS}
              data-testid="filter-task-due-date"
            />
            <SearchableSelect
              value={workloadStateFilter}
              onValueChange={(value) => setWorkloadStateFilter(value as EngineeringWorkloadStateFilter)}
              placeholder="Workload state"
              triggerClassName="w-full h-8 text-xs"
              options={WORKLOAD_STATE_OPTIONS}
              data-testid="filter-task-workload-state"
            />
            <SearchableSelect
              value={linkedSourceFilter}
              onValueChange={(value) => setLinkedSourceFilter(value as EngineeringLinkedSourceFilter)}
              placeholder="Linked source"
              triggerClassName="w-full h-8 text-xs"
              options={LINKED_SOURCE_OPTIONS}
              data-testid="filter-task-linked-source"
            />
          </PopoverContent>
        </Popover>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1.5 text-muted-foreground"
            onClick={resetFilters}
            data-testid="btn-clear-task-filters"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      {hasActiveFilters && (
        <p className="text-xs text-muted-foreground" data-testid="engineering-filter-summary">
          Showing {filtered.length} of {basePool.length} tasks in scope.
        </p>
      )}

      {activeFilterChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="engineering-active-filter-chips">
          {activeFilterChips.map((chip) => (
            <Badge key={chip.key} variant="secondary" className="gap-1 pr-1 text-[10px] font-medium">
              <span>{chip.label}</span>
              <button
                type="button"
                aria-label={`Clear ${chip.label}`}
                className="rounded p-0.5 hover:bg-black/10"
                onClick={chip.onClear}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {!embedded && microWalkthroughEnabled ? <MicroWalkthrough screenId="eng-tasks" steps={engWalkthroughSteps} /> : null}
      {!embedded && <ActionBar nextAction={engNextAction} blockers={engBlockers} />}
      <EngineeringWorkloadStrip
        totalOpenWork={summaryMetrics.openTasks.length}
        unassignedCount={summaryMetrics.unassignedTasks.length}
        blockedCount={summaryMetrics.blockedTasks.length}
        reviewCount={summaryMetrics.reviewNeededTasks.length}
        approvalCount={summaryMetrics.approvalPendingTasks.length}
        deliverableCount={summaryMetrics.projectLinkedDeliverableTasks.length}
        microsoftActionCount={summaryMetrics.microsoftActionTasks.length}
        onReset={resetFilters}
        onSelectWorkloadState={focusWorkloadState}
      />

      <div className="flex flex-wrap gap-1.5">
        {SAVED_FILTERS.map(f => (
          <Button
            key={f.label}
            variant="outline"
            size="sm"
            className={`h-6 text-[10px] px-2 ${isPresetActive(f) ? "bg-primary text-primary-foreground" : ""}`}
            onClick={() => applyPreset(f)}
            data-testid={`preset-${f.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {f.label}
            {presetBadgeCount(f) > 0 && (
              <span className="ml-1 rounded-full bg-black/10 px-1 text-[9px] leading-4">
                {presetBadgeCount(f)}
              </span>
            )}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !error && tasks.length === 0 ? (
        <Card className="shadow-sm" data-testid="engineering-tasks-empty-state">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ListTodo className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <h3 className="text-lg font-medium text-muted-foreground">No engineering tasks yet</h3>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">Create your first task to get started, or generate tasks from an engineering stage checklist.</p>
          </CardContent>
        </Card>
      ) : viewMode === "board" ? (
        <>
        <div className="flex items-center gap-2 flex-wrap" data-testid="board-toolbar">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {summaryMetrics.overdueTasks.length > 0 && (
              <button onClick={() => applyPreset(SAVED_FILTERS[0])} className="flex items-center gap-1 text-red-600 hover:text-red-700 font-medium text-xs transition-colors" data-testid="summary-overdue">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{summaryMetrics.overdueTasks.length} overdue</span>
              </button>
            )}
            {summaryMetrics.blockedTasks.length > 0 && (
              <button onClick={() => focusWorkloadState("blocked")} className="flex items-center gap-1 text-amber-600 hover:text-amber-700 font-medium text-xs transition-colors" data-testid="summary-blocked">
                <PauseCircle className="h-3.5 w-3.5" />
                <span>{summaryMetrics.blockedTasks.length} blocked</span>
              </button>
            )}
            {summaryMetrics.reviewNeededTasks.length > 0 && (
              <button onClick={() => focusWorkloadState("review")} className="flex items-center gap-1 text-violet-600 hover:text-violet-700 font-medium text-xs transition-colors" data-testid="summary-review">
                <MessageSquare className="h-3.5 w-3.5" />
                <span>{summaryMetrics.reviewNeededTasks.length} review</span>
              </button>
            )}
            {summaryMetrics.approvalPendingTasks.length > 0 && (
              <button onClick={() => focusWorkloadState("approval")} className="flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium text-xs transition-colors" data-testid="summary-approval">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>{summaryMetrics.approvalPendingTasks.length} approval</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`h-7 text-[10px] px-2 gap-1 ${boardCompact ? "bg-primary text-primary-foreground" : ""}`}
                      onClick={() => setBoardCompact(!boardCompact)}
                      data-testid="btn-board-compact"
                    >
                      {boardCompact ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
                      {boardCompact ? "Expand" : "Compact"}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {boardCompact ? "Expand cards for full details" : "Compact cards to fit more work on screen"}
                </TooltipContent>
              </Tooltip>
              <SearchableSelect
                value={boardGroupBy}
                onValueChange={(v) => setBoardGroupBy(v as any)}
                placeholder="Group by..."
                triggerClassName="h-7 text-[10px] min-w-[90px]"
                options={[
                  { value: "status", label: "Status" },
                  { value: "priority", label: "Priority" },
                  { value: "assignee", label: "Assignee" },
                  { value: "project", label: "Project" },
                ]}
                data-testid="board-group-by"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] px-2 gap-1"
                      onClick={() => setCollapsedColumns(new Set())}
                      disabled={collapsedColumns.size === 0}
                      data-testid="btn-expand-all-cols"
                    >
                      <Eye className="h-3 w-3" />
                      Show all
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {collapsedColumns.size > 0 ? "Expand all collapsed status columns" : "All status columns are already visible"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <span className="text-[10px] text-muted-foreground">{filtered.length} tasks</span>
          </div>
        </div>

        {bulkMode && (
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg" data-testid="bulk-action-bar">
            <span className="text-xs font-semibold text-blue-800">{selectedTaskIds.size} selected</span>
            <div className="h-4 w-px bg-blue-200" />
            <SearchableSelect
              value=""
              onValueChange={(status) => setPendingBulk({ kind: "status", taskIds: Array.from(selectedTaskIds), value: status, label: getTaskStatusLabel(status) })}
              placeholder="Set status..."
              triggerClassName="h-7 text-[10px] min-w-[100px]"
              options={getVisibleStatusesForView("board").map(s => ({ value: s, label: getTaskStatusLabel(s) }))}
              data-testid="bulk-status-select"
            />
            <SearchableSelect
              value=""
              onValueChange={(p) => setPendingBulk({ kind: "priority", taskIds: Array.from(selectedTaskIds), value: p, label: taskPriorityLabel(p) })}
              placeholder="Set priority..."
              triggerClassName="h-7 text-[10px] min-w-[90px]"
              options={PRIORITIES.map(p => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))}
              data-testid="bulk-priority-select"
            />
            <Button variant="ghost" size="sm" className="h-7 text-[10px] text-muted-foreground" onClick={clearSelection}>
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          </div>
        )}

        <div className="h-2 bg-muted/40 rounded-full overflow-hidden flex" data-testid="status-distribution-bar" title="Status distribution">
          {boardStatuses.map(status => {
            const count = (tasksByStatus[status] || []).length;
            if (count === 0) return null;
            const pct = (count / (filtered.length || 1)) * 100;
            return (
              <button
                type="button"
                key={status}
                className={`h-full ${getTaskStatusBarClass(status)} transition-all duration-500 hover:brightness-110 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`}
                style={{ width: `${Math.max(pct, 0.5)}%` }}
                title={`${getTaskStatusLabel(status)}: ${count} (${Math.round(pct)}%)`}
                aria-label={`Filter by ${getTaskStatusLabel(status)}: ${count} task${count === 1 ? "" : "s"} (${Math.round(pct)}%)`}
                aria-pressed={statusFilter === status}
                onClick={() => setStatusFilter(statusFilter === status ? "all" : status)}
                data-testid={`status-bar-${status.toLowerCase().replace(/\s+/g, "-")}`}
              />
            );
          })}
        </div>

        {isMobile && filtered.length > 0 && <p className="text-[10px] text-muted-foreground text-center py-1">Swipe to see more columns →</p>}
        {filtered.length === 0 ? (
          <Card className="shadow-sm" data-testid="engineering-board-no-matches">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Filter className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <h3 className="text-base font-medium text-muted-foreground">No tasks match your filters</h3>
              <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
                {basePool.length} task{basePool.length === 1 ? "" : "s"} in scope are hidden by the current filters.
              </p>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" className="mt-3 h-8 text-xs gap-1.5" onClick={resetFilters} data-testid="btn-clear-filters-empty">
                  <X className="h-3.5 w-3.5" /> Clear filters
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="flex gap-1.5 overflow-x-auto pb-4" style={{ minHeight: "400px" }}>
            {boardGroupKeys.map(group => (
              <KanbanColumn
                key={group}
                status={group}
                tasks={tasksByGroup[group] || []}
                onDrop={handleDrop}
                onCardClick={setSelectedTask}
                onStatusChange={handleStatusChange}
                onPriorityChange={handlePriorityChange}
                onDueDateChange={handleDueDateChange}
                compact={boardCompact}
                collapsed={collapsedColumns.has(group)}
                onToggleCollapse={() => toggleColumnCollapse(group)}
                totalTasks={filtered.length}
                selectedTaskIds={selectedTaskIds}
                onToggleSelect={toggleTaskSelection}
              />
            ))}
          </div>
        )}
        </>
      ) : viewMode === "mytasks" ? (
        <MyTasksView
          tasks={tasks}
          myName={myName}
          onCardClick={setSelectedTask}
          onStatusChange={handleStatusChange}
          onPriorityChange={handlePriorityChange}
          filterStatuses={filterStatuses}
        />
      ) : viewMode === "projects" ? (
        <ProjectKanbanView
          tasks={filtered}
          onCardClick={setSelectedTask}
          onDrop={handleDrop}
          onStatusChange={handleStatusChange}
          searchTerm={searchTerm}
        />
      ) : viewMode === "timeline" ? (
        <div className="overflow-x-auto">
          <TimelineView tasks={filtered} onCardClick={setSelectedTask} />
        </div>
      ) : (
        <InlineListView
          tasks={filtered}
          onCardClick={setSelectedTask}
          onStatusChange={handleStatusChange}
          onPriorityChange={handlePriorityChange}
          onBulkStatusChange={(ids, status) => setPendingBulk({ kind: "status", taskIds: ids, value: status, label: getTaskStatusLabel(status) })}
          onBulkPriorityChange={(ids, priority) => setPendingBulk({ kind: "priority", taskIds: ids, value: priority, label: taskPriorityLabel(priority) })}
        />
      )}

      {selectedTask && (
        <Suspense fallback={null}>
          <TaskDetailDrawer
            task={selectedTask}
            onClose={() => setSelectedTask(null)}
            onUpdate={() => {
              invalidateEngineeringTicketCaches(queryClient);
              const updatedTask = tasks.find(t => t.id === selectedTask.id);
              if (updatedTask) setSelectedTask(updatedTask);
            }}
          />
        </Suspense>
      )}

      <HoldReasonDialog
        open={!!holdDialog}
        onOpenChange={(open) => { if (!open) setHoldDialog(null); }}
        onConfirm={(reason, blockedType) => {
          if (holdDialog) {
            updateStatusMutation.mutate({ taskId: holdDialog.taskId, status: "hold", holdReason: reason, blockedType });
            setHoldDialog(null);
          }
        }}
        testIdPrefix="hold"
      />

      <AlertDialog open={!!completionGuard} onOpenChange={(open) => { if (!open) setCompletionGuard(null); }}>
        <AlertDialogContent data-testid="completion-guard-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Complete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              This task is flagged with <strong>{completionGuard?.reason}</strong>. Marking it complete will bypass the usual review path — please confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="completion-guard-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="completion-guard-confirm"
              onClick={() => {
                if (completionGuard) {
                  const id = completionGuard.taskId;
                  setCompletionGuard(null);
                  requestStatusChange(id, "complete");
                }
              }}
            >
              Mark complete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* X6: bulk status / priority change confirmation with impact preview. */}
      <ConfirmDialog
        open={!!pendingBulk}
        onOpenChange={(open) => { if (!open) setPendingBulk(null); }}
        title={pendingBulk?.kind === "priority" ? "Change priority on multiple tasks?" : "Change status on multiple tasks?"}
        description="This applies the same change to every selected task."
        confirmLabel={pendingBulk ? `Apply to ${pendingBulk.taskIds.length} task${pendingBulk.taskIds.length === 1 ? "" : "s"}` : "Apply"}
        impact={
          pendingBulk ? (
            <p data-testid="bulk-confirm-impact">
              <strong>{pendingBulk.taskIds.length}</strong> task{pendingBulk.taskIds.length === 1 ? "" : "s"} will be set to{" "}
              {pendingBulk.kind === "priority" ? "priority" : "status"} <strong>{pendingBulk.label}</strong>.
            </p>
          ) : undefined
        }
        onConfirm={executePendingBulk}
      />

      <Dialog open={showNamePicker} onOpenChange={setShowNamePicker}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Who are you?</DialogTitle>
            <DialogDescription>
              "My Tasks" matches assignees whose name starts with what you enter. Use the first name your
              tasks are assigned under so the right work shows up.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            <Label htmlFor="eng-my-name-input">Your name</Label>
            <Input
              id="eng-my-name-input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveMyName(); }}
              placeholder="e.g. Eon"
              data-testid="input-my-name"
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowNamePicker(false)} data-testid="btn-cancel-my-name">Cancel</Button>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={saveMyName} data-testid="btn-save-my-name">Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {showShortcuts && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setShowShortcuts(false)}>
          <div
            className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="eng-shortcuts-title"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 id="eng-shortcuts-title" className="font-semibold text-sm">Keyboard Shortcuts</h3>
              <button onClick={() => setShowShortcuts(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close keyboard shortcuts"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2 text-xs">
              {[
                ["N", "New task"],
                ["G → 1", "Board view"],
                ["G → 2", "My Tasks view"],
                ["G → 3", "Projects view"],
                ["G → 4", "List view"],
                ["G → 5", "Timeline view"],
                ["Esc", "Close drawer / dialog"],
                ["?", "Toggle this help"],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{desc}</span>
                  <kbd className="px-2 py-0.5 bg-muted rounded border text-[10px] font-mono font-bold">{key}</kbd>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground">Press <kbd className="px-1 py-0.5 bg-muted rounded border text-[10px] font-mono">G</kbd> then a number within 1.5s to switch views.</p>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
