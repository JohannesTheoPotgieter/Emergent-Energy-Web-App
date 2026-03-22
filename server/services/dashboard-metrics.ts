/**
 * Prompt 12 — Dashboard Metrics Materialized Refresh Service
 *
 * Recalculates project-level and program-level dashboard metrics
 * from canonical source tables and writes to the materialized
 * dashboard_project_metrics / dashboard_program_metrics tables.
 */

import { eq, sql, inArray, isNull, and, gte } from "drizzle-orm";
import { db, getDbMode } from "../db";
import {
  projectInfo,
  dashboardProjectMetrics,
  dashboardProgramMetrics,
  normalizedRevenueLines,
  normalizedCostLines,
} from "@shared/schema";
import { workItems } from "@shared/schema";
import { qcWarning, qcChecklist, qcItemInstance } from "@shared/schema";

const REFRESH_COOLDOWN_MS = 5 * 60 * 1000; // Skip projects refreshed within 5 minutes
const CONCURRENCY_LIMIT = 5; // Max parallel project refreshes

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ─── Project-level refresh ─────────────────────────────────────────

export async function refreshProjectMetrics(projectId: number): Promise<void> {
  const [project] = await db
    .select()
    .from(projectInfo)
    .where(eq(projectInfo.id, projectId))
    .limit(1);

  if (!project) return;

  // Finance aggregates from canonical lines (effectiveTo IS NULL = current rows)
  const [revRows, costRows] = await Promise.all([
    db
      .select()
      .from(normalizedRevenueLines)
      .where(
        and(
          eq(normalizedRevenueLines.projectId, projectId),
          isNull(normalizedRevenueLines.effectiveTo),
        ),
      ),
    db
      .select()
      .from(normalizedCostLines)
      .where(
        and(
          eq(normalizedCostLines.projectId, projectId),
          isNull(normalizedCostLines.effectiveTo),
        ),
      ),
  ]);

  let totalRevenue = 0,
    receivedRevenue = 0,
    outstandingRevenue = 0;
  for (const row of revRows) {
    const amt = toNum(row.amountExVat);
    totalRevenue += amt;
    if (row.paidDate || row.inBankDate) {
      receivedRevenue += amt;
    } else {
      outstandingRevenue += amt;
    }
  }

  let totalCost = 0,
    paidCost = 0,
    outstandingCost = 0;
  for (const row of costRows) {
    const amt = toNum(row.amountExVat);
    totalCost += amt;
    if (row.paidDate) {
      paidCost += amt;
    } else {
      outstandingCost += amt;
    }
  }

  const marginPct =
    totalRevenue > 0
      ? ((totalRevenue - totalCost) / totalRevenue).toFixed(4)
      : null;

  // Task aggregates from work_items
  const taskRows = await db
    .select()
    .from(workItems)
    .where(and(eq(workItems.projectId, projectId), isNull(workItems.deletedAt)));

  const today = new Date().toISOString().slice(0, 10);
  let taskCount = 0,
    tasksCompleted = 0,
    tasksInProgress = 0,
    tasksOverdue = 0,
    tasksActive = 0;

  for (const t of taskRows) {
    taskCount++;
    const status = String(t.status ?? "")
      .trim()
      .toUpperCase();
    if (["COMPLETE", "COMPLETED", "DONE"].includes(status)) tasksCompleted++;
    if (status === "IN PROGRESS") tasksInProgress++;
    if (
      !["COMPLETE", "COMPLETED", "DONE", "CANCELLED", "CANCELED"].includes(
        status,
      )
    )
      tasksActive++;
    if (
      t.endDate &&
      t.endDate < today &&
      !["COMPLETE", "COMPLETED", "DONE", "QC APPROVED"].includes(status)
    )
      tasksOverdue++;
  }

  // QC aggregates
  const [warningRows, checklistRows] = await Promise.all([
    db
      .select()
      .from(qcWarning)
      .where(
        and(
          eq(qcWarning.projectId, projectId),
          eq(qcWarning.status, "open"),
        ),
      ),
    db.select().from(qcChecklist).where(eq(qcChecklist.projectId, projectId)),
  ]);

  const openWarnings = warningRows.length;

  let qcProgressPct: string | null = null;
  if (checklistRows.length > 0) {
    const checklistIds = checklistRows.map((c) => c.id);
    const instanceRows = await db
      .select()
      .from(qcItemInstance)
      .where(inArray(qcItemInstance.checklistId, checklistIds));

    const totalItems = instanceRows.filter((i) => i.isApplicable).length;
    const approvedItems = instanceRows.filter(
      (i) => i.isApplicable && i.approved,
    ).length;
    qcProgressPct =
      totalItems > 0 ? (approvedItems / totalItems).toFixed(4) : null;
  }

  // Health score: simple composite (margin 40%, task completion 30%, QC 30%)
  const taskCompletionRate = taskCount > 0 ? tasksCompleted / taskCount : 0;
  const qcRate = qcProgressPct ? parseFloat(qcProgressPct) : 0;
  const marginRate = marginPct ? Math.max(0, Math.min(1, parseFloat(marginPct))) : 0;
  const healthScore = (marginRate * 40 + taskCompletionRate * 30 + qcRate * 30).toFixed(2);

  // Execution-state snapshot
  const phase = project.phase ?? null;
  const ragStatus = project.ragStatus ?? null;

  const row = {
    projectId,
    totalRevenue: totalRevenue.toFixed(2),
    receivedRevenue: receivedRevenue.toFixed(2),
    outstandingRevenue: outstandingRevenue.toFixed(2),
    totalCost: totalCost.toFixed(2),
    paidCost: paidCost.toFixed(2),
    outstandingCost: outstandingCost.toFixed(2),
    marginPct,
    taskCount,
    tasksCompleted,
    tasksInProgress,
    tasksOverdue,
    tasksActive,
    openWarnings,
    qcProgressPct,
    healthScore,
    phase,
    ragStatus,
    contractValue: project.contractValue ?? null,
    projectName: project.projectName,
    pm: project.pm ?? null,
    pd: project.pd ?? null,
    lastRefreshedAt: new Date(),
  };

  // Upsert
  if (getDbMode() === "sqlite") {
    const existing = await db
      .select()
      .from(dashboardProjectMetrics)
      .where(eq(dashboardProjectMetrics.projectId, projectId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(dashboardProjectMetrics)
        .set(row)
        .where(eq(dashboardProjectMetrics.projectId, projectId));
    } else {
      await db.insert(dashboardProjectMetrics).values(row);
    }
  } else {
    await db.execute(sql`
      INSERT INTO dashboard_project_metrics (
        project_id,
        total_revenue, received_revenue, outstanding_revenue,
        total_cost, paid_cost, outstanding_cost, margin_pct,
        task_count, tasks_completed, tasks_in_progress, tasks_overdue, tasks_active,
        open_warnings, qc_progress_pct,
        health_score, phase, rag_status, contract_value, project_name, pm, pd,
        last_refreshed_at
      ) VALUES (
        ${row.projectId},
        ${row.totalRevenue}, ${row.receivedRevenue}, ${row.outstandingRevenue},
        ${row.totalCost}, ${row.paidCost}, ${row.outstandingCost}, ${row.marginPct},
        ${row.taskCount}, ${row.tasksCompleted}, ${row.tasksInProgress}, ${row.tasksOverdue}, ${row.tasksActive},
        ${row.openWarnings}, ${row.qcProgressPct},
        ${row.healthScore}, ${row.phase}, ${row.ragStatus}, ${row.contractValue}, ${row.projectName}, ${row.pm}, ${row.pd},
        NOW()
      )
      ON CONFLICT (project_id)
      DO UPDATE SET
        total_revenue = EXCLUDED.total_revenue,
        received_revenue = EXCLUDED.received_revenue,
        outstanding_revenue = EXCLUDED.outstanding_revenue,
        total_cost = EXCLUDED.total_cost,
        paid_cost = EXCLUDED.paid_cost,
        outstanding_cost = EXCLUDED.outstanding_cost,
        margin_pct = EXCLUDED.margin_pct,
        task_count = EXCLUDED.task_count,
        tasks_completed = EXCLUDED.tasks_completed,
        tasks_in_progress = EXCLUDED.tasks_in_progress,
        tasks_overdue = EXCLUDED.tasks_overdue,
        tasks_active = EXCLUDED.tasks_active,
        open_warnings = EXCLUDED.open_warnings,
        qc_progress_pct = EXCLUDED.qc_progress_pct,
        health_score = EXCLUDED.health_score,
        phase = EXCLUDED.phase,
        rag_status = EXCLUDED.rag_status,
        contract_value = EXCLUDED.contract_value,
        project_name = EXCLUDED.project_name,
        pm = EXCLUDED.pm,
        pd = EXCLUDED.pd,
        last_refreshed_at = EXCLUDED.last_refreshed_at
    `);
  }
}

// ─── Refresh all projects ──────────────────────────────────────────

export async function refreshAllMetrics(): Promise<{ refreshed: number; failed: number; failedProjectIds: number[] }> {
  const projects = await db.select({ id: projectInfo.id }).from(projectInfo);

  // Skip projects that were refreshed recently
  const cutoff = new Date(Date.now() - REFRESH_COOLDOWN_MS);
  const recentlyRefreshed = new Set<number>();
  try {
    const recentRows = await db
      .select({ projectId: dashboardProjectMetrics.projectId })
      .from(dashboardProjectMetrics)
      .where(gte(dashboardProjectMetrics.lastRefreshedAt, cutoff));
    for (const r of recentRows) recentlyRefreshed.add(r.projectId);
  } catch {
    // Table may not exist yet; refresh all
  }

  const toRefresh = projects.filter((p) => !recentlyRefreshed.has(p.id));
  let refreshed = 0;

  // Process with concurrency limit instead of sequentially
  for (let i = 0; i < toRefresh.length; i += CONCURRENCY_LIMIT) {
    const batch = toRefresh.slice(i, i + CONCURRENCY_LIMIT);
    const results = await Promise.allSettled(
      batch.map((p) => refreshProjectMetrics(p.id)),
    );
    for (const result of results) {
      if (result.status === "fulfilled") refreshed++;
      else console.warn(`[dashboard-metrics] Failed to refresh project:`, result.reason?.message);
    }
  }

  await refreshProgramMetrics();
  return { refreshed, failed, failedProjectIds };
}

// ─── Program-level refresh ─────────────────────────────────────────

export async function refreshProgramMetrics(): Promise<void> {
  const projectRows = await db
    .select()
    .from(dashboardProjectMetrics);

  let totalProjects = projectRows.length;
  let activeProjects = 0;
  let totalProgramRevenue = 0;
  let totalProgramCost = 0;
  let receivedRevenue = 0;
  let paidCost = 0;
  let projectsAtRisk = 0;
  let totalTasksOverdue = 0;
  let totalOpenWarnings = 0;
  let marginSum = 0;
  let marginCount = 0;

  for (const p of projectRows) {
    const phase = (p.phase ?? "").toUpperCase();
    if (phase !== "COMPLETED" && phase !== "ARCHIVED") activeProjects++;

    totalProgramRevenue += toNum(p.totalRevenue);
    totalProgramCost += toNum(p.totalCost);
    receivedRevenue += toNum(p.receivedRevenue);
    paidCost += toNum(p.paidCost);
    totalTasksOverdue += p.tasksOverdue;
    totalOpenWarnings += p.openWarnings;

    if (p.marginPct !== null) {
      marginSum += toNum(p.marginPct);
      marginCount++;
    }

    const rag = (p.ragStatus ?? "").toUpperCase();
    if (rag === "RED" || rag === "AT RISK") projectsAtRisk++;
  }

  const avgMargin = marginCount > 0 ? (marginSum / marginCount).toFixed(4) : null;

  const row = {
    totalProjects,
    activeProjects,
    totalProgramRevenue: totalProgramRevenue.toFixed(2),
    totalProgramCost: totalProgramCost.toFixed(2),
    receivedRevenue: receivedRevenue.toFixed(2),
    paidCost: paidCost.toFixed(2),
    avgMargin,
    projectsAtRisk,
    totalTasksOverdue,
    totalOpenWarnings,
    lastRefreshedAt: new Date(),
  };

  if (getDbMode() === "sqlite") {
    const existing = await db
      .select()
      .from(dashboardProgramMetrics)
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(dashboardProgramMetrics)
        .set(row);
    } else {
      await db.insert(dashboardProgramMetrics).values(row);
    }
  } else {
    // Simple delete+insert since there's only one row
    await db.delete(dashboardProgramMetrics);
    await db.insert(dashboardProgramMetrics).values(row);
  }
}

// ─── Fire-and-forget wrapper (non-blocking) ────────────────────────

export function refreshProjectMetricsAsync(projectId: number): void {
  refreshProjectMetrics(projectId).catch((err) =>
    console.warn(
      `[dashboard-metrics] Async refresh failed for project ${projectId}:`,
      err.message,
    ),
  );
}

export function refreshProgramMetricsAsync(): void {
  refreshProgramMetrics().catch((err) =>
    console.warn(
      `[dashboard-metrics] Async program refresh failed:`,
      err.message,
    ),
  );
}
