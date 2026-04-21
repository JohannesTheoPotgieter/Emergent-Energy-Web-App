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
import { requireAuth } from "../auth-context";
import {
  getProjectDocumentDetail,
  getProjectDocumentSummary,
  listActiveDocumentTypes,
} from "../repositories/controlled-documents-repository";
import { ApiError, badRequest, notFound, serverError } from "../lib/api-error";

const projectIdParam = z.coerce.number().int().positive();
const typeKeyParam = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);

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
}
