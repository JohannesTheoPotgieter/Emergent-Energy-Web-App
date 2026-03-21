/**
 * Inline Edit Helper — replaces the override-table pattern.
 *
 * Instead of storing user edits in separate override tables,
 * edits are applied directly to the base row with:
 *   - source = 'imported_edited'
 *   - import_snapshot = JSONB of original values (for revert)
 *   - last_edited_by = user ID
 *   - last_edited_at = timestamp
 *
 * This module provides helpers for:
 *   1. Editing a base row (with automatic snapshot)
 *   2. Reverting a base row to its imported values
 *   3. Bulk field-level edits (for the old fieldName/overrideValue pattern)
 */

import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";

/**
 * Apply an inline edit to a base table row.
 *
 * If the row hasn't been edited before (source = 'imported'), snapshots
 * the current column values into import_snapshot before applying the edit.
 * If already edited, merges with the existing snapshot (keeping original
 * imported values, not intermediate edits).
 *
 * @param tableName - SQL table name (e.g. 'program_expense')
 * @param rowId - Primary key of the base row
 * @param fields - Object of { columnName: newValue } to apply (snake_case keys)
 * @param userId - ID of the editing user (or null)
 * @param txOrDb - Optional transaction handle
 */
export async function inlineEdit(
  tableName: string,
  rowId: number,
  fields: Record<string, any>,
  userId: number | null,
  txOrDb: any = db,
): Promise<void> {
  // Build the SET clause for the fields being edited
  const fieldEntries = Object.entries(fields).filter(([k]) => k !== 'id');
  if (fieldEntries.length === 0) return;

  // Columns to snapshot (exclude metadata columns)
  const METADATA_COLS = new Set(['id', 'created_at', 'source', 'import_snapshot', 'last_edited_by', 'last_edited_at']);
  const snapshotCols = fieldEntries
    .filter(([k]) => !METADATA_COLS.has(k))
    .map(([k]) => k);

  // Build snapshot expression: only snapshot columns we're about to change,
  // and only if import_snapshot is NULL (first edit preserves original values)
  const snapshotExpr = snapshotCols.length > 0
    ? snapshotCols.map(col => `'${col}', ${col}::text`).join(', ')
    : null;

  // Build SET clauses
  const setClauses = fieldEntries.map(([col, val]) => {
    if (val === null || val === undefined) return `${col} = NULL`;
    if (typeof val === 'boolean') return `${col} = ${val}`;
    if (typeof val === 'number') return `${col} = ${val}`;
    return `${col} = '${String(val).replace(/'/g, "''")}'`;
  });

  setClauses.push(`source = 'imported_edited'`);
  setClauses.push(`last_edited_at = NOW()`);
  setClauses.push(`updated_at = NOW()`);
  if (userId != null) {
    setClauses.push(`last_edited_by = ${userId}`);
  }

  // Snapshot: merge new field snapshots into existing snapshot (if any),
  // but only for fields not already in the snapshot (preserve original values)
  if (snapshotExpr) {
    setClauses.push(
      `import_snapshot = COALESCE(import_snapshot, '{}'::jsonb) || (
        SELECT jsonb_object_agg(k, v) FROM (
          SELECT k, v FROM jsonb_each_text(jsonb_build_object(${snapshotExpr})) AS x(k, v)
          WHERE k NOT IN (SELECT jsonb_object_keys(COALESCE(${tableName}.import_snapshot, '{}'::jsonb)))
        ) sub
      )`
    );
  }

  await txOrDb.execute(sql.raw(
    `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = ${rowId}`
  ));
}

/**
 * Revert a base row to its original imported values.
 *
 * Restores all fields from import_snapshot, sets source = 'imported',
 * and clears the snapshot/edit metadata.
 *
 * @param tableName - SQL table name
 * @param rowId - Primary key of the base row
 * @param txOrDb - Optional transaction handle
 * @returns true if reverted, false if no snapshot existed
 */
export async function revertToImported(
  tableName: string,
  rowId: number,
  txOrDb: any = db,
): Promise<boolean> {
  // Check if row has a snapshot to revert from
  const result = await txOrDb.execute(sql.raw(
    `SELECT import_snapshot FROM ${tableName} WHERE id = ${rowId}`
  ));
  const rows = result.rows as any[];
  if (!rows[0]?.import_snapshot) return false;

  let snapshot: Record<string, any>;
  try {
    snapshot = typeof rows[0].import_snapshot === 'string'
      ? JSON.parse(rows[0].import_snapshot)
      : rows[0].import_snapshot;
  } catch {
    console.error(`[inline-edit] Corrupted import_snapshot JSON for ${tableName} row ${rowId}`);
    return false;
  }

  // Build SET clauses from snapshot
  const setClauses = Object.entries(snapshot)
    .filter(([k]) => !k.startsWith('_')) // skip internal flags like _cos_status_migrated
    .map(([col, val]) => {
      if (val === null || val === undefined) return `${col} = NULL`;
      return `${col} = '${String(val).replace(/'/g, "''")}'`;
    });

  setClauses.push(`source = 'imported'`);
  setClauses.push(`import_snapshot = NULL`);
  setClauses.push(`last_edited_by = NULL`);
  setClauses.push(`last_edited_at = NULL`);

  await txOrDb.execute(sql.raw(
    `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = ${rowId}`
  ));
  return true;
}

/**
 * Apply field-level overrides to a base row.
 * This replaces the old pattern of storing (fieldName, overrideValue) pairs
 * in override tables. Converts camelCase field names to snake_case.
 *
 * @param tableName - SQL table name
 * @param rowId - Primary key of the base row
 * @param overrides - Array of { fieldName, overrideValue } pairs
 * @param userId - ID of the editing user
 * @param txOrDb - Optional transaction handle
 */
export async function applyFieldOverrides(
  tableName: string,
  rowId: number,
  overrides: Array<{ fieldName: string; overrideValue: string | null }>,
  userId: number | null,
  txOrDb: any = db,
): Promise<void> {
  if (overrides.length === 0) return;

  const fields: Record<string, any> = {};
  for (const { fieldName, overrideValue } of overrides) {
    const snakeCol = camelToSnake(fieldName);
    fields[snakeCol] = overrideValue === '__null__' ? null : overrideValue;
  }

  await inlineEdit(tableName, rowId, fields, userId, txOrDb);
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
