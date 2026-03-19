import { createContext, useContext, useState, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  ExecutionDashboardProject,
  ExecutionDashboardResponse,
  ExecutionFilters,
  filterExecutionProjects,
} from "@/lib/execution-dashboard";

export const defaultFilters: ExecutionFilters = {
  search: "",
  portfolio: "all",
  pm: "all",
  pd: "all",
  executionPhase: "all",
  rag: "all",
  exceptionOnly: false,
  behindPlanOnly: false,
  inflowRiskOnly: false,
  outflowRiskOnly: false,
  engineeringBlockersOnly: false,
  qualityIssuesOnly: false,
  pendingApprovalsOnly: false,
  staleImportsOnly: false,
};

export interface ExecutionDashboardContextValue {
  dashboard: ExecutionDashboardResponse | null;
  loading: boolean;
  error: string | null;
  filters: ExecutionFilters;
  setFilters: React.Dispatch<React.SetStateAction<ExecutionFilters>>;
  filteredProjects: ExecutionDashboardProject[];
  allProjects: ExecutionDashboardProject[];
  fyLabel: string;
  kpis: ComputedKpis;
  actionRows: ExecutionDashboardResponse["actionCenter"]["rows"];
  lastRefresh: Date | null;
  loadData: () => Promise<void>;
  openProject: (project: ExecutionDashboardProject, tab?: string) => void;
  ragDistribution: Record<string, number>;
  portfolios: string[];
  pms: string[];
  pds: string[];
  phases: string[];
  hasActiveFilters: boolean;
}

export interface ComputedKpis {
  activeDashboardProjects: number;
  averageActualProgressPct: number | null;
  averageExpectedProgressPct: number | null;
  projectsBehindPlan: number;
  projectsRed: number;
  projectsAmber: number;
  projectsGreen: number;
  plannedRevenueFy: number;
  receivedInflowFy: number;
  openInflowFy: number;
  plannedExpenditureFy: number;
  paidExpenditureFy: number;
  openExpenditureFy: number;
  grossProfitFy: number;
  grossMarginPctFy: number | null;
  actualMarginPctFy: number | null;
  marginVariancePct: number | null;
  openEngineeringBlockers: number;
  openQualityWarnings: number;
  pendingApprovals: number;
  staleImports: number;
  engineeringBlocked: number;
  engineeringAtRisk: number;
  engineeringOnTrack: number;
  qualityBlocked: number;
  qualityAtRisk: number;
  qualityOnTrack: number;
  inflowRiskProjects: number;
  outflowRiskProjects: number;
}

export const ExecutionDashboardContext = createContext<ExecutionDashboardContextValue | null>(null);

export function useExecutionData(): ExecutionDashboardContextValue {
  const ctx = useContext(ExecutionDashboardContext);
  if (!ctx) throw new Error("useExecutionData must be used within ExecutionDashboardContext");
  return ctx;
}

export function useExecutionDataProvider(setLocation: (to: string) => void) {
  const [dashboard, setDashboard] = useState<ExecutionDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ExecutionFilters>(defaultFilters);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch("/api/lifecycle-board/execution-dashboard", { headers });
      if (!res.ok) throw new Error(`Failed to load dashboard (${res.status})`);
      const data: ExecutionDashboardResponse = await res.json();
      setDashboard(data);
      setLastRefresh(new Date());
    } catch (err: any) {
      setError(err.message || "Failed to load execution dashboard");
      toast({ title: "Error", description: err.message || "Failed to load execution dashboard", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const allProjects = dashboard?.projects || [];
  const fyLabel = dashboard?.financialYear?.label || "Current FY";

  const filteredProjects = useMemo(() => filterExecutionProjects(allProjects, filters), [allProjects, filters]);

  const portfolios = useMemo(() => Array.from(new Set(allProjects.map((p) => p.portfolio || "—"))).sort(), [allProjects]);
  const pms = useMemo(() => Array.from(new Set(allProjects.map((p) => p.pm || "Unassigned"))).sort(), [allProjects]);
  const pds = useMemo(() => Array.from(new Set(allProjects.map((p) => p.pd || "Unassigned"))).sort(), [allProjects]);
  const phases = useMemo(() => Array.from(new Set(allProjects.map((p) => p.executionPhase || "Unassigned"))).sort(), [allProjects]);

  const ragDistribution = useMemo(() => {
    const dist: Record<string, number> = { Red: 0, Amber: 0, Green: 0, Unknown: 0 };
    for (const p of filteredProjects) {
      const key = dist[p.rag] !== undefined ? p.rag : "Unknown";
      dist[key] = (dist[key] || 0) + 1;
    }
    return dist;
  }, [filteredProjects]);

  const kpis = useMemo((): ComputedKpis => {
    const fp = filteredProjects;
    const plannedRevenue = fp.reduce((s, p) => s + p.plannedRevenueFy, 0);
    const receivedInflow = fp.reduce((s, p) => s + p.receivedInflowFy, 0);
    const plannedExpenditure = fp.reduce((s, p) => s + p.plannedExpenditureFy, 0);
    const paidExpenditure = fp.reduce((s, p) => s + p.paidExpenditureFy, 0);
    const grossProfit = plannedRevenue - plannedExpenditure;
    const actualGrossProfit = receivedInflow - paidExpenditure;
    const grossMargin = plannedRevenue > 0 ? Number(((grossProfit / plannedRevenue) * 100).toFixed(1)) : null;
    const actualMargin = receivedInflow > 0 ? Number(((actualGrossProfit / receivedInflow) * 100).toFixed(1)) : null;
    const marginVariance = grossMargin !== null && actualMargin !== null ? Number((actualMargin - grossMargin).toFixed(1)) : null;

    return {
      activeDashboardProjects: fp.length,
      averageActualProgressPct: fp.length ? Number((fp.reduce((s, p) => s + (p.actualProgressPct || 0), 0) / fp.length).toFixed(1)) : null,
      averageExpectedProgressPct: fp.length ? Number((fp.reduce((s, p) => s + (p.expectedProgressPct || 0), 0) / fp.length).toFixed(1)) : null,
      projectsBehindPlan: fp.filter((p) => p.behindPlan).length,
      projectsRed: fp.filter((p) => p.rag === "Red").length,
      projectsAmber: fp.filter((p) => p.rag === "Amber").length,
      projectsGreen: fp.filter((p) => p.rag === "Green").length,
      plannedRevenueFy: plannedRevenue,
      receivedInflowFy: receivedInflow,
      openInflowFy: plannedRevenue - receivedInflow,
      plannedExpenditureFy: plannedExpenditure,
      paidExpenditureFy: paidExpenditure,
      openExpenditureFy: plannedExpenditure - paidExpenditure,
      grossProfitFy: grossProfit,
      grossMarginPctFy: grossMargin,
      actualMarginPctFy: actualMargin,
      marginVariancePct: marginVariance,
      openEngineeringBlockers: fp.reduce((s, p) => s + p.engineeringBlockerCount, 0),
      openQualityWarnings: fp.reduce((s, p) => s + p.openQualityWarningCount, 0),
      pendingApprovals: fp.reduce((s, p) => s + p.pendingApprovalCount, 0),
      staleImports: fp.filter((p) => p.importFreshness !== "Fresh").length,
      engineeringBlocked: fp.filter((p) => p.engineeringStatus === "Blocked").length,
      engineeringAtRisk: fp.filter((p) => p.engineeringStatus === "At Risk").length,
      engineeringOnTrack: fp.filter((p) => p.engineeringStatus === "On Track").length,
      qualityBlocked: fp.filter((p) => p.qualityStatus === "Blocked").length,
      qualityAtRisk: fp.filter((p) => p.qualityStatus === "At Risk").length,
      qualityOnTrack: fp.filter((p) => p.qualityStatus === "On Track").length,
      inflowRiskProjects: fp.filter((p) => p.inflowRisk).length,
      outflowRiskProjects: fp.filter((p) => p.outflowRisk).length,
    };
  }, [filteredProjects]);

  const actionRows = useMemo(() => {
    if (!dashboard) return [];
    const visibleIds = new Set(filteredProjects.map((p) => p.projectId));
    return dashboard.actionCenter.rows.filter((r) => visibleIds.has(r.projectId));
  }, [dashboard, filteredProjects]);

  const openProject = useCallback((project: ExecutionDashboardProject, tab?: string) => {
    const projectPath = `/project/${encodeURIComponent(project.projectName)}`;
    setLocation(tab ? `${projectPath}?tab=${tab}` : projectPath);
  }, [setLocation]);

  const hasActiveFilters = !!(
    filters.search || filters.portfolio !== "all" || filters.pm !== "all" ||
    filters.pd !== "all" || filters.executionPhase !== "all" || filters.rag !== "all" ||
    filters.exceptionOnly || filters.behindPlanOnly || filters.inflowRiskOnly ||
    filters.outflowRiskOnly || filters.engineeringBlockersOnly || filters.qualityIssuesOnly ||
    filters.pendingApprovalsOnly || filters.staleImportsOnly
  );

  return {
    dashboard, loading, error, filters, setFilters,
    filteredProjects, allProjects, fyLabel, kpis, actionRows,
    lastRefresh, loadData, openProject, ragDistribution,
    portfolios, pms, pds, phases, hasActiveFilters,
  };
}
