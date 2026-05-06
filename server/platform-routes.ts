import type { Express } from "express";
import {
  PLATFORM_AUTHORITATIVE_SOURCES,
  PLATFORM_EXTENSION_RULES,
  listPlatformContractReferences,
} from "@shared/platform-contracts";
import { requireAuth } from "./auth-context";
import { requirePermission } from "./permission-middleware";
import { logApiError, badRequest, notFound, sendError, serverError } from "./lib/api-error";
import { PLATFORM_ROUTE_OWNERSHIP } from "./platform/route-ownership";
import { getPlatformProjectSummary } from "./services/project-platform-summary-service";
import { parseIntParam } from "./lib/req-params";
import { isConnectorMocked } from "./lib/connector-mode";

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

  // EE-QA-016 — surface which integrations are running on fixture data so
  // the UI can show a visible "FIXTURE DATA" banner. The mock-mode gate
  // itself is correct (see server/lib/connector-mode.ts) — this just makes
  // it user-visible. Production never returns mocked: true here because
  // connector-mode.ts forces real-only when NODE_ENV === "production".
  app.get("/api/platform/connector-status", requireAuth, requirePermission("home", "view"), async (_req, res) => {
    const status = {
      env: process.env.NODE_ENV || "development",
      msGraph: isConnectorMocked("ms-graph") ? "mock" : "live",
      quickbooks: isConnectorMocked("quickbooks") ? "mock" : "live",
      pipedrive: isConnectorMocked("pipedrive") ? "mock" : "live",
    } as const;
    const anyMock =
      status.msGraph === "mock" ||
      status.quickbooks === "mock" ||
      status.pipedrive === "mock";
    res.json({ ...status, anyMock });
  });

  app.get("/api/platform/projects/:projectId/summary", requireAuth, async (req, res) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
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
