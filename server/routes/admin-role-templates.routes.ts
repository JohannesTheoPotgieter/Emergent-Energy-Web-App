// Role templates admin API — Task #101.
//
// All endpoints gated by requirePermission('admin','edit') so only
// COO/CEO admins can list, preview, or apply templates. Mirrors the
// canonical evaluator path used everywhere else.
//
// GET    /api/admin/role-templates                       — list curated templates
// POST   /api/admin/roles/:role/preview-template/:tplKey — plain-English diff
// POST   /api/admin/roles/:role/apply-template           — body { templateKey, reason }

import type { Express, Request, Response } from "express";
import { requirePermission } from "../permission-middleware";
import { z } from "zod";
import {
  applyTemplate,
  listRoleTemplates,
  previewApplyTemplate,
} from "../services/role-template-service";

const ApplyBody = z.object({
  templateKey: z.string().min(1),
  reason: z.string().min(3, "A short reason is required so the audit log is meaningful."),
});

export function registerRoleTemplateRoutes(app: Express) {
  app.get(
    "/api/admin/role-templates",
    requirePermission("admin", "view"),
    async (_req: Request, res: Response) => {
      const rows = await listRoleTemplates();
      res.json({ templates: rows });
    },
  );

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
      const actor = (req.user as any)?.id ?? 0;
      try {
        const result = await applyTemplate(
          req.params.role,
          parsed.data.templateKey,
          actor,
          parsed.data.reason,
        );
        res.json(result);
      } catch (err: any) {
        res.status(err?.status ?? 500).json({ error: err?.message ?? "apply_failed" });
      }
    },
  );
}
