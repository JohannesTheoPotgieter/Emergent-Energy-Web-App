import { sql } from "drizzle-orm";
import { db } from "../db";

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface CanonicalProjectFinanceRow {
  projectId: number;
  totalRevenue: number;
  receivedRevenue: number;
  outstandingRevenue: number;
  totalCost: number;
  paidCost: number;
  outstandingCost: number;
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

// Classification: CANONICAL_READ
// Canonical dashboard finance source: normalized_* lines keyed by project_id.
export async function getCanonicalFinanceByProjectIds(projectIds: number[]): Promise<Map<number, CanonicalProjectFinanceRow>> {
  if (projectIds.length === 0) return new Map();

  const revenueRows = await db.execute(sql`
    SELECT
      project_id,
      COALESCE(SUM(CAST(amount_ex_vat AS NUMERIC)), 0) AS total_revenue,
      COALESCE(SUM(CASE WHEN paid_date IS NOT NULL OR in_bank_date IS NOT NULL THEN CAST(amount_ex_vat AS NUMERIC) ELSE 0 END), 0) AS received_revenue,
      COALESCE(SUM(CASE WHEN paid_date IS NULL AND in_bank_date IS NULL THEN CAST(amount_ex_vat AS NUMERIC) ELSE 0 END), 0) AS outstanding_revenue
    FROM normalized_revenue_lines
    WHERE project_id = ANY(${sql`ARRAY[${sql.join(projectIds.map((id) => sql`${id}`), sql`,`)}]::int[]`})
    GROUP BY project_id
  `);

  const costRows = await db.execute(sql`
    SELECT
      project_id,
      COALESCE(SUM(CAST(amount_ex_vat AS NUMERIC)), 0) AS total_cost,
      COALESCE(SUM(CASE WHEN paid_date IS NOT NULL THEN CAST(amount_ex_vat AS NUMERIC) ELSE 0 END), 0) AS paid_cost,
      COALESCE(SUM(CASE WHEN paid_date IS NULL THEN CAST(amount_ex_vat AS NUMERIC) ELSE 0 END), 0) AS outstanding_cost
    FROM normalized_cost_lines
    WHERE project_id = ANY(${sql`ARRAY[${sql.join(projectIds.map((id) => sql`${id}`), sql`,`)}]::int[]`})
    GROUP BY project_id
  `);

  const byProject = new Map<number, CanonicalProjectFinanceRow>();
  for (const id of projectIds) {
    byProject.set(id, {
      projectId: id,
      totalRevenue: 0,
      receivedRevenue: 0,
      outstandingRevenue: 0,
      totalCost: 0,
      paidCost: 0,
      outstandingCost: 0,
    });
  }

  for (const row of revenueRows.rows as any[]) {
    const projectId = Number(row.project_id);
    const current = byProject.get(projectId);
    if (!current) continue;
    current.totalRevenue = toNumber(row.total_revenue);
    current.receivedRevenue = toNumber(row.received_revenue);
    current.outstandingRevenue = toNumber(row.outstanding_revenue);
  }

  for (const row of costRows.rows as any[]) {
    const projectId = Number(row.project_id);
    const current = byProject.get(projectId);
    if (!current) continue;
    current.totalCost = toNumber(row.total_cost);
    current.paidCost = toNumber(row.paid_cost);
    current.outstandingCost = toNumber(row.outstanding_cost);
  }

  return byProject;
}

// Classification: CANONICAL_READ
// Canonical execution KPI source: work_items keyed by project_id.
export async function getCanonicalTaskSummaryByProjectIds(projectIds: number[]): Promise<Map<number, CanonicalProjectTaskRow>> {
  if (projectIds.length === 0) return new Map();

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
