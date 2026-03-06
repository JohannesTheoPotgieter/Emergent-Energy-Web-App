import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { projectInfo, programExpense, programInflows, projectPlan, projectRevenueSummary, operationalTasks, engineeringTasks, qcItemInstance, workItems, mytoolTasks, cashflowPoints } from "@shared/schema";
import { eq, sql, and, count } from "drizzle-orm";
import { verifyToken } from "./jwt";

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

export function registerKpiTraceabilityRoutes(app: Express) {
  app.get("/api/admin/kpi-traceability", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const kpis: any[] = [];

      const revResult = await db.execute(sql`
        SELECT 
          COALESCE(SUM(CAST(planned_revenue AS NUMERIC)), 0) as total_planned_revenue,
          COALESCE(SUM(CAST(actual_revenue AS NUMERIC)), 0) as total_actual_revenue,
          COALESCE(SUM(CAST(planned_expenditure AS NUMERIC)), 0) as total_planned_expenditure,
          COALESCE(SUM(CAST(actual_expenditure AS NUMERIC)), 0) as total_actual_expenditure,
          COALESCE(SUM(CAST(planned_profit AS NUMERIC)), 0) as total_planned_profit,
          COALESCE(SUM(CAST(actual_profit AS NUMERIC)), 0) as total_actual_profit
        FROM project_revenue_summary
      `);
      const revSummary = (Array.isArray(revResult) ? revResult : (revResult as any).rows || [])[0] || {};

      kpis.push({
        id: "revenue_planned",
        name: "Total Planned Revenue",
        currentValue: Number(revSummary?.total_planned_revenue ?? 0),
        sourceTable: "project_revenue_summary",
        sourceFields: "planned_revenue",
        formula: "SUM(project_revenue_summary.planned_revenue)",
        apiEndpoint: "/api/revenue-summary",
        consumingComponent: "Dashboard SummaryCard, RevenueTrackerTab",
        lastComputed: new Date().toISOString(),
      });

      kpis.push({
        id: "revenue_actual",
        name: "Total Actual Revenue",
        currentValue: Number(revSummary?.total_actual_revenue ?? 0),
        sourceTable: "project_revenue_summary",
        sourceFields: "actual_revenue",
        formula: "SUM(project_revenue_summary.actual_revenue)",
        apiEndpoint: "/api/revenue-summary",
        consumingComponent: "Dashboard SummaryCard, RevenueTrackerTab",
        lastComputed: new Date().toISOString(),
      });

      const cosResult = await db.execute(sql`
        SELECT 
          COALESCE(SUM(CAST(budget_total AS NUMERIC)), 0) as total_budget_cos,
          COALESCE(SUM(CAST(actual_cos_total AS NUMERIC)), 0) as total_actual_cos
        FROM program_expense
        WHERE row_type = 'item' OR row_type IS NULL
      `);
      const cosAgg = (Array.isArray(cosResult) ? cosResult : (cosResult as any).rows || [])[0] || {};

      kpis.push({
        id: "cos_budget",
        name: "Total Budget COS",
        currentValue: Number(cosAgg?.total_budget_cos ?? 0),
        sourceTable: "program_expense",
        sourceFields: "budget_total",
        formula: "SUM(program_expense.budget_total) WHERE row_type='item'",
        apiEndpoint: "/api/expenses",
        consumingComponent: "COS Control, ExpenditureTab, Dashboard SummaryCard",
        lastComputed: new Date().toISOString(),
      });

      kpis.push({
        id: "cos_actual",
        name: "Total Actual COS",
        currentValue: Number(cosAgg?.total_actual_cos ?? 0),
        sourceTable: "program_expense",
        sourceFields: "actual_cos_total",
        formula: "SUM(program_expense.actual_cos_total) WHERE row_type='item'",
        apiEndpoint: "/api/expenses",
        consumingComponent: "COS Control, ExpenditureTab, Dashboard SummaryCard",
        lastComputed: new Date().toISOString(),
      });

      const gpPlanned = Number(revSummary?.total_planned_profit ?? 0);
      const gpActual = Number(revSummary?.total_actual_profit ?? 0);
      const plannedRev = Number(revSummary?.total_planned_revenue ?? 0);
      const actualRev = Number(revSummary?.total_actual_revenue ?? 0);

      kpis.push({
        id: "gp_planned",
        name: "Total Planned GP",
        currentValue: gpPlanned,
        sourceTable: "project_revenue_summary",
        sourceFields: "planned_profit",
        formula: "SUM(project_revenue_summary.planned_profit)",
        apiEndpoint: "/api/revenue-summary",
        consumingComponent: "GpTrackerTab, Dashboard SummaryCard",
        lastComputed: new Date().toISOString(),
      });

      kpis.push({
        id: "gp_actual",
        name: "Total Actual GP",
        currentValue: gpActual,
        sourceTable: "project_revenue_summary",
        sourceFields: "actual_profit",
        formula: "SUM(project_revenue_summary.actual_profit)",
        apiEndpoint: "/api/revenue-summary",
        consumingComponent: "GpTrackerTab, Dashboard SummaryCard",
        lastComputed: new Date().toISOString(),
      });

      kpis.push({
        id: "gp_margin_planned",
        name: "Planned GP Margin %",
        currentValue: plannedRev > 0 ? Math.round((gpPlanned / plannedRev) * 10000) / 100 : 0,
        sourceTable: "project_revenue_summary",
        sourceFields: "planned_profit, planned_revenue",
        formula: "(SUM(planned_profit) / SUM(planned_revenue)) × 100",
        apiEndpoint: "/api/revenue-summary",
        consumingComponent: "GpTrackerTab, Dashboard SummaryCard",
        lastComputed: new Date().toISOString(),
      });

      kpis.push({
        id: "gp_margin_actual",
        name: "Actual GP Margin %",
        currentValue: actualRev > 0 ? Math.round((gpActual / actualRev) * 10000) / 100 : 0,
        sourceTable: "project_revenue_summary",
        sourceFields: "actual_profit, actual_revenue",
        formula: "(SUM(actual_profit) / SUM(actual_revenue)) × 100",
        apiEndpoint: "/api/revenue-summary",
        consumingComponent: "GpTrackerTab, Dashboard SummaryCard",
        lastComputed: new Date().toISOString(),
      });

      const cfResult = await db.execute(sql`
        SELECT 
          COALESCE(SUM(CASE WHEN series_name ILIKE '%revenue%' THEN CAST(value AS NUMERIC) ELSE 0 END), 0) as total_cashflow_revenue,
          COALESCE(SUM(CASE WHEN series_name ILIKE '%expenditure%' OR series_name ILIKE '%expense%' THEN CAST(value AS NUMERIC) ELSE 0 END), 0) as total_cashflow_expenditure,
          COUNT(DISTINCT project_name) as project_count
        FROM cashflow_points
      `);
      const cashflowAgg = (Array.isArray(cfResult) ? cfResult : (cfResult as any).rows || [])[0] || {};

      kpis.push({
        id: "cashflow_revenue",
        name: "Total Cashflow Revenue",
        currentValue: Number(cashflowAgg?.total_cashflow_revenue ?? 0),
        sourceTable: "cashflow_points",
        sourceFields: "value (series_name LIKE '%revenue%')",
        formula: "SUM(cashflow_points.value) WHERE series_name ILIKE '%revenue%'",
        apiEndpoint: "/api/cashflow",
        consumingComponent: "CashflowTab, CashflowForecast",
        lastComputed: new Date().toISOString(),
      });

      kpis.push({
        id: "cashflow_expenditure",
        name: "Total Cashflow Expenditure",
        currentValue: Number(cashflowAgg?.total_cashflow_expenditure ?? 0),
        sourceTable: "cashflow_points",
        sourceFields: "value (series_name LIKE '%expenditure%')",
        formula: "SUM(cashflow_points.value) WHERE series_name ILIKE '%expenditure%'",
        apiEndpoint: "/api/cashflow",
        consumingComponent: "CashflowTab, CashflowForecast",
        lastComputed: new Date().toISOString(),
      });

      const projResult = await db.execute(sql`
        SELECT 
          COUNT(*) as total_projects,
          COUNT(CASE WHEN is_active = true THEN 1 END) as active_projects,
          COUNT(CASE WHEN execution_enabled = true THEN 1 END) as execution_projects
        FROM project_info
      `);
      const projCounts = (Array.isArray(projResult) ? projResult : (projResult as any).rows || [])[0] || {};

      kpis.push({
        id: "project_total",
        name: "Total Projects",
        currentValue: Number(projCounts?.total_projects ?? 0),
        sourceTable: "project_info",
        sourceFields: "id",
        formula: "COUNT(project_info.*)",
        apiEndpoint: "/api/project-info",
        consumingComponent: "Dashboard, ProjectsSummary, LifecycleBoard",
        lastComputed: new Date().toISOString(),
      });

      kpis.push({
        id: "project_active",
        name: "Active Projects",
        currentValue: Number(projCounts?.active_projects ?? 0),
        sourceTable: "project_info",
        sourceFields: "is_active",
        formula: "COUNT(project_info.*) WHERE is_active = true",
        apiEndpoint: "/api/project-info",
        consumingComponent: "Dashboard, ProjectsSummary",
        lastComputed: new Date().toISOString(),
      });

      kpis.push({
        id: "project_execution",
        name: "Execution-Enabled Projects",
        currentValue: Number(projCounts?.execution_projects ?? 0),
        sourceTable: "project_info",
        sourceFields: "execution_enabled",
        formula: "COUNT(project_info.*) WHERE execution_enabled = true",
        apiEndpoint: "/api/project-info",
        consumingComponent: "ExecutionBoard, Dashboard",
        lastComputed: new Date().toISOString(),
      });

      const planResult = await db.execute(sql`
        SELECT 
          COALESCE(AVG(actual_pct_complete), 0) as avg_actual_progress,
          COALESCE(AVG(expected_pct_complete), 0) as avg_expected_progress,
          COUNT(*) as total_plan_tasks
        FROM project_plan
        WHERE actual_pct_complete IS NOT NULL
      `);
      const planProgress = (Array.isArray(planResult) ? planResult : (planResult as any).rows || [])[0] || {};

      kpis.push({
        id: "project_avg_progress",
        name: "Average Project Progress %",
        currentValue: Math.round(Number(planProgress?.avg_actual_progress ?? 0) * 100) / 100,
        sourceTable: "project_plan",
        sourceFields: "actual_pct_complete",
        formula: "AVG(project_plan.actual_pct_complete) WHERE actual_pct_complete IS NOT NULL",
        apiEndpoint: "/api/project-plan/:project",
        consumingComponent: "ProjectPlanTab, Dashboard, ProjectDetailPage",
        lastComputed: new Date().toISOString(),
      });

      let engTaskCounts = { total: 0, complete: 0, in_progress: 0 };
      try {
        const engResult = await db.execute(sql`
          SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN status IN ('COMPLETE', 'Complete', 'Done', 'done') THEN 1 END) as complete,
            COUNT(CASE WHEN status IN ('IN_PROGRESS', 'In Progress', 'in_progress') THEN 1 END) as in_progress
          FROM engineering_tasks
        `);
        const engAgg = (Array.isArray(engResult) ? engResult : (engResult as any).rows || [])[0] || {};
        engTaskCounts = {
          total: Number(engAgg?.total ?? 0),
          complete: Number(engAgg?.complete ?? 0),
          in_progress: Number(engAgg?.in_progress ?? 0),
        };
      } catch { }

      kpis.push({
        id: "eng_tasks_total",
        name: "Engineering Tasks Total",
        currentValue: engTaskCounts.total,
        sourceTable: "engineering_tasks",
        sourceFields: "id, status",
        formula: "COUNT(engineering_tasks.*)",
        apiEndpoint: "/api/engineering-tasks",
        consumingComponent: "EngineeringDashboard, EngineeringTasksPage",
        lastComputed: new Date().toISOString(),
      });

      kpis.push({
        id: "eng_tasks_complete",
        name: "Engineering Tasks Complete",
        currentValue: engTaskCounts.complete,
        sourceTable: "engineering_tasks",
        sourceFields: "status",
        formula: "COUNT(engineering_tasks.*) WHERE status IN ('COMPLETE','Done')",
        apiEndpoint: "/api/engineering-tasks",
        consumingComponent: "EngineeringDashboard, EngineeringTasksPage",
        lastComputed: new Date().toISOString(),
      });

      kpis.push({
        id: "eng_progress_pct",
        name: "Engineering Progress %",
        currentValue: engTaskCounts.total > 0 ? Math.round((engTaskCounts.complete / engTaskCounts.total) * 10000) / 100 : 0,
        sourceTable: "engineering_tasks",
        sourceFields: "status",
        formula: "(COUNT(status='COMPLETE') / COUNT(*)) × 100",
        apiEndpoint: "/api/engineering-tasks",
        consumingComponent: "EngineeringDashboard, Dashboard SummaryCard",
        lastComputed: new Date().toISOString(),
      });

      let qualityCounts = { total: 0, passed: 0, failed: 0 };
      try {
        const qcResult = await db.execute(sql`
          SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN result = 'PASS' THEN 1 END) as passed,
            COUNT(CASE WHEN result = 'FAIL' THEN 1 END) as failed
          FROM qc_item_instance
        `);
        const qcAgg = (Array.isArray(qcResult) ? qcResult : (qcResult as any).rows || [])[0] || {};
        qualityCounts = {
          total: Number(qcAgg?.total ?? 0),
          passed: Number(qcAgg?.passed ?? 0),
          failed: Number(qcAgg?.failed ?? 0),
        };
      } catch { }

      kpis.push({
        id: "quality_total",
        name: "Quality Checks Total",
        currentValue: qualityCounts.total,
        sourceTable: "qc_item_instance",
        sourceFields: "id, result",
        formula: "COUNT(qc_item_instance.*)",
        apiEndpoint: "/api/quality/checklists",
        consumingComponent: "QmDashboard, QualityTab",
        lastComputed: new Date().toISOString(),
      });

      kpis.push({
        id: "quality_pass_rate",
        name: "Quality Pass Rate %",
        currentValue: qualityCounts.total > 0 ? Math.round((qualityCounts.passed / qualityCounts.total) * 10000) / 100 : 0,
        sourceTable: "qc_item_instance",
        sourceFields: "result",
        formula: "(COUNT(result='PASS') / COUNT(*)) × 100",
        apiEndpoint: "/api/quality/checklists",
        consumingComponent: "QmDashboard, Dashboard SummaryCard",
        lastComputed: new Date().toISOString(),
      });

      let myWorkCounts = { operational: 0, personal: 0, work_items: 0 };
      try {
        const opResult = await db.execute(sql`SELECT COUNT(*) as c FROM operational_tasks`);
        const opCount = (Array.isArray(opResult) ? opResult : (opResult as any).rows || [])[0] || {};
        myWorkCounts.operational = Number(opCount?.c ?? 0);
      } catch { }
      try {
        const ptResult = await db.execute(sql`SELECT COUNT(*) as c FROM mytool_tasks`);
        const ptCount = (Array.isArray(ptResult) ? ptResult : (ptResult as any).rows || [])[0] || {};
        myWorkCounts.personal = Number(ptCount?.c ?? 0);
      } catch { }
      try {
        const wiResult = await db.execute(sql`SELECT COUNT(*) as c FROM work_items`);
        const wiCount = (Array.isArray(wiResult) ? wiResult : (wiResult as any).rows || [])[0] || {};
        myWorkCounts.work_items = Number(wiCount?.c ?? 0);
      } catch { }

      kpis.push({
        id: "mywork_operational_tasks",
        name: "Operational Tasks Count",
        currentValue: myWorkCounts.operational,
        sourceTable: "operational_tasks",
        sourceFields: "id",
        formula: "COUNT(operational_tasks.*)",
        apiEndpoint: "/api/operational-tasks",
        consumingComponent: "MyWorkTasksPage, MyToolTodayPage",
        lastComputed: new Date().toISOString(),
      });

      kpis.push({
        id: "mywork_personal_tasks",
        name: "Personal Tasks Count",
        currentValue: myWorkCounts.personal,
        sourceTable: "mytool_tasks",
        sourceFields: "id",
        formula: "COUNT(mytool_tasks.*)",
        apiEndpoint: "/api/mytool-tasks",
        consumingComponent: "MyWorkTasksPage, MyToolTodayPage",
        lastComputed: new Date().toISOString(),
      });

      kpis.push({
        id: "mywork_work_items",
        name: "Work Items Count",
        currentValue: myWorkCounts.work_items,
        sourceTable: "work_items",
        sourceFields: "id",
        formula: "COUNT(work_items.*)",
        apiEndpoint: "/api/work-items",
        consumingComponent: "MyWorkTasksPage, MyWorkHomePage",
        lastComputed: new Date().toISOString(),
      });

      let portfolioCount = 0;
      try {
        const pResult = await db.execute(sql`SELECT COUNT(*) as c FROM portfolios`);
        const pCount = (Array.isArray(pResult) ? pResult : (pResult as any).rows || [])[0] || {};
        portfolioCount = Number(pCount?.c ?? 0);
      } catch { }

      kpis.push({
        id: "portfolio_total",
        name: "Portfolio Count",
        currentValue: portfolioCount,
        sourceTable: "portfolios",
        sourceFields: "id",
        formula: "COUNT(portfolios.*)",
        apiEndpoint: "/api/portfolios",
        consumingComponent: "PortfoliosPage, Dashboard",
        lastComputed: new Date().toISOString(),
      });

      const inflowResult = await db.execute(sql`
        SELECT 
          COALESCE(SUM(CAST(milestone_amount AS NUMERIC)), 0) as total_milestone_value,
          COUNT(CASE WHEN in_bank = 1 THEN 1 END) as in_bank_count,
          COUNT(*) as total_milestones
        FROM program_inflows
      `);
      const inflowAgg = (Array.isArray(inflowResult) ? inflowResult : (inflowResult as any).rows || [])[0] || {};

      kpis.push({
        id: "inflow_total_value",
        name: "Total Milestone/Inflow Value",
        currentValue: Number(inflowAgg?.total_milestone_value ?? 0),
        sourceTable: "program_inflows",
        sourceFields: "milestone_amount",
        formula: "SUM(program_inflows.milestone_amount)",
        apiEndpoint: "/api/inflows/:project",
        consumingComponent: "RevenueTrackingTab, CashflowTab",
        lastComputed: new Date().toISOString(),
      });

      kpis.push({
        id: "inflow_in_bank",
        name: "Milestones In Bank",
        currentValue: Number(inflowAgg?.in_bank_count ?? 0),
        sourceTable: "program_inflows",
        sourceFields: "in_bank",
        formula: "COUNT(program_inflows.*) WHERE in_bank = 1",
        apiEndpoint: "/api/inflows/:project",
        consumingComponent: "RevenueTrackingTab, Dashboard",
        lastComputed: new Date().toISOString(),
      });

      res.json({
        kpis,
        generatedAt: new Date().toISOString(),
        totalKpis: kpis.length,
      });
    } catch (err: any) {
      console.error("[KPI Traceability] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}
