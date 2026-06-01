/**
 * Canonical folder-keyed live file I/O (D6 — project_folders surface).
 *
 * Stage 1 of the `project_sharepoint_roots` → `project_folders` migration.
 * These endpoints mirror the retired `/api/documents/:scope/:rootId/*`
 * browser, but resolve the SharePoint drive context from a provisioned
 * `project_folders` row (which already carries `driveId` + `itemId`)
 * instead of the deprecated `project_sharepoint_roots` table.
 *
 * This module is purely ADDITIVE — nothing is removed. The retired
 * endpoints (and company-scope browsing) stay live until the client is cut
 * over (Stage 2) and they're deleted (Stage 3). The doc-id-keyed endpoints
 * (checkout / checkin / revisions / owner / activity) are already
 * surface-agnostic and are not duplicated here.
 *
 * Access model mirrors the retired surface for parity:
 *   requireAuth → resolve folder (must belong to project + be provisioned)
 *   → per-folder ACL (resolveFolderAcl / canPerform, anchored on the
 *   folder's top-level taxonomy display name) → subtree containment
 *   → sharepoint-document-service → activity.
 */

import type { Express, Request, Response } from "express";
import multer from "multer";
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
import { listFoldersForProject } from "../repositories/project-folders-repository";
import { getTaxonomyByKey } from "../repositories/folder-taxonomy-repository";
import {
  getManagedDocumentByDriveItem,
  updatePathAndName,
} from "../repositories/managed-documents-repository";
import { getLock } from "../repositories/document-locks-repository";
import { recordActivity } from "../repositories/document-activity-repository";
import * as sp from "../services/sharepoint-document-service";
import * as workflow from "../services/document-workflow-service";
import {
  resolveFolderAcl,
  canPerform,
  type DocumentAction,
} from "../config/document-folder-rbac";
import type { ProjectFolder } from "@shared/schema/documents";

// ----- shared helpers ----------------------------------------------------

const projectIdParam = z.coerce.number().int().positive();
const folderIdParam = z.coerce.number().int().positive();
const graphItemIdSchema = z.string().min(1).max(256);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // simple-upload ceiling (mirrors retired surface)
});

const subfolderBody = z.object({
  parentItemId: z.string().min(1).max(256).nullable(),
  name: z.string().min(1).max(200),
});

const renameBody = z.object({
  name: z.string().min(1).max(200),
});

const uploadCompleteBody = z.object({
  parentItemId: z.string().min(1).max(256).nullable(),
  driveItemId: z.string().min(1).max(256),
  name: z.string().min(1).max(512),
  sizeBytes: z.number().int().nonnegative().optional(),
  sharepointVersionId: z.string().max(256).optional(),
  notes: z.string().max(2000).optional(),
});

/** A provisioned folder, narrowed so driveId/itemId are guaranteed present. */
type ProvisionedFolder = ProjectFolder & { driveId: string; itemId: string };

/**
 * Resolves a provisioned folder for a project. Asserts the folder belongs
 * to the project (so a folderId can't be probed across projects) and has a
 * usable Graph drive/item (else 409, mirroring the retired ROOT_NOT_CONFIGURED).
 */
async function resolveProjectFolder(
  projectId: number,
  folderId: number,
): Promise<ProvisionedFolder> {
  const folders = await listFoldersForProject(projectId);
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) throw notFound("Folder not found for this project");
  if (!folder.driveId || !folder.itemId) {
    throw new ApiError(
      409,
      "FOLDER_NOT_PROVISIONED",
      "This folder has not been provisioned to SharePoint yet.",
    );
  }
  return folder as ProvisionedFolder;
}

/**
 * The ACL anchor is the FIRST path segment under the project root — i.e.
 * the top-level taxonomy folder's display name (the name provisioning gives
 * the SharePoint folder). `resolveFolderAcl` keys off that first segment, so
 * the whole subtree under a provisioned folder shares a single ACL — exactly
 * as the retired surface behaved when browsing from the project root.
 */
async function folderAclAnchor(folder: ProjectFolder): Promise<string> {
  let entry = await getTaxonomyByKey(folder.taxonomyKey);
  // Walk up to the top-level taxonomy folder (guard against cycles).
  let guard = 0;
  while (entry?.parentKey && guard < 16) {
    entry = await getTaxonomyByKey(entry.parentKey);
    guard += 1;
  }
  return entry?.displayName ?? folder.taxonomyKey.split("/")[0];
}

function assertFolderAcl(
  anchor: string,
  role: string | null | undefined,
  action: DocumentAction,
): void {
  const acl = resolveFolderAcl("project", anchor);
  if (!canPerform(action, role ?? null, acl)) {
    throw forbidden("You don't have permission for that folder.");
  }
}

/**
 * Best-effort containment: keeps operations within the provisioned folder's
 * subtree so a folder-scoped endpoint can't be used to browse the whole
 * drive by passing an arbitrary itemId. Skipped only when the folder path is
 * unknown (e.g. the mock connector roots items at "").
 */
function assertWithinFolder(
  folder: ProvisionedFolder,
  itemPath: string | null | undefined,
): void {
  const base = (folder.sharepointPath ?? "").replace(/^\/+|\/+$/g, "").toLowerCase();
  if (!base) return; // cannot enforce without a known folder path
  const target = (itemPath ?? "").replace(/^\/+|\/+$/g, "").toLowerCase();
  if (target === base || target.startsWith(`${base}/`)) return;
  throw forbidden("That item is outside the selected folder.");
}

// ----- route registration -----------------------------------------------

export function registerDocumentFilesRoutes(app: Express): void {
  // GET /api/projects/:projectId/folders/:folderId/children?parentItemId=...
  app.get(
    "/api/projects/:projectId/folders/:folderId/children",
    requireAuth,
    async (req: Request, res: Response) => {
      const projectId = projectIdParam.safeParse(req.params.projectId);
      const folderId = folderIdParam.safeParse(req.params.folderId);
      if (!projectId.success || !folderId.success) throw badRequest("Invalid projectId or folderId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const folder = await resolveProjectFolder(projectId.data, folderId.data);
      assertFolderAcl(await folderAclAnchor(folder), user.role, "read");

      const parentItemId =
        typeof req.query.parentItemId === "string" && req.query.parentItemId.length > 0
          ? req.query.parentItemId
          : folder.itemId;
      if (parentItemId !== folder.itemId) {
        const parent = await sp.getItem(folder.driveId, parentItemId);
        if (!parent) throw notFound("Parent item");
        assertWithinFolder(folder, parent.path);
      }

      try {
        const items = await sp.listChildren(folder.driveId, parentItemId);
        res.json({
          folder: {
            id: folder.id,
            projectId: folder.projectId,
            taxonomyKey: folder.taxonomyKey,
            sharepointPath: folder.sharepointPath,
          },
          items,
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[document-files] children error:", err);
        throw serverError("Failed to list children");
      }
    },
  );

  // GET /api/projects/:projectId/folders/:folderId/item/:itemId
  app.get(
    "/api/projects/:projectId/folders/:folderId/item/:itemId",
    requireAuth,
    async (req: Request, res: Response) => {
      const projectId = projectIdParam.safeParse(req.params.projectId);
      const folderId = folderIdParam.safeParse(req.params.folderId);
      const itemId = graphItemIdSchema.safeParse(req.params.itemId);
      if (!projectId.success || !folderId.success || !itemId.success) throw badRequest("Invalid params");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const folder = await resolveProjectFolder(projectId.data, folderId.data);
      assertFolderAcl(await folderAclAnchor(folder), user.role, "read");

      const item = await sp.getItem(folder.driveId, itemId.data);
      if (!item) throw notFound("Item");
      assertWithinFolder(folder, item.path);

      const tracked = await getManagedDocumentByDriveItem(folder.driveId, itemId.data);
      const lock = tracked ? await getLock(tracked.id) : null;
      res.json({
        item,
        managedDocument: tracked ?? null,
        lock: lock ? { lockedByUserId: lock.lockedByUserId, lockedAt: lock.lockedAt } : null,
      });
    },
  );

  // GET /api/projects/:projectId/folders/:folderId/item/:itemId/download
  app.get(
    "/api/projects/:projectId/folders/:folderId/item/:itemId/download",
    requireAuth,
    async (req: Request, res: Response) => {
      const projectId = projectIdParam.safeParse(req.params.projectId);
      const folderId = folderIdParam.safeParse(req.params.folderId);
      const itemId = graphItemIdSchema.safeParse(req.params.itemId);
      if (!projectId.success || !folderId.success || !itemId.success) throw badRequest("Invalid params");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const folder = await resolveProjectFolder(projectId.data, folderId.data);
      assertFolderAcl(await folderAclAnchor(folder), user.role, "read");

      const item = await sp.getItem(folder.driveId, itemId.data);
      if (!item) throw notFound("Item");
      assertWithinFolder(folder, item.path);

      const { buffer, fileName, contentType } = await sp.downloadBuffer(folder.driveId, itemId.data);
      await recordActivity({
        userId: user.id,
        actorRole: user.role ?? null,
        rootScope: "project",
        projectId: folder.projectId,
        companyRootId: null,
        documentId: (await getManagedDocumentByDriveItem(folder.driveId, itemId.data))?.id ?? null,
        driveId: folder.driveId,
        itemId: item.id,
        itemPath: item.path,
        itemName: item.name,
        action: "download",
        sizeBytes: item.size ?? null,
      });
      // Strip CR/LF + quotes for header safety, and add RFC 5987 filename*
      // so non-ASCII names land correctly without breaking the header.
      const asciiSafe = fileName.replace(/[\r\n"\\]/g, "_");
      const encoded = encodeURIComponent(fileName);
      res.setHeader("Content-Type", contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encoded}`,
      );
      res.send(buffer);
    },
  );

  // POST /api/projects/:projectId/folders/:folderId/upload  (multipart, <4 MiB)
  app.post(
    "/api/projects/:projectId/folders/:folderId/upload",
    requireAuth,
    upload.single("file"),
    async (req: Request, res: Response) => {
      const projectId = projectIdParam.safeParse(req.params.projectId);
      const folderId = folderIdParam.safeParse(req.params.folderId);
      if (!projectId.success || !folderId.success) throw badRequest("Invalid projectId or folderId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const file = req.file;
      if (!file) throw badRequest("Missing file");
      const folder = await resolveProjectFolder(projectId.data, folderId.data);
      assertFolderAcl(await folderAclAnchor(folder), user.role, "write");

      // Upload into the provisioned folder by default; allow a sub-item parent
      // but keep it within the folder's subtree.
      const parentItemId =
        typeof req.body?.parentItemId === "string" && req.body.parentItemId.length > 0
          ? String(req.body.parentItemId)
          : folder.itemId;
      if (parentItemId !== folder.itemId) {
        const parent = await sp.getItem(folder.driveId, parentItemId);
        if (!parent) throw notFound("Parent item");
        assertWithinFolder(folder, parent.path);
      }

      try {
        const uploaded = await sp.simpleUpload({
          driveId: folder.driveId,
          parentItemId,
          fileName: file.originalname,
          body: file.buffer,
          userId: user.id,
        });
        const result = await workflow.completeUpload({
          rootScope: "project",
          projectId: folder.projectId,
          companyRootId: null,
          driveId: folder.driveId,
          driveItemId: uploaded.id,
          parentDriveItemId: parentItemId,
          name: uploaded.name,
          path: uploaded.path,
          sizeBytes: uploaded.size ?? file.size,
          userId: user.id,
          actorRole: user.role ?? null,
        });
        res.status(201).json({ item: uploaded, document: result.document, revision: result.revision });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[document-files] upload error:", err);
        throw serverError("Upload failed");
      }
    },
  );

  // POST /api/projects/:projectId/folders/:folderId/upload/complete
  //   For client-driven chunked uploads — client finished uploading bytes
  //   to Graph's uploadUrl, now record the revision.
  app.post(
    "/api/projects/:projectId/folders/:folderId/upload/complete",
    requireAuth,
    validateBody(uploadCompleteBody),
    async (req: Request, res: Response) => {
      const projectId = projectIdParam.safeParse(req.params.projectId);
      const folderId = folderIdParam.safeParse(req.params.folderId);
      if (!projectId.success || !folderId.success) throw badRequest("Invalid projectId or folderId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const body = req.body as z.infer<typeof uploadCompleteBody>;
      const folder = await resolveProjectFolder(projectId.data, folderId.data);
      assertFolderAcl(await folderAclAnchor(folder), user.role, "write");

      const uploaded = await sp.getItem(folder.driveId, body.driveItemId);
      if (!uploaded) throw notFound("Uploaded item");
      assertWithinFolder(folder, uploaded.path);

      const parentDriveItemId =
        (uploaded as { parentReference?: { id?: string } }).parentReference?.id ??
        body.parentItemId ??
        folder.itemId;

      const result = await workflow.completeUpload({
        rootScope: "project",
        projectId: folder.projectId,
        companyRootId: null,
        driveId: folder.driveId,
        driveItemId: uploaded.id,
        parentDriveItemId,
        name: uploaded.name,
        path: uploaded.path,
        sizeBytes: body.sizeBytes ?? uploaded.size ?? null,
        sharepointVersionId: body.sharepointVersionId ?? null,
        notes: body.notes ?? null,
        userId: user.id,
        actorRole: user.role ?? null,
      });
      res.status(201).json({ item: uploaded, document: result.document, revision: result.revision });
    },
  );

  // POST /api/projects/:projectId/folders/:folderId/subfolder
  app.post(
    "/api/projects/:projectId/folders/:folderId/subfolder",
    requireAuth,
    validateBody(subfolderBody),
    async (req: Request, res: Response) => {
      const projectId = projectIdParam.safeParse(req.params.projectId);
      const folderId = folderIdParam.safeParse(req.params.folderId);
      if (!projectId.success || !folderId.success) throw badRequest("Invalid projectId or folderId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const body = req.body as z.infer<typeof subfolderBody>;
      const folder = await resolveProjectFolder(projectId.data, folderId.data);
      assertFolderAcl(await folderAclAnchor(folder), user.role, "write");

      const parentItemId = body.parentItemId ?? folder.itemId;
      if (parentItemId !== folder.itemId) {
        const parent = await sp.getItem(folder.driveId, parentItemId);
        if (!parent) throw notFound("Parent item");
        assertWithinFolder(folder, parent.path);
      }

      const created = await sp.createFolder({
        driveId: folder.driveId,
        parentItemId,
        name: body.name,
        userId: user.id,
      });
      await recordActivity({
        userId: user.id,
        actorRole: user.role ?? null,
        rootScope: "project",
        projectId: folder.projectId,
        companyRootId: null,
        driveId: folder.driveId,
        itemId: created.id,
        itemPath: created.path,
        itemName: created.name,
        action: "create_folder",
      });
      res.status(201).json({ item: created });
    },
  );

  // PATCH /api/projects/:projectId/folders/:folderId/item/:itemId  (rename only)
  app.patch(
    "/api/projects/:projectId/folders/:folderId/item/:itemId",
    requireAuth,
    validateBody(renameBody),
    async (req: Request, res: Response) => {
      const projectId = projectIdParam.safeParse(req.params.projectId);
      const folderId = folderIdParam.safeParse(req.params.folderId);
      const graphItemId = graphItemIdSchema.safeParse(req.params.itemId);
      if (!projectId.success || !folderId.success || !graphItemId.success) throw badRequest("Invalid params");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const body = req.body as z.infer<typeof renameBody>;
      const folder = await resolveProjectFolder(projectId.data, folderId.data);
      assertFolderAcl(await folderAclAnchor(folder), user.role, "write");

      const before = await sp.getItem(folder.driveId, graphItemId.data);
      if (!before) throw notFound("Item");
      assertWithinFolder(folder, before.path);

      const tracked = await getManagedDocumentByDriveItem(folder.driveId, graphItemId.data);
      if (tracked) await workflow.assertUnlockedForUser(tracked.id, user.id);

      const renamed = await sp.renameItem({
        driveId: folder.driveId,
        itemId: graphItemId.data,
        newName: body.name,
        userId: user.id,
      });

      if (tracked) {
        await updatePathAndName(tracked.id, renamed.name, renamed.path);
      }

      await recordActivity({
        userId: user.id,
        actorRole: user.role ?? null,
        rootScope: "project",
        projectId: folder.projectId,
        companyRootId: null,
        documentId: tracked?.id ?? null,
        driveId: folder.driveId,
        itemId: graphItemId.data,
        itemPath: renamed.path,
        itemName: renamed.name,
        action: "rename",
        metadata: { from: before.name, to: renamed.name },
      });
      res.json({ item: renamed });
    },
  );
}
