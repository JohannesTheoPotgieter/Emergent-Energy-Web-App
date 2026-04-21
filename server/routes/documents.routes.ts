/**
 * Controlled documents (D3.2) — read path.
 *
 * Read-only endpoints for listing document types and per-project tracked
 * documents. Mutations (submit / approve / reject / recall) land in D3.3.
 *
 * Endpoints:
 *   GET /api/controlled-documents/types
 *       -> ControlledDocumentType[]     (active types, sorted)
 *
 *   GET /api/projects/:projectId/controlled-documents
 *       -> ProjectDocumentSummary[]     (grouped by type for the UI strip)
 *
 *   GET /api/projects/:projectId/controlled-documents/:typeKey
 *       -> ProjectDocumentDetail         (approved + drafts + submitted + rejected + history)
 *
 * Auth: requireAuth only. Any authenticated user in the team can read
 * document metadata. File previews live in SharePoint and enforce their
 * own permissions on the browser side via signed Graph links.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, getEffectiveUser } from "../auth-context";
import {
  createSubmission,
  getApprovalQueueForUser,
  getProjectDocumentDetail,
  getProjectDocumentSummary,
  listActiveDocumentTypes,
  recordApproval,
  recordRecall,
  recordRejection,
} from "../repositories/controlled-documents-repository";
import { ApiError, badRequest, conflict, forbidden, notFound, serverError, unauthorized } from "../lib/api-error";

const projectIdParam = z.coerce.number().int().positive();
const typeKeyParam = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);
const documentIdParam = z.coerce.number().int().positive();

const submitBodySchema = z.object({
  typeKey: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
  fileName: z.string().min(1).max(512),
  sharepointPath: z.string().min(1).max(2048),
  sharepointDriveId: z.string().max(256).optional(),
  sharepointItemId: z.string().max(256).optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  submitComment: z.string().max(2000).optional(),
  approverUserIds: z.array(z.number().int().positive()).min(1).max(10),
});

const approveBodySchema = z.object({
  comment: z.string().max(2000).optional(),
});

const rejectBodySchema = z.object({
  reason: z.string().min(1).max(2000),
});

const recallBodySchema = z.object({
  reason: z.string().min(1).max(2000),
});

/**
 * Map a repository Error (plain Error with user-facing message) to the
 * right ApiError. Internal "not found" maps to 404, role/authz to 403,
 * conflict-style state errors to 409, everything else a safe 400.
 */
function toApiError(err: unknown, fallback = "Request failed"): ApiError {
  if (err instanceof ApiError) return err;
  const msg = err instanceof Error ? err.message : fallback;
  if (/not found/i.test(msg)) return notFound(msg);
  if (/only .* can|not an assigned approver|super-user|cannot approve|required role/i.test(msg)) {
    return forbidden(msg);
  }
  if (/state|already|superseded|recalled|rejected/i.test(msg)) return conflict(msg);
  return badRequest(msg || fallback);
}

export function registerControlledDocumentRoutes(app: Express): void {
  // ------------------------------------------------------------------
  // GET /api/controlled-documents/types
  // ------------------------------------------------------------------
  app.get(
    "/api/controlled-documents/types",
    requireAuth,
    async (_req: Request, res: Response) => {
      try {
        const types = await listActiveDocumentTypes();
        res.json({ types });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[controlled-documents] types error:", err);
        throw serverError("Failed to load document types");
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /api/projects/:projectId/controlled-documents
  // ------------------------------------------------------------------
  app.get(
    "/api/projects/:projectId/controlled-documents",
    requireAuth,
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      if (!parsed.success) throw badRequest("Invalid projectId");
      try {
        const summary = await getProjectDocumentSummary(parsed.data);
        res.json({ projectId: parsed.data, summary });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[controlled-documents] project summary error:", err);
        throw serverError("Failed to load project documents");
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /api/projects/:projectId/controlled-documents/:typeKey
  // ------------------------------------------------------------------
  app.get(
    "/api/projects/:projectId/controlled-documents/:typeKey",
    requireAuth,
    async (req: Request, res: Response) => {
      const parsedId = projectIdParam.safeParse(req.params.projectId);
      if (!parsedId.success) throw badRequest("Invalid projectId");
      const parsedKey = typeKeyParam.safeParse(req.params.typeKey);
      if (!parsedKey.success) throw badRequest("Invalid typeKey");
      try {
        const detail = await getProjectDocumentDetail(parsedId.data, parsedKey.data);
        if (!detail) throw notFound(`Document type '${parsedKey.data}' not found`);
        res.json(detail);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[controlled-documents] detail error:", err);
        throw serverError("Failed to load document detail");
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /api/projects/:projectId/controlled-documents/submit
  // Creates a new submitted doc + approval rows.
  // ------------------------------------------------------------------
  app.post(
    "/api/projects/:projectId/controlled-documents/submit",
    requireAuth,
    async (req: Request, res: Response) => {
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      const parsedId = projectIdParam.safeParse(req.params.projectId);
      if (!parsedId.success) throw badRequest("Invalid projectId");
      const parsedBody = submitBodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        throw badRequest("Invalid submit payload", {
          issues: parsedBody.error.issues.map((i) => i.message).join("; "),
        });
      }
      try {
        const result = await createSubmission({
          projectId: parsedId.data,
          typeKey: parsedBody.data.typeKey,
          fileName: parsedBody.data.fileName,
          sharepointPath: parsedBody.data.sharepointPath,
          sharepointDriveId: parsedBody.data.sharepointDriveId ?? null,
          sharepointItemId: parsedBody.data.sharepointItemId ?? null,
          fileSizeBytes: parsedBody.data.fileSizeBytes ?? null,
          submitComment: parsedBody.data.submitComment ?? null,
          approverUserIds: parsedBody.data.approverUserIds,
          submittedByUserId: user.id,
        });
        res.status(201).json(result);
      } catch (err) {
        console.error("[controlled-documents] submit error:", err);
        throw toApiError(err, "Failed to submit document for approval");
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /api/controlled-documents/:id/approve
  // ------------------------------------------------------------------
  app.post(
    "/api/controlled-documents/:id/approve",
    requireAuth,
    async (req: Request, res: Response) => {
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      const parsedId = documentIdParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid document id");
      const parsedBody = approveBodySchema.safeParse(req.body ?? {});
      if (!parsedBody.success) throw badRequest("Invalid approve payload");
      try {
        const result = await recordApproval({
          documentId: parsedId.data,
          userId: user.id,
          comment: parsedBody.data.comment ?? null,
        });
        res.json(result);
      } catch (err) {
        console.error("[controlled-documents] approve error:", err);
        throw toApiError(err, "Failed to record approval");
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /api/controlled-documents/:id/reject
  // ------------------------------------------------------------------
  app.post(
    "/api/controlled-documents/:id/reject",
    requireAuth,
    async (req: Request, res: Response) => {
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      const parsedId = documentIdParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid document id");
      const parsedBody = rejectBodySchema.safeParse(req.body);
      if (!parsedBody.success) throw badRequest("Rejection reason required");
      try {
        const doc = await recordRejection({
          documentId: parsedId.data,
          userId: user.id,
          reason: parsedBody.data.reason,
        });
        res.json({ document: doc });
      } catch (err) {
        console.error("[controlled-documents] reject error:", err);
        throw toApiError(err, "Failed to reject document");
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /api/controlled-documents/:id/recall
  // Soft-rule recall — approver or super-user only.
  // ------------------------------------------------------------------
  app.post(
    "/api/controlled-documents/:id/recall",
    requireAuth,
    async (req: Request, res: Response) => {
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      const parsedId = documentIdParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid document id");
      const parsedBody = recallBodySchema.safeParse(req.body);
      if (!parsedBody.success) throw badRequest("Recall reason required");
      try {
        const doc = await recordRecall({
          documentId: parsedId.data,
          userId: user.id,
          userRole: user.role,
          reason: parsedBody.data.reason,
        });
        res.json({ document: doc });
      } catch (err) {
        console.error("[controlled-documents] recall error:", err);
        throw toApiError(err, "Failed to recall document");
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /api/approvals/queue
  // Pending controlled-document approvals assigned to the current user.
  // ------------------------------------------------------------------
  app.get(
    "/api/approvals/queue",
    requireAuth,
    async (req: Request, res: Response) => {
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      try {
        const rows = await getApprovalQueueForUser(user.id);
        res.json({ userId: user.id, rows });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[controlled-documents] queue error:", err);
        throw serverError("Failed to load approval queue");
      }
    },
  );
}
