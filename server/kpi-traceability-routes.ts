import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { verifyToken } from "./jwt";
import { KPI_DEFINITIONS } from "@shared/kpi-definitions";
import { summarizeEngineeringStatuses, summarizeQualityStatuses } from "./services/kpi-service";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload) {
      (req as any).user = { id: payload.userId, email: payload.email, name: payload.name, role: payload.role };
      return next();
    }
  }
  res.status(401).json({ error: "auth_required", message: "Authentication required" });
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = (req as any).user?.role;
  if (role === "admin" || role === "COO_ADMIN" || role === "CEO_ADMIN") return next();
  res.status(403).json({ error: "admin_required", message: "Admin access required" });
}

function rows0(r: any): any {
  return (Array.isArray(r) ? r : (r as any).rows || [])[0] || {};
}

export function registerKpiTraceabilityRoutes(app: Express) {
  app.get("/api/admin/kpi-traceability", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const [revSummary, cosAgg, cashflowAgg, projCounts, planProgress, engAgg, qcAgg, opCount, ptCount, wiCount, pCount, inflowAgg] = await Promise.all([
        db.execute(sql`
          SELECT 
            COALESCE(SUM(CAST(planned_revenue AS NUMERIC)), 0) as total_planned_revenue,
            COALESCE(SUM(CAST(actual_revenue AS NUMERIC)), 0) as total_actual_revenue,
            COALESCE(SUM(CAST(planned_expenditure AS NUMERIC)), 0) as total_planned_expenditure,
            COALESCE(SUM(CAST(actual_expenditure AS NUMERIC)), 0) as total_actual_expenditure,
            COALESCE(SUM(CAST(planned_profit AS NUMERIC)), 0) as total_planned_profit,
            COALESCE(SUM(CAST(actual_profit AS NUMERIC)), 0) as total_actual_profit
          FROM project_revenue_summary
        `).then(rows0),
        db.execute(sql`
          SELECT 
            COALESCE(SUM(CAST(budget_total AS NUMERIC)), 0) as total_budget_cos,
            COALESCE(SUM(CAST(actual_cos_total AS NUMERIC)), 0) as total_actual_cos
          FROM program_expense
          WHERE row_type = 'item' OR row_type IS NULL
        `).then(rows0),
        db.execute(sql`
          SELECT 
            COALESCE(SUM(CASE WHEN series_name ILIKE '%revenue%' THEN CAST(value AS NUMERIC) ELSE 0 END), 0) as total_cashflow_revenue,
            COALESCE(SUM(CASE WHEN series_name ILIKE '%expenditure%' OR series_name ILIKE '%expense%' THEN CAST(value AS NUMERIC) ELSE 0 END), 0) as total_cashflow_expenditure,
            COUNT(DISTINCT project_name) as project_count
          FROM cashflow_points
        `).then(rows0),
        db.execute(sql`
          SELECT 
            COUNT(*) as total_projects,
            COUNT(CASE WHEN is_active = true THEN 1 END) as active_projects,
            COUNT(CASE WHEN execution_enabled = true THEN 1 END) as execution_projects
          FROM project_info
        `).then(rows0),
        db.execute(sql`
          SELECT 
            COALESCE(AVG(actual_pct_complete), 0) as avg_actual_progress,
            COALESCE(AVG(expected_pct_complete), 0) as avg_expected_progress,
            COUNT(*) as total_plan_tasks
          FROM project_plan
          WHERE actual_pct_complete IS NOT NULL
        `).then(rows0),
        db.execute(sql`SELECT status FROM project_eng_stages`).then((r: any) => summarizeEngineeringStatuses((r.rows || []) as Array<{ status: unknown }>)).catch(() => ({ total: 0, complete: 0, inProgress: 0, notStarted: 0 })),
        db.execute(sql`SELECT status FROM qc_item_instance`).then((r: any) => summarizeQualityStatuses((r.rows || []) as Array<{ status: unknown }>)).catch(() => ({ total: 0, approved: 0, pending: 0, failed: 0 })),
        db.execute(sql`SELECT COUNT(*) as c FROM operational_tasks WHERE deleted_at IS NULL`).then(rows0).catch(() => ({ c: 0 })),
        db.execute(sql`SELECT COUNT(*) as c FROM mytool_tasks WHERE deleted_at IS NULL`).then(rows0).catch(() => ({ c: 0 })),
        db.execute(sql`SELECT COUNT(*) as c FROM work_items WHERE deleted_at IS NULL`).then(rows0).catch(() => ({ c: 0 })),
        db.execute(sql`SELECT COUNT(*) as c FROM portfolios`).then(rows0).catch(() => ({ c: 0 })),
        db.execute(sql`
          SELECT 
            COALESCE(SUM(CAST(milestone_amount AS NUMERIC)), 0) as total_milestone_value,
            COUNT(CASE WHEN in_bank = 1 THEN 1 END) as in_bank_count,
            COUNT(*) as total_milestones
          FROM program_inflows
        `).then(rows0),
      ]);

      const gpPlanned = Number(revSummary?.total_planned_profit ?? 0);
      const gpActual = Number(revSummary?.total_actual_profit ?? 0);
      const plannedRev = Number(revSummary?.total_planned_revenue ?? 0);
      const actualRev = Number(revSummary?.total_actual_revenue ?? 0);
      const engTotal = Number(engAgg?.total ?? 0);
      const engComplete = Number(engAgg?.complete ?? 0);
      const qcTotal = Number(qcAgg?.total ?? 0);
      const qcPassed = Number(qcAgg?.approved ?? 0);


      const withTraceability = (kpi: any) => ({
        ...kpi,
        sourceLayer: KPI_DEFINITIONS[kpi.id]?.sourceLayer ?? "foundation",
        businessRule: KPI_DEFINITIONS[kpi.id]?.businessRule ?? "Rule inherited from canonical aggregation in server routes.",
        aggregationPath: KPI_DEFINITIONS[kpi.id]?.aggregationPath ?? "foundation -> api endpoint -> consuming pages",
      });
      const kpis = [
        { id: "revenue_planned", name: "Total Planned Revenue", currentValue: Number(revSummary?.total_planned_revenue ?? 0), sourceTable: "project_revenue_summary", sourceFields: "planned_revenue", formula: "SUM(project_revenue_summary.planned_revenue)", apiEndpoint: "/api/revenue-summary", consumingComponent: "Dashboard SummaryCard, RevenueTrackerTab" },
        { id: "revenue_actual", name: "Total Actual Revenue", currentValue: Number(revSummary?.total_actual_revenue ?? 0), sourceTable: "project_revenue_summary", sourceFields: "actual_revenue", formula: "SUM(project_revenue_summary.actual_revenue)", apiEndpoint: "/api/revenue-summary", consumingComponent: "Dashboard SummaryCard, RevenueTrackerTab" },
        { id: "cos_budget", name: "Total Budget COS", currentValue: Number(cosAgg?.total_budget_cos ?? 0), sourceTable: "program_expense", sourceFields: "budget_total", formula: "SUM(program_expense.budget_total) WHERE row_type='item'", apiEndpoint: "/api/expenses", consumingComponent: "COS Control, ExpenditureTab, Dashboard SummaryCard" },
        { id: "cos_actual", name: "Total Actual COS", currentValue: Number(cosAgg?.total_actual_cos ?? 0), sourceTable: "program_expense", sourceFields: "actual_cos_total", formula: "SUM(program_expense.actual_cos_total) WHERE row_type='item'", apiEndpoint: "/api/expenses", consumingComponent: "COS Control, ExpenditureTab, Dashboard SummaryCard" },
        { id: "gp_planned", name: "Total Planned GP", currentValue: gpPlanned, sourceTable: "project_revenue_summary", sourceFields: "planned_profit", formula: "SUM(project_revenue_summary.planned_profit)", apiEndpoint: "/api/revenue-summary", consumingComponent: "GpTrackerTab, Dashboard SummaryCard" },
        { id: "gp_actual", name: "Total Actual GP", currentValue: gpActual, sourceTable: "project_revenue_summary", sourceFields: "actual_profit", formula: "SUM(project_revenue_summary.actual_profit)", apiEndpoint: "/api/revenue-summary", consumingComponent: "GpTrackerTab, Dashboard SummaryCard" },
        { id: "gp_margin_planned", name: "Planned GP Margin %", currentValue: plannedRev > 0 ? Math.round((gpPlanned / plannedRev) * 10000) / 100 : 0, sourceTable: "project_revenue_summary", sourceFields: "planned_profit, planned_revenue", formula: "(SUM(planned_profit) / SUM(planned_revenue)) × 100", apiEndpoint: "/api/revenue-summary", consumingComponent: "GpTrackerTab, Dashboard SummaryCard" },
        { id: "gp_margin_actual", name: "Actual GP Margin %", currentValue: actualRev > 0 ? Math.round((gpActual / actualRev) * 10000) / 100 : 0, sourceTable: "project_revenue_summary", sourceFields: "actual_profit, actual_revenue", formula: "(SUM(actual_profit) / SUM(actual_revenue)) × 100", apiEndpoint: "/api/revenue-summary", consumingComponent: "GpTrackerTab, Dashboard SummaryCard" },
        { id: "cashflow_revenue", name: "Total Cashflow Revenue", currentValue: Number(cashflowAgg?.total_cashflow_revenue ?? 0), sourceTable: "cashflow_points", sourceFields: "value (series_name LIKE '%revenue%')", formula: "SUM(cashflow_points.value) WHERE series_name ILIKE '%revenue%'", apiEndpoint: "/api/cashflow", consumingComponent: "CashflowTab, CashflowForecast" },
        { id: "cashflow_expenditure", name: "Total Cashflow Expenditure", currentValue: Number(cashflowAgg?.total_cashflow_expenditure ?? 0), sourceTable: "cashflow_points", sourceFields: "value (series_name LIKE '%expenditure%')", formula: "SUM(cashflow_points.value) WHERE series_name ILIKE '%expenditure%'", apiEndpoint: "/api/cashflow", consumingComponent: "CashflowTab, CashflowForecast" },
        { id: "project_total", name: "Total Projects", currentValue: Number(projCounts?.total_projects ?? 0), sourceTable: "project_info", sourceFields: "id", formula: "COUNT(project_info.*)", apiEndpoint: "/api/project-info", consumingComponent: "Dashboard, ProjectsSummary, LifecycleBoard" },
        { id: "project_active", name: "Active Projects", currentValue: Number(projCounts?.active_projects ?? 0), sourceTable: "project_info", sourceFields: "is_active", formula: "COUNT(project_info.*) WHERE is_active = true", apiEndpoint: "/api/project-info", consumingComponent: "Dashboard, ProjectsSummary" },
        { id: "project_execution", name: "Execution-Enabled Projects", currentValue: Number(projCounts?.execution_projects ?? 0), sourceTable: "project_info", sourceFields: "execution_enabled", formula: "COUNT(project_info.*) WHERE execution_enabled = true", apiEndpoint: "/api/project-info", consumingComponent: "ExecutionBoard, Dashboard" },
        { id: "project_avg_progress", name: "Average Project Progress %", currentValue: Math.round(Number(planProgress?.avg_actual_progress ?? 0) * 100) / 100, sourceTable: "project_plan", sourceFields: "actual_pct_complete", formula: "AVG(project_plan.actual_pct_complete) WHERE actual_pct_complete IS NOT NULL", apiEndpoint: "/api/project-plan/:project", consumingComponent: "ProjectPlanTab, Dashboard, ProjectDetailPage" },
        { id: "eng_tasks_total", name: "Engineering Tasks Total", currentValue: engTotal, sourceTable: "engineering_tasks", sourceFields: "id, status", formula: "COUNT(engineering_tasks.*)", apiEndpoint: "/api/engineering-tasks", consumingComponent: "EngineeringDashboard, EngineeringTasksPage" },
        { id: "eng_tasks_complete", name: "Engineering Tasks Complete", currentValue: engComplete, sourceTable: "engineering_tasks", sourceFields: "status", formula: "COUNT(engineering_tasks.*) WHERE status IN ('COMPLETE','Done')", apiEndpoint: "/api/engineering-tasks", consumingComponent: "EngineeringDashboard, EngineeringTasksPage" },
        { id: "eng_progress_pct", name: "Engineering Progress %", currentValue: engTotal > 0 ? Math.round((engComplete / engTotal) * 10000) / 100 : 0, sourceTable: "engineering_tasks", sourceFields: "status", formula: "(COUNT(status='COMPLETE') / COUNT(*)) × 100", apiEndpoint: "/api/engineering-tasks", consumingComponent: "EngineeringDashboard, Dashboard SummaryCard" },
        { id: "quality_total", name: "Quality Checks Total", currentValue: qcTotal, sourceTable: "qc_item_instance", sourceFields: "id, approved", formula: "COUNT(qc_item_instance.*)", apiEndpoint: "/api/quality/checklists", consumingComponent: "QmDashboard, QualityTab" },
        { id: "quality_pass_rate", name: "Quality Pass Rate %", currentValue: qcTotal > 0 ? Math.round((qcPassed / qcTotal) * 10000) / 100 : 0, sourceTable: "qc_item_instance", sourceFields: "approved", formula: "(COUNT(approved=true) / COUNT(*)) × 100", apiEndpoint: "/api/quality/checklists", consumingComponent: "QmDashboard, Dashboard SummaryCard" },
        { id: "mywork_operational_tasks", name: "Operational Tasks Count", currentValue: Number(opCount?.c ?? 0), sourceTable: "operational_tasks", sourceFields: "id", formula: "COUNT(operational_tasks.*)", apiEndpoint: "/api/operational-tasks", consumingComponent: "MyWorkTasksPage, MyToolTodayPage" },
        { id: "mywork_personal_tasks", name: "Personal Tasks Count", currentValue: Number(ptCount?.c ?? 0), sourceTable: "mytool_tasks", sourceFields: "id", formula: "COUNT(mytool_tasks.*)", apiEndpoint: "/api/mytool-tasks", consumingComponent: "MyWorkTasksPage, MyToolTodayPage" },
        { id: "mywork_work_items", name: "Work Items Count", currentValue: Number(wiCount?.c ?? 0), sourceTable: "work_items", sourceFields: "id", formula: "COUNT(work_items.*)", apiEndpoint: "/api/work-items", consumingComponent: "MyWorkTasksPage, MyWorkHomePage" },
        { id: "portfolio_total", name: "Portfolio Count", currentValue: Number(pCount?.c ?? 0), sourceTable: "portfolios", sourceFields: "id", formula: "COUNT(portfolios.*)", apiEndpoint: "/api/portfolios", consumingComponent: "PortfoliosPage, Dashboard" },
        { id: "inflow_total_value", name: "Total Milestone/Inflow Value", currentValue: Number(inflowAgg?.total_milestone_value ?? 0), sourceTable: "program_inflows", sourceFields: "milestone_amount", formula: "SUM(program_inflows.milestone_amount)", apiEndpoint: "/api/inflows/:project", consumingComponent: "RevenueTrackingTab, CashflowTab" },
        { id: "inflow_in_bank", name: "Milestones In Bank", currentValue: Number(inflowAgg?.in_bank_count ?? 0), sourceTable: "program_inflows", sourceFields: "in_bank", formula: "COUNT(program_inflows.*) WHERE in_bank = 1", apiEndpoint: "/api/inflows/:project", consumingComponent: "RevenueTrackingTab, Dashboard" },
      ];

      const enrichedKpis = kpis.map(withTraceability);

      const now = new Date().toISOString();
      for (const k of enrichedKpis) (k as any).lastComputed = now;

      res.json({ kpis: enrichedKpis, generatedAt: now, totalKpis: enrichedKpis.length });
    } catch (err: any) {
      console.error("[KPI Traceability] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}
