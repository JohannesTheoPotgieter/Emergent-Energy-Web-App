import { and, inArray, isNull, sql } from "drizzle-orm";
import { normalizedCostLines, normalizedRevenueLines, workItems } from "@shared/schema";
import { db, getDbMode } from "../db";
import { getCosRealisedAmountForNclRow } from "../lib/calculations/financeUtils";
import { getAssignedEvidenceByCostLineIds } from "../lib/finance/qb-allocation-read";
import { FinanceLineLevelRepository } from "../repositories/finance-line-level-repository";

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface CanonicalProjectFinanceRow {
  projectId: number;
  /**
   * Sum of milestone amounts on `normalized_revenue_lines` (a.k.a. contracted
   * billing value). NOT § 3.3 recognised revenue — that lives on
   * `recognisedRevenue` below. Kept for backward compat with consumers that
   * historically read `totalRevenue` as the headline figure.
   *
   * @deprecated for "Revenue" tile usage. Use `recognisedRevenue` for the
   * § 3.3 POC figure or rename UI labels to "Contract value billed" before
   * reading.
   */
  totalRevenue: number;
  /**
   * § 3.3 recognised revenue — per-line POC sum sourced from
   * `FinanceLineLevelRepository.getPortfolioFinanceLines`. This is the
   * Excel `Expenditure Breakdown` col U formula:
   *   perLineRevenue = (line.actualTotal / category.totalActualTotal)
   *                    × category.revenueAllocation
   * Aggregated per project (no cross-project pooling per § 3.3.1). Use this
   * for any "Revenue" KPI tile, dashboard, or report (§ 3.3.3 "must not be
   * conflated").
   */
  recognisedRevenue: number;
  receivedRevenue: number;
  outstandingRevenue: number;
  totalCost: number;
  paidCost: number;
  outstandingCost: number;
  /** COS realised — invoice-only hard rule. Separate from paidCost (cash concept). */
  realisedCost: number;
}

export interface CanonicalProjectTaskRow {
  projectId: number;
  total: number;
  inProgress: number;
  completed: number;
  onHold: number;
  needsApproval: number;
  overdue: number;
  active: number;
}

function isCompletedStatus(status: unknown): boolean {
  const value = String(status ?? "").trim().toUpperCase();
  return value === "COMPLETE" || value === "COMPLETED" || value === "DONE";
}

function isOverdueStatus(status: unknown): boolean {
  const value = String(status ?? "").trim().toUpperCase();
  return !["COMPLETE", "COMPLETED", "DONE", "QC APPROVED"].includes(value);
}

// Classification: CANONICAL_READ
// Canonical dashboard finance source: normalized_* lines keyed by project_id.
export async function getCanonicalFinanceByProjectIds(projectIds: number[]): Promise<Map<number, CanonicalProjectFinanceRow>> {
  if (projectIds.length === 0) return new Map();

  const byProject = new Map<number, CanonicalProjectFinanceRow>();
  for (const id of projectIds) {
    byProject.set(id, {
      projectId: id,
      totalRevenue: 0,
      recognisedRevenue: 0,
      receivedRevenue: 0,
      outstandingRevenue: 0,
      totalCost: 0,
      paidCost: 0,
      outstandingCost: 0,
      realisedCost: 0,
    });
  }

  if (getDbMode() === "sqlite") {
    const [revenueRows, costRows] = await Promise.all([
      db.select().from(normalizedRevenueLines).where(and(inArray(normalizedRevenueLines.projectId, projectIds), and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt)))),
      db.select().from(normalizedCostLines).where(and(inArray(normalizedCostLines.projectId, projectIds), and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt)))),
    ]);

    for (const row of revenueRows) {
      const current = byProject.get(row.projectId);
      if (!current) continue;
      const amount = toNumber(row.amountExVat);
      current.totalRevenue += amount;
      if (row.paidDate || row.inBankDate) {
        current.receivedRevenue += amount;
      } else {
        current.outstandingRevenue += amount;
      }
    }

    const assignedByCostLineId = await getAssignedEvidenceByCostLineIds(costRows.map((r: any) => r.id));
    for (const row of costRows) {
      const current = byProject.get(row.projectId);
      if (!current) continue;
      const amount = toNumber(row.amountExVat);
      current.totalCost += amount;
      if (row.paidDate) {
        current.paidCost += amount;
      } else {
        current.outstandingCost += amount;
      }
      current.realisedCost += getCosRealisedAmountForNclRow(
        row as any,
        assignedByCostLineId.get(row.id) ?? null,
      );
    }

    await populateRecognisedRevenue(byProject, projectIds);
    for (const current of byProject.values()) {
      current.recognisedRevenue = Number(current.recognisedRevenue.toFixed(2));
    }

    return byProject;
  }

  const revenueRows = await db.execute(sql`
    SELECT
      project_id,
      COALESCE(SUM(CAST(amount_ex_vat AS NUMERIC)), 0) AS total_revenue,
      COALESCE(SUM(CASE WHEN paid_date IS NOT NULL OR in_bank_date IS NOT NULL THEN CAST(amount_ex_vat AS NUMERIC) ELSE 0 END), 0) AS received_revenue,
      COALESCE(SUM(CASE WHEN paid_date IS NULL AND in_bank_date IS NULL THEN CAST(amount_ex_vat AS NUMERIC) ELSE 0 END), 0) AS outstanding_revenue
    FROM normalized_revenue_lines
    WHERE project_id = ANY(${sql`ARRAY[${sql.join(projectIds.map((id) => sql`${id}`), sql`,`)}]::int[]`})
      AND effective_to IS NULL
      AND deleted_at IS NULL
    GROUP BY project_id
  `);

  for (const row of revenueRows.rows as any[]) {
    const projectId = Number(row.project_id);
    const current = byProject.get(projectId);
    if (!current) continue;
    current.totalRevenue = toNumber(row.total_revenue);
    current.receivedRevenue = toNumber(row.received_revenue);
    current.outstandingRevenue = toNumber(row.outstanding_revenue);
  }

  // One cost query feeds all four totals (total/paid/outstanding/realised).
  // The realised-amount computation relies on the invoice-date-confirmed
  // gate + override rules which live in `isCanonicalCosRealised`, so we
  // need the raw rows anyway — issuing a separate aggregate SQL would
  // duplicate business logic and add a round-trip.
  const rawCostRows = await db
    .select()
    .from(normalizedCostLines)
    .where(and(inArray(normalizedCostLines.projectId, projectIds), and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt))));
  const assignedByCostLineId = await getAssignedEvidenceByCostLineIds(
    (rawCostRows as any[]).map((r: any) => r.id),
  );

  for (const row of rawCostRows as any[]) {
    const current = byProject.get(row.projectId);
    if (!current) continue;
    const amount = toNumber(row.amountExVat);
    current.totalCost += amount;
    if (row.paidDate) {
      current.paidCost += amount;
    } else {
      current.outstandingCost += amount;
    }
    current.realisedCost += getCosRealisedAmountForNclRow(
      row,
      assignedByCostLineId.get(row.id) ?? null,
    );
  }

  await populateRecognisedRevenue(byProject, projectIds);

  for (const current of byProject.values()) {
    current.totalCost = Number(current.totalCost.toFixed(2));
    current.paidCost = Number(current.paidCost.toFixed(2));
    current.outstandingCost = Number(current.outstandingCost.toFixed(2));
    current.realisedCost = Number(current.realisedCost.toFixed(2));
    current.recognisedRevenue = Number(current.recognisedRevenue.toFixed(2));
  }

  return byProject;
}

/**
 * § 3.3 POC recognised revenue, summed per project from the canonical
 * line-level repository. This is the ONLY correct source for "revenue
 * recognised" KPIs — the milestone-billing sum stored on `totalRevenue`
 * is contract value, not revenue (per § 3.3.3, must not be conflated).
 *
 * Batched: one repository call covers every project in the input set;
 * categories are scoped per project inside the repository (§ 3.3.1).
 */
async function populateRecognisedRevenue(
  byProject: Map<number, CanonicalProjectFinanceRow>,
  projectIds: number[],
): Promise<void> {
  if (projectIds.length === 0) return;
  try {
    const repo = new FinanceLineLevelRepository();
    const lines = await repo.getPortfolioFinanceLines(projectIds);
    for (const line of lines) {
      const current = byProject.get(line.projectId);
      if (!current) continue;
      current.recognisedRevenue += Number.isFinite(line.perLineRevenue) ? line.perLineRevenue : 0;
    }
  } catch (err) {
    // Recognised revenue is additive — leave the field as 0 on failure rather
    // than fail the entire KPI read. The legacy totalRevenue field remains
    // populated so dashboards still render their backward-compatible figure.
    console.warn("[canonical-dashboard-kpi] failed to populate recognisedRevenue:", err);
  }
}

// Classification: CANONICAL_READ
// Canonical execution KPI source: work_items keyed by project_id.
export async function getCanonicalTaskSummaryByProjectIds(projectIds: number[]): Promise<Map<number, CanonicalProjectTaskRow>> {
  if (projectIds.length === 0) return new Map();

  const byProject = new Map<number, CanonicalProjectTaskRow>();
  for (const id of projectIds) {
    byProject.set(id, {
      projectId: id,
      total: 0,
      inProgress: 0,
      completed: 0,
      onHold: 0,
      needsApproval: 0,
      overdue: 0,
      active: 0,
    });
  }

  if (getDbMode() === "sqlite") {
    const rows = await db
      .select()
      .from(workItems)
      .where(inArray(workItems.projectId, projectIds));

    const today = new Date().toISOString().slice(0, 10);

    for (const row of rows) {
      if (row.deletedAt) continue;
      const current = byProject.get(row.projectId);
      if (!current) continue;

      const status = String(row.status ?? "").trim().toUpperCase();
      current.total += 1;
      if (status === "IN PROGRESS") current.inProgress += 1;
      if (isCompletedStatus(status)) current.completed += 1;
      if (status === "HOLD") current.onHold += 1;
      if (status === "NEEDS APPROVAL") current.needsApproval += 1;
      if (row.endDate && row.endDate < today && isOverdueStatus(status)) current.overdue += 1;
      if (!["COMPLETE", "COMPLETED", "DONE", "CANCELLED", "CANCELED"].includes(status)) current.active += 1;
    }

    return byProject;
  }

  const rows = await db.execute(sql`
    SELECT
      project_id,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(status, ''))) = 'IN PROGRESS')::int AS in_progress,
      COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(status, ''))) IN ('COMPLETE', 'COMPLETED', 'DONE'))::int AS completed,
      COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(status, ''))) = 'HOLD')::int AS on_hold,
      COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(status, ''))) = 'NEEDS APPROVAL')::int AS needs_approval,
      COUNT(*) FILTER (
        WHERE end_date IS NOT NULL
          AND end_date < CURRENT_DATE::text
          AND UPPER(TRIM(COALESCE(status, ''))) NOT IN ('COMPLETE', 'COMPLETED', 'DONE', 'QC APPROVED')
      )::int AS overdue,
      COUNT(*) FILTER (
        WHERE UPPER(TRIM(COALESCE(status, ''))) NOT IN ('COMPLETE', 'COMPLETED', 'DONE', 'CANCELLED', 'CANCELED')
      )::int AS active
    FROM work_items
    WHERE deleted_at IS NULL
      AND project_id = ANY(${sql`ARRAY[${sql.join(projectIds.map((id) => sql`${id}`), sql`,`)}]::int[]`})
    GROUP BY project_id
  `);

  for (const row of rows.rows as any[]) {
    const projectId = Number(row.project_id);
    byProject.set(projectId, {
      projectId,
      total: toNumber(row.total),
      inProgress: toNumber(row.in_progress),
      completed: toNumber(row.completed),
      onHold: toNumber(row.on_hold),
      needsApproval: toNumber(row.needs_approval),
      overdue: toNumber(row.overdue),
      active: toNumber(row.active),
    });
  }

  return byProject;
}
