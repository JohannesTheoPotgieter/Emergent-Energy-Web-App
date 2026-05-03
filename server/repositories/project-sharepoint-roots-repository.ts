/**
 * Per-project SharePoint roots — thin wrapper over projectSharepointRoots.
 *
 * Consolidates the ad-hoc lookups that previously lived in the controlled-
 * documents and SharePoint sync call-sites so /documents route handlers
 * don't reach into the DB directly.
 */

import { eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  projectSharepointRoots,
  type ProjectSharepointRoot,
} from "@shared/schema/documents";
import { projectInfo } from "@shared/schema/projects";

type InsertProjectSharepointRoot = typeof projectSharepointRoots.$inferInsert;

export interface ProjectWithRoot {
  projectId: number;
  projectName: string;
  projectCode: string | null;
  root: ProjectSharepointRoot;
}

/**
 * List every project that has a configured SharePoint root. Returns
 * projects joined with their root config — used by /api/documents/roots.
 */
export async function listProjectsWithRoots(): Promise<ProjectWithRoot[]> {
  try {
    const rows = await db
      .select({
        projectId: projectInfo.id,
        projectName: projectInfo.projectName,
        projectCode: projectInfo.projectCode,
        root: projectSharepointRoots,
      })
      .from(projectSharepointRoots)
      .innerJoin(projectInfo, eq(projectSharepointRoots.projectId, projectInfo.id))
      .where(isNull(projectInfo.deletedAt));
    return rows as ProjectWithRoot[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/42P01|42703|does not exist|no such table/i.test(msg)) return [];
    throw err;
  }
}

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
