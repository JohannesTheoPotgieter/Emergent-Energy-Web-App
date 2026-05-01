/**
 * Project folders repository (D6 — Document Management v2).
 *
 * Owns all DB access for `project_folders`, the per-project instance rows
 * holding Graph drive/item pointers and provisioning audit. One row per
 * (projectId, taxonomyKey) once a folder has been provisioned.
 *
 * Conventions (CLAUDE.md):
 * - All DB access for project folders goes through this repo.
 * - Provisioning is fully manual; this repo only persists state. The
 *   actual Graph folder creation lives in the provisioning service
 *   (D6 Phase 3).
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  projectFolders,
  type ProjectFolder,
} from "@shared/schema/documents";

// =========================================================================
// Reads
// =========================================================================

/** All folders for a project, ordered by taxonomyKey for stable display. */
export async function listFoldersForProject(projectId: number): Promise<ProjectFolder[]> {
  return db
    .select()
    .from(projectFolders)
    .where(eq(projectFolders.projectId, projectId))
    .orderBy(asc(projectFolders.taxonomyKey));
}

/** Single folder lookup. */
export async function getProjectFolder(
  projectId: number,
  taxonomyKey: string,
): Promise<ProjectFolder | null> {
  const [row] = await db
    .select()
    .from(projectFolders)
    .where(and(eq(projectFolders.projectId, projectId), eq(projectFolders.taxonomyKey, taxonomyKey)))
    .limit(1);
  return row ?? null;
}

/**
 * Folders matching a list of taxonomyKeys for a project — useful when a
 * discipline panel needs to query "show me my folders" in one round trip.
 */
export async function listFoldersByKeys(
  projectId: number,
  taxonomyKeys: string[],
): Promise<ProjectFolder[]> {
  if (taxonomyKeys.length === 0) return [];
  const rows = await listFoldersForProject(projectId);
  const set = new Set(taxonomyKeys);
  return rows.filter((r) => set.has(r.taxonomyKey));
}

// =========================================================================
// Writes
// =========================================================================

export interface UpsertProjectFolderInput {
  projectId: number;
  taxonomyKey: string;
  driveId?: string | null;
  itemId?: string | null;
  sharepointPath?: string | null;
  webUrl?: string | null;
  provisionedByUserId?: number | null;
  provisionedAt?: Date | null;
}

/**
 * Idempotent upsert keyed by (projectId, taxonomyKey). Used by the
 * provisioning service to record a Graph folder ID after a successful
 * create, and by the reconciliation path to refresh stale references.
 */
export async function upsertProjectFolder(input: UpsertProjectFolderInput): Promise<ProjectFolder> {
  const existing = await getProjectFolder(input.projectId, input.taxonomyKey);
  const now = new Date();

  if (existing) {
    const [row] = await db
      .update(projectFolders)
      .set({
        driveId: input.driveId ?? existing.driveId,
        itemId: input.itemId ?? existing.itemId,
        sharepointPath: input.sharepointPath ?? existing.sharepointPath,
        webUrl: input.webUrl ?? existing.webUrl,
        provisionedAt: input.provisionedAt ?? existing.provisionedAt ?? now,
        provisionedByUserId: input.provisionedByUserId ?? existing.provisionedByUserId,
        lastVerifiedAt: now,
        verifyError: null,
        updatedAt: now,
      })
      .where(eq(projectFolders.id, existing.id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(projectFolders)
    .values({
      projectId: input.projectId,
      taxonomyKey: input.taxonomyKey,
      driveId: input.driveId ?? null,
      itemId: input.itemId ?? null,
      sharepointPath: input.sharepointPath ?? null,
      webUrl: input.webUrl ?? null,
      provisionedAt: input.provisionedAt ?? now,
      provisionedByUserId: input.provisionedByUserId ?? null,
      lastVerifiedAt: now,
    })
    .returning();
  return row;
}

/** Record a verification failure (folder missing on Graph, etc.). */
export async function recordVerifyError(
  projectId: number,
  taxonomyKey: string,
  errorMessage: string,
): Promise<ProjectFolder | null> {
  const existing = await getProjectFolder(projectId, taxonomyKey);
  if (!existing) return null;

  const [row] = await db
    .update(projectFolders)
    .set({
      verifyError: errorMessage,
      lastVerifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projectFolders.id, existing.id))
    .returning();
  return row;
}
