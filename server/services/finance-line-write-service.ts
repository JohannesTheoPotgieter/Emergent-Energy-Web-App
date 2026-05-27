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

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { normalizedCostLines, normalizedRevenueLines } from "../../shared/schema";
import {
  syncCostLine,
  syncRevenueLine,
  syncCostLineFieldUpdate,
  syncRevenueLineFieldUpdate,
  softClosePromotedCostLines,
  softClosePromotedRevenueLines,
  syncCostLineCounterpartyBulk,
  batchSyncFinanceByProject,
  bridgeCatch,
  bridgeCatchFor,
} from "../bridge/bridge-writer";
import { softCloseByProjectName, softCloseByProjectId } from "../lib/temporal-helpers";
import { assertProjectNotOnHold } from "./project-hold-gate";

type DbOrTx = typeof db;

// ---------------------------------------------------------------------------
// Cost Line writes
// ---------------------------------------------------------------------------

/**
 * Create a single cost line and sync to promoted schema.
 *
 * If `values.idempotencyKey` is provided, checks for an existing row with
 * that key first. If found, returns the existing row without inserting
 * (idempotent retry). This prevents duplicates from double-clicks,
 * browser resends, and network retries for manual expense creation.
 */
export async function createCostLine(
  values: Record<string, any>,
  txOrDb: DbOrTx = db,
): Promise<any> {
  // TF-22 (audit V3) — block writes on held projects unless the caller
  // explicitly overrode via the values.__overrideHold envelope (set by
  // owner-role routes).
  if (typeof values.projectId === "number") {
    await assertProjectNotOnHold(values.projectId, {
      override: values.__overrideHold === true,
      overrideReason: values.__overrideHoldReason,
    });
  }
  // Idempotency guard: if a key is provided, check for existing row first
  if (values.idempotencyKey) {
    const existing = await (txOrDb as any)
      .select()
      .from(normalizedCostLines)
      .where(and(
        eq(normalizedCostLines.idempotencyKey, values.idempotencyKey),
        isNull(normalizedCostLines.effectiveTo),
      ))
      .limit(1);
    if (existing.length > 0) {
      return existing[0];
    }
  }

  const [created] = await (txOrDb as any).insert(normalizedCostLines).values(values).returning();
  syncCostLine(created).catch(bridgeCatchFor("cost_line", created.id));
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
    syncCostLine(row).catch(bridgeCatchFor("cost_line", row.id));
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
  // TF-22 — look up the project for this cost line and refuse writes on hold.
  // We don't fail open on a missing row: if the line doesn't exist the UPDATE
  // will return nothing anyway, so the gate is only relevant when the row
  // exists.
  const [existing] = await (txOrDb as any)
    .select({ projectId: normalizedCostLines.projectId })
    .from(normalizedCostLines)
    .where(eq(normalizedCostLines.id, id))
    .limit(1);
  if (existing?.projectId) {
    await assertProjectNotOnHold(existing.projectId, {
      override: fields.__overrideHold === true,
      overrideReason: fields.__overrideHoldReason,
    });
  }
  // Strip the override envelope before forwarding the values to the DB.
  const { __overrideHold, __overrideHoldReason, ...persistable } = fields;
  void __overrideHold;
  void __overrideHoldReason;
  const [updated] = await (txOrDb as any)
    .update(normalizedCostLines)
    .set(persistable)
    .where(and(
      eq(normalizedCostLines.id, id),
      isNull(normalizedCostLines.effectiveTo),
    ))
    .returning();
  if (updated) {
    syncCostLineFieldUpdate(id, persistable).catch(bridgeCatch);
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
  softClosePromotedCostLines(projectId, projectName).catch(bridgeCatch);
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
  // TF-22 — refuse revenue inserts on a held project.
  if (typeof values.projectId === "number") {
    await assertProjectNotOnHold(values.projectId, {
      override: values.__overrideHold === true,
      overrideReason: values.__overrideHoldReason,
    });
  }
  const { __overrideHold, __overrideHoldReason, ...persistable } = values;
  void __overrideHold;
  void __overrideHoldReason;
  const [created] = await (txOrDb as any).insert(normalizedRevenueLines).values(persistable).returning();
  syncRevenueLine(created).catch(bridgeCatchFor("revenue_line", created.id));
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
    syncRevenueLine(row).catch(bridgeCatchFor("revenue_line", row.id));
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
  // TF-22 — look up the project and refuse if held.
  const [existing] = await (txOrDb as any)
    .select({ projectId: normalizedRevenueLines.projectId })
    .from(normalizedRevenueLines)
    .where(eq(normalizedRevenueLines.id, id))
    .limit(1);
  if (existing?.projectId) {
    await assertProjectNotOnHold(existing.projectId, {
      override: fields.__overrideHold === true,
      overrideReason: fields.__overrideHoldReason,
    });
  }
  const { __overrideHold, __overrideHoldReason, ...persistable } = fields;
  void __overrideHold;
  void __overrideHoldReason;
  const [updated] = await (txOrDb as any)
    .update(normalizedRevenueLines)
    .set(persistable)
    .where(and(
      eq(normalizedRevenueLines.id, id),
      isNull(normalizedRevenueLines.effectiveTo),
    ))
    .returning();
  if (updated) {
    syncRevenueLineFieldUpdate(id, persistable).catch(bridgeCatch);
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
  softClosePromotedRevenueLines(projectId, projectName).catch(bridgeCatch);
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

/**
 * Rename counterparty across all cost lines (legacy + promoted).
 */
export async function renameCostLineCounterparty(
  oldName: string,
  newName: string,
  txOrDb: DbOrTx = db,
): Promise<void> {
  await (txOrDb as any).execute(
    sql`UPDATE normalized_cost_lines SET counterparty_name = ${newName} WHERE counterparty_name = ${oldName} AND effective_to IS NULL AND deleted_at IS NULL`,
  );
  syncCostLineCounterpartyBulk(oldName, newName).catch(bridgeCatch);
}

/**
 * Full re-sync of all finance lines for a project after bulk import.
 */
export async function batchSyncFinanceLines(
  projectId: number | null,
  projectName: string | null,
): Promise<void> {
  batchSyncFinanceByProject(projectId, projectName).catch(bridgeCatch);
}
