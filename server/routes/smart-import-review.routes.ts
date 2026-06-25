/**
 * Smart Import review routes — the parked-run review screen's backend.
 *
 *   GET  /api/smart-import/:runId/reconciliation-preview
 *     → Post-commit reconciliation preview (rolled-back dry-run). Read-only;
 *       persists nothing.
 *   POST /api/smart-import/:runId/reject
 *     → Dismiss a parked run (status → rejected), audited, file untouched.
 *
 * Lives in its own module (not the 4k-line legacy smart-import-routes.ts) per
 * the current server/routes/*.routes.ts convention. COMMIT from review uses the
 * existing lock-aware POST /api/smart-import/:runId/commit handler.
 */

import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import {
  previewReconciliationForRun,
  rejectSmartImportRun,
} from "../services/smart-import-review-service";

function parseRunId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function registerSmartImportReviewRoutes(app: Express): void {
  // ── GET /api/smart-import/:runId/reconciliation-preview ──────────────────
  app.get(
    "/api/smart-import/:runId/reconciliation-preview",
    requireAuth,
    requirePermission("smart_import", "view"),
    async (req: Request, res: Response) => {
      const runId = parseRunId(String(req.params.runId));
      if (runId == null) {
        res.status(400).json({ error: "invalid_run_id" });
        return;
      }
      try {
        const preview = await previewReconciliationForRun(runId);
        res.json({ generatedAt: new Date().toISOString(), ...preview });
      } catch (err) {
        if ((err as { code?: string })?.code === "run_not_found") {
          res.status(404).json({ error: "run_not_found" });
          return;
        }
        console.error("[smart-import-review] preview error:", err);
        res.status(500).json({ error: "reconciliation_preview_failed" });
      }
    },
  );

  // ── POST /api/smart-import/:runId/reject ─────────────────────────────────
  app.post(
    "/api/smart-import/:runId/reject",
    requireAuth,
    requirePermission("smart_import", "edit"),
    async (req: Request, res: Response) => {
      const runId = parseRunId(String(req.params.runId));
      if (runId == null) {
        res.status(400).json({ error: "invalid_run_id" });
        return;
      }
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (!reason) {
        res.status(400).json({
          error: "reason_required",
          message: "A reason is required to reject an import run.",
        });
        return;
      }
      const user = (req as Request & { user?: { id?: number; name?: string; role?: string } }).user;
      try {
        const result = await rejectSmartImportRun({
          runId,
          userId: user?.id ?? null,
          userName: user?.name ?? null,
          role: user?.role ?? null,
          reason,
        });
        if (result.status === "not_rejectable") {
          res.status(409).json({
            error: "not_rejectable",
            message: `This run is ${result.previousStatus}; only a parked run can be rejected.`,
            previousStatus: result.previousStatus,
          });
          return;
        }
        res.json({ ok: true, ...result });
      } catch (err) {
        if ((err as { code?: string })?.code === "run_not_found") {
          res.status(404).json({ error: "run_not_found" });
          return;
        }
        console.error("[smart-import-review] reject error:", err);
        res.status(500).json({ error: "reject_failed" });
      }
    },
  );
}
