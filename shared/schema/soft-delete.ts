import { eq, isNull, not, and, SQL } from "drizzle-orm";
import { timestamp, integer, text } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SoftDeleteTable = {
  deletedAt: unknown;
};

export type FullSoftDeleteTable = SoftDeleteTable & {
  deletedBy?: unknown;
  deleteReason?: unknown;
  restoredAt?: unknown;
  restoredBy?: unknown;
};

// ─── Column Definitions (reuse when adding soft-delete to tables) ────────────

/**
 * Standard soft-delete column set.
 * Usage in a pgTable definition:
 *   ...softDeleteColumns,
 */
export const softDeleteColumns = {
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
};

/**
 * Extended soft-delete columns with reason and restore tracking.
 */
export const softDeleteColumnsExtended = {
  ...softDeleteColumns,
  deleteReason: text("delete_reason"),
  restoredAt: timestamp("restored_at"),
  restoredBy: integer("restored_by"),
};

// ─── Query Helpers ───────────────────────────────────────────────────────────

/** Filter for non-deleted rows. Use in .where() clauses. */
export const notDeleted = <T extends SoftDeleteTable>(table: T): SQL =>
  isNull(table.deletedAt as any);

/** Filter for deleted rows only (admin/recovery views). */
export const onlyDeleted = <T extends SoftDeleteTable>(table: T): SQL => {
  const { deletedAt } = table as any;
  // isNotNull equivalent
  return not(isNull(deletedAt));
};

// ─── Mutation Helpers ────────────────────────────────────────────────────────

/**
 * Soft-delete a record by setting deletedAt (and optionally deletedBy / deleteReason).
 * Returns the Drizzle update builder — caller should await it.
 *
 * @example
 *   await applySoftDelete(db, approvals, id, userId, "Duplicate record");
 */
export function applySoftDelete<T extends PgTable>(
  db: any,
  table: T,
  id: number,
  userId?: number | null,
  reason?: string | null,
) {
  const now = new Date();
  const setFields: Record<string, any> = { deletedAt: now };
  if (userId != null) setFields.deletedBy = userId;
  if (reason) setFields.deleteReason = reason;

  // Also sync isActive to false if the table has it
  const tableColumns = (table as any)[Symbol.for("drizzle:Columns")] ?? (table as any)._.columns ?? {};
  if (tableColumns.isActive) {
    setFields.isActive = false;
  }

  return db
    .update(table)
    .set(setFields)
    .where(eq((table as any).id, id))
    .returning();
}

/**
 * Restore a soft-deleted record.
 *
 * @example
 *   await applySoftRestore(db, approvals, id, userId);
 */
export function applySoftRestore<T extends PgTable>(
  db: any,
  table: T,
  id: number,
  userId?: number | null,
) {
  const now = new Date();
  const setFields: Record<string, any> = {
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    restoredAt: now,
  };
  if (userId != null) setFields.restoredBy = userId;

  // Sync isActive to true if the table has it
  const tableColumns = (table as any)[Symbol.for("drizzle:Columns")] ?? (table as any)._.columns ?? {};
  if (tableColumns.isActive) {
    setFields.isActive = true;
  }

  return db
    .update(table)
    .set(setFields)
    .where(eq((table as any).id, id))
    .returning();
}
