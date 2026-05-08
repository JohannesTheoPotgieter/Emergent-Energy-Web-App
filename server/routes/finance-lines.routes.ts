/**
 * Line-level finance read endpoint.
 *
 *   GET /api/finance/lines/:projectId
 *     ?fyStart=YYYY-MM-DD&fyEnd=YYYY-MM-DD
 *
 * Returns per-line revenue / COS / GP for one project, derived from the
 * canonical category-scoped POC formula in AGENT_GUARDRAILS § 3.3:
 *
 *     perLineRevenue = (line.actualTotal / category.totalActualTotal)
 *                      × category.revenueAllocation
 *
 * The endpoint is read-only and is the single source of truth that the
 * GP page (PR 5), the Revenue / COS recon-grid cutover (PR 2), and the
 * portfolio aggregator (PR 4) all consume. Do not re-implement the
 * formula elsewhere.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { badRequest, ApiError, serverError } from "../lib/api-error";
import {
  FinanceLineLevelRepository,
  aggregateLinesByMonth,
} from "../repositories/finance-line-level-repository";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) {
    throw badRequest(`Invalid ${field} — expected YYYY-MM-DD`, { [field]: String(value) });
  }
  return value;
}

function parseProjectId(raw: unknown): number {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw badRequest("projectId is required", { projectId: String(raw ?? "") });
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw badRequest("projectId must be a positive integer", { projectId: String(raw) });
  }
  return n;
}

export function registerFinanceLinesRoutes(app: Express): void {
  const repo = new FinanceLineLevelRepository();

  app.get(
    "/api/finance/lines/:projectId",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req.params.projectId);
        const fyStart = parseIsoDate(req.query.fyStart, "fyStart");
        const fyEnd = parseIsoDate(req.query.fyEnd, "fyEnd");
        if (fyStart && fyEnd && fyStart > fyEnd) {
          throw badRequest("fyStart must be on or before fyEnd", { fyStart, fyEnd });
        }

        const lines = await repo.getProjectFinanceLines(projectId, { fyStart, fyEnd });
        const aggregated = aggregateLinesByMonth(lines);

        res.json({
          projectId,
          fyStart: fyStart ?? null,
          fyEnd: fyEnd ?? null,
          lines,
          monthly: aggregated.byMonth,
          unrecognised: aggregated.unrecognised,
          total: aggregated.total,
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const wrapped = serverError("Failed to load finance lines");
        (wrapped as unknown as { cause?: unknown }).cause = err;
        throw wrapped;
      }
    },
  );
}
