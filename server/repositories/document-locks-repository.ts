/**
 * Document locks repository.
 *
 * Mirrors Graph checkout state to the app DB so write-op preflight can
 * cheaply block conflicting writes without round-tripping to SharePoint.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  documentLocks,
  type DocumentLock,
} from "@shared/schema/documents";

function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /42P01|42703|does not exist|no such table/i.test(msg);
}

export async function getLock(documentId: number): Promise<DocumentLock | null> {
  try {
    const [row] = await db
      .select()
      .from(documentLocks)
      .where(eq(documentLocks.documentId, documentId))
      .limit(1);
    return row ?? null;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

export async function acquireLock(
  documentId: number,
  userId: number,
  clientAgent?: string,
): Promise<DocumentLock> {
  const existing = await getLock(documentId);
  if (existing && existing.lockedByUserId !== userId) {
    throw new Error("LOCKED");
  }
  if (existing) {
    return existing;
  }
  const [row] = await db
    .insert(documentLocks)
    .values({
      documentId,
      lockedByUserId: userId,
      clientAgent: clientAgent ?? null,
    })
    .returning();
  return row;
}

export async function releaseLock(documentId: number): Promise<void> {
  await db.delete(documentLocks).where(eq(documentLocks.documentId, documentId));
}

/**
 * Used as a write-op preflight. If another user holds the lock, throws an
 * Error with message 'LOCKED'; route layer converts to ApiError 423.
 */
export async function assertUnlockedFor(
  documentId: number,
  userId: number,
): Promise<void> {
  const lock = await getLock(documentId);
  if (lock && lock.lockedByUserId !== userId) {
    throw new Error("LOCKED");
  }
}
