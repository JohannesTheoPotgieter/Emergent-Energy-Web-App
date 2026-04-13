/**
 * C2 — Dashboard snapshot read + freshness panel routes.
 *
 * Endpoints:
 *   GET  /api/dashboards/freshness
 *        Freshness panel for every registered dashboard — one tile
 *        each with age + fresh/warn/stale/unknown. Any authenticated
 *        user; this is the exec "what's up to date" indicator.
 *   GET  /api/dashboards/:key/snapshot
 *        Latest cached payload for a single dashboard. Any
 *        authenticated user.
 *   POST /api/dashboards/:key/refresh
 *        Force-refresh a single dashboard. Admin only — useful when a
 *        user knows they just fixed upstream data and doesn't want to
 *        wait for the next 15 min cycle.
 *   POST /api/dashboards/refresh-all
 *        Force-refresh every registered dashboard. Admin only.
 */

import { Router, type Express, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "./shared-middleware";
import { logAuditFromReq } from "../audit-logger";
import {
  getDashboardFreshness,
  getDashboardSnapshot,
  refreshAllDashboards,
  refreshDashboard,
  listRegisteredDashboards,
} from "../services/dashboard-refresh-service";

const router = Router();

// ===================== READ =====================

router.get("/api/dashboards/freshness", requireAuth, async (_req: Request, res: Response) => {
  try {
    const panel = await getDashboardFreshness();
    res.json(panel);
  } catch (err) {
    console.error("[DashboardRefresh] Failed to load freshness panel:", err);
    res.status(500).json({ error: "Failed to load dashboard freshness" });
  }
});

router.get("/api/dashboards/:key/snapshot", requireAuth, async (req: Request, res: Response) => {
  try {
    const key = String(req.params.key ?? "").trim();
    if (!key) return res.status(400).json({ error: "Invalid dashboard key" });
    const scopeKey = typeof req.query.scope === "string" ? req.query.scope : "global";
    const snapshot = await getDashboardSnapshot({ key, scopeKey });
    if (!snapshot) {
      return res.status(404).json({
        error: "snapshot_not_found",
        message:
          "No cached snapshot yet for this dashboard. It will be generated on the next refresh cycle.",
      });
    }
    res.json({ snapshot });
  } catch (err) {
    console.error("[DashboardRefresh] Failed to load snapshot:", err);
    res.status(500).json({ error: "Failed to load dashboard snapshot" });
  }
});

// ===================== ADMIN: FORCE REFRESH =====================

router.post(
  "/api/dashboards/:key/refresh",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const key = String(req.params.key ?? "").trim();
      if (!key) return res.status(400).json({ error: "Invalid dashboard key" });

      const known = listRegisteredDashboards().some((d) => d.key === key);
      if (!known) {
        return res.status(404).json({
          error: "unknown_dashboard",
          known: listRegisteredDashboards().map((d) => d.key),
        });
      }

      const result = await refreshDashboard(key);
      logAuditFromReq(req, {
        entityType: "dashboard_snapshot",
        entityId: key,
        action: "dashboard.refreshed",
        changesJson: { key, ok: result.ok, error: result.error ?? null },
      });
      res.status(result.ok ? 200 : 500).json(result);
    } catch (err) {
      console.error("[DashboardRefresh] Failed to force refresh:", err);
      res.status(500).json({ error: "Failed to refresh dashboard" });
    }
  },
);

router.post(
  "/api/dashboards/refresh-all",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const result = await refreshAllDashboards();
      logAuditFromReq(req, {
        entityType: "dashboard_snapshot",
        entityId: "all",
        action: "dashboard.refreshed_all",
        changesJson: { refreshed: result.refreshed, failed: result.failed },
      });
      res.json(result);
    } catch (err) {
      console.error("[DashboardRefresh] Failed to refresh all:", err);
      res.status(500).json({ error: "Failed to refresh dashboards" });
    }
  },
);

export function registerDashboardRefreshRoutes(app: Express) {
  app.use(router);
}
