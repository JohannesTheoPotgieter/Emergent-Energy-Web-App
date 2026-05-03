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
import { listManagedDocumentsByFolder } from "../repositories/managed-documents-repository";
import { listApprovalsForDocument } from "../services/managed-document-approvals-service";
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
  // GET /api/projects/:projectId/folders/:folderId/files
  // (D6 Phase 7) — managed_documents in a provisioned folder, joined
  // with their latest approval rows so the UI can render status badges
  // without a separate round trip per file.
  // ====================================================================
  app.get(
    "/api/projects/:projectId/folders/:folderId/files",
    requireAuth,
    requirePermission("documents", "view"),
    async (req: Request, res: Response) => {
      const parsedProject = projectIdParam.safeParse(req.params.projectId);
      const parsedFolder = z.coerce.number().int().positive().safeParse(req.params.folderId);
      if (!parsedProject.success) throw badRequest("Invalid projectId");
      if (!parsedFolder.success) throw badRequest("Invalid folderId");
      try {
        // Verify the folder belongs to the project so we can't be probed
        // for arbitrary projectFolders ids.
        const folders = await listFoldersForProject(parsedProject.data);
        const folder = folders.find((f) => f.id === parsedFolder.data);
        if (!folder) throw notFound("Folder not found for this project");

        const docs = await listManagedDocumentsByFolder(folder.id);
        const filesWithApprovals = await Promise.all(
          docs.map(async (d) => ({
            document: d,
            approvals: await listApprovalsForDocument(d.id),
          })),
        );
        res.json({
          projectId: parsedProject.data,
          folderId: folder.id,
          taxonomyKey: folder.taxonomyKey,
          files: filesWithApprovals,
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[doc-provisioning] folder files error:", err);
        throw serverError("Failed to load folder files");
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
