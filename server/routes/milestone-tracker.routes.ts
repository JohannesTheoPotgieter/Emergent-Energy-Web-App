// ============================================================
// Milestone Tracker routes (additive, new-style).
//
// Program overview + per-project payload (payment milestones → linked plan
// tasks → rolled-up outflow cost lines), plus link/unlink writes. All reads
// compose canonical finance + plan surfaces (read-only); the only writes are
// the two augmentation link tables.
//
// RBAC: view + link editing both gate on execution_review (same as the rest of
// the Execution tab — owner decision: all Execution viewers).
// ============================================================

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { jwtAuth, requireAuth, getEffectiveUser } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { validateBody } from "../middleware/validateBody";
import { parseIntParam } from "../lib/req-params";
import { notFound, badRequest } from "../lib/api-error";
import {
  getMilestoneProgram,
  getProjectMilestones,
  linkMilestoneTask,
  unlinkMilestoneTask,
  linkTaskCost,
  unlinkTaskCost,
  linkTaskDependency,
  unlinkTaskDependency,
  listActivityTemplates,
  deleteActivityTemplate,
  updateActivityTemplate,
  createTemplateFromProject,
  applyTemplateToProject,
  MilestoneLinkError,
} from "../services/milestone-tracker-service";

const milestoneTaskSchema = z.object({
  projectId: z.number().int().positive(),
  revenueRowHash: z.string().min(1).max(128),
  workItemId: z.number().int().positive(),
});

const taskCostSchema = z.object({
  projectId: z.number().int().positive(),
  workItemId: z.number().int().positive(),
  costRowHash: z.string().min(1).max(128),
});

const taskDependencySchema = z.object({
  projectId: z.number().int().positive(),
  predecessorId: z.number().int().positive(),
  successorId: z.number().int().positive(),
});

const templateFromProjectSchema = z.object({
  projectId: z.number().int().positive(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
});

const applyTemplateSchema = z.object({
  projectId: z.number().int().positive(),
});

const templateRuleSchema = z.object({
  label: z.string().max(160),
  milestoneKeywords: z.array(z.string().max(80)).max(50),
  taskKeywords: z.array(z.string().max(80)).max(50),
  outflowKeywords: z.array(z.string().max(80)).max(50),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  rules: z.array(templateRuleSchema).max(200).optional(),
});

export function registerMilestoneTrackerRoutes(app: Express) {
  // ── Reads ──────────────────────────────────────────────────────────────
  app.get(
    "/api/milestone-tracker/program",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "view"),
    async (req: Request, res: Response) => {
      const includeSettled = req.query.includeSettled === "true" || req.query.includeSettled === "1";
      res.json(await getMilestoneProgram(new Date(), { includeSettled }));
    },
  );

  app.get(
    "/api/milestone-tracker/projects/:projectId",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "view"),
    async (req: Request, res: Response) => {
      const projectId = parseIntParam(req.params.projectId);
      const detail = await getProjectMilestones(projectId);
      if (!detail) throw notFound("Project");
      res.json(detail);
    },
  );

  // ── Milestone ↔ task links ───────────────────────────────────────────────
  app.post(
    "/api/milestone-tracker/milestone-task-links",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "edit"),
    validateBody(milestoneTaskSchema),
    async (req: Request, res: Response) => {
      const body = milestoneTaskSchema.parse(req.body);
      try {
        await linkMilestoneTask(body.projectId, body.revenueRowHash, body.workItemId, getEffectiveUser(req)?.id ?? null);
      } catch (e) {
        if (e instanceof MilestoneLinkError) throw badRequest(e.message);
        throw e;
      }
      res.status(201).json({ ok: true });
    },
  );

  app.delete(
    "/api/milestone-tracker/milestone-task-links",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "edit"),
    validateBody(milestoneTaskSchema),
    async (req: Request, res: Response) => {
      const body = milestoneTaskSchema.parse(req.body);
      await unlinkMilestoneTask(body.projectId, body.revenueRowHash, body.workItemId);
      res.json({ ok: true });
    },
  );

  // ── Task ↔ cost-line links ───────────────────────────────────────────────
  app.post(
    "/api/milestone-tracker/task-cost-links",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "edit"),
    validateBody(taskCostSchema),
    async (req: Request, res: Response) => {
      const body = taskCostSchema.parse(req.body);
      try {
        await linkTaskCost(body.projectId, body.workItemId, body.costRowHash, getEffectiveUser(req)?.id ?? null);
      } catch (e) {
        if (e instanceof MilestoneLinkError) throw badRequest(e.message);
        throw e;
      }
      res.status(201).json({ ok: true });
    },
  );

  app.delete(
    "/api/milestone-tracker/task-cost-links",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "edit"),
    validateBody(taskCostSchema),
    async (req: Request, res: Response) => {
      const body = taskCostSchema.parse(req.body);
      await unlinkTaskCost(body.projectId, body.workItemId, body.costRowHash);
      res.json({ ok: true });
    },
  );

  // ── Task → task dependencies (MANUAL overlay; reuses work_item_dependencies) ──
  app.post(
    "/api/milestone-tracker/task-dependencies",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "edit"),
    validateBody(taskDependencySchema),
    async (req: Request, res: Response) => {
      const body = taskDependencySchema.parse(req.body);
      try {
        await linkTaskDependency(body.projectId, body.predecessorId, body.successorId, getEffectiveUser(req)?.id ?? null);
      } catch (e) {
        if (e instanceof MilestoneLinkError) throw badRequest(e.message);
        throw e;
      }
      res.status(201).json({ ok: true });
    },
  );

  app.delete(
    "/api/milestone-tracker/task-dependencies",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "edit"),
    validateBody(taskDependencySchema),
    async (req: Request, res: Response) => {
      const body = taskDependencySchema.parse(req.body);
      try {
        await unlinkTaskDependency(body.projectId, body.predecessorId, body.successorId);
      } catch (e) {
        if (e instanceof MilestoneLinkError) throw badRequest(e.message);
        throw e;
      }
      res.json({ ok: true });
    },
  );

  // ── Link templates (build once from a linked project, apply to new ones) ──
  app.get(
    "/api/milestone-tracker/templates",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "view"),
    async (_req: Request, res: Response) => {
      res.json(await listActivityTemplates());
    },
  );

  app.post(
    "/api/milestone-tracker/templates/from-project",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "edit"),
    validateBody(templateFromProjectSchema),
    async (req: Request, res: Response) => {
      const body = templateFromProjectSchema.parse(req.body);
      try {
        const tpl = await createTemplateFromProject(body.projectId, body.name, body.description ?? null, getEffectiveUser(req)?.id ?? null);
        res.status(201).json(tpl);
      } catch (e) {
        if (e instanceof MilestoneLinkError) throw badRequest(e.message);
        throw e;
      }
    },
  );

  app.post(
    "/api/milestone-tracker/templates/:id/apply",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "edit"),
    validateBody(applyTemplateSchema),
    async (req: Request, res: Response) => {
      const id = parseIntParam(req.params.id);
      if (!id || Number.isNaN(id)) throw badRequest("Invalid template id");
      const body = applyTemplateSchema.parse(req.body);
      try {
        res.json(await applyTemplateToProject(body.projectId, id, getEffectiveUser(req)?.id ?? null));
      } catch (e) {
        if (e instanceof MilestoneLinkError) throw badRequest(e.message);
        throw e;
      }
    },
  );

  app.patch(
    "/api/milestone-tracker/templates/:id",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "edit"),
    validateBody(updateTemplateSchema),
    async (req: Request, res: Response) => {
      const id = parseIntParam(req.params.id);
      if (!id || Number.isNaN(id)) throw notFound("Template");
      const body = updateTemplateSchema.parse(req.body);
      try {
        res.json(await updateActivityTemplate(id, body));
      } catch (e) {
        if (e instanceof MilestoneLinkError) throw badRequest(e.message);
        throw e;
      }
    },
  );

  app.delete(
    "/api/milestone-tracker/templates/:id",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "edit"),
    async (req: Request, res: Response) => {
      const id = parseIntParam(req.params.id);
      if (!id || Number.isNaN(id)) throw notFound("Template");
      await deleteActivityTemplate(id);
      res.json({ ok: true });
    },
  );
}
