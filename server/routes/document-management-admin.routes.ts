/**
 * Document Management v2 — admin routes (D6 Phase 2).
 *
 * Folder taxonomy + approval requirements CRUD for super-users.
 *
 * Endpoints:
 *   Public read (any authed user — drives the discipline panels):
 *     GET /api/folder-taxonomy
 *     GET /api/folder-taxonomy/:internalKey
 *
 *   Admin (documents_admin entity, edit action gates writes):
 *     GET    /api/admin/folder-taxonomy                     — incl. inactive
 *     POST   /api/admin/folder-taxonomy                     — create
 *     PATCH  /api/admin/folder-taxonomy/:internalKey        — update
 *     DELETE /api/admin/folder-taxonomy/:internalKey        — soft-delete
 *
 *     GET    /api/admin/document-approval-requirements      — incl. inactive
 *     POST   /api/admin/document-approval-requirements      — create
 *     PATCH  /api/admin/document-approval-requirements/:id  — update
 *     DELETE /api/admin/document-approval-requirements/:id  — soft-delete
 *
 * All mutations route through the repositories — no direct db calls
 * (CLAUDE.md §Repository layer). Errors map to ApiError; raw repo errors
 * never escape to the client.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";
import {
  ApiError,
  badRequest,
  conflict,
  notFound,
  serverError,
} from "../lib/api-error";
import {
  listActiveTaxonomy,
  listAllTaxonomy,
  getTaxonomyByKey,
  createTaxonomyRow,
  updateTaxonomyRow,
  deactivateTaxonomyRow,
} from "../repositories/folder-taxonomy-repository";
import {
  listActiveRequirements,
  listAllRequirements,
  getRequirementById,
  createRequirement,
  updateRequirement,
  deactivateRequirement,
} from "../repositories/document-approval-requirements-repository";
import {
  insertFolderTaxonomySchema,
  insertDocumentApprovalRequirementSchema,
} from "@shared/schema/documents";

const internalKeyParam = z.string().min(1).max(128).regex(/^[a-z0-9_/]+$/, {
  message: "internalKey must be lowercase letters, numbers, underscores, or '/'.",
});

const requirementIdParam = z.coerce.number().int().positive();

const taxonomyUpdateBodySchema = insertFolderTaxonomySchema.partial();
const requirementUpdateBodySchema = insertDocumentApprovalRequirementSchema.partial();

/** Translate repo Error.message into the right ApiError. */
function toApiError(err: unknown, fallback = "Request failed"): ApiError {
  if (err instanceof ApiError) return err;
  const msg = err instanceof Error ? err.message : fallback;
  if (/not found/i.test(msg)) return notFound(msg);
  if (/already exists/i.test(msg)) return conflict(msg);
  return badRequest(msg || fallback);
}

export function registerDocumentManagementAdminRoutes(app: Express): void {
  // ====================================================================
  // Public read — any authenticated user. Drives discipline panels +
  // future taxonomy-aware browser.
  // ====================================================================

  app.get(
    "/api/folder-taxonomy",
    requireAuth,
    requirePermission("documents", "view"),
    async (_req: Request, res: Response) => {
      try {
        const taxonomy = await listActiveTaxonomy();
        res.json({ taxonomy });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[doc-mgmt-admin] list taxonomy error:", err);
        throw serverError("Failed to load folder taxonomy");
      }
    },
  );

  app.get(
    "/api/folder-taxonomy/:internalKey",
    requireAuth,
    requirePermission("documents", "view"),
    async (req: Request, res: Response) => {
      const parsed = internalKeyParam.safeParse(req.params.internalKey);
      if (!parsed.success) throw badRequest("Invalid internalKey");
      try {
        const row = await getTaxonomyByKey(parsed.data);
        if (!row) throw notFound(`Taxonomy key '${parsed.data}' not found`);
        res.json({ row });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[doc-mgmt-admin] get taxonomy error:", err);
        throw serverError("Failed to load taxonomy entry");
      }
    },
  );

  // ====================================================================
  // Admin — folder_taxonomy CRUD (documents_admin:edit)
  // ====================================================================

  app.get(
    "/api/admin/folder-taxonomy",
    requireAuth,
    requirePermission("documents_admin", "view"),
    async (_req: Request, res: Response) => {
      try {
        const taxonomy = await listAllTaxonomy();
        res.json({ taxonomy });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[doc-mgmt-admin] admin list taxonomy error:", err);
        throw serverError("Failed to load folder taxonomy");
      }
    },
  );

  app.post(
    "/api/admin/folder-taxonomy",
    requireAuth,
    requirePermission("documents_admin", "create"),
    async (req: Request, res: Response) => {
      const parsed = insertFolderTaxonomySchema.safeParse(req.body);
      if (!parsed.success) {
        throw badRequest("Invalid taxonomy payload", {
          issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        });
      }
      try {
        const row = await createTaxonomyRow(parsed.data);
        logAuditFromReq(req, {
          entityType: "folder_taxonomy",
          entityId: row.internalKey,
          action: "create",
          changesJson: { row },
        });
        res.status(201).json({ row });
      } catch (err) {
        console.error("[doc-mgmt-admin] create taxonomy error:", err);
        throw toApiError(err, "Failed to create taxonomy row");
      }
    },
  );

  app.patch(
    "/api/admin/folder-taxonomy/:internalKey",
    requireAuth,
    requirePermission("documents_admin", "edit"),
    async (req: Request, res: Response) => {
      const parsedKey = internalKeyParam.safeParse(req.params.internalKey);
      if (!parsedKey.success) throw badRequest("Invalid internalKey");
      const parsedBody = taxonomyUpdateBodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        throw badRequest("Invalid taxonomy update", {
          issues: parsedBody.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        });
      }
      try {
        const row = await updateTaxonomyRow(parsedKey.data, parsedBody.data);
        logAuditFromReq(req, {
          entityType: "folder_taxonomy",
          entityId: row.internalKey,
          action: "update",
          changesJson: { patch: parsedBody.data },
        });
        res.json({ row });
      } catch (err) {
        console.error("[doc-mgmt-admin] update taxonomy error:", err);
        throw toApiError(err, "Failed to update taxonomy row");
      }
    },
  );

  app.delete(
    "/api/admin/folder-taxonomy/:internalKey",
    requireAuth,
    requirePermission("documents_admin", "delete"),
    async (req: Request, res: Response) => {
      const parsedKey = internalKeyParam.safeParse(req.params.internalKey);
      if (!parsedKey.success) throw badRequest("Invalid internalKey");
      try {
        const row = await deactivateTaxonomyRow(parsedKey.data);
        logAuditFromReq(req, {
          entityType: "folder_taxonomy",
          entityId: row.internalKey,
          action: "deactivate",
          changesJson: { active: false },
        });
        res.json({ row });
      } catch (err) {
        console.error("[doc-mgmt-admin] deactivate taxonomy error:", err);
        throw toApiError(err, "Failed to deactivate taxonomy row");
      }
    },
  );

  // ====================================================================
  // Public read — approval requirements (drives upload-time approval
  // detection and the discipline-panel "required docs" checklist).
  // ====================================================================

  app.get(
    "/api/document-approval-requirements",
    requireAuth,
    requirePermission("documents", "view"),
    async (_req: Request, res: Response) => {
      try {
        const requirements = await listActiveRequirements();
        res.json({ requirements });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[doc-mgmt-admin] list requirements error:", err);
        throw serverError("Failed to load approval requirements");
      }
    },
  );

  // ====================================================================
  // Admin — document_approval_requirements CRUD
  // ====================================================================

  app.get(
    "/api/admin/document-approval-requirements",
    requireAuth,
    requirePermission("documents_admin", "view"),
    async (_req: Request, res: Response) => {
      try {
        const requirements = await listAllRequirements();
        res.json({ requirements });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[doc-mgmt-admin] admin list requirements error:", err);
        throw serverError("Failed to load approval requirements");
      }
    },
  );

  app.post(
    "/api/admin/document-approval-requirements",
    requireAuth,
    requirePermission("documents_admin", "create"),
    async (req: Request, res: Response) => {
      const parsed = insertDocumentApprovalRequirementSchema.safeParse(req.body);
      if (!parsed.success) {
        throw badRequest("Invalid approval requirement payload", {
          issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        });
      }
      // Verify the referenced taxonomy key exists before insert — the FK
      // catches it but a 400 here gives a friendlier error message.
      const parent = await getTaxonomyByKey(parsed.data.taxonomyKey);
      if (!parent) throw badRequest(`Taxonomy key '${parsed.data.taxonomyKey}' does not exist`);
      try {
        const row = await createRequirement(parsed.data);
        logAuditFromReq(req, {
          entityType: "document_approval_requirement",
          entityId: String(row.id),
          action: "create",
          changesJson: { row },
        });
        res.status(201).json({ row });
      } catch (err) {
        console.error("[doc-mgmt-admin] create requirement error:", err);
        throw toApiError(err, "Failed to create approval requirement");
      }
    },
  );

  app.patch(
    "/api/admin/document-approval-requirements/:id",
    requireAuth,
    requirePermission("documents_admin", "edit"),
    async (req: Request, res: Response) => {
      const parsedId = requirementIdParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid requirement id");
      const parsedBody = requirementUpdateBodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        throw badRequest("Invalid requirement update", {
          issues: parsedBody.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        });
      }
      // If taxonomyKey changed, verify the new key exists.
      if (parsedBody.data.taxonomyKey !== undefined) {
        const parent = await getTaxonomyByKey(parsedBody.data.taxonomyKey);
        if (!parent) throw badRequest(`Taxonomy key '${parsedBody.data.taxonomyKey}' does not exist`);
      }
      try {
        const row = await updateRequirement(parsedId.data, parsedBody.data);
        logAuditFromReq(req, {
          entityType: "document_approval_requirement",
          entityId: String(row.id),
          action: "update",
          changesJson: { patch: parsedBody.data },
        });
        res.json({ row });
      } catch (err) {
        console.error("[doc-mgmt-admin] update requirement error:", err);
        throw toApiError(err, "Failed to update approval requirement");
      }
    },
  );

  app.delete(
    "/api/admin/document-approval-requirements/:id",
    requireAuth,
    requirePermission("documents_admin", "delete"),
    async (req: Request, res: Response) => {
      const parsedId = requirementIdParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid requirement id");
      try {
        const row = await deactivateRequirement(parsedId.data);
        logAuditFromReq(req, {
          entityType: "document_approval_requirement",
          entityId: String(row.id),
          action: "deactivate",
          changesJson: { active: false },
        });
        res.json({ row });
      } catch (err) {
        console.error("[doc-mgmt-admin] deactivate requirement error:", err);
        throw toApiError(err, "Failed to deactivate approval requirement");
      }
    },
  );
}
