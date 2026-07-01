import { useMemo, useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ListTodo,
  Plus,
  RefreshCw,
  AlertTriangle,
  FileText,
  Trash2,
  ArrowRightLeft,
  Search,
  LayoutList,
  Kanban,
  UserCircle,
  X,
} from "lucide-react";
import { PageShell, SectionHeader, WorkspaceNotice } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { usePermission } from "@/hooks/use-permissions";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { isApiError } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useEngineeringProjectOptions } from "@/hooks/use-engineering-project-options";
import { getTaskWorkflowBlockReason } from "@/lib/task-workflow-guard";
import {
  ENGINEERING_DELIVERY_TASK_TYPE_TAGS,
  ENGINEERING_SEAM_TASK_TYPE_TAGS,
  ENGINEERING_TASK_TYPE_LABELS,
  requiresDocumentLink,
  type EngineeringDeliveryTaskTypeTag,
  type EngineeringSeamTaskTypeTag,
} from "@shared/engineering/delivery-task-catalog";
import { TASK_STATUSES, getTaskStatusLabel } from "@shared/task-status";
import { isTaskComplete } from "@/lib/task-status";
import { formatDateShort } from "@/lib/task-formatters";
import type { Task, TeamMember } from "@/components/tasks/types";
import { SpineSubtasksSection } from "./spine/SpineSubtasksSection";
import { SpineChecklistsSection } from "./spine/SpineChecklistsSection";
import { SpineCommentsSection } from "./spine/SpineCommentsSection";
import { SpineAssigneesSection } from "./spine/SpineAssigneesSection";
import { SpineDependenciesSection } from "./spine/SpineDependenciesSection";
import { SpinePlanLinkSection } from "./spine/SpinePlanLinkSection";
import { SpineSignOffSection } from "./spine/SpineSignOffSection";
import {
  useEngineeringTaskFilters,
  type EngineeringDueDateFilter,
  type EngineeringWorkloadStateFilter,
} from "@/hooks/useEngineeringTaskFilters";
import {
  DUE_DATE_FILTER_OPTIONS,
  WORKLOAD_STATE_OPTIONS,
  SAVED_FILTERS,
} from "./task-filter-config";
import { InlineListView, StatusKanbanView, MyTasksView, PersonalKpiStrip } from "./engineering-task-views";
import { LinkDocumentDialog } from "./dialogs/LinkDocumentDialog";
import { CheckoutPromptDialog } from "./dialogs/CheckoutPromptDialog";
import { SubmitForApprovalDialog } from "./dialogs/SubmitForApprovalDialog";
import { CompletePromptDialog } from "./dialogs/CompletePromptDialog";
import { GATED_STATUSES } from "./dialogs/task-doc-shared";

/**
 * Engineering Task Manager — work-tracking rebuild.
 *
 * Consumes the spine `/api/engineering/tasks` surface (TaskListItem) and reuses
 * the rich, prop-driven view components (List / Kanban / My Tasks) by adapting
 * each spine row into the shared `Task` shape. Status changes route through the
 * single workflow chokepoint (`PATCH /api/engineering/tasks/:id/status`); owner
 * reassignment uses `PATCH /api/engineering/tasks/:id`. Keeps the New-Task
 * dialog (project picker fed by use-engineering-project-options) and the Task
 * drawer (status edit + document linking + seam handoff).
 */

interface TaskListItem {
  id: number;
  title: string;
  projectId: number | null;
  projectName: string | null;
  taskTypeTag: string | null;
  status: string;
  priority: string | null;
  endDate: string | null;
  ownerUserId: number | null;
  ownerName: string | null;
  documentCount: number;
  // Native task-management list affordances (spine list response).
  subtaskTotal?: number;
  subtaskDone?: number;
  assigneeNames?: string[];
  isBlocked?: boolean;
  // Project-plan link (read-time derived; spine list response). `endDate` above
  // is already the synced derived due date when the task is plan-linked.
  planLinkItemId?: number | null;
  planLinkRelation?: string | null;
  planLinkLeadDays?: number | null;
  planItemTitle?: string | null;
  planAnchorDate?: string | null;
  planLinkUrgent?: boolean;
}

interface DocLink {
  id: number;
  managedDocumentId: number | null;
  projectDocumentLinkId: number | null;
  linkRole: string;
  createdAt: string;
}

interface DocumentCandidate {
  id: number;
  name: string;
  path: string;
}

interface Options {
  projects: { id: number; name: string }[];
  users: { id: number; name: string }[];
}

type ViewMode = "list" | "kanban" | "mytasks";

const NONE = "__none__";
const ALL = "all";
const VIEW_STORAGE_KEY = "eng_task_manager_view";

function typeLabel(tag: string | null): string {
  if (!tag) return "—";
  return ENGINEERING_TASK_TYPE_LABELS[tag as keyof typeof ENGINEERING_TASK_TYPE_LABELS] ?? tag;
}

/**
 * Adapt a spine TaskListItem into the legacy `Task` shape the rich view
 * components consume. Only the fields those views read are populated; the rest
 * are null/empty defaults so the structural type is satisfied without lying
 * about data we don't have.
 */
function toTask(t: TaskListItem): Task {
  const ownerName = t.ownerName ?? null;
  // Prefer the spine assignee roster (owner first), falling back to just the
  // owner name. De-dupe so the owner isn't double-counted in the avatar stack.
  const assigneeNames = t.assigneeNames && t.assigneeNames.length > 0
    ? Array.from(new Set([...(ownerName ? [ownerName] : []), ...t.assigneeNames]))
    : ownerName
      ? [ownerName]
      : [];
  return {
    id: t.id,
    projectId: t.projectId,
    projectName: t.projectName,
    title: t.title,
    description: null,
    status: t.status,
    priority: t.priority ?? "Normal",
    phase: null,
    primaryWorkstream: "ENG",
    ownerUserId: t.ownerUserId,
    approverUserId: null,
    assigneeUserId: t.ownerUserId,
    assigneeUserIds: t.ownerUserId != null ? [t.ownerUserId] : [],
    dueDate: t.endDate,
    startDate: null,
    percentComplete: 0,
    holdReason: null,
    blockedType: null,
    trackingRag: null,
    summaryText: null,
    taskTypeTag: t.taskTypeTag,
    externalSource: null,
    externalTaskId: null,
    parentTaskId: null,
    linkedPlanItemId: null,
    linkedDeliverableId: null,
    linkedQualityItemInstanceId: null,
    assignees: assigneeNames,
    watchers: [],
    tags: [],
    createdAt: "",
    updatedAt: "",
    isUnassigned: t.ownerUserId == null,
    isBlocked: t.isBlocked ?? false,
    projectLinkedDeliverableCount: t.documentCount,
    subtaskTotal: t.subtaskTotal ?? 0,
    subtaskDone: t.subtaskDone ?? 0,
    planLinkUrgent: t.planLinkUrgent ?? false,
  };
}

export default function EngineeringTaskManagerPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { options: projectOptions } = useEngineeringProjectOptions();

  const [view, setView] = useState<ViewMode>(() => {
    const saved = (typeof window !== "undefined" && localStorage.getItem(VIEW_STORAGE_KEY)) as ViewMode | null;
    return saved === "list" || saved === "kanban" || saved === "mytasks" ? saved : "list";
  });
  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  }, [view]);

  // Filters
  const [search, setSearch] = useState("");
  const [siteFilter, setSiteFilter] = useState<string>(ALL); // by projectId (string)
  const [ownerFilter, setOwnerFilter] = useState<string>(ALL); // by ownerUserId (string)
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [dueDateFilter, setDueDateFilter] = useState<EngineeringDueDateFilter>("all");
  const [workloadStateFilter, setWorkloadStateFilter] = useState<EngineeringWorkloadStateFilter>("all");
  const [hideCompleted, setHideCompleted] = useState(true); // DEFAULT ON

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const tasksQuery = useQuery<{ tasks: TaskListItem[] }>({ queryKey: ["/api/engineering/tasks"] });
  const optionsQuery = useQuery<Options>({ queryKey: ["/api/engineering/options"] });

  const rawTasks = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data]);

  // Open a task drawer directly from a deep link (?task=N) — e.g. a row on the
  // Quality Task Board — once the task list has loaded. The param is cleared
  // after opening so closing the drawer doesn't re-trigger it on refetch.
  useEffect(() => {
    if (rawTasks.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const param = params.get("task");
    if (!param) return;
    const id = Number(param);
    params.delete("task");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    if (Number.isFinite(id) && rawTasks.some((t) => t.id === id)) {
      setSelectedId(id);
    }
  }, [rawTasks]);

  // Spine-specific pre-filters (Site/Owner/Type/Hide-completed) before handing
  // the rest to the shared engineering filter engine.
  const preFiltered = useMemo(() => {
    return rawTasks.filter((t) => {
      if (siteFilter !== ALL && String(t.projectId ?? "") !== siteFilter) return false;
      if (ownerFilter !== ALL) {
        if (ownerFilter === NONE) {
          if (t.ownerUserId != null) return false;
        } else if (String(t.ownerUserId ?? "") !== ownerFilter) {
          return false;
        }
      }
      if (typeFilter !== ALL && t.taskTypeTag !== typeFilter) return false;
      if (hideCompleted && isTaskComplete(t.status)) return false;
      return true;
    });
  }, [rawTasks, siteFilter, ownerFilter, typeFilter, hideCompleted]);

  const adapted = useMemo(() => preFiltered.map(toTask), [preFiltered]);

  // Shared filter engine handles status / search / due-date / workload-state.
  const { filtered: filteredRaw, openTasks } = useEngineeringTaskFilters({
    tasks: adapted,
    statusFilter,
    priorityFilter: "all",
    assigneeFilter: "all",
    projectFilter: "all",
    searchTerm: search,
    dueDateFilter,
    workloadStateFilter,
    linkedSourceFilter: "all",
  });

  // Default order: plan-urgent tasks float to the top across List / Kanban / My
  // Tasks; everything else keeps the server order (updated-at desc). The List
  // view's own column sort still overrides this when the user picks a column;
  // the Kanban column sort layers `planLinkUrgent` first too (sortTasksForColumn).
  const filtered = useMemo(() => {
    const urgent: Task[] = [];
    const rest: Task[] = [];
    for (const t of filteredRaw) (t.planLinkUrgent ? urgent : rest).push(t);
    return urgent.length > 0 ? [...urgent, ...rest] : filteredRaw;
  }, [filteredRaw]);

  const selected = rawTasks.find((t) => t.id === selectedId) ?? null;
  const myName = (user?.name || "").split(/\s+/)[0] || user?.name || "";

  // Scope the My Tasks KPI strip the same way MyTasksView does (assignee-name
  // match) so the headline figures and the list below always agree.
  const myAssignedTasks = useMemo(() => {
    const nameLower = myName.toLowerCase();
    if (!nameLower) return [];
    return filtered.filter((t) =>
      (t.assignees || []).some((a) => a && a.toLowerCase().startsWith(nameLower)),
    );
  }, [filtered, myName]);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["/api/engineering/tasks"] });
  }

  function invalidateTaskDocs(id: number) {
    qc.invalidateQueries({ queryKey: ["/api/engineering/tasks", id, "documents"] });
    qc.invalidateQueries({ queryKey: ["/api/engineering/tasks", id, "document-candidates"] });
    qc.invalidateQueries({ queryKey: ["documents"] });
  }

  // ── Document gate state ───────────────────────────────────────────────────
  // The document follows the task: three target statuses open a required doc
  // prompt before the real PATCH fires. Both the page-level inline/Kanban path
  // and the drawer's status dropdown route through `requestStatusChange`, so the
  // requirement cannot be bypassed.
  const [gate, setGate] = useState<{ task: TaskListItem; newStatus: string } | null>(null);
  // Tracks the document each task checked out (this session) so the later
  // approval / complete prompts know which file to check in.
  const [checkedOutByTask, setCheckedOutByTask] = useState<Record<number, number>>({});

  // ── Status change (workflow-guarded) ──────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/engineering/tasks/${id}/status`, { status }),
    onSuccess: () => {
      toast({ title: "Status updated" });
      refresh();
    },
    onError: (e: unknown) =>
      // The server's complete-guard returns 409 with a message listing the
      // open blocking tasks — surface it as a "Blocked" toast.
      toast({
        title: isApiError(e) && e.status === 409 ? "Blocked by dependencies" : "Couldn't update status",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  // Fire the real status PATCH (after the workflow guard + any doc prompt).
  const commitStatus = useCallback(
    (id: number, status: string) => statusMutation.mutate({ id, status }),
    [statusMutation],
  );

  // THE single gated entry point. Order: (1) workflow guard, (2) doc prompt for
  // the three gated statuses, (3) PATCH. All other transitions PATCH directly.
  const requestStatusChange = useCallback(
    (task: TaskListItem, newStatus: string) => {
      if (task.status === newStatus) return;
      // Best-effort client-side guard — surface the reason before the round
      // trip. The server chokepoint remains the authority (Done-gate etc.).
      const blockReason = getTaskWorkflowBlockReason(
        { status: task.status, taskTypeTag: task.taskTypeTag },
        newStatus,
      );
      if (blockReason) {
        toast({ title: "Blocked", description: blockReason, variant: "destructive" });
        return;
      }
      if (GATED_STATUSES.has(newStatus)) {
        setGate({ task, newStatus });
        return;
      }
      commitStatus(task.id, newStatus);
    },
    [toast, commitStatus],
  );

  // View callbacks (List/Kanban/My-Tasks inline + Kanban drag) feed (id, status);
  // resolve the task and route through the single gate.
  const handleStatusChange = useCallback(
    (id: number, status: string) => {
      const task = rawTasks.find((t) => t.id === id);
      if (!task) return;
      requestStatusChange(task, status);
    },
    [rawTasks, requestStatusChange],
  );

  // ── Gate dialog resolution ────────────────────────────────────────────────
  function closeGate() {
    setGate(null);
  }

  function proceedGate(checkedOutDocId?: number | null) {
    if (!gate) return;
    if (checkedOutDocId != null) {
      setCheckedOutByTask((prev) => ({ ...prev, [gate.task.id]: checkedOutDocId }));
    }
    if (gate.newStatus === "complete") {
      // The checked-out doc is checked in by the Complete prompt; clear it.
      setCheckedOutByTask((prev) => {
        const next = { ...prev };
        delete next[gate.task.id];
        return next;
      });
    }
    commitStatus(gate.task.id, gate.newStatus);
    invalidateTaskDocs(gate.task.id);
    setGate(null);
  }

  const gateError = useCallback(
    (message: string) =>
      toast({ title: "Document step failed", description: message, variant: "destructive" }),
    [toast],
  );

  // Inline priority/due-date edits aren't supported by the spine surface yet —
  // surface a clear, non-destructive toast rather than silently failing.
  const handleUnsupported = useCallback(
    (label: string) => {
      toast({
        title: `${label} not editable here`,
        description: "Open the task to manage details.",
      });
    },
    [toast],
  );
  const handlePriorityChange = useCallback(() => handleUnsupported("Priority"), [handleUnsupported]);

  // ── Bulk actions ──────────────────────────────────────────────────────────
  const bulkStatusMutation = useMutation({
    mutationFn: async ({ taskIds, status }: { taskIds: number[]; status: string }) => {
      const results = await Promise.allSettled(
        taskIds.map((id) => apiRequest("PATCH", `/api/engineering/tasks/${id}/status`, { status })),
      );
      const failures = results.filter((r) => r.status === "rejected").length;
      return { total: taskIds.length, failures };
    },
    onSuccess: ({ total, failures }) => {
      if (failures > 0) {
        toast({
          title: `Updated ${total - failures} of ${total}`,
          description: `${failures} couldn't change (workflow rules).`,
          variant: failures === total ? "destructive" : "default",
        });
      } else {
        toast({ title: `Updated ${total} task${total === 1 ? "" : "s"}` });
      }
      refresh();
    },
    onError: (e: unknown) =>
      toast({
        title: "Bulk status failed",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const bulkOwnerMutation = useMutation({
    mutationFn: async ({ taskIds, ownerUserId }: { taskIds: number[]; ownerUserId: number | null }) => {
      const results = await Promise.allSettled(
        taskIds.map((id) => apiRequest("PATCH", `/api/engineering/tasks/${id}`, { ownerUserId })),
      );
      const failures = results.filter((r) => r.status === "rejected").length;
      return { total: taskIds.length, failures };
    },
    onSuccess: ({ total, failures }) => {
      if (failures > 0) {
        toast({
          title: `Reassigned ${total - failures} of ${total}`,
          description: `${failures} couldn't be reassigned.`,
          variant: "destructive",
        });
      } else {
        toast({ title: `Reassigned ${total} task${total === 1 ? "" : "s"}` });
      }
      refresh();
    },
    onError: (e: unknown) =>
      toast({
        title: "Bulk reassign failed",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const handleBulkStatusChange = useCallback(
    (taskIds: number[], status: string) => {
      // The three doc-gated statuses each require a per-task document step
      // (check-out / submit-for-approval / finalise) that can't be expressed in
      // one bulk action — so bulk can't bypass the gate. Direct the user to open
      // each task instead.
      if (GATED_STATUSES.has(status)) {
        toast({
          title: "Open each task for this status",
          description:
            "In Progress, Needs Approval, and Complete each need a document step — set them one task at a time.",
        });
        return;
      }
      bulkStatusMutation.mutate({ taskIds, status });
    },
    [bulkStatusMutation, toast],
  );
  const handleBulkOwnerChange = useCallback(
    (taskIds: number[], ownerUserId: number | null) => bulkOwnerMutation.mutate({ taskIds, ownerUserId }),
    [bulkOwnerMutation],
  );

  const onCardClick = useCallback((task: Task) => setSelectedId(task.id), []);

  const activeFilterCount =
    (siteFilter !== ALL ? 1 : 0) +
    (ownerFilter !== ALL ? 1 : 0) +
    (statusFilter !== ALL ? 1 : 0) +
    (typeFilter !== ALL ? 1 : 0) +
    (dueDateFilter !== "all" ? 1 : 0) +
    (workloadStateFilter !== "all" ? 1 : 0) +
    (search ? 1 : 0);

  function resetFilters() {
    setSearch("");
    setSiteFilter(ALL);
    setOwnerFilter(ALL);
    setStatusFilter(ALL);
    setTypeFilter(ALL);
    setDueDateFilter("all");
    setWorkloadStateFilter("all");
  }

  return (
    <PageShell>
      <SectionHeader
        icon={<ListTodo className="h-5 w-5" />}
        eyebrow="Engineering"
        title="Task Manager"
        description="Delivery tasks across the engineering discipline — from financial close to handover."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh} disabled={tasksQuery.isFetching}>
              <RefreshCw className={cn("h-4 w-4", tasksQuery.isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="new-task">
              <Plus className="h-4 w-4" />
              New task
            </Button>
          </div>
        }
      />

      {/* View switcher */}
      <div className="flex items-center justify-between gap-3">
        <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
          <TabsList data-testid="view-switcher">
            <TabsTrigger value="list" data-testid="view-list">
              <LayoutList className="mr-1.5 h-4 w-4" />
              List
            </TabsTrigger>
            <TabsTrigger value="kanban" data-testid="view-kanban">
              <Kanban className="mr-1.5 h-4 w-4" />
              Kanban
            </TabsTrigger>
            <TabsTrigger value="mytasks" data-testid="view-mytasks">
              <UserCircle className="mr-1.5 h-4 w-4" />
              My Tasks
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-xs text-muted-foreground tabular-nums">
          {filtered.length} of {rawTasks.length} task{rawTasks.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Filter bar */}
      <Card className="border-border bg-card">
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-56 pl-9"
              data-testid="task-search"
            />
          </div>

          <Select value={siteFilter} onValueChange={setSiteFilter}>
            <SelectTrigger className="h-9 w-48" data-testid="filter-site">
              <SelectValue placeholder="Site" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All sites</SelectItem>
              {projectOptions.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="h-9 w-44" data-testid="filter-owner">
              <SelectValue placeholder="Owner" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All owners</SelectItem>
              <SelectItem value={NONE}>Unassigned</SelectItem>
              {optionsQuery.data?.users.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-44" data-testid="filter-status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {getTaskStatusLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 w-48" data-testid="filter-type">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {ENGINEERING_DELIVERY_TASK_TYPE_TAGS.map((t) => (
                <SelectItem key={t} value={t}>
                  {ENGINEERING_TASK_TYPE_LABELS[t]}
                </SelectItem>
              ))}
              {ENGINEERING_SEAM_TASK_TYPE_TAGS.map((t) => (
                <SelectItem key={t} value={t}>
                  {ENGINEERING_TASK_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={dueDateFilter} onValueChange={(v) => setDueDateFilter(v as EngineeringDueDateFilter)}>
            <SelectTrigger className="h-9 w-40" data-testid="filter-due">
              <SelectValue placeholder="Due date" />
            </SelectTrigger>
            <SelectContent>
              {DUE_DATE_FILTER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={workloadStateFilter}
            onValueChange={(v) => setWorkloadStateFilter(v as EngineeringWorkloadStateFilter)}
          >
            <SelectTrigger className="h-9 w-44" data-testid="filter-workload">
              <SelectValue placeholder="Work state" />
            </SelectTrigger>
            <SelectContent>
              {WORKLOAD_STATE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <label className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="hide-completed">
            <Switch checked={hideCompleted} onCheckedChange={setHideCompleted} />
            Hide completed
          </label>

          {activeFilterCount > 0 ? (
            <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={resetFilters} data-testid="reset-filters">
              <X className="h-3.5 w-3.5" />
              Clear ({activeFilterCount})
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* Saved views */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="saved-views">
        <span className="text-[11px] text-muted-foreground">Quick views:</span>
        {SAVED_FILTERS.map((sv) => (
          <button
            key={sv.label}
            type="button"
            className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
            onClick={() => {
              if (sv.filter.status) setStatusFilter(sv.filter.status);
              if (sv.filter.dueDateFilter) setDueDateFilter(sv.filter.dueDateFilter);
              if (sv.filter.workloadStateFilter) setWorkloadStateFilter(sv.filter.workloadStateFilter);
            }}
            data-testid={`saved-view-${sv.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {sv.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div>
        {tasksQuery.isLoading ? (
          <Card className="border-border bg-card">
            <CardContent className="space-y-2 p-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-muted" />
              ))}
            </CardContent>
          </Card>
        ) : tasksQuery.isError ? (
          <WorkspaceNotice
            tone="warning"
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Couldn't load tasks"
            description={
              tasksQuery.error instanceof Error ? tasksQuery.error.message : "Please try again."
            }
            actions={
              <Button variant="outline" size="sm" onClick={refresh}>
                <RefreshCw className="h-4 w-4" />
                Retry
              </Button>
            }
          />
        ) : rawTasks.length === 0 ? (
          <Card className="border-border bg-card">
            <CardContent className="px-4 py-12 text-center">
              <ListTodo className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium">No engineering tasks yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Create one to get started.</p>
            </CardContent>
          </Card>
        ) : view === "list" ? (
          <InlineListView
            tasks={filtered}
            onCardClick={onCardClick}
            onStatusChange={handleStatusChange}
            onPriorityChange={handlePriorityChange}
            onBulkStatusChange={handleBulkStatusChange}
            onBulkOwnerChange={handleBulkOwnerChange}
            owners={optionsQuery.data?.users ?? []}
          />
        ) : view === "kanban" ? (
          <StatusKanbanView
            tasks={filtered}
            onCardClick={onCardClick}
            onDrop={handleStatusChange}
            onStatusChange={handleStatusChange}
            onPriorityChange={handlePriorityChange}
          />
        ) : (
          <div className="space-y-3">
            <PersonalKpiStrip tasks={filtered} myTasks={myAssignedTasks} />
            <MyTasksView
              tasks={filtered}
              myName={myName}
              onCardClick={onCardClick}
              onStatusChange={handleStatusChange}
              onPriorityChange={handlePriorityChange}
            />
          </div>
        )}
        {view !== "mytasks" && rawTasks.length > 0 ? (
          <p className="mt-2 text-[11px] text-muted-foreground" data-testid="open-work-count">
            {openTasks.length} open · select rows in List view for bulk status / owner actions.
          </p>
        ) : null}
      </div>

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        users={optionsQuery.data?.users ?? []}
        onCreated={() => {
          refresh();
          setCreateOpen(false);
        }}
      />

      <TaskDrawer
        task={selected}
        options={optionsQuery.data}
        onClose={() => setSelectedId(null)}
        onChanged={refresh}
        onRequestStatusChange={requestStatusChange}
        toast={toast}
        qc={qc}
      />

      {/* ── Document gate prompts (centralized; serve both inline/Kanban + drawer) ── */}
      {gate?.newStatus === "in_progress" ? (
        <CheckoutPromptDialog
          open
          taskId={gate.task.id}
          taskTitle={gate.task.title}
          projectId={gate.task.projectId}
          onProceed={(docId) => proceedGate(docId)}
          onCancel={closeGate}
          onError={gateError}
          onLinked={(count) => {
            if (count > 0) toast({ title: `Linked ${count} document${count === 1 ? "" : "s"}` });
            invalidateTaskDocs(gate.task.id);
          }}
        />
      ) : null}
      {gate?.newStatus === "needs_approval" ? (
        <SubmitForApprovalDialog
          open
          taskId={gate.task.id}
          checkedOutDocId={checkedOutByTask[gate.task.id] ?? null}
          onProceed={() => proceedGate()}
          onCancel={closeGate}
          onError={gateError}
        />
      ) : null}
      {gate?.newStatus === "complete" ? (
        <CompletePromptDialog
          open
          taskId={gate.task.id}
          checkedOutDocId={checkedOutByTask[gate.task.id] ?? null}
          onProceed={() => proceedGate()}
          onCancel={closeGate}
          onError={gateError}
        />
      ) : null}
    </PageShell>
  );
}

// ── Create dialog ───────────────────────────────────────────────────────────

function CreateTaskDialog({
  open,
  onOpenChange,
  users,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  users: { id: number; name: string }[];
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const { options: projectOptions } = useEngineeringProjectOptions();
  const [title, setTitle] = useState("");
  const [types, setTypes] = useState<Set<EngineeringDeliveryTaskTypeTag>>(new Set());
  const [projectId, setProjectId] = useState<string>(NONE);
  const [ownerId, setOwnerId] = useState<string>(NONE);
  const [due, setDue] = useState("");

  function reset() {
    setTitle("");
    setTypes(new Set());
    setProjectId(NONE);
    setOwnerId(NONE);
    setDue("");
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const tagList = Array.from(types);
      const projectIdNum = projectId !== NONE ? Number(projectId) : undefined;
      const ownerIdNum = ownerId !== NONE ? Number(ownerId) : undefined;
      if (tagList.length > 1) {
        await apiRequest("POST", "/api/engineering/tasks/bulk", {
          taskTypeTags: tagList,
          projectId: projectIdNum,
          ownerUserId: ownerIdNum,
          dueDate: due || undefined,
        });
      } else {
        const tag = tagList[0];
        await apiRequest("POST", "/api/engineering/tasks", {
          title: title.trim() || ENGINEERING_TASK_TYPE_LABELS[tag],
          taskTypeTag: tag,
          projectId: projectIdNum,
          ownerUserId: ownerIdNum,
          endDate: due || undefined,
        });
      }
    },
    onSuccess: () => {
      toast({ title: "Task created" });
      reset();
      onCreated();
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't create task",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  function toggleType(tag: EngineeringDeliveryTaskTypeTag) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  const canSubmit = types.size > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New engineering task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Type(s)</Label>
            <div className="flex flex-wrap gap-1.5">
              {ENGINEERING_DELIVERY_TASK_TYPE_TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    types.has(t)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                  data-testid={`type-${t}`}
                >
                  {ENGINEERING_TASK_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            {types.size > 1 ? <p className="text-xs text-muted-foreground">Creates one task per selected type.</p> : null}
          </div>
          {types.size <= 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Defaults to the type name"
              />
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger data-testid="create-project">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {projectOptions.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-due">Due date</Label>
            <Input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
            data-testid="create-submit"
          >
            {mutation.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Task drawer ─────────────────────────────────────────────────────────────

type ToastFn = ReturnType<typeof useToast>["toast"];

function TaskDrawer({
  task,
  options,
  onClose,
  onChanged,
  onRequestStatusChange,
  toast,
  qc,
}: {
  task: TaskListItem | null;
  options?: Options;
  onClose: () => void;
  onChanged: () => void;
  onRequestStatusChange: (task: TaskListItem, newStatus: string) => void;
  toast: ToastFn;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const open = task != null;
  const taskId = task?.id ?? 0;
  const [browseOpen, setBrowseOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { allowed: canDelete } = usePermission("eng_tasks", "edit");

  // Mention roster for the comments input — reuse the page's options users
  // (the only field the picker needs is fullName; role is shown if present).
  const teamMembers: TeamMember[] = useMemo(
    () => (options?.users ?? []).map((u) => ({ id: u.id, fullName: u.name, role: "" })),
    [options?.users],
  );

  const docsQuery = useQuery<{ links: DocLink[] }>({
    queryKey: ["/api/engineering/tasks", taskId, "documents"],
    enabled: open,
  });
  const links = useMemo(() => docsQuery.data?.links ?? [], [docsQuery.data]);
  const docGated = task != null && requiresDocumentLink(task.taskTypeTag) && links.length === 0;

  const candidatesQuery = useQuery<{ candidates: DocumentCandidate[] }>({
    queryKey: ["/api/engineering/tasks", taskId, "document-candidates"],
    enabled: open,
  });
  const linkedDocIds = useMemo(
    () => new Set(links.map((l) => l.managedDocumentId).filter((x): x is number => x != null)),
    [links],
  );
  const candidateNameById = useMemo(
    () => new Map((candidatesQuery.data?.candidates ?? []).map((c) => [c.id, c.name])),
    [candidatesQuery.data],
  );

  const [seamType, setSeamType] = useState<EngineeringSeamTaskTypeTag>(ENGINEERING_SEAM_TASK_TYPE_TAGS[0]);
  const [seamOwner, setSeamOwner] = useState<string>(NONE);
  const [seamNote, setSeamNote] = useState("");

  function invalidateDocs() {
    qc.invalidateQueries({ queryKey: ["/api/engineering/tasks", taskId, "documents"] });
    qc.invalidateQueries({ queryKey: ["/api/engineering/tasks", taskId, "document-candidates"] });
    qc.invalidateQueries({ queryKey: ["documents"] });
    onChanged();
  }

  const ownerMutation = useMutation({
    mutationFn: async (ownerUserId: number | null) =>
      apiRequest("PATCH", `/api/engineering/tasks/${taskId}`, { ownerUserId }),
    onSuccess: () => {
      toast({ title: "Owner updated" });
      onChanged();
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't reassign owner",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/engineering/tasks/${taskId}`),
    onSuccess: () => {
      toast({ title: "Task deleted" });
      setConfirmDelete(false);
      onClose();
      onChanged();
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't delete task",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const unlinkMutation = useMutation({
    mutationFn: async (linkId: number) => apiRequest("DELETE", `/api/engineering/tasks/${taskId}/documents/${linkId}`),
    onSuccess: () => {
      toast({ title: "Document unlinked" });
      invalidateDocs();
    },
  });

  const seamMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/engineering/tasks/seam", {
        seamType,
        toOwnerUserId: Number(seamOwner),
        title: `${task?.title ?? "Handoff"} — ${seamType === "compliance_input" ? "compliance input" : "construction snag"}`,
        note: seamNote || undefined,
        fromTaskId: taskId,
        projectId: task?.projectId ?? undefined,
      }),
    onSuccess: () => {
      toast({ title: "Seam handoff created" });
      setSeamNote("");
      setSeamOwner(NONE);
      onChanged();
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't create handoff",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  // The status dropdown routes through the page-level centralized gate so the
  // workflow guard + document prompts apply identically to the inline/Kanban
  // paths — it cannot be bypassed here.
  function attemptStatus(next: string) {
    if (!task || next === task.status) return;
    onRequestStatusChange(task, next);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {task ? (
          <>
            <SheetHeader>
              <SheetTitle className="pr-6">{task.title}</SheetTitle>
            </SheetHeader>
            <div className="space-y-5 py-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline">{typeLabel(task.taskTypeTag)}</Badge>
                {task.projectName ? <Badge variant="outline">{task.projectName}</Badge> : null}
                <Badge variant="outline">{task.ownerName ?? "Unassigned"}</Badge>
                {canDelete ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 gap-1 text-destructive hover:text-destructive"
                    onClick={() => setConfirmDelete(true)}
                    data-testid="btn-delete-task"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                ) : null}
              </div>

              <ConfirmDialog
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title="Delete this task?"
                description="Removes the task and its subtasks from the Task Manager. Linked SharePoint documents are not deleted."
                confirmLabel={deleteMutation.isPending ? "Deleting…" : "Delete task"}
                variant="destructive"
                onConfirm={() => deleteMutation.mutate()}
              />

              {/* Status + Done-gate */}
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={task.status} onValueChange={attemptStatus}>
                  <SelectTrigger data-testid="status-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {getTaskStatusLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {docGated ? (
                  <div
                    className="ee-status-warning flex items-start gap-2 rounded-md border p-2 text-xs"
                    data-testid="done-gate-banner"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      This task produces a document. Moving to In Progress, Needs Approval, or Complete will prompt
                      you to check it out, submit it for review, or finalise it.
                    </span>
                  </div>
                ) : null}
              </div>

              {/* Due date — derived & read-only while plan-linked */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  Due date
                  {task.planLinkItemId != null ? (
                    <Badge
                      variant="outline"
                      className="ee-status-accent px-1 py-0 text-[10px]"
                    >
                      from plan task
                    </Badge>
                  ) : null}
                </Label>
                <Input
                  value={task.endDate ? formatDateShort(task.endDate) : "—"}
                  readOnly
                  aria-readonly="true"
                  className="bg-muted/40"
                  data-testid="task-due-date"
                />
                {task.planLinkItemId != null ? (
                  <p className="text-[11px] text-muted-foreground">
                    The linked plan task drives this due date — manage it in Project plan link below.
                  </p>
                ) : null}
              </div>

              {/* Owner reassign */}
              <div className="space-y-1.5">
                <Label>Owner</Label>
                <Select
                  value={task.ownerUserId != null ? String(task.ownerUserId) : NONE}
                  onValueChange={(v) => ownerMutation.mutate(v === NONE ? null : Number(v))}
                >
                  <SelectTrigger data-testid="owner-select">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Unassigned</SelectItem>
                    {options?.users.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Assignees */}
              <SpineAssigneesSection
                taskId={taskId}
                open={open}
                toast={toast}
                users={options?.users ?? []}
                onChanged={onChanged}
              />

              {/* Subtasks */}
              <SpineSubtasksSection taskId={taskId} open={open} toast={toast} onChanged={onChanged} />

              {/* Checklists */}
              <SpineChecklistsSection taskId={taskId} open={open} toast={toast} />

              {/* Dependencies */}
              <SpineDependenciesSection taskId={taskId} open={open} toast={toast} />

              {/* Project plan link — derives this task's due date from a plan task */}
              <SpinePlanLinkSection
                taskId={taskId}
                open={open}
                toast={toast}
                canEdit={canDelete}
                onChanged={onChanged}
                state={{
                  planLinkItemId: task.planLinkItemId ?? null,
                  planLinkRelation: task.planLinkRelation ?? null,
                  planLinkLeadDays: task.planLinkLeadDays ?? null,
                  planItemTitle: task.planItemTitle ?? null,
                  planAnchorDate: task.planAnchorDate ?? null,
                  planLinkUrgent: task.planLinkUrgent ?? false,
                  derivedDue: task.endDate,
                  status: task.status,
                }}
              />

              {/* Sign-off */}
              <SpineSignOffSection
                taskId={taskId}
                status={task.status}
                open={open}
                toast={toast}
                onChanged={onChanged}
              />

              {/* Comments */}
              <SpineCommentsSection taskId={taskId} open={open} toast={toast} teamMembers={teamMembers} />

              {/* Documents */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    Linked documents
                  </Label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setBrowseOpen(true)}
                    disabled={task.projectId == null}
                    data-testid="task-link-doc-open"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Link
                  </Button>
                </div>
                {links.length > 0 ? (
                  <ul className="space-y-1">
                    {links.map((l) => {
                      const name =
                        l.managedDocumentId != null
                          ? candidateNameById.get(l.managedDocumentId) ?? `Doc #${l.managedDocumentId}`
                          : `Project doc #${l.projectDocumentLinkId}`;
                      return (
                        <li
                          key={l.id}
                          className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1 text-xs"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate font-medium">{name}</span>
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              {l.linkRole}
                            </Badge>
                          </span>
                          <button
                            onClick={() => unlinkMutation.mutate(l.id)}
                            className="shrink-0 text-muted-foreground hover:text-status-adverse"
                            aria-label={`Unlink ${name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">No documents linked.</p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {task.projectId == null
                    ? "Assign this task to a project to link documents from its SharePoint folders."
                    : "Documents come from this project's SharePoint folders (Document Manager)."}
                </p>
              </div>

              {/* Seam handoff */}
              <div className="space-y-2 rounded-md border border-border/60 p-3">
                <Label className="flex items-center gap-1.5">
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Seam handoff
                </Label>
                <Select value={seamType} onValueChange={(v) => setSeamType(v as EngineeringSeamTaskTypeTag)}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENGINEERING_SEAM_TASK_TYPE_TAGS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {ENGINEERING_TASK_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={seamOwner} onValueChange={setSeamOwner}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Hand to…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Hand to…</SelectItem>
                    {options?.users.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  value={seamNote}
                  onChange={(e) => setSeamNote(e.target.value)}
                  placeholder="Note (optional)"
                  className="min-h-[60px] text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={seamOwner === NONE || seamMutation.isPending}
                  onClick={() => seamMutation.mutate()}
                >
                  Create handoff
                </Button>
              </div>
            </div>

            {/* Browse-the-project's-folders → link modal (replaces the bare dropdown). */}
            <LinkDocumentDialog
              open={browseOpen}
              onOpenChange={setBrowseOpen}
              taskId={taskId}
              taskTitle={task.title}
              projectId={task.projectId}
              linkedDocIds={linkedDocIds}
              onLinked={(count) => {
                if (count > 0) toast({ title: `Linked ${count} document${count === 1 ? "" : "s"}` });
                invalidateDocs();
              }}
              onError={(message) =>
                toast({ title: "Couldn't link document", description: message, variant: "destructive" })
              }
            />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
