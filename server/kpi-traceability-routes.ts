import { Express, Request, Response } from "express";
import { KPI_DEFINITIONS } from "@shared/kpi-definitions";
import { requireAuth } from "./auth-context";
import { requireAdmin } from "./middleware/requireAdmin";
import { getKpiAggregates } from "./repositories/kpi-traceability-repository";

export function registerKpiTraceabilityRoutes(app: Express) {
  app.get("/api/admin/kpi-traceability", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    const agg = await getKpiAggregates();

    const gpPlanned = agg.revenueSummary.totalPlannedProfit;
    const gpActual = agg.revenueSummary.totalActualProfit;
    const plannedRev = agg.revenueSummary.totalPlannedRevenue;
    const actualRev = agg.revenueSummary.totalActualRevenue;
    const engTotal = agg.engineering.total;
    const engComplete = agg.engineering.complete;
    const qcTotal = agg.quality.total;
    const qcPassed = agg.quality.approved;

    const withTraceability = (kpi: any) => ({
      ...kpi,
      sourceLayer: KPI_DEFINITIONS[kpi.id]?.sourceLayer ?? "foundation",
      businessRule: KPI_DEFINITIONS[kpi.id]?.businessRule ?? "Rule inherited from canonical aggregation in server routes.",
      aggregationPath: KPI_DEFINITIONS[kpi.id]?.aggregationPath ?? "foundation -> api endpoint -> consuming pages",
    });

    const kpis = [
      { id: "revenue_planned", name: "Total Planned Revenue", currentValue: plannedRev, sourceTable: "project_revenue_summary", sourceFields: "planned_revenue", formula: "SUM(project_revenue_summary.planned_revenue)", apiEndpoint: "/api/program-dashboard", consumingComponent: "Dashboard SummaryCard, RevenueTrackerTab" },
      { id: "revenue_actual", name: "Total Actual Revenue", currentValue: actualRev, sourceTable: "project_revenue_summary", sourceFields: "actual_revenue", formula: "SUM(project_revenue_summary.actual_revenue)", apiEndpoint: "/api/program-dashboard", consumingComponent: "Dashboard SummaryCard, RevenueTrackerTab" },
      { id: "cos_budget", name: "Total Budget COS", currentValue: agg.cos.totalBudgetCos, sourceTable: "normalized_cost_lines", sourceFields: "budget_total", formula: "SUM(normalized_cost_lines.budget_total) WHERE effective_to IS NULL", apiEndpoint: "/api/cos-tracker", consumingComponent: "COS Control, ExpenditureTab, Dashboard SummaryCard" },
      { id: "cos_actual", name: "Total Actual COS", currentValue: agg.cos.totalActualCos, sourceTable: "normalized_cost_lines", sourceFields: "amount_ex_vat", formula: "SUM(normalized_cost_lines.amount_ex_vat) WHERE effective_to IS NULL", apiEndpoint: "/api/cos-tracker", consumingComponent: "COS Control, ExpenditureTab, Dashboard SummaryCard" },
      { id: "gp_planned", name: "Total Planned GP", currentValue: gpPlanned, sourceTable: "project_revenue_summary", sourceFields: "planned_profit", formula: "SUM(project_revenue_summary.planned_profit)", apiEndpoint: "/api/program-dashboard", consumingComponent: "GpTrackerTab, Dashboard SummaryCard" },
      { id: "gp_actual", name: "Total Actual GP", currentValue: gpActual, sourceTable: "project_revenue_summary", sourceFields: "actual_profit", formula: "SUM(project_revenue_summary.actual_profit)", apiEndpoint: "/api/program-dashboard", consumingComponent: "GpTrackerTab, Dashboard SummaryCard" },
      { id: "gp_margin_planned", name: "Planned GP Margin %", currentValue: plannedRev > 0 ? Math.round((gpPlanned / plannedRev) * 10000) / 100 : 0, sourceTable: "project_revenue_summary", sourceFields: "planned_profit, planned_revenue", formula: "(SUM(planned_profit) / SUM(planned_revenue)) × 100", apiEndpoint: "/api/program-dashboard", consumingComponent: "GpTrackerTab, Dashboard SummaryCard" },
      { id: "gp_margin_actual", name: "Actual GP Margin %", currentValue: actualRev > 0 ? Math.round((gpActual / actualRev) * 10000) / 100 : 0, sourceTable: "project_revenue_summary", sourceFields: "actual_profit, actual_revenue", formula: "(SUM(actual_profit) / SUM(actual_revenue)) × 100", apiEndpoint: "/api/program-dashboard", consumingComponent: "GpTrackerTab, Dashboard SummaryCard" },
      { id: "cashflow_revenue", name: "Total Cashflow Revenue", currentValue: agg.cashflow.totalCashflowRevenue, sourceTable: "cashflow_points", sourceFields: "value (series_name LIKE '%revenue%')", formula: "SUM(cashflow_points.value) WHERE series_name ILIKE '%revenue%'", apiEndpoint: "/api/weekly-cashflow", consumingComponent: "CashflowTab, CashflowForecast" },
      { id: "cashflow_expenditure", name: "Total Cashflow Expenditure", currentValue: agg.cashflow.totalCashflowExpenditure, sourceTable: "cashflow_points", sourceFields: "value (series_name LIKE '%expenditure%')", formula: "SUM(cashflow_points.value) WHERE series_name ILIKE '%expenditure%'", apiEndpoint: "/api/weekly-cashflow", consumingComponent: "CashflowTab, CashflowForecast" },
      { id: "project_total", name: "Total Projects", currentValue: agg.projects.total, sourceTable: "project_info", sourceFields: "id", formula: "COUNT(project_info.*)", apiEndpoint: "/api/project-info", consumingComponent: "Dashboard, ProjectsSummary, LifecycleBoard" },
      { id: "project_active", name: "Active Projects", currentValue: agg.projects.active, sourceTable: "project_info", sourceFields: "is_active", formula: "COUNT(project_info.*) WHERE is_active = true", apiEndpoint: "/api/project-info", consumingComponent: "Dashboard, ProjectsSummary" },
      { id: "project_execution", name: "Execution-Enabled Projects", currentValue: agg.projects.execution, sourceTable: "project_info", sourceFields: "execution_enabled", formula: "COUNT(project_info.*) WHERE execution_enabled = true", apiEndpoint: "/api/project-info", consumingComponent: "ExecutionBoard, Dashboard" },
      { id: "project_avg_progress", name: "Average Project Progress %", currentValue: Math.round(agg.planProgress.avgActualProgress * 100) / 100, sourceTable: "project_plan", sourceFields: "actual_pct_complete", formula: "AVG(project_plan.actual_pct_complete) WHERE actual_pct_complete IS NOT NULL", apiEndpoint: "/api/project-plan/:project", consumingComponent: "ProjectPlanTab, Dashboard, ProjectDetailPage" },
      { id: "eng_tasks_total", name: "Engineering Tasks Total", currentValue: engTotal, sourceTable: "work_items", sourceFields: "id, status", formula: "COUNT(work_items.*) WHERE workstream = 'ENG' AND deleted_at IS NULL", apiEndpoint: "/api/work-items?workstream=ENG", consumingComponent: "EngineeringDashboard, EngineeringTasksPage" },
      { id: "eng_tasks_complete", name: "Engineering Tasks Complete", currentValue: engComplete, sourceTable: "work_items", sourceFields: "status", formula: "COUNT(work_items.*) WHERE workstream = 'ENG' AND status IN ('COMPLETE','Done') AND deleted_at IS NULL", apiEndpoint: "/api/work-items?workstream=ENG", consumingComponent: "EngineeringDashboard, EngineeringTasksPage" },
      { id: "eng_progress_pct", name: "Engineering Progress %", currentValue: engTotal > 0 ? Math.round((engComplete / engTotal) * 10000) / 100 : 0, sourceTable: "work_items", sourceFields: "status", formula: "(COUNT(status='COMPLETE') / COUNT(*)) × 100 WHERE workstream = 'ENG'", apiEndpoint: "/api/work-items?workstream=ENG", consumingComponent: "EngineeringDashboard, Dashboard SummaryCard" },
      { id: "quality_total", name: "Quality Checks Total", currentValue: qcTotal, sourceTable: "qc_item_instance", sourceFields: "id, approved", formula: "COUNT(qc_item_instance.*)", apiEndpoint: "/api/quality/checklists", consumingComponent: "QmDashboard, QualityTab" },
      { id: "quality_pass_rate", name: "Quality Pass Rate %", currentValue: qcTotal > 0 ? Math.round((qcPassed / qcTotal) * 10000) / 100 : 0, sourceTable: "qc_item_instance", sourceFields: "approved", formula: "(COUNT(approved=true) / COUNT(*)) × 100", apiEndpoint: "/api/quality/checklists", consumingComponent: "QmDashboard, Dashboard SummaryCard" },
      { id: "mywork_operational_tasks", name: "Operational Tasks Count (via work_items)", currentValue: agg.workItems.operationalTaskCount, sourceTable: "work_items", sourceFields: "id", formula: "COUNT(work_items.*) WHERE legacy_table = 'operational_tasks'", apiEndpoint: "/api/work-items", consumingComponent: "MyWorkTasksPage, MyToolTodayPage" },
      { id: "mywork_personal_tasks", name: "Personal Tasks Count", currentValue: agg.workItems.personalTaskCount, sourceTable: "work_items", sourceFields: "id", formula: "COUNT(work_items.*) WHERE workstream = 'PERSONAL'", apiEndpoint: "/api/work-items?workstream=PERSONAL", consumingComponent: "MyWorkTasksPage, MyToolTodayPage" },
      { id: "mywork_work_items", name: "Work Items Count", currentValue: agg.workItems.totalCount, sourceTable: "work_items", sourceFields: "id", formula: "COUNT(work_items.*)", apiEndpoint: "/api/work-items", consumingComponent: "MyWorkTasksPage, MyWorkHomePage" },
      { id: "portfolio_total", name: "Portfolio Count", currentValue: agg.portfolios.count, sourceTable: "portfolios", sourceFields: "id", formula: "COUNT(portfolios.*)", apiEndpoint: "/api/portfolios", consumingComponent: "PortfoliosPage, Dashboard" },
      { id: "inflow_total_value", name: "Total Milestone/Inflow Value", currentValue: agg.inflows.totalMilestoneValue, sourceTable: "normalized_revenue_lines", sourceFields: "amount_ex_vat", formula: "SUM(normalized_revenue_lines.amount_ex_vat) WHERE effective_to IS NULL", apiEndpoint: "/api/weekly-cashflow/detail", consumingComponent: "RevenueTrackingTab, CashflowTab" },
      { id: "inflow_in_bank", name: "Milestones In Bank", currentValue: agg.inflows.inBankCount, sourceTable: "normalized_revenue_lines", sourceFields: "paid_date, paid_date_confirmed", formula: "COUNT(normalized_revenue_lines.*) WHERE paid_date IS NOT NULL AND paid_date_confirmed = true", apiEndpoint: "/api/weekly-cashflow/detail", consumingComponent: "RevenueTrackingTab, Dashboard" },
    ];

    const enrichedKpis = kpis.map(withTraceability);
    const now = new Date().toISOString();
    for (const k of enrichedKpis) (k as any).lastComputed = now;

    res.json({ kpis: enrichedKpis, generatedAt: now, totalKpis: enrichedKpis.length });
  });
}
