/**
 * Managed-document approvals routes (D6 Phase 5).
 *
 * Replaces the legacy controlled-documents submit/approve/reject/recall
 * endpoints. All flows now route through the canonical `approvals` table
 * with `approvalType='managed_document'`.
 *
 * Endpoints:
 *   POST /api/managed-documents/:id/request-approval
 *   GET  /api/managed-document-approvals/queue
 *   POST /api/managed-document-approvals/:id/approve
 *   POST /api/managed-document-approvals/:id/reject
 *
 * RBAC:
 *   - Request: documents:create  (uploader requesting their own file).
 *   - Approve / reject: documents:approve  (the assigned approver only —
 *     the service double-checks via assignedApprover === currentUser).
 *   - Queue read: documents:view (returns rows assigned to the caller).
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, getEffectiveUser } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";
import {
  ApiError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from "../lib/api-error";
import {
  requestApproval,
  recordApproval,
  recordRejection,
  getApprovalQueueForUser,
  listApprovalsForDocument,
} from "../services/managed-document-approvals-service";

const docIdParam = z.coerce.number().int().positive();
const approvalIdParam = z.coerce.number().int().positive();

const requestBodySchema = z.object({
  approverUserIds: z.array(z.number().int().positive()).min(1).max(10),
  comment: z.string().max(2000).optional(),
});
const approveBodySchema = z.object({
  comment: z.string().max(2000).optional(),
});
const rejectBodySchema = z.object({
  reason: z.string().min(1).max(2000),
});

function toApiError(err: unknown, fallback = "Request failed"): ApiError {
  if (err instanceof ApiError) return err;
  const msg = err instanceof Error ? err.message : fallback;
  if (/not found/i.test(msg)) return notFound(msg);
  if (/already (approved|rejected|in_review)|pending approval round|already exists/i.test(msg)) {
    return conflict(msg);
  }
  if (/only the assigned approver|not a managed-document/i.test(msg)) {
    return forbidden(msg);
  }
  return badRequest(msg || fallback);
}

export function registerManagedDocumentApprovalRoutes(app: Express): void {
  // ====================================================================
  // POST /api/managed-documents/:id/request-approval
  // ====================================================================
  app.post(
    "/api/managed-documents/:id/request-approval",
    requireAuth,
    requirePermission("documents", "create"),
    async (req: Request, res: Response) => {
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      const parsedId = docIdParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid document id");
      const parsedBody = requestBodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        throw badRequest("Invalid request payload", {
          issues: parsedBody.error.issues.map((i) => i.message).join("; "),
        });
      }
      try {
        const result = await requestApproval({
          managedDocumentId: parsedId.data,
          requestedByUserId: user.id,
          approverUserIds: parsedBody.data.approverUserIds,
          comment: parsedBody.data.comment,
        });
        logAuditFromReq(req, {
          entityType: "managed_document",
          entityId: String(parsedId.data),
          action: "request_approval",
          changesJson: {
            approverUserIds: parsedBody.data.approverUserIds,
            requirementId: result.requirement?.id ?? null,
          },
        });
        res.status(201).json(result);
      } catch (err) {
        console.error("[managed-doc-approvals] request error:", err);
        throw toApiError(err, "Failed to request approval");
      }
    },
  );

  // ====================================================================
  // GET /api/managed-document-approvals/queue
  // ====================================================================
  app.get(
    "/api/managed-document-approvals/queue",
    requireAuth,
    requirePermission("documents", "view"),
    async (req: Request, res: Response) => {
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      try {
        const rows = await getApprovalQueueForUser(user.id);
        res.json({ userId: user.id, rows });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[managed-doc-approvals] queue error:", err);
        throw serverError("Failed to load approval queue");
      }
    },
  );

  // ====================================================================
  // GET /api/managed-documents/:id/approvals
  // (full audit list — useful in the file detail drawer)
  // ====================================================================
  app.get(
    "/api/managed-documents/:id/approvals",
    requireAuth,
    requirePermission("documents", "view"),
    async (req: Request, res: Response) => {
      const parsedId = docIdParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid document id");
      try {
        const rows = await listApprovalsForDocument(parsedId.data);
        res.json({ documentId: parsedId.data, approvals: rows });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[managed-doc-approvals] list error:", err);
        throw serverError("Failed to load approvals");
      }
    },
  );

  // ====================================================================
  // POST /api/managed-document-approvals/:id/approve
  // ====================================================================
  app.post(
    "/api/managed-document-approvals/:id/approve",
    requireAuth,
    requirePermission("documents", "approve"),
    async (req: Request, res: Response) => {
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      const parsedId = approvalIdParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid approval id");
      const parsedBody = approveBodySchema.safeParse(req.body ?? {});
      if (!parsedBody.success) throw badRequest("Invalid approve payload");
      try {
        const result = await recordApproval({
          approvalId: parsedId.data,
          userId: user.id,
          comment: parsedBody.data.comment,
        });
        logAuditFromReq(req, {
          entityType: "managed_document",
          entityId: String(result.document?.id ?? parsedId.data),
          action: "approve",
          changesJson: {
            approvalId: parsedId.data,
            documentFinalised: result.documentFinalised,
          },
        });
        res.json(result);
      } catch (err) {
        console.error("[managed-doc-approvals] approve error:", err);
        throw toApiError(err, "Failed to record approval");
      }
    },
  );

  // ====================================================================
  // POST /api/managed-document-approvals/:id/reject
  // ====================================================================
  app.post(
    "/api/managed-document-approvals/:id/reject",
    requireAuth,
    requirePermission("documents", "approve"),
    async (req: Request, res: Response) => {
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      const parsedId = approvalIdParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid approval id");
      const parsedBody = rejectBodySchema.safeParse(req.body);
      if (!parsedBody.success) throw badRequest("Rejection reason required");
      try {
        const result = await recordRejection({
          approvalId: parsedId.data,
          userId: user.id,
          reason: parsedBody.data.reason,
        });
        logAuditFromReq(req, {
          entityType: "managed_document",
          entityId: String(result.document?.id ?? parsedId.data),
          action: "reject",
          changesJson: {
            approvalId: parsedId.data,
            cancelledSiblings: result.cancelledSiblings,
          },
        });
        res.json(result);
      } catch (err) {
        console.error("[managed-doc-approvals] reject error:", err);
        throw toApiError(err, "Failed to record rejection");
      }
    },
  );
}
