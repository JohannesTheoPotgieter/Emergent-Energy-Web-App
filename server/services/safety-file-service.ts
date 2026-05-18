/**
 * B7 (audit closeout) — Safety File service.
 *
 * Responsibilities:
 *   - Auto-seed the default OHSA Safety File items when a PD->PM
 *     handover is accepted (7-day due date per SOP).
 *   - Compute completeness (percentage + traffic light) for the UI
 *     badge, mirroring the B1/B6 pattern.
 *   - Centralise the "can this role approve compliance_status" check.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  safetyFileItems,
  DEFAULT_SAFETY_FILE_SEED,
  type SafetyFileItem,
} from "@shared/schema";
import { db } from "../db";

/**
 * Roles allowed to change a safety_file_items.compliance_status value.
 * Mirrors the B3 HSE incident pattern: HSE_MANAGER plus the top admins.
 */
export const SAFETY_FILE_APPROVER_ROLES = new Set([
  "HSE_MANAGER",
  "COO_ADMIN",
  "CEO_ADMIN",
]);

/**
 * Seed the default 12 OHSA items for a project on PD->PM handover
 * acceptance. Idempotent — uses ON CONFLICT DO NOTHING via the
 * partial unique index uq_safety_file_items_project_item_active.
 *
 * Returns the number of rows inserted (0 if all items already exist).
 */
export async function seedDefaultSafetyFileItems(params: {
  projectId: number;
  handoverAcceptedAt: Date;
  createdByUserId?: number | null;
}): Promise<{ inserted: number; dueDate: string }> {
  // SOP: items must be captured within 7 days of handover acceptance.
  const due = new Date(params.handoverAcceptedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const dueDateIso = due.toISOString().slice(0, 10);

  // Find which item codes already exist for this project (active only).
  const existing = await db
    .select({ itemCode: safetyFileItems.itemCode })
    .from(safetyFileItems)
    .where(
      and(
        eq(safetyFileItems.projectId, params.projectId),
        isNull(safetyFileItems.deletedAt),
      ),
    );
  const existingCodes = new Set((existing as Array<{ itemCode: string }>).map((r) => r.itemCode));

  const toInsert = DEFAULT_SAFETY_FILE_SEED.filter((seed) => !existingCodes.has(seed.itemCode)).map(
    (seed): typeof safetyFileItems.$inferInsert => ({
      projectId: params.projectId,
      itemCode: seed.itemCode,
      itemName: seed.itemName,
      category: seed.category,
      required: true,
      dueDate: dueDateIso,
      complianceStatus: "pending",
      createdByUserId: params.createdByUserId ?? null,
    }),
  );

  if (toInsert.length === 0) {
    return { inserted: 0, dueDate: dueDateIso };
  }

  await db.insert(safetyFileItems).values(toInsert);
  return { inserted: toInsert.length, dueDate: dueDateIso };
}

/**
 * Completeness summary for a project's Safety File. Mirrors B1/B6
 * traffic-light thresholds so the UI badge is consistent across the
 * app.
 *   100      -> green (all required items approved)
 *    80..99  -> amber
 *     0..79  -> red
 * Items with compliance_status='not_applicable' are excluded from the
 * denominator.
 */
export async function getSafetyFileCompleteness(projectId: number): Promise<{
  projectId: number;
  total: number;
  approved: number;
  pending: number;
  submitted: number;
  rejected: number;
  expired: number;
  overdue: number;
  completenessPct: number;
  trafficLight: "green" | "amber" | "red";
  items: SafetyFileItem[];
}> {
  const rowsRaw = await db
    .select()
    .from(safetyFileItems)
    .where(
      and(
        eq(safetyFileItems.projectId, projectId),
        isNull(safetyFileItems.deletedAt),
      ),
    );
  const rows = rowsRaw as SafetyFileItem[];

  const active = rows.filter((r: SafetyFileItem) => r.complianceStatus !== "not_applicable");
  const total = active.length;
  const approved = active.filter((r: SafetyFileItem) => r.complianceStatus === "approved").length;
  const pending = active.filter((r: SafetyFileItem) => r.complianceStatus === "pending").length;
  const submitted = active.filter((r: SafetyFileItem) => r.complianceStatus === "submitted").length;
  const rejected = active.filter((r: SafetyFileItem) => r.complianceStatus === "rejected").length;
  const expired = active.filter((r: SafetyFileItem) => r.complianceStatus === "expired").length;

  // Overdue: past due_date AND not yet approved/not_applicable
  const today = new Date().toISOString().slice(0, 10);
  const overdue = active.filter(
    (r: SafetyFileItem) => r.dueDate && r.dueDate < today && r.complianceStatus !== "approved",
  ).length;

  const completenessPct = total === 0 ? 100 : Math.round((approved / total) * 100);
  const trafficLight: "green" | "amber" | "red" =
    completenessPct >= 100 ? "green" : completenessPct >= 80 ? "amber" : "red";

  return {
    projectId,
    total,
    approved,
    pending,
    submitted,
    rejected,
    expired,
    overdue,
    completenessPct,
    trafficLight,
    items: rows,
  };
}

/**
 * Dashboard query: find overdue Safety File items across ALL projects.
 * Used by the HSE dashboard tile and the nightly alert email.
 */
export async function getOverdueSafetyFileItems(params: {
  limit?: number;
} = {}): Promise<Array<SafetyFileItem & { daysOverdue: number }>> {
  const today = new Date().toISOString().slice(0, 10);
  const rowsRaw = await db
    .select()
    .from(safetyFileItems)
    .where(
      and(
        isNull(safetyFileItems.deletedAt),
        sql`${safetyFileItems.dueDate} IS NOT NULL`,
        sql`${safetyFileItems.dueDate} < ${today}::date`,
        inArray(safetyFileItems.complianceStatus, [
          "pending",
          "submitted",
          "rejected",
          "expired",
        ]),
      ),
    )
    .limit(params.limit ?? 500);
  const rows = rowsRaw as SafetyFileItem[];

  return rows.map((r: SafetyFileItem) => {
    const dueDate = r.dueDate ? new Date(r.dueDate) : null;
    const daysOverdue = dueDate
      ? Math.floor((Date.now() - dueDate.getTime()) / (24 * 60 * 60 * 1000))
      : 0;
    return { ...r, daysOverdue };
  });
}
