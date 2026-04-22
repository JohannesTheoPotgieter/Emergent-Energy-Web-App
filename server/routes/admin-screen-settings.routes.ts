/**
 * Admin screen-settings routes.
 *
 * Endpoints:
 *   GET  /api/admin/screen-settings           — list all screen setting overrides
 *   PUT  /api/admin/screen-settings/:screenId — enable or disable a screen
 *
 * Auth: COO_ADMIN or CEO_ADMIN only.
 */

import type { Express } from "express";
import { z } from "zod";
import { requireAuth } from "../auth-context";
import { requireRole } from "../middleware/requireRole";
import { screenSettingsRepository } from "../repositories/screenSettings.repository";
import { ApiError } from "../lib/api-error";

const SUPER_ROLES = ["COO_ADMIN", "CEO_ADMIN"] as const;

const updateSchema = z.object({
  isEnabled: z.boolean(),
});

export function registerScreenSettingsRoutes(app: Express): void {
  app.get(
    "/api/admin/screen-settings",
    requireAuth,
    requireRole([...SUPER_ROLES]),
    async (_req, res) => {
      const settings = await screenSettingsRepository.getAll();
      res.json(settings);
    },
  );

  app.put(
    "/api/admin/screen-settings/:screenId",
    requireAuth,
    requireRole([...SUPER_ROLES]),
    async (req, res) => {
      const { screenId } = req.params;
      if (!screenId || screenId.trim() === "") throw ApiError.badRequest("screenId is required");

      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) throw ApiError.badRequest("isEnabled (boolean) is required");

      const session = req.session as Record<string, unknown>;
      const userId = typeof session.userId === "number" ? session.userId : null;

      await screenSettingsRepository.upsert(screenId, parsed.data.isEnabled, userId);
      res.json({ ok: true, screenId, isEnabled: parsed.data.isEnabled });
    },
  );
}
