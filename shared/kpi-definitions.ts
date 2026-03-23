// GC-005: Configurable RAG thresholds — single source of truth for all screens
export interface RagThresholds {
  schedule: { amberMax: number }; // overdue task count: 0 = green, <= amberMax = amber, > amberMax = red
  cost: { greenMax: number; amberMax: number }; // cost ratio: < greenMax = green, <= amberMax = amber, > amberMax = red
  quality: { requireAllGatesPassed: boolean }; // if true, all gates must pass for green
}

export const DEFAULT_RAG_THRESHOLDS: RagThresholds = {
  schedule: { amberMax: 3 },
  cost: { greenMax: 0.9, amberMax: 1.0 },
  quality: { requireAllGatesPassed: true },
};

export function computeScheduleRag(overdueCount: number, thresholds: RagThresholds = DEFAULT_RAG_THRESHOLDS): "green" | "amber" | "red" {
  if (overdueCount === 0) return "green";
  return overdueCount <= thresholds.schedule.amberMax ? "amber" : "red";
}

export function computeCostRag(costRatio: number, thresholds: RagThresholds = DEFAULT_RAG_THRESHOLDS): "green" | "amber" | "red" {
  if (costRatio < thresholds.cost.greenMax) return "green";
  return costRatio <= thresholds.cost.amberMax ? "amber" : "red";
}

export function computeQualityRag(
  hasChecklist: boolean, gatesPassed: number, gatesTotal: number, approvedItems: number,
  thresholds: RagThresholds = DEFAULT_RAG_THRESHOLDS,
): "green" | "amber" | "red" {
  if (!hasChecklist) return "red";
  if (thresholds.quality.requireAllGatesPassed && gatesPassed === gatesTotal && gatesTotal > 0) return "green";
  if (approvedItems > 0) return "amber";
  return "red";
}

export function computeOverallRag(schedule: "green" | "amber" | "red", cost: "green" | "amber" | "red", quality: "green" | "amber" | "red"): "green" | "amber" | "red" {
  if (schedule === "red" || cost === "red" || quality === "red") return "red";
  if (schedule === "amber" || cost === "amber" || quality === "amber") return "amber";
  return "green";
}

// ── Priority Health Constants ────────────────────────────────────────
// Single source of truth for health status values used across the
// priority_derived_metrics VIEW, strategic routes, and UI components.

export type PriorityHealth = "healthy" | "at_risk" | "critical";

export const PRIORITY_HEALTH_VALUES: readonly PriorityHealth[] = ["healthy", "at_risk", "critical"] as const;

/**
 * Maps a project RAG status (case-insensitive) to a priority health value.
 * "red" → "critical", "amber"/"orange" → "at_risk", else → "healthy".
 */
export function ragStatusToHealth(ragStatus: string | null | undefined): PriorityHealth {
  if (!ragStatus) return "healthy";
  const lower = ragStatus.toLowerCase();
  if (lower === "red") return "critical";
  if (lower === "amber" || lower === "orange") return "at_risk";
  return "healthy";
}

/**
 * Derives worst-of health from an array of project RAG statuses.
 * Returns null if no statuses provided (no projects linked).
 */
export function deriveHealthFromRagStatuses(ragStatuses: string[]): PriorityHealth | null {
  if (ragStatuses.length === 0) return null;
  const mapped = ragStatuses.map(ragStatusToHealth);
  if (mapped.includes("critical")) return "critical";
  if (mapped.includes("at_risk")) return "at_risk";
  return "healthy";
}

export type KpiSourceLayer = "foundation" | "business_logic" | "derived_kpi" | "view_model";

export interface KpiDefinition {
  id: string;
  name: string;
  sourceLayer: KpiSourceLayer;
  sourceTable: string;
  sourceFields: string;
  businessRule: string;
  formula: string;
  aggregationPath: string;
  apiEndpoint: string;
  consumingComponent: string;
}

export const KPI_DEFINITIONS: Record<string, KpiDefinition> = {
  revenue_planned: {
    id: "revenue_planned",
    name: "Total Planned Revenue",
    sourceLayer: "foundation",
    sourceTable: "project_revenue_summary",
    sourceFields: "planned_revenue",
    businessRule: "Portfolio and dashboard revenue rollups sum canonical planned revenue.",
    formula: "SUM(project_revenue_summary.planned_revenue)",
    aggregationPath: "project_revenue_summary -> revenue rollup -> dashboard/portfolio cards",
    apiEndpoint: "/api/revenue-summary",
    consumingComponent: "GpTrackerTab, Dashboard SummaryCard",
  },
  eng_progress_pct: {
    id: "eng_progress_pct",
    name: "Engineering Progress %",
    sourceLayer: "business_logic",
    sourceTable: "project_eng_stages",
    sourceFields: "status",
    businessRule: "Only canonical complete engineering statuses contribute to completion percentage.",
    formula: "(complete / total) * 100",
    aggregationPath: "project_eng_stages -> summarizeEngineeringStatuses -> dashboard/portfolio",
    apiEndpoint: "/api/engineering-standup,/api/portfolio-dashboard",
    consumingComponent: "EngineeringDashboard, Dashboard SummaryCard, Portfolios",
  },
  quality_pass_rate: {
    id: "quality_pass_rate",
    name: "Quality Pass Rate %",
    sourceLayer: "business_logic",
    sourceTable: "qc_item_instance",
    sourceFields: "status",
    businessRule: "Only canonical approved statuses are counted as passed.",
    formula: "(approved / total) * 100",
    aggregationPath: "qc_item_instance -> summarizeQualityStatuses -> dashboard/portfolio",
    apiEndpoint: "/api/quality/checklists,/api/portfolio-dashboard",
    consumingComponent: "QmDashboard, Dashboard SummaryCard, Portfolios",
  },
  project_avg_progress: {
    id: "project_avg_progress",
    name: "Average Project Progress %",
    sourceLayer: "business_logic",
    sourceTable: "project_plan/work_items",
    sourceFields: "actual_pct_complete, expected_pct_complete, duration_days",
    businessRule: "Weighted completion is duration-weighted and delta thresholds drive RAG and behind counts.",
    formula: "weighted_avg(actual_pct_complete) and weighted_avg(expected_pct_complete)",
    aggregationPath: "project plan tasks -> computeProjectCompletion -> summarizeSchedule -> portfolio/dashboard",
    apiEndpoint: "/api/project-plan/:project,/api/portfolio-dashboard",
    consumingComponent: "ProjectPlanTab, Dashboard, PortfolioDetail",
  },
  // ─── Finance tracker KPIs (added for traceability) ───
  cos_tracker_realised: {
    id: "cos_tracker_realised",
    name: "COS Realised (Tracker)",
    sourceLayer: "business_logic",
    sourceTable: "program_expense",
    sourceFields: "expense_actual_total, expense_invoice_number, expense_invoiced_date",
    businessRule: "COS is realised when both invoice number and invoice date are present (classifyCosStatus === 'COS Realised').",
    formula: "SUM(expense_actual_total) WHERE classifyCosStatus(line) = 'COS Realised' AND monthKey <= currentMonth",
    aggregationPath: "program_expense -> isCosRealised (financeUtils) -> cos-tracker/gp-tracker -> COS/GP pages",
    apiEndpoint: "/api/cos-tracker,/api/gp-tracker",
    consumingComponent: "COS Tracker Page, GP Tracker Page, Dashboard COS Card",
  },
  gp_tracker_actual: {
    id: "gp_tracker_actual",
    name: "GP Actual (Tracker)",
    sourceLayer: "derived_kpi",
    sourceTable: "program_expense, program_inflows",
    sourceFields: "expense_actual_total, milestone_amount",
    businessRule: "Revenue is allocated proportionally to COS per project (COS-ratio method). GP = allocated revenue − COS. Uses financeUtils.allocateRevenue().",
    formula: "GP = allocateRevenue(lineItemCOS, totalProjectCOS, totalProjectRevenue) − lineItemCOS",
    aggregationPath: "program_expense + program_inflows -> allocateRevenue -> gp-tracker -> GP Tracker Page",
    apiEndpoint: "/api/gp-tracker,/api/gp-tracker/month-detail",
    consumingComponent: "GP Tracker Page, GP Tracker Tab",
  },
  revenue_tracker_allocated: {
    id: "revenue_tracker_allocated",
    name: "Revenue Allocated (Tracker)",
    sourceLayer: "derived_kpi",
    sourceTable: "program_expense, program_inflows",
    sourceFields: "expense_actual_total, milestone_amount",
    businessRule: "Revenue is allocated to COS line items proportionally. allocateRevenue(lineItemCOS, totalProjectCOS, totalProjectRevenue). Items with noRevenueLinked flag get zero allocation.",
    formula: "(lineItemCOS / totalProjectCOS) × totalProjectRevenue",
    aggregationPath: "program_expense + program_inflows -> allocateRevenue -> revenue-tracker -> Revenue Tracker Page",
    apiEndpoint: "/api/revenue-tracker,/api/revenue-tracker/month-detail",
    consumingComponent: "Revenue Tracker Page, Revenue Tracker Tab",
  },
  dashboard_plan_gp_margin: {
    id: "dashboard_plan_gp_margin",
    name: "Dashboard Plan GP Margin %",
    sourceLayer: "view_model",
    sourceTable: "normalized_revenue_lines, normalized_cost_lines",
    sourceFields: "amount_ex_vat",
    businessRule: "Dashboard GP% is PLAN-BASED: (plannedRevenue − plannedExpenditure) / plannedRevenue. This differs from GP Tracker which uses COS-ratio-allocated actuals.",
    formula: "(plannedRevenueFy − plannedExpenditureFy) / plannedRevenueFy",
    aggregationPath: "normalized_revenue_lines + normalized_cost_lines -> program-dashboard -> Dashboard project table",
    apiEndpoint: "/api/program-dashboard",
    consumingComponent: "Dashboard Page (Plan GP % column)",
  },
};
