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
  listActiveCompanyRoots,
  getCompanyRootByKind,
  upsertCompanyRoot,
} from "../repositories/company-sharepoint-roots-repository";
import * as sp from "../services/sharepoint-document-service";
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
const companyRootKindParam = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);
const companyRootTestBodySchema = z.object({
  driveId: z.string().trim().max(256).nullish(),
  rootItemId: z.string().trim().max(256).nullish(),
  rootPath: z.string().trim().max(1024).nullish(),
}).strict();

type CompanyRootTestFailureCategory =
  | "missing_token"
  | "401"
  | "403"
  | "404"
  | "malformed_config"
  | "graph_outage";

function failureCategoryFromRootTestError(err: unknown): CompanyRootTestFailureCategory {
  if (err instanceof ApiError) {
    if (err.code === "SHAREPOINT_TOKEN_UNAUTHORIZED") return "401";
    if (err.code === "SHAREPOINT_ACCESS_DENIED") return "403";
    if (err.code === "NOT_FOUND") return "404";
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/connector not configured|not connected|token is missing|missing token/i.test(msg)) {
    return "missing_token";
  }
  return "graph_outage";
}

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

  // ====================================================================
  // Company SharePoint roots (D6 Phase 3.1) — admin must register the
  // 'active_projects' root before provisioning works. Without this UI
  // the only path was to manually INSERT a row, which made Phase 3
  // unreachable in practice.
  // ====================================================================

  app.get(
    "/api/admin/company-sharepoint-roots",
    requireAuth,
    requirePermission("documents_admin", "view"),
    async (_req: Request, res: Response) => {
      try {
        const roots = await listActiveCompanyRoots();
        res.json({ roots });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[doc-mgmt-admin] list company roots error:", err);
        throw serverError("Failed to load company SharePoint roots");
      }
    },
  );

  app.post(
    "/api/admin/company-sharepoint-roots/:kind/test",
    requireAuth,
    requirePermission("documents_admin", "view"),
    async (req: Request, res: Response) => {
      const parsedKind = companyRootKindParam.safeParse(req.params.kind);
      if (!parsedKind.success) throw badRequest("Invalid root kind");
      const parsedBody = companyRootTestBodySchema.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        throw badRequest("Invalid SharePoint root test payload", {
          issues: parsedBody.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        });
      }

      const savedRoot = await getCompanyRootByKind(parsedKind.data);
      const driveId = parsedBody.data.driveId?.trim() || savedRoot?.driveId || null;
      const rootItemId = parsedBody.data.rootItemId?.trim() || savedRoot?.rootItemId || null;
      const rootPath = parsedBody.data.rootPath?.trim() || savedRoot?.rootPath || null;

      if (!driveId) {
        res.json({
          ok: false,
          failureCategory: "malformed_config",
          message: "Graph drive ID is required before testing this SharePoint root.",
          nextAction: "Paste the SharePoint document-library Drive ID, then test again.",
          rootPath,
          driveReachable: false,
          rootReachable: false,
          childrenReachable: false,
          childCount: 0,
        });
        return;
      }

      try {
        let rootItem: Awaited<ReturnType<typeof sp.getItem>> | null = null;
        if (rootItemId) {
          rootItem = await sp.getItem(driveId, rootItemId);
          if (!rootItem) {
            res.json({
              ok: false,
              failureCategory: "404",
              message: "SharePoint could not find the configured root item.",
              nextAction: "Check the Graph item ID for the Active Projects folder, then test again.",
              rootPath,
              driveReachable: true,
              rootReachable: false,
              childrenReachable: false,
              childCount: 0,
            });
            return;
          }
          if (!rootItem.isFolder) {
            res.json({
              ok: false,
              failureCategory: "malformed_config",
              message: "The configured root item is a file, not a folder.",
              nextAction: "Use the Graph item ID for the Active Projects folder.",
              rootPath,
              rootName: rootItem.name,
              driveReachable: true,
              rootReachable: true,
              childrenReachable: false,
              childCount: 0,
            });
            return;
          }
        }

        const children = await sp.listChildren(driveId, rootItemId);
        res.json({
          ok: true,
          rootPath,
          rootName: rootItem?.name ?? "Drive root",
          driveReachable: true,
          rootReachable: true,
          childrenReachable: true,
          childCount: children.length,
          firstFiveChildren: children.slice(0, 5).map((item) => ({
            id: item.id,
            name: item.name,
            isFolder: item.isFolder,
          })),
        });
      } catch (err) {
        const category = failureCategoryFromRootTestError(err);
        const message = err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "SharePoint root test failed.";
        const nextAction = err instanceof ApiError
          ? err.nextAction
          : category === "missing_token"
            ? "Reconnect the Microsoft SharePoint connector or Microsoft sign-in, then retry."
            : "Retry shortly. If it continues, check Microsoft Graph health and the SharePoint configuration.";
        res.json({
          ok: false,
          failureCategory: category,
          message,
          nextAction,
          rootPath,
          driveReachable: category !== "missing_token" && category !== "401" && category !== "403",
          rootReachable: false,
          childrenReachable: false,
          childCount: 0,
        });
      }
    },
  );

  app.put(
    "/api/admin/company-sharepoint-roots/:kind",
    requireAuth,
    requirePermission("documents_admin", "edit"),
    async (req: Request, res: Response) => {
      const kindSchema = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);
      const parsedKind = kindSchema.safeParse(req.params.kind);
      if (!parsedKind.success) throw badRequest("Invalid root kind");
      const bodySchema = z.object({
        displayName: z.string().min(1).max(256),
        driveId: z.string().max(256).nullish(),
        rootItemId: z.string().max(256).nullish(),
        rootPath: z.string().min(1).max(1024),
        sortOrder: z.number().int().min(0).max(99999).optional(),
        active: z.boolean().optional(),
      });
      const parsedBody = bodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        throw badRequest("Invalid SharePoint root payload", {
          issues: parsedBody.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        });
      }
      try {
        const row = await upsertCompanyRoot({
          kind: parsedKind.data,
          displayName: parsedBody.data.displayName,
          driveId: parsedBody.data.driveId ?? null,
          rootItemId: parsedBody.data.rootItemId ?? null,
          rootPath: parsedBody.data.rootPath,
          sortOrder: parsedBody.data.sortOrder ?? 0,
          active: parsedBody.data.active ?? true,
        });
        logAuditFromReq(req, {
          entityType: "company_sharepoint_root",
          entityId: row.kind,
          action: "upsert",
          changesJson: { row },
        });
        res.json({ row });
      } catch (err) {
        console.error("[doc-mgmt-admin] upsert company root error:", err);
        throw toApiError(err, "Failed to upsert SharePoint root");
      }
    },
  );
}
