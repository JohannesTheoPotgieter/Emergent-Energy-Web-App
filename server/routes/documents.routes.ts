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
import { requireRole } from "../middleware/requireRole";
import {
  createDocumentType,
  createSubmission,
  deactivateDocumentType,
  getApprovalQueueForUser,
  getProjectDocumentDetail,
  getProjectDocumentSummary,
  getProjectSharepointRoot,
  listActiveDocumentTypes,
  listAllDocumentTypes,
  recordApproval,
  recordRecall,
  recordRejection,
  updateDocumentType,
  upsertProjectSharepointRoot,
} from "../repositories/controlled-documents-repository";
import { ApiError, badRequest, conflict, forbidden, notFound, serverError, unauthorized } from "../lib/api-error";

const projectIdParam = z.coerce.number().int().positive();
const typeKeyParam = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);
const documentIdParam = z.coerce.number().int().positive();

const SUPER_ROLES = ["COO_ADMIN", "CEO_ADMIN"];

const createTypeBodySchema = z.object({
  typeKey: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
  displayName: z.string().min(1).max(128),
  description: z.string().max(1024).nullish(),
  folderSubPath: z.string().min(1).max(512),
  defaultApproverRoles: z.array(z.string().min(1).max(64)).min(1).max(8),
  requiresAllApprovers: z.boolean().default(false),
  extractSpec: z
    .object({
      sheetName: z.string().optional(),
      cells: z.record(z.string(), z.string()).optional(),
    })
    .nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const upsertSharepointRootBodySchema = z.object({
  rootPath: z.string().min(1).max(1024),
  driveId: z.string().max(256).nullish(),
  rootItemId: z.string().max(256).nullish(),
});

const updateTypeBodySchema = z.object({
  displayName: z.string().min(1).max(128).optional(),
  description: z.string().max(1024).nullish(),
  folderSubPath: z.string().min(1).max(512).optional(),
  defaultApproverRoles: z.array(z.string().min(1).max(64)).min(1).max(8).optional(),
  requiresAllApprovers: z.boolean().optional(),
  extractSpec: z
    .object({
      sheetName: z.string().optional(),
      cells: z.record(z.string(), z.string()).optional(),
    })
    .nullish(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

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

  // ====================================================================
  // D5.2 — document-type taxonomy CRUD (super-user only)
  //   GET    /api/admin/controlled-document-types        — including inactive
  //   POST   /api/admin/controlled-document-types        — create
  //   PATCH  /api/admin/controlled-document-types/:typeKey — edit
  //   DELETE /api/admin/controlled-document-types/:typeKey — soft-delete
  // ====================================================================

  app.get(
    "/api/admin/controlled-document-types",
    requireAuth,
    requireRole(SUPER_ROLES),
    async (_req: Request, res: Response) => {
      try {
        const types = await listAllDocumentTypes();
        res.json({ types });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[controlled-documents] admin list error:", err);
        throw serverError("Failed to load document types");
      }
    },
  );

  app.post(
    "/api/admin/controlled-document-types",
    requireAuth,
    requireRole(SUPER_ROLES),
    async (req: Request, res: Response) => {
      const parsed = createTypeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw badRequest("Invalid document type payload", {
          issues: parsed.error.issues.map((i) => i.message).join("; "),
        });
      }
      try {
        const row = await createDocumentType(parsed.data);
        res.status(201).json({ type: row });
      } catch (err) {
        console.error("[controlled-documents] create type error:", err);
        const msg = err instanceof Error ? err.message : "Create failed";
        if (/already exists/i.test(msg)) throw conflict(msg);
        throw badRequest(msg);
      }
    },
  );

  app.patch(
    "/api/admin/controlled-document-types/:typeKey",
    requireAuth,
    requireRole(SUPER_ROLES),
    async (req: Request, res: Response) => {
      const parsedKey = typeKeyParam.safeParse(req.params.typeKey);
      if (!parsedKey.success) throw badRequest("Invalid typeKey");
      const parsedBody = updateTypeBodySchema.safeParse(req.body);
      if (!parsedBody.success) throw badRequest("Invalid update payload");
      try {
        const row = await updateDocumentType(parsedKey.data, parsedBody.data);
        res.json({ type: row });
      } catch (err) {
        console.error("[controlled-documents] update type error:", err);
        const msg = err instanceof Error ? err.message : "Update failed";
        if (/not found/i.test(msg)) throw notFound(msg);
        throw badRequest(msg);
      }
    },
  );

  app.delete(
    "/api/admin/controlled-document-types/:typeKey",
    requireAuth,
    requireRole(SUPER_ROLES),
    async (req: Request, res: Response) => {
      const parsedKey = typeKeyParam.safeParse(req.params.typeKey);
      if (!parsedKey.success) throw badRequest("Invalid typeKey");
      try {
        const row = await deactivateDocumentType(parsedKey.data);
        res.json({ type: row });
      } catch (err) {
        console.error("[controlled-documents] deactivate type error:", err);
        const msg = err instanceof Error ? err.message : "Deactivate failed";
        if (/not found/i.test(msg)) throw notFound(msg);
        throw badRequest(msg);
      }
    },
  );

  // ====================================================================
  // D5.3 — per-project SharePoint root config (super-user)
  //   GET   /api/projects/:projectId/sharepoint-root  — any authed user
  //   PUT   /api/projects/:projectId/sharepoint-root  — super-user only
  // Metadata only. Real folder tree creation lives in D3.5 when Graph
  // integration lands — today we store the root path string so the
  // DocumentStrip + submit dialog know where to look.
  // ====================================================================

  app.get(
    "/api/projects/:projectId/sharepoint-root",
    requireAuth,
    async (req: Request, res: Response) => {
      const parsedId = projectIdParam.safeParse(req.params.projectId);
      if (!parsedId.success) throw badRequest("Invalid projectId");
      try {
        const root = await getProjectSharepointRoot(parsedId.data);
        res.json({ root });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[controlled-documents] get root error:", err);
        throw serverError("Failed to load SharePoint root");
      }
    },
  );

  app.put(
    "/api/projects/:projectId/sharepoint-root",
    requireAuth,
    requireRole(SUPER_ROLES),
    async (req: Request, res: Response) => {
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      const parsedId = projectIdParam.safeParse(req.params.projectId);
      if (!parsedId.success) throw badRequest("Invalid projectId");
      const parsedBody = upsertSharepointRootBodySchema.safeParse(req.body);
      if (!parsedBody.success) throw badRequest("Invalid SharePoint root payload");
      try {
        const row = await upsertProjectSharepointRoot({
          projectId: parsedId.data,
          rootPath: parsedBody.data.rootPath,
          driveId: parsedBody.data.driveId ?? null,
          rootItemId: parsedBody.data.rootItemId ?? null,
          userId: user.id,
        });
        res.json({ root: row });
      } catch (err) {
        console.error("[controlled-documents] upsert root error:", err);
        throw badRequest(err instanceof Error ? err.message : "Upsert failed");
      }
    },
  );
}
