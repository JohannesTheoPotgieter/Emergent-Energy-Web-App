/**
 * Tracker Replica routes — read-only per-project replicas of the source
 * Tracker workbook sheets.
 *
 * Endpoints:
 *   GET /api/tracker-replica/:projectId/revenue-tracking
 *     → { summary, milestones }
 *   GET /api/tracker-replica/:projectId/expenditure-breakdown
 *     → { costLines, actualBatches, header }
 *   GET /api/tracker-replica/:projectId/program-plan
 *     → { metadata, tasks }
 *
 * All reads go through TrackerReplicaRepository which filters effective_to
 * IS NULL on temporal tables and deleted_at IS NULL on work_items.
 *
 * Auth: requireAuth — these screens are visible to anyone with an active
 * session. Per-role gating happens at the page-registry level (frontend).
 * No mutation endpoints in v1 (the brief lists inline editing as out of
 * scope), so no requireRole guard.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { requirePermission } from "../permission-middleware";
import { trackerReplicaRepository } from "../repositories/tracker-replica-repository";
import { ApiError, badRequest, notFound, serverError } from "../lib/api-error";
import { withTrust } from "../lib/finance-trust/envelope";

const projectIdParam = z.coerce.number().int().positive();

function parseProjectId(raw: unknown): number {
  const parsed = projectIdParam.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid projectId");
  return parsed.data;
}

async function preflightBadgeProjectParam(req: Request, res: Response, next: () => void) {
  try {
    const projectId = parseProjectId(req.params.projectId);
    const exists = await trackerReplicaRepository.projectExists(projectId);
    if (!exists) throw notFound("Project");
    next();
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: err.code, message: err.message, code: err.code });
      return;
    }
    next();
  }
}

export function registerTrackerReplicaRoutes(app: Express): void {
  // ---- Revenue Tracking sheet ---------------------------------------
  // Returns project-level revenue (planned/actual + milestone list).
  // Gated by `revenue_tracker:view` to mirror the existing finance routes
  // (server/departments/finance-routes.ts:1823 uses the same gate). Without
  // this an authenticated ENGINEER could iterate projectId and pull every
  // project's revenue.
  app.get(
    "/api/tracker-replica/:projectId/revenue-tracking",
    requireAuth,
    requirePermission("revenue_tracker", "view"),
    async (req: Request, res: Response) => {
      const projectId = parseProjectId(req.params.projectId);

      try {
        const exists = await trackerReplicaRepository.projectExists(projectId);
        if (!exists) throw notFound("Project");

        const [summary, milestones] = await Promise.all([
          trackerReplicaRepository.getRevenueSummary(projectId),
          trackerReplicaRepository.getRevenueLines(projectId),
        ]);

        res.json({
          projectId,
          summary,
          milestones,
          trust: withTrust(res, {
            sourceLayer: "canonical",
            canonicalTable: "normalized_revenue_lines, tracker_revenue_summary",
          }),
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[tracker-replica] revenue-tracking error:", err);
        throw serverError("Failed to load revenue tracking data");
      }
    },
  );

  // ---- Expenditure Breakdown sheet ----------------------------------
  // Cost lines + actual batches + sidebar header values. Gated by
  // `cos:view` to mirror the existing COS routes.
  app.get(
    "/api/tracker-replica/:projectId/expenditure-breakdown",
    requireAuth,
    requirePermission("cos", "view"),
    async (req: Request, res: Response) => {
      const projectId = parseProjectId(req.params.projectId);

      try {
        const exists = await trackerReplicaRepository.projectExists(projectId);
        if (!exists) throw notFound("Project");

        const [costLines, actualBatches] = await Promise.all([
          trackerReplicaRepository.getCostLines(projectId),
          trackerReplicaRepository.getCostLineActuals(projectId),
        ]);

        // Header values (USD rate, ZAR/W) are sidebar-level on the source
        // sheet. The importer parks them on each cost line; pick the first
        // non-null value as the canonical header for this project.
        let usdExchangeRate: string | null = null;
        let pricePerWatt: string | null = null;
        for (const line of costLines) {
          if (usdExchangeRate == null && line.usdExchangeRate != null) {
            usdExchangeRate = line.usdExchangeRate;
          }
          if (pricePerWatt == null && line.pricePerWatt != null) {
            pricePerWatt = line.pricePerWatt;
          }
          if (usdExchangeRate != null && pricePerWatt != null) break;
        }

        res.json({
          projectId,
          costLines,
          actualBatches,
          header: { usdExchangeRate, pricePerWatt },
          trust: withTrust(res, {
            sourceLayer: "canonical",
            canonicalTable: "normalized_cost_lines, normalized_cost_line_actuals",
          }),
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[tracker-replica] expenditure-breakdown error:", err);
        throw serverError("Failed to load expenditure breakdown data");
      }
    },
  );

  // ---- Manual-override audit log (read surface) ---------------------
  // Flattens the manual_overrides JSONB across all three canonical
  // tables into a single chronological list. Surfaces editor user IDs
  // so auditors can answer "who edited what when" — gate behind
  // revenue_tracker:view since the audit content includes financial
  // values, and pair with a hard role gate so an ENGINEER can't
  // enumerate other staff's edits. (Tightened in response to security
  // review finding #1.)
  app.get(
    "/api/tracker-replica/:projectId/manual-overrides",
    requireAuth,
    requirePermission("revenue_tracker", "view"),
    async (req: Request, res: Response) => {
      const projectId = parseProjectId(req.params.projectId);

      try {
        const exists = await trackerReplicaRepository.projectExists(projectId);
        if (!exists) throw notFound("Project");

        const entries = await trackerReplicaRepository.getManualOverrides(projectId);

        res.json({ projectId, entries });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[tracker-replica] manual-overrides error:", err);
        throw serverError("Failed to load manual override log");
      }
    },
  );

  // ---- Drift count badge -------------------------------------------
  // Returns only the verified / unverified field-level drift counts for
  // a project. Gated at excel_vs_app:view (all 16 company roles) so every
  // Execution user sees the badge. Does NOT return per-field detail — only
  // aggregate counts per section. The full diff lives at
  // /api/excel-vs-app/projects/:projectId.
  app.get(
    "/api/tracker-replica/:projectId/drift-count",
    preflightBadgeProjectParam,
    requireAuth,
    requirePermission("excel_vs_app", "view"),
    async (req: Request, res: Response) => {
      const projectId = parseProjectId(req.params.projectId);

      try {
        const exists = await trackerReplicaRepository.projectExists(projectId);
        if (!exists) throw notFound("Project");

        const detail = await trackerReplicaRepository.getDriftDetail(projectId);
        const { PLAN, REVENUE, EXPENDITURE } = detail.summary;
        res.json({
          projectId,
          unverified: PLAN.unverified + REVENUE.unverified + EXPENDITURE.unverified,
          verified:   PLAN.verified   + REVENUE.verified   + EXPENDITURE.verified,
          bySection: {
            PLAN:        { unverified: PLAN.unverified,        verified: PLAN.verified },
            REVENUE:     { unverified: REVENUE.unverified,     verified: REVENUE.verified },
            EXPENDITURE: { unverified: EXPENDITURE.unverified, verified: EXPENDITURE.verified },
          },
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[tracker-replica] drift-count error:", err);
        throw serverError("Failed to load drift count");
      }
    },
  );

  // ---- Import freshness badge ---------------------------------------
  // Returns the last committed Smart Import run date + staleness flag
  // for a project. Gated at work_items:view (broadest Execution gate)
  // so every role that can view a project can see when tracker data was
  // last synced. Does NOT expose import run details or financial data.
  app.get(
    "/api/tracker-replica/:projectId/import-freshness",
    preflightBadgeProjectParam,
    requireAuth,
    requirePermission("work_items", "view"),
    async (req: Request, res: Response) => {
      const projectId = parseProjectId(req.params.projectId);

      try {
        const exists = await trackerReplicaRepository.projectExists(projectId);
        if (!exists) throw notFound("Project");

        const freshness = await trackerReplicaRepository.getImportFreshness(projectId);
        res.json({ projectId, ...freshness });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[tracker-replica] import-freshness error:", err);
        throw serverError("Failed to load import freshness");
      }
    },
  );

  // ---- Project / Program Plan sheet ---------------------------------
  // WBS task list + project-plan metadata. Gated by `work_items:view`
  // to mirror existing PM-section permissions.
  app.get(
    "/api/tracker-replica/:projectId/program-plan",
    requireAuth,
    requirePermission("work_items", "view"),
    async (req: Request, res: Response) => {
      const projectId = parseProjectId(req.params.projectId);

      try {
        const exists = await trackerReplicaRepository.projectExists(projectId);
        if (!exists) throw notFound("Project");

        const [metadata, tasks] = await Promise.all([
          trackerReplicaRepository.getProjectMetadata(projectId),
          trackerReplicaRepository.getProgramPlanTasks(projectId),
        ]);

        res.json({
          projectId,
          metadata,
          tasks,
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[tracker-replica] program-plan error:", err);
        throw serverError("Failed to load program plan data");
      }
    },
  );
}
