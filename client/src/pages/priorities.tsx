import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch, useLocation, Link } from "wouter";
import { Download, Filter, Flag, LayoutGrid, List, Plus, Rows3, Search, Target, Users, X } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import type { PriorityListDensity } from "@/components/priorities/PriorityCard";

const DENSITY_STORAGE_KEY = "priorities:density";
const DENSITY_VALUES: PriorityListDensity[] = ["cards", "compact", "dense"];
function readStoredDensity(): PriorityListDensity {
  if (typeof window === "undefined") return "cards";
  const raw = window.localStorage.getItem(DENSITY_STORAGE_KEY);
  return (DENSITY_VALUES as string[]).includes(raw ?? "") ? (raw as PriorityListDensity) : "cards";
}
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
  // Density toggle — persisted in localStorage so the operator's
  // preference survives across visits and tabs. The three modes (cards,
  // compact, dense) trade card detail for vertical density: cards is
  // the canonical 2-col grid, compact is a 3-col grid with metadata
  // trimmed, dense is a single-column one-line strip for scan speed.
  const [density, setDensity] = useState<PriorityListDensity>(() => readStoredDensity());
  useEffect(() => {
    try { window.localStorage.setItem(DENSITY_STORAGE_KEY, density); } catch { /* noop */ }
  }, [density]);
  // Admin-only "Archived" view. Toggling this switches the list query
  // to include_archived=true so soft-deleted priorities surface for the
  // admin to restore.
  const [showArchived, setShowArchived] = useState(false);
  // Free-text search across title + description (server-side, see
  // GET /api/priorities/search). Debounced 250ms.
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // Currently-selected saved view (empty string = "Default — no view").
  // Switching applies the view's filters; saving the current state
  // writes a new view to the server scoped to the caller.
  const [selectedViewId, setSelectedViewId] = useState<string>("");
  const [saveViewName, setSaveViewName] = useState("");
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

  const listQueryParams = (base: string) => {
    let q = base;
    if (showClosed) q = `${q}&include_cancelled=true`;
    if (showArchived && isAdmin) q = `${q}&include_archived=true`;
    return q;
  };

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

  // Enabled regardless of active tab so the tab pills can show counts
  // ("Department 47", "Company 8") even when the user is on a different
  // tab. Cheap: priorities table is small.
  const deptQuery = useQuery<PriorityRow[]>({
    queryKey: ["/api/priorities", "department", effectiveDeptForQuery, showClosed, showArchived],
    queryFn: () => fetchPriorities(
      listQueryParams(
        `scope=department${effectiveDeptForQuery ? `&department=${effectiveDeptForQuery}` : ""}&include_team_roles=true`,
      ),
    ),
    enabled: isDeptHead || isAdmin,
  });

  const companyQuery = useQuery<PriorityRow[]>({
    queryKey: ["/api/priorities", "company", showClosed, showArchived],
    queryFn: () => fetchPriorities(listQueryParams("scope=company")),
  });

  // Debounce the search input so we don't fire a request per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput.trim()), 250);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // (Keyboard shortcuts effect lives lower, after canCreateInActiveTab.)
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);

  type SavedView = {
    id: number; name: string; activeTab: string;
    scope: string | null; departmentKey: string | null;
    levelFilter: string | null; healthFilter: string | null;
    searchQuery: string | null;
    showClosed: boolean; showArchived: boolean; sortOrder: number;
  };
  const savedViewsQuery = useQuery<SavedView[]>({
    queryKey: ["/api/priority-saved-views"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/priority-saved-views");
      return res.json();
    },
  });

  const applyView = (id: string) => {
    setSelectedViewId(id);
    if (!id) return;
    const v = (savedViewsQuery.data ?? []).find((x) => String(x.id) === id);
    if (!v) return;
    if (v.activeTab === "my" || v.activeTab === "department" || v.activeTab === "company") {
      setActiveTab(v.activeTab);
    }
    if (v.departmentKey) setSelectedDeptKey(v.departmentKey);
    setLevelFilter(v.levelFilter ?? "all");
    setHealthFilter(v.healthFilter ?? "all");
    setSearchInput(v.searchQuery ?? "");
    setShowClosed(!!v.showClosed);
    setShowArchived(!!v.showArchived);
  };

  const saveViewMutation = useMutation({
    mutationFn: async (name: string) => {
      const payload = {
        name,
        active_tab: activeTab,
        scope: activeTab === "my" ? "role" : activeTab,
        department_key: activeTab === "department" ? effectiveDeptForQuery || null : null,
        level_filter: levelFilter === "all" ? null : levelFilter,
        health_filter: healthFilter === "all" ? null : healthFilter,
        search_query: searchInput.trim() || null,
        show_closed: showClosed,
        show_archived: showArchived,
      };
      const res = await apiRequest("POST", "/api/priority-saved-views", payload);
      return res.json();
    },
    onSuccess: (created: SavedView) => {
      queryClient.invalidateQueries({ queryKey: ["/api/priority-saved-views"] });
      setSelectedViewId(String(created.id));
      setSaveViewName("");
      toast({ title: `Saved view: ${created.name}` });
    },
    onError: (err) => toast({
      title: "Could not save view",
      description: err instanceof Error ? err.message : "Unknown error",
      variant: "destructive",
    }),
  });

  const deleteViewMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/priority-saved-views/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/priority-saved-views"] });
      setSelectedViewId("");
      toast({ title: "View deleted" });
    },
    onError: (err) => toast({
      title: "Could not delete view",
      description: err instanceof Error ? err.message : "Unknown error",
      variant: "destructive",
    }),
  });

  const searchQuery = useQuery<{ results: PriorityRow[]; totalMatches: number; returned: number }>({
    queryKey: ["/api/priorities/search", debouncedSearch, showClosed, showArchived],
    queryFn: async () => {
      const qs = new URLSearchParams({ q: debouncedSearch, limit: "50" });
      if (showClosed) qs.set("include_closed", "true");
      if (showArchived && isAdmin) qs.set("include_archived", "true");
      const res = await apiRequest("GET", `/api/priorities/search?${qs.toString()}`);
      return res.json();
    },
    enabled: debouncedSearch.length >= 2,
  });

  const { toast } = useToast();
  const activeCreateScope = activeTab === "my" ? "role" : activeTab;
  const canCreateInActiveTab = canPriorityRoleCreateScope(user?.role, activeCreateScope);
  const canUseBulkActions = isAdmin || isDeptHead;

  // Keyboard shortcuts — match Linear/Notion conventions:
  //   /  focus the search input
  //   n  open the create dialog (if the user can create in the active tab)
  //   1/2/3 switch tabs (2 only when dept tab visible)
  //   ?  open the shortcut help dialog
  // Inputs gate handled via tagName / isContentEditable so typing into
  // a text field doesn't trigger the create dialog.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target.isContentEditable) return;
      }
      if (e.key === "/") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('[data-testid="input-search-priorities"]');
        input?.focus();
      } else if (e.key.toLowerCase() === "n") {
        if (canCreateInActiveTab) {
          e.preventDefault();
          setCreateDialogOpen(true);
        }
      } else if (e.key === "1") {
        e.preventDefault();
        setActiveTab("my");
      } else if (e.key === "2" && (isDeptHead || isAdmin)) {
        e.preventDefault();
        setActiveTab("department");
      } else if (e.key === "3") {
        e.preventDefault();
        setActiveTab("company");
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutHelpOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canCreateInActiveTab, isDeptHead, isAdmin]);
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

  // Bulk endpoints (server/departments/priority-strategic-routes.ts ::
  // /api/priorities/bulk/{close,escalate,assign}). Each runs in a single
  // transaction server-side and returns per-id outcomes so we can show
  // a "4 closed, 1 skipped (already terminal)" toast instead of just
  // success/error.
  type BulkResponse = {
    processed: number;
    total: number;
    results: Array<{ id: number; ok: boolean; error?: string }>;
  };
  const summarizeBulk = (r: BulkResponse, verb: string) => {
    if (r.processed === r.total) {
      return { title: `${verb} ${r.processed}` };
    }
    return {
      title: `${verb} ${r.processed} of ${r.total}`,
      description: r.results.filter((x) => !x.ok).map((x) => `#${x.id}: ${x.error}`).join(", "),
    };
  };

  const bulkCloseMutation = useMutation({
    mutationFn: async (ids: number[]): Promise<BulkResponse> => {
      const res = await apiRequest("POST", "/api/priorities/bulk/close", { ids });
      return res.json();
    },
    onSuccess: (r) => {
      toast(summarizeBulk(r, "Closed"));
      clearBulkSelection();
      invalidateAll();
    },
    onError: (err) => toast({ title: "Bulk close failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  const bulkEscalateMutation = useMutation({
    mutationFn: async (ids: number[]): Promise<BulkResponse> => {
      const res = await apiRequest("POST", "/api/priorities/bulk/escalate", { ids, reason: "manual" });
      return res.json();
    },
    onSuccess: (r) => {
      toast(summarizeBulk(r, "Escalated"));
      clearBulkSelection();
      invalidateAll();
    },
    onError: (err) => toast({ title: "Bulk escalate failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  const bulkReassignMutation = useMutation({
    mutationFn: async ({ ids, userId }: { ids: number[]; userId: number }): Promise<BulkResponse> => {
      const res = await apiRequest("POST", "/api/priorities/bulk/assign", { ids, assigned_user_id: userId });
      return res.json();
    },
    onSuccess: (r) => {
      toast(summarizeBulk(r, "Reassigned"));
      clearBulkSelection();
      setBulkReassignOpen(false);
      invalidateAll();
    },
    onError: (err) => toast({ title: "Bulk reassign failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
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

  // Tab-level summary stats — surfaces "where is the heat" without
  // the user having to scroll the cards. All values derived from the
  // already-loaded query data; no extra network. The strip shows
  // for the active tab only.
  const tabSummary = useMemo(() => {
    const open = activeData.filter((p) => !isPriorityTerminalStatus(p.status));
    const escalated = open.filter((p) => p.escalated);
    const critical = open.filter((p) => p.severity === "critical");
    const atRisk = open.filter((p) => p.effectiveHealth === "at_risk" || p.effectiveHealth === "critical");
    const dueForReview = open.filter((p) => p.dueForReview);
    const now = Date.now();
    const weekFromNow = now + 7 * 24 * 60 * 60 * 1000;
    const dueThisWeek = open.filter((p) => {
      if (!p.dueDate) return false;
      const t = new Date(p.dueDate).getTime();
      return Number.isFinite(t) && t > now && t <= weekFromNow;
    });
    return {
      open: open.length,
      critical: critical.length,
      atRisk: atRisk.length,
      escalated: escalated.length,
      dueForReview: dueForReview.length,
      dueThisWeek: dueThisWeek.length,
      closed: closedData.length,
    };
  }, [activeData, closedData]);

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
        // Floating pill anchored bottom-center — follows the user as
        // they scroll through cards. Style mirrors the Linear/Gmail
        // pattern: dark high-contrast surface, primary actions on the
        // right, dismiss on the left.
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 shadow-lg flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900 text-white text-sm animate-in slide-in-from-bottom-4 fade-in duration-200"
          role="region"
          aria-label="Bulk actions"
          data-testid="bulk-action-bar"
        >
          <span className="font-medium tabular-nums">{bulkSize} selected</span>
          <span className="w-px h-5 bg-slate-700 mx-1" aria-hidden="true" />
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 text-white hover:bg-slate-800"
              onClick={runBulkClose}
              disabled={bulkCloseMutation.isPending}
            >
              {bulkCloseMutation.isPending ? "Closing…" : "Close"}
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 text-amber-300 hover:bg-slate-800 hover:text-amber-200"
              onClick={runBulkEscalate}
              disabled={bulkEscalateMutation.isPending}
            >
              {bulkEscalateMutation.isPending ? "Escalating…" : "Escalate"}
            </Button>
          )}
          {isDeptHead && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 text-white hover:bg-slate-800"
              onClick={() => setBulkReassignOpen(true)}
            >
              Reassign…
            </Button>
          )}
          <span className="w-px h-5 bg-slate-700 mx-1" aria-hidden="true" />
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 text-slate-300 hover:bg-slate-800 hover:text-white"
            onClick={clearBulkSelection}
            aria-label="Clear selection"
          >
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
              {(myPriorities.length + (myWorkFeedQuery.data?.counts?.tasks ?? 0)) > 0 && (
                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                  {myPriorities.length + (myWorkFeedQuery.data?.counts?.tasks ?? 0)}
                </span>
              )}
            </TabsTrigger>
            {(isDeptHead || isAdmin) && (
              <TabsTrigger value="department" className="text-xs" data-testid="tab-priorities-department">
                <Users className="w-3.5 h-3.5 mr-1" />
                {SCOPE_LABELS.department}
                {(deptQuery.data?.length ?? 0) > 0 && (
                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                    {deptQuery.data?.length}
                  </span>
                )}
              </TabsTrigger>
            )}
            <TabsTrigger value="company" className="text-xs" data-testid="tab-priorities-company">
              <Flag className="w-3.5 h-3.5 mr-1" />
              {SCOPE_LABELS.company}
              {(companyQuery.data?.length ?? 0) > 0 && (
                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                  {companyQuery.data?.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <Select value={selectedViewId} onValueChange={applyView}>
              <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-saved-view">
                <SelectValue placeholder={(savedViewsQuery.data?.length ?? 0) > 0 ? "Saved views" : "No saved views"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— Default —</SelectItem>
                {(savedViewsQuery.data ?? []).map((v) => (
                  <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                ))}
                {(savedViewsQuery.data?.length ?? 0) === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground italic">
                    Use "Save current as view…" below to add one
                  </div>
                )}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setSearchInput(""); }}
                placeholder="Search priorities..."
                aria-label="Search priorities"
                data-testid="input-search-priorities"
                className="h-8 pl-7 pr-7 w-[220px] text-xs"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              {/* Search results dropdown — attached to the input, doesn't
                  push the tabs down. Esc clears. Click result navigates.
                  Compact rows: title + scope chip + dept hint. */}
              {debouncedSearch.length >= 2 && (
                <div
                  className="absolute z-30 top-full left-0 mt-1 w-[480px] max-h-[60vh] overflow-y-auto rounded-md border border-border bg-background shadow-lg"
                  data-testid="search-results-panel"
                >
                  <div className="px-3 py-2 border-b text-xs text-muted-foreground flex items-center justify-between">
                    <span>
                      {searchQuery.isFetching ? "Searching…" : (
                        searchQuery.data
                          ? `${searchQuery.data.totalMatches} match${searchQuery.data.totalMatches === 1 ? "" : "es"} for "${debouncedSearch}"`
                          : "—"
                      )}
                    </span>
                    <button
                      type="button"
                      className="hover:text-foreground"
                      onClick={() => setSearchInput("")}
                      aria-label="Close search results"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="py-1">
                    {(searchQuery.data?.results ?? []).length === 0 && !searchQuery.isFetching && (
                      <p className="px-3 py-4 text-xs text-muted-foreground text-center">No priorities match "{debouncedSearch}"</p>
                    )}
                    {(searchQuery.data?.results ?? []).map((p) => (
                      <Link
                        key={p.id}
                        href={`/priorities/${p.id}`}
                        onClick={() => setSearchInput("")}
                      >
                        <div className="flex items-center gap-2 px-3 py-2 hover:bg-muted/60 text-xs cursor-pointer">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${
                            p.effectiveHealth === "critical" ? "bg-red-500"
                              : p.effectiveHealth === "at_risk" ? "bg-amber-500"
                              : "bg-emerald-500"
                          }`} aria-hidden="true" />
                          <span className="font-medium truncate flex-1">{p.title}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 shrink-0">
                            {p.scope}
                          </span>
                          {p.departmentKey && (
                            <span className="text-[10px] text-muted-foreground shrink-0">{p.departmentKey}</span>
                          )}
                          {p.escalated && (
                            <span className="text-[10px] text-red-600 font-medium shrink-0">!</span>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                  {searchQuery.data && searchQuery.data.returned < searchQuery.data.totalMatches && (
                    <div className="px-3 py-2 text-[10px] text-muted-foreground text-center border-t">
                      Showing first {searchQuery.data.returned} of {searchQuery.data.totalMatches}. Refine your search to see more.
                    </div>
                  )}
                </div>
              )}
            </div>
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
            {/* Filters popover — collapses level, health, show closed, show archived behind a single trigger with a chip count. Frees up the filter row for the things users actually use every visit (search, saved views, dept). */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs" data-testid="filters-trigger">
                  <Filter className="w-3.5 h-3.5 mr-1" />
                  Filters
                  {(() => {
                    const activeCount = [
                      levelFilter !== "all",
                      healthFilter !== "all",
                      showClosed,
                      showArchived && isAdmin,
                    ].filter(Boolean).length;
                    return activeCount > 0 ? (
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-medium">
                        {activeCount}
                      </span>
                    ) : null;
                  })()}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-3">
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium block mb-1">Level</label>
                    <Select value={levelFilter} onValueChange={setLevelFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All levels</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                        <SelectItem value="important">High</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1">Health</label>
                    <Select value={healthFilter} onValueChange={setHealthFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All health</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                        <SelectItem value="at_risk">At risk</SelectItem>
                        <SelectItem value="healthy">Healthy</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 pt-2 border-t">
                    <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={showClosed}
                        onChange={(e) => setShowClosed(e.target.checked)}
                        className="rounded"
                      />
                      Show closed
                    </label>
                    {isAdmin && (
                      <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={showArchived}
                          onChange={(e) => setShowArchived(e.target.checked)}
                          className="rounded"
                          data-testid="toggle-show-archived"
                        />
                        Show archived
                      </label>
                    )}
                  </div>
                  {(levelFilter !== "all" || healthFilter !== "all" || showClosed || showArchived) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7 w-full"
                      onClick={() => {
                        setLevelFilter("all");
                        setHealthFilter("all");
                        setShowClosed(false);
                        setShowArchived(false);
                      }}
                    >
                      Reset all filters
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            {/* Density toggle — three-state segmented control. Persists in
                localStorage so the choice survives navigation and reloads.
                Hidden on small screens (toggle is meaningless under 2-col
                grid) but still keyboard-reachable via the popover above. */}
            <div className="hidden md:inline-flex items-center rounded-md border border-input bg-background overflow-hidden" role="group" aria-label="List density">
              {([
                { value: "cards", label: "Cards", Icon: LayoutGrid },
                { value: "compact", label: "Compact", Icon: List },
                { value: "dense", label: "Dense", Icon: Rows3 },
              ] as const).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDensity(value)}
                  className={`h-8 px-2 text-xs flex items-center gap-1 ${density === value ? "bg-emerald-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
                  aria-pressed={density === value}
                  title={`${label} density`}
                  data-testid={`density-${value}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">{label}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 ml-auto">
              <Input
                value={saveViewName}
                onChange={(e) => setSaveViewName(e.target.value)}
                placeholder="Save current as view…"
                className="h-8 text-xs w-[180px]"
                aria-label="Save current view as name"
                data-testid="input-save-view-name"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={!saveViewName.trim() || saveViewMutation.isPending}
                onClick={() => saveViewMutation.mutate(saveViewName.trim())}
                data-testid="button-save-view"
              >
                {saveViewMutation.isPending ? "Saving…" : "Save view"}
              </Button>
              {selectedViewId && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs text-muted-foreground hover:text-red-600"
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Delete this saved view?",
                      description: "Filters in the view will be lost. The priorities themselves are not affected.",
                      confirmLabel: "Delete view",
                      destructive: true,
                    });
                    if (ok) deleteViewMutation.mutate(Number(selectedViewId));
                  }}
                  disabled={deleteViewMutation.isPending}
                >
                  Delete view
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Search results moved to a compact dropdown attached to the
            search input itself (above). No longer a takeover panel. */}

        {/* Summary stat strip — derived from active-tab data, no extra network. */}
        {tabSummary.open > 0 && (
          <div className="flex items-center gap-4 flex-wrap text-xs mb-4 px-3 py-2 rounded-md bg-slate-50 border border-slate-200" data-testid="tab-summary-strip">
            <span className="font-medium text-foreground">{tabSummary.open} active</span>
            {tabSummary.critical > 0 && (
              <span className="text-red-700">{tabSummary.critical} critical</span>
            )}
            {tabSummary.atRisk > 0 && (
              <span className="text-amber-700">{tabSummary.atRisk} at risk</span>
            )}
            {tabSummary.escalated > 0 && (
              <span className="text-orange-700">{tabSummary.escalated} escalated</span>
            )}
            {tabSummary.dueForReview > 0 && (
              <span className="text-amber-700">{tabSummary.dueForReview} due for review</span>
            )}
            {tabSummary.dueThisWeek > 0 && (
              <span className="text-foreground">{tabSummary.dueThisWeek} due this week</span>
            )}
            {tabSummary.closed > 0 && showClosed && (
              <span className="text-muted-foreground ml-auto">{tabSummary.closed} closed</span>
            )}
          </div>
        )}

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
              density={density}
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
              density={density}
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
            density={density}
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

      <Dialog open={shortcutHelpOpen} onOpenChange={setShortcutHelpOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {[
              ["/", "Focus the search bar"],
              ["n", "New priority"],
              ["1", "My priorities"],
              ["2", "Department priorities"],
              ["3", "Company priorities"],
              ["Esc", "Clear search / close dialog"],
              ["?", "Show this help"],
            ].map(([k, desc]) => (
              <div key={k} className="flex items-center justify-between">
                <span className="text-muted-foreground">{desc}</span>
                <kbd className="px-2 py-1 text-[11px] font-mono rounded border bg-muted text-foreground">{k}</kbd>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-3 pt-3 border-t">
            Shortcuts are ignored while typing into a text field.
          </p>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </PageShell>
  );
}
