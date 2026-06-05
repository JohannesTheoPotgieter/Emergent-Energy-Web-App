/**
 * Import configuration + visibility routes (Smart Import v2).
 *
 * Two concerns, one domain:
 *   - Visibility: per-project import status + the portfolio "needs attention"
 *     list (reads `smart_import_runs` via the runs repo).
 *   - Management: view / edit / clear the remembered import configuration —
 *     learned column mappings (template profiles + rules) and sticky
 *     filename → project bindings.
 *
 * Reuses the existing `smart_import` permission (view / edit) — managing import
 * config is a smart-import admin function, so no new entity is introduced.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";
import { ApiError, badRequest, notFound, serverError } from "../lib/api-error";
import {
  listTemplateProfiles,
  listMappingRulesForProfile,
  updateMappingRule,
  deleteMappingRule,
  deleteTemplateProfile,
  listProjectBindings,
  deleteProjectBinding,
} from "../repositories/import-config-repository";
import {
  getLatestRunForProject,
  listRunsNeedingAttention,
} from "../repositories/import-runs-repository";
import { summarizeImportRun } from "../lib/import/run-summary";

const idParam = z.coerce.number().int().positive();

const updateRuleSchema = z
  .object({
    canonicalField: z.string().min(1).optional(),
    confidenceWeight: z.number().min(0).max(1).optional(),
  })
  .refine((v) => v.canonicalField !== undefined || v.confidenceWeight !== undefined, {
    message: "Provide canonicalField or confidenceWeight",
  });

export function registerImportConfigRoutes(app: Express): void {
  // ====================================================================
  // Visibility
  // ====================================================================

  // GET /api/projects/:projectId/import-status — latest run + derived state.
  app.get(
    "/api/projects/:projectId/import-status",
    requireAuth,
    requirePermission("smart_import", "view"),
    async (req: Request, res: Response) => {
      const parsed = idParam.safeParse(req.params.projectId);
      if (!parsed.success) throw badRequest("Invalid projectId");
      try {
        const run = await getLatestRunForProject(parsed.data);
        res.json({ projectId: parsed.data, latest: run ? summarizeImportRun(run) : null });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[import-config] import-status error:", err);
        throw serverError("Failed to load import status");
      }
    },
  );

  // GET /api/import-config/attention — runs parked for review or failed.
  app.get(
    "/api/import-config/attention",
    requireAuth,
    requirePermission("smart_import", "view"),
    async (_req: Request, res: Response) => {
      try {
        const runs = await listRunsNeedingAttention(50);
        res.json({ items: runs.map(summarizeImportRun) });
      } catch (err) {
        console.error("[import-config] attention error:", err);
        throw serverError("Failed to load imports needing attention");
      }
    },
  );

  // ====================================================================
  // Management — learned column mappings (template profiles + rules)
  // ====================================================================

  app.get(
    "/api/import-config/profiles",
    requireAuth,
    requirePermission("smart_import", "view"),
    async (_req: Request, res: Response) => {
      try {
        const profiles = await listTemplateProfiles();
        const withCounts = await Promise.all(
          profiles.map(async (p) => ({
            ...p,
            ruleCount: (await listMappingRulesForProfile(p.id)).length,
          })),
        );
        res.json({ profiles: withCounts });
      } catch (err) {
        console.error("[import-config] list profiles error:", err);
        throw serverError("Failed to load template profiles");
      }
    },
  );

  app.get(
    "/api/import-config/profiles/:id/rules",
    requireAuth,
    requirePermission("smart_import", "view"),
    async (req: Request, res: Response) => {
      const parsed = idParam.safeParse(req.params.id);
      if (!parsed.success) throw badRequest("Invalid profile id");
      try {
        const rules = await listMappingRulesForProfile(parsed.data);
        res.json({ profileId: parsed.data, rules });
      } catch (err) {
        console.error("[import-config] list rules error:", err);
        throw serverError("Failed to load mapping rules");
      }
    },
  );

  app.patch(
    "/api/import-config/rules/:id",
    requireAuth,
    requirePermission("smart_import", "edit"),
    async (req: Request, res: Response) => {
      const parsed = idParam.safeParse(req.params.id);
      if (!parsed.success) throw badRequest("Invalid rule id");
      const body = updateRuleSchema.safeParse(req.body);
      if (!body.success) throw badRequest(body.error.issues[0]?.message ?? "Invalid body");
      try {
        const updated = await updateMappingRule(parsed.data, body.data);
        if (!updated) throw notFound("Mapping rule not found");
        logAuditFromReq(req, {
          entityType: "smart_import",
          entityId: `rule:${parsed.data}`,
          action: "update_mapping_rule",
          source: "SETTINGS",
          changesJson: body.data,
        });
        res.json({ rule: updated });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[import-config] update rule error:", err);
        throw serverError("Failed to update mapping rule");
      }
    },
  );

  app.delete(
    "/api/import-config/rules/:id",
    requireAuth,
    requirePermission("smart_import", "edit"),
    async (req: Request, res: Response) => {
      const parsed = idParam.safeParse(req.params.id);
      if (!parsed.success) throw badRequest("Invalid rule id");
      try {
        const ok = await deleteMappingRule(parsed.data);
        if (!ok) throw notFound("Mapping rule not found");
        logAuditFromReq(req, {
          entityType: "smart_import",
          entityId: `rule:${parsed.data}`,
          action: "delete_mapping_rule",
          source: "SETTINGS",
        });
        res.json({ success: true });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[import-config] delete rule error:", err);
        throw serverError("Failed to delete mapping rule");
      }
    },
  );

  app.delete(
    "/api/import-config/profiles/:id",
    requireAuth,
    requirePermission("smart_import", "edit"),
    async (req: Request, res: Response) => {
      const parsed = idParam.safeParse(req.params.id);
      if (!parsed.success) throw badRequest("Invalid profile id");
      try {
        const ok = await deleteTemplateProfile(parsed.data);
        if (!ok) throw notFound("Template profile not found");
        logAuditFromReq(req, {
          entityType: "smart_import",
          entityId: `profile:${parsed.data}`,
          action: "delete_template_profile",
          source: "SETTINGS",
        });
        res.json({ success: true });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[import-config] delete profile error:", err);
        throw serverError("Failed to delete template profile");
      }
    },
  );

  // ====================================================================
  // Management — sticky project bindings
  // ====================================================================

  app.get(
    "/api/import-config/bindings",
    requireAuth,
    requirePermission("smart_import", "view"),
    async (_req: Request, res: Response) => {
      try {
        const bindings = await listProjectBindings();
        res.json({ bindings });
      } catch (err) {
        console.error("[import-config] list bindings error:", err);
        throw serverError("Failed to load project bindings");
      }
    },
  );

  app.delete(
    "/api/import-config/bindings/:id",
    requireAuth,
    requirePermission("smart_import", "edit"),
    async (req: Request, res: Response) => {
      const parsed = idParam.safeParse(req.params.id);
      if (!parsed.success) throw badRequest("Invalid binding id");
      try {
        const ok = await deleteProjectBinding(parsed.data);
        if (!ok) throw notFound("Binding not found");
        logAuditFromReq(req, {
          entityType: "smart_import",
          entityId: `binding:${parsed.data}`,
          action: "delete_project_binding",
          source: "SETTINGS",
        });
        res.json({ success: true });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[import-config] delete binding error:", err);
        throw serverError("Failed to delete project binding");
      }
    },
  );
}
