/**
 * Per-project SharePoint roots — thin wrapper over projectSharepointRoots.
 *
 * Consolidates the ad-hoc lookups that previously lived in the controlled-
 * documents and SharePoint sync call-sites so /documents route handlers
 * don't reach into the DB directly.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  projectSharepointRoots,
  type ProjectSharepointRoot,
} from "@shared/schema/documents";

type InsertProjectSharepointRoot = typeof projectSharepointRoots.$inferInsert;

function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /42P01|42703|does not exist|no such table/i.test(msg);
}

export async function getProjectRootByProjectId(
  projectId: number,
): Promise<ProjectSharepointRoot | null> {
  try {
    const [row] = await db
      .select()
      .from(projectSharepointRoots)
      .where(eq(projectSharepointRoots.projectId, projectId))
      .limit(1);
    return row ?? null;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

export async function getProjectRootById(id: number): Promise<ProjectSharepointRoot | null> {
  try {
    const [row] = await db
      .select()
      .from(projectSharepointRoots)
      .where(eq(projectSharepointRoots.id, id))
      .limit(1);
    return row ?? null;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

export async function listProjectRoots(
  projectIds: number[],
): Promise<ProjectSharepointRoot[]> {
  if (projectIds.length === 0) return [];
  try {
    return await db
      .select()
      .from(projectSharepointRoots)
      .where(inArray(projectSharepointRoots.projectId, projectIds));
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

export async function upsertProjectRoot(
  input: InsertProjectSharepointRoot,
): Promise<ProjectSharepointRoot> {
  const existing = await getProjectRootByProjectId(input.projectId);
  if (existing) {
    const [updated] = await db
      .update(projectSharepointRoots)
      .set({
        driveId: input.driveId ?? existing.driveId,
        rootItemId: input.rootItemId ?? existing.rootItemId,
        rootPath: input.rootPath,
        configuredByUserId: input.configuredByUserId ?? existing.configuredByUserId,
        updatedAt: new Date(),
      })
      .where(eq(projectSharepointRoots.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(projectSharepointRoots)
    .values(input)
    .returning();
  return created;
}
