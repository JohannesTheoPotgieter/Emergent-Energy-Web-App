import type { Express } from "express";
import {
  PLATFORM_AUTHORITATIVE_SOURCES,
  PLATFORM_EXTENSION_RULES,
  listPlatformContractReferences,
} from "@shared/platform-contracts";
import { requireAuth } from "./auth-context";
import { logApiError, badRequest, notFound, sendError, serverError } from "./lib/api-error";
import { PLATFORM_ROUTE_OWNERSHIP } from "./platform/route-ownership";
import { getPlatformProjectSummary } from "./services/project-platform-summary-service";

export function registerPlatformRoutes(app: Express) {
  app.get("/api/platform/contracts", requireAuth, async (_req, res) => {
    try {
      res.json({
        contracts: listPlatformContractReferences(),
        authoritativeSources: PLATFORM_AUTHORITATIVE_SOURCES,
        routeOwnership: PLATFORM_ROUTE_OWNERSHIP,
        extensionRules: PLATFORM_EXTENSION_RULES,
      });
    } catch (error) {
      logApiError("GET /api/platform/contracts", error);
      return sendError(res, serverError("Failed to load platform contracts"));
    }
  });

  app.get("/api/platform/projects/:projectId/summary", requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(String(req.params.projectId), 10);
      if (!Number.isFinite(projectId)) {
        return sendError(res, badRequest("Valid projectId is required"));
      }

      const summary = await getPlatformProjectSummary(projectId);
      if (!summary) {
        return sendError(res, notFound("Project"));
      }

      return res.json(summary);
    } catch (error) {
      logApiError("GET /api/platform/projects/:projectId/summary", error);
      return sendError(res, serverError("Failed to load platform project summary"));
    }
  });
}
