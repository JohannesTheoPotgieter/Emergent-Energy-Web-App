/**
 * Project Write Service — Centralized write authority for project_info and project_execution_state.
 *
 * WRITE AUTHORITY MODEL:
 *   Legacy tables (public.project_info, public.project_execution_state) remain the
 *   primary write targets. Every write is immediately synced to the promoted schema
 *   (core.projects) via bridge writers. Bridge failures are logged but never block
 *   the legacy write.
 *
 * This service should be used for all new project write paths. Existing paths are
 * being migrated incrementally — see docs/write-authority-model.md for the full map.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { projectInfo, projectExecutionState } from "../../shared/schema";
import { syncProject, syncProjectInsert, syncProjectExecutionState, syncProjectDelete, snapshotProjectState, bridgeCatch } from "../bridge/bridge-writer";
import { syncProjectSplitTables, syncProjectSplitTablesAfterInsert } from "../lib/project-info-sync";

type DbOrTx = typeof db;

// ---------------------------------------------------------------------------
// Project Info writes
// ---------------------------------------------------------------------------

/**
 * Create a new project_info row and sync to promoted schema.
 */
export async function createProjectInfo(
  fields: Record<string, any>,
  txOrDb: DbOrTx = db,
): Promise<any> {
  const insertFields = { ...fields, updatedAt: new Date() };
  const [created] = await (txOrDb as any).insert(projectInfo).values(insertFields).returning();
  await syncProjectSplitTablesAfterInsert(created.id, insertFields, txOrDb);
  syncProjectInsert(created as any).catch(bridgeCatch);
  return created;
}

/**
 * Update project_info fields by ID and sync to promoted schema.
 */
export async function updateProjectInfo(
  id: number,
  fields: Record<string, any>,
  txOrDb: DbOrTx = db,
): Promise<any> {
  const updateFields = { ...fields, updatedAt: new Date() };
  const [updated] = await (txOrDb as any)
    .update(projectInfo)
    .set(updateFields)
    .where(eq(projectInfo.id, id))
    .returning();
  if (updated) {
    await syncProjectSplitTables(id, updateFields, txOrDb);
    syncProject(updated as any).catch(bridgeCatch);
    snapshotProjectState(id, updateFields, "write_service").catch(bridgeCatch);
  }
  return updated;
}

/**
 * Soft-delete (archive) a project and sync to promoted schema.
 */
export async function softDeleteProject(
  id: number,
  txOrDb: DbOrTx = db,
): Promise<boolean> {
  const fields = { isActive: false, archivedStatus: "ARCHIVED", updatedAt: new Date() };
  const result = await (txOrDb as any)
    .update(projectInfo)
    .set(fields)
    .where(eq(projectInfo.id, id))
    .returning();
  if (result.length > 0) {
    await syncProjectSplitTables(id, fields, txOrDb);
    syncProject(result[0] as any).catch(bridgeCatch);
  }
  return result.length > 0;
}

/**
 * Hard-delete a project_info row and mark promoted as deleted.
 */
export async function hardDeleteProjectInfo(
  projectName: string,
  txOrDb: DbOrTx = db,
): Promise<void> {
  // Look up the ID before deleting
  const [row] = await (txOrDb as any)
    .select({ id: projectInfo.id })
    .from(projectInfo)
    .where(eq(projectInfo.projectName, projectName));
  await (txOrDb as any).delete(projectInfo).where(eq(projectInfo.projectName, projectName));
  if (row?.id) {
    syncProjectDelete(row.id).catch(bridgeCatch);
  }
}

// ---------------------------------------------------------------------------
// Execution State writes
// ---------------------------------------------------------------------------

/**
 * Update project_execution_state fields directly (for stage-lifecycle, financial-review, etc.)
 * and sync to promoted schema.
 */
export async function updateExecutionState(
  projectId: number,
  fields: Record<string, any>,
  txOrDb: DbOrTx = db,
): Promise<void> {
  await (txOrDb as any)
    .update(projectExecutionState)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(projectExecutionState.projectId, projectId));
  // Bridge sync to core.projects
  syncProjectExecutionState(projectId, fields).catch(bridgeCatch);
}
