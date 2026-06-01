import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, getEffectiveUser } from "../auth-context";
import { badRequest, conflict, forbidden, notFound, serverError, ApiError } from "../lib/api-error";
import { listFoldersForProject } from "../repositories/project-folders-repository";
import { upsertManagedDocumentFromGraph } from "../repositories/managed-documents-repository";
import {
  getProjectDocumentLink,
  listProjectDocumentRegisterRows,
  updateProjectDocumentLink,
  upsertLinkedProjectDocument,
  type ProjectDocumentRegisterRow,
} from "../repositories/project-document-register-repository";
import * as sp from "../services/sharepoint-document-service";
import {
  computeProjectDocumentDefects,
  getProjectDocumentPermissions,
  PROJECT_DOCUMENT_DOMAINS,
  PROJECT_DOCUMENT_REVIEW_STATUSES,
  PROJECT_DOCUMENT_STATUSES,
  PROJECT_DOCUMENT_SYNC_CONFIDENCE,
  type ProjectDocumentDomain,
} from "@shared/project-document-register";

const projectIdParam = z.coerce.number().int().positive();
const linkIdParam = z.coerce.number().int().positive();
const domainSchema = z.enum(PROJECT_DOCUMENT_DOMAINS);

const linkBodySchema = z.object({
  domain: domainSchema,
  // Canonical project_folders surface (project_sharepoint_roots retired in Stage 3).
  folderId: z.number().int().positive(),
  itemId: z.string().min(1).max(256),
  documentType: z.string().trim().min(1).max(120),
  discipline: z.string().trim().max(120).nullable().optional(),
  revision: z.string().trim().max(40).nullable().optional(),
  ownerUserId: z.number().int().positive().nullable().optional(),
  dueDate: z.string().trim().max(32).nullable().optional(),
  requiresPrengSignoff: z.boolean().optional(),
  closeOutEvidenceRequired: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const updateBodySchema = z.object({
  documentType: z.string().trim().min(1).max(120).optional(),
  discipline: z.string().trim().max(120).nullable().optional(),
  revision: z.string().trim().max(40).nullable().optional(),
  status: z.enum(PROJECT_DOCUMENT_STATUSES).optional(),
  reviewStatus: z.enum(PROJECT_DOCUMENT_REVIEW_STATUSES).optional(),
  currentRevision: z.boolean().optional(),
  superseded: z.boolean().optional(),
  ownerUserId: z.number().int().positive().nullable().optional(),
  dueDate: z.string().trim().max(32).nullable().optional(),
  reviewedByUserId: z.number().int().positive().nullable().optional(),
  approvedByUserId: z.number().int().positive().nullable().optional(),
  approvedAt: z.string().datetime().nullable().optional(),
  requiresPrengSignoff: z.boolean().optional(),
  prengSignedOffByUserId: z.number().int().positive().nullable().optional(),
  prengSignedOffAt: z.string().datetime().nullable().optional(),
  closeOutEvidenceRequired: z.boolean().optional(),
  closeOutEvidenceLinked: z.boolean().optional(),
  syncConfidence: z.enum(PROJECT_DOCUMENT_SYNC_CONFIDENCE).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

function folderPathFromItemPath(path: string | null | undefined, fileName: string): string | null {
  const cleaned = String(path ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!cleaned) return null;
  if (cleaned.toLowerCase().endsWith(`/${fileName.toLowerCase()}`)) {
    return cleaned.slice(0, cleaned.length - fileName.length - 1) || null;
  }
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(0, idx) : null;
}

function requireRegisterUser(req: Request) {
  const user = getEffectiveUser(req);
  if (!user?.id) throw forbidden("Authentication required");
  return user;
}

function dtoFromRow(row: ProjectDocumentRegisterRow) {
  const link = row.link;
  const defects = computeProjectDocumentDefects({
    domain: link.domain,
    status: link.status,
    reviewStatus: link.reviewStatus,
    driveId: link.sharepointDriveId,
    itemId: link.sharepointItemId,
    webUrl: link.sharepointWebUrl,
    reviewerUserId: link.reviewedByUserId,
    approverUserId: link.approvedByUserId,
    approvedAt: link.approvedAt,
    currentRevision: link.currentRevision,
    superseded: link.superseded,
    dueDate: link.dueDate,
    closeOutEvidenceRequired: link.closeOutEvidenceRequired,
    closeOutEvidenceLinked: link.closeOutEvidenceLinked,
    syncConfidence: link.syncConfidence,
  });

  return {
    id: link.id,
    projectId: link.projectId,
    managedDocumentId: link.managedDocumentId,
    domain: link.domain,
    documentType: link.documentType,
    discipline: link.discipline,
    revision: link.revision,
    status: link.status,
    reviewStatus: link.reviewStatus,
    currentRevision: link.currentRevision,
    superseded: link.superseded,
    ownerUserId: link.ownerUserId,
    dueDate: link.dueDate,
    preparedByUserId: link.preparedByUserId,
    reviewedByUserId: link.reviewedByUserId,
    approvedByUserId: link.approvedByUserId,
    approvedAt: link.approvedAt,
    requiresPrengSignoff: link.requiresPrengSignoff,
    prengSignedOffByUserId: link.prengSignedOffByUserId,
    prengSignedOffAt: link.prengSignedOffAt,
    closeOutEvidenceRequired: link.closeOutEvidenceRequired,
    closeOutEvidenceLinked: link.closeOutEvidenceLinked,
    sharepoint: {
      driveId: link.sharepointDriveId,
      itemId: link.sharepointItemId,
      webUrl: link.sharepointWebUrl,
      folderPath: link.sharepointFolderPath,
      fileName: link.fileName,
    },
    sync: {
      lastSyncedAt: link.lastSyncedAt,
      confidence: link.syncConfidence,
    },
    managedDocument: row.managedDocument
      ? {
          id: row.managedDocument.id,
          state: row.managedDocument.state,
          name: row.managedDocument.name,
          path: row.managedDocument.path,
        }
      : null,
    flag: defects.flag,
    defects: defects.defects,
    notes: link.notes,
    updatedAt: link.updatedAt,
  };
}

function buildSummary(rows: ReturnType<typeof dtoFromRow>[]) {
  const linked = rows.filter((row) => row.sharepoint.driveId && row.sharepoint.itemId && row.sharepoint.webUrl).length;
  const redDefects = rows.filter((row) => row.flag === "red").length;
  const pendingReview = rows.filter((row) => row.reviewStatus === "submitted_for_review").length;
  const approved = rows.filter((row) => row.status === "approved" && row.flag !== "red").length;
  const missingLinks = rows.filter((row) =>
    row.defects.some((defect) => defect.code === "missing_sharepoint_link"),
  ).length;
  const lastSyncedAt = rows
    .map((row) => row.sync.lastSyncedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  return {
    total: rows.length,
    linked,
    approved,
    pendingReview,
    redDefects,
    missingLinks,
    lastSyncedAt,
    syncConfidence: redDefects > 0 ? "low" : "high",
  };
}

function ensurePermission(role: string | null | undefined, domain: ProjectDocumentDomain, action: "view" | "link" | "edit" | "approve" | "supersede") {
  const permissions = getProjectDocumentPermissions(role, domain);
  const allowed =
    action === "view"
      ? permissions.canView
      : action === "link"
        ? permissions.canLink
        : action === "approve"
          ? permissions.canApprove
          : action === "supersede"
            ? permissions.canMarkSuperseded
            : permissions.canEditMetadata;
  if (!allowed) throw forbidden("You do not have permission for this document action.");
  return permissions;
}

export function registerProjectDocumentRegisterRoutes(app: Express): void {
  app.get(
    "/api/projects/:projectId/document-register",
    requireAuth,
    async (req: Request, res: Response) => {
      const projectId = projectIdParam.safeParse(req.params.projectId);
      const domain = domainSchema.safeParse(req.query.domain);
      if (!projectId.success) throw badRequest("Invalid projectId");
      if (!domain.success) throw badRequest("Invalid document domain");

      const user = requireRegisterUser(req);
      const permissions = ensurePermission(user.role, domain.data, "view");
      const rows = (await listProjectDocumentRegisterRows(projectId.data, domain.data)).map(dtoFromRow);
      res.json({
        projectId: projectId.data,
        domain: domain.data,
        permissions,
        summary: buildSummary(rows),
        documents: rows,
      });
    },
  );

  app.post(
    "/api/projects/:projectId/document-register/link",
    requireAuth,
    async (req: Request, res: Response) => {
      const projectId = projectIdParam.safeParse(req.params.projectId);
      const body = linkBodySchema.safeParse(req.body);
      if (!projectId.success) throw badRequest("Invalid projectId");
      if (!body.success) throw badRequest("Invalid link payload");

      const user = requireRegisterUser(req);
      ensurePermission(user.role, body.data.domain, "link");

      // Resolve the SharePoint drive from the canonical project_folders surface.
      const folders = await listFoldersForProject(projectId.data);
      const folder = folders.find((f) => f.id === body.data.folderId);
      if (!folder) throw notFound("Project folder");
      if (!folder.driveId) {
        throw conflict("Project folder is not provisioned to SharePoint yet.");
      }
      const driveId = folder.driveId;

      const item = await sp.getItem(driveId, body.data.itemId);
      if (!item) throw notFound("SharePoint item");
      if (item.isFolder) throw badRequest("Select a SharePoint file, not a folder.");

      const managedDocument = await upsertManagedDocumentFromGraph({
        rootScope: "project",
        projectId: projectId.data,
        companyRootId: null,
        driveId,
        driveItemId: item.id,
        name: item.name,
        path: item.path,
        createdByUserId: user.id,
        parentFolderId: null,
      });

      const link = await upsertLinkedProjectDocument({
        projectId: projectId.data,
        managedDocumentId: managedDocument.id,
        domain: body.data.domain,
        documentType: body.data.documentType,
        discipline: body.data.discipline ?? null,
        revision: body.data.revision ?? null,
        ownerUserId: body.data.ownerUserId ?? null,
        dueDate: body.data.dueDate ?? null,
        preparedByUserId: user.id,
        sharepointDriveId: driveId,
        sharepointItemId: item.id,
        sharepointWebUrl: item.webUrl ?? null,
        sharepointFolderPath: folderPathFromItemPath(item.path, item.name),
        fileName: item.name,
        lastSyncedAt: new Date(),
        syncConfidence: item.webUrl ? "high" : "low",
        createdByUserId: user.id,
      });

      const updated = await updateProjectDocumentLink(projectId.data, link.id, {
        requiresPrengSignoff: body.data.requiresPrengSignoff ?? false,
        closeOutEvidenceRequired: body.data.closeOutEvidenceRequired ?? false,
        notes: body.data.notes ?? null,
        updatedByUserId: user.id,
      });

      res.status(201).json({ document: dtoFromRow({ link: updated ?? link, managedDocument }) });
    },
  );

  app.patch(
    "/api/projects/:projectId/document-register/:linkId",
    requireAuth,
    async (req: Request, res: Response) => {
      const projectId = projectIdParam.safeParse(req.params.projectId);
      const linkId = linkIdParam.safeParse(req.params.linkId);
      const body = updateBodySchema.safeParse(req.body);
      if (!projectId.success || !linkId.success) throw badRequest("Invalid document register params");
      if (!body.success) throw badRequest("Invalid document update payload");

      const user = requireRegisterUser(req);
      const existing = await getProjectDocumentLink(projectId.data, linkId.data);
      if (!existing) throw notFound("Project document link");

      const approving = body.data.status === "approved" || body.data.reviewStatus === "approved";
      const superseding = body.data.superseded === true || body.data.status === "superseded";
      ensurePermission(
        user.role,
        existing.domain,
        approving ? "approve" : superseding ? "supersede" : "edit",
      );

      const approvedAt = body.data.approvedAt !== undefined
        ? body.data.approvedAt
          ? new Date(body.data.approvedAt)
          : null
        : approving
          ? new Date()
          : undefined;

      const updated = await updateProjectDocumentLink(projectId.data, linkId.data, {
        ...body.data,
        approvedAt,
        approvedByUserId: approving ? (body.data.approvedByUserId ?? user.id) : body.data.approvedByUserId,
        reviewedByUserId: approving ? (body.data.reviewedByUserId ?? user.id) : body.data.reviewedByUserId,
        prengSignedOffAt: body.data.prengSignedOffAt ? new Date(body.data.prengSignedOffAt) : undefined,
        updatedByUserId: user.id,
      });

      if (!updated) throw notFound("Project document link");
      res.json({ document: dtoFromRow({ link: updated, managedDocument: null }) });
    },
  );
}
