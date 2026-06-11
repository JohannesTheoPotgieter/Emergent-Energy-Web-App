/**
 * Finance health routes — the on-demand freeze-monitoring surface (R5).
 *
 * Endpoints:
 *   GET  /api/finance/health
 *        One payload: job heartbeats, error rate, freshness/drift, the latest
 *        integrity-guard run, finance integrations, and recent alerts, with an
 *        overall level. Read-only. Gated by financials:view.
 *   POST /api/admin/finance/observability/run-integrity
 *        Run the integrity guard now (read-only against prod). Admin only.
 *   POST /api/admin/finance/observability/sweep
 *        Run the watchdog sweeps now (heartbeats + freshness + error rate).
 *        Admin only — used to verify alerting end-to-end.
 *   POST /api/admin/finance/observability/digest
 *        Dispatch the finance-health digest now. Admin only.
 *
 * All routes are read-only with respect to FINANCE data. The admin POSTs only
 * write to the observability tables / dispatch alerts.
 */

import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { requirePermission } from "../permission-middleware";
import { getFinanceHealth } from "../services/finance-observability/health";
import { runFinanceIntegrityGuard } from "../services/finance-observability/integrity-guard";
import { sweepFinanceJobHeartbeats } from "../services/finance-observability/job-heartbeats";
import { sweepFinanceFreshness } from "../services/finance-observability/freshness";
import { checkErrorRateAndAlert } from "../services/finance-observability/error-monitor";
import { sendFinanceDigest } from "../services/finance-observability/digest";

function actorLabel(req: Request): string {
  const u = (req as Request & { user?: { id?: number; email?: string } }).user;
  return u?.email ?? (u?.id != null ? `user:${u.id}` : "admin");
}

export function registerFinanceHealthRoutes(app: Express): void {
  app.get(
    "/api/finance/health",
    requireAuth,
    requirePermission("financials", "view"),
    async (_req: Request, res: Response) => {
      try {
        const health = await getFinanceHealth();
        res.json(health);
      } catch (err) {
        console.error("[finance-health] failed:", err);
        res.status(500).json({ error: "finance_health_failed" });
      }
    },
  );

  app.post(
    "/api/admin/finance/observability/run-integrity",
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const result = await runFinanceIntegrityGuard({
          runType: "manual",
          triggeredBy: actorLabel(req),
        });
        res.json({
          runId: result.runId,
          status: result.status,
          driftCount: result.driftCount,
          alertDispatched: result.alertDispatched,
          summary: result.summary,
        });
      } catch (err) {
        console.error("[finance-health] manual integrity run failed:", err);
        res.status(500).json({ error: "finance_integrity_run_failed" });
      }
    },
  );

  app.post(
    "/api/admin/finance/observability/sweep",
    requireAuth,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const [heartbeats, freshness, errorRate] = await Promise.all([
          sweepFinanceJobHeartbeats(),
          sweepFinanceFreshness(),
          checkErrorRateAndAlert(),
        ]);
        res.json({ heartbeats, freshness, errorRate });
      } catch (err) {
        console.error("[finance-health] manual sweep failed:", err);
        res.status(500).json({ error: "finance_sweep_failed" });
      }
    },
  );

  app.post(
    "/api/admin/finance/observability/digest",
    requireAuth,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        await sendFinanceDigest();
        res.json({ ok: true });
      } catch (err) {
        console.error("[finance-health] digest dispatch failed:", err);
        res.status(500).json({ error: "finance_digest_failed" });
      }
    },
  );
}
