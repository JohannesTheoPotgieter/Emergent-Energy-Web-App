import { useState, useEffect, useMemo, useRef } from "react";
import { useRoute, useLocation, useSearch, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { invalidateAllTaskCaches } from "@/lib/task-cache";
import {
  DollarSign, CreditCard, TrendingUp, Activity, Landmark,
  ArrowLeft, User, CheckCircle, AlertCircle, Columns, CalendarDays,
  ListTodo, ShieldCheck, Clock, History, ArrowRight, Loader2,
  Wrench, PlusCircle, Circle, Calendar, PauseCircle, AlertTriangle,
  ChevronDown, ChevronUp, Eye, Play, Zap, Target, Trash2, Plus,
  FolderOpen, FileCheck, Search, X,
  Handshake, MapPin, LayoutDashboard, FileText, ClipboardList,
  CalendarClock, Info,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EnergyLoader } from "@/components/ui/energy-loader";
import { ExpenditureEditableTab } from "@/components/tabs/ExpenditureEditableTab";
// Finance recognition (REV/COS/GP) + invoice-milestone subtabs now render the
// ONE canonical per-project read path. The five parallel-computation tabs
// (RevenueTrackingTab, RevenueTrackerTab, MonthlyRealisationTab, GpTrackerTab)
// were removed in refactor/project-detail-finance-unify.
import { ProjectFinanceCanonical } from "@/components/finance/ProjectFinanceCanonical";
import { CashflowTab } from "@/components/tabs/CashflowTab";
import TaskDetailDrawer from "@/components/TaskDetailDrawer";
import BoardView from "@/components/BoardView";
import CalendarView from "@/components/CalendarView";
import UnifiedPlanTab from "@/components/tabs/UnifiedPlanTab";
import { QualityTab } from "@/components/tabs/QualityTab";
import { ProjectTimelineTab } from "@/components/tabs/ProjectTimelineTab";
import { ProjectRaidTab } from "@/components/tabs/ProjectRaidTab";
// Old ProjectCommissioningTab retired â€” replaced by /commissioning-dashboard page
// ProjectConstructionTab removed â€” Construction tab retired from sub-nav
import { ProjectHandoverTab } from "@/components/tabs/ProjectHandoverTab";
import { BudgetBaselineStrip } from "@/components/tabs/BudgetBaselineStrip";
import { DrawingRegisterTab } from "@/components/tabs/DrawingRegisterTab";
import { ProjectDocumentRegisterPanel } from "@/components/project-documents/ProjectDocumentRegisterPanel";
import { useProjectsSummary } from "@/hooks/use-projects-summary";
import { useAuth } from "@/hooks/use-auth";
import { ProjectCommandHeader } from "@/components/ProjectCommandHeader";
import { RevenueTrackingContent } from "@/pages/revenue-tracking";
import { ExpenditureBreakdownContent } from "@/pages/expenditure-breakdown";
import { ProgramPlanContent } from "@/pages/program-plan";
import { ManualOverridesContent } from "@/pages/manual-overrides";
import { ExcelVsAppProjectContent } from "@/pages/excel-vs-app-project";
import { CriticalControlPanel } from "@/components/stage-lifecycle/CriticalControlPanel";
import { StageTimeline } from "@/components/stage-lifecycle/StageTimeline";
import { useProjectStages } from "@/hooks/use-stage-lifecycle";
import { Milestone } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PROJECT_PHASE_LABELS, TASK_STATUSES, type ProjectPhase, checkPermission } from "@shared/schema";
import { computeScheduleRag, computeCostRag, computeQualityRag, computeOverallRag } from "@shared/kpi-definitions";
import { usePermission } from "@/hooks/use-permissions";
import { formatZar } from "@/lib/currency";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { type NextMilestoneSummary } from "@/lib/next-milestone";
import { useProjectDetail } from "@/hooks/use-project-v2";
import type { ProjectImportLineage, ProjectPermissions } from "@shared/api-types/project-v2";
import { buildProjectSummaryChipDestinations, type ProjectSummaryChipKey } from "@/lib/project-summary-chip-navigation";
import { findProjectById, findProjectByName } from "@/lib/project-route-identity";
import {
  PROJECT_DETAIL_DEFAULT_SUBTAB,
  buildLegacyProjectNameRedirect,
  buildProjectDetailPath,
  firstVisibleDepartment,
  getVisibleFinanceSubTabs,
  getVisibleProjectDepartments,
  isProjectDetailDept,
  isSubTabAllowedForDept,
  normalizeProjectDetailDeepLink,
  summarizeImportLineage,
  type FinanceSubTabGates,
  type ProjectDepartmentGates,
  type ProjectDetailDeptKey,
  type ProjectDetailSubTabKey,
} from "@/lib/project-detail-navigation";
import {
  buildFinanceStrictRows,
  buildSourceAuthorityBadges,
  buildWorkflowExceptions,
} from "@/lib/project-detail-command-centre";
import { RelatedDepartmentLinks } from "@/components/project/RelatedDepartmentLinks";
import { ProjectCommandCentre } from "@/components/project/ProjectCommandCentre";
import {
  DocumentsWorkflowSection,
  HistoryWorkflowSection,
  ProcurementWorkflowSection,
} from "@/components/project/ProjectWorkflowSections";
import { ProjectEngineeringTasksTab } from "@/components/tabs/ProjectEngineeringTasksTab";

// PR-F polish (2026-05-29) — the phase TEXT already tells the user which
// phase the project is in; the badge does not need 8 distinct color
// families competing on the page. Collapse to a single neutral chip.
function getPhaseLabel(phase: string | null): string {
  if (!phase) return "Unknown";
  return PROJECT_PHASE_LABELS[phase as ProjectPhase] || phase;
}


function PhaseBadge({ phase }: { phase: string | null }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border bg-slate-100 text-slate-700 border-slate-200"
      data-testid="badge-project-phase"
      title={getPhaseLabel(phase)}
    >
      {getPhaseLabel(phase)}
    </span>
  );
}

function ProjectPriorityBadges({ projectId }: { projectId: number | null }) {
  const { data: priorities } = useQuery<any[]>({
    queryKey: [`/api/projects/${projectId}/priorities`],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/projects/${projectId}/priorities`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectId,
  });

  if (!priorities || priorities.length === 0) return null;

  // PR-F polish — collapse the 3-family color soup (blue-healthy was
  // not even in the design system) to the canonical 4-level palette.
  const healthClasses = (h: string): string => {
    if (h === "critical") return "bg-red-50 text-red-700 border-red-200";
    if (h === "at_risk") return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
  };
  const healthDot = (h: string): string => {
    if (h === "critical") return "bg-red-500";
    if (h === "at_risk") return "bg-amber-500";
    return "bg-emerald-500";
  };

  return (
    <div className="flex items-center gap-2 mt-1 mb-2 flex-wrap">
      <span className="text-xs text-muted-foreground">Priorities:</span>
      {priorities.map((p: any) => (
        <Link key={p.id} href={`/priorities/${p.id}`} className="no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-full" aria-label={`Open priority ${p.title}`} title={`Open priority ${p.title}`}>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border cursor-pointer hover:shadow-sm transition-shadow ${healthClasses(p.effectiveHealth)}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${healthDot(p.effectiveHealth)}`} />
            {p.title}
          </span>
        </Link>
      ))}
    </div>
  );
}

function engFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const companyRole = localStorage.getItem("company_role");
  if (companyRole) headers["x-company-role"] = companyRole;
  return fetch(url, { ...options, headers: { ...headers, ...options?.headers }, credentials: "include" });
}

/** Linked entity info cards â€” shows site, opportunity, budget baseline if linked */
function LinkedEntityCards({ projectInfoId }: { projectInfoId: number }) {
  const { data: siteData } = useQuery({
    queryKey: ["project-site", projectInfoId],
    queryFn: async () => {
      const res = await fetch(`/api/sites?projectId_lookup=${projectInfoId}`, { credentials: "include" });
      if (!res.ok) return null;
      const sites = await res.json();
      return sites?.[0] || null;
    },
    staleTime: 60_000,
  });

  const { data: budgetData } = useQuery({
    queryKey: ["project-budget-baselines", projectInfoId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/budget-baselines?projectId=${projectInfoId}`, { credentials: "include", headers });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
  });

  const latestBaseline = budgetData?.[0];
  const hasSite = siteData && siteData.siteName;
  const hasBaseline = latestBaseline && latestBaseline.id;

  if (!hasSite && !hasBaseline) return null;

  return (
    <div className="flex flex-wrap gap-2" data-testid="linked-entity-cards">
      {hasSite && (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-card text-xs">
          <MapPin className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium">{siteData.siteName}</span>
          {siteData.municipality && <span className="text-muted-foreground">({siteData.municipality})</span>}
          {siteData.roofType && <Badge variant="outline" className="text-[9px] h-4">{siteData.roofType.replace(/_/g, " ")}</Badge>}
        </div>
      )}
      {hasBaseline && (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-card text-xs">
          <DollarSign className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium">Baseline v{latestBaseline.version}</span>
          {latestBaseline.changeLocked ? (
            <Badge variant="default" className="text-[9px] h-4 bg-emerald-50 text-emerald-700 border-emerald-200">Locked</Badge>
          ) : (
            <Badge variant="secondary" className="text-[9px] h-4">Draft</Badge>
          )}
          {latestBaseline.revenueBaseline && (
            <span className="text-muted-foreground">{formatZar(latestBaseline.revenueBaseline)}</span>
          )}
        </div>
      )}
    </div>
  );
}


function PhaseHistoryTimeline({ projectId }: { projectId: number }) {
  const { data } = useQuery({
    queryKey: ["phase-history", projectId],
    queryFn: async () => {
      const res = await engFetch(`/api/projects/${projectId}/phase-history`);
      if (!res.ok) return { history: [] };
      return res.json();
    },
    enabled: !!projectId,
  });

  const history = data?.history || [];
  if (history.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="phase-history-timeline">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <History className="h-3.5 w-3.5" />
        Phase History
      </h4>
      <div className="space-y-1">
        {history.slice(0, 10).map((entry: any) => (
          <div key={entry.id} className="flex items-start gap-2 text-xs py-1.5 px-2 rounded hover:bg-muted/30">
            <div className="mt-0.5 h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-muted-foreground">{getPhaseLabel(entry.fromPhase)}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{getPhaseLabel(entry.toPhase)}</span>
              </div>
              <p className="text-muted-foreground mt-0.5">{entry.reason}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                {entry.changedByName} &middot; {new Date(entry.changedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface QualityWorkspaceSummary {
  hasChecklist: boolean;
  counts: {
    evidenceRequired: number;
    pendingReview: number;
    resubmissionNeeded: number;
    blockedHandover: boolean;
  };
  handover?: {
    blocked?: boolean;
  } | null;
}


const DEPT_DEFAULT_SUBTAB = PROJECT_DETAIL_DEFAULT_SUBTAB;

function RagDot({ color }: { color: "green" | "amber" | "red" }) {
  const cls = color === "green" ? "bg-emerald-500" : color === "amber" ? "bg-amber-500" : "bg-red-500";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${cls}`} />;
}


function dataFreshnessLabel(updatedAt?: number) {
  if (!updatedAt) return { label: "Unknown", stale: true };
  const mins = Math.floor((Date.now() - updatedAt) / 60000);
  if (mins <= 10) return { label: "Live", stale: false };
  if (mins <= 60) return { label: `${mins}m old`, stale: false };
  const hrs = Math.floor(mins / 60);
  return { label: `${hrs}h old`, stale: true };
}

function TrustMarker({
  label,
  source,
  updatedAt,
  drift,
  stale,
  loadError,
  lineage,
}: {
  label: string;
  source: string;
  updatedAt?: number;
  drift?: string | null;
  stale?: boolean;
  loadError?: boolean;
  lineage?: ProjectImportLineage | null;
}) {
  const freshness = dataFreshnessLabel(updatedAt);
  const lineageStatus = lineage ? summarizeImportLineage(lineage) : null;
  const isStale = stale ?? (lineageStatus?.tone === "warning" || freshness.stale);
  // PR-F polish — previously up to 5 badges per row (source / status /
  // freshness / drift / load-error). Compress: label + source as plain
  // text, then ONE status badge (priority order: error > drift > stale
  // > fresh). The full detail still surfaces on hover via title=.
  const statusBadge =
    loadError ? { variant: "destructive" as const, label: "Unable to load" }
    : drift ? { variant: "secondary" as const, label: `Drift: ${drift}` }
    : isStale ? { variant: "secondary" as const, label: lineageStatus?.label ?? freshness.label }
    : { variant: "outline" as const, label: lineageStatus?.label ?? freshness.label };
  const detail = lineageStatus ? lineageStatus.detail : `Updated ${formatUpdatedAt(updatedAt)}`;
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] bg-card"
      data-testid={`trust-marker-${label.toLowerCase().replace(/\s+/g, '-')}`}
      title={`${label} · ${source} · ${detail}`}
    >
      <span className="font-semibold">{label}</span>
      <span className="text-muted-foreground">{source}</span>
      <Badge variant={statusBadge.variant} className="h-4 text-[9px]">{statusBadge.label}</Badge>
    </div>
  );
}
function formatUpdatedAt(ts?: number) {
  if (!ts) return "Unknown";
  return new Date(ts).toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}


export default function ProjectDetailPage() {
  const [isNameRoute, nameParams] = useRoute("/project/:projectName");
  const [isIdRoute, idParams] = useRoute("/project/id/:projectId");
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const routeProjectName = isNameRoute && nameParams?.projectName ? decodeURIComponent(nameParams.projectName) : "";
  const routeProjectId = isIdRoute && idParams?.projectId ? Number(idParams.projectId) : null;
  const { projectsSummary, isLoading: programDataLoading } = useProjectsSummary();
  const projectByName = findProjectByName(projectsSummary as any[] | undefined, routeProjectName);
  const projectById = findProjectById(projectsSummary as any[] | undefined, routeProjectId);
  const projectInfo = projectById ?? projectByName;
  const projectInfoId = projectInfo?.project_info_id ?? undefined;
  const projectName = projectInfo?.project_name ?? routeProjectName;
  const { user, isAdmin } = useAuth();
  // Canonical client RBAC: derive capability gates from the permission
  // registry / role-derived flags â€” never hardcode role-name arrays
  // (guardrail Â§ 5; reference pattern: projects.tsx uses useAuth().isAdmin).
  const { allowed: canSetRag } = usePermission('pd_overview', 'edit');

  useEffect(() => {
    if (projectName) {
      try { localStorage.setItem("last_visited_project", JSON.stringify({ name: projectName, timestamp: Date.now() })); } catch {}
    }
  }, [projectName]);

  // Wave-5 audit (2026-05-26) — deprecate the legacy by-name URL.
  // Per Six Rule #1 the projectId is the spine; routing on
  // project_name is fragile (rename races, case-insensitive lookups,
  // collisions). When the user lands on /project/:projectName and we
  // can resolve a stable project_info_id, replace the URL in history
  // so the next reload uses the canonical /project/id/:projectId.
  // Preserves the query string (?dept=, ?sub=, ?highlightId= etc.).
  useEffect(() => {
    if (isNameRoute && projectInfoId && !programDataLoading) {
      const querySuffix = searchString ? `?${searchString}` : "";
      const canonical = `/project/id/${projectInfoId}${querySuffix}`;
      // Use history.replaceState so the user doesn't see a flash and
      // the back button still works correctly.
      try {
        window.history.replaceState(null, "", canonical);
      } catch {
        // Fallback: use wouter's setLocation if direct history access
        // fails (e.g. some test environments).
        setLocation(canonical);
      }
    }
  }, [isNameRoute, projectInfoId, programDataLoading, searchString, setLocation]);
  const userRole = user?.role || localStorage.getItem("company_role") || "";

  const { data: rolePermsData, isLoading: rolePermsLoading } = useQuery({
    queryKey: ["role-perms", userRole],
    queryFn: async () => {
      if (!userRole) return null;
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/roles/${encodeURIComponent(userRole)}`, { headers, credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!userRole,
    staleTime: 60_000,
  });

  const rolePermsReady = !userRole || !rolePermsLoading;

  const canViewPerm = (entity: string): boolean => {
    if (!rolePermsReady) return false;
    const dbPerms = rolePermsData?.entityPermissions as Record<string, Record<string, boolean>> | null;
    if (dbPerms && dbPerms[entity]) {
      if (dbPerms[entity]["view"] === true) return true;
      if (dbPerms[entity]["view"] === false) return false;
    }
    return checkPermission(userRole, entity as any, "view");
  };

  const canViewFinance = canViewPerm("financials");
  const canViewEngineering = canViewPerm("engineering");
  const canViewQuality = canViewPerm("quality");
  const canViewProcurement = canViewPerm("procurement");
  const canViewDocuments = canViewPerm("documents");
  const canViewSmartImport = canViewPerm("smart_import");

  const canViewTab = {
    overview: canViewPerm("pd_overview"),
    plan: canViewPerm("pd_plan"),
    finance: canViewPerm("pd_finance") && canViewFinance,
    engineering: canViewPerm("pd_engineering") && canViewEngineering,
    quality: canViewPerm("pd_quality") && canViewQuality,
    history: canViewPerm("pd_history"),
    expenditure: canViewPerm("pd_expenditure"),
    procurement: canViewProcurement,
    documents: canViewDocuments,
    decisions: canViewPerm("pd_overview") || canViewPerm("pd_history"),
    excel: canViewFinance && canViewSmartImport,
  };

  const tabPermissionReasons: Record<string, string> = {
    eng: "Your role does not include engineering visibility.",
    quality: "Your role does not include quality visibility.",
    finance: "Your role does not include finance visibility.",
  };

  const canViewSubTab = {
    revenue: canViewPerm("pd_revenue"),
    expenditure: canViewPerm("pd_expenditure"),
    cosTracker: canViewPerm("pd_cos_tracker"),
    cashflow: canViewPerm("pd_cashflow"),
    subcontractors: canViewPerm("pd_subcontractors"),
    procurement: canViewProcurement,
    engTasks: canViewPerm("pd_eng_tasks"),
    engStages: canViewPerm("pd_eng_stages"),
    gantt: canViewPerm("pd_gantt"),
    keyDates: canViewPerm("pd_key_dates"),
    collaboration: canViewPerm("pd_collaboration"),
  };
  const departmentGates: ProjectDepartmentGates = {
    overview: canViewTab.overview || canViewTab.plan || canViewTab.finance || canViewTab.quality || canViewTab.documents,
    pm: canViewTab.overview || canViewTab.plan,
    finance: canViewTab.finance,
    engineering: canViewTab.engineering,
    quality: canViewTab.quality,
    procurement: canViewTab.procurement,
    documents: canViewTab.documents,
    history: canViewTab.decisions || canViewTab.history,
    excel: canViewTab.excel,
  };
  const financeSubTabGates: FinanceSubTabGates = {
    revenue: canViewSubTab.revenue,
    expenditure: canViewSubTab.expenditure,
    cosTracker: canViewSubTab.cosTracker,
    revenueTracker: canViewSubTab.revenue,
    gpTracker: canViewSubTab.revenue && canViewSubTab.expenditure,
    cashflow: canViewSubTab.cashflow,
  };
  const visibleDepartmentKeys = useMemo(
    () => new Set(getVisibleProjectDepartments(departmentGates).map((dept) => dept.key)),
    [
      departmentGates.overview,
      departmentGates.pm,
      departmentGates.finance,
      departmentGates.engineering,
      departmentGates.quality,
      departmentGates.procurement,
      departmentGates.documents,
      departmentGates.history,
      departmentGates.excel,
    ],
  );
  const visibleFinanceSubTabKeys = useMemo(
    () => new Set(getVisibleFinanceSubTabs(financeSubTabGates).map((tab) => tab.key)),
    [
      financeSubTabGates.revenue,
      financeSubTabGates.expenditure,
      financeSubTabGates.cosTracker,
      financeSubTabGates.revenueTracker,
      financeSubTabGates.gpTracker,
      financeSubTabGates.cashflow,
    ],
  );
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [selectedTaskRole, setSelectedTaskRole] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);


  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const urlTab = searchParams.get("tab");
  const highlightId = searchParams.get("highlightId") ? Number(searchParams.get("highlightId")) : null;
  const highlightType = searchParams.get("highlightType");

  // Resolve initial department from URL: ?dept= takes priority, then legacy ?tab=
  const urlDept = searchParams.get("dept");
  const urlSub = searchParams.get("sub") || searchParams.get("subTab");
  const engFilter = searchParams.get("engFilter");
  const qualityFilter = searchParams.get("qualityFilter");
  const qualityChip = searchParams.get("chip");
  const costFilter = searchParams.get("costFilter");
  const handoverFilter = searchParams.get("handoverFilter");
  const procurementFilter = searchParams.get("procurementFilter");

  const resolvedFromUrl = useMemo(() => normalizeProjectDetailDeepLink(searchString), [searchString]);

  const [activeDept, setActiveDept] = useState<string>(resolvedFromUrl?.dept || "overview");
  const [activeSubTab, setActiveSubTab] = useState<string>(resolvedFromUrl?.sub || "command");
  const [showActivityTimeline, setShowActivityTimeline] = useState<boolean>(false);
  const [showLifecycle, setShowLifecycle] = useState<boolean>(false);
  const [showContext, setShowContext] = useState<boolean>(false);
  // Keep legacy aliases
  const activeSection = activeDept === "pm" ? "delivery" : activeDept === "eng" ? "engineering" : activeDept === "finance" ? "commercial" : activeDept;

  useEffect(() => {
    if (resolvedFromUrl) {
      setActiveDept(resolvedFromUrl.dept);
      setActiveSubTab(resolvedFromUrl.sub);
    }
  }, [resolvedFromUrl]);

  const navigateToDept = (dept: string, subTab?: string) => {
    const requestedDept = dept as ProjectDetailDeptKey;
    const fallback = firstVisibleDepartment(departmentGates);
    const nextDept = visibleDepartmentKeys.has(requestedDept) ? requestedDept : fallback.dept;
    const requestedSub = (subTab || DEPT_DEFAULT_SUBTAB[nextDept]) as ProjectDetailSubTabKey;
    const nextSub = nextDept === "finance" && !visibleFinanceSubTabKeys.has(requestedSub)
      ? (getVisibleFinanceSubTabs(financeSubTabGates)[0]?.key ?? "revenue")
      : requestedSub;
    setActiveDept(nextDept);
    setActiveSubTab(nextSub);
    if (projectInfoId) {
      setLocation(buildProjectDetailPath({
        projectId: projectInfoId,
        currentSearch: searchString,
        dept: nextDept,
        sub: nextSub,
      }), { replace: false });
    }
  };

  const navigateToSubTab = (
    subTab: string,
    extraParams?: Record<string, string | number | boolean | null | undefined>,
    deptOverride?: string,
  ) => {
    const dept = (deptOverride || activeDept) as ProjectDetailDeptKey;
    const sub = subTab as ProjectDetailSubTabKey;
    setActiveDept(dept);
    setActiveSubTab(sub);
    if (projectInfoId) {
      setLocation(buildProjectDetailPath({
        projectId: projectInfoId,
        currentSearch: searchString,
        dept,
        sub,
        extraParams,
      }), { replace: false });
    }
  };

  // Legacy compatibility aliases
  const navigateToSection = (section: string, subTab?: string) => {
    const deptMap: Record<string, string> = {
      overview: "overview",
      delivery: "pm",
      lifecycle: "pm",
      commercial: "finance",
      engineering: "eng",
      quality: "quality",
      procurement: "procurement",
      collaboration: "documents",
      documents: "documents",
      history: "history",
    };
    navigateToDept(deptMap[section] || section, subTab);
  };

  const openExecutionArea = (section: string, subTab?: string) => {
    navigateToSection(section, subTab);
  };

  useEffect(() => {
    if (!rolePermsReady || !projectInfoId) return;
    const dept = activeDept as ProjectDetailDeptKey;
    if (!visibleDepartmentKeys.has(dept)) {
      if (resolvedFromUrl?.dept === dept) return;
      const fallback = firstVisibleDepartment(departmentGates);
      navigateToDept(fallback.dept, fallback.sub);
      return;
    }
    if (!isSubTabAllowedForDept(dept, activeSubTab)) {
      navigateToDept(dept, DEPT_DEFAULT_SUBTAB[dept]);
      return;
    }
    if (dept === "finance" && !visibleFinanceSubTabKeys.has(activeSubTab as ProjectDetailSubTabKey)) {
      const firstFinanceSubTab = getVisibleFinanceSubTabs(financeSubTabGates)[0]?.key;
      if (firstFinanceSubTab) navigateToDept("finance", firstFinanceSubTab);
    }
    if (dept === "quality" && !canViewTab.quality && canViewTab.history) {
      navigateToDept("history", "history");
    }
    if (dept === "pm" && activeSubTab === "financial-review") {
      navigateToDept("pm", "plan");
    }
    if (dept === "procurement" && activeSubTab === "procurement" && !canViewSubTab.procurement && canViewSubTab.subcontractors) {
      navigateToDept("procurement", "subcontractors");
    }
    if (dept === "history" && activeSubTab === "changes" && !canViewTab.decisions) {
      navigateToDept("history", canViewTab.history ? "history" : "comms");
    }
  }, [rolePermsReady, projectInfoId, activeDept, activeSubTab, visibleDepartmentKeys, visibleFinanceSubTabKeys]);

  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectInfoId || !projectName || isIdRoute) return;
    setLocation(buildLegacyProjectNameRedirect(projectInfoId, searchString), { replace: true });
  }, [projectInfoId, projectName, isIdRoute, searchString, setLocation]);

  // Stage lifecycle data for CriticalControlPanel and Lifecycle tab
  const { data: stageData } = useProjectStages(canViewTab.engineering ? projectInfoId : undefined);

  // â”€â”€â”€ V2 Consolidated project query â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: v2Detail, dataUpdatedAt: v2DetailUpdatedAt, isFetching: v2DetailFetching } = useProjectDetail(projectInfoId);
  const v2Perms: ProjectPermissions | null = v2Detail?.permissions ?? null;

  // V2 lazy-load hooks â€” each tab domain loads on demand.
  // Task #124: removed orphan `useProjectFinance` (data fetched but never read).

  const { data: pmAssignableUsers } = useQuery<{ id: number; name: string; username: string; role: string }[]>({
    queryKey: ["/api/pm-assignable-users"],
    queryFn: async () => {
      const res = await engFetch("/api/pm-assignable-users");
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: pdAssignableUsers } = useQuery<{ id: number; name: string; username: string; role: string }[]>({
    queryKey: ["/api/pd-assignable-users"],
    queryFn: async () => {
      const res = await engFetch("/api/pd-assignable-users");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const handleTaskClick = (taskId: number, role?: string | null) => {
    setSelectedTaskId(taskId);
    setSelectedTaskRole(role || null);
    setDrawerOpen(true);
  };

  // PD Tickets removed 2026-04-19 â€” Pipedrive/Opportunities is the source of truth.
  // Local stub kept so downstream `dependencyCount` derivation stays valid (always 0).
  const pdTicketsData: any[] = [];


  const { data: engStagesData } = useQuery({
    queryKey: ["project-eng-stages-overview", projectInfoId],
    queryFn: async () => {
      const res = await engFetch(`/api/projects/${projectInfoId}/eng-stages`);
      if (!res.ok) return { stages: [] };
      return res.json();
    },
    enabled: !!projectInfoId && canViewTab.engineering,
  });

  const { data: projectPlanData = [] } = useQuery({
    queryKey: ["project-plan", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/planning-tasks/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      const raw = await res.json();
      return Array.isArray(raw) ? raw : (raw.tasks || []);
    },
    enabled: !!projectName && (canViewTab.overview || activeDept === "pm"),
  });

  const { data: revenueData = [], dataUpdatedAt: revenueUpdatedAt, isFetching: revenueFetching, isError: revenueLoadError } = useQuery({
    queryKey: ["program-inflows", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/projects/${encodeURIComponent(projectName)}/revenue-lines`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName && canViewTab.finance,
  });

  const { data: expenseData = [], isError: expenseLoadError } = useQuery({
    queryKey: ["program-expenses", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/projects/${encodeURIComponent(projectName)}/cost-lines`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName && canViewTab.finance,
  });

  const { data: revenueTrustData } = useQuery<any>({
    queryKey: ["revenue-tab", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/revenue-tab/${encodeURIComponent(projectName)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!projectName && canViewTab.finance && (activeDept === "overview" || activeDept === "finance" || activeDept === "excel"),
  });

  const { data: expenditureTrustData } = useQuery<any>({
    queryKey: ["expenditure-breakdown", projectName, projectInfoId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (projectInfoId) params.set("projectId", String(projectInfoId));
      const qs = params.toString();
      const res = await engFetch(`/api/expenditure-breakdown/${encodeURIComponent(projectName)}${qs ? `?${qs}` : ""}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!projectName && canViewTab.finance && (activeDept === "overview" || activeDept === "finance" || activeDept === "excel"),
  });

  const { data: commercialMsObjects = [] } = useQuery<any[]>({
    queryKey: ["project-ms-objects", projectInfoId],
    queryFn: async () => {
      const res = await engFetch(`/api/ms-objects/project/${projectInfoId}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectInfoId && canViewTab.finance && (activeDept === "overview" || activeDept === "finance"),
  });

  const { data: cashflowData = [], dataUpdatedAt: cashflowUpdatedAt, isFetching: cashflowFetching, isError: cashflowLoadError } = useQuery({
    queryKey: ["cashflow", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/cashflow?project=${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName && canViewTab.finance && activeDept === "finance",
  });

  const { data: engDataForAlerts } = useQuery<{ tasks: any[] }>({
    queryKey: ["project-eng-tasks", projectInfo?.project_info_id],
    queryFn: async () => {
      const res = await engFetch(`/api/projects/${projectInfo?.project_info_id}/eng-tasks`);
      if (!res.ok) return { tasks: [] };
      return res.json();
    },
    enabled: !!projectInfo?.project_info_id && canViewTab.engineering,
  });

  const { data: qualityData, dataUpdatedAt: qualityUpdatedAt, isFetching: qualityFetching, isError: qualityLoadError } = useQuery({
    queryKey: ["quality-summary", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/quality/project/${encodeURIComponent(projectName)}/summary`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!projectName && canViewTab.quality,
  });
  const {
    data: qualityWorkspace,
    isLoading: qualityWorkspaceLoading,
    isError: qualityWorkspaceError,
  } = useQuery<QualityWorkspaceSummary>({
    queryKey: ["quality-workspace-summary", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/quality/project/${encodeURIComponent(projectName)}/workspace`);
      if (!res.ok) throw new Error("Failed to load quality workspace");
      return res.json();
    },
    enabled: !!projectName && canViewTab.quality,
  });

  const { data: projectExceptions } = useQuery<{ items: Array<{ id: string; title: string; severity: string; sourceLink: string; reason: string }>; summary?: { total: number; bySeverity: Record<string, number> } }>({
    queryKey: ["project-exceptions", projectInfoId],
    queryFn: async () => {
      const res = await engFetch(`/api/exceptions?projectId=${projectInfoId}`);
      if (!res.ok) return { items: [], summary: { total: 0, bySeverity: {} } };
      return res.json();
    },
    enabled: !!projectInfoId,
  });

  // GC-003: Server-side KPI health summary â€” single source of truth
  const { data: healthSummary } = useQuery<{
    schedule: { rag: string; overdueTasks: number; completionPct: number };
    cost: { rag: string; ratio: number; totalExpenses: number; budgetTotal: number };
    quality: { rag: string; gatesTotal: number; gatesPassed: number; totalItems: number; approvedItems: number; progressPct: number };
    revenue: { contractValue: number; realisedPct: number; totalPaidInflows: number };
    cos: { realisedPct: number; totalRealised: number };
    engineering: { progressPct: number; totalTasks: number; completedTasks: number };
    overall: { rag: string };
    alerts: { overduePlanTasks: number; overdueEngineeringTasks: number; pendingQualityApprovals: number };
  }>({
    queryKey: ["health-summary", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/projects/${encodeURIComponent(projectName)}/health-summary`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!projectName,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  // Removed: project-header-kpis query. The ProjectCommandHeader now reads
  // KPIs from the same locally-computed live data (v2 detail + revenue-tab +
  // health summary) used by the rest of the page, so this pre-aggregated
  // endpoint is no longer needed and was causing stale header values.

  // Revenue milestones (from revenue-tab endpoint â€” provides milestone-level detail not in V2)
  const revTabMilestones: any[] = revenueTrustData?.milestones || [];

  const nextMilestone = useMemo<NextMilestoneSummary | null>(() => {
    const milestones = revTabMilestones;
    const unpaid = milestones
      .filter((m: any) => m.status !== 'inBank' && m.date)
      .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (unpaid.length > 0) {
      const m = unpaid[0];
      return { name: m.milestoneName || "Revenue Milestone", date: m.date, allPaid: false };
    }
    if (milestones.length > 0) {
      return { name: "All Paid", date: null, allPaid: true };
    }
    return null;
  }, [revTabMilestones]);
  const chipDestinations = useMemo(() => buildProjectSummaryChipDestinations(projectName), [projectName]);

  if (!projectName) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-heading font-bold text-foreground">Project Not Found</h2>
        <p className="text-muted-foreground">No project specified.</p>
      </div>
    );
  }

  if (programDataLoading) {
    return (
      <PageShell className="p-3 md:p-4">
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading project data...</p>
        </div>
      </PageShell>
    );
  }

  if (projectsSummary && !projectInfo) {
    return (
      <PageShell className="p-3 md:p-4">
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-muted-foreground" />
          </div>
          <div className="text-center space-y-1">
            <h3 className="text-lg font-semibold text-foreground">Project Not Found</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              The project "{projectName.replace(/_Tracker$/i, "").replace(/_/g, " ")}" was not found in the project list. It may not have been imported yet, or the URL may be incorrect.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setLocation("/projects")} className="mt-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Project List
          </Button>
        </div>
      </PageShell>
    );
  }

  const displayName = projectName.replace("_Tracker", "");
  const phase = v2Detail?.executionState?.phase ?? projectInfo?.phase ?? null;
  const executionPhase = projectInfo?.execution_phase || phase || null;
  const pd = projectInfo?.pd || "â€”";
  const pm = projectInfo?.pm || "â€”";
  const sizeKwp = projectInfo?.size_kwp ? `${projectInfo.size_kwp.toFixed(0)} kWp` : "â€”";
  const completion = projectInfo?.project_pct_complete != null
    ? `${(projectInfo.project_pct_complete * 100).toFixed(0)}%`
    : "â€”";
  const completionNum = projectInfo?.project_pct_complete != null ? projectInfo.project_pct_complete * 100 : 0;
  // isAdmin / canSetRag are derived above from
  // useAuth().isAdmin + usePermission() â€” see note near useAuth() destructure.
  const ragStatus = v2Detail?.executionState?.ragStatus ?? projectInfo?.rag_status ?? null;

  // â”€â”€â”€ KPI computation: V2 detail â†’ healthSummary â†’ client-side fallback â”€â”€â”€
  const v2ContractValue = v2Detail?.financeSummary?.contractValue;
  const totalRevenueActual = (revenueData as any[]).reduce((s: number, r: any) => s + (Number(r.milestoneAmount) || 0), 0);
  // Coerce to number â€” projectInfo.contract_value is widened to string|number|null
  // since the column is decimal. Drizzle returns decimal as string.
  const contractValue = Number(v2ContractValue ?? healthSummary?.revenue.contractValue ?? projectInfo?.contract_value ?? totalRevenueActual ?? 0);
  const totalBudgetFromExpenses = (expenseData as any[]).reduce((s: number, e: any) => s + (Number(e.budgetTotal) || 0), 0);
  // Coerce to number â€” projectInfo.budget_total is widened to string|number|null
  // since the column is decimal. Drizzle returns decimal as string.
  const budgetTotal = Number(healthSummary?.cost.budgetTotal ?? projectInfo?.budget_total ?? totalBudgetFromExpenses ?? 0);

  // Schedule KPIs
  const planTasks = projectPlanData as any[];
  const today = new Date().toISOString().split("T")[0];
  const overduePlanTasks = planTasks.filter((t: any) => {
    const endDate = t.actualEndDate || t.dueDate || t.actualEnd || t.endDate;
    const pct = t.percentComplete != null ? Number(t.percentComplete) : (Number(t.actualPctComplete) || 0);
    const pctNorm = pct > 1 ? pct : pct * 100;
    return endDate && endDate.substring(0, 10) < today && pctNorm < 100;
  });
  const completedPlanTasks = planTasks.filter((t: any) => {
    const pct = t.percentComplete != null ? Number(t.percentComplete) : (Number(t.actualPctComplete) || 0);
    const pctNorm = pct > 1 ? pct : pct * 100;
    return pctNorm >= 100;
  });
  const planCompletionPct = v2Detail?.planSummary?.completionPct ?? healthSummary?.schedule.completionPct ?? (planTasks.length > 0 ? (completedPlanTasks.length / planTasks.length) * 100 : 0);
  const scheduleRag: "green" | "amber" | "red" = (healthSummary?.schedule.rag as any) ?? computeScheduleRag(v2Detail?.planSummary?.tasksOverdue ?? overduePlanTasks.length);

  // Cost KPIs
  const totalExpenses = healthSummary?.cost.totalExpenses ?? (expenseData as any[]).reduce((s: number, e: any) => s + (Number(e.expenseActualTotal) || 0), 0);
  const costRatio = healthSummary?.cost.ratio ?? (budgetTotal > 0 ? totalExpenses / budgetTotal : 0);
  const costRag: "green" | "amber" | "red" = (healthSummary?.cost.rag as any) ?? computeCostRag(costRatio);

  // Quality KPIs
  const qualitySummaryLegacy = qualityData as any;
  const qualityPhases = qualitySummaryLegacy?.phases || [];
  const qualityGatesTotal = healthSummary?.quality.gatesTotal ?? qualityPhases.length;
  const qualityGatesPassed = healthSummary?.quality.gatesPassed ?? qualityPhases.filter((p: any) => p.applicableItems > 0 && p.approvedItems >= p.applicableItems).length;
  const qualityTotalItems = healthSummary?.quality.totalItems ?? qualityPhases.reduce((s: number, p: any) => s + (p.applicableItems || 0), 0);
  const qualityApprovedItems = healthSummary?.quality.approvedItems ?? qualityPhases.reduce((s: number, p: any) => s + (p.approvedItems || 0), 0);
  const qualityProgressPct = healthSummary?.quality.progressPct ?? (qualityTotalItems > 0 ? (qualityApprovedItems / qualityTotalItems) * 100 : 0);
  const qualityRag: "green" | "amber" | "red" = (healthSummary?.quality.rag as any) ?? computeQualityRag(!!qualitySummaryLegacy?.hasChecklist, qualityGatesPassed, qualityGatesTotal, qualityApprovedItems);

  // Revenue realisation
  // Source of truth: revenue-tab milestones (live). healthSummary is a
  // denormalised aggregate that can lag behind in-bank confirmations and
  // was reporting 0% inflows realised even when ACTUAL = R 373k. We now
  // prefer the live computation and only fall back to the cached aggregates
  // when no live milestone data is available at all.
  const liveInBankTotal = revTabMilestones
    .filter((m: any) => m.status === 'inBank')
    .reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
  const totalPaidInflows = revTabMilestones.length > 0
    ? liveInBankTotal
    : (v2Detail?.financeSummary?.receivedRevenue ?? healthSummary?.revenue.totalPaidInflows ?? 0);
  const revenueRealisedPct = contractValue > 0
    ? (totalPaidInflows / contractValue) * 100
    : (healthSummary?.revenue.realisedPct ?? 0);

  const isExpensePaid = (e: any): boolean => {
    const hasPaymentDate = !!(e.expensePaymentDate && String(e.expensePaymentDate).trim());
    const hasInvoiceNumber = !!(e.expenseInvoiceNumber && String(e.expenseInvoiceNumber).trim());
    if (!hasInvoiceNumber || !hasPaymentDate) return false;
    const paymentDateConfirmed = e.paymentDateFontColor === 'red' ? false : (e.paymentDateFontColor === 'black' ? true : e.paymentDateConfirmed === true);
    return paymentDateConfirmed;
  };

  const isCosRealised = (e: any): boolean => {
    if (e.cosStatus === "COS Realised" || e.cosStatus === "REALIZED" || e.cosStatus === "REALISED") return true;
    const hasInvoice = !!(e.expenseInvoiceNumber && String(e.expenseInvoiceNumber).trim());
    const hasInvoiceDate = !!(e.expenseInvoicedDate && String(e.expenseInvoicedDate).trim());
    const actual = Number(e.expenseActualTotal ?? e.amountExVat ?? 0);
    return hasInvoice && hasInvoiceDate && Number.isFinite(actual) && actual > 0;
  };

  // COS realisation â€” same source-of-truth precedence as inflows: prefer
  // the live expense rows; only fall back to healthSummary's cached value
  // when expenseData is empty.
  const liveRealisedCos = (expenseData as any[]).reduce((s: number, e: any) => {
    if (isCosRealised(e)) return s + (Number(e.expenseActualTotal) || 0);
    return s;
  }, 0);
  const totalRealisedCos = healthSummary?.cos.totalRealised ?? liveRealisedCos;
  const cosDenominator = totalExpenses > 0 ? totalExpenses : budgetTotal;
  const cosRealisedPct = healthSummary?.cos.realisedPct ?? (cosDenominator > 0
    ? (totalRealisedCos / cosDenominator) * 100
    : 0);
  const marginDelta = revenueRealisedPct - cosRealisedPct;

  const overallRag: "green" | "amber" | "red" = (healthSummary?.overall.rag as any) ?? computeOverallRag(scheduleRag, costRag, qualityRag);
  const commercialPendingCount = Math.max(revTabMilestones.filter((m: any) => m.status !== 'inBank').length, 0);
  const isExpenseOverdue = (e: any): boolean => {
    if (isExpensePaid(e)) return false;
    const dueDate = e.expensePaymentDate || e.forecastPaymentDate || e.computedForecastPaymentDate || e.expenseInvoicedDate;
    if (!dueDate || !String(dueDate).trim()) return false;
    const dueDateStr = String(dueDate).substring(0, 10);
    return dueDateStr < today;
  };
  const unpaidExpenseCount = Math.max((expenseData as any[]).filter((e: any) => isExpenseOverdue(e)).length, 0);
  const revenueReconciliation = revenueTrustData?.reconciliation;
  const expenditureReconciliation = expenditureTrustData?.reconciliation;
  const pendingCashApprovals = revenueReconciliation?.approvals?.affectingCashCount
    ?? expenditureReconciliation?.approvals?.affectingCashCount
    ?? 0;
  const pendingFinanceEdits = revenueReconciliation?.editRequests?.pendingCount
    ?? expenditureReconciliation?.editRequests?.pendingCount
    ?? 0;
  const microsoftActionCount = revenueReconciliation?.microsoft?.actionRequiredCount
    ?? expenditureReconciliation?.microsoft?.actionRequiredCount
    ?? commercialMsObjects.filter((item: any) => item.actionRequired).length;
  const microsoftLinkedCount = revenueReconciliation?.microsoft?.linkedCount
    ?? expenditureReconciliation?.microsoft?.linkedCount
    ?? commercialMsObjects.length;
  const commercialRiskSignals = [
    ...((revenueTrustData?.riskSignals || []) as any[]),
    ...((expenditureTrustData?.riskSignals || []) as any[]),
  ].slice(0, 6);
  const dependencyCount = pdTicketsData.length;
  // GC-010: Normalize engineering status casing for overdue count
  const overdueEngineeringCount = healthSummary?.alerts.overdueEngineeringTasks ?? (engDataForAlerts?.tasks || []).filter((t: any) => t.dueDate && t.dueDate < today && String(t.status).toUpperCase() !== "COMPLETE").length;
  type TopAlert = { key: ProjectSummaryChipKey; label: string; count: number; action: () => void; title: string; ariaLabel: string };
  const topAlerts: TopAlert[] = ([
    { key: "overdue-plan-tasks" as ProjectSummaryChipKey, label: "Overdue plan tasks", count: overduePlanTasks.length, action: () => setLocation(chipDestinations["overdue-plan-tasks"]?.path || ""), title: chipDestinations["overdue-plan-tasks"]?.title || "Open plan tasks", ariaLabel: chipDestinations["overdue-plan-tasks"]?.ariaLabel || "Open plan tasks" },
    { key: "overdue-engineering-tasks" as ProjectSummaryChipKey, label: "Overdue engineering tasks", count: overdueEngineeringCount, action: () => setLocation(chipDestinations["overdue-engineering-tasks"]?.path || ""), title: chipDestinations["overdue-engineering-tasks"]?.title || "Open overdue engineering tasks", ariaLabel: chipDestinations["overdue-engineering-tasks"]?.ariaLabel || "Open overdue engineering tasks" },
    { key: "pending-quality-approvals" as ProjectSummaryChipKey, label: "Pending quality approvals", count: Number(qualitySummaryLegacy?.governance?.pendingReviewCount ?? 0), action: () => setLocation(chipDestinations["pending-quality-approvals"]?.path || ""), title: chipDestinations["pending-quality-approvals"]?.title || "Open pending quality approvals", ariaLabel: chipDestinations["pending-quality-approvals"]?.ariaLabel || "Open quality approvals" },
    { key: "overdue-supplier-costs" as ProjectSummaryChipKey, label: "Overdue supplier costs", count: unpaidExpenseCount, action: () => setLocation(chipDestinations["overdue-supplier-costs"]?.path || ""), title: chipDestinations["overdue-supplier-costs"]?.title || "Open overdue supplier costs", ariaLabel: chipDestinations["overdue-supplier-costs"]?.ariaLabel || "Open overdue supplier costs" },
  ] as TopAlert[]).filter((alert) => alert.count > 0);
  const collaborationSignals = {
    hasHistory: !!projectInfoId,
    hasApprovals: !!projectInfoId,
    hasComms: !!projectName,
  };

  const engStages = engStagesData?.stages || [];
  // GC-010: Normalize engineering status casing â€” compare case-insensitively
  const engStageTotalTasks = engStages.reduce((s: number, st: any) => s + (st.tasks?.length || 0), 0);
  const engStageCompletedTasks = engStages.reduce((s: number, st: any) => s + (st.tasks?.filter((t: any) => String(t.status).toLowerCase() === "complete").length || 0), 0);

  const engBoardTasks = engDataForAlerts?.tasks || [];
  const engBoardTotal = engBoardTasks.length;
  // GC-010: Normalize engineering status casing
  const engBoardCompleted = engBoardTasks.filter((t: any) => String(t.status).toUpperCase() === "COMPLETE").length;

  const engTotalTasks = engStageTotalTasks + engBoardTotal;
  const engCompletedTasks = engStageCompletedTasks + engBoardCompleted;
  const engStagePct = healthSummary?.engineering.progressPct ?? (engTotalTasks > 0 ? (engCompletedTasks / engTotalTasks) * 100 : 0);



  const projectStatusRaw = String((projectInfo as any)?.project_status ?? (projectInfo as any)?.projectStatus ?? "active");
  const projectStatusLabel: Record<string, string> = {
    active: "Active",
    hold: "On Hold",
    blocked: "Blocked",
    internal: "Internal",
    closed: "Closed",
    tbc: "TBC",
  };
  const lineageStatus = summarizeImportLineage(v2Detail?.importLineage);
  const missingImport = !v2Detail?.importLineage?.latestImport || v2Detail.importLineage.freshness.state === "missing";
  const handoverBlocked = Boolean(qualityWorkspace?.counts?.blockedHandover || qualityWorkspace?.handover?.blocked);
  const commandExceptions = buildWorkflowExceptions({
    overduePlanTasks: overduePlanTasks.length,
    overdueEngineeringTasks: overdueEngineeringCount,
    pendingQualityApprovals: Number(qualityWorkspace?.counts?.pendingReview ?? qualitySummaryLegacy?.governance?.pendingReviewCount ?? 0),
    overdueSupplierCosts: unpaidExpenseCount,
    missingImport,
    handoverBlocked,
  });
  const financeRows = buildFinanceStrictRows({
    canViewFinance: canViewTab.finance,
    plannedRevenue: contractValue,
    committedCost: Number(v2Detail?.financeSummary?.totalCost ?? totalExpenses ?? 0),
    invoicedRevenue: Number(v2Detail?.financeSummary?.totalRevenue ?? totalRevenueActual ?? 0),
    paidReceived: Number(totalPaidInflows ?? 0),
    realisedRevenuePct: Number(revenueRealisedPct ?? 0),
    realisedCosPct: Number(cosRealisedPct ?? 0),
    outstandingRevenue: Number(v2Detail?.financeSummary?.outstandingRevenue ?? Math.max(contractValue - totalPaidInflows, 0)),
    atRiskCount: Number(pendingFinanceEdits || 0)
      + Number(microsoftActionCount || 0)
      + Number(unpaidExpenseCount || 0)
      + (revenueReconciliation?.status && revenueReconciliation.status !== "reconciled" ? 1 : 0)
      + (expenditureReconciliation?.status && expenditureReconciliation.status !== "reconciled" ? 1 : 0),
  });
  const sourceAuthorityBadges = buildSourceAuthorityBadges({
    importLineage: v2Detail?.importLineage ?? null,
    canViewFinance: canViewTab.finance,
    canViewQuality: canViewTab.quality,
    canViewDocuments,
    financeDriftStatus: revenueReconciliation?.status || expenditureReconciliation?.status || null,
  });
  const commandMetrics = {
    plan: {
      label: "PM delivery",
      value: `${completedPlanTasks.length}/${planTasks.length}`,
      detail: overduePlanTasks.length > 0 ? `${overduePlanTasks.length} overdue tasks` : `${Math.round(planCompletionPct)}% complete`,
      tone: overduePlanTasks.length > 0 ? "warning" as const : "neutral" as const,
    },
    quality: {
      label: "Quality",
      value: canViewTab.quality ? `${Math.round(qualityProgressPct)}%` : "Restricted",
      detail: canViewTab.quality ? `${qualityApprovedItems}/${qualityTotalItems} checklist items approved` : "Quality data hidden by permission",
      tone: !canViewTab.quality ? "restricted" as const : qualityRag === "red" ? "danger" as const : qualityRag === "amber" ? "warning" as const : "success" as const,
    },
    engineering: {
      label: "Engineering",
      value: canViewTab.engineering ? `${Math.round(engStagePct)}%` : "Restricted",
      detail: canViewTab.engineering ? `${engCompletedTasks}/${engTotalTasks} engineering tasks complete` : "Engineering data hidden by permission",
      tone: !canViewTab.engineering ? "restricted" as const : overdueEngineeringCount > 0 ? "warning" as const : "neutral" as const,
    },
    sourceHealth: {
      label: "Source health",
      value: lineageStatus.label,
      detail: lineageStatus.detail,
      tone: lineageStatus.tone === "success" ? "success" as const : lineageStatus.tone === "danger" ? "danger" as const : lineageStatus.tone === "warning" ? "warning" as const : "neutral" as const,
    },
  };

  const ragColor = (rag: "green" | "amber" | "red") => rag === "green" ? "text-emerald-600" : rag === "amber" ? "text-amber-600" : "text-red-600";

  return (
    <PageShell className="p-3 md:p-4">
      {/* Cockpit dual-mode: executive summary â†’ execution drill-down */}
      <div data-testid="cockpit-command-header">
      <div data-testid="cockpit-mode-toggle" className="hidden" />
      <div data-testid="cockpit-mode-executive" className="hidden" />
      <div data-testid="cockpit-mode-execution" className="hidden" />
      <div data-testid="executive-summary-cards" className="hidden" />
      <ProjectCommandHeader
        projectName={projectName}
        displayName={displayName}
        phase={phase}
        pd={pd}
        pm={pm}
        sizeKwp={sizeKwp}
        completion={completion}
        completionNum={completionNum}
        contractValue={contractValue}
        revenueRealisedPct={revenueRealisedPct}
        cosRealisedPct={cosRealisedPct}
        marginDelta={marginDelta}
        scheduleRag={overallRag as "green" | "amber" | "red"}
        costRag={overallRag as "green" | "amber" | "red"}
        qualityRag={overallRag as "green" | "amber" | "red"}
        ragStatus={ragStatus}
        nextMilestone={nextMilestone}
        projectInfoId={projectInfoId ?? null}
        isAdmin={isAdmin}
        canSetRag={canSetRag}
        canViewFinance={canViewTab.finance}
        canViewQuality={canViewTab.quality}
        canViewProcurement={canViewProcurement}
        importLineage={v2Detail?.importLineage ?? null}
        pdAssignableUsers={pdAssignableUsers || []}
        pmAssignableUsers={pmAssignableUsers || []}
      />
      </div>{/* /cockpit-command-header */}


      {/* Project status / DLP badges â€” only render when non-default */}
      {(() => {
        const status = (projectInfo as any)?.project_status ?? (projectInfo as any)?.projectStatus ?? "active";
        const inDlp = !!((projectInfo as any)?.in_dlp ?? (projectInfo as any)?.inDlp);
        if (status === "active" && !inDlp) return null;
        const statusLabel: Record<string, string> = {
          hold: "On Hold", internal: "Internal", closed: "Closed", tbc: "TBC", active: "Active",
        };
        return (
          <div className="flex flex-wrap items-center gap-2 mb-3" data-testid="project-status-badges">
            {status !== "active" && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200"
                data-testid={`badge-project-status-${status}`}
                title="Project status (orthogonal to phase)"
              >
                {statusLabel[status] ?? status}
              </span>
            )}
            {inDlp && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold bg-red-50 text-red-700 border border-red-200"
                data-testid="badge-in-dlp"
                title="In Defect Liability Period â€” RAG forced to red"
              >
                In DLP
              </span>
            )}
          </div>
        );
      })()}

      {/* Stage Lifecycle â€” Critical Control Panel + Stage Timeline + Activity Timeline */}
      {projectInfoId && canViewTab.engineering && (
        <div className="rounded-lg border bg-card" data-testid="stage-lifecycle-block">
          <button
            type="button"
            onClick={() => setShowLifecycle((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={showLifecycle}
            data-testid="toggle-lifecycle"
          >
            <span className="flex items-center gap-2">
              <Milestone className="h-3.5 w-3.5" />
              Lifecycle &amp; gates
            </span>
            {showLifecycle ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showLifecycle && (
            <div className="border-t p-3 space-y-2">
              <CriticalControlPanel
                projectId={projectInfoId}
                onViewGate={() => setLocation(`/project/id/${projectInfoId}/gate/${encodeURIComponent(stageData?.currentStage?.stageCode || "S01_FIRST_ASSESSMENT")}`)}
                isAdmin={isAdmin}
              />
          {stageData && (stageData.stages || []).length > 0 && (
            <div className="rounded-lg border bg-card px-3 py-2" data-testid="stage-timeline-inline">
              <StageTimeline
                stages={(stageData.stages || []) as any}
                currentStageCode={stageData.currentStage?.stageCode ?? null}
                onStageClick={(stageCode) => setLocation(`/project/id/${projectInfoId}/gate/${encodeURIComponent(stageCode)}`)}
              />
            </div>
          )}
          <div className="rounded-lg border bg-card" data-testid="activity-timeline-disclosure">
            <button
              type="button"
              onClick={() => setShowActivityTimeline((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
              aria-expanded={showActivityTimeline}
              data-testid="toggle-activity-timeline"
            >
              <span className="flex items-center gap-2">
                <CalendarClock className="h-3.5 w-3.5" />
                Activity timeline
                <span className="text-[10px] font-normal text-muted-foreground/80">â€” gate, approval, procurement, RAID & change events</span>
              </span>
              {showActivityTimeline ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {showActivityTimeline && (
              <div className="border-t px-3 py-3">
                <ProjectTimelineTab projectName={projectName} projectInfoId={projectInfoId ?? null} />
              </div>
            )}
          </div>
            </div>
          )}
        </div>
      )}
      {projectInfoId && !canViewTab.engineering && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground" data-testid="stage-lifecycle-restricted">
          Stage gate controls are restricted for your role.
        </div>
      )}

      {/* Project context — site, budget baseline & linked priorities.
          Collapsed by default; reference data, not daily actions. */}
      {projectInfoId && (
        <div className="rounded-lg border bg-card" data-testid="project-context-disclosure">
          <button
            type="button"
            onClick={() => setShowContext((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={showContext}
            data-testid="toggle-project-context"
          >
            <span className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5" />
              Site, budget &amp; priorities
            </span>
            {showContext ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showContext && (
            <div className="border-t p-3 space-y-3">
              <ProjectPriorityBadges projectId={projectInfoId ?? null} />
              <LinkedEntityCards projectInfoId={projectInfoId} />
            </div>
          )}
        </div>
      )}

      {/* GC-012: Contract value reconciliation warning â€” uses V2 finance summary */}
      {(() => {
        const projectContractValue = Number(projectInfo?.contract_value) || 0;
        const revenueMilestoneTotal = totalRevenueActual;
        const hasContractMismatch = projectContractValue > 0 && revenueMilestoneTotal > 0
          && Math.abs(projectContractValue - revenueMilestoneTotal) / projectContractValue > 0.01;
        return hasContractMismatch ? (
          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800" data-testid="contract-value-mismatch">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              Contract value mismatch: Project info shows <strong>{formatZar(projectContractValue)}</strong> but
              revenue milestones total <strong>{formatZar(revenueMilestoneTotal)}</strong>
              {` (${((revenueMilestoneTotal - projectContractValue) / projectContractValue * 100).toFixed(1)}% difference)`}
            </span>
          </div>
        ) : null;
      })()}

      {/* Data-freshness trust markers now live inside the department "ⓘ" popover below. */}

      {canViewTab.quality && (qualityWorkspaceLoading || qualityWorkspaceError || qualityWorkspace?.hasChecklist) && (
        <div className="rounded-md border bg-card px-3 py-2 text-xs" data-testid="project-quality-readiness-strip">
          {qualityWorkspaceLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading quality readinessâ€¦
            </div>
          ) : qualityWorkspaceError ? (
            <div className="text-red-700">Could not load quality readiness. Open the Quality tab to retry.</div>
          ) : qualityWorkspace?.hasChecklist ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => navigateToSubTab("checklist", undefined, "quality")} className="rounded border px-2 py-1 hover:bg-muted">
                Quality status: <span className="font-semibold">{Math.round(qualityProgressPct)}%</span>
              </button>
              <button type="button" onClick={() => navigateToSubTab("checklist", { chip: "quality-evidence-gaps", qualityFilter: "evidence_gap" }, "quality")} className="rounded border px-2 py-1 hover:bg-muted">
                Evidence gaps: <span className="font-semibold">{qualityWorkspace.counts.evidenceRequired}</span>
              </button>
              <button type="button" onClick={() => navigateToSubTab("checklist", { chip: "pending-quality-approvals", qualityFilter: "review" }, "quality")} className="rounded border px-2 py-1 hover:bg-muted">
                Pending approvals: <span className="font-semibold">{qualityWorkspace.counts.pendingReview}</span>
              </button>
              <button type="button" onClick={() => navigateToSubTab("checklist", { qualityFilter: "fail" }, "quality")} className="rounded border px-2 py-1 hover:bg-muted">
                Failed/resubmission: <span className="font-semibold">{qualityWorkspace.counts.resubmissionNeeded}</span>
              </button>
              <button type="button" onClick={() => navigateToSubTab("checklist", { chip: "handover-blocked", qualityFilter: "handover_blocking" }, "quality")} className={`rounded border px-2 py-1 ${qualityWorkspace.counts.blockedHandover || qualityWorkspace.handover?.blocked ? "border-red-300 bg-red-50 text-red-800" : "hover:bg-muted"}`}>
                Handover blocked: <span className="font-semibold">{qualityWorkspace.counts.blockedHandover || qualityWorkspace.handover?.blocked ? "Yes" : "No"}</span>
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
           Department tabs â€” collapsed busy zone.
           Previously 5 stacked rows (permission-hints, tabs, alerts,
           trust/source, related-departments). Now: ONE row with the
           dept tabs + an "i" popover on the right that contains the
           Source/Status/Last-updated trust strip and the related-
           departments pills. Locked tabs are rendered greyed-out and
           disabled (no separate permission-hints row). Alert chips for
           the active dept appear as a slim sticky banner immediately
           below the tabs row when there is anything to flag.
         â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      <div className="flex items-center gap-2" data-testid="project-dept-tabs-row">
        <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 p-1 overflow-x-auto scrollbar-hide flex-1" data-testid="project-dept-tabs">
          {getVisibleProjectDepartments(departmentGates).map((dept) => {
            const tab = {
              ...dept,
              icon: ({
                overview: LayoutDashboard,
                pm: Target,
                finance: Landmark,
                eng: Wrench,
                quality: ShieldCheck,
                procurement: CreditCard,
                documents: FolderOpen,
                history: History,
                excel: FileText,
              } as Record<ProjectDetailDeptKey, typeof LayoutDashboard>)[dept.key],
            };
            const Icon = tab.icon;
            const isActive = activeDept === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => navigateToDept(tab.key)}
                title={tab.label}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-all border ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-background text-muted-foreground border-border hover:text-foreground hover:bg-muted/50 hover:opacity-90"
                }`}
                data-testid={`dept-tab-${tab.key}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {(!canViewTab.engineering || !canViewTab.finance) && (
          <div className="sr-only" data-testid="project-dept-permission-hints">
            {!canViewTab.engineering && <span>Engineering locked: {tabPermissionReasons.eng}</span>}
            {!canViewTab.finance && <span>Finance locked: {tabPermissionReasons.finance}</span>}
          </div>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md border border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              title="Source, sync status & related departments"
              aria-label="Source, sync status and related departments"
              data-testid="button-project-context-info"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-3 text-xs space-y-3" data-testid="popover-project-context">
            <div className="space-y-1" data-testid="project-trust-strip">
              <div className="font-semibold text-foreground text-[11px] uppercase tracking-wide">Data source</div>
              <div><strong>Source:</strong> {activeDept === "finance" || activeDept === "excel" ? "Excel tracker import + audited app overrides" : activeDept === "quality" ? "Quality workspace + SharePoint evidence" : activeDept === "documents" ? "SharePoint document control" : activeDept === "procurement" ? "Procurement and PO workflows" : activeDept === "history" ? "App decisions, reviews, and communications" : "V2 project detail + project workspaces"}</div>
              <div><strong>Status:</strong> {(activeDept === "finance" && revenueFetching) || (activeDept === "quality" && qualityFetching) || v2DetailFetching ? "Refreshing" : "Synced"}</div>
              {(activeDept === "finance" || activeDept === "excel" || activeDept === "overview") && (
                <div><strong>Import:</strong> {summarizeImportLineage(v2Detail?.importLineage).detail}</div>
              )}
              <div><strong>Last updated:</strong> {
                activeDept === "finance"
                  ? formatUpdatedAt(Math.max(v2DetailUpdatedAt || 0, revenueUpdatedAt || 0, cashflowUpdatedAt || 0))
                  : activeDept === "quality"
                    ? formatUpdatedAt(Math.max(v2DetailUpdatedAt || 0, qualityUpdatedAt || 0))
                    : formatUpdatedAt(v2DetailUpdatedAt)
              }</div>
            </div>
            <div className="border-t pt-2 space-y-1.5" data-testid="project-trust-markers">
              <div className="font-semibold text-foreground text-[11px] uppercase tracking-wide">Data freshness</div>
              <div className="flex flex-wrap gap-1.5">
                <TrustMarker label="Project" source="App" updatedAt={v2DetailUpdatedAt} stale={v2DetailFetching} loadError={!v2Detail && !v2DetailFetching} />
                <TrustMarker label="Revenue" source="Excel / App" updatedAt={revenueUpdatedAt} drift={revenueTrustData?.reconciliation?.status || null} stale={revenueFetching} loadError={revenueLoadError} lineage={v2Detail?.importLineage ?? null} />
                <TrustMarker label="Cashflow" source="QuickBooks / App" updatedAt={cashflowUpdatedAt} stale={cashflowFetching} loadError={cashflowLoadError} lineage={v2Detail?.importLineage ?? null} />
                <TrustMarker label="Quality" source="Manual override / App" updatedAt={qualityUpdatedAt} stale={qualityFetching} loadError={qualityLoadError} />
              </div>
            </div>
            <div className="border-t pt-2">
              <div className="font-semibold text-foreground text-[11px] uppercase tracking-wide mb-1.5">Related departments</div>
              <RelatedDepartmentLinks projectId={projectInfoId ?? null} projectName={projectName ?? null} />
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Per-tab alert banner â€” only the alerts relevant to the active
          dept render here, so this row collapses to nothing when there's
          nothing to flag for the current tab. */}
      {(() => {
        const deptForKey: Record<string, string> = {
          "overdue-plan-tasks": "pm",
          "overdue-engineering-tasks": "eng",
          "pending-quality-approvals": "quality",
          "overdue-supplier-costs": "finance",
        };
        const visibleAlerts = topAlerts.filter(a => deptForKey[a.key] === activeDept);
        if (visibleAlerts.length === 0) return null;
        return (
          <div className="sticky top-0 z-10 flex flex-wrap gap-1.5 -mt-1" data-testid="cockpit-exception-strip">
            {visibleAlerts.map((alert) => (
              <button
                key={alert.label}
                type="button"
                onClick={alert.action}
                title={alert.title}
                aria-label={alert.ariaLabel}
                className="text-xs rounded-md border border-amber-200 bg-amber-50 px-2 py-1 cursor-pointer transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
              >
                <span className="font-semibold text-amber-800">{alert.count}</span> {alert.label}
              </button>
            ))}
          </div>
        );
      })()}

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
           PROJECT MANAGEMENT DEPARTMENT
         â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {isProjectDetailDept(activeDept) && !visibleDepartmentKeys.has(activeDept) && (
        <div className="rounded-lg border bg-muted/30 p-6 text-sm" data-testid="project-detail-no-permission">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-semibold">You do not have access to this project area.</p>
              <p className="text-muted-foreground">
                The link is valid, but your current role cannot view the requested department. Use the visible workflow tabs above, or ask an administrator to review your permissions.
              </p>
            </div>
          </div>
        </div>
      )}

      {activeDept === "overview" && departmentGates.overview && (
        <ProjectCommandCentre
          lifecycleStage={getPhaseLabel(phase)}
          lifecycleStatus={projectStatusLabel[projectStatusRaw] ?? projectStatusRaw}
          ragStatus={String(ragStatus || overallRag || "unknown")}
          plan={commandMetrics.plan}
          quality={commandMetrics.quality}
          engineering={commandMetrics.engineering}
          sourceHealth={commandMetrics.sourceHealth}
          financeRows={financeRows}
          sourceBadges={sourceAuthorityBadges}
          exceptions={commandExceptions}
          onNavigate={(dept, sub) => navigateToDept(dept, sub)}
        />
      )}

      {activeDept === "pm" && departmentGates.pm && (
        <div className="space-y-3" data-testid="dept-pm-section">
          {/* PM KPI strip */}
          <div className="flex items-center gap-4 flex-wrap rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${scheduleRag === "green" ? "bg-emerald-500" : scheduleRag === "amber" ? "bg-amber-500" : "bg-red-500"}`} />
              <span className="text-muted-foreground">Schedule</span>
            </div>
            <div><span className="text-muted-foreground">Tasks:</span> <span className="font-semibold">{completedPlanTasks.length}/{planTasks.length}</span></div>
            {overduePlanTasks.length > 0 && <div className="text-amber-600 font-semibold"><AlertTriangle className="inline h-3 w-3 mr-0.5" />{overduePlanTasks.length} overdue</div>}
            {stageData?.currentStage && <div><span className="text-muted-foreground">Gate:</span> <span className="font-semibold">{(stageData.currentStage as any).label || stageData.currentStage.stageCode}</span></div>}
          </div>

          {/* PM sub-tabs — Plan groups the Gantt / Board / Calendar views
              behind a switcher (below); RAID and Handover are siblings. */}
          <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto scrollbar-hide" data-testid="pm-sub-tabs">
            {[
              { key: "plan", label: "Plan", icon: ListTodo },
              { key: "raid", label: "RAID", icon: AlertTriangle },
              { key: "handover", label: "Handover", icon: Handshake },
            ].filter((st: any) => st.visible !== false).map(st => {
              const isActive = st.key === "plan"
                ? (activeSubTab === "plan" || activeSubTab === "board" || activeSubTab === "calendar")
                : activeSubTab === st.key;
              return (
                <Button key={st.key} size="sm" variant={isActive ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => navigateToSubTab(st.key)} data-testid={`subtab-${st.key}`}>
                  <st.icon className="h-3 w-3 mr-1" /> {st.label}
                </Button>
              );
            })}
          </div>

          {/* Plan view switcher — Gantt / Board / Calendar are three views of
              the same tasks, chosen here rather than as separate top-level tabs. */}
          {(activeSubTab === "plan" || activeSubTab === "board" || activeSubTab === "calendar") && canViewTab.overview && (
            <div className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1" data-testid="plan-view-switcher">
              {[
                { key: "plan", label: "Gantt", icon: ListTodo },
                { key: "board", label: "Board", icon: Columns },
                { key: "calendar", label: "Calendar", icon: CalendarDays },
              ].map(v => (
                <Button
                  key={v.key}
                  size="sm"
                  variant={activeSubTab === v.key ? "default" : "ghost"}
                  className="h-7 text-xs"
                  onClick={() => navigateToSubTab(v.key)}
                  data-testid={`plan-view-${v.key}`}
                >
                  <v.icon className="h-3 w-3 mr-1" /> {v.label}
                </Button>
              ))}
            </div>
          )}

          {activeSubTab === "plan" && canViewTab.overview && <UnifiedPlanTab projectName={projectName} projectId={projectInfoId} onTaskClick={handleTaskClick} />}
          {activeSubTab === "board" && canViewTab.overview && <BoardView projectName={projectName} onTaskClick={handleTaskClick} />}
          {activeSubTab === "calendar" && canViewTab.overview && <CalendarView projectName={projectName} onTaskClick={handleTaskClick} />}
          {activeSubTab === "raid" && projectInfoId && <ProjectRaidTab projectId={projectInfoId} projectName={projectName} />}
          {activeSubTab === "handover" && projectInfoId && <ProjectHandoverTab projectId={projectInfoId} projectName={projectName} initialFilter={handoverFilter === "blocked" ? "blocked" : "all"} />}
        </div>
      )}

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
           ENGINEERING DEPARTMENT
           Permission guard: activeSection === "engineering" && canViewTab.engineering
         â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {activeDept === "eng" && canViewTab.engineering && (
        <div className="space-y-3" data-testid="dept-eng-section">
          {/* Engineering KPI strip */}
          <div className="flex items-center gap-4 flex-wrap rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <div><span className="text-muted-foreground">Progress:</span> <span className="font-semibold">{Math.round(engStagePct)}%</span></div>
            <div><span className="text-muted-foreground">Tasks:</span> <span className="font-semibold">{engCompletedTasks}/{engTotalTasks}</span></div>
            {overdueEngineeringCount > 0 && <div className="text-amber-600 font-semibold"><AlertTriangle className="inline h-3 w-3 mr-0.5" />{overdueEngineeringCount} overdue</div>}
          </div>

          {/* Engineering sub-tabs: subtab-tasks, subtab-drawings.
              Timeline (stage + activity) was moved into the Stage Lifecycle block at the top of the page;
              legacy ?sub=timeline URLs fall through to the Tasks sub-tab. */}
          <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto scrollbar-hide" data-testid="eng-sub-tabs">
            {[
              { key: "tasks", label: "Tasks", icon: ListTodo },
              { key: "drawings", label: "Drawings", icon: FileText },
              { key: "documents", label: "Documents", icon: FolderOpen },
            ].map(st => (
              <Button key={st.key} size="sm" variant={activeSubTab === st.key ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => navigateToSubTab(st.key)} data-testid={`subtab-${st.key}`}>
                <st.icon className="h-3 w-3 mr-1" /> {st.label}
              </Button>
            ))}
          </div>

          {(activeSubTab === "tasks" || activeSubTab === "timeline") && projectInfoId && <ProjectEngineeringTasksTab projectInfoId={projectInfoId} isAdmin={isAdmin} projectName={projectName} initialStatusFilter={engFilter || undefined} />}
          {activeSubTab === "drawings" && projectInfoId && <DrawingRegisterTab projectId={projectInfoId} projectName={projectName} />}
          {activeSubTab === "documents" && projectInfoId && <ProjectDocumentRegisterPanel projectId={projectInfoId} projectName={projectName} domain="engineering" />}
        </div>
      )}

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
           QUALITY DEPARTMENT
           Permission guard: activeSection === "quality" && canViewTab.quality
         â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {activeDept === "quality" && canViewTab.quality && (
        <div className="space-y-3" data-testid="dept-quality-section">
          {/* Quality KPI strip */}
          <div className="flex items-center gap-4 flex-wrap rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${qualityRag === "green" ? "bg-emerald-500" : qualityRag === "amber" ? "bg-amber-500" : "bg-red-500"}`} />
              <span className="text-muted-foreground">Quality</span>
            </div>
            <div><span className="text-muted-foreground">Checklist:</span> <span className="font-semibold">{Math.round(qualityProgressPct)}%</span></div>
            <div><span className="text-muted-foreground">Items:</span> <span className="font-semibold">{qualityApprovedItems}/{qualityTotalItems}</span></div>
            {(qualityTotalItems - qualityApprovedItems) > 0 && <div className="text-amber-600 font-semibold"><AlertTriangle className="inline h-3 w-3 mr-0.5" />{qualityTotalItems - qualityApprovedItems} pending</div>}
          </div>

          {/* Quality sub-tabs */}
          <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto scrollbar-hide" data-testid="quality-sub-tabs">
            {[
              { key: "checklist", label: "QC Checklist", icon: ClipboardList, visible: canViewTab.quality },
              { key: "documents", label: "Documents", icon: FolderOpen, visible: canViewTab.quality },
            ].filter(st => st.visible).map(st => (
              <Button key={st.key} size="sm" variant={activeSubTab === st.key ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => navigateToSubTab(st.key)} data-testid={`subtab-${st.key}`}>
                <st.icon className="h-3 w-3 mr-1" /> {st.label}
              </Button>
            ))}
          </div>

          {activeSubTab === "checklist" && canViewTab.quality && <QualityTab projectName={projectName} projectInfoId={projectInfoId ?? null} initialStatusFilter={qualityFilter || undefined} chip={qualityChip || undefined} onNavigateSubTab={(sub) => navigateToSubTab(sub)} />}
          {activeSubTab === "documents" && canViewTab.quality && projectInfoId && <ProjectDocumentRegisterPanel projectId={projectInfoId} projectName={projectName} domain="quality" />}
        </div>
      )}

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
           PROJECT DEVELOPMENT DEPARTMENT
           Permission guard: activeSection === "commercial" && canViewTab.finance
         â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {activeDept === "finance" && canViewTab.finance && (
        // Task #124 â€” section-scoped fallback so a Commercial render crash
        // doesn't take down the whole page.
        <ErrorBoundary
          fallback={({ error, reset }) => (
            <div
              className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
              data-testid="commercial-section-error"
            >
              <div className="font-semibold mb-1">Commercial section failed to render</div>
              <div className="text-xs opacity-80 mb-2">
                {error?.message ?? "Unknown render error"}
              </div>
              <button
                type="button"
                onClick={reset}
                className="text-xs underline hover:no-underline"
                data-testid="button-commercial-retry"
              >
                Try again
              </button>
            </div>
          )}
        >
        <div className="space-y-3" data-testid="dept-finance-section">
          {/* Finance KPI strip */}
          <div className="flex items-center gap-4 flex-wrap rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <div><span className="text-muted-foreground">Contract:</span> <span className="font-semibold">{contractValue > 0 ? formatZar(contractValue) : "â€”"}</span></div>
            <div><span className="text-muted-foreground">Revenue:</span> <span className="font-semibold">{Math.round(revenueRealisedPct)}%</span></div>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${costRag === "green" ? "bg-emerald-500" : costRag === "amber" ? "bg-amber-500" : "bg-red-500"}`} />
              <span className="text-muted-foreground">Cost</span>
            </div>
            {budgetTotal > 0 && <div><span className="text-muted-foreground">Margin:</span> <span className={`font-semibold ${marginDelta >= 0 ? "text-emerald-600" : "text-red-600"}`}>{marginDelta >= 0 ? "+" : ""}{marginDelta.toFixed(1)}%</span></div>}
          {(revenueLoadError || expenseLoadError || cashflowLoadError) && (
            <div className="text-red-700 font-semibold" data-testid="finance-load-warning">Unable to load one or more finance feeds.</div>
          )}

          </div>

          {/* Finance sub-tabs — the COS / Revenue / GP monthly grids share one
              "Recognition" tab with a metric switcher (below). */}
          <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto scrollbar-hide" data-testid="finance-sub-tabs">
            {(() => {
              const recognitionVisible = financeSubTabGates.revenueTracker || financeSubTabGates.cosTracker || financeSubTabGates.gpTracker;
              const recognitionDefault: ProjectDetailSubTabKey = financeSubTabGates.revenueTracker ? "rev-tracker" : financeSubTabGates.cosTracker ? "cos-tracker" : "gp-tracker";
              return [
                { key: "revenue", label: "Invoice Milestones", icon: DollarSign, visible: financeSubTabGates.revenue, target: "revenue", group: ["revenue"] },
                { key: "cost-lines", label: "Expenditure Breakdown", icon: CreditCard, visible: financeSubTabGates.expenditure, target: "cost-lines", group: ["cost-lines"] },
                { key: "recognition", label: "Recognition", icon: TrendingUp, visible: recognitionVisible, target: recognitionDefault, group: ["rev-tracker", "cos-tracker", "gp-tracker"] },
                { key: "cashflow", label: "Cashflow", icon: Activity, visible: financeSubTabGates.cashflow, target: "cashflow", group: ["cashflow"] },
              ].filter(st => st.visible).map(st => (
                <Button key={st.key} size="sm" variant={st.group.includes(activeSubTab) ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => navigateToSubTab(st.target)} data-testid={`subtab-${st.key}`}>
                  <st.icon className="h-3 w-3 mr-1" /> {st.label}
                </Button>
              ));
            })()}
          </div>

          {/* Recognition switcher — Revenue / COS / GP are the same monthly grid,
              one metric at a time. Each remains an independent deep-link + gate. */}
          {(activeSubTab === "rev-tracker" || activeSubTab === "cos-tracker" || activeSubTab === "gp-tracker") && (
            <div className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1" data-testid="recognition-view-switcher">
              {[
                { key: "rev-tracker", label: "Revenue", visible: financeSubTabGates.revenueTracker },
                { key: "cos-tracker", label: "COS", visible: financeSubTabGates.cosTracker },
                { key: "gp-tracker", label: "GP", visible: financeSubTabGates.gpTracker },
              ].filter(v => v.visible).map(v => (
                <Button key={v.key} size="sm" variant={activeSubTab === v.key ? "default" : "ghost"} className="h-7 text-xs" onClick={() => navigateToSubTab(v.key)} data-testid={`recognition-view-${v.key}`}>
                  {v.label}
                </Button>
              ))}
            </div>
          )}

          {/* Budget baseline strip */}
          {projectInfoId && (activeSubTab === "revenue" || activeSubTab === "cost-lines" || activeSubTab === "gp-tracker") && (
            <BudgetBaselineStrip projectId={projectInfoId} actualRevenue={totalRevenueActual} />
          )}

          {activeSubTab === "revenue" && canViewSubTab.revenue && <ProjectFinanceCanonical projectId={projectInfoId ?? null} projectName={projectName} focus="revenue" />}
          {activeSubTab === "cost-lines" && canViewSubTab.expenditure && <ExpenditureEditableTab projectName={projectName} projectId={projectInfoId ?? null} highlightId={highlightType === 'expense' ? highlightId : null} initialFilter={costFilter || undefined} />}
          {activeSubTab === "cos-tracker" && canViewSubTab.cosTracker && <ProjectFinanceCanonical projectId={projectInfoId ?? null} projectName={projectName} focus="cos" />}
          {activeSubTab === "rev-tracker" && canViewSubTab.revenue && <ProjectFinanceCanonical projectId={projectInfoId ?? null} projectName={projectName} focus="revenue" />}
          {activeSubTab === "gp-tracker" && canViewSubTab.revenue && canViewSubTab.expenditure && <ProjectFinanceCanonical projectId={projectInfoId ?? null} projectName={projectName} focus="gp" />}
          {activeSubTab === "cashflow" && canViewSubTab.cashflow && <CashflowTab projectName={projectName} canOverrideFinance={v2Perms?.canOverrideFinance ?? false} />}
        </div>
        </ErrorBoundary>
      )}

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
           PROJECT DEVELOPMENT DEPARTMENT
         â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {activeDept === "procurement" && canViewTab.procurement && (
        <ProcurementWorkflowSection
          activeSubTab={activeSubTab}
          canViewProcurement={canViewSubTab.procurement}
          canViewSubcontractors={canViewSubTab.subcontractors}
          projectInfoId={projectInfoId ?? null}
          projectName={projectName}
          procurementFilter={procurementFilter}
          navigateToSubTab={navigateToSubTab}
        />
      )}

      {activeDept === "documents" && canViewTab.documents && (
        <DocumentsWorkflowSection
          projectInfoId={projectInfoId ?? null}
        />
      )}

      {activeDept === "history" && departmentGates.history && (
        <HistoryWorkflowSection
          activeSubTab={activeSubTab}
          canViewDecisions={canViewTab.decisions}
          canViewHistory={canViewTab.history}
          canViewQuality={canViewTab.quality}
          canViewFinance={canViewTab.finance}
          canViewEngineering={canViewTab.engineering}
          projectInfoId={projectInfoId ?? null}
          projectName={projectName}
          phase={phase}
          completion={projectInfo?.project_pct_complete}
          totalPaidInflows={totalPaidInflows}
          totalExpenses={totalExpenses}
          overdueEngineeringCount={overdueEngineeringCount}
          navigateToSubTab={navigateToSubTab}
        />
      )}

      {activeDept === "excel" && canViewTab.excel && (
        <div className="space-y-3" data-testid="dept-excel-section">
          <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto scrollbar-hide" data-testid="excel-sub-tabs">
            {[
              { key: "rev-replica", label: "Revenue Tracking", icon: DollarSign, visible: true },
              { key: "exp-replica", label: "Expenditure Breakdown", icon: CreditCard, visible: true },
              { key: "plan-replica", label: "Program Plan", icon: CalendarDays, visible: true },
              { key: "edit-log", label: "Manual Edit Log", icon: History, visible: true },
              { key: "drift", label: "Excel vs App", icon: AlertTriangle, visible: true },
            ].filter(st => st.visible).map(st => (
              <Button key={st.key} size="sm" variant={activeSubTab === st.key ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => navigateToSubTab(st.key)} data-testid={`subtab-${st.key}`}>
                <st.icon className="h-3 w-3 mr-1" /> {st.label}
              </Button>
            ))}
          </div>

          {activeSubTab === "rev-replica" && projectInfoId && <RevenueTrackingContent projectId={projectInfoId} />}
          {activeSubTab === "exp-replica" && projectInfoId && <ExpenditureBreakdownContent projectId={projectInfoId} />}
          {activeSubTab === "plan-replica" && projectInfoId && <ProgramPlanContent projectId={projectInfoId} />}
          {activeSubTab === "edit-log" && projectInfoId && <ManualOverridesContent projectId={projectInfoId} />}
          {activeSubTab === "drift" && projectInfoId && <ExcelVsAppProjectContent projectId={projectInfoId} />}
        </div>
      )}

      <TaskDetailDrawer
        taskId={selectedTaskId}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedTaskId(null); setSelectedTaskRole(null); }}
        projectName={projectName}
        trackingRole={selectedTaskRole === "VIEWER" ? "viewer" : selectedTaskRole === "OWNER" ? "assignee" : selectedTaskRole === "REVIEWER" ? "assignee" : null}
      />

    </PageShell>
  );
}
