/**
 * Document comments + @mentions + user search.
 *
 * Comments are persisted in document_comments; mentions resolve against
 * the users table by username OR email prefix and are stored in the
 * document_comment_mentions join. The notification-service dispatches
 * "document.mention" notifications for every distinct mentioned user.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, getEffectiveUser } from "../auth-context";
import { validateBody } from "../middleware/validateBody";
import {
  ApiError,
  badRequest,
  forbidden,
  notFound,
  serverError,
} from "../lib/api-error";
import type { DocumentRootScope } from "@shared/schema/documents";
import { getManagedDocumentById } from "../repositories/managed-documents-repository";
import { getCompanyRootById } from "../repositories/company-sharepoint-roots-repository";
import { getProjectRootByProjectId } from "../repositories/project-sharepoint-roots-repository";
import { getItem as spGetItem } from "../services/sharepoint-document-service";
import { resolveFolderAcl, canPerform, type DocumentAction } from "../config/document-folder-rbac";
import {
  listCommentsForDocument,
  getCommentById,
  createComment,
  editComment,
  softDeleteComment,
  listMentionedUserIdsForComment,
  findUsersByHandles,
  searchUsersForMentionPicker,
} from "../repositories/document-comments-repository";
import { recordActivity } from "../repositories/document-activity-repository";
import { createNotification } from "../services/notification-service";

const documentIdSchema = z.coerce.number().int().positive();
const commentIdSchema = z.coerce.number().int().positive();

const createCommentBody = z.object({
  body: z.string().min(1).max(4000),
  revisionId: z.number().int().positive().nullish(),
  parentCommentId: z.number().int().positive().nullish(),
  /** Pre-resolved mentioned user ids; server also parses body for @username. */
  mentionedUserIds: z.array(z.number().int().positive()).max(20).optional(),
});

const editCommentBody = z.object({
  body: z.string().min(1).max(4000),
});

const userSearchQuery = z.object({
  q: z.string().min(2).max(64),
  limit: z.coerce.number().int().min(1).max(10).optional(),
});

const MENTION_PATTERN = /@([a-zA-Z0-9._-]{2,64})/g;

/** Escape `%` and `_` so an `@` handle can't match every row via ilike. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function firstSegmentFromPath(path: string): string {
  const trimmed = path.replace(/^\/+/, "").replace(/\\/g, "/");
  const idx = trimmed.indexOf("/");
  return idx < 0 ? trimmed : trimmed.slice(0, idx);
}

async function assertDocumentAcl(
  tracked: { rootScope: DocumentRootScope; projectId: number | null; companyRootId: number | null; driveId: string; path: string },
  role: string | null | undefined,
  action: DocumentAction,
): Promise<void> {
  let rootDrivePath = "";
  if (tracked.rootScope === "project" && tracked.projectId != null) {
    const projectRoot = await getProjectRootByProjectId(tracked.projectId);
    if (projectRoot?.rootItemId) {
      const rootItem = await spGetItem(tracked.driveId, projectRoot.rootItemId);
      rootDrivePath = rootItem?.path ?? "";
    }
  } else if (tracked.rootScope === "company" && tracked.companyRootId != null) {
    const companyRoot = await getCompanyRootById(tracked.companyRootId);
    if (companyRoot?.rootItemId) {
      const rootItem = await spGetItem(tracked.driveId, companyRoot.rootItemId);
      rootDrivePath = rootItem?.path ?? "";
    }
  }
  const norm = rootDrivePath.replace(/^\/+|\/+$/g, "");
  const relative = norm && tracked.path.startsWith(norm)
    ? tracked.path.slice(norm.length).replace(/^\/+/, "")
    : tracked.path;
  const acl = resolveFolderAcl(tracked.rootScope, firstSegmentFromPath(relative));
  if (!canPerform(action, role ?? null, acl)) {
    throw forbidden("You don't have permission for that folder.");
  }
}

async function resolveMentions(body: string, explicit: number[] | undefined): Promise<number[]> {
  const matches = Array.from(body.matchAll(MENTION_PATTERN)).map((m) => m[1].toLowerCase());
  const unique = Array.from(new Set(matches)).slice(0, 20).map(escapeLike);
  if (unique.length === 0) return explicit ?? [];
  const found = await findUsersByHandles(unique);
  const ids = new Set<number>(explicit ?? []);
  for (const u of found) ids.add(u.id);
  return Array.from(ids).slice(0, 50);
}

export function registerDocumentCommentsRoutes(app: Express): void {
  // Tiny user search for the @mention picker
  app.get("/api/documents/users/search", requireAuth, async (req: Request, res: Response) => {
    const parsed = userSearchQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid query");
    const { q, limit } = parsed.data;
    const prefix = escapeLike(q.toLowerCase());
    // Return the minimum identity fields needed to drive the @mention picker.
    // Intentionally omitting `email` here to reduce enumeration surface.
    const rows = await searchUsersForMentionPicker(prefix, limit ?? 8);
    res.json({ users: rows });
  });

  // GET /api/documents/:docId/comments
  app.get(
    "/api/documents/:docId/comments",
    requireAuth,
    async (req: Request, res: Response) => {
      const docId = documentIdSchema.safeParse(req.params.docId);
      if (!docId.success) throw badRequest("Invalid docId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const tracked = await getManagedDocumentById(docId.data);
      if (!tracked) throw notFound("Document");
      await assertDocumentAcl(tracked, user.role, "read");
      const comments = await listCommentsForDocument(tracked.id);
      res.json({ comments });
    },
  );

  // POST /api/documents/:docId/comments
  app.post(
    "/api/documents/:docId/comments",
    requireAuth,
    validateBody(createCommentBody),
    async (req: Request, res: Response) => {
      const docId = documentIdSchema.safeParse(req.params.docId);
      if (!docId.success) throw badRequest("Invalid docId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const body = req.body as z.infer<typeof createCommentBody>;
      const tracked = await getManagedDocumentById(docId.data);
      if (!tracked) throw notFound("Document");
      await assertDocumentAcl(tracked, user.role, "read");

      try {
        const mentionedUserIds = await resolveMentions(body.body, body.mentionedUserIds);
        const comment = await createComment({
          documentId: tracked.id,
          revisionId: body.revisionId ?? null,
          parentCommentId: body.parentCommentId ?? null,
          authorUserId: user.id,
          body: body.body,
          mentionedUserIds,
        });
        await recordActivity({
          userId: user.id,
          actorRole: user.role ?? null,
          rootScope: tracked.rootScope,
          projectId: tracked.projectId ?? null,
          companyRootId: tracked.companyRootId ?? null,
          documentId: tracked.id,
          revisionId: body.revisionId ?? null,
          driveId: tracked.driveId,
          itemId: tracked.driveItemId,
          itemPath: tracked.path,
          itemName: tracked.name,
          action: "comment",
          metadata: { mentions: mentionedUserIds.length },
        });
        for (const mentionedId of mentionedUserIds) {
          if (mentionedId === user.id) continue;
          await createNotification({
            recipientUserId: mentionedId,
            eventType: "document.mention",
            title: `${user.name} mentioned you on "${tracked.name}"`,
            body: body.body.slice(0, 280),
            relatedEntityType: "managed_document",
            relatedEntityId: tracked.id,
          });
        }
        res.status(201).json({ comment, mentionedUserIds });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[documents/comments] create error:", err);
        throw serverError("Failed to create comment");
      }
    },
  );

  // PATCH /api/documents/comments/:commentId
  app.patch(
    "/api/documents/comments/:commentId",
    requireAuth,
    validateBody(editCommentBody),
    async (req: Request, res: Response) => {
      const commentId = commentIdSchema.safeParse(req.params.commentId);
      if (!commentId.success) throw badRequest("Invalid commentId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const existing = await getCommentById(commentId.data);
      if (!existing || existing.deletedAt) throw notFound("Comment");
      const tracked = await getManagedDocumentById(existing.documentId);
      if (!tracked) throw notFound("Document");
      await assertDocumentAcl(tracked, user.role, "read");
      const isSuper = user.role === "COO_ADMIN" || user.role === "CEO_ADMIN";
      if (existing.authorUserId !== user.id && !isSuper) {
        throw forbidden("You can only edit your own comments.");
      }
      const body = req.body as z.infer<typeof editCommentBody>;
      const updated = await editComment(existing.id, body.body);
      res.json({ comment: updated });
    },
  );

  // DELETE /api/documents/comments/:commentId
  app.delete(
    "/api/documents/comments/:commentId",
    requireAuth,
    async (req: Request, res: Response) => {
      const commentId = commentIdSchema.safeParse(req.params.commentId);
      if (!commentId.success) throw badRequest("Invalid commentId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const existing = await getCommentById(commentId.data);
      if (!existing || existing.deletedAt) throw notFound("Comment");
      const tracked = await getManagedDocumentById(existing.documentId);
      if (!tracked) throw notFound("Document");
      await assertDocumentAcl(tracked, user.role, "read");
      const isSuper = user.role === "COO_ADMIN" || user.role === "CEO_ADMIN";
      if (existing.authorUserId !== user.id && !isSuper) {
        throw forbidden("You can only delete your own comments.");
      }
      await softDeleteComment(existing.id);
      res.status(204).end();
    },
  );

  // GET /api/documents/comments/:commentId/mentions  (debug / audit)
  app.get(
    "/api/documents/comments/:commentId/mentions",
    requireAuth,
    async (req: Request, res: Response) => {
      const commentId = commentIdSchema.safeParse(req.params.commentId);
      if (!commentId.success) throw badRequest("Invalid commentId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const existing = await getCommentById(commentId.data);
      if (!existing) throw notFound("Comment");
      const tracked = await getManagedDocumentById(existing.documentId);
      if (!tracked) throw notFound("Document");
      await assertDocumentAcl(tracked, user.role, "read");
      const ids = await listMentionedUserIdsForComment(commentId.data);
      res.json({ mentionedUserIds: ids });
    },
  );
}
