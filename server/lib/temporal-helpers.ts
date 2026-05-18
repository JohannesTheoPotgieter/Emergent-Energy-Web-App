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

import { sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/**
 * Minimal structural surface of the Drizzle db / transaction object that the
 * temporal helpers actually touch. The concrete db instance is typed `any`
 * at its source (`server/db.ts`) because it must support both the Postgres
 * and dev-SQLite drivers; this interface narrows it to the two methods used
 * here without widening anything back to `any`.
 */
interface TemporalTx {
  execute(query: SQL): Promise<unknown>;
  update(table: PgTable): {
    set(values: Record<string, unknown>): {
      where(condition: SQL): Promise<unknown>;
    };
  };
}

/**
 * Extract the affected-row count from a raw driver result. The pg
 * `QueryResult` exposes `rowCount`; the dev-SQLite path does not, in which
 * case we conservatively report 0.
 */
function extractRowCount(result: unknown): number {
  if (result && typeof result === "object" && "rowCount" in result) {
    const n = Number((result as { rowCount: number | null }).rowCount);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Valid temporal financial table names (must match schema).
 * Used for raw-SQL operations where Drizzle schema refs aren't practical.
 */
export const TEMPORAL_TABLES = new Set([
  "cashflow_points",
  "finance_revenue_monthly",
  "finance_cos_monthly",
  "project_revenue_summary",
  "normalized_cost_lines",
  "normalized_revenue_lines",
  "category_revenue_allocations",
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
  tx: TemporalTx,
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
  return extractRowCount(result);
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
  tx: TemporalTx,
  table: PgTable,
  condition: SQL,
): Promise<number> {
  const result = await tx.update(table)
    .set({ effectiveTo: new Date() })
    .where(
      // Only close rows that are currently active (effective_to IS NULL)
      sql`${condition} AND ${sql.raw('"effective_to" IS NULL')}`
    );
  return extractRowCount(result);
}

/**
 * Add temporal columns to a values object before INSERT.
 *
 * @param values - The insert values (single object or array)
 * @param snapshotRunId - The import run ID (null for manual entries)
 * @param effectiveFrom - Override timestamp (default: new Date())
 * @returns The values with temporal columns added
 */
export function addTemporalColumns<T extends Record<string, unknown>>(
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
 * Deduplicate cost-line insert values before they hit the database.
 *
 * The Excel tracker importer creates one normalized_cost_lines row per
 * "Expenditure Breakdown" sheet row, but the workbook repeats a single
 * invoice on every forecast paid_date row. Without this dedupe, an
 * invoice with a 12-month payment plan becomes 12 cost lines (each at
 * the full invoice amount), inflating COS dashboards.
 *
 * Dedupe key: (projectName, invoiceNumber, invoiceDate, amountExVat).
 * Rows missing invoiceNumber are kept as-is (cannot be safely merged).
 * The first occurrence of each key is kept; later occurrences are dropped.
 *
 * Returns { kept, dropped } so callers can log and surface the dedup count.
 */
export function dedupeCostLineInserts<T extends {
  projectName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  amountExVat?: string | number | null;
}>(values: T[]): { kept: T[]; dropped: number } {
  if (values.length < 2) return { kept: values, dropped: 0 };
  const seen = new Set<string>();
  const kept: T[] = [];
  let dropped = 0;
  for (const v of values) {
    const proj = (v.projectName ?? "").toString().trim();
    const inv = (v.invoiceNumber ?? "").toString().trim();
    const date = (v.invoiceDate ?? "").toString().trim();
    const amt = v.amountExVat == null ? "" : String(v.amountExVat).trim();
    if (!proj || !inv || !date || !amt) {
      kept.push(v);
      continue;
    }
    const key = `${proj}\u0001${inv}\u0001${date}\u0001${amt}`;
    if (seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    kept.push(v);
  }
  return { kept, dropped };
}

/**
 * Soft-close by projectId column (common pattern in smart-import).
 * Uses Drizzle sql tagged template for safe parameterization.
 */
export async function softCloseByProjectId(
  tx: TemporalTx,
  tableName: string,
  projectId: number,
): Promise<number> {
  if (!TEMPORAL_TABLES.has(tableName)) {
    throw new Error(`softCloseByProjectId: invalid table "${tableName}"`);
  }
  const result = await tx.execute(sql`
    UPDATE ${sql.raw(`"${tableName}"`)}
    SET effective_to = NOW()
    WHERE (effective_to IS NULL)
      AND (project_id = ${projectId})
  `);
  return extractRowCount(result);
}

/**
 * Soft-close by projectName column (common pattern in smart-import).
 * Uses Drizzle sql tagged template for safe parameterization.
 */
export async function softCloseByProjectName(
  tx: TemporalTx,
  tableName: string,
  projectName: string,
): Promise<number> {
  if (!TEMPORAL_TABLES.has(tableName)) {
    throw new Error(`softCloseByProjectName: invalid table "${tableName}"`);
  }
  const result = await tx.execute(sql`
    UPDATE ${sql.raw(`"${tableName}"`)}
    SET effective_to = NOW()
    WHERE (effective_to IS NULL)
      AND (project_name = ${projectName})
  `);
  return extractRowCount(result);
}

/**
 * Soft-close by importRunId (used in rollback operations).
 * Uses Drizzle sql tagged template for safe parameterization.
 */
export async function softCloseByImportRunId(
  tx: TemporalTx,
  tableName: string,
  importRunId: number,
): Promise<number> {
  if (!TEMPORAL_TABLES.has(tableName)) {
    throw new Error(`softCloseByImportRunId: invalid table "${tableName}"`);
  }
  const result = await tx.execute(sql`
    UPDATE ${sql.raw(`"${tableName}"`)}
    SET effective_to = NOW()
    WHERE (effective_to IS NULL)
      AND (import_run_id = ${importRunId})
  `);
  return extractRowCount(result);
}
