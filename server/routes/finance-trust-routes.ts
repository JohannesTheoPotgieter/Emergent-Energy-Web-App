/**
 * Finance trust / reporting-integrity routes.
 *
 * Endpoints:
 *   GET /api/finance/trust/exceptions/summary   — counts per red-flag bucket
 *   GET /api/finance/trust/exceptions/queue     — top-N rows per bucket
 *   GET /api/finance/trust/sync-health          — QB + finance connector health
 *   GET /api/finance/trust/revalidation-status  — reports likely needing refresh
 *
 * All routes are read-only, gated at minimum by `requireAuth` plus either
 * `financials:view` (for operational triage) or `requireAdmin` (for the
 * revalidation audit view). None of these routes mutate business data.
 *
 * The legacy `/api/finance/trust-core-report` endpoint (defined inside
 * server/departments/finance-routes.ts) remains the authoritative
 * audit-depth report; these routes are the operator-facing surfaces.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { requirePermission } from "../permission-middleware";
import {
  setFinanceTrustHeaders,
  buildTrustMeta,
  DEFAULT_FINANCE_STALE_SECONDS,
} from "../lib/finance-trust/envelope";
import {
  getFinanceExceptionSummary,
  getFinanceExceptionQueue,
} from "../lib/finance-trust/exceptions";
import { getFinanceSyncHealth } from "../lib/finance-trust/sync-health";
import { getFinanceRevalidationStatus } from "../lib/finance-trust/revalidation";
import { buildFinanceIntegrityReport } from "../lib/finance-trust/integrity-audit";
import { getIntegrationFreshnessReport } from "../services/integration-freshness-service";

/**
 * Guard helper — normalises `?limit=` for the queue endpoint.
 */
function parseLimit(req: Request, fallback: number, max: number): number {
  const raw = typeof req.query.limit === "string" ? req.query.limit : "";
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.trunc(n));
}

export function registerFinanceTrustRoutes(app: Express): void {
  app.get(
    "/api/finance/trust/exceptions/summary",
    requireAuth,
    requirePermission("financials", "view"),
    async (_req: Request, res: Response) => {
      try {
        const summary = await getFinanceExceptionSummary();
        const trust = buildTrustMeta({
          sourceLayer: "canonical",
          canonicalTable: "normalized_cost_lines,normalized_revenue_lines",
          derivedTable: "quickbooks_invoice_links,finance_cos_monthly",
          refreshedAt: summary.generatedAt,
          staleAfterSeconds: 60,
          exceptionCount: summary.totalExceptionCount,
        });
        setFinanceTrustHeaders(res, {
          sourceLayer: "canonical",
          canonicalTable: "normalized_cost_lines,normalized_revenue_lines",
          derivedTable: "quickbooks_invoice_links,finance_cos_monthly",
          refreshedAt: summary.generatedAt,
          staleAfterSeconds: 60,
          exceptionCount: summary.totalExceptionCount,
        });
        res.json({ ...summary, trust });
      } catch (err) {
        console.error("[finance-trust] exception summary failed:", err, err);
        // Security review #4: drop err.message from the response so
        // raw Drizzle/pg errors don't leak schema details to the
        // client. Server log retains the full diagnostic above.
        res.status(500).json({ error: "finance_exception_summary_failed" });
      }
    },
  );

  app.get(
    "/api/finance/trust/exceptions/queue",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      try {
        const limit = parseLimit(req, 50, 500);
        const queue = await getFinanceExceptionQueue(limit);
        const trust = buildTrustMeta({
          sourceLayer: "canonical",
          canonicalTable: "normalized_cost_lines,normalized_revenue_lines",
          derivedTable: "quickbooks_invoice_links",
          refreshedAt: queue.generatedAt,
          staleAfterSeconds: 60,
          exceptionCount: queue.rows.length,
        });
        setFinanceTrustHeaders(res, {
          sourceLayer: "canonical",
          canonicalTable: "normalized_cost_lines,normalized_revenue_lines",
          derivedTable: "quickbooks_invoice_links",
          refreshedAt: queue.generatedAt,
          staleAfterSeconds: 60,
          exceptionCount: queue.rows.length,
        });
        res.json({ ...queue, trust });
      } catch (err) {
        console.error("[finance-trust] exception queue failed:", err, err);
        // Security review #4: drop err.message from the response so
        // raw Drizzle/pg errors don't leak schema details to the
        // client. Server log retains the full diagnostic above.
        res.status(500).json({ error: "finance_exception_queue_failed" });
      }
    },
  );

  app.get(
    "/api/finance/trust/sync-health",
    requireAuth,
    requirePermission("financials", "view"),
    async (_req: Request, res: Response) => {
      try {
        const health = await getFinanceSyncHealth();
        const refreshedAt = health.generatedAt;
        const trust = buildTrustMeta({
          sourceLayer: "derived",
          canonicalTable: "integrations,integration_run_events",
          refreshedAt,
          staleAfterSeconds: 60,
          exceptionCount:
            health.integrations.filter((i) => i.health !== "healthy").length,
        });
        setFinanceTrustHeaders(res, {
          sourceLayer: "derived",
          canonicalTable: "integrations,integration_run_events",
          refreshedAt,
          staleAfterSeconds: 60,
          exceptionCount:
            health.integrations.filter((i) => i.health !== "healthy").length,
          uncertainty: health.anyStale ? "finance_sync_stale" : null,
        });
        res.json({ ...health, trust });
      } catch (err) {
        console.error("[finance-trust] sync health failed:", err, err);
        // Security review #4: drop err.message from the response so
        // raw Drizzle/pg errors don't leak schema details to the
        // client. Server log retains the full diagnostic above.
        res.status(500).json({ error: "finance_sync_health_failed" });
      }
    },
  );

  app.get(
    "/api/finance/trust/integrity-audit",
    requireAuth,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const report = await buildFinanceIntegrityReport();
        const trust = buildTrustMeta({
          sourceLayer: "derived",
          canonicalTable: "normalized_cost_lines,normalized_revenue_lines,quickbooks_invoice_links",
          refreshedAt: report.generatedAt,
          staleAfterSeconds: DEFAULT_FINANCE_STALE_SECONDS,
          exceptionCount: report.findings.reduce(
            (acc, f) => acc + (f.severity === "info" ? 0 : f.count),
            0,
          ),
        });
        setFinanceTrustHeaders(res, {
          sourceLayer: "derived",
          canonicalTable: "normalized_cost_lines,normalized_revenue_lines,quickbooks_invoice_links",
          refreshedAt: report.generatedAt,
          staleAfterSeconds: DEFAULT_FINANCE_STALE_SECONDS,
          exceptionCount: report.findings.reduce(
            (acc, f) => acc + (f.severity === "info" ? 0 : f.count),
            0,
          ),
        });
        res.json({ ...report, trust });
      } catch (err) {
        console.error("[finance-trust] integrity audit failed:", err, err);
        // Security review #4: drop err.message from the response so
        // raw Drizzle/pg errors don't leak schema details to the
        // client. Server log retains the full diagnostic above.
        res.status(500).json({ error: "finance_integrity_audit_failed" });
      }
    },
  );

  app.get(
    "/api/finance/trust/revalidation-status",
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const windowHours =
          typeof req.query.windowHours === "string" && Number(req.query.windowHours) > 0
            ? Math.min(720, Math.trunc(Number(req.query.windowHours)))
            : 24;
        const status = await getFinanceRevalidationStatus(windowHours);
        const trust = buildTrustMeta({
          sourceLayer: "derived",
          canonicalTable: "change_sets",
          refreshedAt: status.generatedAt,
          staleAfterSeconds: DEFAULT_FINANCE_STALE_SECONDS,
          exceptionCount: status.reportsNeedingRevalidation.length,
        });
        setFinanceTrustHeaders(res, {
          sourceLayer: "derived",
          canonicalTable: "change_sets",
          refreshedAt: status.generatedAt,
          staleAfterSeconds: DEFAULT_FINANCE_STALE_SECONDS,
          exceptionCount: status.reportsNeedingRevalidation.length,
        });
        res.json({ ...status, trust });
      } catch (err) {
        console.error("[finance-trust] revalidation status failed:", err, err);
        // Security review #4: drop err.message from the response so
        // raw Drizzle/pg errors don't leak schema details to the
        // client. Server log retains the full diagnostic above.
        res.status(500).json({ error: "finance_revalidation_status_failed" });
      }
    },
  );

  /**
   * GET /api/finance/trust/integration-freshness
   *
   * Unified freshness report across all integrations (Pipedrive,
   * SharePoint, QuickBooks, Microsoft 365). Used by handover flows
   * and reporting surfaces to flag stale external data.
   */
  app.get(
    "/api/finance/trust/integration-freshness",
    requireAuth,
    requirePermission("financials", "view"),
    async (_req: Request, res: Response) => {
      try {
        const report = await getIntegrationFreshnessReport();
        const trust = buildTrustMeta({
          sourceLayer: "derived",
          canonicalTable: "integrations,integration_run_events,sp_list_config",
          refreshedAt: report.generatedAt,
          staleAfterSeconds: 60,
          exceptionCount: report.staleCount + report.failingCount,
          uncertainty: report.overallHealth !== "healthy" ? "integration_freshness_degraded" : null,
        });
        setFinanceTrustHeaders(res, {
          sourceLayer: "derived",
          canonicalTable: "integrations,integration_run_events,sp_list_config",
          refreshedAt: report.generatedAt,
          staleAfterSeconds: 60,
          exceptionCount: report.staleCount + report.failingCount,
          uncertainty: report.overallHealth !== "healthy" ? "integration_freshness_degraded" : null,
        });
        res.json({ ...report, trust });
      } catch (err) {
        console.error("[finance-trust] integration freshness failed:", err, err);
        // Security review #4: drop err.message from the response so
        // raw Drizzle/pg errors don't leak schema details to the
        // client. Server log retains the full diagnostic above.
        res.status(500).json({ error: "integration_freshness_failed" });
      }
    },
  );
}
