/**
 * C1 — Integration health dashboard routes.
 *
 * Endpoints:
 *   GET  /api/integrations
 *        Returns every registered connector with its derived health
 *        tile (healthy / stale / failing / unknown). Admin only — it is
 *        surfaced solely on the COO/CEO Integration Statuses page, so the
 *        data must not be readable by non-admins (2026-06-24 hardening).
 *   GET  /api/integrations/:name/runs?limit=50
 *        Recent run history for a single connector. Any authenticated
 *        user.
 *   POST /api/admin/integrations/:name/register
 *        Upsert a connector entry. Admin only.
 *   POST /api/integrations/:name/run-event
 *        Internal endpoint so workers that don't use the service
 *        directly can still POST a run result. Admin only (prevents a
 *        low-privileged user from flooding the history).
 *
 * Read-only for C1 in the sense that there is no state transition
 * logic here — transitions to "failing" will trigger alerts in C3.
 */

import { Router, type Express, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "./shared-middleware";
import { logAuditFromReq } from "../audit-logger";
import {
  getIntegrationHealth,
  getIntegrationRunHistory,
  recordIntegrationRun,
  upsertIntegration,
} from "../services/integration-health-service";
import { INTEGRATION_RUN_STATUSES } from "@shared/schema";

const router = Router();

// ===================== DASHBOARD =====================

router.get("/api/integrations", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const health = await getIntegrationHealth();
    res.json(health);
  } catch (err) {
    console.error("[IntegrationHealth] Failed to load dashboard:", err);
    res.status(500).json({ error: "Failed to load integration health" });
  }
});

// ===================== RUN HISTORY =====================

router.get("/api/integrations/:name/runs", requireAuth, async (req: Request, res: Response) => {
  try {
    const name = String(req.params.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "Invalid integration name" });
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 50;
    const runs = await getIntegrationRunHistory({ name, limit });
    res.json({ name, runs });
  } catch (err) {
    console.error("[IntegrationHealth] Failed to load run history:", err);
    res.status(500).json({ error: "Failed to load run history" });
  }
});

// ===================== ADMIN: REGISTER =====================

router.post(
  "/api/admin/integrations/:name/register",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const name = String(req.params.name ?? "").trim();
      if (!name) return res.status(400).json({ error: "Invalid integration name" });
      const integration = await upsertIntegration({
        name,
        displayName: req.body?.displayName,
        description: req.body?.description ?? null,
        authType: req.body?.authType,
        ownerProcess: req.body?.ownerProcess ?? null,
        fallbackDescription: req.body?.fallbackDescription ?? null,
        alertTarget: req.body?.alertTarget ?? null,
        metadata: req.body?.metadata ?? null,
      });
      logAuditFromReq(req, {
        entityType: "integration",
        entityId: String(integration.id),
        action: "integration.registered",
        changesJson: { name: integration.name, displayName: integration.displayName },
      });
      res.status(201).json({ integration });
    } catch (err) {
      console.error("[IntegrationHealth] Failed to register integration:", err);
      res.status(500).json({ error: "Failed to register integration" });
    }
  },
);

// ===================== INTERNAL: RUN EVENT =====================

router.post(
  "/api/integrations/:name/run-event",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const name = String(req.params.name ?? "").trim();
      if (!name) return res.status(400).json({ error: "Invalid integration name" });

      const status = String(req.body?.status ?? "");
      if (!(INTEGRATION_RUN_STATUSES as readonly string[]).includes(status)) {
        return res.status(400).json({
          error: "invalid_status",
          allowed: INTEGRATION_RUN_STATUSES,
        });
      }

      const startedAtRaw = req.body?.startedAt ?? req.body?.started_at;
      const startedAt = startedAtRaw ? new Date(startedAtRaw) : new Date();
      if (Number.isNaN(startedAt.getTime())) {
        return res.status(400).json({ error: "invalid_started_at" });
      }

      const finishedAtRaw = req.body?.finishedAt ?? req.body?.finished_at;
      const finishedAt = finishedAtRaw ? new Date(finishedAtRaw) : null;

      const event = await recordIntegrationRun({
        name,
        runType: req.body?.runType ?? null,
        startedAt,
        finishedAt,
        status: status as any,
        recordsProcessed: req.body?.recordsProcessed ?? null,
        errorCode: req.body?.errorCode ?? null,
        errorDetail: req.body?.errorDetail ?? null,
        metadata: req.body?.metadata ?? null,
      });

      res.status(201).json({ event });
    } catch (err) {
      console.error("[IntegrationHealth] Failed to record run event:", err);
      res.status(500).json({ error: "Failed to record run event" });
    }
  },
);

export function registerIntegrationHealthRoutes(app: Express) {
  app.use(router);
}
