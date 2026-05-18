import { eq, getTableColumns, isNull, not, SQL } from "drizzle-orm";
import type { Column } from "drizzle-orm";
import { timestamp, integer, text } from "drizzle-orm/pg-core";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SoftDeleteTable = {
  deletedAt: Column;
};

export type FullSoftDeleteTable = SoftDeleteTable & {
  deletedBy?: Column;
  deleteReason?: Column;
  restoredAt?: Column;
  restoredBy?: Column;
};

/**
 * Values that may be written when soft-deleting / restoring a row:
 * timestamps, the actor's user id, a freeform reason, or the isActive flag.
 */
type SoftDeleteSetValue = Date | number | string | boolean | null;
type SoftDeleteSetFields = Record<string, SoftDeleteSetValue>;

/**
 * Minimal structural view of the Drizzle database client used by the
 * mutation helpers below. `shared/` is dialect-agnostic (node-postgres in
 * prod, better-sqlite3 in the dev fallback), so we describe exactly the
 * update-builder chain these helpers rely on rather than importing a
 * concrete server-side database type.
 */
export interface SoftDeleteDb {
  update(table: PgTable): {
    set(values: SoftDeleteSetFields): {
      where(condition: SQL): {
        returning(): Promise<unknown[]>;
      };
    };
  };
}

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
  isNull(table.deletedAt);

/** Filter for deleted rows only (admin/recovery views). */
export const onlyDeleted = <T extends SoftDeleteTable>(table: T): SQL => {
  const { deletedAt } = table;
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
  db: SoftDeleteDb,
  table: T,
  id: number,
  userId?: number | null,
  reason?: string | null,
) {
  const now = new Date();
  const setFields: SoftDeleteSetFields = { deletedAt: now };
  if (userId != null) setFields.deletedBy = userId;
  if (reason) setFields.deleteReason = reason;

  const tableColumns = getTableColumns(table);

  // Also sync isActive to false if the table has it
  if (tableColumns.isActive) {
    setFields.isActive = false;
  }

  return db
    .update(table)
    .set(setFields)
    .where(eq(tableColumns.id as PgColumn, id))
    .returning();
}

/**
 * Restore a soft-deleted record.
 *
 * @example
 *   await applySoftRestore(db, approvals, id, userId);
 */
export function applySoftRestore<T extends PgTable>(
  db: SoftDeleteDb,
  table: T,
  id: number,
  userId?: number | null,
) {
  const now = new Date();
  const setFields: SoftDeleteSetFields = {
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    restoredAt: now,
  };
  if (userId != null) setFields.restoredBy = userId;

  const tableColumns = getTableColumns(table);

  // Sync isActive to true if the table has it
  if (tableColumns.isActive) {
    setFields.isActive = true;
  }

  return db
    .update(table)
    .set(setFields)
    .where(eq(tableColumns.id as PgColumn, id))
    .returning();
}
