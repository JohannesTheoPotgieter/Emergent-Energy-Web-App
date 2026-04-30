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
import { trackerReplicaRepository } from "../repositories/tracker-replica-repository";
import { ApiError, badRequest, notFound, serverError } from "../lib/api-error";

const projectIdParam = z.coerce.number().int().positive();

function parseProjectId(raw: unknown): number {
  const parsed = projectIdParam.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid projectId");
  return parsed.data;
}

export function registerTrackerReplicaRoutes(app: Express): void {
  // ---- Revenue Tracking sheet ---------------------------------------
  app.get(
    "/api/tracker-replica/:projectId/revenue-tracking",
    requireAuth,
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
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[tracker-replica] revenue-tracking error:", err);
        throw serverError("Failed to load revenue tracking data");
      }
    },
  );

  // ---- Expenditure Breakdown sheet ----------------------------------
  app.get(
    "/api/tracker-replica/:projectId/expenditure-breakdown",
    requireAuth,
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
  // tables into a single chronological list. Used by the "Manual Edits"
  // tab so auditors can answer "who edited what when" without writing
  // SQL. Read-only.
  app.get(
    "/api/tracker-replica/:projectId/manual-overrides",
    requireAuth,
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

  // ---- Project / Program Plan sheet ---------------------------------
  app.get(
    "/api/tracker-replica/:projectId/program-plan",
    requireAuth,
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
