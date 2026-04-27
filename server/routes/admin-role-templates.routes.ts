// Role templates admin API. All endpoints require admin permission.
// User-scoped applies write user_permission_overrides only; they never
// mutate the role definition.

import type { Express, Request, Response } from "express";
import { requirePermission } from "../permission-middleware";
import { z } from "zod";
import {
  applyTemplate,
  applyTemplateToUser,
  compareRoles,
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

function errorToHttpResponse(err: unknown, fallbackMessage: string): {
  status: number;
  body: { error: string };
} {
  if (err instanceof Error) {
    const status =
      typeof (err as Error & { status?: unknown }).status === "number"
        ? (err as Error & { status: number }).status
        : 500;
    return { status, body: { error: err.message || fallbackMessage } };
  }
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    const status = typeof rec.status === "number" ? rec.status : 500;
    const message = typeof rec.message === "string" ? rec.message : fallbackMessage;
    return { status, body: { error: message } };
  }
  return { status: 500, body: { error: fallbackMessage } };
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

  // --- Role vs role comparison (Roles tab "Compare with…") -------------
  app.get(
    "/api/admin/roles/compare",
    requirePermission("admin", "view"),
    async (req: Request, res: Response) => {
      const a = typeof req.query.a === "string" ? req.query.a : "";
      const b = typeof req.query.b === "string" ? req.query.b : "";
      if (!a || !b) {
        return res.status(400).json({ error: "missing_a_or_b" });
      }
      try {
        const result = await compareRoles(a, b);
        res.json(result);
      } catch (err: unknown) {
        const { status, body } = errorToHttpResponse(err, "compare_failed");
        res.status(status).json(body);
      }
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
      } catch (err: unknown) {
        const { status, body } = errorToHttpResponse(err, "preview_failed");
        res.status(status).json(body);
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
      } catch (err: unknown) {
        const { status, body } = errorToHttpResponse(err, "apply_failed");
        res.status(status).json(body);
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
      } catch (err: unknown) {
        const { status, body } = errorToHttpResponse(err, "preview_failed");
        res.status(status).json(body);
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
      } catch (err: unknown) {
        const { status, body } = errorToHttpResponse(err, "apply_failed");
        res.status(status).json(body);
      }
    },
  );
}
