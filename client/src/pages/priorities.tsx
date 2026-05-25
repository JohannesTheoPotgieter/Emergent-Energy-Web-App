import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Download, Flag, Plus, Target, Users } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import {
  canPriorityRoleCreateScope,
  canPriorityRoleEscalatePriority,
  canPriorityRoleUseAdminAction,
  isPriorityAdminRole,
  isDepartmentHeadRole,
  isPriorityTerminalStatus,
  SCOPE_LABELS,
  DEPARTMENT_OPTIONS,
} from "@/config/priorities";
import { invalidatePriorityQueries } from "@/lib/priority-query-invalidation";
import { ROLE_DEPARTMENT_MAP } from "@shared/schema/users";
const ALL_DEPTS_KEY = "__ALL__";
import type { PriorityRow } from "@/lib/priority-types";
import { PriorityListSection } from "@/components/priorities/PriorityListSection";
import { CreatePriorityDialog } from "@/components/priorities/CreatePriorityDialog";
import { AssignPriorityDialog, BulkReassignDialog } from "@/components/priorities/AssignDialogs";
import { useConfirmDialog } from "@/components/priorities/ConfirmActionDialog";
import { MyWorkTasksList, taskHealth, taskLevel, type MyWorkTaskRow } from "@/components/priorities/MyWorkTasksList";
import { CreatePersonalTaskDialog } from "@/components/priorities/CreatePersonalTaskDialog";
import { EscalateDialog } from "@/components/priorities/EscalateDialog";
import { useToast } from "@/hooks/use-toast";

export { PriorityCard } from "@/components/priorities/PriorityCard";

// Phase 7B: URL-state contract for the level + health filter chips so
// home-dashboard deep-links like /priorities?tab=my&health=at_risk
// round-trip into the on-page filter selections. Exported as a pure
// helper so the contract is unit-pinnable separately from the React
// component.
const ALLOWED_LEVELS = new Set(["all", "critical", "important", "normal"]);
const ALLOWED_HEALTH = new Set(["all", "critical", "at_risk", "healthy"]);

export function parsePrioritiesFilterParams(
  searchString: string,
): { level: string; health: string } {
  const params = new URLSearchParams(searchString);
  const levelParam = params.get("level");
  const healthParam = params.get("health");
  return {
    level: levelParam && ALLOWED_LEVELS.has(levelParam) ? levelParam : "all",
    health: healthParam && ALLOWED_HEALTH.has(healthParam) ? healthParam : "all",
  };
}

async function fetchPriorities(params: string): Promise<PriorityRow[]> {
  const res = await apiRequest("GET", `/api/priorities?${params}`);
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Server returned ${res.status} with non-JSON response.`);
  }
  return res.json();
}

export default function PrioritiesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);

  const isAdmin = isPriorityAdminRole(user?.role);
  const isDeptHead = isDepartmentHeadRole(user?.role);
  const canUsePriorityAdminActions = canPriorityRoleUseAdminAction(user?.role);
  const userDepartment = user?.role ? ROLE_DEPARTMENT_MAP[user.role] : undefined;
  const canEscalatePriorityRow = (p: PriorityRow) =>
    canPriorityRoleEscalatePriority(
      { role: user?.role, userId: user?.id, departmentKey: userDepartment ?? null },
      {
        scope: p.scope ?? "company",
        departmentKey: p.departmentKey ?? null,
        ownerUserId: p.owner?.id ?? null,
        assignedUserId: p.assignedUserId ?? null,
      },
    );

  const tabParam = params.get("tab");
  // Three-tier escalation (2026-05-12 COO spec):
  //   My Priorities  →  Department Priorities  →  Company Priorities
  // Each tier can escalate to the next via /api/priorities/:id/escalate.
  // Default tab favours the user's own scope: dept heads land on Department,
  // priority admins (COO/CEO/CFO) on Company, everyone else on My.
  const initialTab = (() => {
    if (tabParam === "my" || tabParam === "department" || tabParam === "company") return tabParam;
    if (isAdmin) return "company";
    if (isDeptHead) return "department";
    return "my";
  })();
  const [activeTab, setActiveTab] = useState<"my" | "department" | "company">(initialTab as "my" | "department" | "company");

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createTaskDialogOpen, setCreateTaskDialogOpen] = useState(false);
  const [escalateTarget, setEscalateTarget] = useState<{ id: number; title: string; scope: string } | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<number | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<number | null>(null);
  const [assignDialogPriorityId, setAssignDialogPriorityId] = useState<number | null>(null);
  const [bulkReassignOpen, setBulkReassignOpen] = useState(false);
  // Phase 7B: read level + health from URL params so the home dashboard's
  // "My Overdue Actions" callouts can deep-link to /priorities?tab=my&health=at_risk.
  // Parsing extracted to `parsePrioritiesFilterParams` (exported above) so
  // the URL contract is unit-pinned.
  const initialFilters = parsePrioritiesFilterParams(searchString);
  const [levelFilter, setLevelFilter] = useState(initialFilters.level);
  const [healthFilter, setHealthFilter] = useState(initialFilters.health);
  const [showClosed, setShowClosed] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  // Admins can pick which department to view on the Department tab. Dept
  // heads are pinned to their own department and never see the dropdown.
  const [selectedDeptKey, setSelectedDeptKey] = useState<string>(
    isAdmin ? ALL_DEPTS_KEY : (userDepartment || ""),
  );
  const effectiveDeptForQuery = isAdmin
    ? (selectedDeptKey === ALL_DEPTS_KEY ? "" : selectedDeptKey)
    : (userDepartment || "");

  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const toggleBulkSelect = (id: number) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearBulkSelection = () => setBulkSelected(new Set());

  const listQueryParams = (base: string) =>
    showClosed ? `${base}&include_cancelled=true` : base;

  // My Priorities — unified feed of priorities AND work_items owned by /
  // assigned to the current user. Backend de-duplicates: work items already
  // linked to a priority via linkedTaskId are suppressed (see
  // server/departments/priority-strategic-routes.ts :: GET /api/priorities/my-work).
  // Closed/completed items hidden unless showClosed is on.
  const myWorkFeedQuery = useQuery<{
    userId: number;
    items: Array<
      | { kind: "priority"; priority: PriorityRow }
      | { kind: "task"; task: MyWorkTaskRow }
    >;
    counts: { priorities: number; tasks: number; total: number };
  }>({
    queryKey: ["/api/priorities/my-work", showClosed],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (showClosed) params.set("include_closed", "true");
      const res = await apiRequest("GET", `/api/priorities/my-work?${params.toString()}`);
      return res.json();
    },
    enabled: activeTab === "my",
  });

  const deptQuery = useQuery<PriorityRow[]>({
    queryKey: ["/api/priorities", "department", effectiveDeptForQuery, showClosed],
    queryFn: () => fetchPriorities(
      listQueryParams(
        `scope=department${effectiveDeptForQuery ? `&department=${effectiveDeptForQuery}` : ""}&include_team_roles=true`,
      ),
    ),
    enabled: activeTab === "department" && (isDeptHead || isAdmin),
  });

  const companyQuery = useQuery<PriorityRow[]>({
    queryKey: ["/api/priorities", "company", showClosed],
    queryFn: () => fetchPriorities(listQueryParams("scope=company")),
    enabled: activeTab === "company",
  });

  const { toast } = useToast();
  const activeCreateScope = activeTab === "my" ? "role" : activeTab;
  const canCreateInActiveTab = canPriorityRoleCreateScope(user?.role, activeCreateScope);
  const canUseBulkActions = isAdmin || isDeptHead;
  const invalidateAll = (priorityId?: number | null) => {
    void invalidatePriorityQueries(queryClient, priorityId);
  };

  // Promote a work_item into a personal (scope='role') priority. Idempotent
  // server-side: if a priority already links to this task, the existing one
  // is returned and the toast says "already on your list".
  const promoteTaskMutation = useMutation({
    mutationFn: async (workItemId: number) => {
      const res = await apiRequest("POST", `/api/priorities/from-task/${workItemId}`, {});
      return res.json();
    },
    onSuccess: (body: { alreadyExisted?: boolean; priority?: { id?: number } }) => {
      toast({
        title: body?.alreadyExisted ? "Already on your priority list" : "Promoted to priority",
        description: body?.alreadyExisted
          ? "This task was already linked to a priority."
          : "It now lives in My Priorities — you can escalate it to your department or the company.",
      });
      invalidateAll(body?.priority?.id ?? null);
    },
    onError: (err) => {
      toast({
        title: "Could not promote",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const escalateMutation = useMutation({
    mutationFn: ({ id, reason, note }: { id: number; reason: string; note?: string }) =>
      apiRequest("POST", `/api/priorities/${id}/escalate`, { reason, ...(note ? { note } : {}) }),
    onSuccess: (_data, variables) => { setEscalateTarget(null); invalidateAll(variables.id); },
    onError: (err) => toast({ title: "Escalation failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  const updateTaskStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      setUpdatingTaskId(id);
      const res = await apiRequest("PATCH", `/api/tasks/${id}`, { status });
      return res.json();
    },
    onSettled: () => setUpdatingTaskId(null),
    onSuccess: () => invalidateAll(),
    onError: (err) => toast({ title: "Could not update status", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: number) => {
      setDeletingTaskId(id);
      await apiRequest("DELETE", `/api/priorities/tasks/${id}`);
    },
    onSettled: () => setDeletingTaskId(null),
    onSuccess: () => { toast({ title: "Task removed" }); invalidateAll(); },
    onError: (err) => toast({ title: "Could not delete task", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  const reopenMutation = useMutation({
    mutationFn: (priorityId: number) => apiRequest("POST", `/api/priorities/${priorityId}/reopen`, {}),
    onSuccess: (_data, priorityId) => { toast({ title: "Priority reopened" }); invalidateAll(priorityId); },
    onError: (err) => toast({ title: "Could not reopen", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  const bulkCloseMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) await apiRequest("PUT", `/api/priorities/${id}`, { status: "closed" });
    },
    onSuccess: () => {
      clearBulkSelection();
      invalidateAll();
    },
  });

  const bulkEscalateMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) await apiRequest("POST", `/api/priorities/${id}/escalate`, { reason: "manual" });
    },
    onSuccess: () => {
      clearBulkSelection();
      invalidateAll();
    },
  });

  const bulkReassignMutation = useMutation({
    mutationFn: async ({ ids, userId }: { ids: number[]; userId: number }) => {
      for (const id of ids) await apiRequest("PUT", `/api/priorities/${id}`, { assigned_user_id: userId });
    },
    onSuccess: () => {
      clearBulkSelection();
      setBulkReassignOpen(false);
      invalidateAll();
    },
  });

  const applyFilters = (data: PriorityRow[]) =>
    data.filter((p) => {
      if (levelFilter !== "all" && p.severity !== levelFilter) return false;
      if (healthFilter !== "all" && p.effectiveHealth !== healthFilter) return false;
      return true;
    });

  // My-tab feed splits into two arrays (priorities + tasks). filteredMy is
  // the priorities half — used by PriorityListSection / activeCount / bulk
  // actions. filteredMyTasks is the task half — rendered by MyWorkTasksList
  // below the priority section.
  const myPriorities = useMemo(
    () => (myWorkFeedQuery.data?.items ?? [])
      .filter((it): it is { kind: "priority"; priority: PriorityRow } => it.kind === "priority")
      .map((it) => it.priority),
    [myWorkFeedQuery.data],
  );
  const myTasks = useMemo(
    () => (myWorkFeedQuery.data?.items ?? [])
      .filter((it): it is { kind: "task"; task: MyWorkTaskRow } => it.kind === "task")
      .map((it) => it.task),
    [myWorkFeedQuery.data],
  );
  const filteredMy = useMemo(() => applyFilters(myPriorities), [myPriorities, levelFilter, healthFilter]);
  // Phase 7C: tasks honour the same level + health chips as priorities.
  // Projection happens in `taskLevel` / `taskHealth` (see MyWorkTasksList):
  //   level  ← work_item.priority   (critical / high / normal)
  //   health ← work_item.trackingRag with status + overdue fallback
  const filteredMyTasks = useMemo(() => {
    return myTasks.filter((t) => {
      if (levelFilter !== "all" && taskLevel(t) !== levelFilter) return false;
      if (healthFilter !== "all" && taskHealth(t) !== healthFilter) return false;
      return true;
    });
  }, [myTasks, levelFilter, healthFilter]);
  const filteredDept = useMemo(() => applyFilters(deptQuery.data || []), [deptQuery.data, levelFilter, healthFilter]);
  const filteredCompany = useMemo(() => applyFilters(companyQuery.data || []), [companyQuery.data, levelFilter, healthFilter]);

  const activeData = activeTab === "my" ? filteredMy
    : activeTab === "department" ? filteredDept
    : filteredCompany;
  const activeCount = activeData.filter((p) => !isPriorityTerminalStatus(p.status)).length;
  const closedData = activeData.filter((p) => isPriorityTerminalStatus(p.status));
  const openTaskCount = useMemo(() => myTasks.filter((t) => {
    const s = (t.status ?? "").toLowerCase();
    return s !== "complete" && s !== "completed" && s !== "cancelled" && s !== "done";
  }).length, [myTasks]);

  const bulkSize = bulkSelected.size;
  const runBulkClose = async () => {
    const ok = await confirm({
      title: `Close ${bulkSize} priorit${bulkSize === 1 ? "y" : "ies"}?`,
      description: "They'll be soft-closed and removed from active views.",
      confirmLabel: "Close",
      destructive: true,
    });
    if (ok) bulkCloseMutation.mutate(Array.from(bulkSelected));
  };
  const runBulkEscalate = async () => {
    const ok = await confirm({
      title: `Escalate ${bulkSize} priorit${bulkSize === 1 ? "y" : "ies"}?`,
      description: "Each will move one scope upward (role → department → company).",
      confirmLabel: "Escalate",
    });
    if (ok) bulkEscalateMutation.mutate(Array.from(bulkSelected));
  };

  const exportPack = () => {
    const qs = new URLSearchParams();
    if (activeTab === "department" && userDepartment) {
      qs.set("scope", "department");
      qs.set("department", userDepartment);
    } else if (activeTab === "company") {
      qs.set("scope", "company");
    }
    // `window.open` returns null on popup-block; surface that instead of
    // failing silently. A 0-width returned-window also indicates the
    // browser refused (some hardened configs).
    const popup = window.open(`/api/reports/priorities-pack?${qs.toString()}`, "_blank");
    if (!popup || popup.closed) {
      toast({
        title: "Couldn't open the export",
        description: "Your browser blocked the pop-up. Allow pop-ups for this site and try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Flag className="w-5 h-5" />
            Priorities
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {activeCount} active priorit{activeCount === 1 ? "y" : "ies"}
            {activeTab === "my" && openTaskCount > 0 && ` · ${openTaskCount} task${openTaskCount !== 1 ? "s" : ""}`}
            {showClosed && closedData.length > 0 && ` · ${closedData.length} closed`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(isAdmin || isDeptHead) && (
            <Button size="sm" variant="outline" onClick={exportPack} aria-label="Export priorities pack as PDF">
              <Download className="w-4 h-4 mr-1" />
              Export PDF
            </Button>
          )}
          {canCreateInActiveTab && (
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Add Priority
            </Button>
          )}
        </div>
      </div>

      {bulkSize > 0 && canUseBulkActions && (
        <div className="sticky top-0 z-20 bg-primary/10 border border-primary rounded-md px-3 py-2 mb-3 flex items-center gap-2 text-sm">
          <span className="font-medium">{bulkSize} selected</span>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={runBulkClose}
              disabled={bulkCloseMutation.isPending}
            >
              Close
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 text-orange-700 border-orange-200 hover:bg-orange-50"
              onClick={runBulkEscalate}
              disabled={bulkEscalateMutation.isPending}
            >
              Escalate
            </Button>
          )}
          {isDeptHead && (
            <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setBulkReassignOpen(true)}>
              Reassign...
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-xs h-7 ml-auto" onClick={clearBulkSelection}>
            Clear
          </Button>
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          if (v === "my" || v === "department" || v === "company") {
            setActiveTab(v);
          }
          clearBulkSelection();
          setLevelFilter("all");
          setHealthFilter("all");
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="my" className="text-xs" data-testid="tab-priorities-my">
              <Target className="w-3.5 h-3.5 mr-1" />
              My Priorities
            </TabsTrigger>
            {(isDeptHead || isAdmin) && (
              <TabsTrigger value="department" className="text-xs" data-testid="tab-priorities-department">
                <Users className="w-3.5 h-3.5 mr-1" />
                {SCOPE_LABELS.department}
              </TabsTrigger>
            )}
            <TabsTrigger value="company" className="text-xs" data-testid="tab-priorities-company">
              <Flag className="w-3.5 h-3.5 mr-1" />
              {SCOPE_LABELS.company}
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            {isAdmin && activeTab === "department" && (
              <Select value={selectedDeptKey} onValueChange={setSelectedDeptKey}>
                <SelectTrigger className="w-[180px] h-8 text-xs" data-testid="select-dept-filter">
                  <SelectValue placeholder="Department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_DEPTS_KEY}>All departments</SelectItem>
                  {DEPARTMENT_OPTIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="important">High</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
              </SelectContent>
            </Select>
            <Select value={healthFilter} onValueChange={setHealthFilter}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue placeholder="Health" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All health</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="at_risk">At risk</SelectItem>
                <SelectItem value="healthy">Healthy</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showClosed}
                onChange={(e) => setShowClosed(e.target.checked)}
                className="rounded"
              />
              Show closed
            </label>
            {(levelFilter !== "all" || healthFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-8"
                onClick={() => { setLevelFilter("all"); setHealthFilter("all"); }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        <TabsContent value="my">
          <div className="space-y-6">
            <PriorityListSection
              priorities={filteredMy}
              isLoading={myWorkFeedQuery.isLoading}
              isError={myWorkFeedQuery.isError}
              error={myWorkFeedQuery.error as Error}
              refetch={myWorkFeedQuery.refetch}
              showEscalate={canEscalatePriorityRow}
              onEscalate={(id) => {
                const p = myPriorities.find((x) => x.id === id);
                if (p) setEscalateTarget({ id: p.id, title: p.title, scope: p.scope });
              }}
              showReopen={showClosed && canUsePriorityAdminActions}
              onReopen={(id) => reopenMutation.mutate(id)}
              selectable={canUseBulkActions}
              selectedIds={bulkSelected}
              onToggleSelect={toggleBulkSelect}
              emptyMessage="Nothing on your priority list yet"
              emptyAction={
                canCreateInActiveTab ? (
                  <Button size="sm" className="mt-3" onClick={() => setCreateDialogOpen(true)}>
                    <Plus className="w-4 h-4 mr-1" /> Create My Priority
                  </Button>
                ) : undefined
              }
            />

            <MyWorkTasksList
              tasks={filteredMyTasks}
              onPromote={async (id) => {
                await promoteTaskMutation.mutateAsync(id);
              }}
              promotingId={promoteTaskMutation.isPending ? (promoteTaskMutation.variables ?? null) as number | null : null}
              onUpdateStatus={(id, status) => updateTaskStatusMutation.mutateAsync({ id, status }).then(() => undefined)}
              onDelete={(id) => deleteTaskMutation.mutate(id)}
              onAddTask={() => setCreateTaskDialogOpen(true)}
              updatingId={updatingTaskId}
              deletingId={deletingTaskId}
              emptyMessage={
                levelFilter !== "all" || healthFilter !== "all"
                  ? "No tasks match the active filter."
                  : "No tasks yet - click Add Task to create your first personal task, or tasks assigned to you will appear here."
              }
            />
          </div>
        </TabsContent>

        {(isDeptHead || isAdmin) && (
          <TabsContent value="department">
            <PriorityListSection
              priorities={filteredDept}
              isLoading={deptQuery.isLoading}
              isError={deptQuery.isError}
              error={deptQuery.error as Error}
              refetch={deptQuery.refetch}
              showEscalate={canEscalatePriorityRow}
              onEscalate={(id) => {
                const p = filteredDept.find((x) => x.id === id);
                if (p) setEscalateTarget({ id: p.id, title: p.title, scope: p.scope });
              }}
              showDeptActions
              onAssign={(id) => setAssignDialogPriorityId(id)}
              showReopen={showClosed && isAdmin}
              onReopen={(id) => reopenMutation.mutate(id)}
              selectable={canUseBulkActions}
              selectedIds={bulkSelected}
              onToggleSelect={toggleBulkSelect}
              emptyMessage={
                isAdmin && selectedDeptKey === ALL_DEPTS_KEY
                  ? "No department priorities yet"
                  : `No priorities for ${DEPARTMENT_OPTIONS.find((d) => d.value === effectiveDeptForQuery)?.label || "this department"}`
              }
              emptyAction={
                canCreateInActiveTab ? (
                  <Button size="sm" className="mt-3" onClick={() => setCreateDialogOpen(true)}>
                    <Plus className="w-4 h-4 mr-1" /> Create Department Priority
                  </Button>
                ) : undefined
              }
            />
          </TabsContent>
        )}

        <TabsContent value="company">
          <PriorityListSection
            priorities={filteredCompany}
            isLoading={companyQuery.isLoading}
            isError={companyQuery.isError}
            error={companyQuery.error as Error}
            refetch={companyQuery.refetch}
            showReopen={showClosed && canUsePriorityAdminActions}
            onReopen={(id) => reopenMutation.mutate(id)}
            selectable={isAdmin}
            selectedIds={bulkSelected}
            onToggleSelect={toggleBulkSelect}
            emptyMessage="No company priorities yet"
            emptyAction={
              isAdmin ? (
                <Button size="sm" className="mt-3" onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Create Priority
                </Button>
              ) : undefined
            }
          />
        </TabsContent>
      </Tabs>

      <CreatePriorityDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        defaultScope={activeTab === "my" ? "role" : activeTab === "department" ? "department" : "company"}
        defaultDepartment={
          activeTab === "department"
            ? (effectiveDeptForQuery || userDepartment || "")
            : userDepartment
        }
      />

      <AssignPriorityDialog
        open={assignDialogPriorityId !== null}
        onOpenChange={(open) => { if (!open) setAssignDialogPriorityId(null); }}
        priorityId={assignDialogPriorityId}
      />

      <BulkReassignDialog
        open={bulkReassignOpen}
        onOpenChange={setBulkReassignOpen}
        selectedCount={bulkSize}
        onConfirm={(userId) => bulkReassignMutation.mutate({ ids: Array.from(bulkSelected), userId })}
        isPending={bulkReassignMutation.isPending}
      />

      <CreatePersonalTaskDialog
        open={createTaskDialogOpen}
        onOpenChange={setCreateTaskDialogOpen}
        onCreated={() => invalidateAll()}
      />

      <EscalateDialog
        open={escalateTarget !== null}
        onOpenChange={(open) => { if (!open) setEscalateTarget(null); }}
        priorityTitle={escalateTarget?.title ?? ""}
        currentScope={escalateTarget?.scope ?? "role"}
        onConfirm={(reason, note) => {
          if (escalateTarget) escalateMutation.mutate({ id: escalateTarget.id, reason, note });
        }}
        isPending={escalateMutation.isPending}
      />

      {confirmDialog}
    </PageShell>
  );
}
