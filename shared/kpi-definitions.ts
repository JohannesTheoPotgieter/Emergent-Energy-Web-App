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
};
