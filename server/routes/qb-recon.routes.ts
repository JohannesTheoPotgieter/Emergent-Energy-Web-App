/**
 * Company-wide tracker-vs-QuickBooks reconciliation routes (R2). Read-only +
 * an on-demand refresh. NO project dimension — see qb-tracker-reconcile.ts and
 * docs/finance-reconciliation.md. Recon-ignores stay visible/audited on the
 * existing per-project detail surface; ignored QB docs are excluded from the gap.
 *
 *   GET  /api/finance/qb-recon/summary?grain=month|week|day   → per-period REV/COS/GP
 *   GET  /api/finance/qb-recon/lines?status=&period=          → the worklist
 *   POST /api/finance/qb-recon/refresh                        → recompute (financials:edit)
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { db } from "../db";
import { parseIntParam } from "../lib/req-params";
import {
  getQbReconSummary,
  getQbReconLines,
  getActiveQbReconIgnores,
  refreshQbTrackerReconciliation,
  type PeriodGrain,
  type ReconLineStatus,
} from "../services/qb-tracker-reconcile";

const GRAINS: readonly PeriodGrain[] = ["day", "week", "month"];
const STATUSES: readonly ReconLineStatus[] = ["matched", "amount_variance", "tracker_only", "qb_only"];

export function registerQbReconRoutes(app: Express): void {
  // Per-period REV / COS / GP (GP = REV − COS each side), tracker vs QuickBooks.
  app.get(
    "/api/finance/qb-recon/summary",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      try {
        const raw = String(req.query.grain ?? "month");
        const grain: PeriodGrain = (GRAINS as readonly string[]).includes(raw) ? (raw as PeriodGrain) : "month";
        const periods = await getQbReconSummary(db, grain);
        res.json({ generatedAt: new Date().toISOString(), grain, periods });
      } catch (err) {
        console.error("[qb-recon] summary error:", err);
        res.status(500).json({ error: "qb_recon_summary_failed" });
      }
    },
  );

  // The worklist — filter by status and/or fiscal period.
  app.get(
    "/api/finance/qb-recon/lines",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      try {
        const rawStatus = String(req.query.status ?? "");
        const status = (STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as ReconLineStatus) : undefined;
        const fiscalPeriodId = req.query.period != null ? parseIntParam(String(req.query.period)) ?? undefined : undefined;
        const lines = await getQbReconLines(db, { status, fiscalPeriodId });
        res.json({ generatedAt: new Date().toISOString(), count: lines.length, lines });
      } catch (err) {
        console.error("[qb-recon] lines error:", err);
        res.status(500).json({ error: "qb_recon_lines_failed" });
      }
    },
  );

  // Active recon-ignores (both sides), surfaced with who/why so suppressed QB
  // variances are visible, never silently dropped. Read-only.
  app.get(
    "/api/finance/qb-recon/ignores",
    requireAuth,
    requirePermission("financials", "view"),
    async (_req: Request, res: Response) => {
      try {
        const ignores = await getActiveQbReconIgnores(db);
        res.json({ generatedAt: new Date().toISOString(), count: ignores.length, ignores });
      } catch (err) {
        console.error("[qb-recon] ignores error:", err);
        res.status(500).json({ error: "qb_recon_ignores_failed" });
      }
    },
  );

  // On-demand recompute (the daily scheduler triggers this automatically).
  app.post(
    "/api/finance/qb-recon/refresh",
    requireAuth,
    requirePermission("financials", "edit"),
    async (_req: Request, res: Response) => {
      try {
        const summary = await refreshQbTrackerReconciliation(db);
        res.json({ refreshedAt: new Date().toISOString(), ...summary });
      } catch (err) {
        console.error("[qb-recon] refresh error:", err);
        res.status(500).json({ error: "qb_recon_refresh_failed" });
      }
    },
  );
}
