/**
 * Screen-settings routes.
 *
 * Endpoints:
 *   GET  /api/screen-settings                 — public list of {screenId, isEnabled}
 *                                                 for any signed-in user. Drives the
 *                                                 client-side 404 gate so disabled
 *                                                 screens are unreachable for everyone.
 *   GET  /api/admin/screen-settings           — full admin list with audit metadata.
 *   PUT  /api/admin/screen-settings/:screenId — enable or disable a screen.
 *
 * Auth: signed-in user for the public GET; COO_ADMIN / CEO_ADMIN for the admin
 * GET/PUT.
 */

import type { Express } from "express";
import { z } from "zod";
import { requireAuth } from "../auth-context";
import { requireRole } from "../middleware/requireRole";
import { screenSettingsRepository } from "../repositories/screenSettings.repository";
import { badRequest } from "../lib/api-error";

const SUPER_ROLES = ["COO_ADMIN", "CEO_ADMIN"] as const;

const updateSchema = z.object({
  isEnabled: z.boolean(),
});

export function registerScreenSettingsRoutes(app: Express): void {
  // Public read — every signed-in user needs to know which screens are hidden
  // so the client-side router can 404 disabled routes. We only expose
  // screenId + isEnabled (no actor id, no timestamps) to keep this surface
  // free of audit metadata. Cache-Control is private + 60 s to keep
  // per-tab poll churn down without delaying the next admin toggle past a
  // minute on a normal browser refresh.
  app.get(
    "/api/screen-settings",
    requireAuth,
    async (_req, res) => {
      const settings = await screenSettingsRepository.getAll();
      res.setHeader("Cache-Control", "private, max-age=60");
      res.json(
        settings.map((s) => ({ screenId: s.screenId, isEnabled: s.isEnabled })),
      );
    },
  );

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
      const screenIdParam = req.params.screenId;
      const screenId = typeof screenIdParam === "string" ? screenIdParam.trim() : "";
      if (!screenId) throw badRequest("screenId is required");

      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("isEnabled (boolean) is required");

      const userId = typeof req.user?.id === "number" ? req.user.id : null;

      await screenSettingsRepository.upsert(screenId, parsed.data.isEnabled, userId);
      res.json({ ok: true, screenId, isEnabled: parsed.data.isEnabled });
    },
  );
}
