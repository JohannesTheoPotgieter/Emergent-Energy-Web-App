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
import { requireAuth, getEffectiveUser } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { ApiError, serverError, unauthorized } from "../lib/api-error";
import { getEngineeringHome } from "../repositories/engineering-home-repository";

export function registerEngineeringHomeRoutes(app: Express): void {
  app.get(
    "/api/engineering/home",
    requireAuth,
    requirePermission("engineering", "view"),
    async (req: Request, res: Response) => {
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      try {
        const result = await getEngineeringHome(user.id);
        res.json(result);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[engineering-home] error:", err);
        throw serverError(err instanceof Error ? err.message : "Engineering home failed");
      }
    },
  );
}
