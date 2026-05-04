// Repository for the admin KPI Traceability page.
//
// Aggregates a fixed catalogue of KPIs from canonical and snapshot
// tables, applying the standard `effective_to IS NULL` guard on
// snapshot reads. All db.* calls live here per the route → repository
// discipline in CLAUDE.md — the route file (`server/kpi-traceability-routes.ts`)
// only consumes the typed result.

import { sql } from "drizzle-orm";
import { db } from "../db";
import { summarizeEngineeringStatuses, summarizeQualityStatuses } from "../services/kpi-service";

export interface KpiAggregateBundle {
  revenueSummary: {
    totalPlannedRevenue: number;
    totalActualRevenue: number;
    totalPlannedExpenditure: number;
    totalActualExpenditure: number;
    totalPlannedProfit: number;
    totalActualProfit: number;
  };
  cos: {
    totalBudgetCos: number;
    totalActualCos: number;
  };
  cashflow: {
    totalCashflowRevenue: number;
    totalCashflowExpenditure: number;
    projectCount: number;
  };
  projects: {
    total: number;
    active: number;
    execution: number;
  };
  planProgress: {
    avgActualProgress: number;
    avgExpectedProgress: number;
    totalPlanTasks: number;
  };
  engineering: { total: number; complete: number; inProgress: number; notStarted: number };
  quality: { total: number; approved: number; pending: number; failed: number };
  workItems: {
    operationalTaskCount: number;
    personalTaskCount: number;
    totalCount: number;
  };
  portfolios: { count: number };
  inflows: {
    totalMilestoneValue: number;
    inBankCount: number;
    totalMilestones: number;
  };
}

function rows0(r: any): any {
  return (Array.isArray(r) ? r : (r as any).rows || [])[0] || {};
}
const num = (v: unknown): number => (v == null || v === "" ? 0 : Number(v) || 0);

export async function getKpiAggregates(): Promise<KpiAggregateBundle> {
  const [
    revSummary,
    cosAgg,
    cashflowAgg,
    projCounts,
    planProgress,
    engAgg,
    qcAgg,
    opCount,
    ptCount,
    wiCount,
    pCount,
    inflowAgg,
  ] = await Promise.all([
    db.execute(sql`
      SELECT
        COALESCE(SUM(CAST(planned_revenue AS NUMERIC)), 0) as total_planned_revenue,
        COALESCE(SUM(CAST(actual_revenue AS NUMERIC)), 0) as total_actual_revenue,
        COALESCE(SUM(CAST(planned_expenditure AS NUMERIC)), 0) as total_planned_expenditure,
        COALESCE(SUM(CAST(actual_expenditure AS NUMERIC)), 0) as total_actual_expenditure,
        COALESCE(SUM(CAST(planned_profit AS NUMERIC)), 0) as total_planned_profit,
        COALESCE(SUM(CAST(actual_profit AS NUMERIC)), 0) as total_actual_profit
      FROM project_revenue_summary
      WHERE effective_to IS NULL
    `).then(rows0),
    db.execute(sql`
      SELECT
        COALESCE(SUM(CAST(budget_total AS NUMERIC)), 0) as total_budget_cos,
        COALESCE(SUM(CAST(amount_ex_vat AS NUMERIC)), 0) as total_actual_cos
      FROM normalized_cost_lines
      WHERE effective_to IS NULL
    `).then(rows0),
    db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN series_name ILIKE '%revenue%' THEN CAST(value AS NUMERIC) ELSE 0 END), 0) as total_cashflow_revenue,
        COALESCE(SUM(CASE WHEN series_name ILIKE '%expenditure%' OR series_name ILIKE '%expense%' THEN CAST(value AS NUMERIC) ELSE 0 END), 0) as total_cashflow_expenditure,
        COUNT(DISTINCT project_name) as project_count
      FROM cashflow_points
      WHERE effective_to IS NULL
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
    db
      .execute(sql`SELECT status FROM project_eng_stages`)
      .then((r: any) => summarizeEngineeringStatuses((r.rows || []) as Array<{ status: unknown }>))
      .catch(() => ({ total: 0, complete: 0, inProgress: 0, notStarted: 0 })),
    db
      .execute(sql`SELECT status FROM qc_item_instance`)
      .then((r: any) => summarizeQualityStatuses((r.rows || []) as Array<{ status: unknown }>))
      .catch(() => ({ total: 0, approved: 0, pending: 0, failed: 0 })),
    db
      .execute(sql`SELECT COUNT(*) as c FROM work_items WHERE deleted_at IS NULL AND legacy_table = 'operational_tasks'`)
      .then(rows0)
      .catch(() => ({ c: 0 })),
    db
      .execute(sql`SELECT COUNT(*) as c FROM work_items WHERE deleted_at IS NULL AND workstream = 'PERSONAL'`)
      .then(rows0)
      .catch(() => ({ c: 0 })),
    db
      .execute(sql`SELECT COUNT(*) as c FROM work_items WHERE deleted_at IS NULL`)
      .then(rows0)
      .catch(() => ({ c: 0 })),
    db
      .execute(sql`SELECT COUNT(*) as c FROM portfolios`)
      .then(rows0)
      .catch(() => ({ c: 0 })),
    db.execute(sql`
      SELECT
        COALESCE(SUM(CAST(amount_ex_vat AS NUMERIC)), 0) as total_milestone_value,
        COUNT(CASE WHEN paid_date IS NOT NULL AND paid_date_confirmed = true THEN 1 END) as in_bank_count,
        COUNT(*) as total_milestones
      FROM normalized_revenue_lines
      WHERE effective_to IS NULL
    `).then(rows0),
  ]);

  return {
    revenueSummary: {
      totalPlannedRevenue: num(revSummary.total_planned_revenue),
      totalActualRevenue: num(revSummary.total_actual_revenue),
      totalPlannedExpenditure: num(revSummary.total_planned_expenditure),
      totalActualExpenditure: num(revSummary.total_actual_expenditure),
      totalPlannedProfit: num(revSummary.total_planned_profit),
      totalActualProfit: num(revSummary.total_actual_profit),
    },
    cos: {
      totalBudgetCos: num(cosAgg.total_budget_cos),
      totalActualCos: num(cosAgg.total_actual_cos),
    },
    cashflow: {
      totalCashflowRevenue: num(cashflowAgg.total_cashflow_revenue),
      totalCashflowExpenditure: num(cashflowAgg.total_cashflow_expenditure),
      projectCount: num(cashflowAgg.project_count),
    },
    projects: {
      total: num(projCounts.total_projects),
      active: num(projCounts.active_projects),
      execution: num(projCounts.execution_projects),
    },
    planProgress: {
      avgActualProgress: num(planProgress.avg_actual_progress),
      avgExpectedProgress: num(planProgress.avg_expected_progress),
      totalPlanTasks: num(planProgress.total_plan_tasks),
    },
    engineering: {
      total: num((engAgg as any).total),
      complete: num((engAgg as any).complete),
      inProgress: num((engAgg as any).inProgress),
      notStarted: num((engAgg as any).notStarted),
    },
    quality: {
      total: num((qcAgg as any).total),
      approved: num((qcAgg as any).approved),
      pending: num((qcAgg as any).pending),
      failed: num((qcAgg as any).failed),
    },
    workItems: {
      operationalTaskCount: num((opCount as any).c),
      personalTaskCount: num((ptCount as any).c),
      totalCount: num((wiCount as any).c),
    },
    portfolios: { count: num((pCount as any).c) },
    inflows: {
      totalMilestoneValue: num(inflowAgg.total_milestone_value),
      inBankCount: num(inflowAgg.in_bank_count),
      totalMilestones: num(inflowAgg.total_milestones),
    },
  };
}
