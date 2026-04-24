/**
 * Document revisions repository.
 *
 * Maintains the per-document revision history. `revisionNumber` is a
 * monotonic per-document counter we allocate (Graph also has its own
 * version string — mirrored in `sharepointVersionId`).
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  documentRevisions,
  type DocumentRevision,
} from "@shared/schema/documents";

type InsertDocumentRevision = typeof documentRevisions.$inferInsert;

function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /42P01|42703|does not exist|no such table/i.test(msg);
}

export async function listRevisionsForDocument(
  documentId: number,
): Promise<DocumentRevision[]> {
  try {
    return await db
      .select()
      .from(documentRevisions)
      .where(eq(documentRevisions.documentId, documentId))
      .orderBy(desc(documentRevisions.revisionNumber));
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

export async function getRevisionById(id: number): Promise<DocumentRevision | null> {
  try {
    const [row] = await db
      .select()
      .from(documentRevisions)
      .where(eq(documentRevisions.id, id))
      .limit(1);
    return row ?? null;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

export async function getLatestRevisionNumber(
  documentId: number,
): Promise<number> {
  try {
    const [row] = await db
      .select({ max: sql<number>`max(${documentRevisions.revisionNumber})` })
      .from(documentRevisions)
      .where(eq(documentRevisions.documentId, documentId));
    return Number(row?.max ?? 0);
  } catch (err) {
    if (isMissingTableError(err)) return 0;
    throw err;
  }
}

export interface CreateRevisionInput {
  documentId: number;
  sharepointVersionId?: string | null;
  sizeBytes?: number | null;
  contentHash?: string | null;
  uploadedByUserId: number;
  notes?: string | null;
}

/**
 * Insert a new revision as the current one, demoting the previous current
 * revision (if any) to isCurrent=false. Returns the inserted revision.
 */
export async function appendRevision(
  input: CreateRevisionInput,
): Promise<DocumentRevision> {
  const latest = await getLatestRevisionNumber(input.documentId);
  const nextNumber = latest + 1;

  // Demote previous current revisions for this document.
  await db
    .update(documentRevisions)
    .set({ isCurrent: false })
    .where(
      and(
        eq(documentRevisions.documentId, input.documentId),
        eq(documentRevisions.isCurrent, true),
      ),
    );

  const [created] = await db
    .insert(documentRevisions)
    .values({
      documentId: input.documentId,
      revisionNumber: nextNumber,
      sharepointVersionId: input.sharepointVersionId ?? null,
      sizeBytes: input.sizeBytes ?? null,
      contentHash: input.contentHash ?? null,
      uploadedByUserId: input.uploadedByUserId,
      notes: input.notes ?? null,
      isCurrent: true,
      isControlled: false,
    } satisfies InsertDocumentRevision)
    .returning();
  return created;
}

export async function markCurrent(
  documentId: number,
  revisionId: number,
): Promise<void> {
  await db
    .update(documentRevisions)
    .set({ isCurrent: false })
    .where(eq(documentRevisions.documentId, documentId));

  await db
    .update(documentRevisions)
    .set({ isCurrent: true })
    .where(eq(documentRevisions.id, revisionId));
}
