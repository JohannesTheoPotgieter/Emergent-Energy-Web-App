export interface ExecutionDashboardProject {
  projectId: number;
  projectName: string;
  portfolio: string;
  pm: string | null;
  pd: string | null;
  executionPhase: string | null;
  rag: string;
  actualProgressPct: number | null;
  expectedProgressPct: number | null;
  scheduleVariancePct: number | null;
  plannedRevenueFy: number;
  receivedInflowFy: number;
  openInflowFy: number;
  plannedExpenditureFy: number;
  paidExpenditureFy: number;
  openExpenditureFy: number;
  grossProfitFy: number;
  grossMarginPctFy: number | null;
  engineeringStatus: "On Track" | "At Risk" | "Blocked";
  qualityStatus: "On Track" | "At Risk" | "Blocked";
  importFreshness: "Fresh" | "Warning" | "Critical";
  importAgeDays: number | null;
  behindPlan: boolean;
  inflowRisk: boolean;
  outflowRisk: boolean;
  engineeringBlockerCount: number;
  openQualityWarningCount: number;
  pendingApprovalCount: number;
  criticalActionCount: number;
}

export interface ExecutionDashboardResponse {
  financialYear: { start: string; end: string; label: string };
  projects: ExecutionDashboardProject[];
  kpis: {
    activeDashboardProjects: number;
    averageActualProgressPct: number | null;
    averageExpectedProgressPct: number | null;
    projectsBehindPlan: number;
    plannedRevenueFy: number;
    receivedInflowFy: number;
    openInflowFy: number;
    plannedExpenditureFy: number;
    paidExpenditureFy: number;
    openExpenditureFy: number;
    grossProfitFy: number;
    grossMarginPctFy: number | null;
    openEngineeringBlockers: number;
    openQualityWarnings: number;
    pendingApprovals: number;
    staleImports: number;
  };
  actionCenter: {
    queues: string[];
    rows: Array<{
      projectId: number;
      projectName: string;
      queue: string;
      issueTitle: string;
      severity: string;
      owner: string;
      dueDate: string | null;
      link: string;
    }>;
  };
}

export interface ExecutionFilters {
  search: string;
  portfolio: string;
  pm: string;
  pd: string;
  executionPhase: string;
  rag: string;
  exceptionOnly: boolean;
  behindPlanOnly: boolean;
  inflowRiskOnly: boolean;
  outflowRiskOnly: boolean;
  engineeringBlockersOnly: boolean;
  qualityIssuesOnly: boolean;
  pendingApprovalsOnly: boolean;
  staleImportsOnly: boolean;
}

export function formatCurrencyCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `R${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `R${(value / 1_000).toFixed(0)}K`;
  return `R${value.toFixed(0)}`;
}

export function formatCurrencyFull(value: number): string {
  return `R${value.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}

export function filterExecutionProjects(projects: ExecutionDashboardProject[], filters: ExecutionFilters): ExecutionDashboardProject[] {
  const search = filters.search.trim().toLowerCase();
  return projects.filter((project) => {
    if (search) {
      const haystack = `${project.projectName} ${project.pm || ""} ${project.pd || ""} ${project.portfolio || ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (filters.portfolio !== "all" && (project.portfolio || "—") !== filters.portfolio) return false;
    if (filters.pm !== "all" && (project.pm || "Unassigned") !== filters.pm) return false;
    if (filters.pd !== "all" && (project.pd || "Unassigned") !== filters.pd) return false;
    if (filters.executionPhase !== "all" && (project.executionPhase || "Unassigned") !== filters.executionPhase) return false;
    if (filters.rag !== "all" && project.rag !== filters.rag) return false;
    if (filters.exceptionOnly && project.criticalActionCount === 0) return false;
    if (filters.behindPlanOnly && !project.behindPlan) return false;
    if (filters.inflowRiskOnly && !project.inflowRisk) return false;
    if (filters.outflowRiskOnly && !project.outflowRisk) return false;
    if (filters.engineeringBlockersOnly && project.engineeringBlockerCount === 0) return false;
    if (filters.qualityIssuesOnly && project.openQualityWarningCount === 0) return false;
    if (filters.pendingApprovalsOnly && project.pendingApprovalCount === 0) return false;
    if (filters.staleImportsOnly && project.importFreshness === "Fresh") return false;
    return true;
  });
}
