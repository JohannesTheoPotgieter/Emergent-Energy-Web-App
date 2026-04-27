// Role templates admin API — Task #101.
//
// All endpoints gated by requirePermission so only COO/CEO admins can
// list, preview, or apply templates. Mirrors the canonical evaluator
// path used everywhere else.
//
// GET    /api/admin/role-templates                         — list curated templates
// GET    /api/admin/roles/:role/preview-template/:tplKey   — plain-English diff vs role
// POST   /api/admin/roles/:role/apply-template             — body { templateKey, reason }
// GET    /api/admin/users/:userId/preview-template/:tplKey — plain-English diff vs user
// POST   /api/admin/users/:userId/apply-template           — body { templateKey, reason }
//
// User-scoped applies write user_permission_overrides; they NEVER mutate
// the role definition itself (security guarantee — see service docstring).

import type { Express, Request, Response } from "express";
import { requirePermission } from "../permission-middleware";
import { z } from "zod";
import {
  applyTemplate,
  applyTemplateToUser,
  listRoleTemplates,
  previewApplyTemplate,
  previewApplyTemplateToUser,
} from "../services/role-template-service";

const ApplyBody = z.object({
  templateKey: z.string().min(1),
  reason: z.string().min(3, "A short reason is required so the audit log is meaningful."),
});

function actorFrom(req: Request): { id: number; role: string | null } {
  const u = (req.user as { id?: number; role?: string } | undefined) ?? undefined;
  return { id: u?.id ?? 0, role: u?.role ?? null };
}

export function registerRoleTemplateRoutes(app: Express) {
  app.get(
    "/api/admin/role-templates",
    requirePermission("admin", "view"),
    async (_req: Request, res: Response) => {
      const rows = await listRoleTemplates();
      res.json({ templates: rows });
    },
  );

  // --- Role-scoped (Roles tab) -----------------------------------------
  app.get(
    "/api/admin/roles/:role/preview-template/:templateKey",
    requirePermission("admin", "view"),
    async (req: Request, res: Response) => {
      try {
        const diff = await previewApplyTemplate(req.params.role, req.params.templateKey);
        res.json(diff);
      } catch (err: any) {
        res.status(err?.status ?? 500).json({ error: err?.message ?? "preview_failed" });
      }
    },
  );

  app.post(
    "/api/admin/roles/:role/apply-template",
    requirePermission("admin", "edit"),
    async (req: Request, res: Response) => {
      const parsed = ApplyBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_body", details: parsed.error.format() });
      }
      const actor = actorFrom(req);
      try {
        const result = await applyTemplate(
          req.params.role,
          parsed.data.templateKey,
          actor.id,
          actor.role,
          parsed.data.reason,
        );
        res.json(result);
      } catch (err: any) {
        res.status(err?.status ?? 500).json({ error: err?.message ?? "apply_failed" });
      }
    },
  );

  // --- User-scoped (People tab) ----------------------------------------
  app.get(
    "/api/admin/users/:userId/preview-template/:templateKey",
    requirePermission("admin", "view"),
    async (req: Request, res: Response) => {
      const userId = Number(req.params.userId);
      if (!Number.isFinite(userId) || userId <= 0) {
        return res.status(400).json({ error: "invalid_user_id" });
      }
      try {
        const diff = await previewApplyTemplateToUser(userId, req.params.templateKey);
        res.json(diff);
      } catch (err: any) {
        res.status(err?.status ?? 500).json({ error: err?.message ?? "preview_failed" });
      }
    },
  );

  app.post(
    "/api/admin/users/:userId/apply-template",
    requirePermission("admin", "edit"),
    async (req: Request, res: Response) => {
      const userId = Number(req.params.userId);
      if (!Number.isFinite(userId) || userId <= 0) {
        return res.status(400).json({ error: "invalid_user_id" });
      }
      const parsed = ApplyBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_body", details: parsed.error.format() });
      }
      const actor = actorFrom(req);
      try {
        const result = await applyTemplateToUser(
          userId,
          parsed.data.templateKey,
          actor.id,
          actor.role,
          parsed.data.reason,
        );
        res.json(result);
      } catch (err: any) {
        res.status(err?.status ?? 500).json({ error: err?.message ?? "apply_failed" });
      }
    },
  );
}
