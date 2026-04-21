import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Download, Flag, Plus, Users } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { isPriorityAdminRole, isDepartmentHeadRole, SCOPE_LABELS, DEPARTMENT_OPTIONS } from "@/config/priorities";
import { ROLE_DEPARTMENT_MAP } from "@shared/schema/users";
import type { PriorityRow } from "@/lib/priority-types";
import { PriorityListSection } from "@/components/priorities/PriorityListSection";
import { CreatePriorityDialog } from "@/components/priorities/CreatePriorityDialog";
import { AssignPriorityDialog, BulkReassignDialog } from "@/components/priorities/AssignDialogs";
import { useConfirmDialog } from "@/components/priorities/ConfirmActionDialog";

export { PriorityCard } from "@/components/priorities/PriorityCard";

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
  // "My Priorities" was removed — individual users track their items on My
  // Tasks and escalate to Department from there. Default to Department for
  // dept heads, Company for admins.
  const initialTab = (() => {
    if (tabParam === "department" || tabParam === "company") return tabParam;
    if (isAdmin) return "company";
    if (isDeptHead) return "department";
    return "company";
  })();
  const [activeTab, setActiveTab] = useState(initialTab);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [assignDialogPriorityId, setAssignDialogPriorityId] = useState<number | null>(null);
  const [bulkReassignOpen, setBulkReassignOpen] = useState(false);
  const [levelFilter, setLevelFilter] = useState("all");
  const [healthFilter, setHealthFilter] = useState("all");
  const [showClosed, setShowClosed] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());

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

  const deptQuery = useQuery<PriorityRow[]>({
    queryKey: ["/api/priorities", "department", userDepartment, showClosed],
    queryFn: () => fetchPriorities(
      listQueryParams(
        `scope=department${userDepartment ? `&department=${userDepartment}` : ""}&include_team_roles=true`,
      ),
    ),
    enabled: activeTab === "department" && isDeptHead,
  });

  const companyQuery = useQuery<PriorityRow[]>({
    queryKey: ["/api/priorities", "company", showClosed],
    queryFn: () => fetchPriorities(listQueryParams("scope=company")),
    enabled: activeTab === "company",
  });

  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });

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

  const filteredDept = useMemo(() => applyFilters(deptQuery.data || []), [deptQuery.data, levelFilter, healthFilter]);
  const filteredCompany = useMemo(() => applyFilters(companyQuery.data || []), [companyQuery.data, levelFilter, healthFilter]);

  const activeData = activeTab === "department" ? filteredDept : filteredCompany;
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
          setActiveTab(v);
          clearBulkSelection();
          setLevelFilter("all");
          setHealthFilter("all");
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            {isDeptHead && (
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

        {isDeptHead && (
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
              emptyMessage={`No priorities for ${DEPARTMENT_OPTIONS.find((d) => d.value === userDepartment)?.label || "your department"}`}
              emptyAction={
                <Button size="sm" className="mt-3" onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Create Department Priority
                </Button>
              }
            />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="company">
            <PriorityListSection
              priorities={filteredCompany}
              isLoading={companyQuery.isLoading}
              isError={companyQuery.isError}
              error={companyQuery.error as Error}
              refetch={companyQuery.refetch}
              showReopen={showClosed}
              onReopen={(id) => reopenMutation.mutate(id)}
              selectable
              selectedIds={bulkSelected}
              onToggleSelect={toggleBulkSelect}
              emptyMessage="No company priorities yet"
              emptyAction={
                <Button size="sm" className="mt-3" onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Create Priority
                </Button>
              }
            />
          </TabsContent>
        )}
      </Tabs>

      <CreatePriorityDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        defaultScope={activeTab === "department" ? "department" : "company"}
        defaultDepartment={userDepartment}
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
