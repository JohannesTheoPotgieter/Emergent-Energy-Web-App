/**
 * Excel-vs-App bulk-resolve helpers.
 *
 * Background: the original resolve route processed each (table, rowId,
 * fieldName) entry serially with 3-4 separate round-trips per entry,
 * all wrapped in ONE giant transaction. A bulk submit of a few thousand
 * fields blew past Neon's per-query read timeout and the whole tx
 * rolled back ("Failed query: rollback, cause: Query read timeout").
 *
 * This module collapses N field operations on the same row into a
 * single read + single write. The caller (the resolve route) groups
 * entries by `(table, rowId)` and chunks the row-groups into smaller
 * transactions so each commit stays well under any per-query timeout.
 *
 * No live columns are mutated — the invariant "live column = Excel"
 * still holds (see `manual-overrides.ts` header).
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { normalizedCostLines, normalizedRevenueLines } from "@shared/schema/finance";
import { workItems } from "@shared/schema/tasks";
import {
  buildOverrideMap,
  removeOverrideFromMap,
  readOverridesMap,
  type OverrideTableName,
  type OverrideValue,
} from "./manual-overrides";
import type { ManualOverridesMap } from "@shared/excel-vs-app/contract";

// ---------------------------------------------------------------------------
// Internal table dispatch
// ---------------------------------------------------------------------------

function tableRef(table: OverrideTableName) {
  if (table === "normalized_cost_lines") return normalizedCostLines;
  if (table === "normalized_revenue_lines") return normalizedRevenueLines;
  return workItems;
}

interface RowState {
  manualOverrides: ManualOverridesMap;
  importSnapshot: Record<string, unknown>;
  /** Live values for the requested fields, pre-read from the row. */
  fieldLive: Record<string, unknown>;
}

async function readRow(
  tx: typeof db,
  table: OverrideTableName,
  rowId: number,
  fieldNames: readonly string[],
): Promise<RowState | null> {
  const ref = tableRef(table);
  // We read SELECT * because tracked field names are dynamic strings.
  // Drizzle's typed-column path doesn't support that; the column set
  // for these tables is small enough that the row weight is fine.
  // Snapshot + soft-delete guard. A stale rowId from a since-replaced
  // line would otherwise return the historical row, and the follow-on
  // UPDATE in bulkAcceptExcelForRow / bulkKeepAppForRow would mutate it.
  const [row] = await (tx as typeof db)
    .select()
    .from(ref as any)
    .where(and(
      eq((ref as any).id, rowId),
      isNull((ref as any).effectiveTo),
      isNull((ref as any).deletedAt),
    ))
    .limit(1);
  if (!row) return null;
  const r = row as Record<string, unknown>;
  const fieldLive: Record<string, unknown> = {};
  for (const f of fieldNames) fieldLive[f] = r[f] ?? null;
  const snap = r.importSnapshot;
  return {
    manualOverrides: readOverridesMap(r.manualOverrides),
    importSnapshot: snap && typeof snap === "object" && !Array.isArray(snap)
      ? { ...(snap as Record<string, unknown>) }
      : {},
    fieldLive,
  };
}

// ---------------------------------------------------------------------------
// Per-row bulk operations
// ---------------------------------------------------------------------------

export interface KeepAppFieldOp {
  fieldName: string;
  reason: string;
  editedBy: number | null;
}

export interface KeepAppRowOp {
  table: OverrideTableName;
  rowId: number;
  fields: KeepAppFieldOp[];
}

export interface KeepAppFieldResult {
  fieldName: string;
  liveValue: OverrideValue | null;
}

/**
 * Apply N "Keep my value" overrides to a single row in 1 read + 1 write.
 * The override `value` is set to the row's live (Excel-truth) value for
 * each field, with the operator's reason recorded as `note`.
 *
 * Throws if the row is missing — the caller should treat that as a
 * per-row failure and continue with the rest of the chunk.
 */
export async function bulkKeepAppForRow(
  tx: typeof db,
  op: KeepAppRowOp,
): Promise<KeepAppFieldResult[]> {
  const fieldNames = op.fields.map((f) => f.fieldName);
  const state = await readRow(tx, op.table, op.rowId, fieldNames);
  if (!state) {
    throw new Error(`row ${op.rowId} not found in ${op.table}`);
  }
  const now = new Date();
  let next: ManualOverridesMap = state.manualOverrides;
  const results: KeepAppFieldResult[] = [];
  for (const f of op.fields) {
    const live = state.fieldLive[f.fieldName] as OverrideValue | undefined;
    next = buildOverrideMap(next, f.fieldName, live, live, f.editedBy, now, f.reason);
    results.push({ fieldName: f.fieldName, liveValue: (live ?? null) as OverrideValue | null });
  }
  const ref = tableRef(op.table);
  await (tx as typeof db)
    .update(ref as any)
    .set({ manualOverrides: next })
    .where(and(
      eq((ref as any).id, op.rowId),
      isNull((ref as any).effectiveTo),
      isNull((ref as any).deletedAt),
    ));
  return results;
}

export interface AcceptExcelRowOp {
  table: OverrideTableName;
  rowId: number;
  fields: string[];
}

export interface AcceptExcelFieldResult {
  fieldName: string;
  beforeOverride: OverrideValue | null;
  liveValue: OverrideValue | null;
}

/**
 * Apply N "Use workbook value" resolutions to a single row in 1 read +
 * 1 write. Per field:
 *   - the manual_overrides[fieldName] entry is removed (so the row
 *     re-reverts to Excel-truth), and
 *   - import_snapshot[fieldName] is patched to the current live value
 *     when those disagreed (so the row is no longer flagged as drift).
 */
export async function bulkAcceptExcelForRow(
  tx: typeof db,
  op: AcceptExcelRowOp,
): Promise<AcceptExcelFieldResult[]> {
  const state = await readRow(tx, op.table, op.rowId, op.fields);
  if (!state) {
    throw new Error(`row ${op.rowId} not found in ${op.table}`);
  }
  let nextOverrides: ManualOverridesMap = state.manualOverrides;
  const nextSnapshot = { ...state.importSnapshot };
  const results: AcceptExcelFieldResult[] = [];
  let snapshotChanged = false;
  let overridesChanged = false;
  for (const fieldName of op.fields) {
    const before = nextOverrides[fieldName];
    const beforeValue: OverrideValue | null =
      before && typeof before === "object" && "value" in before
        ? ((before as { value: OverrideValue }).value ?? null)
        : null;
    const reduced = removeOverrideFromMap(nextOverrides, fieldName);
    if (reduced !== nextOverrides) {
      nextOverrides = reduced;
      overridesChanged = true;
    }
    const live = (state.fieldLive[fieldName] ?? null) as OverrideValue | null;
    const snap = (nextSnapshot[fieldName] ?? null) as OverrideValue | null;
    if (snap !== live) {
      nextSnapshot[fieldName] = live;
      snapshotChanged = true;
    }
    results.push({ fieldName, beforeOverride: beforeValue, liveValue: live });
  }
  if (overridesChanged || snapshotChanged) {
    const ref = tableRef(op.table);
    const update: Record<string, unknown> = {};
    if (overridesChanged) update.manualOverrides = nextOverrides;
    if (snapshotChanged) update.importSnapshot = nextSnapshot;
    await (tx as typeof db).update(ref as any).set(update as any).where(and(
      eq((ref as any).id, op.rowId),
      isNull((ref as any).effectiveTo),
      isNull((ref as any).deletedAt),
    ));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Grouping + chunking + concurrency primitives
// ---------------------------------------------------------------------------

/**
 * Group flat (table, rowId, fieldName, ...extra) entries by composite
 * row key so we can do 1 read + 1 write per row instead of per field.
 * Order is preserved within each group.
 */
export function groupByRow<E extends { table: OverrideTableName; rowId: number }>(
  entries: E[],
): Map<string, { table: OverrideTableName; rowId: number; entries: E[] }> {
  const out = new Map<string, { table: OverrideTableName; rowId: number; entries: E[] }>();
  for (const e of entries) {
    const key = `${e.table}::${e.rowId}`;
    let bucket = out.get(key);
    if (!bucket) {
      bucket = { table: e.table, rowId: e.rowId, entries: [] };
      out.set(key, bucket);
    }
    bucket.entries.push(e);
  }
  return out;
}

export function chunk<T>(arr: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Run an async mapper over `items` with bounded concurrency.
 * Returns results in input order. Failures are captured per-item via
 * the mapper's own try/catch — this primitive does not swallow errors.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await mapper(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Tunables — exported so tests / ops can adjust without redeploy.
// ---------------------------------------------------------------------------

/** Rows per database transaction. Each tx commits independently so a
 *  partial bulk submit can never block on an oversized commit. */
export const RESOLVE_CHUNK_ROWS = 50;

/** Concurrent transactions in flight. Bounded to keep Neon connection
 *  pressure low on bulk submits. */
export const RESOLVE_CHUNK_CONCURRENCY = 3;
