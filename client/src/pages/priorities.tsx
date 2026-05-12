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
import { isPriorityAdminRole, isDepartmentHeadRole, SCOPE_LABELS, DEPARTMENT_OPTIONS } from "@/config/priorities";
import { ROLE_DEPARTMENT_MAP } from "@shared/schema/users";
const ALL_DEPTS_KEY = "__ALL__";
import type { PriorityRow } from "@/lib/priority-types";
import { PriorityListSection } from "@/components/priorities/PriorityListSection";
import { CreatePriorityDialog } from "@/components/priorities/CreatePriorityDialog";
import { AssignPriorityDialog, BulkReassignDialog } from "@/components/priorities/AssignDialogs";
import { useConfirmDialog } from "@/components/priorities/ConfirmActionDialog";
import { MyWorkTasksList, taskHealth, taskLevel, type MyWorkTaskRow } from "@/components/priorities/MyWorkTasksList";
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
  const userDepartment = user?.role ? ROLE_DEPARTMENT_MAP[user.role] : undefined;

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
  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });

  // Promote a work_item into a personal (scope='role') priority. Idempotent
  // server-side: if a priority already links to this task, the existing one
  // is returned and the toast says "already on your list".
  const promoteTaskMutation = useMutation({
    mutationFn: async (workItemId: number) => {
      const res = await apiRequest("POST", `/api/priorities/from-task/${workItemId}`, {});
      return res.json();
    },
    onSuccess: (body: { alreadyExisted?: boolean }) => {
      toast({
        title: body?.alreadyExisted ? "Already on your priority list" : "Promoted to priority",
        description: body?.alreadyExisted
          ? "This task was already linked to a priority."
          : "It now lives in My Priorities — you can escalate it to your department or the company.",
      });
      invalidateAll();
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
    mutationFn: (priorityId: number) => apiRequest("POST", `/api/priorities/${priorityId}/escalate`, { reason: "manual" }),
    onSuccess: invalidateAll,
  });

  const reopenMutation = useMutation({
    mutationFn: (priorityId: number) => apiRequest("PUT", `/api/priorities/${priorityId}`, { status: "active" }),
    onSuccess: invalidateAll,
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
  const activeCount = activeData.filter((p) => p.status !== "closed" && p.status !== "complete").length;
  const closedData = activeData.filter((p) => p.status === "closed" || p.status === "complete");

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
    window.open(`/api/reports/priorities-pack?${qs.toString()}`, "_blank");
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
          {(isAdmin || isDeptHead) && (
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Add Priority
            </Button>
          )}
        </div>
      </div>

      {bulkSize > 0 && (
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
          {(isAdmin || isDeptHead) && (
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
              showEscalate
              onEscalate={(id) => escalateMutation.mutate(id)}
              showReopen={showClosed}
              onReopen={(id) => reopenMutation.mutate(id)}
              selectable
              selectedIds={bulkSelected}
              onToggleSelect={toggleBulkSelect}
              emptyMessage="Nothing on your priority list yet"
              emptyAction={
                <Button size="sm" className="mt-3" onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Create My Priority
                </Button>
              }
            />

            {/*
              Show the task pane whenever the user HAS tasks (myTasks.length > 0),
              even if the active filter zero-matches. That way the section
              header doesn't silently vanish when a chip is applied — the
              user sees "(0)" + a helpful empty state instead of wondering
              whether tasks exist at all.
            */}
            {myTasks.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold text-foreground">
                    Tasks assigned to you
                    <span className="ml-2 text-xs text-muted-foreground font-normal">
                      ({filteredMyTasks.length}{filteredMyTasks.length !== myTasks.length ? ` of ${myTasks.length}` : ""})
                    </span>
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Click <em>Make priority</em> to promote any task to a personal priority with the full escalate chain.
                  </p>
                </div>
                <MyWorkTasksList
                  tasks={filteredMyTasks}
                  onPromote={async (id) => {
                    await promoteTaskMutation.mutateAsync(id);
                  }}
                  promotingId={promoteTaskMutation.isPending ? (promoteTaskMutation.variables ?? null) as number | null : null}
                  emptyMessage={
                    levelFilter !== "all" || healthFilter !== "all"
                      ? "No tasks match the active filter."
                      : "No outstanding tasks assigned to you."
                  }
                />
              </div>
            )}
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
              showEscalate
              onEscalate={(id) => escalateMutation.mutate(id)}
              showDeptActions
              onAssign={(id) => setAssignDialogPriorityId(id)}
              showReopen={showClosed}
              onReopen={(id) => reopenMutation.mutate(id)}
              selectable
              selectedIds={bulkSelected}
              onToggleSelect={toggleBulkSelect}
              emptyMessage={
                isAdmin && selectedDeptKey === ALL_DEPTS_KEY
                  ? "No department priorities yet"
                  : `No priorities for ${DEPARTMENT_OPTIONS.find((d) => d.value === effectiveDeptForQuery)?.label || "this department"}`
              }
              emptyAction={
                <Button size="sm" className="mt-3" onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Create Department Priority
                </Button>
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
            showReopen={showClosed && (isAdmin || isDeptHead)}
            onReopen={(id) => reopenMutation.mutate(id)}
            selectable={isAdmin}
            selectedIds={bulkSelected}
            onToggleSelect={toggleBulkSelect}
            emptyMessage="No company priorities yet"
            emptyAction={
              (isAdmin || isDeptHead) ? (
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

      {confirmDialog}
    </PageShell>
  );
}
