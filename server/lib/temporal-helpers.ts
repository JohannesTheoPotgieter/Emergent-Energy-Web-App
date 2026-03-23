/**
 * Prompt 10 — Temporal column helpers for the import pipeline.
 *
 * Provides reusable functions to:
 * 1. Soft-close existing rows (SET effective_to = NOW()) instead of hard DELETE
 * 2. Stamp new rows with temporal metadata (effective_from, snapshot_run_id)
 *
 * These helpers wrap raw SQL via Drizzle's `sql` tag because the temporal
 * columns aren't referenced in most existing Drizzle insert value maps.
 */

import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/**
 * Valid temporal financial table names (must match schema).
 * Used for raw-SQL operations where Drizzle schema refs aren't practical.
 */
export const TEMPORAL_TABLES = new Set([
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
 * Soft-close rows: SET effective_to = NOW() instead of DELETE.
 *
 * @param tx  - Drizzle transaction or db instance
 * @param tableName - Raw table name (must be in TEMPORAL_TABLES)
 * @param whereClause - SQL WHERE clause (e.g. "project_id = 5")
 * @returns Number of rows soft-closed
 */
export async function softCloseRows(
  tx: any,
  tableName: string,
  whereClause: string,
): Promise<number> {
  if (!TEMPORAL_TABLES.has(tableName)) {
    throw new Error(`softCloseRows: invalid table "${tableName}"`);
  }
  const result = await tx.execute(sql.raw(`
    UPDATE "${tableName}"
    SET effective_to = NOW()
    WHERE (effective_to IS NULL)
      AND (${whereClause})
  `));
  return (result as any).rowCount ?? 0;
}

/**
 * Soft-close rows using a Drizzle schema reference and column-level condition.
 * This is the preferred API when you already have the Drizzle table object.
 *
 * @param tx - Drizzle transaction or db instance
 * @param table - Drizzle table schema reference
 * @param condition - Drizzle SQL condition (from eq(), and(), etc.)
 */
export async function softCloseByCondition(
  tx: any,
  table: PgTable,
  condition: any,
): Promise<number> {
  const result = await tx.update(table)
    .set({ effectiveTo: new Date() } as any)
    .where(
      // Only close rows that are currently active (effective_to IS NULL)
      sql`${condition} AND ${sql.raw('"effective_to" IS NULL')}`
    );
  return (result as any).rowCount ?? 0;
}

/**
 * Add temporal columns to a values object before INSERT.
 *
 * @param values - The insert values (single object or array)
 * @param snapshotRunId - The import run ID (null for manual entries)
 * @param effectiveFrom - Override timestamp (default: new Date())
 * @returns The values with temporal columns added
 */
export function addTemporalColumns<T extends Record<string, any>>(
  values: T | T[],
  snapshotRunId: number | null = null,
  effectiveFrom?: Date,
): T | T[] {
  const now = effectiveFrom || new Date();
  const temporal = {
    effectiveFrom: now,
    effectiveTo: null,
    snapshotRunId,
  };
  if (Array.isArray(values)) {
    return values.map(v => ({ ...v, ...temporal }));
  }
  return { ...values, ...temporal };
}

/**
 * Soft-close by projectId column (common pattern in smart-import).
 */
export async function softCloseByProjectId(
  tx: any,
  tableName: string,
  projectId: number,
): Promise<number> {
  return softCloseRows(tx, tableName, `project_id = ${projectId}`);
}

/**
 * Soft-close by projectName column (common pattern in smart-import).
 */
export async function softCloseByProjectName(
  tx: any,
  tableName: string,
  projectName: string,
): Promise<number> {
  // Escape single quotes in project name
  const escaped = projectName.replace(/'/g, "''");
  return softCloseRows(tx, tableName, `project_name = '${escaped}'`);
}

/**
 * Soft-close by importRunId (used in rollback operations).
 */
export async function softCloseByImportRunId(
  tx: any,
  tableName: string,
  importRunId: number,
): Promise<number> {
  return softCloseRows(tx, tableName, `import_run_id = ${importRunId}`);
}
