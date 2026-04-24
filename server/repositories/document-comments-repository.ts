/**
 * Document comments + mentions repository.
 *
 * Threaded comment storage. Mentions are a separate join table; mention
 * parsing (finding `@user` in the body) lives in the route/service layer.
 */

import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  documentComments,
  documentCommentMentions,
  type DocumentComment,
} from "@shared/schema/documents";
import { users } from "@shared/schema/users";

type InsertDocumentComment = typeof documentComments.$inferInsert;

function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /42P01|42703|does not exist|no such table/i.test(msg);
}

export async function listCommentsForDocument(
  documentId: number,
): Promise<DocumentComment[]> {
  try {
    return await db
      .select()
      .from(documentComments)
      .where(
        and(
          eq(documentComments.documentId, documentId),
          isNull(documentComments.deletedAt),
        ),
      )
      .orderBy(asc(documentComments.createdAt));
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

export async function getCommentById(id: number): Promise<DocumentComment | null> {
  try {
    const [row] = await db
      .select()
      .from(documentComments)
      .where(eq(documentComments.id, id))
      .limit(1);
    return row ?? null;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

export interface CreateCommentInput {
  documentId: number;
  revisionId?: number | null;
  parentCommentId?: number | null;
  authorUserId: number;
  body: string;
  mentionedUserIds?: number[];
}

export async function createComment(
  input: CreateCommentInput,
): Promise<DocumentComment> {
  const [comment] = await db
    .insert(documentComments)
    .values({
      documentId: input.documentId,
      revisionId: input.revisionId ?? null,
      parentCommentId: input.parentCommentId ?? null,
      authorUserId: input.authorUserId,
      body: input.body,
    } satisfies InsertDocumentComment)
    .returning();

  if (input.mentionedUserIds && input.mentionedUserIds.length > 0) {
    const uniqueIds = Array.from(new Set(input.mentionedUserIds));
    await db
      .insert(documentCommentMentions)
      .values(
        uniqueIds.map((mentionedUserId) => ({
          commentId: comment.id,
          mentionedUserId,
        })),
      );
  }
  return comment;
}

export async function editComment(
  id: number,
  body: string,
): Promise<DocumentComment> {
  const [updated] = await db
    .update(documentComments)
    .set({ body, editedAt: new Date() })
    .where(eq(documentComments.id, id))
    .returning();
  return updated;
}

export async function softDeleteComment(id: number): Promise<void> {
  await db
    .update(documentComments)
    .set({ deletedAt: new Date() })
    .where(eq(documentComments.id, id));
}

export async function listMentionedUserIdsForComment(
  commentId: number,
): Promise<number[]> {
  try {
    const rows = await db
      .select({ userId: documentCommentMentions.mentionedUserId })
      .from(documentCommentMentions)
      .where(eq(documentCommentMentions.commentId, commentId));
    return rows.map((r: { userId: number }) => r.userId);
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

export interface MentionUserRecord {
  id: number;
  username: string;
  email: string;
  name: string;
}

/**
 * Look up candidate users for `@` mentions by username/email-prefix match.
 * `handles` are expected to be escaped for ilike before being passed in.
 */
export async function findUsersByHandles(
  handles: string[],
): Promise<MentionUserRecord[]> {
  if (handles.length === 0) return [];
  const conditions = handles.map((h) =>
    or(ilike(users.username, h), ilike(users.email, `${h}@%`)),
  );
  return (await db
    .select({ id: users.id, username: users.username, email: users.email, name: users.name })
    .from(users)
    .where(and(isNull(users.deletedAt), or(...conditions) ?? sql`FALSE`))
    .limit(50)) as MentionUserRecord[];
}

export interface UserSearchRecord {
  id: number;
  username: string;
  name: string;
}

/** Simple prefix search used by the `@mention` autocomplete in the UI. */
export async function searchUsersForMentionPicker(
  escapedPrefix: string,
  limit: number,
): Promise<UserSearchRecord[]> {
  return (await db
    .select({ id: users.id, username: users.username, name: users.name })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        or(
          ilike(users.username, `${escapedPrefix}%`),
          ilike(users.name, `${escapedPrefix}%`),
        ) ?? sql`FALSE`,
      ),
    )
    .limit(limit)) as UserSearchRecord[];
}
