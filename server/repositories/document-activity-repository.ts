/**
 * Document activity (audit) repository.
 *
 * Every action on a managed document or raw SharePoint file that the
 * /documents UI triggers goes through `record`. Reads power the per-doc
 * activity tab and the global activity feed.
 */

import { and, desc, eq, SQL } from "drizzle-orm";
import { db } from "../db";
import {
  documentActivity,
  type DocumentActivity,
  type DocumentActivityAction,
  type DocumentRootScope,
} from "@shared/schema/documents";

type InsertDocumentActivity = typeof documentActivity.$inferInsert;

function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /42P01|42703|does not exist|no such table/i.test(msg);
}

export interface RecordActivityInput {
  userId: number | null;
  actorRole: string | null;
  rootScope: DocumentRootScope;
  projectId?: number | null;
  companyRootId?: number | null;
  documentId?: number | null;
  revisionId?: number | null;
  driveId: string;
  itemId?: string | null;
  itemPath?: string | null;
  itemName?: string | null;
  action: DocumentActivityAction;
  sizeBytes?: number | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordActivity(
  input: RecordActivityInput,
): Promise<DocumentActivity | null> {
  try {
    const [row] = await db
      .insert(documentActivity)
      .values({
        userId: input.userId,
        actorRole: input.actorRole,
        rootScope: input.rootScope,
        projectId: input.projectId ?? null,
        companyRootId: input.companyRootId ?? null,
        documentId: input.documentId ?? null,
        revisionId: input.revisionId ?? null,
        driveId: input.driveId,
        itemId: input.itemId ?? null,
        itemPath: input.itemPath ?? null,
        itemName: input.itemName ?? null,
        action: input.action,
        sizeBytes: input.sizeBytes ?? null,
        requestId: input.requestId ?? null,
        metadata: input.metadata ?? null,
      } satisfies InsertDocumentActivity)
      .returning();
    return row ?? null;
  } catch (err) {
    if (isMissingTableError(err)) {
      console.warn("[document-activity] activity table not migrated yet — skipping record");
      return null;
    }
    throw err;
  }
}

export interface ListActivityFilters {
  projectId?: number;
  documentId?: number;
  userId?: number;
  action?: DocumentActivityAction;
  limit?: number;
}

export async function listActivity(
  filters: ListActivityFilters = {},
): Promise<DocumentActivity[]> {
  const clauses: SQL[] = [];
  if (filters.projectId != null) clauses.push(eq(documentActivity.projectId, filters.projectId));
  if (filters.documentId != null) clauses.push(eq(documentActivity.documentId, filters.documentId));
  if (filters.userId != null) clauses.push(eq(documentActivity.userId, filters.userId));
  if (filters.action) clauses.push(eq(documentActivity.action, filters.action));

  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);

  try {
    const query = db
      .select()
      .from(documentActivity)
      .orderBy(desc(documentActivity.createdAt))
      .limit(limit);
    return await (clauses.length > 0 ? query.where(and(...clauses)) : query);
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}
