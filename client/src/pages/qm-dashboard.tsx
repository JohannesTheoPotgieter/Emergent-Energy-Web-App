import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Shield,
  ShieldCheck,
  AlertTriangle,
  Search,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Eye,
  Plus,
  ChevronsUpDown,
  Check,
  Loader2,
  ListFilter,
  LayoutGrid,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  FileText,
  User,
  XCircle,
  Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ActionBar } from "@/components/guidance/ActionBar";
import { MicroWalkthrough, ReplayWalkthrough } from "@/components/guidance/MicroWalkthrough";
import { useRolloutFlag } from "@/hooks/use-rollout-flag";
import type { NextAction, BlockerInfo } from "@/hooks/use-guidance";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { ManagedDocumentApprovalQueue } from "@/components/documents/ManagedDocumentApprovalQueue";
import { NcrLegacyDeepLinkBanner } from "@/components/quality/NcrLegacyDeepLinkBanner";
import { QualityTab } from "@/components/tabs/QualityTab";
import { ConfirmDestructive, type ImpactRow } from "@/components/ui/confirm-destructive";
import { usePermission } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";

async function qFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch (${res.status})${text ? `: ${text.slice(0, 160)}` : ""}`);
  }
  return res.json();
}

interface ChecklistPhase {
  phaseId: number;
  phaseName: string;
  total: number;
  completed: number;
  failed?: number;
  inReview?: number;
}

interface Checklist {
  id: number;
  projectId?: number;
  projectName: string;
  templateId: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  phases?: ChecklistPhase[];
  warningCount?: number;
  overdueCount?: number;
  resubmissionCount?: number;
  evidenceGapCount?: number;
  pendingReviewCount?: number;
  blockedHandover?: boolean;
  qualityRiskScore?: number;
  qualityRiskLevel?: string;
  checklistItemCount?: number;
  hasLoggedActivity?: boolean;
}

interface Warning {
  id: number;
  projectName: string;
  severity: string;
  warningType: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
}

interface QualityItem {
  id: number;
  itemName: string;
  description: string;
  projectName: string;
  phaseName: string;
  groupName: string;
  qmStatus: string;
  assigneeName: string | null;
  startDate: string | null;
  endDate: string | null;
  evidenceCount: number;
  evidenceRequired?: boolean;
  evidenceMissing?: boolean;
  overdue?: boolean;
  daysOverdue?: number;
  approvalState?: string;
  resubmissionNeeded?: boolean;
  approved: boolean;
  approvedAt: string | null;
  approvalComment?: string | null;
}

/**
 * One row from GET /api/quality/ncrs (server/quality-ncr-routes.ts). The
 * endpoint returns the ncr_reports row plus a joined assignee name. It does
 * NOT return project name — only projectId — so the dashboard resolves the
 * name from the checklists list when available.
 */
interface NcrListItem {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  severity: "minor" | "major" | "critical" | string;
  status: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  assigneeName: string | null;
}

interface QualityDashboardSummary {
  totalChecklists: number;
  pendingApprovals: number;
  openWarnings: number;
  totalWarnings: number;
  overdueActions?: number;
  resubmissionNeeded?: number;
  evidenceRequired?: number;
  blockedHandovers?: number;
  atRiskProjects?: number;
  topRiskProjects?: Array<{
    projectName: string;
    riskLevel: string;
    riskScore: number;
    blockedHandover: boolean;
    overdueCount: number;
    resubmissionCount: number;
    evidenceGapCount: number;
  }>;
}

interface ProjectChecklistResponse {
  created?: boolean;
  checklist?: { id?: number; projectName?: string } | null;
}

type ProjectSortKey = "name" | "completion" | "warnings" | "updated";
type ProjectSortDir = "asc" | "desc";

function RiskLevelBadge({ level }: { level?: string }) {
  const normalized = String(level || "low").toLowerCase();
  const styles =
    normalized === "critical"
      ? "ee-status-danger"
      : normalized === "high"
        ? "ee-status-warning"
        : normalized === "medium"
          ? "ee-status-neutral"
          : "ee-status-success";
  const label = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return (
    <Badge variant="outline" className={`text-[10px] ${styles}`}>
      {label} risk
    </Badge>
  );
}

function SortHeader({ label, sortKey, currentSort, currentDir, onSort, className = "" }: {
  label: string; sortKey: string; currentSort: string; currentDir: ProjectSortDir;
  onSort: (key: string) => void; className?: string;
}) {
  const active = currentSort === sortKey;
  return (
    <button
      className={`flex items-center gap-1 hover:text-foreground transition-colors ${active ? "text-foreground font-semibold" : "text-muted-foreground font-medium"} ${className}`}
      onClick={() => onSort(sortKey)}
      data-testid={`sort-col-${sortKey}`}
    >
      {label}
      {active ? (
        currentDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

export default function QmDashboardPage() {
  const { enabled: microWalkthroughEnabled } = useRolloutFlag("micro_walkthrough");
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("project") || "";
  });
  const [projectSort, setProjectSort] = useState<ProjectSortKey>("name");
  const [projectSortDir, setProjectSortDir] = useState<ProjectSortDir>("asc");
  const [statusFilter, setStatusFilter] = useState<"active">("active");
  const [warningFilter, setWarningFilter] = useState(false);
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(null);
  const [warningsExpanded, setWarningsExpanded] = useState(false);
  const [portfolioTotalsOpen, setPortfolioTotalsOpen] = useState(false);
  const [selectedWarning, setSelectedWarning] = useState<Warning | null>(null);
  const [actionType, setActionType] = useState<"override" | "resolve" | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [startQmOpen, setStartQmOpen] = useState(false);
  const [startQmProject, setStartQmProject] = useState("");
  const [startQmPopoverOpen, setStartQmPopoverOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Checklist | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { allowed: canDeleteQualityPerm } = usePermission("quality", "edit");
  const { isAdmin, isQm } = useAuth();
  // Mirror the backend gate (`requireAdminOrQm` + `requirePermission("quality","delete")`)
  // so users without the right role don't see a delete button that would 403.
  const canDeleteQuality = canDeleteQualityPerm && (isAdmin || isQm);

  const { data: checklists = [], isLoading: checklistsLoading, isError: checklistsError, refetch: refetchChecklists } = useQuery<Checklist[]>({
    queryKey: ["quality-checklists"],
    queryFn: () => qFetch("/api/quality/checklists"),
    refetchOnMount: "always",
    staleTime: 10_000,
    retry: 1,
  });

  const { data: warnings = [], isLoading: warningsLoading, isError: warningsError, refetch: refetchWarnings } = useQuery<Warning[]>({
    queryKey: ["quality-warnings-all"],
    queryFn: () => qFetch("/api/quality/warnings?status=open"),
    refetchOnMount: "always",
    staleTime: 10_000,
  });

  const {
    data: governanceSummary,
    isLoading: governanceLoading,
    isError: governanceError,
    refetch: refetchGovernance,
  } = useQuery<QualityDashboardSummary>({
    queryKey: ["quality-dashboard"],
    queryFn: () => qFetch("/api/quality/dashboard"),
    refetchOnMount: "always",
    staleTime: 10_000,
  });

  // Open NCRs — first-class dashboard surface (finding QM-2). Sourced from
  // the existing GET /api/quality/ncrs?status=open list endpoint
  // (server/quality-ncr-routes.ts). Read-only; no new endpoint added.
  const {
    data: openNcrs = [],
    isLoading: ncrsLoading,
    isError: ncrsError,
    refetch: refetchNcrs,
  } = useQuery<NcrListItem[]>({
    queryKey: ["quality-ncrs", "open"],
    queryFn: () => qFetch("/api/quality/ncrs?status=open").then((r: { items?: NcrListItem[] }) => r?.items ?? []),
    refetchOnMount: "always",
    staleTime: 10_000,
    retry: 1,
  });

  // Consolidated quality items for governance overview
  const { data: allQualityItems = [] } = useQuery<any[]>({
    queryKey: ["quality-all-items"],
    queryFn: () => qFetch("/api/quality/all-items"),
    refetchOnMount: "always",
    staleTime: 30_000,
  });


  const { data: allProjects = [] } = useQuery<Array<{ project_name: string }>>({
    queryKey: ["projects-summary-names"],
    queryFn: () => qFetch("/api/projects-summary").then((data: any[]) =>
      data
        .filter((p: any) =>
          p?.is_active !== false &&
          (String(p?.phase || "").toLowerCase() !== "completed")
        )
        .map((p: any) => ({ project_name: p.project_name }))
        .sort((a: any, b: any) => a.project_name.localeCompare(b.project_name))
    ),
    enabled: startQmOpen,
  });

  const projectsWithChecklist = useMemo(() => {
    return new Set(
      checklists
        .map((checklist) => checklist.projectName)
    );
  }, [checklists]);


  const startQmMutation = useMutation<ProjectChecklistResponse, Error, string>({
    mutationFn: (projectName: string) =>
      qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/checklist`),
    onSuccess: (data, projectName) => {
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
      const resolvedProjectName = data?.checklist?.projectName || projectName;
      if (data?.created) {
        toast({ title: "Quality process started", description: `Quality checklist created for ${resolvedProjectName}.` });
      } else {
        toast({ title: "Checklist already exists", description: `Opened existing quality checklist for ${resolvedProjectName}.` });
      }
      setStartQmOpen(false);
      setStartQmProject("");
      setSelectedProjectName(resolvedProjectName);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to start quality process.", variant: "destructive" });
    },
  });

  const deleteChecklistMutation = useMutation<{ counts?: Record<string, number> }, Error, string>({
    mutationFn: (projectName: string) =>
      qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/checklist`, { method: "DELETE" }),
    onSuccess: (_data, projectName) => {
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["quality-all-items"] });
      if (selectedProjectName && selectedProjectName === projectName) {
        setSelectedProjectName(null);
      }
      toast({
        title: "Quality process deleted",
        description: `${projectName} can now be restarted from the Start Quality Process dialog.`,
      });
    },
    onError: (err) => {
      toast({
        title: "Couldn't delete quality process",
        description: err?.message || "Please retry. No data was changed.",
        variant: "destructive",
      });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (data: { warningId: number; note: string }) =>
      qFetch(`/api/quality/warning/${data.warningId}/acknowledge`, {
        method: "POST",
        body: JSON.stringify({ note: data.note }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
      toast({ title: "Warning overridden", description: "The warning has been acknowledged and overridden." });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to override warning.", variant: "destructive" });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (data: { warningId: number; note: string }) =>
      qFetch(`/api/quality/warning/${data.warningId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ note: data.note }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
      toast({ title: "Warning resolved", description: "The warning has been closed." });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to resolve warning.", variant: "destructive" });
    },
  });

  const closeDialog = () => {
    setSelectedWarning(null);
    setActionType(null);
    setReasonText("");
  };

  const handleAction = () => {
    if (!selectedWarning || !actionType) return;
    if (!reasonText.trim()) {
      toast({ title: "Reason required", description: "Please provide a reason before proceeding.", variant: "destructive" });
      return;
    }
    if (actionType === "override") {
      acknowledgeMutation.mutate({ warningId: selectedWarning.id, note: reasonText });
    } else {
      resolveMutation.mutate({ warningId: selectedWarning.id, note: reasonText });
    }
  };

  const totalProjects = checklists.length;
  const totalItemsPassed = useMemo(() => {
    return checklists.reduce((sum, c) => {
      if (!c.phases) return sum;
      return sum + c.phases.reduce((t, p) => t + p.completed, 0);
    }, 0);
  }, [checklists]);
  const totalItemsFailed = useMemo(() => {
    return checklists.reduce((sum, c) => {
      if (!c.phases) return sum;
      return sum + c.phases.reduce((t, p) => t + (p.failed ?? 0), 0);
    }, 0);
  }, [checklists]);
  const totalItemsAll = useMemo(() => {
    return checklists.reduce((sum, c) => {
      if (!c.phases) return sum;
      return sum + c.phases.reduce((t, p) => t + p.total, 0);
    }, 0);
  }, [checklists]);
  const totalItemsReviewed = totalItemsPassed + totalItemsFailed;
  const activeWarnings = warnings.length;
  const activeProjectsCount = checklists.filter(c => c.status === "active").length;
  const completedProjectsCount = checklists.filter(c => c.status === "completed").length;

  const overallProgress = totalItemsAll > 0 ? Math.round((totalItemsReviewed / totalItemsAll) * 100) : 0;
  const overallScore = totalItemsReviewed > 0 ? Math.round((totalItemsPassed / totalItemsReviewed) * 100) : 0;

  const avgQmScore = checklists.length > 0
    ? Math.round(
        checklists.reduce((sum, c) => {
          if (!c.phases || c.phases.length === 0) return sum;
          const total = c.phases.reduce((t, p) => t + p.total, 0);
          const passed = c.phases.reduce((t, p) => t + p.completed, 0);
          return sum + (total > 0 ? (passed / total) * 100 : 0);
        }, 0) / checklists.length
      )
    : 0;

  const getProjectCompletion = (c: Checklist) => {
    if (!c.phases || c.phases.length === 0) return 0;
    const total = c.phases.reduce((t, p) => t + p.total, 0);
    const passed = c.phases.reduce((t, p) => t + p.completed, 0);
    return total > 0 ? Math.round((passed / total) * 100) : 0;
  };

  const getProjectProgress = (c: Checklist) => {
    if (!c.phases || c.phases.length === 0) return 0;
    const total = c.phases.reduce((t, p) => t + p.total, 0);
    const reviewed = c.phases.reduce((t, p) => t + p.completed + (p.failed ?? 0), 0);
    return total > 0 ? Math.round((reviewed / total) * 100) : 0;
  };

  const getProjectScore = (c: Checklist) => {
    if (!c.phases || c.phases.length === 0) return 0;
    const passed = c.phases.reduce((t, p) => t + p.completed, 0);
    const failed = c.phases.reduce((t, p) => t + (p.failed ?? 0), 0);
    const reviewed = passed + failed;
    return reviewed > 0 ? Math.round((passed / reviewed) * 100) : 0;
  };

  const getProjectWarnings = (c: Checklist) => {
    return c.warningCount ?? warnings.filter(w => w.projectName === c.projectName).length;
  };

  const getProjectUpdated = (c: Checklist) => {
    return c.updatedAt || c.createdAt || "";
  };
  const formatShortDate = (value?: string | null) => {
    if (!value) return "No due date";
    return new Date(value).toLocaleDateString();
  };

  // Resolve a project name for an NCR row from the checklists list. The
  // /api/quality/ncrs endpoint returns projectId only (see NcrListItem).
  const ncrProjectName = (projectId: number): string | null =>
    checklists.find((c) => c.projectId === projectId)?.projectName ?? null;

  const ncrAge = (createdAt?: string | null): string => {
    if (!createdAt) return "age unknown";
    const created = new Date(createdAt).getTime();
    if (Number.isNaN(created)) return "age unknown";
    const days = Math.max(0, Math.floor((Date.now() - created) / 86_400_000));
    if (days === 0) return "raised today";
    return `${days}d open`;
  };

  const filteredProjects = useMemo(() => {
    let list = checklists.filter(c =>
      (c.projectName || "").toLowerCase().includes(searchTerm.toLowerCase())
    );
    if (statusFilter === "active") list = list.filter(c => c.status === "active");
    if (warningFilter) list = list.filter(c => getProjectWarnings(c) > 0);

    list.sort((a, b) => {
      let cmp = 0;
      switch (projectSort) {
        case "name": cmp = (a.projectName || "").localeCompare(b.projectName || ""); break;
        case "completion": cmp = getProjectCompletion(a) - getProjectCompletion(b); break;
        case "warnings": cmp = getProjectWarnings(a) - getProjectWarnings(b); break;
        case "updated": cmp = getProjectUpdated(a).localeCompare(getProjectUpdated(b)); break;
      }
      return projectSortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [checklists, searchTerm, statusFilter, warningFilter, projectSort, projectSortDir, warnings]);

  const selectedProjectChecklist = useMemo(
    () => checklists.find((c) => c.projectName === selectedProjectName) ?? null,
    [checklists, selectedProjectName]
  );

  const highSeverityWarnings = useMemo(() => warnings.filter(w => w.severity === "High"), [warnings]);
  const mediumWarnings = useMemo(() => warnings.filter(w => w.severity === "Medium"), [warnings]);
  const lowWarnings = useMemo(() => warnings.filter(w => w.severity !== "High" && w.severity !== "Medium"), [warnings]);
  const topRiskProjects = governanceSummary?.topRiskProjects || [];

  const qmNextAction = useMemo((): NextAction | null => {
    const overdueActions = governanceSummary?.overdueActions || 0;
    const resubmissions = governanceSummary?.resubmissionNeeded || 0;
    if (overdueActions > 0) return { label: `${overdueActions} overdue quality action${overdueActions !== 1 ? "s" : ""} need attention`, severity: "warning" };
    if (resubmissions > 0) return { label: `${resubmissions} item${resubmissions !== 1 ? "s" : ""} failed QC — fix and resubmit`, severity: "warning" };
    if (activeWarnings > 0) return { label: `${activeWarnings} quality warning${activeWarnings !== 1 ? "s" : ""} to review`, severity: "warning" };
    const incomplete = checklists.filter(c => c.status !== "completed").length;
    if (incomplete > 0) return { label: `${incomplete} checklist${incomplete !== 1 ? "s" : ""} still in progress`, severity: "info" };
    return { label: "All quality checklists complete", severity: "info" };
  }, [activeWarnings, checklists, governanceSummary?.overdueActions, governanceSummary?.resubmissionNeeded]);

  const qmBlockers = useMemo((): BlockerInfo[] => {
    const b: BlockerInfo[] = [];
    if ((governanceSummary?.blockedHandovers || 0) > 0) {
      b.push({ label: "Quality-blocked handovers", count: governanceSummary?.blockedHandovers || 0, severity: "warning" });
    }
    if ((governanceSummary?.resubmissionNeeded || 0) > 0) {
      b.push({ label: "Failed QC items needing rework", count: governanceSummary?.resubmissionNeeded || 0, severity: "warning" });
    }
    if (activeWarnings > 0) b.push({ label: "Active quality warnings", count: activeWarnings, severity: "warning" });
    return b;
  }, [activeWarnings, governanceSummary?.blockedHandovers, governanceSummary?.resubmissionNeeded]);

  const qmWalkthroughSteps = useMemo(() => [
    { title: "Quality overview", description: "KPI cards at the top show total projects, items passed, warnings, and average QM score." },
    { title: "Open NCRs", description: "Open non-conformances are listed in their own card — review severity, owning project, and age at a glance." },
    { title: "Project checklists", description: "Each project's quality checklist progress is listed below. Open a project to drill into its items." },
    { title: "Warnings", description: "Active warnings are shown below. Override or resolve them with a reason." },
  ], []);

  const activeFiltersCount = [
    searchTerm ? 1 : 0,
    warningFilter ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  return (
    <PageShell data-testid="qm-dashboard-page">
      {/* No global loading gate: each section below renders from its own
          query state so a slow/failed /api/quality/checklists call never
          blanks the KPI cards, warnings, NCRs, or approvals. */}
      <SectionHeader
        icon={<ShieldCheck className="h-5 w-5" />}
        eyebrow="Quality"
        title="Quality Management"
        description="Monitor quality checklists, track items, and manage warnings across projects."
        actions={(
          <>
            {microWalkthroughEnabled ? <ReplayWalkthrough screenId="qm-dashboard" /> : null}
            <Button
              onClick={() => setStartQmOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
              data-testid="btn-start-quality-process"
            >
              <Plus className="h-4 w-4 mr-2" />
              Start Quality Process
            </Button>
          </>
        )}
      />
      <NcrLegacyDeepLinkBanner />

      {microWalkthroughEnabled ? <MicroWalkthrough screenId="qm-dashboard" steps={qmWalkthroughSteps} /> : null}
      <ActionBar nextAction={qmNextAction} blockers={qmBlockers} />

      {/* Governance KPI strip — own query state. A slow/failed
          /api/quality/dashboard call shows an explicit loading or
          error+retry state here instead of silently rendering zeros. */}
      {governanceLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" data-testid="qm-kpi-loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="border-border">
              <CardContent className="p-3 space-y-2">
                <div className="h-2.5 w-20 rounded bg-muted animate-pulse" />
                <div className="h-6 w-10 rounded bg-muted animate-pulse" />
                <div className="h-2.5 w-full rounded bg-muted animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : governanceError ? (
        <Card className="border-amber-200" data-testid="qm-kpi-error">
          <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Couldn't load quality governance KPIs</p>
                <p className="text-xs text-muted-foreground mt-0.5">Overdue actions, failed QC, evidence gaps and risk counts are temporarily unavailable. The rest of the dashboard still works.</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchGovernance()} data-testid="btn-retry-kpis">Retry</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
          {([
            { label: "Overdue actions", value: governanceSummary?.overdueActions ?? 0, tone: "danger" },
            { label: "Failed QC", value: governanceSummary?.resubmissionNeeded ?? 0, tone: "danger" },
            { label: "Evidence gaps", value: governanceSummary?.evidenceRequired ?? 0, tone: "warning" },
            { label: "Blocked handover", value: governanceSummary?.blockedHandovers ?? 0, tone: "danger" },
            { label: "At-risk projects", value: governanceSummary?.atRiskProjects ?? 0, tone: "warning" },
          ] as const).map((kpi) => {
            const active = kpi.value > 0;
            const border = !active
              ? "border-border"
              : kpi.tone === "danger" ? "border-red-200" : "border-amber-200";
            const valueColor = !active
              ? "text-foreground"
              : kpi.tone === "danger" ? "text-red-600" : "text-amber-700";
            return (
              <Card key={kpi.label} className={border}>
                <CardContent className="p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold truncate">{kpi.label}</p>
                  <p className={`text-xl font-semibold tabular-nums mt-1 ${valueColor}`}>{kpi.value}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Open NCRs — first-class surface (audit QM-2). Own query state:
          loading / explicit error+retry / empty / list, all independent
          of the checklists query. Source: GET /api/quality/ncrs?status=open
          (server/quality-ncr-routes.ts). Project name resolved from the
          checklists list when available (endpoint returns projectId only). */}
      <Card className="border-border" data-testid="qm-open-ncrs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-red-50">
              <FileText className="h-4 w-4 text-red-600" />
            </div>
            Open NCRs
            {!ncrsLoading && !ncrsError && (
              <Badge variant="outline" className="bg-muted text-muted-foreground border-border ml-1" data-testid="qm-open-ncrs-count">
                {openNcrs.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {ncrsLoading ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground" data-testid="qm-ncrs-loading">
              <Loader2 className="h-6 w-6 mb-2 animate-spin text-red-500" />
              <p className="text-sm">Loading open NCRs...</p>
            </div>
          ) : ncrsError ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground" data-testid="qm-ncrs-error">
              <AlertTriangle className="h-9 w-9 mb-2 text-amber-500" />
              <p className="font-medium text-foreground">Couldn't load open NCRs</p>
              <p className="text-xs mt-1">The non-conformance list is temporarily unavailable.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchNcrs()} data-testid="btn-retry-ncrs">Retry</Button>
            </div>
          ) : openNcrs.length === 0 ? (
            <div className="ee-empty-state text-muted-foreground" data-testid="qm-ncrs-empty">
              <ShieldCheck className="h-10 w-10 mb-2 opacity-20" />
              <p className="font-medium text-foreground">No open NCRs</p>
              <p className="text-xs mt-1">There are no open non-conformances across active projects.</p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="qm-ncrs-list">
              {openNcrs.map((ncr) => {
                const projectName = ncrProjectName(ncr.projectId);
                const sev = String(ncr.severity || "").toLowerCase();
                const sevClass = sev === "critical"
                  ? "ee-status-danger"
                  : sev === "major"
                    ? "ee-status-warning"
                    : "ee-status-neutral";
                return (
                  <button
                    key={ncr.id}
                    type="button"
                    className="w-full flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2.5 text-left hover:border-red-300 hover:shadow-sm transition-all"
                    onClick={() => {
                      // Project pages are outside the Live-Ready ring fence, so stay
                      // in-module: surface the NCR banner via ?ncr and open the
                      // project's inline quality detail when we know which project.
                      setLocation(`/quality?ncr=${ncr.id}`);
                      if (projectName) setSelectedProjectName(projectName);
                    }}
                    data-testid={`qm-ncr-row-${ncr.id}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{ncr.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{projectName ?? `Project #${ncr.projectId}`}</span>
                        <span aria-hidden="true">·</span>
                        <span>{ncrAge(ncr.createdAt)}</span>
                        {ncr.assigneeName && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{ncr.assigneeName}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${sevClass}`}>
                      {sev ? sev.charAt(0).toUpperCase() + sev.slice(1) : "Unknown"}
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {topRiskProjects.length > 0 && (
        <Card className="border-border border-l-2 border-l-amber-500">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-semibold">Projects needing the fastest quality intervention</p>
                <p className="text-xs text-muted-foreground mt-1">Top risk projects blend overdue actions, evidence gaps, resubmissions, and handover blockers.</p>
              </div>
              <Badge variant="outline" className="bg-background/80">
                {topRiskProjects.length} highlighted
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {topRiskProjects.map((project) => (
                <button
                  key={project.projectName}
                  className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left hover:border-emerald-300 hover:shadow-sm transition-all"
                  onClick={() => setSelectedProjectName(project.projectName)}
                  data-testid={`top-risk-project-${project.projectName}`}
                >
                  <span className="text-sm font-medium">{project.projectName}</span>
                  <RiskLevelBadge level={project.riskLevel} />
                  {project.blockedHandover && (
                    <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">
                      Handover blocked
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Collapsible open={portfolioTotalsOpen} onOpenChange={setPortfolioTotalsOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg border bg-muted/20 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
            data-testid="qm-portfolio-totals-toggle"
          >
            <span className="flex items-center gap-2"><LayoutGrid className="h-4 w-4" /> Portfolio totals</span>
            {portfolioTotalsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Card className="border-border" data-testid="kpi-quality-progress">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-semibold tabular-nums text-sky-600" data-testid="stat-progress">{overallProgress}%</p>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Progress</p>
            <div className="w-full h-1 bg-sky-100 rounded-full overflow-hidden mt-1.5">
              <div className="h-full bg-sky-500 rounded-full" style={{ width: `${overallProgress}%` }} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-emerald-100" data-testid="kpi-quality-score">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-semibold tabular-nums text-emerald-600" data-testid="stat-score">{overallScore}%</p>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Score</p>
            <div className="w-full h-1 bg-emerald-100 rounded-full overflow-hidden mt-1.5">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${overallScore}%` }} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border" data-testid="kpi-total-projects">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-semibold tabular-nums" data-testid="stat-total-projects">{totalProjects}</p>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Projects</p>
          </CardContent>
        </Card>

        <Card className="border-emerald-100" data-testid="kpi-items-passed">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-semibold tabular-nums" data-testid="stat-items-passed">{totalItemsPassed}<span className="text-sm font-normal text-muted-foreground">/{totalItemsAll}</span></p>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Passed</p>
          </CardContent>
        </Card>

        <Card
          className={`border-amber-100 cursor-pointer hover:shadow-md transition-shadow ${warningFilter ? "ring-2 ring-amber-300" : ""}`}
          onClick={() => setWarningFilter(!warningFilter)}
          data-testid="kpi-active-warnings"
        >
          <CardContent className="p-3 text-center">
            <p className="text-xl font-semibold tabular-nums text-amber-600" data-testid="stat-warnings">{activeWarnings}</p>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Warnings</p>
          </CardContent>
        </Card>

        <Card className="border-border" data-testid="kpi-avg-score">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-semibold tabular-nums" data-testid="stat-avg-completion">{avgQmScore}%</p>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Avg Score</p>
          </CardContent>
        </Card>
      </div>
        </CollapsibleContent>
      </Collapsible>

      <section aria-label="Project checklists">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs text-muted-foreground">
            {activeProjectsCount} active · {completedProjectsCount} completed
          </span>

          {activeFiltersCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => { setSearchTerm(""); setWarningFilter(false); }}
              data-testid="btn-clear-all-filters"
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              Clear {activeFiltersCount} filter{activeFiltersCount > 1 ? "s" : ""}
            </Button>
          )}
        </div>

        <div className="mt-4">
          {selectedProjectName && selectedProjectChecklist ? (
            <Card>
              <CardHeader className="pb-3 border-b">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 -ml-2 mb-2 text-xs"
                      onClick={() => setSelectedProjectName(null)}
                      data-testid="btn-back-to-project-list"
                    >
                      <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                      Back to project list
                    </Button>
                    <CardTitle className="text-lg font-semibold">{selectedProjectName}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Review what needs action, who owns it, and when it is due.
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <QualityTab projectName={selectedProjectName} />
              </CardContent>
            </Card>
          ) : (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-base font-semibold">Project Checklists</CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search projects..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9 h-9 w-[200px] sm:w-[240px]"
                      data-testid="input-qm-search"
                    />
                  </div>
                  <SearchableSelect
                    value={statusFilter}
                    onValueChange={(v) => setStatusFilter(v as any)}
                    placeholder="Status"
                    triggerClassName="w-[120px] h-9"
                    data-testid="select-status-filter"
                    options={[
                      { value: "active", label: "Active" },
                    ]}
                  />
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5" data-testid="qm-project-more-filters">
                        <ListFilter className="h-3.5 w-3.5" /> More
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-56 p-3">
                      <label className="text-[11px] text-muted-foreground font-medium block mb-2">Warnings</label>
                      <Button
                        variant={warningFilter ? "default" : "outline"}
                        size="sm"
                        className="w-full justify-start text-xs"
                        onClick={() => setWarningFilter(!warningFilter)}
                        data-testid="toggle-warning-filter"
                      >
                        <AlertTriangle className="h-3.5 w-3.5 mr-1.5" /> Only projects with warnings
                      </Button>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {checklistsLoading ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Loader2 className="h-8 w-8 mb-3 animate-spin text-emerald-500" />
                  <p className="text-sm">Loading checklists...</p>
                </div>
              ) : checklistsError ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <AlertTriangle className="h-10 w-10 mb-3 text-amber-500" />
                  <p className="font-medium">Couldn't load project checklists</p>
                  <p className="text-xs mt-1">Please retry and confirm your connection.</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchChecklists()} data-testid="btn-retry-projects">Retry</Button>
                </div>
              ) : filteredProjects.length === 0 ? (
                <div className="ee-empty-state text-muted-foreground">
                  <Shield className="h-10 w-10 mb-4 opacity-20" />
                  <p className="font-medium">No checklists found</p>
                  <p className="text-xs mt-1">
                    {activeFiltersCount > 0 ? "Try adjusting your filters" : "Start a quality process for a project"}
                  </p>
                  {activeFiltersCount > 0 && (
                    <Button variant="link" size="sm" className="mt-2" onClick={() => { setSearchTerm(""); setWarningFilter(false); }} data-testid="btn-clear-filters">
                      Clear filters
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="qm-projects-table">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">
                            <SortHeader label="Project" sortKey="name" currentSort={projectSort} currentDir={projectSortDir} onSort={(k) => { if (projectSort === k) setProjectSortDir(d => d === "asc" ? "desc" : "asc"); else { setProjectSort(k as ProjectSortKey); setProjectSortDir("asc"); }}} className="text-xs" />
                          </th>
                          <th className="text-center py-2 px-2 font-medium text-muted-foreground text-xs w-[80px]">
                            <SortHeader label="Progress" sortKey="completion" currentSort={projectSort} currentDir={projectSortDir} onSort={(k) => { if (projectSort === k) setProjectSortDir(d => d === "asc" ? "desc" : "asc"); else { setProjectSort(k as ProjectSortKey); setProjectSortDir("asc"); }}} className="text-xs justify-center" />
                          </th>
                          <th className="text-center py-2 px-2 font-medium text-muted-foreground text-xs w-[70px]">Score</th>
                          <th className="text-left py-2 px-2 font-medium text-muted-foreground text-xs hidden md:table-cell">Items</th>
                          <th className="text-left py-2 px-2 font-medium text-muted-foreground text-xs hidden lg:table-cell min-w-[200px]">Phases</th>
                          <th className="text-center py-2 px-2 font-medium text-muted-foreground text-xs w-[80px]">
                            <SortHeader label="Warnings" sortKey="warnings" currentSort={projectSort} currentDir={projectSortDir} onSort={(k) => { if (projectSort === k) setProjectSortDir(d => d === "asc" ? "desc" : "asc"); else { setProjectSort(k as ProjectSortKey); setProjectSortDir("asc"); }}} className="text-xs justify-center" />
                          </th>
                          <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs w-[90px] hidden sm:table-cell">
                            <SortHeader label="Updated" sortKey="updated" currentSort={projectSort} currentDir={projectSortDir} onSort={(k) => { if (projectSort === k) setProjectSortDir(d => d === "asc" ? "desc" : "asc"); else { setProjectSort(k as ProjectSortKey); setProjectSortDir("asc"); }}} className="text-xs justify-end" />
                          </th>
                          <th className="w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProjects.map((checklist) => {
                          const progress = getProjectProgress(checklist);
                          const score = getProjectScore(checklist);
                          const warnCount = getProjectWarnings(checklist);
                          const totalItems = checklist.phases?.reduce((t, p) => t + p.total, 0) ?? 0;
                          const passedItems = checklist.phases?.reduce((t, p) => t + p.completed, 0) ?? 0;
                          const failedItems = checklist.phases?.reduce((t, p) => t + (p.failed ?? 0), 0) ?? 0;
                          const reviewedItems = passedItems + failedItems;
                          const progressColor = progress >= 80 ? "bg-emerald-500" : progress >= 50 ? "bg-amber-500" : "bg-red-500";
                          const scoreColor = score >= 80 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-red-600";
                          return (
                            <tr
                              key={checklist.id}
                              data-testid={`qm-project-row-${checklist.id}`}
                              className="border-b last:border-0 hover:bg-emerald-50/40 transition-colors group"
                            >
                              <td className="py-2.5 px-3">
                                <span className="font-medium text-sm group-hover:text-emerald-600 transition-colors" data-testid={`text-project-name-${checklist.id}`}>
                                  {checklist.projectName}
                                </span>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <RiskLevelBadge level={checklist.qualityRiskLevel} />
                                  {(checklist.overdueCount ?? 0) > 0 && (
                                    <Badge variant="outline" className="text-[10px] ee-status-danger">
                                      {checklist.overdueCount} overdue
                                    </Badge>
                                  )}
                                  {(checklist.resubmissionCount ?? 0) > 0 && (
                                    <Badge variant="outline" className="text-[10px] ee-status-warning">
                                      {checklist.resubmissionCount} retry
                                    </Badge>
                                  )}
                                  {(checklist.evidenceGapCount ?? 0) > 0 && (
                                    <Badge variant="outline" className="text-[10px] ee-status-warning">
                                      {checklist.evidenceGapCount} evidence
                                    </Badge>
                                  )}
                                  {checklist.blockedHandover && (
                                    <Badge variant="outline" className="text-[10px] ee-status-danger">
                                      Handover blocked
                                    </Badge>
                                  )}
                                </div>
                              </td>
                              <td className="py-2.5 px-2 text-center">
                                <div className="flex items-center gap-1.5 justify-center" title={`${reviewedItems}/${totalItems} reviewed`}>
                                  <div className="w-14 h-1.5 bg-muted rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${progressColor}`} style={{ width: `${progress}%` }} />
                                  </div>
                                  <span className="text-xs tabular-nums font-medium w-8">{progress}%</span>
                                </div>
                              </td>
                              <td className="py-2.5 px-2 text-center">
                                <span className={`text-xs font-bold tabular-nums ${scoreColor}`} title={`${passedItems} passed / ${reviewedItems} reviewed`}>
                                  {score}%
                                </span>
                              </td>
                              <td className="py-2.5 px-2 hidden md:table-cell">
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  <span className="text-emerald-600 font-medium">{passedItems}</span>
                                  {failedItems > 0 && <> / <span className="text-red-500 font-medium">{failedItems}F</span></>}
                                  <span className="text-muted-foreground"> / {totalItems}</span>
                                </span>
                              </td>
                              <td className="py-2.5 px-2 hidden lg:table-cell">
                                {checklist.phases && checklist.phases.length > 0 ? (
                                  <div className="flex items-center gap-1 flex-wrap">
                                    {checklist.phases.map((phase) => {
                                      const pct = phase.total > 0 ? Math.round((phase.completed / phase.total) * 100) : 0;
                                      const hasFailed = (phase.failed ?? 0) > 0;
                                      const barColor = hasFailed ? "bg-red-400" : pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-gray-300";
                                      return (
                                        <div key={phase.phaseId} className="flex items-center gap-1" title={`${phase.phaseName}: ${phase.completed}/${phase.total}${hasFailed ? ` (${phase.failed} failed)` : ""}`}>
                                          <span className="text-[9px] text-muted-foreground truncate max-w-[50px]">{phase.phaseName}</span>
                                          <div className="w-8 h-1 bg-muted rounded-full overflow-hidden">
                                            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="py-2.5 px-2 text-center">
                                {warnCount > 0 ? (
                                  <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 text-[10px] gap-1">
                                    <AlertTriangle className="h-3 w-3" />
                                    {warnCount}
                                  </Badge>
                                ) : (
                                  <ShieldCheck className="h-4 w-4 text-emerald-400 mx-auto" />
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right hidden sm:table-cell">
                                <span className="text-[11px] text-muted-foreground tabular-nums">
                                  {checklist.updatedAt
                                    ? new Date(checklist.updatedAt).toLocaleDateString()
                                    : checklist.createdAt
                                    ? new Date(checklist.createdAt).toLocaleDateString()
                                    : "—"}
                                </span>
                              </td>
                              <td className="py-2.5 pr-2">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => setSelectedProjectName(checklist.projectName)}
                                    aria-label={`Open ${checklist.projectName} quality detail`}
                                    data-testid={`btn-open-project-${checklist.id}`}
                                  >
                                    <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                                  </Button>
                                  {canDeleteQuality && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                      onClick={() => {
                                        setDeleteTarget(checklist);
                                      }}
                                      aria-label={`Delete quality process for ${checklist.projectName}`}
                                      data-testid={`btn-delete-project-${checklist.id}`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => setSelectedProjectName(checklist.projectName)}
                                    aria-label={`Expand quality details for ${checklist.projectName}`}
                                    data-testid={`btn-expand-project-${checklist.id}`}
                                  >
                                    <ChevronRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-emerald-500 transition-colors" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground text-right mt-3 px-3">
                    Showing {filteredProjects.length} of {checklists.length} projects
                  </p>
                </>
              )}
            </CardContent>
          </Card>
          )}
        </div>
      </section>

      <Collapsible open={warningsExpanded} onOpenChange={setWarningsExpanded}>
        <Card className="border-amber-200">
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg" data-testid="warnings-section-header">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-amber-50">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  </div>
                  Active Warnings
                  <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 ml-1">
                    {warnings.length}
                  </Badge>
                </CardTitle>
                {warningsExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              {warningsLoading ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="h-6 w-6 mb-2 animate-spin text-amber-500" />
                  <p className="text-sm">Loading warnings...</p>
                </div>
              ) : warningsError ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <AlertTriangle className="h-9 w-9 mb-2 text-amber-500" />
                  <p className="font-medium">Couldn't load warnings</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchWarnings()} data-testid="btn-retry-warnings">Retry</Button>
                </div>
              ) : warnings.length === 0 ? (
                <div className="ee-empty-state text-muted-foreground">
                  <ShieldCheck className="h-10 w-10 mb-2 opacity-20" />
                  <p className="font-medium text-foreground">No active warnings</p>
                  <p className="text-xs mt-1">Quality warning queue is currently clear.</p>
                </div>
              ) : (
                <>
                  {highSeverityWarnings.length > 0 && (
                    <div className="mb-5">
                      <div className="flex items-center gap-2 mb-2.5">
                        <span className="h-2 w-2 rounded-full bg-red-500" />
                        <p className="text-xs font-semibold text-red-600 uppercase tracking-wider">High Severity ({highSeverityWarnings.length})</p>
                      </div>
                      <div className="space-y-2">
                        {highSeverityWarnings.map((warning) => (
                          <WarningRow key={warning.id} warning={warning} severity="high"
                            onView={() => setSelectedWarning(warning)}
                            onOverride={() => { setSelectedWarning(warning); setActionType("override"); }}
                            onResolve={() => { setSelectedWarning(warning); setActionType("resolve"); }}
                            onViewProject={() => setSelectedProjectName(warning.projectName)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {mediumWarnings.length > 0 && (
                    <div className="mb-5">
                      <div className="flex items-center gap-2 mb-2.5">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Medium Severity ({mediumWarnings.length})</p>
                      </div>
                      <div className="space-y-2">
                        {mediumWarnings.map((warning) => (
                          <WarningRow key={warning.id} warning={warning} severity="medium"
                            onView={() => setSelectedWarning(warning)}
                            onOverride={() => { setSelectedWarning(warning); setActionType("override"); }}
                            onResolve={() => { setSelectedWarning(warning); setActionType("resolve"); }}
                            onViewProject={() => setSelectedProjectName(warning.projectName)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {lowWarnings.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2.5">
                        <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Low / Other ({lowWarnings.length})</p>
                      </div>
                      <div className="space-y-2">
                        {lowWarnings.map((warning) => (
                          <WarningRow key={warning.id} warning={warning} severity="low"
                            onView={() => setSelectedWarning(warning)}
                            onOverride={() => { setSelectedWarning(warning); setActionType("override"); }}
                            onResolve={() => { setSelectedWarning(warning); setActionType("resolve"); }}
                            onViewProject={() => setSelectedProjectName(warning.projectName)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Managed-document approvals waiting on this QM — secondary inbox, kept
          below the triage surfaces rather than above the page header. */}
      <ManagedDocumentApprovalQueue title="Approvals waiting on you" />

      <Dialog open={!!selectedWarning && !actionType} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className={`h-5 w-5 ${selectedWarning?.severity === "High" ? "text-red-600" : "text-amber-600"}`} />
              Warning Details
            </DialogTitle>
          </DialogHeader>
          {selectedWarning && (
            <div className="space-y-4">
              <div>
                <p className="font-semibold text-sm">{selectedWarning.title}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <Badge variant="outline" className={
                    selectedWarning.severity === "High"
                      ? "bg-red-50 text-red-600 border-red-200 text-xs"
                      : "bg-amber-50 text-amber-700 border-amber-200 text-xs"
                  }>
                    {selectedWarning.severity}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {selectedWarning.warningType}
                  </Badge>
                </div>
              </div>

              <div className="space-y-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs w-16">Project</span>
                  <span className="font-medium">{selectedWarning.projectName}</span>
                </div>
                {selectedWarning.description && (
                  <div>
                    <span className="text-muted-foreground text-xs">Description</span>
                    <p className="mt-1 text-sm bg-muted/50 p-2.5 rounded-lg">{selectedWarning.description}</p>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs w-16">Created</span>
                  <span className="tabular-nums">{new Date(selectedWarning.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-3 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    setSelectedProjectName(selectedWarning.projectName);
                    closeDialog();
                  }}
                  data-testid="btn-go-to-project"
                >
                  <Eye className="h-4 w-4 mr-1" />
                  View Project
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                  onClick={() => setActionType("override")}
                  data-testid="btn-override-warning"
                >
                  <ShieldCheck className="h-4 w-4 mr-1" />
                  Override
                </Button>
                <Button
                  size="sm"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => setActionType("resolve")}
                  data-testid="btn-resolve-warning"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Resolve
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!actionType} onOpenChange={(open) => { if (!open) { setActionType(null); setReasonText(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {actionType === "override" ? (
                <>
                  <ShieldCheck className="h-5 w-5 text-amber-500" />
                  Override Warning
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  Close / Resolve Warning
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {selectedWarning && (
            <div className="space-y-4">
              <div className="bg-muted/50 p-3 rounded-lg text-sm">
                <p className="font-medium">{selectedWarning.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{selectedWarning.projectName}</p>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">
                  {actionType === "override" ? "Override reason" : "Resolution notes"}
                  {actionType === "override" && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                <Textarea
                  placeholder={actionType === "override"
                    ? "Provide justification for overriding this warning..."
                    : "Describe how this warning was resolved (optional)..."
                  }
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  rows={3}
                  data-testid="input-warning-reason"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setActionType(null); setReasonText(""); }} data-testid="btn-cancel-action">
              Cancel
            </Button>
            <Button
              onClick={handleAction}
              disabled={actionType === "override" && !reasonText.trim()}
              className={actionType === "override"
                ? "bg-amber-600 hover:bg-amber-700 text-white"
                : "bg-emerald-600 hover:bg-emerald-700 text-white"
              }
              data-testid="btn-confirm-action"
            >
              {(acknowledgeMutation.isPending || resolveMutation.isPending) ? "Saving..." :
                actionType === "override" ? "Confirm Override" : "Confirm Resolve"
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={startQmOpen} onOpenChange={(open) => { if (!open) { setStartQmOpen(false); setStartQmProject(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              Start Quality Process
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select a project to start the quality management process. Projects that already have a quality checklist are shown but cannot be selected.
            </p>
            <p className="text-xs text-muted-foreground bg-muted/40 border rounded-md p-2">
              Tip: if a project's quality process was deleted from the Project Checklists list, it becomes selectable here again so you can restart it from scratch.
            </p>
            <div>
              <label className="text-sm font-medium block mb-1.5">Project</label>
              <Popover open={startQmPopoverOpen} onOpenChange={setStartQmPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={startQmPopoverOpen}
                    className="w-full justify-between font-normal"
                    data-testid="select-qm-project"
                  >
                    {startQmProject || "Search and select a project..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search projects..." data-testid="input-qm-project-search" />
                    <CommandList>
                      <CommandEmpty>No projects available</CommandEmpty>
                      <CommandGroup>
                        {allProjects.map((project) => {
                          const name = project.project_name;
                          const hasChecklist = projectsWithChecklist.has(name);
                          return (
                            <CommandItem
                              key={name}
                              value={name}
                              disabled={hasChecklist}
                              onSelect={() => {
                                if (hasChecklist) return;
                                setStartQmProject(name);
                                setStartQmPopoverOpen(false);
                              }}
                              data-testid={`qm-project-option-${name}`}
                            >
                              <Check className={`mr-2 h-4 w-4 ${startQmProject === name ? "opacity-100" : "opacity-0"}`} />
                              <span className={hasChecklist ? "text-muted-foreground" : undefined}>{name}</span>
                              {hasChecklist && <span className="ml-auto text-xs text-muted-foreground">Checklist active</span>}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            {allProjects.length === 0 && (
              <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                No projects available.
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setStartQmOpen(false); setStartQmProject(""); }} data-testid="btn-cancel-start-qm">
              Cancel
            </Button>
            <Button
              onClick={() => { if (startQmProject) startQmMutation.mutate(startQmProject); }}
              disabled={!startQmProject || startQmMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="btn-confirm-start-qm"
            >
              {startQmMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Starting...</>
              ) : (
                <><ShieldCheck className="h-4 w-4 mr-2" />Start Quality Process</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDestructive
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete quality process?"
        subject={deleteTarget?.projectName ?? ""}
        description="This permanently deletes the quality checklist and every related record for this project. The project itself, its plan and finance data are not affected. After deletion you can restart the quality process from the Start Quality Process dialog."
        impact={deleteTarget ? buildDeleteImpact(deleteTarget) : []}
        actionVerb="Delete quality process"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteChecklistMutation.mutateAsync(deleteTarget.projectName);
        }}
      />
    </PageShell>
  );
}

function buildDeleteImpact(checklist: Checklist): ImpactRow[] {
  const totalItems = checklist.checklistItemCount
    ?? (checklist.phases?.reduce((t, p) => t + p.total, 0) ?? 0);
  const warnings = checklist.warningCount ?? 0;
  // We don't know the exact number of related rows from the dashboard data
  // (evidence uploads, plan links, risk answers, post-mortem rows are not
  // in the list response). Listing them with an exact count would be
  // misleading, so they're shown as a single "all related records" line
  // and the server-side transaction handles the actual cascade.
  return [
    { label: "Checklist", count: 1, severity: "high" },
    { label: "Checklist items", count: totalItems, severity: totalItems > 0 ? "high" : "low" },
    { label: "Warnings (all statuses)", count: warnings, severity: warnings > 0 ? "medium" : "low" },
    {
      label: "Evidence uploads, plan links, risk answers, post-mortem",
      count: 1,
      note: "all wiped",
      severity: "medium",
    },
  ];
}

function WarningRow({ warning, severity, onView, onOverride, onResolve, onViewProject }: {
  warning: Warning;
  severity: "high" | "medium" | "low";
  onView: () => void;
  onOverride: () => void;
  onResolve: () => void;
  onViewProject: () => void;
}) {
  const borderClass = severity === "high"
    ? "border-red-200 bg-red-50/30 hover:bg-red-50/60"
    : severity === "medium"
    ? "border-amber-200 bg-amber-50/30 hover:bg-amber-50/60"
    : "border-border/50 hover:bg-muted/30";

  const iconClass = severity === "high" ? "text-red-600" : severity === "medium" ? "text-amber-600" : "text-muted-foreground";

  const badgeClass = severity === "high"
    ? "ee-status-danger"
    : severity === "medium"
    ? "ee-status-warning"
    : "ee-status-neutral";

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border ${borderClass} cursor-pointer transition-colors`}
      onClick={onView}
      data-testid={`warning-row-${warning.id}`}
    >
      <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${iconClass}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{warning.title}</span>
          <Badge variant="outline" className={`${badgeClass} text-[10px]`}>{warning.severity}</Badge>
          <Badge variant="outline" className="text-[10px]">{warning.warningType}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{warning.projectName}</p>
        {warning.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{warning.description}</p>}
        <p className="text-[11px] text-muted-foreground mt-1">Opened {new Date(warning.createdAt).toLocaleDateString()}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={(e) => { e.stopPropagation(); onViewProject(); }}
          data-testid={`btn-warning-project-${warning.id}`}
        >
          Project
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs hover:bg-amber-50"
          onClick={(e) => { e.stopPropagation(); onOverride(); }}
          data-testid={`btn-override-${warning.id}`}
        >
          Override
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-emerald-600 hover:bg-emerald-50"
          onClick={(e) => { e.stopPropagation(); onResolve(); }}
          data-testid={`btn-resolve-${warning.id}`}
        >
          Resolve
        </Button>
      </div>
    </div>
  );
}
