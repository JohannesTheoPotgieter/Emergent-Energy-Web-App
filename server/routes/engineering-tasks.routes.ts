/**
 * Engineering Tasks routes (delivery-scope rebuild, Phase 2).
 *
 * New-convention routes on the spine (work_items via the repository layer) —
 * replaces the legacy /api/eng/tasks surface. Status transitions go through the
 * single workflow chokepoint, which enforces the Done-gate (no Done without a
 * linked document). Every body is Zod-validated; errors are ApiError only.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, getEffectiveUser } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { validateBody } from "../middleware/validateBody";
import { ApiError, badRequest, conflict, notFound, serverError, unauthorized, logApiError } from "../lib/api-error";
import { TaskWorkflowGuardError } from "../lib/task-workflow-guard";
import { requireEngTaskOwnership } from "../middleware/requireEngTaskOwnership";
import { getEffectiveWorkstreamVisibility } from "../workstream-visibility-middleware";
import { TASK_STATUSES, TASK_PRIORITIES, normalizeRoleForPermissions } from "@shared/schema";
import {
  engineeringDeliveryTaskTypeTagSchema,
  engineeringSeamTaskTypeTagSchema,
} from "@shared/engineering/delivery-task-catalog";
import * as tasksRepo from "../repositories/engineering-tasks-repository";

const idParam = z.coerce.number().int().positive();

const listQuerySchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  ownerUserId: z.coerce.number().int().positive().optional(),
  status: z.string().max(64).optional(),
  taskTypeTag: z.string().max(64).optional(),
  dueBefore: z.string().max(32).optional(),
});

const createSchema = z.object({
  projectId: z.number().int().positive().nullish(),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).nullish(),
  taskTypeTag: engineeringDeliveryTaskTypeTagSchema.optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  ownerUserId: z.number().int().positive().nullish(),
  endDate: z.string().max(32).optional(),
});

const bulkCreateSchema = z.object({
  projectId: z.number().int().positive().nullish(),
  taskTypeTags: z.array(engineeringDeliveryTaskTypeTagSchema).min(1).max(50),
  ownerUserId: z.number().int().positive().nullish(),
  dueDate: z.string().max(32).optional(),
});

const statusSchema = z.object({
  status: z.enum(TASK_STATUSES),
  reason: z.string().max(1000).optional(),
});

const linkDocSchema = z
  .object({
    managedDocumentId: z.number().int().positive().optional(),
    projectDocumentLinkId: z.number().int().positive().optional(),
    linkRole: z.enum(["output", "evidence", "reference"]).optional(),
  })
  .refine((d) => d.managedDocumentId != null || d.projectDocumentLinkId != null, {
    message: "Provide managedDocumentId or projectDocumentLinkId.",
  });

const seamSchema = z.object({
  seamType: engineeringSeamTaskTypeTagSchema,
  toOwnerUserId: z.number().int().positive(),
  title: z.string().min(1).max(500),
  note: z.string().max(5000).optional(),
  fromTaskId: z.number().int().positive().optional(),
  projectId: z.number().int().positive().nullish(),
  dueDate: z.string().max(32).optional(),
});

function actorId(req: Request): number {
  const user = getEffectiveUser(req);
  if (!user) throw unauthorized();
  return user.id;
}

function handleError(scope: string, err: unknown): never {
  if (err instanceof TaskWorkflowGuardError) throw badRequest(err.message);
  if (err instanceof ApiError) throw err;
  // Log the raw cause server-side; never surface raw DB/Drizzle text to the
  // client (AGENT_GUARDRAILS § 5A).
  logApiError(`engineering-tasks:${scope}`, err);
  throw serverError("Engineering tasks request failed. Please retry.");
}

export function registerEngineeringTasksRoutes(app: Express): void {
  app.get(
    "/api/engineering/tasks",
    requireAuth,
    requirePermission("eng_tasks", "view"),
    async (req: Request, res: Response) => {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) throw badRequest("Invalid filters");
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      try {
        const visibility = await getEffectiveWorkstreamVisibility(user.id, normalizeRoleForPermissions(user.role) ?? "");
        const filters = { ...parsed.data };
        // Scope-'own' roles (e.g. ENGINEER) see only the tasks they own.
        if (visibility.scope === "own") filters.ownerUserId = user.id;
        res.json({ tasks: await tasksRepo.listEngineeringTasks(filters) });
      } catch (err) {
        handleError("list", err);
      }
    },
  );

  app.get(
    "/api/engineering/options",
    requireAuth,
    requirePermission("eng_tasks", "view"),
    async (_req: Request, res: Response) => {
      try {
        res.json(await tasksRepo.getEngineeringOptions());
      } catch (err) {
        handleError("options", err);
      }
    },
  );

  app.post(
    "/api/engineering/tasks",
    requireAuth,
    requirePermission("eng_tasks", "create"),
    validateBody(createSchema),
    async (req: Request, res: Response) => {
      const body = req.body as z.infer<typeof createSchema>;
      try {
        const task = await tasksRepo.createEngineeringTask(body, actorId(req));
        res.status(201).json({ task });
      } catch (err) {
        handleError("create", err);
      }
    },
  );

  app.post(
    "/api/engineering/tasks/bulk",
    requireAuth,
    requirePermission("eng_tasks", "create"),
    validateBody(bulkCreateSchema),
    async (req: Request, res: Response) => {
      const body = req.body as z.infer<typeof bulkCreateSchema>;
      try {
        const tasks = await tasksRepo.bulkCreateEngineeringTasks(body, actorId(req));
        res.status(201).json({ tasks });
      } catch (err) {
        handleError("bulk-create", err);
      }
    },
  );

  app.patch(
    "/api/engineering/tasks/:id/status",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    validateBody(statusSchema),
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      const body = req.body as z.infer<typeof statusSchema>;
      try {
        const task = await tasksRepo.transitionEngineeringTaskStatus(parsedId.data, body.status, actorId(req), {
          reason: body.reason,
        });
        if (!task) throw notFound("Task");
        res.json({ task });
      } catch (err) {
        handleError("status", err);
      }
    },
  );

  app.get(
    "/api/engineering/tasks/:id/documents",
    requireAuth,
    requirePermission("eng_tasks", "view"),
    requireEngTaskOwnership,
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      try {
        res.json({ links: await tasksRepo.listTaskDocumentLinks(parsedId.data) });
      } catch (err) {
        handleError("list-documents", err);
      }
    },
  );

  app.get(
    "/api/engineering/tasks/:id/document-candidates",
    requireAuth,
    requirePermission("eng_tasks", "view"),
    requireEngTaskOwnership,
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      try {
        res.json({ candidates: await tasksRepo.getDocumentCandidatesForTask(parsedId.data) });
      } catch (err) {
        handleError("document-candidates", err);
      }
    },
  );

  app.post(
    "/api/engineering/tasks/:id/documents",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    validateBody(linkDocSchema),
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      const body = req.body as z.infer<typeof linkDocSchema>;
      try {
        const task = await tasksRepo.getEngineeringTask(parsedId.data);
        if (!task) throw notFound("Task");
        // Only allow linking a managed document that lives on the task's project.
        if (body.managedDocumentId != null) {
          const candidates = await tasksRepo.getDocumentCandidatesForTask(parsedId.data);
          if (!candidates.some((c) => c.id === body.managedDocumentId)) {
            throw badRequest("That document isn't available on this task's project.");
          }
        }
        const link = await tasksRepo.linkDocumentToTask(parsedId.data, body, actorId(req));
        if (!link) throw conflict("This document is already linked to the task.");
        res.status(201).json({ link });
      } catch (err) {
        handleError("link-document", err);
      }
    },
  );

  app.delete(
    "/api/engineering/tasks/:id/documents/:linkId",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      const parsedLinkId = idParam.safeParse(req.params.linkId);
      if (!parsedId.success || !parsedLinkId.success) throw badRequest("Invalid id");
      try {
        const removed = await tasksRepo.unlinkDocumentFromTask(parsedId.data, parsedLinkId.data, actorId(req));
        if (!removed) throw notFound("Document link");
        res.json({ ok: true });
      } catch (err) {
        handleError("unlink-document", err);
      }
    },
  );

  app.post(
    "/api/engineering/tasks/seam",
    requireAuth,
    requirePermission("eng_tasks", "create"),
    validateBody(seamSchema),
    async (req: Request, res: Response) => {
      const body = req.body as z.infer<typeof seamSchema>;
      try {
        const task = await tasksRepo.createSeamHandoff(body, actorId(req));
        res.status(201).json({ task });
      } catch (err) {
        handleError("seam", err);
      }
    },
  );
}
