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

export function registerMilestoneTrackerRoutes(app: Express) {
  // ── Reads ──────────────────────────────────────────────────────────────
  app.get(
    "/api/milestone-tracker/program",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "view"),
    async (_req: Request, res: Response) => {
      res.json(await getMilestoneProgram());
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
    requirePermission("execution_review", "create"),
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
    requirePermission("execution_review", "delete"),
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
    requirePermission("execution_review", "create"),
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
    requirePermission("execution_review", "delete"),
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
    requirePermission("execution_review", "create"),
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
    requirePermission("execution_review", "delete"),
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
}
