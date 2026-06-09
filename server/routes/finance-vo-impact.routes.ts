/**
 * Finance Variation Order (VO) impact endpoint.
 *
 *   GET /api/finance/projects/:projectId/vo-impact
 *     Per-project list of every live VO with its revenue delta, cost delta and
 *     GP impact, plus the BR-025/026 5%-of-GP gate (live + frozen-at-submit) and
 *     the canonical (§3.3) project GP used as the 5% base.
 *
 * Read-only. Sourced from `change_requests` + the canonical line engine via
 * server/services/vo-impact-service.ts — never a parallel revenue/GP calc.
 * Finance and execution both consume that one service, so VO numbers cannot
 * diverge across the two surfaces.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { badRequest, ApiError, serverError } from "../lib/api-error";
import { parseIntParam, paramStr } from "../lib/req-params";
import { getProjectVoImpacts } from "../services/vo-impact-service";

export function registerFinanceVoImpactRoutes(app: Express): void {
  app.get(
    "/api/finance/projects/:projectId/vo-impact",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseIntParam(req.params.projectId);
        if (!Number.isInteger(projectId) || projectId <= 0) {
          throw badRequest("Invalid projectId", { projectId: paramStr(req.params.projectId) });
        }
        const impact = await getProjectVoImpacts(projectId);
        res.json(impact);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const wrapped = serverError("Failed to load VO impact");
        (wrapped as unknown as { cause?: unknown }).cause = err;
        throw wrapped;
      }
    },
  );
}
