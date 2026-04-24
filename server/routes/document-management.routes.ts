/**
 * Document management routes (generic SharePoint browser + versioning).
 *
 * See docs/ARCHITECTURE… and shared/schema/documents.ts for the model.
 * Every handler follows: requireAuth → validate → resolve root +
 * managedDocument → app-level ACL → lock preflight (for writes) →
 * service → activity.record → response shape.
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
import {
  DOCUMENT_ACTIVITY_ACTIONS,
  DOCUMENT_ROOT_SCOPES,
  type DocumentRootScope,
} from "@shared/schema/documents";
import {
  listActiveCompanyRoots,
  getCompanyRootById,
} from "../repositories/company-sharepoint-roots-repository";
import {
  getProjectRootById,
  listProjectsWithRoots,
} from "../repositories/project-sharepoint-roots-repository";
import {
  getManagedDocumentById,
  getManagedDocumentByDriveItem,
  updatePathAndName,
} from "../repositories/managed-documents-repository";
import { listRevisionsForDocument } from "../repositories/document-revisions-repository";
import { getLock } from "../repositories/document-locks-repository";
import { listActivity, recordActivity } from "../repositories/document-activity-repository";
import * as sp from "../services/sharepoint-document-service";
import * as workflow from "../services/document-workflow-service";
import {
  resolveFolderAcl,
  canPerform,
  type DocumentAction,
} from "../config/document-folder-rbac";

// ----- shared helpers ----------------------------------------------------

const scopeSchema = z.enum(DOCUMENT_ROOT_SCOPES);
const rootIdSchema = z.coerce.number().int().positive();
const documentIdSchema = z.coerce.number().int().positive();
const graphItemIdSchema = z.string().min(1).max(256);

interface ResolvedRoot {
  scope: DocumentRootScope;
  driveId: string;
  rootItemId: string | null;
  displayName: string;
  projectId: number | null;
  companyRootId: number | null;
  rootPath: string;
}

async function resolveRoot(
  scope: DocumentRootScope,
  rootId: number,
): Promise<ResolvedRoot> {
  if (scope === "project") {
    const r = await getProjectRootById(rootId);
    if (!r) throw notFound("Project root");
    if (!r.driveId) throw new ApiError(409, "ROOT_NOT_CONFIGURED", "Project SharePoint root is not fully configured yet.");
    return {
      scope,
      driveId: r.driveId,
      rootItemId: r.rootItemId,
      displayName: r.rootPath,
      projectId: r.projectId,
      companyRootId: null,
      rootPath: r.rootPath,
    };
  }
  const r = await getCompanyRootById(rootId);
  if (!r) throw notFound("Company root");
  if (!r.driveId) throw new ApiError(409, "ROOT_NOT_CONFIGURED", "Company SharePoint root is not fully configured yet.");
  return {
    scope,
    driveId: r.driveId,
    rootItemId: r.rootItemId,
    displayName: r.displayName,
    projectId: null,
    companyRootId: r.id,
    rootPath: r.rootPath,
  };
}

function pathUnderRoot(fullPath: string, rootPath: string): string {
  const normRoot = rootPath.replace(/^\/+|\/+$/g, "");
  const normFull = fullPath.replace(/^\/+/g, "");
  if (normRoot && normFull.startsWith(normRoot)) {
    return normFull.slice(normRoot.length).replace(/^\/+/, "");
  }
  return normFull;
}

function assertAcl(
  scope: DocumentRootScope,
  pathForAcl: string,
  role: string | null | undefined,
  action: DocumentAction,
): void {
  const acl = resolveFolderAcl(scope, pathForAcl);
  if (!canPerform(action, role ?? null, acl)) {
    throw forbidden("You don't have permission for that folder.");
  }
}

/**
 * Asserts a user can perform `action` on a tracked managed document — used
 * for doc-id-based endpoints (checkout, checkin, revisions, comments, owner).
 * Resolves the document's root, computes its folder-relative path, and
 * delegates to `assertAcl`. This closes the gap where a user who never
 * had access to a folder could still touch a document via its id.
 */
async function assertDocumentAcl(
  tracked: { id: number; rootScope: DocumentRootScope; projectId: number | null; companyRootId: number | null; path: string },
  role: string | null | undefined,
  action: DocumentAction,
): Promise<void> {
  let rootPath = "";
  if (tracked.rootScope === "project" && tracked.projectId != null) {
    // Use projectSharepointRoots lookup — root path is stored by project id,
    // but we look it up via the projectSharepointRoots repo's getByProjectId
    // alias. Avoid a second db call when we already have the path on the
    // document (path is relative to the drive root in our mock + real Graph).
    rootPath = "";
  } else if (tracked.rootScope === "company" && tracked.companyRootId != null) {
    const r = await getCompanyRootById(tracked.companyRootId);
    rootPath = r?.rootPath ?? "";
  }
  assertAcl(tracked.rootScope, pathUnderRoot(tracked.path, rootPath), role, action);
}

// ----- upload (small) ----------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // simple upload ceiling
});

// ----- Zod bodies --------------------------------------------------------

const folderBody = z.object({
  parentItemId: z.string().min(1).max(256).nullable(),
  name: z.string().min(1).max(200),
});

const renameBody = z.object({
  name: z.string().min(1).max(200),
});

const ownerBody = z.object({
  ownerUserId: z.number().int().positive(),
});

const checkinBody = z.object({
  comment: z.string().max(2000).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  sharepointVersionId: z.string().max(256).optional(),
});

const uploadCompleteBody = z.object({
  parentItemId: z.string().min(1).max(256).nullable(),
  driveItemId: z.string().min(1).max(256),
  name: z.string().min(1).max(512),
  sizeBytes: z.number().int().nonnegative().optional(),
  sharepointVersionId: z.string().max(256).optional(),
  notes: z.string().max(2000).optional(),
});

// ----- route registration -----------------------------------------------

export function registerDocumentManagementRoutes(app: Express): void {
  // GET /api/documents/roots
  app.get("/api/documents/roots", requireAuth, async (_req: Request, res: Response) => {
    try {
      const [companyRoots, projectsWithRoots] = await Promise.all([
        listActiveCompanyRoots(),
        listProjectsWithRoots(),
      ]);
      res.json({
        company: companyRoots.map((r) => ({
          id: r.id,
          kind: r.kind,
          displayName: r.displayName,
          rootPath: r.rootPath,
          hasDrive: !!r.driveId,
        })),
        project: projectsWithRoots.map((p) => ({
          id: p.root.id,
          projectId: p.projectId,
          name: p.projectName,
          projectCode: p.projectCode ?? null,
          rootPath: p.root.rootPath,
          hasDrive: !!p.root.driveId,
        })),
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      console.error("[documents] roots error:", err);
      throw serverError("Failed to load document roots");
    }
  });

  // GET /api/documents/:scope/:rootId/children?parentItemId=...
  app.get(
    "/api/documents/:scope/:rootId/children",
    requireAuth,
    async (req: Request, res: Response) => {
      const scope = scopeSchema.safeParse(req.params.scope);
      const rootId = rootIdSchema.safeParse(req.params.rootId);
      if (!scope.success || !rootId.success) throw badRequest("Invalid scope or rootId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const root = await resolveRoot(scope.data, rootId.data);
      const parentItemId = typeof req.query.parentItemId === "string" && req.query.parentItemId.length > 0
        ? req.query.parentItemId
        : root.rootItemId;
      // Derive the ACL-relevant path from the parent item (if any) so we can
      // gate children-listing on read permission for that folder.
      let pathForAcl = "";
      if (parentItemId && parentItemId !== root.rootItemId) {
        const parent = await sp.getItem(root.driveId, parentItemId);
        if (parent) pathForAcl = pathUnderRoot(parent.path, root.rootPath);
      }
      assertAcl(root.scope, pathForAcl, user.role, "read");
      try {
        const items = await sp.listChildren(root.driveId, parentItemId);
        res.json({
          root: { scope: root.scope, id: rootId.data, rootPath: root.rootPath },
          items,
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[documents] children error:", err);
        throw serverError("Failed to list children");
      }
    },
  );

  // GET /api/documents/:scope/:rootId/item/:itemId
  app.get(
    "/api/documents/:scope/:rootId/item/:itemId",
    requireAuth,
    async (req: Request, res: Response) => {
      const scope = scopeSchema.safeParse(req.params.scope);
      const rootId = rootIdSchema.safeParse(req.params.rootId);
      const itemId = graphItemIdSchema.safeParse(req.params.itemId);
      if (!scope.success || !rootId.success || !itemId.success) throw badRequest("Invalid params");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const root = await resolveRoot(scope.data, rootId.data);
      const item = await sp.getItem(root.driveId, itemId.data);
      if (!item) throw notFound("Item");
      assertAcl(root.scope, pathUnderRoot(item.path, root.rootPath), user.role, "read");
      const tracked = await getManagedDocumentByDriveItem(root.driveId, itemId.data);
      const lock = tracked ? await getLock(tracked.id) : null;
      res.json({
        item,
        managedDocument: tracked ?? null,
        lock: lock
          ? { lockedByUserId: lock.lockedByUserId, lockedAt: lock.lockedAt }
          : null,
      });
    },
  );

  // GET /api/documents/:scope/:rootId/item/:itemId/download
  app.get(
    "/api/documents/:scope/:rootId/item/:itemId/download",
    requireAuth,
    async (req: Request, res: Response) => {
      const scope = scopeSchema.safeParse(req.params.scope);
      const rootId = rootIdSchema.safeParse(req.params.rootId);
      const itemId = graphItemIdSchema.safeParse(req.params.itemId);
      if (!scope.success || !rootId.success || !itemId.success) throw badRequest("Invalid params");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const root = await resolveRoot(scope.data, rootId.data);
      const item = await sp.getItem(root.driveId, itemId.data);
      if (!item) throw notFound("Item");
      assertAcl(root.scope, pathUnderRoot(item.path, root.rootPath), user.role, "read");
      const { buffer, fileName, contentType } = await sp.downloadBuffer(root.driveId, itemId.data);
      await recordActivity({
        userId: user.id,
        actorRole: user.role ?? null,
        rootScope: root.scope,
        projectId: root.projectId,
        companyRootId: root.companyRootId,
        documentId: (await getManagedDocumentByDriveItem(root.driveId, itemId.data))?.id ?? null,
        driveId: root.driveId,
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

  // POST /api/documents/:scope/:rootId/upload  (multipart, <4 MiB)
  app.post(
    "/api/documents/:scope/:rootId/upload",
    requireAuth,
    upload.single("file"),
    async (req: Request, res: Response) => {
      const scope = scopeSchema.safeParse(req.params.scope);
      const rootId = rootIdSchema.safeParse(req.params.rootId);
      if (!scope.success || !rootId.success) throw badRequest("Invalid scope or rootId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const file = req.file;
      if (!file) throw badRequest("Missing file");
      const parentItemId = typeof req.body?.parentItemId === "string" && req.body.parentItemId.length > 0
        ? String(req.body.parentItemId)
        : null;
      const root = await resolveRoot(scope.data, rootId.data);
      // Derive relative path for ACL — best-effort using parent item's path.
      let pathForAcl = "";
      if (parentItemId) {
        const parent = await sp.getItem(root.driveId, parentItemId);
        if (parent) pathForAcl = pathUnderRoot(parent.path, root.rootPath);
      }
      assertAcl(root.scope, pathForAcl, user.role, "write");

      try {
        const uploaded = await sp.simpleUpload({
          driveId: root.driveId,
          parentItemId,
          fileName: file.originalname,
          body: file.buffer,
          userId: user.id,
        });
        const result = await workflow.completeUpload({
          rootScope: root.scope,
          projectId: root.projectId,
          companyRootId: root.companyRootId,
          driveId: root.driveId,
          driveItemId: uploaded.id,
          name: uploaded.name,
          path: uploaded.path,
          sizeBytes: uploaded.size ?? file.size,
          userId: user.id,
          actorRole: user.role ?? null,
        });
        res.status(201).json({ item: uploaded, document: result.document, revision: result.revision });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[documents] upload error:", err);
        throw serverError("Upload failed");
      }
    },
  );

  // POST /api/documents/:scope/:rootId/upload/complete
  //   For client-driven chunked uploads — client finished uploading bytes
  //   to Graph's uploadUrl, now record the revision.
  app.post(
    "/api/documents/:scope/:rootId/upload/complete",
    requireAuth,
    validateBody(uploadCompleteBody),
    async (req: Request, res: Response) => {
      const scope = scopeSchema.safeParse(req.params.scope);
      const rootId = rootIdSchema.safeParse(req.params.rootId);
      if (!scope.success || !rootId.success) throw badRequest("Invalid scope or rootId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const body = req.body as z.infer<typeof uploadCompleteBody>;
      const root = await resolveRoot(scope.data, rootId.data);

      const uploaded = await sp.getItem(root.driveId, body.driveItemId);
      if (!uploaded) throw notFound("Uploaded item");
      assertAcl(root.scope, pathUnderRoot(uploaded.path, root.rootPath), user.role, "write");

      const result = await workflow.completeUpload({
        rootScope: root.scope,
        projectId: root.projectId,
        companyRootId: root.companyRootId,
        driveId: root.driveId,
        driveItemId: uploaded.id,
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

  // POST /api/documents/:scope/:rootId/folder
  app.post(
    "/api/documents/:scope/:rootId/folder",
    requireAuth,
    validateBody(folderBody),
    async (req: Request, res: Response) => {
      const scope = scopeSchema.safeParse(req.params.scope);
      const rootId = rootIdSchema.safeParse(req.params.rootId);
      if (!scope.success || !rootId.success) throw badRequest("Invalid scope or rootId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const body = req.body as z.infer<typeof folderBody>;
      const root = await resolveRoot(scope.data, rootId.data);
      // Derive parent path for ACL
      let pathForAcl = "";
      if (body.parentItemId) {
        const parent = await sp.getItem(root.driveId, body.parentItemId);
        if (parent) pathForAcl = pathUnderRoot(parent.path, root.rootPath);
      }
      assertAcl(root.scope, pathForAcl, user.role, "write");

      const created = await sp.createFolder({
        driveId: root.driveId,
        parentItemId: body.parentItemId,
        name: body.name,
        userId: user.id,
      });
      await recordActivity({
        userId: user.id,
        actorRole: user.role ?? null,
        rootScope: root.scope,
        projectId: root.projectId,
        companyRootId: root.companyRootId,
        driveId: root.driveId,
        itemId: created.id,
        itemPath: created.path,
        itemName: created.name,
        action: "create_folder",
      });
      res.status(201).json({ item: created });
    },
  );

  // PATCH /api/documents/:scope/:rootId/item/:itemId  (rename only)
  app.patch(
    "/api/documents/:scope/:rootId/item/:itemId",
    requireAuth,
    validateBody(renameBody),
    async (req: Request, res: Response) => {
      const scope = scopeSchema.safeParse(req.params.scope);
      const rootId = rootIdSchema.safeParse(req.params.rootId);
      const graphItemId = graphItemIdSchema.safeParse(req.params.itemId);
      if (!scope.success || !rootId.success || !graphItemId.success) throw badRequest("Invalid params");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const body = req.body as z.infer<typeof renameBody>;
      const root = await resolveRoot(scope.data, rootId.data);

      const before = await sp.getItem(root.driveId, graphItemId.data);
      if (!before) throw notFound("Item");
      assertAcl(root.scope, pathUnderRoot(before.path, root.rootPath), user.role, "write");

      const tracked = await getManagedDocumentByDriveItem(root.driveId, graphItemId.data);
      if (tracked) await workflow.assertUnlockedForUser(tracked.id, user.id);

      const renamed = await sp.renameItem({
        driveId: root.driveId,
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
        rootScope: root.scope,
        projectId: root.projectId,
        companyRootId: root.companyRootId,
        documentId: tracked?.id ?? null,
        driveId: root.driveId,
        itemId: graphItemId.data,
        itemPath: renamed.path,
        itemName: renamed.name,
        action: "rename",
        metadata: { from: before.name, to: renamed.name },
      });
      res.json({ item: renamed });
    },
  );

  // PATCH /api/documents/:docId/owner
  app.patch(
    "/api/documents/:docId/owner",
    requireAuth,
    validateBody(ownerBody),
    async (req: Request, res: Response) => {
      const docId = documentIdSchema.safeParse(req.params.docId);
      if (!docId.success) throw badRequest("Invalid docId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const body = req.body as z.infer<typeof ownerBody>;
      const tracked = await getManagedDocumentById(docId.data);
      if (!tracked) throw notFound("Document");
      await assertDocumentAcl(tracked, user.role, "write");
      const isSuper = user.role === "COO_ADMIN" || user.role === "CEO_ADMIN";
      const isCurrentOwner = tracked.ownerUserId === user.id;
      if (!isSuper && !isCurrentOwner) {
        throw forbidden("Only the document owner or an admin can transfer ownership.");
      }
      const updated = await workflow.changeOwner(tracked.id, body.ownerUserId, user.id);
      res.json({ document: updated });
    },
  );

  // GET /api/documents/:docId/revisions
  app.get(
    "/api/documents/:docId/revisions",
    requireAuth,
    async (req: Request, res: Response) => {
      const docId = documentIdSchema.safeParse(req.params.docId);
      if (!docId.success) throw badRequest("Invalid docId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const tracked = await getManagedDocumentById(docId.data);
      if (!tracked) throw notFound("Document");
      await assertDocumentAcl(tracked, user.role, "read");
      const revs = await listRevisionsForDocument(tracked.id);
      res.json({ revisions: revs });
    },
  );

  // POST /api/documents/:docId/revisions/:revId/restore
  app.post(
    "/api/documents/:docId/revisions/:revId/restore",
    requireAuth,
    async (req: Request, res: Response) => {
      const docId = documentIdSchema.safeParse(req.params.docId);
      const revId = z.coerce.number().int().positive().safeParse(req.params.revId);
      if (!docId.success || !revId.success) throw badRequest("Invalid params");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const tracked = await getManagedDocumentById(docId.data);
      if (!tracked) throw notFound("Document");
      await assertDocumentAcl(tracked, user.role, "write");
      const revs = await listRevisionsForDocument(tracked.id);
      const target = revs.find((r) => r.id === revId.data);
      if (!target) throw notFound("Revision");
      if (!target.sharepointVersionId) {
        throw badRequest("This revision has no SharePoint version id to restore from.");
      }
      await workflow.assertUnlockedForUser(tracked.id, user.id);
      await sp.restoreVersion(tracked.driveId, tracked.driveItemId, target.sharepointVersionId, user.id);
      await recordActivity({
        userId: user.id,
        actorRole: user.role ?? null,
        rootScope: tracked.rootScope,
        projectId: tracked.projectId ?? null,
        companyRootId: tracked.companyRootId ?? null,
        documentId: tracked.id,
        revisionId: target.id,
        driveId: tracked.driveId,
        itemId: tracked.driveItemId,
        itemPath: tracked.path,
        itemName: tracked.name,
        action: "restore_revision",
      });
      res.json({ ok: true });
    },
  );

  // POST /api/documents/:docId/checkout
  app.post(
    "/api/documents/:docId/checkout",
    requireAuth,
    async (req: Request, res: Response) => {
      const docId = documentIdSchema.safeParse(req.params.docId);
      if (!docId.success) throw badRequest("Invalid docId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const tracked = await getManagedDocumentById(docId.data);
      if (!tracked) throw notFound("Document");
      await assertDocumentAcl(tracked, user.role, "write");
      await workflow.assertUnlockedForUser(tracked.id, user.id);
      await sp.checkout(tracked.driveId, tracked.driveItemId, user.id);
      await workflow.recordCheckout(tracked.id, user.id);
      res.json({ ok: true });
    },
  );

  // POST /api/documents/:docId/checkin
  app.post(
    "/api/documents/:docId/checkin",
    requireAuth,
    validateBody(checkinBody),
    async (req: Request, res: Response) => {
      const docId = documentIdSchema.safeParse(req.params.docId);
      if (!docId.success) throw badRequest("Invalid docId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const body = req.body as z.infer<typeof checkinBody>;
      const tracked = await getManagedDocumentById(docId.data);
      if (!tracked) throw notFound("Document");
      await assertDocumentAcl(tracked, user.role, "write");
      const lock = await getLock(tracked.id);
      if (lock && lock.lockedByUserId !== user.id) {
        throw new ApiError(423, "LOCKED", "This document is checked out by another user.");
      }
      await sp.checkin(tracked.driveId, tracked.driveItemId, user.id, body.comment);
      const revision = await workflow.recordCheckin(
        tracked.id,
        user.id,
        body.comment ?? null,
        body.sizeBytes != null || body.sharepointVersionId != null
          ? {
              sizeBytes: body.sizeBytes ?? null,
              sharepointVersionId: body.sharepointVersionId ?? null,
            }
          : null,
      );
      res.json({ ok: true, revision });
    },
  );

  // POST /api/documents/:docId/checkin/discard
  app.post(
    "/api/documents/:docId/checkin/discard",
    requireAuth,
    async (req: Request, res: Response) => {
      const docId = documentIdSchema.safeParse(req.params.docId);
      if (!docId.success) throw badRequest("Invalid docId");
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const tracked = await getManagedDocumentById(docId.data);
      if (!tracked) throw notFound("Document");
      await assertDocumentAcl(tracked, user.role, "write");
      const lock = await getLock(tracked.id);
      if (lock && lock.lockedByUserId !== user.id) {
        throw new ApiError(423, "LOCKED", "This document is checked out by another user.");
      }
      await sp.discardCheckout(tracked.driveId, tracked.driveItemId, user.id);
      await workflow.recordDiscardCheckout(tracked.id, user.id);
      res.json({ ok: true });
    },
  );

  // GET /api/documents/activity
  app.get(
    "/api/documents/activity",
    requireAuth,
    async (req: Request, res: Response) => {
      const user = getEffectiveUser(req);
      if (!user) throw forbidden("Authentication required");
      const filters = z
        .object({
          projectId: z.coerce.number().int().positive().optional(),
          documentId: z.coerce.number().int().positive().optional(),
          userId: z.coerce.number().int().positive().optional(),
          action: z.enum(DOCUMENT_ACTIVITY_ACTIONS).optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        })
        .safeParse(req.query);
      if (!filters.success) throw badRequest("Invalid filters");
      const isSuper = user.role === "COO_ADMIN" || user.role === "CEO_ADMIN";
      // Non-super users must scope by a specific document or project so they
      // can't trawl cross-project activity. Super-users (COO/CEO) see all.
      if (!isSuper && filters.data.documentId == null && filters.data.projectId == null) {
        throw badRequest("Specify a projectId or documentId to list activity.");
      }
      // When scoped by documentId, enforce the folder ACL so users can't read
      // activity for documents they have no access to.
      if (filters.data.documentId != null) {
        const tracked = await getManagedDocumentById(filters.data.documentId);
        if (!tracked) throw notFound("Document");
        await assertDocumentAcl(tracked, user.role, "read");
      }
      const rows = await listActivity({
        projectId: filters.data.projectId,
        documentId: filters.data.documentId,
        userId: filters.data.userId,
        action: filters.data.action,
        limit: filters.data.limit,
      });
      res.json({ activity: rows });
    },
  );
}
