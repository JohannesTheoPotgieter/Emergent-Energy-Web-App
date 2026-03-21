/**
 * Temporal financial data queries — Prompt 9.
 *
 * Provides point-in-time query capability for financial tables.
 * All 8 financial tables now have effective_from/effective_to columns.
 *
 * A row is "active at time T" when:
 *   effective_from <= T AND (effective_to IS NULL OR effective_to > T)
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

/** Valid temporal financial table names */
export type TemporalFinancialTable =
  | "program_expense"
  | "program_inflows"
  | "cashflow_points"
  | "finance_revenue_monthly"
  | "finance_cos_monthly"
  | "project_revenue_summary"
  | "normalized_cost_lines"
  | "normalized_revenue_lines";

const VALID_TABLES: Set<string> = new Set([
  "program_expense",
  "program_inflows",
  "cashflow_points",
  "finance_revenue_monthly",
  "finance_cos_monthly",
  "project_revenue_summary",
  "normalized_cost_lines",
  "normalized_revenue_lines",
]);

/**
 * Query financial data as it existed at a specific point in time.
 *
 * @param projectId - Filter by project (required for scoped queries)
 * @param asOfDate  - The point-in-time to query
 * @param tableName - Which financial table to query
 * @returns Rows that were active at asOfDate
 */
export async function getFinancialStateAt(
  projectId: number,
  asOfDate: Date,
  tableName: TemporalFinancialTable,
): Promise<any[]> {
  if (!VALID_TABLES.has(tableName)) {
    throw new Error(`Invalid temporal table name: ${tableName}`);
  }

  const isoDate = asOfDate.toISOString();

  const result = await db.execute(sql.raw(`
    SELECT *
    FROM "${tableName}"
    WHERE project_id = ${projectId}
      AND effective_from <= '${isoDate}'::timestamp
      AND (effective_to IS NULL OR effective_to > '${isoDate}'::timestamp)
    ORDER BY id ASC
  `));

  return (result as any).rows || [];
}

/**
 * Query current (live) financial data for a project.
 * Equivalent to getFinancialStateAt(projectId, NOW(), tableName).
 */
export async function getCurrentFinancialState(
  projectId: number,
  tableName: TemporalFinancialTable,
): Promise<any[]> {
  if (!VALID_TABLES.has(tableName)) {
    throw new Error(`Invalid temporal table name: ${tableName}`);
  }

  const result = await db.execute(sql.raw(`
    SELECT *
    FROM "${tableName}"
    WHERE project_id = ${projectId}
      AND effective_to IS NULL
    ORDER BY id ASC
  `));

  return (result as any).rows || [];
}

/**
 * List all snapshot points (import runs) that affected a project's financial data.
 * Useful for building a timeline/history selector.
 */
export async function getFinancialSnapshotHistory(
  projectId: number,
  tableName: TemporalFinancialTable,
): Promise<{ snapshotRunId: number; effectiveFrom: Date; rowCount: number }[]> {
  if (!VALID_TABLES.has(tableName)) {
    throw new Error(`Invalid temporal table name: ${tableName}`);
  }

  const result = await db.execute(sql.raw(`
    SELECT
      snapshot_run_id,
      MIN(effective_from) as effective_from,
      COUNT(*) as row_count
    FROM "${tableName}"
    WHERE project_id = ${projectId}
      AND snapshot_run_id IS NOT NULL
    GROUP BY snapshot_run_id
    ORDER BY MIN(effective_from) ASC
  `));

  return ((result as any).rows || []).map((row: any) => ({
    snapshotRunId: row.snapshot_run_id,
    effectiveFrom: row.effective_from,
    rowCount: Number(row.row_count),
  }));
}
