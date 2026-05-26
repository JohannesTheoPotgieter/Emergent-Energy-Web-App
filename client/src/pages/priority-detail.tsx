import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCircle2,
  DollarSign,
  FolderOpen,
  GitBranch,
  History,
  ListTodo,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { invalidatePriorityQueries } from "@/lib/priority-query-invalidation";
import {
  canPriorityRoleEditPriority,
  canPriorityRoleEscalatePriority,
  canPriorityRoleUseAdminAction,
  departmentLabel,
  isDepartmentHeadRole,
  isPriorityTerminalStatus,
  type PriorityScope,
} from "@/config/priorities";
import { ROLE_DEPARTMENT_MAP } from "@shared/schema/users";
import { ProjectLinker } from "@/components/priorities/ProjectLinker";
import { type ProgressSourceValue } from "@/components/priorities/ProgressSourcePicker";
import {
  PriorityFormFields,
  emptyPriorityForm,
  buildPriorityPayload,
  type PriorityFormState,
} from "@/components/priorities/PriorityFormFields";
import { BreakDownDialog } from "@/components/priorities/BreakDownDialog";
import { useConfirmDialog } from "@/components/priorities/ConfirmActionDialog";
import { EscalateDialog } from "@/components/priorities/EscalateDialog";
import { ActivityIcon, formatActivitySentence } from "@/lib/priority-activity-formatter";
import type {
  LinkedProject,
  PriorityActivityRow,
  PriorityDetail,
  PriorityRow,
} from "@/lib/priority-types";

const HEALTH_DOT: Record<string, string> = {
  critical: "bg-red-500",
  at_risk: "bg-amber-500",
  healthy: "bg-emerald-500",
};

const SEVERITY_BADGE: Record<string, { label: string; className: string }> = {
  critical: { label: "Critical", className: "bg-red-100 text-red-700" },
  important: { label: "High", className: "bg-amber-100 text-amber-700" },
  normal: { label: "Normal", className: "bg-gray-100 text-gray-600" },
};

const RAG_BADGE: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  orange: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
};

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `R ${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `R ${(value / 1_000).toFixed(0)}K`;
  return `R ${value.toFixed(0)}`;
}

/** Short, human-friendly date — handles ISO `YYYY-MM-DD` and full Date strings. */
function formatDateShort(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function prettyStatus(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusBadgeClass(s: string | null | undefined): string {
  const k = (s || "").toLowerCase().replace(/[_-]+/g, " ").trim();
  if (k.includes("block")) return "bg-red-50 text-red-700 border-red-200";
  if (k.includes("progress") || k === "open" || k === "active") return "bg-blue-50 text-blue-700 border-blue-200";
  if (k === "complete" || k === "completed" || k === "done" || k === "qc approved") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (k === "cancelled" || k === "canceled") return "bg-gray-100 text-gray-500 border-gray-200";
  if (k.startsWith("not")) return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-gray-100 text-gray-600 border-gray-200";
}

/**
 * Date-only diff in days. Uses ISO YYYY-MM-DD comparison so it doesn't flip
 * across the UTC/local boundary (see Tier 1 bug-fix notes).
 */
function daysRemaining(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const due = Date.parse(dateStr + "T00:00:00Z");
  const today = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(due) || Number.isNaN(today)) return null;
  return Math.ceil((due - today) / 86_400_000);
}

interface ProjectLikeChild extends PriorityRow {
  /** enriched-server shape — children share the PriorityRow envelope. */
  id: number;
}

interface MergedTaskOrApproval {
  id: number;
  title: string;
  status: string | null;
  projectName: string;
  assignee: string | null;
  dueDate: string | null;
  endDate?: string | null;
  itemType: "task" | "approval";
}

// ── Activity helpers (re-exported from lib for use in JSX below) ──
export default function PriorityDetailPage() {
  const [, params] = useRoute("/priorities/:id");
  const priorityId = params?.id ? parseInt(params.id) : 0;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [breakDownDialogOpen, setBreakDownDialogOpen] = useState(false);
  const [escalateDialogOpen, setEscalateDialogOpen] = useState(false);
  const [showProjectEvents, setShowProjectEvents] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [editForm, setEditForm] = useState<PriorityFormState>(emptyPriorityForm);
  const [progressSource, setProgressSource] = useState<ProgressSourceValue>({
    type: "manual",
    ref: null,
    manualProgress: "",
  });

  const userDepartment = user?.role ? ROLE_DEPARTMENT_MAP[user.role] : null;
  const canUsePriorityAdminActions = canPriorityRoleUseAdminAction(user?.role);
  const canUseAdvancedPriorityFields = canUsePriorityAdminActions || isDepartmentHeadRole(user?.role);
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const { data: priority, isLoading, isError, error, refetch } = useQuery<PriorityDetail>({
    queryKey: [`/api/priorities/${priorityId}`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/priorities/${priorityId}`);
      return res.json();
    },
    enabled: priorityId > 0,
  });

  const hasAnyProjects = priorityId > 0
    && ((priority?.rolledUp?.projectCount ?? 0) > 0 || !!priority?.hasProjects);

  const subResourceFetcher = async <T,>(url: string, fallback: T): Promise<T> => {
    try {
      const res = await apiRequest("GET", url);
      return (await res.json()) as T;
    } catch {
      return fallback;
    }
  };

  const { data: tasks = [] } = useQuery<MergedTaskOrApproval[]>({
    queryKey: [`/api/priorities/${priorityId}/tasks`],
    queryFn: () => subResourceFetcher(`/api/priorities/${priorityId}/tasks`, [] as MergedTaskOrApproval[]),
    enabled: hasAnyProjects,
  });

  const { data: pendingApprovals = [] } = useQuery<MergedTaskOrApproval[]>({
    queryKey: [`/api/priorities/${priorityId}/approvals`],
    queryFn: () => subResourceFetcher(`/api/priorities/${priorityId}/approvals`, [] as MergedTaskOrApproval[]),
    enabled: hasAnyProjects,
  });

  interface ProjectUpdateRow {
    projectId: number;
    projectName: string;
    phase: string | null;
    ragStatus: string | null;
    ragComment: string | null;
    phaseNotes: string | null;
    date: string | null;
  }
  const { data: updates = [] } = useQuery<ProjectUpdateRow[]>({
    queryKey: [`/api/priorities/${priorityId}/updates`],
    queryFn: () => subResourceFetcher(`/api/priorities/${priorityId}/updates`, [] as ProjectUpdateRow[]),
    enabled: hasAnyProjects,
  });

  const { data: children = [] } = useQuery<ProjectLikeChild[]>({
    queryKey: [`/api/priorities/${priorityId}/children`],
    queryFn: () => subResourceFetcher(`/api/priorities/${priorityId}/children`, [] as ProjectLikeChild[]),
    enabled: priorityId > 0,
  });

  const { data: activity = [] } = useQuery<PriorityActivityRow[]>({
    queryKey: [`/api/priorities/${priorityId}/activity`, showProjectEvents],
    queryFn: () => subResourceFetcher(
      `/api/priorities/${priorityId}/activity${showProjectEvents ? "?include_project_events=true" : ""}`,
      [] as PriorityActivityRow[],
    ),
    enabled: priorityId > 0,
  });

  interface PriorityComment {
    id: number;
    priorityId: number;
    authorUserId: number | null;
    authorName: string | null;
    body: string;
    editedAt: string | null;
    createdAt: string;
  }
  const { data: comments = [], refetch: refetchComments } = useQuery<PriorityComment[]>({
    queryKey: [`/api/priorities/${priorityId}/comments`],
    queryFn: () => subResourceFetcher(`/api/priorities/${priorityId}/comments`, [] as PriorityComment[]),
    enabled: priorityId > 0,
  });

  const { data: watchStatus } = useQuery<{ watching: boolean }>({
    queryKey: [`/api/priorities/${priorityId}/watched`],
    queryFn: () => subResourceFetcher(`/api/priorities/${priorityId}/watched`, { watching: false }),
    enabled: priorityId > 0 && !!user?.id,
  });
  const watching = watchStatus?.watching ?? false;

  const invalidateDetail = () => {
    void invalidatePriorityQueries(queryClient, priorityId);
  };

  const escalateMutation = useMutation({
    mutationFn: ({ reason, note }: { reason: string; note?: string }) =>
      apiRequest("POST", `/api/priorities/${priorityId}/escalate`, { reason, ...(note ? { note } : {}) }),
    onSuccess: () => {
      setEscalateDialogOpen(false);
      invalidateDetail();
    },
    onError: (err) => toast({ title: "Escalation failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  const reopenMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/priorities/${priorityId}/reopen`, {}),
    onSuccess: () => { toast({ title: "Priority reopened" }); invalidateDetail(); },
    onError: (err) => toast({ title: "Could not reopen", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  const watchMutation = useMutation({
    mutationFn: () => apiRequest(watching ? "DELETE" : "POST", `/api/priorities/${priorityId}/watch`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}/watched`] });
      toast({ title: watching ? "Unwatched" : "Watching priority" });
    },
    onError: (err) => toast({ title: "Could not update watch", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  const addCommentMutation = useMutation({
    mutationFn: (body: string) => apiRequest("POST", `/api/priorities/${priorityId}/comments`, { body }),
    onSuccess: () => {
      setCommentBody("");
      refetchComments();
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}/activity`] });
    },
    onError: (err) => toast({ title: "Could not post comment", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: number) => apiRequest("DELETE", `/api/priorities/${priorityId}/comments/${commentId}`),
    onSuccess: () => refetchComments(),
    onError: (err) => toast({ title: "Could not delete comment", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  const unlinkMutation = useMutation({
    mutationFn: async (projectId: number) => {
      await apiRequest("DELETE", `/api/priorities/${priorityId}/projects/${projectId}`);
    },
    onSuccess: () => {
      invalidateDetail();
      toast({ title: "Project unlinked" });
    },
    onError: (err) => toast({ title: "Could not unlink project", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  const updatePriorityMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPriorityPayload(editForm, { includeStatus: true });
      if (!canUseAdvancedPriorityFields) {
        delete payload.scope;
        delete payload.department_key;
        delete payload.owner_user_id;
        delete payload.accountable_exec_id;
        delete payload.assigned_user_id;
        delete payload.parent_id;
      }
      if (canUseAdvancedPriorityFields) {
        // Linked-source progress overrides any manual % from the form.
        payload.manual_progress = progressSource.type === "manual" && progressSource.manualProgress
          ? parseInt(progressSource.manualProgress, 10)
          : null;
        payload.progress_source_type = progressSource.type;
        payload.progress_source_ref = progressSource.type === "manual" ? null : progressSource.ref;
      }
      await apiRequest("PUT", `/api/priorities/${priorityId}`, payload);
    },
    onSuccess: () => {
      invalidateDetail();
      toast({ title: "Priority updated" });
      setEditDialogOpen(false);
    },
    onError: (err) => toast({ title: "Could not save changes", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  const closePriorityMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/priorities/${priorityId}`, { status: "closed" });
    },
    onSuccess: () => {
      invalidateDetail();
      toast({ title: "Priority closed" });
    },
    onError: (err) => toast({ title: "Could not close priority", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/priorities/${priorityId}`);
    },
    onSuccess: () => {
      void invalidatePriorityQueries(queryClient);
      toast({ title: "Priority archived", description: "It's removed from default views. Restore from the archived filter." });
    },
    onError: (err) => {
      const detail = err instanceof Error ? err.message : "Unknown error";
      const friendly = /HAS_ACTIVE_CHILDREN/i.test(detail)
        ? "Close or archive the sub-priorities first."
        : detail;
      toast({ title: "Could not archive", description: friendly, variant: "destructive" });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/priorities/${priorityId}/restore`);
    },
    onSuccess: () => {
      void invalidatePriorityQueries(queryClient);
      invalidateDetail();
      toast({ title: "Priority restored" });
    },
    onError: (err) => toast({ title: "Could not restore", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/priorities/${priorityId}/review`);
    },
    onSuccess: () => {
      invalidateDetail();
      void invalidatePriorityQueries(queryClient);
      toast({ title: "Marked reviewed" });
    },
    onError: (err) => toast({ title: "Could not mark reviewed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <PageShell><PageError title="Unable to load priority" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></PageShell>;

  if (!priority) {
    return <PageShell><p className="text-muted-foreground">Priority not found</p></PageShell>;
  }

  const canEditPriority = canPriorityRoleEditPriority(
    { role: user?.role, userId: user?.id, departmentKey: userDepartment },
    {
      scope: priority.scope,
      departmentKey: (priority as any).departmentKey ?? null,
      ownerUserId: priority.owner?.id ?? (priority as any).ownerUserId ?? null,
      assignedUserId: (priority as any).assignedUserId ?? null,
    },
  );
  const canEscalateThisPriority = canPriorityRoleEscalatePriority(
    { role: user?.role, userId: user?.id, departmentKey: userDepartment },
    {
      scope: priority.scope,
      departmentKey: (priority as any).departmentKey ?? null,
      ownerUserId: priority.owner?.id ?? (priority as any).ownerUserId ?? null,
      assignedUserId: (priority as any).assignedUserId ?? null,
    },
  );
  const editScopeOptions: readonly PriorityScope[] = canUsePriorityAdminActions
    ? ["company", "department", "role"]
    : canUseAdvancedPriorityFields
      ? ["department", "role"]
      : [((priority.scope || "role") as PriorityScope)];

  const openEditDialog = () => {
    setEditForm({
      ...emptyPriorityForm,
      title: priority.title || "",
      description: priority.description || "",
      scope: priority.scope || "company",
      severity: priority.severity || "normal",
      status: priority.status || "active",
      horizon: (priority as any).horizon || "quarter",
      due_date: priority.dueDate || "",
      target_outcome: priority.targetOutcome || "",
      next_action: (priority as any).nextAction || "",
      definition_of_done: (priority as any).definitionOfDone || "",
      manual_health: priority.manualHealth || "",
      manual_progress: priority.manualProgress != null ? String(priority.manualProgress) : "",
      department_key: (priority as any).departmentKey || "",
      owner_user_id: priority.owner?.id != null ? String(priority.owner.id) : "",
      accountable_exec_id: (priority as any).accountableExecId != null ? String((priority as any).accountableExecId) : "",
      assigned_user_id: (priority as any).assignedUserId != null ? String((priority as any).assignedUserId) : "",
      parent_id: (priority as any).parentId != null ? String((priority as any).parentId) : "",
      review_cadence_days: (priority as any).reviewCadenceDays != null ? String((priority as any).reviewCadenceDays) : "",
    });
    setProgressSource({
      type: ((priority.progressSourceType as any) || "manual") as ProgressSourceValue["type"],
      ref: (priority.progressSourceRef as any) || null,
      manualProgress: priority.manualProgress != null ? String(priority.manualProgress) : "",
    });
    setEditDialogOpen(true);
  };

  const sev = SEVERITY_BADGE[priority.severity] || SEVERITY_BADGE.normal;
  const days = daysRemaining(priority.dueDate);
  const linkedProjects = priority.linkedProjects || [];
  // Prefer rolled-up totals (this priority + descendants) so the drill-down
  // is a true single pane of glass. Falls back to direct totals for older
  // API responses.
  const rollup = priority.rolledUp || null;
  const totalRevenue = rollup?.totalRevenue ?? priority.totalRevenue ?? 0;
  const totalCos = rollup?.totalCos ?? priority.totalCos ?? 0;
  const totalGp = rollup?.totalGp ?? priority.totalGp ?? 0;
  const displayProjectCount = rollup?.projectCount ?? linkedProjects.length;
  const directProjectCount = rollup?.directProjectCount ?? priority.directProjectCount ?? displayProjectCount;
  const descendantCount = rollup?.descendantPriorityCount ?? priority.descendantPriorityCount ?? 0;
  const indirectProjectCount = Math.max(displayProjectCount - directProjectCount, 0);
  const gpMargin = totalRevenue > 0 ? ((totalGp / totalRevenue) * 100).toFixed(1) : "0.0";

  // Merged tasks + approvals
  const mergedItems = [
    ...tasks.map((t) => ({ ...t, itemType: "task" as const })),
    ...pendingApprovals.map((a) => ({ ...a, itemType: "approval" as const })),
  ].sort((a, b) => {
    const aBlocked = a.status?.toLowerCase().includes("block") ? 0 : 1;
    const bBlocked = b.status?.toLowerCase().includes("block") ? 0 : 1;
    if (aBlocked !== bBlocked) return aBlocked - bBlocked;
    const aDate = a.dueDate || a.endDate || "";
    const bDate = b.dueDate || b.endDate || "";
    return aDate.localeCompare(bDate);
  });

  return (
    <PageLayout
      data-testid="priority-detail-page"
      header={
        <PageHeader
          breadcrumbs={[
            { label: "Home", href: "/" },
            { label: "Priorities", href: "/priorities" },
            { label: priority.title },
          ]}
          title={priority.title}
          status={
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${HEALTH_DOT[priority.effectiveHealth] || HEALTH_DOT.healthy}`} aria-label={`health: ${priority.effectiveHealth}`} />
              <Badge variant="secondary" className={`text-[10px] ${sev.className}`}>{sev.label}</Badge>
            </div>
          }
          actions={
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-muted-foreground hover:text-foreground"
                title={watching ? "Unwatch — stop receiving escalation alerts" : "Watch — get notified on escalation or status changes"}
                onClick={() => watchMutation.mutate()}
                disabled={watchMutation.isPending}
                data-testid="btn-watch-priority"
              >
                {watching ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
              </Button>
              {canEditPriority && <Button size="sm" variant="outline" onClick={openEditDialog} data-testid="btn-edit-priority">Edit priority</Button>}
              {canUsePriorityAdminActions && isPriorityTerminalStatus(priority.status) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reopenMutation.mutate()}
                  disabled={reopenMutation.isPending}
                  data-testid="btn-reopen-priority"
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  {reopenMutation.isPending ? "Reopening..." : "Reopen"}
                </Button>
              )}
              {canEditPriority && !isPriorityTerminalStatus(priority.status) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Close this priority?",
                      description: "It will be soft-closed and hidden from the active list.",
                      confirmLabel: "Close",
                      destructive: true,
                    });
                    if (ok) closePriorityMutation.mutate();
                  }}
                  disabled={closePriorityMutation.isPending}
                  data-testid="btn-close-priority"
                >
                  {closePriorityMutation.isPending ? "Closing..." : "Close"}
                </Button>
              )}
            </div>
          }
        />
      }
    >
      {/* Description + meta + cascade info */}
      <div>
        {priority.description && (
          <p className="text-sm text-muted-foreground max-w-2xl">{priority.description}</p>
        )}

        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2 flex-wrap">
          {priority.owner && <span>Owner: <span className="text-foreground font-medium">{priority.owner.name}</span></span>}
          {priority.accountableExec && <span>Exec: <span className="text-foreground font-medium">{priority.accountableExec.name}</span></span>}
          {priority.dueDate && (
            <span className={days != null && days <= 7 ? "text-red-600" : days != null && days <= 14 ? "text-amber-600" : ""}>
              Due: {priority.dueDate} {days != null && `(${days < 0 ? `${Math.abs(days)}d overdue` : `${days}d remaining`})`}
            </span>
          )}
          <span>Progress: {priority.effectiveProgress}%</span>
        </div>

        {/* Cascade info */}
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {priority.parentTitle && priority.parentId && (
            <span className="text-xs text-muted-foreground">
              Part of:{" "}
              <Link href={`/priorities/${priority.parentId}`}>
                <span className="text-primary hover:underline cursor-pointer font-medium">{priority.parentTitle}</span>
              </Link>
            </span>
          )}
          {priority.scope && priority.scope !== "company" && (
            <Badge variant="secondary" className="text-[10px] bg-blue-100 text-blue-700 capitalize">
              {priority.scope === "department" ? "Department" : "Role"}
            </Badge>
          )}
          {priority.escalated && (
            <Badge variant="secondary" className="text-[10px] bg-red-100 text-red-700 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Escalated{priority.escalationReason ? `: ${priority.escalationReason}` : ""}
            </Badge>
          )}
          {priority.childCount > 0 && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <GitBranch className="w-3 h-3" /> {priority.childCount} sub-priorit{priority.childCount === 1 ? "y" : "ies"}
            </span>
          )}
          {(canEscalateThisPriority || canUsePriorityAdminActions) && (
            <div className="flex items-center gap-2 ml-auto">
              {canEscalateThisPriority && (priority.scope === "role" || priority.scope === "department") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  onClick={() => setEscalateDialogOpen(true)}
                  disabled={escalateMutation.isPending}
                >
                  {escalateMutation.isPending ? "Escalating..." : "Escalate"}
                </Button>
              )}
              {canUsePriorityAdminActions && (priority.scope === "company" || priority.scope === "department") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  onClick={() => setBreakDownDialogOpen(true)}
                >
                  <GitBranch className="w-3 h-3 mr-1" /> Break Down
                </Button>
              )}
              {canEditPriority && (priority as any).reviewCadenceDays && (
                <Button
                  size="sm"
                  variant={(priority as any).dueForReview ? "default" : "outline"}
                  className="text-xs h-7"
                  onClick={() => reviewMutation.mutate()}
                  disabled={reviewMutation.isPending}
                  data-testid="button-mark-reviewed"
                >
                  {reviewMutation.isPending ? "Saving…" : ((priority as any).dueForReview ? "Mark reviewed" : "Re-review now")}
                </Button>
              )}
              {canUsePriorityAdminActions && !(priority as any).deletedAt && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 text-muted-foreground hover:text-red-600"
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Archive this priority?",
                      description:
                        "It will be hidden from default views but kept for audit. Admins can restore it from the archived filter. Active sub-priorities must be closed first.",
                      confirmLabel: "Archive",
                      destructive: true,
                    });
                    if (ok) archiveMutation.mutate();
                  }}
                  disabled={archiveMutation.isPending}
                >
                  {archiveMutation.isPending ? "Archiving..." : "Archive"}
                </Button>
              )}
              {canUsePriorityAdminActions && (priority as any).deletedAt && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  onClick={() => restoreMutation.mutate()}
                  disabled={restoreMutation.isPending}
                >
                  {restoreMutation.isPending ? "Restoring..." : "Restore"}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-3 max-w-md">
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                priority.effectiveHealth === "critical" ? "bg-red-500" :
                priority.effectiveHealth === "at_risk" ? "bg-amber-500" : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(priority.effectiveProgress, 100)}%` }}
            />
          </div>
          {priority.progressSource && (
            <p
              className="text-[11px] text-muted-foreground mt-1"
              data-testid="text-progress-source-label"
            >
              <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 mr-1">
                Auto
              </span>
              {priority.progressSource.label} · {priority.progressSource.value}%
            </p>
          )}
        </div>

        {/* Financial summary cards (shown when any project rolls up — direct or via sub-priorities) */}
        {displayProjectCount > 0 && (
          <>
            {indirectProjectCount > 0 && (
              <p className="text-[11px] text-muted-foreground mt-3 mb-1">
                Rolled up across {displayProjectCount} project{displayProjectCount === 1 ? "" : "s"} —
                {" "}{directProjectCount} directly linked
                {indirectProjectCount > 0 && `, ${indirectProjectCount} via ${descendantCount} sub-priorit${descendantCount === 1 ? "y" : "ies"}`}
              </p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              <KpiTile label="Revenue" value={formatCurrency(totalRevenue)} dim={totalRevenue === 0} />
              <KpiTile label="Cost of Sales" value={formatCurrency(totalCos)} dim={totalCos === 0} />
              <KpiTile label="Gross Profit" value={formatCurrency(totalGp)} dim={totalGp === 0} accent={totalGp > 0 ? "emerald" : totalGp < 0 ? "red" : undefined} />
              <KpiTile label="GP Margin" value={`${gpMargin}%`} dim={totalRevenue === 0} />
            </div>
            {totalRevenue === 0 && totalCos === 0 && (
              <p className="text-[11px] text-muted-foreground italic mt-2">
                No tracker data yet. Once revenue / COS lines are committed for the linked project{displayProjectCount === 1 ? "" : "s"}, totals will appear here automatically.
              </p>
            )}
          </>
        )}

        {displayProjectCount === 0 && (
          <Card className="mt-4 border-dashed">
            <CardContent className="p-4 text-sm text-muted-foreground">
              This is a standalone priority. Link projects — or break it down into sub-priorities — to see derived metrics and financial data.
              {canUsePriorityAdminActions && (
                <Button variant="outline" size="sm" className="ml-2" onClick={() => setLinkDialogOpen(true)}>
                  <Plus className="w-3 h-3 mr-1" /> Link projects
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue={displayProjectCount > 0 ? "projects" : "details"}>
        <TabsList className="bg-muted/60">
          {displayProjectCount > 0 ? (
            <>
              <TabsTrigger value="projects" className="data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5"><FolderOpen className="w-3.5 h-3.5" />Projects</TabsTrigger>
              <TabsTrigger value="financials" className="data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5"><DollarSign className="w-3.5 h-3.5" />Financials</TabsTrigger>
              <TabsTrigger value="chain" className="data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5"><GitBranch className="w-3.5 h-3.5" />Chain</TabsTrigger>
              <TabsTrigger value="tasks" className="data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5"><ListTodo className="w-3.5 h-3.5" />Tasks & Approvals</TabsTrigger>
              <TabsTrigger value="updates" className="data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5"><MessageSquare className="w-3.5 h-3.5" />Updates</TabsTrigger>
              <TabsTrigger value="activity" className="data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5"><History className="w-3.5 h-3.5" />Activity</TabsTrigger>
              <TabsTrigger value="comments" className="data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                Notes{comments.length > 0 && <span className="ml-0.5 text-[10px] text-muted-foreground">({comments.length})</span>}
              </TabsTrigger>
            </>
          ) : (
            <>
              <TabsTrigger value="details" className="data-[state=active]:bg-card data-[state=active]:shadow-sm">Details</TabsTrigger>
              <TabsTrigger value="chain" className="data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5"><GitBranch className="w-3.5 h-3.5" />Chain</TabsTrigger>
              <TabsTrigger value="updates" className="data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5"><MessageSquare className="w-3.5 h-3.5" />Updates</TabsTrigger>
              <TabsTrigger value="activity" className="data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5"><History className="w-3.5 h-3.5" />Activity</TabsTrigger>
              <TabsTrigger value="comments" className="data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                Notes{comments.length > 0 && <span className="ml-0.5 text-[10px] text-muted-foreground">({comments.length})</span>}
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {/* Details tab (standalone) */}
        <TabsContent value="details" className="mt-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              {priority.description && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Description</h3>
                  <p className="text-sm">{priority.description}</p>
                </div>
              )}
              {priority.targetOutcome && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Target Outcome</h3>
                  <p className="text-sm">{priority.targetOutcome}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">Status</span>
                  <p className="font-medium">{priority.status}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Health</span>
                  <p className="font-medium flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${HEALTH_DOT[priority.effectiveHealth] || HEALTH_DOT.healthy}`} />
                    {priority.effectiveHealth}
                  </p>
                </div>
              </div>
              {Array.isArray(priority.healthReasons) && priority.healthReasons.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Health Signals</h3>
                  <ul className="space-y-1">
                    {priority.healthReasons.map((reason, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Projects tab */}
        <TabsContent value="projects" className="mt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Project</th>
                  <th className="pb-2 font-medium">Phase</th>
                  <th className="pb-2 font-medium">PM</th>
                  <th className="pb-2 font-medium">RAG</th>
                  <th className="pb-2 font-medium">% Complete</th>
                  {canUsePriorityAdminActions && <th className="pb-2 font-medium w-8" />}
                </tr>
              </thead>
              <tbody>
                {linkedProjects.map((p: LinkedProject) => {
                  const linkedDirectly = p.linkedDirectly ?? true;
                  return (
                    <tr key={p.id} className="border-b hover:bg-muted/50">
                      <td className="py-2">
                        <Link href={`/project/${encodeURIComponent(p.name)}`}>
                          <span className="text-primary hover:underline cursor-pointer font-medium">{p.name}</span>
                        </Link>
                        {!linkedDirectly && (
                          <Badge variant="secondary" className="ml-2 text-[9px] bg-blue-50 text-blue-700" title="Linked via a sub-priority">
                            via sub-priority
                          </Badge>
                        )}
                      </td>
                      <td className="py-2">{p.phase || "—"}</td>
                      <td className="py-2">{p.pm?.name || "—"}</td>
                      <td className="py-2">
                        {p.ragStatus ? (
                          <Badge variant="secondary" className={`text-[10px] ${RAG_BADGE[p.ragStatus?.toLowerCase()] || ""}`}>
                            {p.ragStatus}
                          </Badge>
                        ) : "—"}
                      </td>
                      <td className="py-2">{p.percentComplete}%</td>
                      {canUsePriorityAdminActions && (
                        <td className="py-2">
                          {linkedDirectly ? (
                            <button
                              onClick={async () => {
                                const ok = await confirm({
                                  title: "Unlink this project?",
                                  description: "The priority's rolled-up totals will recalculate without it.",
                                  confirmLabel: "Unlink",
                                });
                                if (ok) unlinkMutation.mutate(p.id);
                              }}
                              className="text-muted-foreground hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={unlinkMutation.isPending && unlinkMutation.variables === p.id ? "Unlinking…" : "Unlink project"}
                              aria-label={`Unlink ${p.name}`}
                              disabled={unlinkMutation.isPending}
                            >
                              <X className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          ) : (
                            <span className="text-muted-foreground/40" title="Managed by sub-priority — unlink there">
                              <X className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canUsePriorityAdminActions && (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setLinkDialogOpen(true)}>
              <Plus className="w-3 h-3 mr-1" /> Link project
            </Button>
          )}
        </TabsContent>

        {/* Financials tab */}
        <TabsContent value="financials" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile label="Revenue" value={formatCurrency(totalRevenue)} dim={totalRevenue === 0} />
            <KpiTile label="Cost of Sales" value={formatCurrency(totalCos)} dim={totalCos === 0} />
            <KpiTile label="Gross Profit" value={formatCurrency(totalGp)} dim={totalGp === 0} accent={totalGp > 0 ? "emerald" : totalGp < 0 ? "red" : undefined} />
            <KpiTile label="GP Margin" value={`${gpMargin}%`} dim={totalRevenue === 0} />
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left text-[11px] text-muted-foreground uppercase tracking-wide">
                    <th className="px-3 py-2 font-medium">Project</th>
                    <th className="px-3 py-2 font-medium text-right">Revenue</th>
                    <th className="px-3 py-2 font-medium text-right">COS</th>
                    <th className="px-3 py-2 font-medium text-right">GP</th>
                    <th className="px-3 py-2 font-medium text-right">GP%</th>
                    <th className="px-3 py-2 font-medium text-right">Revenue Realised</th>
                    <th className="px-3 py-2 font-medium text-right">COS Realised</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedProjects.map((p: LinkedProject) => (
                    <tr key={p.id} className="border-b last:border-b-0 hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{p.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.totalRevenue ? formatCurrency(p.totalRevenue) : <span className="text-muted-foreground/60">—</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.totalCos ? formatCurrency(p.totalCos) : <span className="text-muted-foreground/60">—</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{p.grossProfit ? formatCurrency(p.grossProfit) : <span className="text-muted-foreground/60">—</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.grossMarginPct ? `${(p.grossMarginPct * 100).toFixed(1)}%` : <span className="text-muted-foreground/60">—</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.revenueRealised ? formatCurrency(p.revenueRealised) : <span className="text-muted-foreground/60">—</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.cosRealised ? formatCurrency(p.cosRealised) : <span className="text-muted-foreground/60">—</span>}</td>
                    </tr>
                  ))}
                  {linkedProjects.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground text-sm">No linked projects.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <p className="text-[10px] text-muted-foreground italic">
            Revenue uses the canonical POC method (revenue recognition amount). COS uses the COS-realised gate. Same source as the Finance and Project Delivery dashboards.
          </p>
        </TabsContent>

        {/* Tasks & Approvals tab — grouped by urgency, list-style */}
        <TabsContent value="tasks" className="mt-4">
          {mergedItems.length === 0 ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">No open tasks or approvals on linked projects.</CardContent></Card>
          ) : (() => {
            // Normalise + bucket every item once. Uses the same dueIso / dueDays
            // logic as before so sorting and the urgency hint stay consistent.
            const enriched = mergedItems.map((item) => {
              const due = item.dueDate || item.endDate;
              const dueIso = due ? (() => {
                const d = new Date(due);
                return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
              })() : null;
              const dueDays = daysRemaining(dueIso);
              // Defensive: workItems.ownerName has historically been used as a
              // free-text field — strip values that obviously look like full
              // Date.toString() output ("Fri Apr 10 2026 00:00:00 GMT+...") so
              // they never bleed into the subtitle.
              const assigneeRaw = (item.assignee || "").trim();
              const assigneeLooksLikeDate = /\b\d{4}\b.*GMT/i.test(assigneeRaw) || /^[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4}/.test(assigneeRaw);
              const assignee = assigneeLooksLikeDate ? "" : assigneeRaw;
              return { ...item, due, dueDays, assignee };
            });
            const overdue = enriched.filter(e => e.dueDays != null && e.dueDays < 0).sort((a, b) => (a.dueDays ?? 0) - (b.dueDays ?? 0));
            const dueSoon = enriched.filter(e => e.dueDays != null && e.dueDays >= 0 && e.dueDays <= 7).sort((a, b) => (a.dueDays ?? 0) - (b.dueDays ?? 0));
            const later   = enriched.filter(e => e.dueDays == null || e.dueDays > 7).sort((a, b) => (a.dueDays ?? 1e9) - (b.dueDays ?? 1e9));

            const renderRow = (item: typeof enriched[number]) => {
              const isOverdue = (item.dueDays ?? 0) < 0;
              const isSoon = item.dueDays != null && item.dueDays >= 0 && item.dueDays <= 7;
              const accent = isOverdue ? "before:bg-red-500" : isSoon ? "before:bg-amber-500" : item.itemType === "approval" ? "before:bg-purple-400" : "before:bg-blue-300";
              return (
                <div
                  key={`${item.itemType}-${item.id}`}
                  data-testid={`row-task-${item.id}`}
                  className={`relative flex items-start gap-3 pl-4 pr-3 py-3 hover:bg-muted/30 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-full ${accent}`}
                >
                  {item.itemType === "task" ? (
                    <ListTodo className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" aria-label="Task" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-purple-500 shrink-0 mt-0.5" aria-label="Approval" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-foreground leading-snug">{item.title}</div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                      {item.projectName && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                          <FolderOpen className="w-3 h-3" />
                          {item.projectName}
                        </span>
                      )}
                      {item.assignee && (
                        <span className="text-[11px] text-foreground/70">{item.assignee}</span>
                      )}
                      <Badge variant="outline" className={`text-[10px] py-0 ${statusBadgeClass(item.status)}`}>{prettyStatus(item.status)}</Badge>
                    </div>
                  </div>
                  <div className="text-right shrink-0 w-24">
                    <div className="text-xs text-foreground tabular-nums">{formatDateShort(item.due)}</div>
                    {item.dueDays != null && (
                      <div className={`text-[10px] ${item.dueDays < 0 ? "text-red-600 font-medium" : item.dueDays <= 7 ? "text-amber-600" : "text-muted-foreground"}`}>
                        {item.dueDays < 0 ? `${Math.abs(item.dueDays)}d overdue` : item.dueDays === 0 ? "today" : `${item.dueDays}d`}
                      </div>
                    )}
                  </div>
                </div>
              );
            };

            // Global cap of 50 across the three urgency buckets — overdue
            // wins, then due-this-week, then later — so the most actionable
            // rows are always visible.
            const CAP = 50;
            const overdueShown = overdue.slice(0, CAP);
            const dueSoonShown = dueSoon.slice(0, Math.max(0, CAP - overdueShown.length));
            const laterShown   = later.slice(0,   Math.max(0, CAP - overdueShown.length - dueSoonShown.length));
            const totalShown = overdueShown.length + dueSoonShown.length + laterShown.length;

            const Section = ({ label, count, tone, items }: { label: string; count: number; tone: string; items: typeof enriched }) => (
              items.length === 0 ? null : (
                <div>
                  <div className={`flex items-center gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide border-b ${tone}`}>
                    <span>{label}</span>
                    <span className="text-muted-foreground font-normal">{count}</span>
                  </div>
                  <div className="divide-y">{items.map(renderRow)}</div>
                </div>
              )
            );

            return (
              <Card className="overflow-hidden">
                <Section label="Overdue"       count={overdue.length} tone="text-red-700 bg-red-50/60"        items={overdueShown} />
                <Section label="Due this week" count={dueSoon.length} tone="text-amber-700 bg-amber-50/60"   items={dueSoonShown} />
                <Section label="Later"         count={later.length}   tone="text-muted-foreground bg-muted/40" items={laterShown} />
                {enriched.length > totalShown && (
                  <p className="text-xs text-muted-foreground text-center py-2 border-t bg-muted/20">Showing first {totalShown} of {enriched.length} items</p>
                )}
              </Card>
            );
          })()}
        </TabsContent>

        {/* Chain tab */}
        <TabsContent value="chain" className="mt-4">
          <div className="space-y-4">
            {/* Parent */}
            {priority.parentTitle && priority.parentId && (
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <GitBranch className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="w-0.5 h-8 bg-border mt-1" />
                </div>
                <div className="pt-1">
                  <p className="text-xs text-muted-foreground mb-0.5">Parent priority</p>
                  <Link href={`/priorities/${priority.parentId}`}>
                    <span className="text-sm font-medium text-primary hover:underline cursor-pointer">{priority.parentTitle}</span>
                  </Link>
                </div>
              </div>
            )}

            {/* Current priority */}
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-primary/10 border-2 border-primary flex items-center justify-center">
                  <span className={`w-3 h-3 rounded-full ${HEALTH_DOT[priority.effectiveHealth] || HEALTH_DOT.healthy}`} />
                </div>
                {children.length > 0 && <div className="w-0.5 h-8 bg-border mt-1" />}
              </div>
              <div className="pt-1">
                <p className="text-xs text-muted-foreground mb-0.5">This priority</p>
                <p className="text-sm font-semibold text-foreground">{priority.title}</p>
                <p className="text-xs text-muted-foreground">{priority.effectiveProgress}% complete</p>
              </div>
            </div>

            {/* Children grouped by department */}
            {children.length > 0 && (
              <div className="pl-11 space-y-3">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Sub-priorities ({children.length})</p>
                {(() => {
                  const grouped: Record<string, ProjectLikeChild[]> = {};
                  children.forEach((c) => {
                    const key = c.departmentKey || "other";
                    if (!grouped[key]) grouped[key] = [];
                    grouped[key].push(c);
                  });
                  return Object.entries(grouped).map(([dept, deptChildren]) => (
                    <div key={dept} className="space-y-1">
                      {Object.keys(grouped).length > 1 && (
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                          {departmentLabel(dept)}
                        </p>
                      )}
                      {deptChildren.map((child) => {
                        const childDays = daysRemaining(child.dueDate);
                        return (
                          <div key={child.id} className="flex items-center gap-3 px-3 py-2 rounded border hover:bg-muted/50 text-sm">
                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${HEALTH_DOT[child.effectiveHealth] || HEALTH_DOT.healthy}`} />
                            <div className="flex-1 min-w-0">
                              <Link href={`/priorities/${child.id}`}>
                                <span className="font-medium text-primary hover:underline cursor-pointer truncate block">{child.title}</span>
                              </Link>
                              {child.childCount > 0 && (
                                <span className="text-xs text-muted-foreground">{child.childCount} sub-item{child.childCount !== 1 ? "s" : ""}</span>
                              )}
                            </div>
                            {child.owner?.name && (
                              <span className="text-xs text-muted-foreground shrink-0">{child.owner.name}</span>
                            )}
                            <span className="text-xs text-muted-foreground shrink-0">{child.effectiveProgress ?? 0}%</span>
                            {child.dueDate && (
                              <span className={`text-xs shrink-0 ${childDays != null && childDays <= 7 ? "text-red-600" : childDays != null && childDays <= 14 ? "text-amber-600" : "text-muted-foreground"}`}>
                                {childDays != null && childDays < 0 ? `${Math.abs(childDays)}d overdue` : childDays != null ? `${childDays}d` : child.dueDate}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ));
                })()}
              </div>
            )}

            {children.length === 0 && !priority.parentId && (
              <p className="text-sm text-muted-foreground py-4 text-center">This priority has no parent or child priorities.</p>
            )}
          </div>
        </TabsContent>

        {/* Updates tab */}
        <TabsContent value="updates" className="mt-4">
          {updates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {displayProjectCount > 0 ? "No updates from linked projects" : "Link projects or break this priority down to see updates"}
            </p>
          ) : (
            <div className="space-y-3">
              {updates.map((u, i) => (
                <Card key={i}>
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{u.projectName}</span>
                      {u.ragStatus && (
                        <Badge variant="secondary" className={`text-[10px] ${RAG_BADGE[u.ragStatus?.toLowerCase()] || ""}`}>
                          {u.ragStatus}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                        {formatDateShort(u.date)}
                      </span>
                    </div>
                    {u.ragComment && <p className="text-sm">{u.ragComment}</p>}
                    {u.phaseNotes && <p className="text-sm text-muted-foreground mt-1">{u.phaseNotes}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Comments / Notes tab */}
        <TabsContent value="comments" className="mt-4">
          <div className="space-y-4">
            {/* Compose */}
            <Card>
              <CardContent className="p-3">
                <Textarea
                  placeholder="Add a note or comment…"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  rows={3}
                  className="text-sm resize-none mb-2"
                  maxLength={5000}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={!commentBody.trim() || addCommentMutation.isPending}
                    onClick={() => addCommentMutation.mutate(commentBody.trim())}
                  >
                    <Send className="w-3.5 h-3.5 mr-1" />
                    {addCommentMutation.isPending ? "Posting…" : "Post"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {comments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No notes yet. Add the first one above.</p>
            ) : (
              <div className="space-y-2">
                {comments.map((c) => (
                  <Card key={c.id}>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-foreground">{c.authorName || "Unknown"}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground tabular-nums">{formatDateTime(c.createdAt)}</span>
                          {(canUsePriorityAdminActions || c.authorUserId === user?.id) && (
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-red-600 transition-colors"
                              title="Delete comment"
                              onClick={async () => {
                                const ok = await confirm({
                                  title: "Delete this comment?",
                                  description: "The comment will be removed from the activity timeline. This cannot be undone.",
                                  confirmLabel: "Delete",
                                  destructive: true,
                                });
                                if (ok) deleteCommentMutation.mutate(c.id);
                              }}
                              disabled={deleteCommentMutation.isPending}
                              aria-label="Delete comment"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Activity tab — append-only audit timeline */}
        <TabsContent value="activity" className="mt-4">
          <div className="flex items-center justify-end mb-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showProjectEvents}
                onChange={(e) => setShowProjectEvents(e.target.checked)}
                className="rounded"
              />
              Show project events (RAG / phase changes)
            </label>
          </div>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No activity recorded yet for this priority.</p>
          ) : (
            <ol className="relative border-l border-border pl-4 space-y-3">
              {activity.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[22px] top-1 w-4 h-4 rounded-full bg-background border border-border flex items-center justify-center">
                    <ActivityIcon action={a.action} />
                  </span>
                  <div className="text-xs">
                    <span className="font-medium text-foreground">{a.actorName || (a.source === "project" ? "Project update" : "Someone")}</span>
                    <span className="text-muted-foreground"> {formatActivitySentence(a)}</span>
                    {a.source === "project" && (
                      <Badge variant="secondary" className="ml-2 text-[9px] bg-blue-50 text-blue-700">project</Badge>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {formatDateTime(a.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
      </Tabs>

      {canUsePriorityAdminActions && (
        <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Link projects to {priority.title}</DialogTitle>
            </DialogHeader>
            <ProjectLinker
              priorityId={priorityId}
              existingProjectIds={linkedProjects.map((p: LinkedProject) => p.id)}
              onDone={() => setLinkDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      )}

      {canEditPriority && (
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Priority</DialogTitle>
            </DialogHeader>
            <PriorityFormFields
              form={editForm}
              patch={(delta) => setEditForm((prev) => ({ ...prev, ...delta }))}
              mode="edit"
              progressSource={progressSource}
              onProgressSourceChange={setProgressSource}
              linkedProjects={linkedProjects}
              excludePriorityId={priorityId}
              scopeOptions={editScopeOptions}
              departmentLocked={!canUsePriorityAdminActions}
              showParentPicker={canUseAdvancedPriorityFields}
              showOwnerFields={canUseAdvancedPriorityFields}
              showAccountableExecField={canUseAdvancedPriorityFields}
              showAssigneeField={canUseAdvancedPriorityFields}
              showProjectPicker={false}
              showProgressSourcePicker={canUseAdvancedPriorityFields}
            />
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={() => updatePriorityMutation.mutate()}
                disabled={updatePriorityMutation.isPending || !editForm.title.trim()}
                data-testid="button-save-priority"
              >
                {updatePriorityMutation.isPending ? "Saving..." : "Save changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {canUsePriorityAdminActions && (
        <BreakDownDialog
          priorityId={priorityId}
          open={breakDownDialogOpen}
          onOpenChange={setBreakDownDialogOpen}
        />
      )}

      <EscalateDialog
        open={escalateDialogOpen}
        onOpenChange={setEscalateDialogOpen}
        priorityTitle={priority?.title ?? ""}
        currentScope={priority?.scope ?? "role"}
        onConfirm={(reason, note) => escalateMutation.mutate({ reason, note })}
        isPending={escalateMutation.isPending}
      />

      {confirmDialog}
    </PageLayout>
  );
}

function KpiTile({ label, value, dim, accent }: { label: string; value: string; dim?: boolean; accent?: "emerald" | "red" }) {
  const accentClass = accent === "emerald" ? "text-emerald-700" : accent === "red" ? "text-red-700" : "text-foreground";
  return (
    <Card className="shadow-sm">
      <CardContent className="p-3">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={`text-lg font-semibold tabular-nums ${dim ? "text-muted-foreground/60" : accentClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
