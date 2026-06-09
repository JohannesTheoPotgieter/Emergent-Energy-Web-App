/**
 * Derived Project KPIs materializer.
 *
 * TF-4 (audit V3, owner-confirmed 2026-05-26): build an in-app writer for
 * `derived_project_kpis`. Before this materializer existed, exhaustive
 * grep across server/, scripts/, migrations/, bootstrap/, bridge/,
 * .replit, replit.nix found ZERO writers anywhere in the repo. The table
 * was read by:
 *
 *   - server/services/project-platform-summary-service.ts
 *   - server/services/project-header-kpi-service.ts
 *   - server/lib/priorities/progress-source.ts
 *   - migrations/0003_priority_derived_metrics_view.sql (the priority
 *     KPI view joins through derived_project_kpis)
 *
 * The audit elevated this to CRITICAL: the priority dashboard, project
 * header chips, and strategic chain view were all reading stale-or-zero
 * data. This module is the writer. It is the canonical source of the
 * cache; any other writer is an error.
 *
 * Design choices:
 *
 *   1. The materializer reads from the canonical sources (normalized_*,
 *      work_items, project_info) and computes the same figures the live
 *      finance KPI service computes. No formula divergence — if the
 *      live figure says "Revenue R 5M (POC)", the cache says exactly
 *      the same R 5M.
 *
 *   2. It re-uses `getCanonicalFinanceByProjectIds` for the per-line POC
 *      revenue + COS realised pair so the F-1 / F-1 Phase 2 fix flows
 *      through automatically. Once this PR lands, the priority surface
 *      starts seeing the same recognised-revenue figure the project
 *      lifecycle page shows.
 *
 *   3. Single-project and portfolio entry points. The single-project
 *      version is for event-driven refresh (finance write, project
 *      lifecycle transition). The portfolio version is for the scheduled
 *      rebuild (every 15 minutes via bootstrap/derived-project-kpis-
 *      scheduler.ts).
 *
 *   4. UPSERT semantics via `ON CONFLICT (project_key) DO UPDATE`. The
 *      `project_key` field is the unique constraint — every project has
 *      exactly one row.
 *
 *   5. Closed / hold / internal / tbc projects are still rematerialized
 *      so their cache stays correct if the user opens the project
 *      detail. The aggregate consumers (priority dashboard) apply their
 *      own status filter via filterActiveProjectIds (see V2 DF-1).
 *
 * Anti-design choices (deliberately NOT done here):
 *
 *   - No partial / incremental update. A finance write recomputes the
 *     whole project row. The alternative — patch the delta — would have
 *     to encode every cross-formula dependency (changing a cost actual
 *     touches recognisedRevenue too via the POC formula). Recompute is
 *     simpler and the project is bounded in rows.
 *
 *   - No materialization of the priority_derived_metrics view. That view
 *     reads from derived_project_kpis directly (per migration 0003), so
 *     once this writer runs, the view returns fresh data.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { errMsg } from "../lib/api-error";
import {
  derivedProjectKpis,
  normalizedCostLines,
  normalizedRevenueLines,
  projectInfo,
  workItems,
} from "@shared/schema";
import { getCanonicalFinanceByProjectIds } from "./canonical-dashboard-kpi-service";

/**
 * Recompute derived_project_kpis for a single project. Used by the
 * event-driven refresh path (after a finance write / project lifecycle
 * change). Idempotent; safe to call multiple times.
 *
 * @param projectId  The project_info.id.
 * @returns  The number of rows upserted (0 if the project doesn't exist,
 *           1 on success).
 */
export async function recomputeDerivedKpisForProject(
  projectId: number,
): Promise<number> {
  const [project] = await db
    .select()
    .from(projectInfo)
    .where(eq(projectInfo.id, projectId))
    .limit(1);
  if (!project) return 0;

  const computed = await computeProjectKpi(project);
  await upsertDerivedKpiRow(computed);
  return 1;
}

/**
 * Recompute derived_project_kpis for every project. Called by the
 * scheduled job (bootstrap/derived-project-kpis-scheduler.ts) every 15
 * minutes. Safe to call concurrently with single-project recomputes —
 * each row is upserted independently.
 *
 * @returns  The number of project rows refreshed.
 */
export async function recomputeAllDerivedKpis(): Promise<number> {
  const projects = await db.select().from(projectInfo);
  let count = 0;
  for (const project of projects) {
    try {
      const computed = await computeProjectKpi(project);
      await upsertDerivedKpiRow(computed);
      count += 1;
    } catch (err) {
      // Best-effort: a single project failing must not block the rest. One
      // concise warning per project — never a full stack dump every cycle.
      console.warn(
        `[derived-project-kpis] project ${project.id} skipped: ${errMsg(err)}`,
      );
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type ProjectInfoRow = typeof projectInfo.$inferSelect;

interface ComputedKpi {
  projectKey: string;
  projectName: string;
  projectId: number;
  phase: string | null;
  sizeKwp: string | null;
  contractValue: string | null;
  ragStatus: string | null;
  pm: string | null;
  pd: string | null;
  isActive: boolean;
  totalPlannedRevenue: number;
  totalActualRevenue: number;
  revenueRealised: number;
  revenueOutstanding: number;
  totalPlannedExpenses: number;
  totalActualExpenses: number;
  cosRealised: number;
  expensesOutstanding: number;
  grossProfit: number;
  grossMarginPct: number | null;
  avgActualPctComplete: number;
  avgExpectedPctComplete: number;
  scheduleDelta: number;
  taskCount: number;
  expenseLineCount: number;
  revenueLineCount: number;
}

async function computeProjectKpi(project: ProjectInfoRow): Promise<ComputedKpi> {
  const projectId = project.id;

  // Pull all canonical signals in parallel. We're going through the
  // canonical KPI service (which already applies snapshot + deleted_at
  // guards per § 3.1) so the cache stays formula-identical to the live
  // aggregator. F-1 Phase 1 added recognisedRevenue (POC) to that
  // service; once this writer runs, priority surfaces start seeing it.
  const [financeMap, costLineCount, revenueLineCount, taskRows] =
    await Promise.all([
      getCanonicalFinanceByProjectIds([projectId]),
      countActiveCostLines(projectId),
      countActiveRevenueLines(projectId),
      loadActiveTasks(projectId),
    ]);

  const finance = financeMap.get(projectId);
  // finance is always populated (the canonical service seeds a zero row
  // for every requested id) but defend against the empty-map case.
  const recognisedRevenue = finance?.recognisedRevenue ?? 0;
  const totalRevenue = finance?.totalRevenue ?? 0;
  const receivedRevenue = finance?.receivedRevenue ?? 0;
  const outstandingRevenue = finance?.outstandingRevenue ?? 0;
  const totalCost = finance?.totalCost ?? 0;
  const paidCost = finance?.paidCost ?? 0;
  const outstandingCost = finance?.outstandingCost ?? 0;
  const realisedCost = finance?.realisedCost ?? 0;

  // Per § 3.3, the canonical "revenue recognised" figure is the per-line
  // POC sum (recognisedRevenue). The legacy `revenueRealised` cache
  // column mirrors that. The deprecated `totalPlannedRevenue` /
  // `totalActualRevenue` columns are populated for backward compat with
  // priority_derived_metrics consumers that still read those names.
  const grossProfit = recognisedRevenue - realisedCost;
  const grossMarginPct =
    recognisedRevenue > 0 ? grossProfit / recognisedRevenue : null;

  const avgActualPctComplete = avgPct(
    taskRows.map((t) => Number(t.percentComplete ?? 0)),
  );
  // Expected % is derived from elapsed-vs-planned per task. When a task
  // has no end date we fall back to the actual %, which keeps the
  // schedule delta at zero (no overrun signal) instead of producing a
  // misleading variance.
  const avgExpectedPctComplete = avgPct(
    taskRows.map((t) => expectedPctForTask(t)),
  );
  const scheduleDelta = avgActualPctComplete - avgExpectedPctComplete;

  return {
    projectKey: project.projectName,
    projectName: project.projectName,
    projectId,
    // `phase` and `ragStatus` live on projectExecutionState (not projectInfo).
    // We leave them null here; the priority KPI surface joins through the
    // execution state separately. If the cache ever needs to hold them, the
    // join should happen inside this materializer to keep one writer.
    phase: null,
    sizeKwp: project.sizeKwp ?? null,
    contractValue: project.contractValue ?? null,
    ragStatus: null,
    pm: project.pm ?? null,
    pd: project.pd ?? null,
    isActive: project.projectStatus === "active" || project.projectStatus === "hold",
    totalPlannedRevenue: totalRevenue,
    totalActualRevenue: receivedRevenue,
    revenueRealised: recognisedRevenue,
    revenueOutstanding: outstandingRevenue,
    totalPlannedExpenses: totalCost,
    totalActualExpenses: paidCost,
    cosRealised: realisedCost,
    expensesOutstanding: outstandingCost,
    grossProfit,
    grossMarginPct,
    avgActualPctComplete,
    avgExpectedPctComplete,
    scheduleDelta,
    taskCount: taskRows.length,
    expenseLineCount: costLineCount,
    revenueLineCount,
  };
}

async function upsertDerivedKpiRow(c: ComputedKpi): Promise<void> {
  const values = {
    projectKey: c.projectKey,
    projectName: c.projectName,
    projectId: c.projectId,
    phase: c.phase,
    sizeKwp: c.sizeKwp,
    contractValue: c.contractValue,
    ragStatus: c.ragStatus,
    pm: c.pm,
    pd: c.pd,
    isActive: c.isActive,
    totalPlannedRevenue: c.totalPlannedRevenue.toFixed(2),
    totalActualRevenue: c.totalActualRevenue.toFixed(2),
    revenueRealised: c.revenueRealised.toFixed(2),
    revenueOutstanding: c.revenueOutstanding.toFixed(2),
    totalPlannedExpenses: c.totalPlannedExpenses.toFixed(2),
    totalActualExpenses: c.totalActualExpenses.toFixed(2),
    cosRealised: c.cosRealised.toFixed(2),
    expensesOutstanding: c.expensesOutstanding.toFixed(2),
    grossProfit: c.grossProfit.toFixed(2),
    grossMarginPct:
      c.grossMarginPct !== null ? c.grossMarginPct.toFixed(4) : null,
    avgActualPctComplete: c.avgActualPctComplete.toFixed(4),
    avgExpectedPctComplete: c.avgExpectedPctComplete.toFixed(4),
    scheduleDelta: c.scheduleDelta.toFixed(4),
    taskCount: c.taskCount,
    expenseLineCount: c.expenseLineCount,
    revenueLineCount: c.revenueLineCount,
    needsReview: false,
    needsReviewReason: null,
    computedAt: new Date(),
  };
  // The unique constraint is on project_key; use it as the conflict
  // target for the upsert.
  await db
    .insert(derivedProjectKpis)
    .values(values)
    .onConflictDoUpdate({
      target: derivedProjectKpis.projectKey,
      set: {
        projectName: values.projectName,
        projectId: values.projectId,
        phase: values.phase,
        sizeKwp: values.sizeKwp,
        contractValue: values.contractValue,
        ragStatus: values.ragStatus,
        pm: values.pm,
        pd: values.pd,
        isActive: values.isActive,
        totalPlannedRevenue: values.totalPlannedRevenue,
        totalActualRevenue: values.totalActualRevenue,
        revenueRealised: values.revenueRealised,
        revenueOutstanding: values.revenueOutstanding,
        totalPlannedExpenses: values.totalPlannedExpenses,
        totalActualExpenses: values.totalActualExpenses,
        cosRealised: values.cosRealised,
        expensesOutstanding: values.expensesOutstanding,
        grossProfit: values.grossProfit,
        grossMarginPct: values.grossMarginPct,
        avgActualPctComplete: values.avgActualPctComplete,
        avgExpectedPctComplete: values.avgExpectedPctComplete,
        scheduleDelta: values.scheduleDelta,
        taskCount: values.taskCount,
        expenseLineCount: values.expenseLineCount,
        revenueLineCount: values.revenueLineCount,
        computedAt: values.computedAt,
      },
    });
}

async function countActiveCostLines(projectId: number): Promise<number> {
  const result = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(normalizedCostLines)
    .where(
      and(
        eq(normalizedCostLines.projectId, projectId),
        isNull(normalizedCostLines.effectiveTo),
        isNull(normalizedCostLines.deletedAt),
      ),
    );
  return Number(result[0]?.count ?? 0);
}

async function countActiveRevenueLines(projectId: number): Promise<number> {
  const result = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(normalizedRevenueLines)
    .where(
      and(
        eq(normalizedRevenueLines.projectId, projectId),
        isNull(normalizedRevenueLines.effectiveTo),
        isNull(normalizedRevenueLines.deletedAt),
      ),
    );
  return Number(result[0]?.count ?? 0);
}

async function loadActiveTasks(projectId: number): Promise<Array<typeof workItems.$inferSelect>> {
  return db
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.projectId, projectId),
        isNull(workItems.deletedAt),
      ),
    );
}

function avgPct(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  return sum / values.length;
}

/**
 * Expected percent-complete for a task based on elapsed time between
 * its start and end dates. Returns the actual percentage when start /
 * end aren't both available so the schedule delta defaults to zero
 * rather than producing a misleading variance.
 */
function expectedPctForTask(task: typeof workItems.$inferSelect): number {
  const actual = Number(task.percentComplete ?? 0);
  const start = task.startDate ? new Date(task.startDate) : null;
  const end = task.endDate ? new Date(task.endDate) : null;
  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
    return actual;
  }
  const now = Date.now();
  if (now <= start.getTime()) return 0;
  if (now >= end.getTime()) return 100;
  const span = end.getTime() - start.getTime();
  if (span <= 0) return actual;
  const elapsed = now - start.getTime();
  return (elapsed / span) * 100;
}
