/**
 * Dual-write helper for project_info split.
 *
 * During migration, columns exist in BOTH project_info AND the new
 * project_execution_state / project_settings tables. This module
 * provides helpers to keep both in sync when writing.
 *
 * After all reads are migrated to the new tables, the dual-write
 * and the redundant columns in project_info can be removed.
 */

import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "../db";
import {
  projectExecutionState,
  projectSettings,
} from "@shared/schema";

/**
 * Minimal structural surface of the Drizzle db / transaction object used by
 * the dual-write helpers. The concrete db handle is typed `any` at its
 * source (`server/db.ts`); this narrows it to the upsert builder chain
 * touched here without widening back to `any`.
 */
interface SplitWriteTx {
  insert(table: PgTable): {
    values(values: Record<string, unknown>): {
      onConflictDoUpdate(config: {
        target: unknown;
        set: Record<string, unknown>;
      }): Promise<unknown>;
      onConflictDoNothing(): Promise<unknown>;
    };
  };
}

// Columns that belong to project_execution_state
const EXECUTION_STATE_COLUMNS = new Set([
  "phase",
  "phaseUpdatedAt",
  "phaseUpdatedByUserId",
  "phaseNotes",
  "pdHandoverDate",
  "constructionStartDate",
  "commissioningDate",
  "omHandoverDate",
  "clientHandoverDate",
  "constructionStartActual",
  "pdHandoverActual",
  "commissioningActual",
  "clientHandoverActual",
  "practicalCompletionTarget",
  "practicalCompletionActual",
  "escalationLevel",
  "ragStatus",
  "ragComment",
  "ragUpdatedAt",
  "ragUpdatedByUserId",
  "isActive",
  "archivedStatus",
  "executionEnabled",
  "executionGateStatus",
  "executionGateReason",
  "executionPhase",
  "signedStatus",
  "signedDate",
  "signedDocumentLink",
  "cpSigned",
  "cpSignedDate",
  "cpSignedByUserId",
  "cpEvidenceType",
  "cpEvidenceRef",
  "pmTaskPackCreated",
  "engPostCpTaskPackCreated",
]);

// Columns that belong to project_settings
const SETTINGS_COLUMNS = new Set([
  "excelTrackerLink",
]);

/**
 * Given a flat update object destined for project_info, extract
 * the subset that belongs to project_execution_state.
 */
function extractExecutionStateFields(fields: Record<string, unknown>): Record<string, unknown> | null {
  const extracted: Record<string, unknown> = {};
  let hasFields = false;
  for (const key of Object.keys(fields)) {
    if (EXECUTION_STATE_COLUMNS.has(key)) {
      extracted[key] = fields[key];
      hasFields = true;
    }
  }
  return hasFields ? extracted : null;
}

/**
 * Given a flat update object destined for project_info, extract
 * the subset that belongs to project_settings.
 */
function extractSettingsFields(fields: Record<string, unknown>): Record<string, unknown> | null {
  const extracted: Record<string, unknown> = {};
  let hasFields = false;
  for (const key of Object.keys(fields)) {
    if (SETTINGS_COLUMNS.has(key)) {
      extracted[key] = fields[key];
      hasFields = true;
    }
  }
  return hasFields ? extracted : null;
}

/**
 * Sync execution-state and settings columns to the new tables
 * after an update to project_info. Call this AFTER the primary
 * project_info update within the same transaction (or immediately after).
 *
 * Uses upsert (INSERT ... ON CONFLICT UPDATE) so it works whether
 * or not the row exists in the new table yet.
 *
 * @param projectId - The project_info.id
 * @param fields - The flat update object (same keys used for project_info update)
 * @param txOrDb - Optional transaction handle; defaults to global db
 */
export async function syncProjectSplitTables(
  projectId: number,
  fields: Record<string, unknown>,
  txOrDb: SplitWriteTx = db,
): Promise<void> {
  const execFields = extractExecutionStateFields(fields);
  const settingsFields = extractSettingsFields(fields);

  if (execFields) {
    // Upsert into project_execution_state
    await txOrDb
      .insert(projectExecutionState)
      .values({ projectId, ...execFields })
      .onConflictDoUpdate({
        target: projectExecutionState.projectId,
        set: { ...execFields, updatedAt: new Date() },
      });
  }

  if (settingsFields) {
    // Upsert into project_settings
    await txOrDb
      .insert(projectSettings)
      .values({ projectId, ...settingsFields })
      .onConflictDoUpdate({
        target: projectSettings.projectId,
        set: { ...settingsFields, updatedAt: new Date() },
      });
  }
}

/**
 * After inserting a new project_info row, call this to create
 * the corresponding rows in the split tables.
 *
 * @param projectId - The newly created project_info.id
 * @param fields - The full insert object used for project_info
 * @param txOrDb - Optional transaction handle
 */
export async function syncProjectSplitTablesAfterInsert(
  projectId: number,
  fields: Record<string, unknown>,
  txOrDb: SplitWriteTx = db,
): Promise<void> {
  const execFields = extractExecutionStateFields(fields);
  const settingsFields = extractSettingsFields(fields);

  // Always create rows (even if empty) to maintain 1:1 relationship
  await txOrDb
    .insert(projectExecutionState)
    .values({ projectId, ...(execFields || {}) })
    .onConflictDoNothing();

  await txOrDb
    .insert(projectSettings)
    .values({ projectId, ...(settingsFields || {}) })
    .onConflictDoNothing();
}
