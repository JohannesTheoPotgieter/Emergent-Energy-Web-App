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

const ownerSchema = z.object({
  ownerUserId: z.number().int().positive().nullable(),
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

const subtaskSchema = z.object({
  title: z.string().min(1).max(500),
});

const checklistSchema = z.object({
  title: z.string().min(1).max(500),
});

const checklistItemSchema = z.object({
  content: z.string().min(1).max(2000),
});

const checklistItemPatchSchema = z
  .object({
    isDone: z.boolean().optional(),
    content: z.string().min(1).max(2000).optional(),
  })
  .refine((d) => d.isDone !== undefined || d.content !== undefined, {
    message: "Provide isDone or content.",
  });

const commentSchema = z.object({
  body: z.string().min(1).max(5000),
  mentionedUserIds: z.array(z.number().int().positive()).max(50).optional(),
});

const assigneeSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(["ASSIGNEE", "REVIEWER", "VIEWER"]).optional(),
});

const dependencySchema = z.object({
  dependsOnTaskId: z.number().int().positive(),
});

const planLinkSchema = z
  .object({
    planItemId: z.number().int().positive().nullable(),
    relation: z.enum(["before", "after"]).optional(),
    leadDays: z.number().int().min(0).max(365).optional(),
  })
  .refine((d) => d.planItemId == null || d.relation != null, {
    message: "relation is required when linking a plan task.",
  });

const signOffSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  kind: z.enum(["qc", "operational"]),
  note: z.string().max(5000).optional(),
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
    requirePermission("eng_tasks", "edit"),
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
    requirePermission("eng_tasks", "edit"),
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

  app.patch(
    "/api/engineering/tasks/:id",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    validateBody(ownerSchema),
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      const body = req.body as z.infer<typeof ownerSchema>;
      try {
        const task = await tasksRepo.reassignEngineeringTaskOwner(parsedId.data, body.ownerUserId, actorId(req));
        if (!task) throw notFound("Task");
        res.json({ task });
      } catch (err) {
        handleError("reassign-owner", err);
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
        // The repository is the single chokepoint: it resolves the task, enforces
        // that the managed document / project-document link belongs to the task's
        // own project (coded DOCUMENT_PROJECT_MISMATCH), and dedupes on conflict.
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
    requirePermission("eng_tasks", "edit"),
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

  // ── Subtasks ───────────────────────────────────────────────────────────────

  app.get(
    "/api/engineering/tasks/:id/subtasks",
    requireAuth,
    requirePermission("eng_tasks", "view"),
    requireEngTaskOwnership,
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      try {
        res.json({ subtasks: await tasksRepo.listSubtasks(parsedId.data) });
      } catch (err) {
        handleError("list-subtasks", err);
      }
    },
  );

  app.post(
    "/api/engineering/tasks/:id/subtasks",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    validateBody(subtaskSchema),
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      const body = req.body as z.infer<typeof subtaskSchema>;
      try {
        res.status(201).json(await tasksRepo.createSubtask(parsedId.data, body.title, actorId(req)));
      } catch (err) {
        handleError("create-subtask", err);
      }
    },
  );

  // ── Checklists ───────────────────────────────────────────────────────────────

  app.get(
    "/api/engineering/tasks/:id/checklists",
    requireAuth,
    requirePermission("eng_tasks", "view"),
    requireEngTaskOwnership,
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      try {
        res.json({ checklists: await tasksRepo.listChecklists(parsedId.data) });
      } catch (err) {
        handleError("list-checklists", err);
      }
    },
  );

  app.post(
    "/api/engineering/tasks/:id/checklists",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    validateBody(checklistSchema),
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      const body = req.body as z.infer<typeof checklistSchema>;
      try {
        res.status(201).json(await tasksRepo.createChecklist(parsedId.data, body.title));
      } catch (err) {
        handleError("create-checklist", err);
      }
    },
  );

  app.delete(
    "/api/engineering/tasks/:id/checklists/:checklistId",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      const parsedChecklistId = idParam.safeParse(req.params.checklistId);
      if (!parsedId.success || !parsedChecklistId.success) throw badRequest("Invalid id");
      try {
        await tasksRepo.deleteChecklist(parsedId.data, parsedChecklistId.data);
        res.json({ ok: true });
      } catch (err) {
        handleError("delete-checklist", err);
      }
    },
  );

  app.post(
    "/api/engineering/tasks/:id/checklists/:checklistId/items",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    validateBody(checklistItemSchema),
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      const parsedChecklistId = idParam.safeParse(req.params.checklistId);
      if (!parsedId.success || !parsedChecklistId.success) throw badRequest("Invalid id");
      const body = req.body as z.infer<typeof checklistItemSchema>;
      try {
        res.status(201).json(await tasksRepo.addChecklistItem(parsedId.data, parsedChecklistId.data, body.content));
      } catch (err) {
        handleError("add-checklist-item", err);
      }
    },
  );

  app.patch(
    "/api/engineering/tasks/:id/checklist-items/:itemId",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    validateBody(checklistItemPatchSchema),
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      const parsedItemId = idParam.safeParse(req.params.itemId);
      if (!parsedId.success || !parsedItemId.success) throw badRequest("Invalid id");
      const body = req.body as z.infer<typeof checklistItemPatchSchema>;
      try {
        await tasksRepo.updateChecklistItem(parsedId.data, parsedItemId.data, body);
        res.json({ ok: true });
      } catch (err) {
        handleError("update-checklist-item", err);
      }
    },
  );

  app.delete(
    "/api/engineering/tasks/:id/checklist-items/:itemId",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      const parsedItemId = idParam.safeParse(req.params.itemId);
      if (!parsedId.success || !parsedItemId.success) throw badRequest("Invalid id");
      try {
        await tasksRepo.deleteChecklistItem(parsedId.data, parsedItemId.data);
        res.json({ ok: true });
      } catch (err) {
        handleError("delete-checklist-item", err);
      }
    },
  );

  // ── Comments + @mentions ──────────────────────────────────────────────────

  app.get(
    "/api/engineering/tasks/:id/comments",
    requireAuth,
    requirePermission("eng_tasks", "view"),
    requireEngTaskOwnership,
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      try {
        res.json({ comments: await tasksRepo.listComments(parsedId.data) });
      } catch (err) {
        handleError("list-comments", err);
      }
    },
  );

  app.post(
    "/api/engineering/tasks/:id/comments",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    validateBody(commentSchema),
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      const body = req.body as z.infer<typeof commentSchema>;
      try {
        res.status(201).json(
          await tasksRepo.createComment(parsedId.data, body.body, body.mentionedUserIds ?? [], actorId(req)),
        );
      } catch (err) {
        handleError("create-comment", err);
      }
    },
  );

  // ── Assignees ──────────────────────────────────────────────────────────────

  app.get(
    "/api/engineering/tasks/:id/assignees",
    requireAuth,
    requirePermission("eng_tasks", "view"),
    requireEngTaskOwnership,
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      try {
        res.json({ assignees: await tasksRepo.listAssignees(parsedId.data) });
      } catch (err) {
        handleError("list-assignees", err);
      }
    },
  );

  app.post(
    "/api/engineering/tasks/:id/assignees",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    validateBody(assigneeSchema),
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      const body = req.body as z.infer<typeof assigneeSchema>;
      try {
        await tasksRepo.addAssignee(parsedId.data, body.userId, body.role ?? "ASSIGNEE", actorId(req));
        res.status(201).json({ ok: true });
      } catch (err) {
        handleError("add-assignee", err);
      }
    },
  );

  app.delete(
    "/api/engineering/tasks/:id/assignees/:userId",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      const parsedUserId = idParam.safeParse(req.params.userId);
      if (!parsedId.success || !parsedUserId.success) throw badRequest("Invalid id");
      try {
        const removed = await tasksRepo.removeAssignee(parsedId.data, parsedUserId.data, actorId(req));
        if (!removed) throw notFound("Assignee");
        res.json({ ok: true });
      } catch (err) {
        handleError("remove-assignee", err);
      }
    },
  );

  // ── Dependencies ─────────────────────────────────────────────────────────────

  app.get(
    "/api/engineering/tasks/:id/dependencies",
    requireAuth,
    requirePermission("eng_tasks", "view"),
    requireEngTaskOwnership,
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      try {
        res.json(await tasksRepo.listDependencies(parsedId.data));
      } catch (err) {
        handleError("list-dependencies", err);
      }
    },
  );

  app.get(
    "/api/engineering/tasks/:id/dependency-candidates",
    requireAuth,
    requirePermission("eng_tasks", "view"),
    requireEngTaskOwnership,
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      try {
        res.json({ candidates: await tasksRepo.listDependencyCandidates(parsedId.data) });
      } catch (err) {
        handleError("dependency-candidates", err);
      }
    },
  );

  app.post(
    "/api/engineering/tasks/:id/dependencies",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    validateBody(dependencySchema),
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      const body = req.body as z.infer<typeof dependencySchema>;
      try {
        res.status(201).json(await tasksRepo.addDependency(parsedId.data, body.dependsOnTaskId, actorId(req)));
      } catch (err) {
        handleError("add-dependency", err);
      }
    },
  );

  app.delete(
    "/api/engineering/tasks/:id/dependencies/:depId",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      const parsedDepId = idParam.safeParse(req.params.depId);
      if (!parsedId.success || !parsedDepId.success) throw badRequest("Invalid id");
      try {
        const removed = await tasksRepo.removeDependency(parsedId.data, parsedDepId.data, actorId(req));
        if (!removed) throw notFound("Dependency");
        res.json({ ok: true });
      } catch (err) {
        handleError("remove-dependency", err);
      }
    },
  );

  // ── Plan link (derive due date from a project-plan task) ─────────────────────

  app.get(
    "/api/engineering/tasks/:id/plan-candidates",
    requireAuth,
    requirePermission("eng_tasks", "view"),
    requireEngTaskOwnership,
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      try {
        res.json({ candidates: await tasksRepo.listPlanCandidates(parsedId.data) });
      } catch (err) {
        handleError("plan-candidates", err);
      }
    },
  );

  app.patch(
    "/api/engineering/tasks/:id/plan-link",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    validateBody(planLinkSchema),
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      const body = req.body as z.infer<typeof planLinkSchema>;
      try {
        const task = await tasksRepo.setPlanLink(parsedId.data, body, actorId(req));
        if (!task) throw notFound("Task");
        res.json({ task });
      } catch (err) {
        handleError("plan-link", err);
      }
    },
  );

  // ── Delete task ──────────────────────────────────────────────────────────────

  app.delete(
    "/api/engineering/tasks/:id",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      try {
        const deleted = await tasksRepo.softDeleteEngineeringTask(parsedId.data, actorId(req));
        if (!deleted) throw notFound("Task");
        res.json({ ok: true });
      } catch (err) {
        handleError("delete-task", err);
      }
    },
  );

  // ── Sign-off ─────────────────────────────────────────────────────────────────

  app.get(
    "/api/engineering/tasks/:id/sign-offs",
    requireAuth,
    requirePermission("eng_tasks", "view"),
    requireEngTaskOwnership,
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      try {
        res.json({ signOffs: await tasksRepo.listSignOffs(parsedId.data) });
      } catch (err) {
        handleError("list-sign-offs", err);
      }
    },
  );

  app.post(
    "/api/engineering/tasks/:id/sign-off",
    requireAuth,
    requirePermission("eng_tasks", "edit"),
    requireEngTaskOwnership,
    validateBody(signOffSchema),
    async (req: Request, res: Response) => {
      const parsedId = idParam.safeParse(req.params.id);
      if (!parsedId.success) throw badRequest("Invalid task id");
      const body = req.body as z.infer<typeof signOffSchema>;
      try {
        res.status(201).json(
          await tasksRepo.recordSignOff(parsedId.data, body.decision, body.kind, body.note, actorId(req)),
        );
      } catch (err) {
        handleError("sign-off", err);
      }
    },
  );
}
