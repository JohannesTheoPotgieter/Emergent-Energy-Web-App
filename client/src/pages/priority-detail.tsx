import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  FolderOpen,
  GitBranch,
  History,
  ListTodo,
  MessageSquare,
  Plus,
  X,
} from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { isPriorityAdminRole, departmentLabel } from "@/config/priorities";
import { ProjectLinker } from "@/components/priorities/ProjectLinker";
import { BreakDownDialog } from "@/components/priorities/BreakDownDialog";
import { useConfirmDialog } from "@/components/priorities/ConfirmActionDialog";
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
  const [showProjectEvents, setShowProjectEvents] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    severity: "normal",
    status: "active",
    due_date: "",
    target_outcome: "",
    manual_health: "none",
    manual_progress: "",
  });

  const isAdmin = isPriorityAdminRole(user?.role);
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

  const escalateMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/priorities/${priorityId}/escalate`, { reason: "manual" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}/activity`] });
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (projectId: number) => {
      await apiRequest("DELETE", `/api/priorities/${priorityId}/projects/${projectId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}/activity`] });
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
    },
  });

  const updatePriorityMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/priorities/${priorityId}`, {
        title: editForm.title,
        description: editForm.description || null,
        severity: editForm.severity,
        status: editForm.status,
        due_date: editForm.due_date || null,
        target_outcome: editForm.target_outcome || null,
        manual_health: editForm.manual_health === "none" ? null : editForm.manual_health,
        manual_progress: editForm.manual_progress ? parseInt(editForm.manual_progress) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}/activity`] });
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
      setEditDialogOpen(false);
    },
  });

  const closePriorityMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/priorities/${priorityId}`, { status: "closed" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}/activity`] });
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
    },
  });

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <PageShell><PageError title="Unable to load priority" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></PageShell>;

  if (!priority) {
    return <PageShell><p className="text-muted-foreground">Priority not found</p></PageShell>;
  }

  const openEditDialog = () => {
    setEditForm({
      title: priority.title || "",
      description: priority.description || "",
      severity: priority.severity || "normal",
      status: priority.status || "active",
      due_date: priority.dueDate || "",
      target_outcome: priority.targetOutcome || "",
      manual_health: priority.manualHealth || "none",
      manual_progress: priority.manualProgress != null ? String(priority.manualProgress) : "",
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
    <PageShell>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-4">
        <Link href="/"><span className="hover:underline cursor-pointer">Home</span></Link>
        <span>/</span>
        <Link href="/priorities"><span className="hover:underline cursor-pointer">Priorities</span></Link>
        <span>/</span>
        <span className="text-foreground">{priority.title}</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-3 h-3 rounded-full ${HEALTH_DOT[priority.effectiveHealth] || HEALTH_DOT.healthy}`} />
          <h1 className="text-xl font-semibold text-foreground">{priority.title}</h1>
          <Badge variant="secondary" className={`text-[10px] ${sev.className}`}>{sev.label}</Badge>
          {isAdmin && (
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={openEditDialog}>Edit priority</Button>
              {priority.status !== "closed" && (
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
                >
                  {closePriorityMutation.isPending ? "Closing..." : "Close"}
                </Button>
              )}
            </div>
          )}
        </div>

        {priority.description && (
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{priority.description}</p>
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
          {isAdmin && (
            <div className="flex items-center gap-2 ml-auto">
              {(priority.scope === "role" || priority.scope === "department") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Escalate this priority?",
                      description: "It will move one scope upward (role → department → company).",
                      confirmLabel: "Escalate",
                    });
                    if (ok) escalateMutation.mutate();
                  }}
                  disabled={escalateMutation.isPending}
                >
                  {escalateMutation.isPending ? "Escalating..." : "Escalate"}
                </Button>
              )}
              {(priority.scope === "company" || priority.scope === "department") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  onClick={() => setBreakDownDialogOpen(true)}
                >
                  <GitBranch className="w-3 h-3 mr-1" /> Break Down
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
              <Card><CardContent className="p-3">
                <p className="text-[10px] text-muted-foreground uppercase">Revenue</p>
                <p className="text-lg font-semibold">{formatCurrency(totalRevenue)}</p>
              </CardContent></Card>
              <Card><CardContent className="p-3">
                <p className="text-[10px] text-muted-foreground uppercase">Cost of Sales</p>
                <p className="text-lg font-semibold">{formatCurrency(totalCos)}</p>
              </CardContent></Card>
              <Card><CardContent className="p-3">
                <p className="text-[10px] text-muted-foreground uppercase">Gross Profit</p>
                <p className="text-lg font-semibold">{formatCurrency(totalGp)}</p>
              </CardContent></Card>
              <Card><CardContent className="p-3">
                <p className="text-[10px] text-muted-foreground uppercase">GP Margin</p>
                <p className="text-lg font-semibold">{gpMargin}%</p>
              </CardContent></Card>
            </div>
          </>
        )}

        {displayProjectCount === 0 && (
          <Card className="mt-4 border-dashed">
            <CardContent className="p-4 text-sm text-muted-foreground">
              This is a standalone priority. Link projects — or break it down into sub-priorities — to see derived metrics and financial data.
              {isAdmin && (
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
        <TabsList>
          {displayProjectCount > 0 ? (
            <>
              <TabsTrigger value="projects"><FolderOpen className="w-3.5 h-3.5 mr-1" />Projects</TabsTrigger>
              <TabsTrigger value="financials"><DollarSign className="w-3.5 h-3.5 mr-1" />Financials</TabsTrigger>
              <TabsTrigger value="chain"><GitBranch className="w-3.5 h-3.5 mr-1" />Chain</TabsTrigger>
              <TabsTrigger value="tasks"><ListTodo className="w-3.5 h-3.5 mr-1" />Tasks & Approvals</TabsTrigger>
              <TabsTrigger value="updates"><MessageSquare className="w-3.5 h-3.5 mr-1" />Updates</TabsTrigger>
              <TabsTrigger value="activity"><History className="w-3.5 h-3.5 mr-1" />Activity</TabsTrigger>
            </>
          ) : (
            <>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="chain"><GitBranch className="w-3.5 h-3.5 mr-1" />Chain</TabsTrigger>
              <TabsTrigger value="updates"><MessageSquare className="w-3.5 h-3.5 mr-1" />Updates</TabsTrigger>
              <TabsTrigger value="activity"><History className="w-3.5 h-3.5 mr-1" />Activity</TabsTrigger>
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
                  {isAdmin && <th className="pb-2 font-medium w-8" />}
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
                      {isAdmin && (
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
                              className="text-muted-foreground hover:text-red-600"
                              title="Unlink project"
                              aria-label={`Unlink ${p.name}`}
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

          {isAdmin && (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setLinkDialogOpen(true)}>
              <Plus className="w-3 h-3 mr-1" /> Link project
            </Button>
          )}
        </TabsContent>

        {/* Financials tab */}
        <TabsContent value="financials" className="mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">Revenue</p>
              <p className="text-lg font-semibold">{formatCurrency(priority.totalRevenue)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">Cost of Sales</p>
              <p className="text-lg font-semibold">{formatCurrency(priority.totalCos)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">Gross Profit</p>
              <p className="text-lg font-semibold">{formatCurrency(priority.totalGp)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">GP Margin</p>
              <p className="text-lg font-semibold">{gpMargin}%</p>
            </CardContent></Card>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Project</th>
                  <th className="pb-2 font-medium text-right">Revenue</th>
                  <th className="pb-2 font-medium text-right">COS</th>
                  <th className="pb-2 font-medium text-right">GP</th>
                  <th className="pb-2 font-medium text-right">GP%</th>
                  <th className="pb-2 font-medium text-right">Revenue Realised</th>
                  <th className="pb-2 font-medium text-right">COS Realised</th>
                </tr>
              </thead>
              <tbody>
                {linkedProjects.map((p: LinkedProject) => (
                  <tr key={p.id} className="border-b hover:bg-muted/50">
                    <td className="py-2 font-medium">{p.name}</td>
                    <td className="py-2 text-right">{p.totalRevenue ? formatCurrency(p.totalRevenue) : "—"}</td>
                    <td className="py-2 text-right">{p.totalCos ? formatCurrency(p.totalCos) : "—"}</td>
                    <td className="py-2 text-right">{p.grossProfit ? formatCurrency(p.grossProfit) : "—"}</td>
                    <td className="py-2 text-right">{p.grossMarginPct ? `${(p.grossMarginPct * 100).toFixed(1)}%` : "—"}</td>
                    <td className="py-2 text-right">{p.revenueRealised ? formatCurrency(p.revenueRealised) : "—"}</td>
                    <td className="py-2 text-right">{p.cosRealised ? formatCurrency(p.cosRealised) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Tasks & Approvals tab */}
        <TabsContent value="tasks" className="mt-4">
          {mergedItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No tasks or approvals for linked projects</p>
          ) : (
            <div className="space-y-1">
              {mergedItems.slice(0, 50).map((item) => (
                <div key={`${item.itemType}-${item.id}`} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-muted text-sm border-b">
                  {item.itemType === "task" ? (
                    <ListTodo className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="font-medium truncate block">{item.title}</span>
                    <span className="text-xs text-muted-foreground">{item.projectName}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{item.assignee || ""}</span>
                  <Badge variant="outline" className="text-[10px] shrink-0">{item.status}</Badge>
                  <span className="text-xs text-muted-foreground shrink-0">{item.dueDate || ""}</span>
                </div>
              ))}
              {mergedItems.length > 50 && (
                <p className="text-xs text-muted-foreground text-center py-2">Showing first 50 of {mergedItems.length} items</p>
              )}
            </div>
          )}
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
                      <span className="text-xs text-muted-foreground ml-auto">
                        {u.date ? new Date(u.date).toLocaleDateString() : ""}
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
                  <span className="text-[10px] text-muted-foreground">
                    {a.createdAt ? new Date(a.createdAt).toLocaleString() : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
      </Tabs>

      {isAdmin && (
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

      {isAdmin && (
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Edit Priority</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Title</Label>
                <Input value={editForm.title} onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Description</Label>
                <Textarea value={editForm.description} onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))} rows={3} />
              </div>
              <div>
                <Label className="text-xs">Severity</Label>
                <Select value={editForm.severity} onValueChange={(v) => setEditForm((p) => ({ ...p, severity: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="important">High</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm((p) => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="monitoring">Monitoring</SelectItem>
                    <SelectItem value="in_progress">In progress</SelectItem>
                    <SelectItem value="complete">Complete</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Due date</Label>
                <Input type="date" value={editForm.due_date} onChange={(e) => setEditForm((p) => ({ ...p, due_date: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Manual health</Label>
                <Select value={editForm.manual_health} onValueChange={(v) => setEditForm((p) => ({ ...p, manual_health: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Auto</SelectItem>
                    <SelectItem value="healthy">Healthy</SelectItem>
                    <SelectItem value="at_risk">At risk</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Manual progress %</Label>
                <Input type="number" min={0} max={100} value={editForm.manual_progress} onChange={(e) => setEditForm((p) => ({ ...p, manual_progress: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Target outcome</Label>
                <Textarea value={editForm.target_outcome} onChange={(e) => setEditForm((p) => ({ ...p, target_outcome: e.target.value }))} rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
              <Button onClick={() => updatePriorityMutation.mutate()} disabled={updatePriorityMutation.isPending || !editForm.title.trim()}>
                {updatePriorityMutation.isPending ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {isAdmin && (
        <BreakDownDialog
          priorityId={priorityId}
          open={breakDownDialogOpen}
          onOpenChange={setBreakDownDialogOpen}
        />
      )}

      {confirmDialog}
    </PageShell>
  );
}
