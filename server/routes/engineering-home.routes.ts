/**
 * Engineering Home routes (delivery-scope rebuild, Phase 1).
 *
 * New-convention route (server/routes/*.routes.ts) built on the spine — it
 * does not touch the legacy `server/engineering-routes.ts` or the retired
 * work-items adapter. Read-only, so no audit logging required.
 *
 * Endpoints:
 *   GET /api/engineering/home    engineering:view
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, getEffectiveUser } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { ApiError, serverError, badRequest, unauthorized, logApiError } from "../lib/api-error";
import { getEngineeringHome } from "../repositories/engineering-home-repository";

/**
 * Query params for GET /api/engineering/home (all optional):
 *   - projectIds: csv of positive ints — scope metrics + portfolio to these
 *     sites (e.g. "12,30").
 *   - ownerUserId: positive int — scope metrics + portfolio + My Work to that
 *     engineer.
 *   - includeCompleted: boolean (default false) — when false, hide completed
 *     tasks and Done-stage projects.
 */
const homeQuerySchema = z.object({
  projectIds: z
    .string()
    .trim()
    .optional()
    .transform((raw) =>
      raw
        ? raw
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [],
    )
    .pipe(z.array(z.coerce.number().int().positive())),
  ownerUserId: z.coerce.number().int().positive().optional(),
  includeCompleted: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export function registerEngineeringHomeRoutes(app: Express): void {
  app.get(
    "/api/engineering/home",
    requireAuth,
    requirePermission("engineering", "view"),
    async (req: Request, res: Response) => {
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();

      const parsed = homeQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw badRequest("Invalid engineering home filters.");
      }
      const { projectIds, ownerUserId, includeCompleted } = parsed.data;

      try {
        const result = await getEngineeringHome(user.id, {
          projectIds: projectIds.length > 0 ? projectIds : undefined,
          ownerUserId,
          includeCompleted,
        });
        res.json(result);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        logApiError("engineering-home", err);
        throw serverError("Engineering home failed. Please retry.");
      }
    },
  );
}
