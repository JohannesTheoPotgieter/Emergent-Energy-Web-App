/**
 * Project discipline-folder binding routes (browse-and-bind document setup).
 *
 * Replaces taxonomy-driven provisioning: per project, per discipline, the user
 * browses SharePoint (via the existing /api/documents browser) and binds an
 * existing folder. These endpoints persist that binding. Reads gate on
 * `documents:view`; binding/unbinding gate on `documents_provision` (COO/admin).
 * Bodies are Zod-validated; errors are ApiError only (no raw DB text — §5A).
 */

import type { Express, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth, getEffectiveUser } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { validateBody } from "../middleware/validateBody";
import { ApiError, badRequest, forbidden, notFound, serverError, unauthorized, logApiError } from "../lib/api-error";
import { LIFECYCLE_DEPARTMENTS } from "@shared/schema";
import * as repo from "../repositories/project-discipline-folders-repository";
import {
  listBoundFolderDocuments,
  listBoundFolderChildren,
  getBoundFolderItem,
  resolveBoundFolder,
  type ResolvedBoundFolder,
} from "../services/discipline-folder-documents-service";
import * as sp from "../services/sharepoint-document-service";
import * as workflow from "../services/document-workflow-service";
import { recordActivity } from "../repositories/document-activity-repository";
import { getManagedDocumentByDriveItem, updatePathAndName } from "../repositories/managed-documents-repository";
import { resolveProjectDocAnchor } from "../lib/document-acl";
import { resolveFolderAcl, canPerform, type DocumentAction } from "../config/document-folder-rbac";

const projectIdParam = z.coerce.number().int().positive();
const disciplineSchema = z.enum(LIFECYCLE_DEPARTMENTS);

export const disciplineFolderBindSchema = z.object({
  discipline: disciplineSchema,
  driveId: z.string().min(1).max(512),
  itemId: z.string().min(1).max(512),
  sharepointPath: z.string().max(2048).nullish(),
  webUrl: z.string().max(2048).nullish(),
});

function actorId(req: Request): number {
  const user = getEffectiveUser(req);
  if (!user) throw unauthorized();
  return user.id;
}

function handleError(scope: string, err: unknown): never {
  if (err instanceof ApiError) throw err;
  logApiError(`project-discipline-folders:${scope}`, err);
  throw serverError("Project document-folder request failed. Please retry.");
}

// ---- workspace browsing helpers ----------------------------------------

/** Small (<4 MiB) multipart upload, mirroring the company-scope browser. */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

const graphItemIdSchema = z.string().min(1).max(256);
const folderBody = z.object({
  parentItemId: z.string().min(1).max(256).nullable(),
  name: z.string().min(1).max(200),
});
const renameBody = z.object({ name: z.string().min(1).max(200) });

/**
 * App-level ACL for a discipline-scoped document operation. The anchor is the
 * bound discipline folder's discipline prefix (resolveProjectDocAnchor), so a
 * user must hold the folder ACL for that discipline to read/write here — the
 * same gate `assertDocumentAcl` applies to doc-id endpoints.
 */
async function assertDisciplineAcl(
  resolved: ResolvedBoundFolder,
  role: string | null | undefined,
  action: DocumentAction,
): Promise<void> {
  const anchor = await resolveProjectDocAnchor({
    projectId: resolved.binding.projectId,
    disciplineFolderId: resolved.binding.id,
    path: resolved.binding.sharepointPath ?? "",
  });
  const acl = resolveFolderAcl("project", anchor);
  if (!canPerform(action, role ?? null, acl)) {
    throw forbidden("You don't have permission for that folder.");
  }
}

export function registerProjectDisciplineFoldersRoutes(app: Express): void {
  // List the discipline folders bound for a project.
  app.get(
    "/api/projects/:projectId/discipline-folders",
    requireAuth,
    requirePermission("documents", "view"),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      if (!parsed.success) throw badRequest("Invalid project id");
      try {
        res.json({ folders: await repo.listDisciplineFoldersForProject(parsed.data) });
      } catch (err) {
        handleError("list", err);
      }
    },
  );

  // List the live contents of a project's bound discipline folder (read-only,
  // with tracked-document overlay).
  app.get(
    "/api/projects/:projectId/discipline-folders/:discipline/documents",
    requireAuth,
    requirePermission("documents", "view"),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      const disc = disciplineSchema.safeParse(req.params.discipline);
      if (!parsed.success) throw badRequest("Invalid project id");
      if (!disc.success) throw badRequest("Invalid discipline");
      try {
        res.json(await listBoundFolderDocuments(parsed.data, disc.data));
      } catch (err) {
        handleError("documents", err);
      }
    },
  );

  // ---- Workspace browsing (drill-in + item detail + writes) ------------
  // These reuse the generic /documents browser components on the client via a
  // discipline-scoped BrowseTarget. The bound discipline folder is the root;
  // GraphItem-shaped responses match the company-scope browser so FileListTable
  // / DocumentDetailDrawer work unchanged.

  // List children of parentItemId (default = bound folder root).
  app.get(
    "/api/projects/:projectId/discipline-folders/:discipline/children",
    requireAuth,
    requirePermission("documents", "view"),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      const disc = disciplineSchema.safeParse(req.params.discipline);
      if (!parsed.success) throw badRequest("Invalid project id");
      if (!disc.success) throw badRequest("Invalid discipline");
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      const parentItemId =
        typeof req.query.parentItemId === "string" && req.query.parentItemId.length > 0
          ? req.query.parentItemId
          : null;
      try {
        const resolved = await resolveBoundFolder(parsed.data, disc.data);
        await assertDisciplineAcl(resolved, user.role, "read");
        const items = await listBoundFolderChildren(resolved, parentItemId);
        res.json({
          root: { projectId: parsed.data, discipline: disc.data, rootItemId: resolved.rootItemId },
          items,
        });
      } catch (err) {
        handleError("children", err);
      }
    },
  );

  // Single item detail (file → managedDocument + lock overlay).
  app.get(
    "/api/projects/:projectId/discipline-folders/:discipline/item/:itemId",
    requireAuth,
    requirePermission("documents", "view"),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      const disc = disciplineSchema.safeParse(req.params.discipline);
      const itemId = graphItemIdSchema.safeParse(req.params.itemId);
      if (!parsed.success) throw badRequest("Invalid project id");
      if (!disc.success) throw badRequest("Invalid discipline");
      if (!itemId.success) throw badRequest("Invalid item id");
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      try {
        const resolved = await resolveBoundFolder(parsed.data, disc.data);
        await assertDisciplineAcl(resolved, user.role, "read");
        res.json(await getBoundFolderItem(resolved, itemId.data));
      } catch (err) {
        handleError("item", err);
      }
    },
  );

  // Upload a small file into parentItemId (default = bound folder root).
  app.post(
    "/api/projects/:projectId/discipline-folders/:discipline/upload",
    requireAuth,
    requirePermission("documents_provision", "edit"),
    upload.single("file"),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      const disc = disciplineSchema.safeParse(req.params.discipline);
      if (!parsed.success) throw badRequest("Invalid project id");
      if (!disc.success) throw badRequest("Invalid discipline");
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      const file = req.file;
      if (!file) throw badRequest("Missing file");
      try {
        const resolved = await resolveBoundFolder(parsed.data, disc.data);
        await assertDisciplineAcl(resolved, user.role, "write");
        const parentItemId =
          typeof req.body?.parentItemId === "string" && req.body.parentItemId.length > 0
            ? String(req.body.parentItemId)
            : resolved.rootItemId;
        const uploaded = await sp.simpleUpload({
          driveId: resolved.driveId,
          parentItemId,
          fileName: file.originalname,
          body: file.buffer,
          userId: user.id,
        });
        const result = await workflow.completeUpload({
          rootScope: "project",
          projectId: parsed.data,
          companyRootId: null,
          driveId: resolved.driveId,
          driveItemId: uploaded.id,
          name: uploaded.name,
          path: uploaded.path,
          sizeBytes: uploaded.size ?? file.size,
          userId: user.id,
          actorRole: user.role ?? null,
        });
        res.status(201).json({ item: uploaded, document: result.document, revision: result.revision });
      } catch (err) {
        handleError("upload", err);
      }
    },
  );

  // Create a subfolder under parentItemId (default = bound folder root).
  app.post(
    "/api/projects/:projectId/discipline-folders/:discipline/folder",
    requireAuth,
    requirePermission("documents_provision", "edit"),
    validateBody(folderBody),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      const disc = disciplineSchema.safeParse(req.params.discipline);
      if (!parsed.success) throw badRequest("Invalid project id");
      if (!disc.success) throw badRequest("Invalid discipline");
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      const body = req.body as z.infer<typeof folderBody>;
      try {
        const resolved = await resolveBoundFolder(parsed.data, disc.data);
        await assertDisciplineAcl(resolved, user.role, "write");
        const created = await sp.createFolder({
          driveId: resolved.driveId,
          parentItemId: body.parentItemId ?? resolved.rootItemId,
          name: body.name,
          userId: user.id,
        });
        await recordActivity({
          userId: user.id,
          actorRole: user.role ?? null,
          rootScope: "project",
          projectId: parsed.data,
          companyRootId: null,
          driveId: resolved.driveId,
          itemId: created.id,
          itemPath: created.path,
          itemName: created.name,
          action: "create_folder",
        });
        res.status(201).json({ item: created });
      } catch (err) {
        handleError("folder", err);
      }
    },
  );

  // Rename an item under the bound discipline folder.
  app.patch(
    "/api/projects/:projectId/discipline-folders/:discipline/item/:itemId",
    requireAuth,
    requirePermission("documents_provision", "edit"),
    validateBody(renameBody),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      const disc = disciplineSchema.safeParse(req.params.discipline);
      const itemId = graphItemIdSchema.safeParse(req.params.itemId);
      if (!parsed.success) throw badRequest("Invalid project id");
      if (!disc.success) throw badRequest("Invalid discipline");
      if (!itemId.success) throw badRequest("Invalid item id");
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      const body = req.body as z.infer<typeof renameBody>;
      try {
        const resolved = await resolveBoundFolder(parsed.data, disc.data);
        await assertDisciplineAcl(resolved, user.role, "write");
        const before = await sp.getItem(resolved.driveId, itemId.data);
        if (!before) throw notFound("Item");
        const tracked = await getManagedDocumentByDriveItem(resolved.driveId, itemId.data);
        if (tracked) await workflow.assertUnlockedForUser(tracked.id, user.id);
        const renamed = await sp.renameItem({
          driveId: resolved.driveId,
          itemId: itemId.data,
          newName: body.name,
          userId: user.id,
        });
        if (tracked) await updatePathAndName(tracked.id, renamed.name, renamed.path);
        await recordActivity({
          userId: user.id,
          actorRole: user.role ?? null,
          rootScope: "project",
          projectId: parsed.data,
          companyRootId: null,
          documentId: tracked?.id ?? null,
          driveId: resolved.driveId,
          itemId: itemId.data,
          itemPath: renamed.path,
          itemName: renamed.name,
          action: "rename",
          metadata: { from: before.name, to: renamed.name },
        });
        res.json({ item: renamed });
      } catch (err) {
        handleError("rename", err);
      }
    },
  );

  // Bind (or re-bind) a SharePoint folder to a discipline for a project.
  app.put(
    "/api/projects/:projectId/discipline-folders",
    requireAuth,
    requirePermission("documents_provision", "edit"),
    validateBody(disciplineFolderBindSchema),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      if (!parsed.success) throw badRequest("Invalid project id");
      const body = req.body as z.infer<typeof disciplineFolderBindSchema>;
      try {
        const folder = await repo.bindDisciplineFolder({
          projectId: parsed.data,
          discipline: body.discipline,
          driveId: body.driveId,
          itemId: body.itemId,
          sharepointPath: body.sharepointPath ?? null,
          webUrl: body.webUrl ?? null,
          boundByUserId: actorId(req),
        });
        res.json({ folder });
      } catch (err) {
        handleError("bind", err);
      }
    },
  );

  // Unbind a discipline's folder (soft delete).
  app.delete(
    "/api/projects/:projectId/discipline-folders/:discipline",
    requireAuth,
    requirePermission("documents_provision", "edit"),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      const disc = disciplineSchema.safeParse(req.params.discipline);
      if (!parsed.success) throw badRequest("Invalid project id");
      if (!disc.success) throw badRequest("Invalid discipline");
      try {
        const removed = await repo.unbindDisciplineFolder(parsed.data, disc.data, actorId(req));
        if (!removed) throw notFound("Discipline folder binding");
        res.json({ ok: true });
      } catch (err) {
        handleError("unbind", err);
      }
    },
  );
}
