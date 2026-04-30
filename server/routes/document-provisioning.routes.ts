/**
 * Folder provisioning routes (D6 Phase 3).
 *
 * Exposes the provisioning service over HTTP. COO/CEO (or any user with
 * the documents_provision:create permission) triggers the canonical
 * Active Clients tree creation for a project. Read endpoints power the
 * project-detail panel + admin status table.
 *
 * Endpoints:
 *   POST /api/projects/:projectId/provision-folders
 *     body: { lifecycleMode: 'pre_construction' | 'full_lifecycle' | 'both' }
 *     gate: documents_provision:create
 *
 *   POST /api/projects/:projectId/verify-folders
 *     body: {}
 *     gate: documents_provision:create
 *
 *   GET  /api/projects/:projectId/folders
 *     gate: documents:view
 *
 * Mock-connector aware via the underlying sharepoint-document-service.
 * Audit-logs every mutation.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, getEffectiveUser } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";
import {
  ApiError,
  badRequest,
  notFound,
  serverError,
  unauthorized,
} from "../lib/api-error";
import {
  provisionProjectFolders,
  verifyProjectFolders,
} from "../services/folder-provisioning-service";
import { listFoldersForProject } from "../repositories/project-folders-repository";
import { FOLDER_LIFECYCLE_MODES } from "@shared/schema/documents";

const projectIdParam = z.coerce.number().int().positive();

const provisionBodySchema = z.object({
  lifecycleMode: z.enum(FOLDER_LIFECYCLE_MODES),
});

export function registerDocumentProvisioningRoutes(app: Express): void {
  // ====================================================================
  // GET /api/projects/:projectId/folders
  // ====================================================================
  app.get(
    "/api/projects/:projectId/folders",
    requireAuth,
    requirePermission("documents", "view"),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      if (!parsed.success) throw badRequest("Invalid projectId");
      try {
        const folders = await listFoldersForProject(parsed.data);
        res.json({ projectId: parsed.data, folders });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[doc-provisioning] list folders error:", err);
        throw serverError("Failed to load project folders");
      }
    },
  );

  // ====================================================================
  // POST /api/projects/:projectId/provision-folders
  // ====================================================================
  app.post(
    "/api/projects/:projectId/provision-folders",
    requireAuth,
    requirePermission("documents_provision", "create"),
    async (req: Request, res: Response) => {
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      const parsedId = projectIdParam.safeParse(req.params.projectId);
      if (!parsedId.success) throw badRequest("Invalid projectId");
      const parsedBody = provisionBodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        throw badRequest("Invalid provision payload", {
          issues: parsedBody.error.issues.map((i) => i.message).join("; "),
        });
      }
      try {
        const result = await provisionProjectFolders({
          projectId: parsedId.data,
          lifecycleMode: parsedBody.data.lifecycleMode,
          userId: user.id,
        });
        logAuditFromReq(req, {
          entityType: "project_folders",
          entityId: String(parsedId.data),
          action: "provision",
          changesJson: {
            lifecycleMode: parsedBody.data.lifecycleMode,
            summary: result.summary,
          },
        });
        res.json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Provisioning failed";
        if (/not found/i.test(msg)) throw notFound(msg);
        if (/no company sharepoint root|no driveId/i.test(msg)) throw badRequest(msg);
        console.error("[doc-provisioning] provision error:", err);
        throw serverError(msg);
      }
    },
  );

  // ====================================================================
  // POST /api/projects/:projectId/verify-folders
  // ====================================================================
  app.post(
    "/api/projects/:projectId/verify-folders",
    requireAuth,
    requirePermission("documents_provision", "create"),
    async (req: Request, res: Response) => {
      const parsedId = projectIdParam.safeParse(req.params.projectId);
      if (!parsedId.success) throw badRequest("Invalid projectId");
      try {
        const result = await verifyProjectFolders({ projectId: parsedId.data });
        logAuditFromReq(req, {
          entityType: "project_folders",
          entityId: String(parsedId.data),
          action: "verify",
          changesJson: result,
        });
        res.json(result);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[doc-provisioning] verify error:", err);
        throw serverError(err instanceof Error ? err.message : "Verify failed");
      }
    },
  );
}
