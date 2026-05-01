/**
 * Document readiness routes (D6 Phase 6).
 *
 * Read-only soft-enforcement endpoints. No mutations, so no audit logging
 * required.
 *
 * Endpoints:
 *   GET /api/projects/:projectId/readiness          documents:view
 *   GET /api/portfolio/document-readiness           documents:view
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { ApiError, badRequest, notFound, serverError } from "../lib/api-error";
import {
  computeProjectReadiness,
  computePortfolioReadiness,
} from "../services/document-readiness-service";

const projectIdParam = z.coerce.number().int().positive();

export function registerDocumentReadinessRoutes(app: Express): void {
  app.get(
    "/api/projects/:projectId/readiness",
    requireAuth,
    requirePermission("documents", "view"),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      if (!parsed.success) throw badRequest("Invalid projectId");
      try {
        const result = await computeProjectReadiness(parsed.data);
        res.json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Readiness failed";
        if (/not found/i.test(msg)) throw notFound(msg);
        if (err instanceof ApiError) throw err;
        console.error("[doc-readiness] project error:", err);
        throw serverError(msg);
      }
    },
  );

  app.get(
    "/api/portfolio/document-readiness",
    requireAuth,
    requirePermission("documents", "view"),
    async (_req: Request, res: Response) => {
      try {
        const rows = await computePortfolioReadiness();
        res.json({ rows });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[doc-readiness] portfolio error:", err);
        throw serverError(err instanceof Error ? err.message : "Readiness failed");
      }
    },
  );
}
