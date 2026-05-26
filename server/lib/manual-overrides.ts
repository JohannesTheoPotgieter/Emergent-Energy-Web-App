/**
 * Manual-overrides helper — write side for the cell-edit invariant.
 *
 * Workstream B introduces the rule "live column = Excel". Cell edits
 * on the operational tabs MUST stop writing to the canonical row's
 * value columns; they write to `manual_overrides` JSONB instead. The
 * import engine (`server/lib/import/merge-engine.ts:updateManualOverrides`)
 * already manages the same JSONB column on conflict resolution; this
 * module is the cell-edit-side equivalent so non-import code paths
 * write entries with identical shape.
 *
 * The shape is validated by `manualOverrideEntrySchema` from
 * `shared/excel-vs-app/contract.ts` so a divergence between the
 * import-engine writer and this writer is caught at write time.
 *
 * What this module does NOT do:
 *   - Touch the canonical row's live column. The whole point is that
 *     the live column stays Excel-truth.
 *   - Audit-log into `audit_log` directly. Callers who need an audit
 *     row create it themselves (the operational-tab handlers already
 *     write to `financial_edit_requests`); this module is a primitive.
 *   - Apply RBAC. Callers gate the route with `requirePermission`
 *     before reaching this helper.
 *
 * See also:
 *   - docs/excel-vs-app-diff-plan.md § B.8–B.9
 *   - docs/excel-vs-app-workstream-b-impl.md § Commit 2
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, getDbMode } from "../db";
import { runInTransaction } from "./drizzle-helpers";
import { normalizedCostLines, normalizedRevenueLines } from "@shared/schema/finance";
import { workItems } from "@shared/schema/tasks";
import {
  manualOverrideEntrySchema,
  type ManualOverrideEntry,
  type ManualOverridesMap,
} from "@shared/excel-vs-app/contract";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OverrideTableName =
  | "normalized_cost_lines"
  | "normalized_revenue_lines"
  | "work_items";

export type OverrideValue = ManualOverrideEntry["value"];

export interface ApplyManualOverrideInput {
  /** Canonical table the override targets. */
  table: OverrideTableName;
  /** Primary key of the row on that table. */
  rowId: number;
  /** Canonical field name (camelCase). MUST be a tracked field for the
   *  table's section — callers are responsible for that check; the
   *  helper does not validate against the contract's tracked-field
   *  list because some flows (e.g. ad-hoc admin overrides) intentionally
   *  set non-tracked fields. */
  fieldName: string;
  /** The operator's chosen value. `undefined` is normalised to `null`
   *  at the boundary (JSONB has no `undefined` semantics). */
  value: OverrideValue | undefined;
  /** Session user id, or null for system-applied overrides. */
  editedBy: number | null;
  /** Optional operator-supplied reason (Keep app + reason flow). */
  note?: string;
}

interface RowWithOverrides {
  id: number;
  manualOverrides: unknown;
  [field: string]: unknown;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

export function readOverridesMap(raw: unknown): ManualOverridesMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as ManualOverridesMap;
}

function toJson(v: OverrideValue | undefined): OverrideValue {
  return v === undefined ? null : v;
}

// Per-table dispatch — Drizzle's QueryBuilder is too strictly typed
// to accept a union of table refs. Each branch keeps its narrow type
// so we don't need an `as any` cast on the select / update chain.
async function fetchRowDispatch(
  tx: typeof db,
  table: OverrideTableName,
  rowId: number,
  options: { forUpdate?: boolean } = {},
): Promise<RowWithOverrides | null> {
  // Snapshot + soft-delete guard on both read and write. A stale rowId
  // referring to a since-replaced historical row would otherwise return
  // (and the writer below would mutate) the wrong record.
  // forUpdate locks the row for the surrounding transaction so two
  // concurrent applyManualOverride callers can't both compute their
  // next-map from the same stale snapshot and overwrite each other.
  // SQLite ignores .for("update") (no row-level locks); the wrapping
  // transaction is the only protection there. Production Postgres uses
  // the lock + the transaction together.
  if (table === "normalized_cost_lines") {
    const q = tx.select().from(normalizedCostLines).where(and(
      eq(normalizedCostLines.id, rowId),
      isNull(normalizedCostLines.effectiveTo),
      isNull(normalizedCostLines.deletedAt),
    )).limit(1);
    const [row] = options.forUpdate && getDbMode() === "postgres" ? await q.for("update") : await q;
    return (row ?? null) as RowWithOverrides | null;
  }
  if (table === "normalized_revenue_lines") {
    const q = tx.select().from(normalizedRevenueLines).where(and(
      eq(normalizedRevenueLines.id, rowId),
      isNull(normalizedRevenueLines.effectiveTo),
      isNull(normalizedRevenueLines.deletedAt),
    )).limit(1);
    const [row] = options.forUpdate && getDbMode() === "postgres" ? await q.for("update") : await q;
    return (row ?? null) as RowWithOverrides | null;
  }
  const q = tx.select().from(workItems).where(eq(workItems.id, rowId)).limit(1);
  const [row] = options.forUpdate && getDbMode() === "postgres" ? await q.for("update") : await q;
  return (row ?? null) as RowWithOverrides | null;
}

async function writeOverridesDispatch(
  tx: typeof db,
  table: OverrideTableName,
  rowId: number,
  next: ManualOverridesMap,
): Promise<void> {
  if (table === "normalized_cost_lines") {
    await tx.update(normalizedCostLines).set({ manualOverrides: next }).where(and(
      eq(normalizedCostLines.id, rowId),
      isNull(normalizedCostLines.effectiveTo),
      isNull(normalizedCostLines.deletedAt),
    ));
    return;
  }
  if (table === "normalized_revenue_lines") {
    await tx.update(normalizedRevenueLines).set({ manualOverrides: next }).where(and(
      eq(normalizedRevenueLines.id, rowId),
      isNull(normalizedRevenueLines.effectiveTo),
      isNull(normalizedRevenueLines.deletedAt),
    ));
    return;
  }
  await tx.update(workItems).set({ manualOverrides: next }).where(eq(workItems.id, rowId));
}

// ---------------------------------------------------------------------------
// Pure field-merge logic — exposed for unit tests
// ---------------------------------------------------------------------------

/**
 * Compute the next `manual_overrides` map after upserting an entry
 * for a field. Pure function — no DB, no clock dependency apart from
 * the `now` parameter.
 *
 * Behaviour:
 *   - First override on the field: seed `fromValue` from `liveValue`.
 *   - Subsequent override: PRESERVE the original `fromValue`, refresh
 *     `value` / `editedAt` / `editedBy` / `note`.
 *   - Coerces `undefined` → `null` at the boundary (JSONB has no
 *     `undefined` semantics).
 *   - Validates the constructed entry through the contract schema;
 *     throws on shape drift.
 */
export function buildOverrideMap(
  current: ManualOverridesMap,
  fieldName: string,
  value: OverrideValue | undefined,
  liveValue: OverrideValue | undefined,
  editedBy: number | null,
  now: Date,
  note?: string,
): ManualOverridesMap {
  const existing = current[fieldName];
  const fromValue = existing ? existing.fromValue : toJson(liveValue);

  const entry: ManualOverrideEntry = manualOverrideEntrySchema.parse({
    value: toJson(value),
    editedBy,
    editedAt: now.toISOString(),
    fromValue,
    ...(note !== undefined ? { note } : {}),
  });

  return { ...current, [fieldName]: entry };
}

/**
 * Compute the next `manual_overrides` map after removing a field's
 * entry. No-op when the field has no entry.
 */
export function removeOverrideFromMap(
  current: ManualOverridesMap,
  fieldName: string,
): ManualOverridesMap {
  if (!(fieldName in current)) return current;
  const next = { ...current };
  delete next[fieldName];
  return next;
}

async function fetchRow(
  tx: typeof db,
  table: OverrideTableName,
  rowId: number,
  options: { forUpdate?: boolean } = {},
): Promise<RowWithOverrides | null> {
  return fetchRowDispatch(tx, table, rowId, options);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upsert a `manual_overrides[fieldName]` entry on a canonical row.
 * Live column is NOT touched.
 *
 * Behaviour:
 *   - If no entry for the field exists, create one with
 *     `fromValue = row[fieldName]` (the current Excel-truth value).
 *   - If an entry already exists, update `value` / `editedAt` /
 *     `editedBy` / `note`, but PRESERVE the original `fromValue`. This
 *     guarantees a future "Reset to Excel" affordance can recover the
 *     pre-override value.
 *   - The constructed entry is parsed through
 *     `manualOverrideEntrySchema` before write, so any drift between
 *     this writer and the import engine's writer is caught here.
 *
 * Throws on:
 *   - Unknown row id (no matching row on the canonical table).
 *   - Schema-parse failure (would indicate a bug in the caller's
 *     input or an out-of-date contract).
 */
export async function applyManualOverride(
  input: ApplyManualOverrideInput,
  tx: typeof db = db,
): Promise<void> {
  // Concurrency: two operators racing to set DIFFERENT fields on the
  // same row would otherwise lose-write each other's entry because each
  // reads the OLD manual_overrides map, merges its own field, and
  // writes the resulting map. Last write wins, sibling fields gone.
  // Fix: when the caller didn't pass a tx, wrap the read+write in a
  // single transaction with SELECT FOR UPDATE on the row so the second
  // caller blocks until the first commits and then reads the just-
  // updated map. Caller-supplied tx case keeps existing semantics —
  // the caller is assumed to be already holding the lock.
  const isOuterCall = tx === db;
  if (isOuterCall) {
    return runInTransaction(async (innerTx) => {
      await applyManualOverrideInner(input, innerTx, true);
    });
  }
  await applyManualOverrideInner(input, tx, false);
}

async function applyManualOverrideInner(
  input: ApplyManualOverrideInput,
  tx: typeof db,
  withLock: boolean,
): Promise<void> {
  const row = await fetchRow(tx, input.table, input.rowId, { forUpdate: withLock });
  if (!row) {
    throw new Error(
      `[manual-overrides] row ${input.rowId} not found in ${input.table}`,
    );
  }

  const current = readOverridesMap(row.manualOverrides);
  const liveValue = row[input.fieldName] as OverrideValue | undefined;
  const next = buildOverrideMap(
    current,
    input.fieldName,
    input.value,
    liveValue,
    input.editedBy,
    new Date(),
    input.note,
  );

  await writeOverridesDispatch(tx, input.table, input.rowId, next);

  // Structured log line — observability for "how often is the cell-edit
  // path firing vs the import path". One JSON line per write.
  console.log(JSON.stringify({
    tag: "manual-overrides",
    op: "apply",
    table: input.table,
    rowId: input.rowId,
    field: input.fieldName,
    editedBy: input.editedBy,
    fromValue: next[input.fieldName].fromValue ?? null,
    toValue: next[input.fieldName].value ?? null,
    hadPrior: input.fieldName in current,
    note: input.note ?? null,
    source: "cell-edit",
  }));
}

/**
 * Remove a `manual_overrides[fieldName]` entry from a canonical row.
 * Live column is NOT touched — because we never wrote to it, the row
 * automatically reverts to Excel-truth on the next read.
 *
 * No-op when:
 *   - The row doesn't exist (silent — used by best-effort cleanup).
 *   - The field has no override entry.
 */
export async function clearManualOverride(
  table: OverrideTableName,
  rowId: number,
  fieldName: string,
  tx: typeof db = db,
): Promise<void> {
  const row = await fetchRow(tx, table, rowId);
  if (!row) return;

  const current = readOverridesMap(row.manualOverrides);
  const next = removeOverrideFromMap(current, fieldName);
  if (next === current) return;

  await writeOverridesDispatch(tx, table, rowId, next);

  console.log(JSON.stringify({
    tag: "manual-overrides",
    op: "clear",
    table,
    rowId,
    field: fieldName,
    clearedValue: current[fieldName]?.value ?? null,
    source: "cell-edit",
  }));
}

/**
 * Read the current `manual_overrides` map for a canonical row. Returns
 * an empty map for rows with no entries yet (or a missing row), so
 * callers can spread/iterate without null-checking.
 */
export async function getManualOverrides(
  table: OverrideTableName,
  rowId: number,
  tx: typeof db = db,
): Promise<ManualOverridesMap> {
  const row = await fetchRow(tx, table, rowId);
  if (!row) return {};
  return readOverridesMap(row.manualOverrides);
}

// ---------------------------------------------------------------------------
// Read-side overlay
// ---------------------------------------------------------------------------
//
// Operational tabs render the operator's chosen value when an override
// exists, and the live column otherwise. Replica routes and reporting
// queries continue to read the live column raw — the overlay is a
// presentation concern for the cell-edit surface only.
//
// Pure function, no DB. Callers (e.g. the cost / revenue / plan tab
// route handlers) call this on each row they return to the client.

/**
 * Return a shallow clone of `row` with override values overlaid on
 * the listed fields. For each field in `fields`:
 *   - If `row.manualOverrides[field]` exists, the returned row has
 *     `row[field]` replaced by the override's `value`.
 *   - Otherwise the field is left at its live (Excel-truth) value.
 *
 * The `manualOverrides` JSONB column on the input is preserved in the
 * output untouched, so the client can also surface override metadata
 * (editor, timestamp, original value) when it wants to.
 *
 * Type parameter `T` lets the caller keep its specific row shape; the
 * overlay only changes the values of the listed string-keyed fields.
 */
export function withOverridesOverlay<T extends { manualOverrides?: unknown }>(
  row: T,
  fields: readonly string[],
): T {
  const overrides = readOverridesMap(row.manualOverrides);
  if (Object.keys(overrides).length === 0) return row;
  const out = { ...row } as Record<string, unknown>;
  for (const f of fields) {
    const entry = overrides[f];
    if (entry) {
      out[f] = entry.value;
    }
  }
  return out as T;
}

/** Convenience: apply `withOverridesOverlay` over an array. */
export function applyOverridesOverlay<T extends { manualOverrides?: unknown }>(
  rows: T[],
  fields: readonly string[],
): T[] {
  return rows.map(r => withOverridesOverlay(r, fields));
}

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------
//
// `USE_MANUAL_OVERRIDES=false` disables the cell-edit-side override path:
//   - Cell-edit handlers continue writing to the live column (legacy
//     behaviour).
//   - Read overlay is bypassed (the live column is what the operator
//     edited, so no overlay needed).
//
// Default ON — graceful degradation is already designed.

export function manualOverridesEnabled(): boolean {
  return process.env.USE_MANUAL_OVERRIDES !== "false";
}
