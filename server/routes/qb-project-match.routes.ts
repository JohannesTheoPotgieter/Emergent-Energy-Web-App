/**
 * Per-project QuickBooks attribution routes (G2 auto-matcher). Read/compare
 * only — nothing is written back to QuickBooks (§ 3.4). Per-project QB is
 * ALWAYS surfaced WITH its coverage; ambiguous / unmatched docs are never
 * force-attributed (they roll to the company "unattributed" bucket + worklist).
 *
 *   POST /api/finance/qb-project-match/refresh            → recompute (financials:edit)
 *   GET  /api/finance/qb-project-match/attribution        → per-project QB + coverage
 *   GET  /api/finance/qb-project-match/project/:projectId  → one project's detail
 *   GET  /api/finance/qb-project-match/worklist?stream=&matchType= → resolve list
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { db } from "../db";
import { parseIntParam } from "../lib/req-params";
import { sendFinanceError } from "../lib/api-error";
import {
  refreshQbProjectMatches,
  getQbProjectAttribution,
  getQbProjectAttributionForProject,
  getQbProjectMatchWorklist,
} from "../services/qb-project-match-service";
import type { MatchStream } from "../lib/finance/qb-project-matcher";

const STREAMS: readonly MatchStream[] = ["COS", "REV"];
const WORKLIST_TYPES = ["ambiguous", "unmatched"] as const;

export function registerQbProjectMatchRoutes(app: Express): void {
  // Recompute the QB↔tracker attribution (full-replace, idempotent).
  app.post(
    "/api/finance/qb-project-match/refresh",
    requireAuth,
    requirePermission("financials", "edit"),
    async (req: Request, res: Response) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const tolerance =
          body.tolerance != null && Number.isFinite(Number(body.tolerance))
            ? Math.max(0, Number(body.tolerance))
            : undefined;
        const monthsBack =
          body.monthsBack != null && Number.isFinite(Number(body.monthsBack))
            ? Math.max(1, Math.floor(Number(body.monthsBack)))
            : undefined;
        const start = typeof body.start === "string" ? body.start : undefined;
        const end = typeof body.end === "string" ? body.end : undefined;
        const summary = await refreshQbProjectMatches(db, { tolerance, monthsBack, start, end });
        res.json({ refreshedAt: new Date().toISOString(), ...summary });
      } catch (err) {
        return sendFinanceError(res, "qb_project_match_refresh_failed", err);
      }
    },
  );

  // Per-project QB attribution + EXPLICIT coverage + company unattributed bucket.
  app.get(
    "/api/finance/qb-project-match/attribution",
    requireAuth,
    requirePermission("financials", "view"),
    async (_req: Request, res: Response) => {
      try {
        const result = await getQbProjectAttribution(db);
        res.json(result);
      } catch (err) {
        return sendFinanceError(res, "qb_project_match_attribution_failed", err);
      }
    },
  );

  // The resolve worklist — unmatched + ambiguous QB docs, never silently dropped.
  app.get(
    "/api/finance/qb-project-match/worklist",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      try {
        const rawStream = String(req.query.stream ?? "").toUpperCase();
        const stream = (STREAMS as readonly string[]).includes(rawStream) ? (rawStream as MatchStream) : undefined;
        const rawType = String(req.query.matchType ?? "");
        const matchType = (WORKLIST_TYPES as readonly string[]).includes(rawType)
          ? (rawType as (typeof WORKLIST_TYPES)[number])
          : undefined;
        const rows = await getQbProjectMatchWorklist(db, { stream, matchType });
        res.json({ generatedAt: new Date().toISOString(), count: rows.length, rows });
      } catch (err) {
        return sendFinanceError(res, "qb_project_match_worklist_failed", err);
      }
    },
  );

  // One project's QB attribution detail (both streams + the matched docs).
  app.get(
    "/api/finance/qb-project-match/project/:projectId",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      const projectId = parseIntParam(req.params.projectId);
      if (projectId == null) {
        res.status(400).json({ error: "invalid_project_id" });
        return;
      }
      try {
        const detail = await getQbProjectAttributionForProject(db, projectId);
        res.json({ generatedAt: new Date().toISOString(), ...detail });
      } catch (err) {
        return sendFinanceError(res, "qb_project_match_project_failed", err);
      }
    },
  );
}
