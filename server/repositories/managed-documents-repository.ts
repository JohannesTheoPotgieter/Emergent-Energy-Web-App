/**
 * Managed documents repository.
 *
 * CRUD over the managed_documents table — one row per SharePoint file
 * we're tracking for versioning / comments / activity. Route handlers
 * MUST go through this repo (no direct db.select() in routes).
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  managedDocuments,
  type ManagedDocument,
  type ManagedDocumentState,
  type DocumentRootScope,
} from "@shared/schema/documents";

type InsertManagedDocument = typeof managedDocuments.$inferInsert;

function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /42P01|42703|does not exist|no such table/i.test(msg);
}

export async function getManagedDocumentById(id: number): Promise<ManagedDocument | null> {
  try {
    const [row] = await db
      .select()
      .from(managedDocuments)
      .where(and(eq(managedDocuments.id, id), isNull(managedDocuments.deletedAt)))
      .limit(1);
    return row ?? null;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

export async function getManagedDocumentByDriveItem(
  driveId: string,
  driveItemId: string,
): Promise<ManagedDocument | null> {
  try {
    const [row] = await db
      .select()
      .from(managedDocuments)
      .where(
        and(
          eq(managedDocuments.driveId, driveId),
          eq(managedDocuments.driveItemId, driveItemId),
          isNull(managedDocuments.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

export async function listManagedDocumentsByProject(
  projectId: number,
): Promise<ManagedDocument[]> {
  try {
    return await db
      .select()
      .from(managedDocuments)
      .where(
        and(
          eq(managedDocuments.projectId, projectId),
          isNull(managedDocuments.deletedAt),
        ),
      )
      .orderBy(desc(managedDocuments.updatedAt));
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

export async function listManagedDocumentsByCompanyRoot(
  companyRootId: number,
): Promise<ManagedDocument[]> {
  try {
    return await db
      .select()
      .from(managedDocuments)
      .where(
        and(
          eq(managedDocuments.companyRootId, companyRootId),
          isNull(managedDocuments.deletedAt),
        ),
      )
      .orderBy(desc(managedDocuments.updatedAt));
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

export interface UpsertFromGraphInput {
  rootScope: DocumentRootScope;
  projectId: number | null;
  companyRootId: number | null;
  driveId: string;
  driveItemId: string;
  name: string;
  path: string;
  createdByUserId: number;
}

/**
 * Insert-or-update the tracking row for a SharePoint file. Called on upload
 * (new file) or the first time we're asked to track an already-existing file
 * (e.g. an upload that completed client-side). Never overwrites ownerUserId
 * once set.
 */
export async function upsertManagedDocumentFromGraph(
  input: UpsertFromGraphInput,
): Promise<ManagedDocument> {
  const existing = await getManagedDocumentByDriveItem(input.driveId, input.driveItemId);
  if (existing) {
    const [updated] = await db
      .update(managedDocuments)
      .set({
        name: input.name,
        path: input.path,
        updatedAt: new Date(),
      })
      .where(eq(managedDocuments.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(managedDocuments)
    .values({
      rootScope: input.rootScope,
      projectId: input.projectId ?? null,
      companyRootId: input.companyRootId ?? null,
      driveId: input.driveId,
      driveItemId: input.driveItemId,
      name: input.name,
      path: input.path,
      ownerUserId: input.createdByUserId,
      createdByUserId: input.createdByUserId,
    } satisfies InsertManagedDocument)
    .returning();
  return created;
}

export async function setCurrentRevision(
  documentId: number,
  revisionId: number,
): Promise<void> {
  await db
    .update(managedDocuments)
    .set({ currentRevisionId: revisionId, updatedAt: new Date() })
    .where(eq(managedDocuments.id, documentId));
}

export async function setState(
  documentId: number,
  state: ManagedDocumentState,
): Promise<void> {
  await db
    .update(managedDocuments)
    .set({ state, updatedAt: new Date() })
    .where(eq(managedDocuments.id, documentId));
}

export async function setOwner(
  documentId: number,
  ownerUserId: number,
): Promise<ManagedDocument> {
  const [updated] = await db
    .update(managedDocuments)
    .set({ ownerUserId, updatedAt: new Date() })
    .where(eq(managedDocuments.id, documentId))
    .returning();
  return updated;
}

export async function softDeleteManagedDocument(documentId: number): Promise<void> {
  await db
    .update(managedDocuments)
    .set({ deletedAt: new Date() })
    .where(eq(managedDocuments.id, documentId));
}

export async function updatePathAndName(
  documentId: number,
  name: string,
  path: string,
): Promise<ManagedDocument> {
  const [updated] = await db
    .update(managedDocuments)
    .set({ name, path, updatedAt: new Date() })
    .where(eq(managedDocuments.id, documentId))
    .returning();
  return updated;
}
