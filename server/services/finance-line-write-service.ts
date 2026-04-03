/**
 * Finance Line Write Service — Centralized write authority for
 * normalized_cost_lines and normalized_revenue_lines.
 *
 * WRITE AUTHORITY MODEL:
 *   Legacy tables remain the primary write targets. Every write is synced
 *   to finance.cost_lines / finance.revenue_lines via bridge writers.
 *
 * Fields that exist ONLY in legacy (not in promoted schema) are listed in
 * docs/write-authority-model.md. Updates to those fields do not trigger
 * a bridge sync because the promoted schema has no corresponding column.
 *
 * LEGACY-ONLY FIELDS (no bridge needed):
 *   cost_lines: patternRuleId, patternClassifiedAt, patternInferredType,
 *               adminDateOverride, adminDateOverrideReason, adminDateOverrideBy,
 *               adminDateOverrideAt, counterpartyId, counterpartyType
 *   revenue_lines: adminDateOverride, adminDateOverrideReason, adminDateOverrideBy,
 *                  adminDateOverrideAt
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { normalizedCostLines, normalizedRevenueLines } from "../../shared/schema";
import {
  syncCostLine,
  syncRevenueLine,
  syncCostLineFieldUpdate,
  syncRevenueLineFieldUpdate,
  softClosePromotedCostLines,
  softClosePromotedRevenueLines,
} from "../bridge/bridge-writer";
import { softCloseByProjectName, softCloseByProjectId } from "../lib/temporal-helpers";

type DbOrTx = typeof db;

// ---------------------------------------------------------------------------
// Cost Line writes
// ---------------------------------------------------------------------------

/**
 * Create a single cost line and sync to promoted schema.
 */
export async function createCostLine(
  values: Record<string, any>,
  txOrDb: DbOrTx = db,
): Promise<any> {
  const [created] = await (txOrDb as any).insert(normalizedCostLines).values(values).returning();
  syncCostLine(created).catch(() => {});
  return created;
}

/**
 * Create many cost lines and sync each to promoted schema.
 */
export async function createCostLines(
  values: Record<string, any>[],
  txOrDb: DbOrTx = db,
): Promise<any[]> {
  if (values.length === 0) return [];
  const created = await (txOrDb as any).insert(normalizedCostLines).values(values).returning();
  // Bridge sync in background — don't block the bulk insert
  for (const row of created) {
    syncCostLine(row).catch(() => {});
  }
  return created;
}

/**
 * Update specific fields on a cost line. If the fields exist in the promoted
 * schema, they are synced. Legacy-only fields are silently skipped.
 */
export async function updateCostLineFields(
  id: number,
  fields: Record<string, any>,
  txOrDb: DbOrTx = db,
): Promise<any> {
  const [updated] = await (txOrDb as any)
    .update(normalizedCostLines)
    .set(fields)
    .where(eq(normalizedCostLines.id, id))
    .returning();
  if (updated) {
    syncCostLineFieldUpdate(id, fields).catch(() => {});
  }
  return updated;
}

/**
 * Soft-close all active cost lines for a project and cascade to promoted schema.
 */
export async function softCloseCostLinesByProject(
  projectId: number | null,
  projectName: string | null,
  txOrDb: DbOrTx = db,
): Promise<void> {
  if (projectId) {
    await softCloseByProjectId(txOrDb, "normalized_cost_lines", projectId);
  } else if (projectName) {
    await softCloseByProjectName(txOrDb, "normalized_cost_lines", projectName);
  }
  softClosePromotedCostLines(projectId, projectName).catch(() => {});
}

// ---------------------------------------------------------------------------
// Revenue Line writes
// ---------------------------------------------------------------------------

/**
 * Create a single revenue line and sync to promoted schema.
 */
export async function createRevenueLine(
  values: Record<string, any>,
  txOrDb: DbOrTx = db,
): Promise<any> {
  const [created] = await (txOrDb as any).insert(normalizedRevenueLines).values(values).returning();
  syncRevenueLine(created).catch(() => {});
  return created;
}

/**
 * Create many revenue lines and sync each to promoted schema.
 */
export async function createRevenueLines(
  values: Record<string, any>[],
  txOrDb: DbOrTx = db,
): Promise<any[]> {
  if (values.length === 0) return [];
  const created = await (txOrDb as any).insert(normalizedRevenueLines).values(values).returning();
  for (const row of created) {
    syncRevenueLine(row).catch(() => {});
  }
  return created;
}

/**
 * Update specific fields on a revenue line. If the fields exist in the promoted
 * schema, they are synced. Legacy-only fields are silently skipped.
 */
export async function updateRevenueLineFields(
  id: number,
  fields: Record<string, any>,
  txOrDb: DbOrTx = db,
): Promise<any> {
  const [updated] = await (txOrDb as any)
    .update(normalizedRevenueLines)
    .set(fields)
    .where(eq(normalizedRevenueLines.id, id))
    .returning();
  if (updated) {
    syncRevenueLineFieldUpdate(id, fields).catch(() => {});
  }
  return updated;
}

/**
 * Soft-close all active revenue lines for a project and cascade to promoted schema.
 */
export async function softCloseRevenueLinesByProject(
  projectId: number | null,
  projectName: string | null,
  txOrDb: DbOrTx = db,
): Promise<void> {
  if (projectId) {
    await softCloseByProjectId(txOrDb, "normalized_revenue_lines", projectId);
  } else if (projectName) {
    await softCloseByProjectName(txOrDb, "normalized_revenue_lines", projectName);
  }
  softClosePromotedRevenueLines(projectId, projectName).catch(() => {});
}
