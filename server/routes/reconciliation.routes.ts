/**
 * Reconciliation routes — portfolio reconciliation board + company tracker-vs-QB.
 *
 * Endpoints:
 *   GET  /api/finance/reconciliation            → per-project app-vs-tracker board
 *   GET  /api/finance/reconciliation/company-qb → company tracker-vs-QuickBooks
 *   GET  /api/finance/reconciliation/:projectId → per-project line detail
 *   POST /api/finance/reconciliation/refresh    → recompute reconciliation
 *
 * RBAC: `financials:view` for reads, `financials:edit` for the refresh POST.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { db } from "../db";
import { parseIntParam } from "../lib/req-params";
import { sendFinanceError } from "../lib/api-error";
import {
  getReconciliationPortfolio,
  getReconciliationDetail,
  getCompanyTrackerVsQb,
  refreshReconciliationForProjects,
} from "../services/reconciliation-service";

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Resolve the FY window for the company-level QB comparison from the same `fy`
 * query param the trackers use (FY = 1 Sep → 31 Aug, SAST-anchored). `fy=all`
 * (or absent + scope=all) widens to the whole history.
 */
function resolveCompanyQbWindow(query: Request["query"]): {
  fyStart?: string;
  fyEnd?: string;
  fyLabel: string;
} {
  const raw = String(query.fy ?? "").trim().toLowerCase();
  if (raw === "all" || String(query.scope ?? "").toLowerCase() === "all") {
    return { fyLabel: "All data" };
  }
  const sast = new Date(Date.now() + 120 * 60 * 1000);
  const currentFy = sast.getUTCMonth() + 1 >= 9 ? sast.getUTCFullYear() + 1 : sast.getUTCFullYear();
  const parsed = Number.parseInt(raw, 10);
  const fy = Number.isFinite(parsed) && parsed > 2000 ? parsed : currentFy;
  return {
    fyStart: `${fy - 1}-09-01`,
    fyEnd: `${fy}-08-31`,
    fyLabel: `FY${String(fy).slice(-2)}`,
  };
}

export function registerReconciliationRoutes(app: Express): void {
  // ── GET /api/finance/reconciliation ─────────────────────────────────────
  // Portfolio board: per-project app-vs-tracker status + headline deltas, for
  // every active project. Reads the persisted financial_reconciliation rows.
  app.get(
    "/api/finance/reconciliation",
    requireAuth,
    requirePermission("financials", "view"),
    async (_req: Request, res: Response) => {
      try {
        const projects = await getReconciliationPortfolio(db);
        // Trust posture against the trackers (the Finance Home "Match my
        // trackers?" strip). A `green` status only counts as a real
        // tie-to-tracker when a tracker baseline was actually pasted; with no
        // baseline it is "not compared yet", never a tie.
        const tie = projects.filter((p) => p.status === "green" && p.trackerBaselinePresent).length;
        const drift = projects.filter((p) => p.status === "amber" || p.status === "red").length;
        const notCompared = projects.length - tie - drift;
        res.json({
          generatedAt: new Date().toISOString(),
          projects,
          summary: {
            total: projects.length,
            red: projects.filter((p) => p.status === "red").length,
            unlinked: projects.filter((p) => p.status === "unlinked").length,
            amber: projects.filter((p) => p.status === "amber").length,
            green: projects.filter((p) => p.status === "green").length,
            unknown: projects.filter((p) => p.status === "unknown").length,
            // Tracker trust posture (tie-to-tracker / drift / not compared yet).
            tie,
            drift,
            notCompared,
          },
        });
      } catch (err) {
        return sendFinanceError(res, "reconciliation_portfolio_failed", err);
      }
    },
  );

  // ── GET /api/finance/reconciliation/company-qb ──────────────────────────
  // Company-level tracker-vs-QuickBooks: app canonical §3.3 totals (Revenue /
  // COS / GP) vs QuickBooks' P&L for the FY window, with per-metric tie/drift.
  // QB cost bills aren't project-tagged, so COS/GP reconcile at company grain
  // only (per-project QB stays revenue/AR). Registered BEFORE :projectId so the
  // literal path isn't captured by the detail matcher. Read-only.
  app.get(
    "/api/finance/reconciliation/company-qb",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      try {
        const { fyStart, fyEnd, fyLabel } = resolveCompanyQbWindow(req.query);
        const result = await getCompanyTrackerVsQb(db, { fyStart, fyEnd, fyLabel });
        res.json(result);
      } catch (err) {
        return sendFinanceError(res, "reconciliation_company_qb_failed", err);
      }
    },
  );

  // ── GET /api/finance/reconciliation/:projectId ──────────────────────────
  // Detail: contributing lines with revenue_derived / revenue_stored /
  // recon_delta + source_cell, flagging the offending line(s) the drawer drills to.
  app.get(
    "/api/finance/reconciliation/:projectId",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      const projectId = parseIntParam(req.params.projectId);
      if (projectId == null) {
        res.status(400).json({ error: "invalid_project_id" });
        return;
      }
      try {
        const detail = await getReconciliationDetail(db, projectId);
        res.json({ generatedAt: new Date().toISOString(), ...detail });
      } catch (err) {
        return sendFinanceError(res, "reconciliation_detail_failed", err);
      }
    },
  );

  // ── POST /api/finance/reconciliation/refresh ────────────────────────────
  // On-demand recompute (the smart-import commit triggers this automatically).
  // Recomputes + snapshot-refreshes financial_reconciliation for all active
  // projects, or the optional `projectIds` body subset.
  app.post(
    "/api/finance/reconciliation/refresh",
    requireAuth,
    requirePermission("financials", "edit"),
    async (req: Request, res: Response) => {
      try {
        const body = (req.body ?? {}) as { projectIds?: unknown };
        const projectIds = Array.isArray(body.projectIds)
          ? body.projectIds.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0)
          : null;
        const summary = await refreshReconciliationForProjects(db, projectIds);
        res.json({ refreshedAt: new Date().toISOString(), ...summary });
      } catch (err) {
        console.error("[reconciliation] refresh error:", err);
        res.status(500).json({ error: "reconciliation_refresh_failed" });
      }
    },
  );
}
