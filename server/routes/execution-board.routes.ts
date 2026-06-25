// ============================================================
// Execution control-tower routes (additive, new-style).
//
// Program-wide board + per-site detail + program lists, plus CRUD for the
// flagged-item augmentation layer. All reads compose canonical surfaces via
// execution-board-service; the only writes are execution_review_items.
//
// RBAC: view = execution_review:view; flag create/edit/delete =
// execution_review:{create,edit,delete}. The per-domain summary endpoints
// gate on their own domain (engineering:view / quality:view).
// ============================================================

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { jwtAuth, requireAuth, getEffectiveUser } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { validateBody } from "../middleware/validateBody";
import { parseIntParam } from "../lib/req-params";
import { notFound } from "../lib/api-error";
import { executionReviewRepository } from "../repositories/execution-review-repository";
import { executionBoardRepository } from "../repositories/execution-board-repository";
import {
  getBoard,
  getProjectDetail,
  getUpcomingProgram,
  getDeliveriesProgram,
  getAllocationsProgram,
  getEngineeringSummary,
  getQualitySummary,
} from "../services/execution-board-service";

const statusEnum = z.enum(["open", "flagged", "actioned", "closed"]);
const severityEnum = z.enum(["low", "medium", "high", "critical"]);

const createItemSchema = z.object({
  projectId: z.number().int().positive(),
  category: z.string().min(1).max(64),
  title: z.string().min(1).max(300),
  detail: z.string().max(5000).nullable().optional(),
  status: statusEnum.optional(),
  severity: severityEnum.optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
  ownerUserId: z.number().int().positive().nullable().optional(),
  dueDate: z.string().max(32).nullable().optional(),
  meetingDate: z.string().max(32).nullable().optional(),
  planTaskNo: z.string().max(64).nullable().optional(),
  planWorkItemId: z.number().int().positive().nullable().optional(),
});

const updateItemSchema = z.object({
  category: z.string().min(1).max(64).optional(),
  title: z.string().min(1).max(300).optional(),
  detail: z.string().max(5000).nullable().optional(),
  status: statusEnum.optional(),
  severity: severityEnum.optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
  ownerUserId: z.number().int().positive().nullable().optional(),
  dueDate: z.string().max(32).nullable().optional(),
  meetingDate: z.string().max(32).nullable().optional(),
  planTaskNo: z.string().max(64).nullable().optional(),
  planWorkItemId: z.number().int().positive().nullable().optional(),
});

export function registerExecutionBoardRoutes(app: Express) {
  // ── Board + detail + program lists (read) ──────────────────────────────
  app.get(
    "/api/execution-review/board",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "view"),
    async (_req: Request, res: Response) => {
      res.json(await getBoard());
    },
  );

  app.get(
    "/api/execution-review/projects/:projectId/detail",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "view"),
    async (req: Request, res: Response) => {
      const projectId = parseIntParam(req.params.projectId);
      const detail = await getProjectDetail(projectId);
      if (!detail) throw notFound("Project");
      res.json(detail);
    },
  );

  app.get(
    "/api/execution-review/program/upcoming",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "view"),
    async (req: Request, res: Response) => {
      const raw = Number(req.query.daysOut);
      const daysOut = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 90) : 14;
      res.json(await getUpcomingProgram(daysOut));
    },
  );

  app.get(
    "/api/execution-review/program/deliveries",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "view"),
    async (_req: Request, res: Response) => {
      res.json(await getDeliveriesProgram());
    },
  );

  app.get(
    "/api/execution-review/program/allocations",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "view"),
    async (_req: Request, res: Response) => {
      res.json(await getAllocationsProgram());
    },
  );

  // Work items for a project — the Deliveries task picker (link an order to the
  // execution task that defines when it's needed on site).
  app.get(
    "/api/execution-review/projects/:projectId/work-items",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "view"),
    async (req: Request, res: Response) => {
      const projectId = parseIntParam(req.params.projectId);
      if (!projectId || Number.isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });
      res.json(await executionBoardRepository.getWorkItemsForProject(projectId));
    },
  );

  // ── Per-domain summaries (gated on their own domain) ───────────────────
  app.get(
    "/api/engineering/project/:projectId/summary",
    jwtAuth,
    requireAuth,
    requirePermission("engineering", "view"),
    async (req: Request, res: Response) => {
      res.json(await getEngineeringSummary(parseIntParam(req.params.projectId)));
    },
  );

  app.get(
    "/api/quality/project/:projectId/summary",
    jwtAuth,
    requireAuth,
    requirePermission("quality", "view"),
    async (req: Request, res: Response) => {
      res.json(await getQualitySummary(parseIntParam(req.params.projectId)));
    },
  );

  // ── Flagged-item CRUD (the only writes this feature performs) ───────────
  app.get(
    "/api/execution-review/projects/:projectId/items",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "view"),
    async (req: Request, res: Response) => {
      const projectId = parseIntParam(req.params.projectId);
      res.json(await executionReviewRepository.listByProject(projectId));
    },
  );

  app.post(
    "/api/execution-review/items",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "edit"),
    validateBody(createItemSchema),
    async (req: Request, res: Response) => {
      const body = createItemSchema.parse(req.body);
      const created = await executionReviewRepository.create({
        projectId: body.projectId,
        category: body.category,
        title: body.title,
        detail: body.detail ?? null,
        status: body.status ?? "open",
        severity: body.severity ?? "medium",
        tags: body.tags ?? [],
        ownerUserId: body.ownerUserId ?? null,
        dueDate: body.dueDate ?? null,
        meetingDate: body.meetingDate ?? null,
        planTaskNo: body.planTaskNo ?? null,
        planWorkItemId: body.planWorkItemId ?? null,
        createdBy: getEffectiveUser(req)?.id ?? null,
      });
      res.status(201).json(created);
    },
  );

  app.patch(
    "/api/execution-review/items/:id",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "edit"),
    validateBody(updateItemSchema),
    async (req: Request, res: Response) => {
      const id = parseIntParam(req.params.id);
      const body = updateItemSchema.parse(req.body);
      const updated = await executionReviewRepository.update(id, body);
      if (!updated) throw notFound("Execution review item");
      res.json(updated);
    },
  );

  app.delete(
    "/api/execution-review/items/:id",
    jwtAuth,
    requireAuth,
    requirePermission("execution_review", "edit"),
    async (req: Request, res: Response) => {
      const id = parseIntParam(req.params.id);
      const deleted = await executionReviewRepository.softDelete(id);
      if (!deleted) throw notFound("Execution review item");
      res.json({ ok: true, id });
    },
  );
}
