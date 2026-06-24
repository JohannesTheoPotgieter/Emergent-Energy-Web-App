/**
 * Project discipline folders repository — browse-and-bind document setup.
 *
 * Owns all DB access for `project_discipline_folders`: one stable row per
 * (projectId, discipline) pointing at an EXISTING SharePoint folder the user
 * browsed to and bound. Replaces taxonomy-driven folder provisioning.
 *
 * Conventions (CLAUDE.md):
 * - All DB access for these bindings goes through this repo.
 * - Rebinding UPDATES the stable row (the pair is unique); unbind is a soft
 *   delete so downstream references stay valid.
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { projectDisciplineFolders, type ProjectDisciplineFolder } from "@shared/schema/documents";
import { recordAudit } from "../api/v2/services/audit-service";

// =========================================================================
// Reads
// =========================================================================

/** Active (non-unbound) discipline bindings for a project, ordered by discipline. */
export async function listDisciplineFoldersForProject(projectId: number): Promise<ProjectDisciplineFolder[]> {
  return db
    .select()
    .from(projectDisciplineFolders)
    .where(and(eq(projectDisciplineFolders.projectId, projectId), isNull(projectDisciplineFolders.deletedAt)))
    .orderBy(asc(projectDisciplineFolders.discipline));
}

/**
 * Single binding lookup by (projectId, discipline). Does NOT filter
 * deletedAt — the bind path needs to find a soft-unbound row to revive it.
 */
export async function getDisciplineFolder(
  projectId: number,
  discipline: string,
): Promise<ProjectDisciplineFolder | null> {
  const [row] = await db
    .select()
    .from(projectDisciplineFolders)
    .where(and(eq(projectDisciplineFolders.projectId, projectId), eq(projectDisciplineFolders.discipline, discipline)))
    .limit(1);
  return row ?? null;
}

/** Single binding lookup by id (used by the approval engine to resolve discipline). */
export async function getDisciplineFolderById(id: number): Promise<ProjectDisciplineFolder | null> {
  const [row] = await db
    .select()
    .from(projectDisciplineFolders)
    .where(eq(projectDisciplineFolders.id, id))
    .limit(1);
  return row ?? null;
}

// =========================================================================
// Writes
// =========================================================================

export interface BindDisciplineFolderInput {
  projectId: number;
  discipline: string;
  driveId?: string | null;
  itemId?: string | null;
  sharepointPath?: string | null;
  webUrl?: string | null;
  boundByUserId?: number | null;
}

/**
 * Bind (or re-bind) the SharePoint folder for a discipline. Keyed by
 * (projectId, discipline): if a row exists it is UPDATED in place (and
 * revived if it had been unbound), otherwise inserted. Rebinding replaces the
 * SharePoint references with the newly chosen folder.
 */
export async function bindDisciplineFolder(input: BindDisciplineFolderInput): Promise<ProjectDisciplineFolder> {
  const existing = await getDisciplineFolder(input.projectId, input.discipline);
  const now = new Date();

  let row: ProjectDisciplineFolder;
  if (existing) {
    [row] = await db
      .update(projectDisciplineFolders)
      .set({
        driveId: input.driveId ?? null,
        itemId: input.itemId ?? null,
        sharepointPath: input.sharepointPath ?? null,
        webUrl: input.webUrl ?? null,
        boundByUserId: input.boundByUserId ?? existing.boundByUserId,
        boundAt: now,
        lastVerifiedAt: now,
        verifyError: null,
        deletedAt: null, // revive a previously unbound row
        updatedAt: now,
      })
      .where(eq(projectDisciplineFolders.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(projectDisciplineFolders)
      .values({
        projectId: input.projectId,
        discipline: input.discipline,
        driveId: input.driveId ?? null,
        itemId: input.itemId ?? null,
        sharepointPath: input.sharepointPath ?? null,
        webUrl: input.webUrl ?? null,
        boundByUserId: input.boundByUserId ?? null,
        boundAt: now,
        lastVerifiedAt: now,
      })
      .returning();
  }

  await recordAudit({
    userId: input.boundByUserId ?? undefined,
    entityType: "project_discipline_folder",
    entityId: String(row.id),
    action: "documents.discipline_folder.bind",
    changesJson: {
      projectId: input.projectId,
      discipline: input.discipline,
      driveId: row.driveId,
      itemId: row.itemId,
    },
  });
  return row;
}

/** Soft-unbind a discipline's folder. Returns null if there was no active binding. */
export async function unbindDisciplineFolder(
  projectId: number,
  discipline: string,
  actorId: number,
): Promise<ProjectDisciplineFolder | null> {
  const existing = await getDisciplineFolder(projectId, discipline);
  if (!existing || existing.deletedAt) return null;

  const now = new Date();
  const [row] = await db
    .update(projectDisciplineFolders)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(projectDisciplineFolders.id, existing.id))
    .returning();

  await recordAudit({
    userId: actorId,
    entityType: "project_discipline_folder",
    entityId: String(existing.id),
    action: "documents.discipline_folder.unbind",
    changesJson: { projectId, discipline },
  });
  return row ?? null;
}
