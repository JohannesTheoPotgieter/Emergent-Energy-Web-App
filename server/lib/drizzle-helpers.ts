/**
 * Drizzle ORM typing helpers.
 *
 * Drizzle's `inArray(column, values)` requires the values array type to
 * exactly match the column type.  When the array comes from a `.map()` or
 * `.filter()` chain, TypeScript often infers `unknown[]` or a union that
 * doesn't satisfy the overload.  These helpers provide a safe narrowing
 * pattern so call sites don't need individual casts.
 */

import { db, getDbMode } from "../db";

/**
 * Narrow an array to `number[]`, filtering out non-finite values.
 * Use when building an array for `inArray(column, ids)` where column is integer.
 */
export function toNumberArray(values: unknown[]): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

/**
 * Narrow an array to `string[]`, filtering out non-string values.
 * Use when building an array for `inArray(column, values)` where column is text.
 */
export function toStringArray(values: unknown[]): string[] {
  return values.filter((v): v is string => typeof v === "string");
}

/**
 * Cross-driver transaction helper.
 *
 * `db.transaction(async (tx) => …)` works fine on Postgres (`node-postgres`)
 * but the SQLite dev/test fallback uses `better-sqlite3`, which refuses an
 * async callback with "Transaction function cannot return a promise".
 *
 * In production we run Postgres so the transaction guarantees hold. In
 * SQLite test runs we skip the wrapping and pass the module-level `db` as
 * the "tx" — losing atomicity but letting the write path run end-to-end
 * so integration tests can exercise it. Callers MUST treat this as a
 * best-effort guarantee in non-Postgres environments.
 */
let sqliteTransactionDowngradeWarned = false;

export async function runInTransaction<T>(
  work: (tx: typeof db) => Promise<T>,
): Promise<T> {
  if (getDbMode() === "sqlite") {
    if (!sqliteTransactionDowngradeWarned) {
      sqliteTransactionDowngradeWarned = true;
      console.warn(
        "[runInTransaction] SQLite mode — writes run WITHOUT transactional " +
        "atomicity. This is dev/test only (NODE_ENV !== 'production' is " +
        "enforced at db.ts). Production Postgres still gets full " +
        "rollback-on-failure semantics.",
      );
    }
    // better-sqlite3 rejects async transaction bodies, so run the writes
    // directly. NODE_ENV !== "production" guards us at db.ts:296.
    return work(db);
  }
  return db.transaction(async (tx: typeof db) => work(tx));
}
