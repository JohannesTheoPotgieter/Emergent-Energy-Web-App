/**
 * Project discipline-folder binding routes (browse-and-bind document setup).
 *
 * Replaces taxonomy-driven provisioning: per project, per discipline, the user
 * browses SharePoint (via the existing /api/documents browser) and binds an
 * existing folder. These endpoints persist that binding. Reads gate on
 * `documents:view`; binding/unbinding gate on `documents_provision` (COO/admin).
 * Bodies are Zod-validated; errors are ApiError only (no raw DB text — §5A).
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, getEffectiveUser } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { validateBody } from "../middleware/validateBody";
import { ApiError, badRequest, notFound, serverError, unauthorized, logApiError } from "../lib/api-error";
import { LIFECYCLE_DEPARTMENTS } from "@shared/schema";
import * as repo from "../repositories/project-discipline-folders-repository";
import { listBoundFolderDocuments } from "../services/discipline-folder-documents-service";

const projectIdParam = z.coerce.number().int().positive();
const disciplineSchema = z.enum(LIFECYCLE_DEPARTMENTS);

export const disciplineFolderBindSchema = z.object({
  discipline: disciplineSchema,
  driveId: z.string().min(1).max(512),
  itemId: z.string().min(1).max(512),
  sharepointPath: z.string().max(2048).nullish(),
  webUrl: z.string().max(2048).nullish(),
});

function actorId(req: Request): number {
  const user = getEffectiveUser(req);
  if (!user) throw unauthorized();
  return user.id;
}

function handleError(scope: string, err: unknown): never {
  if (err instanceof ApiError) throw err;
  logApiError(`project-discipline-folders:${scope}`, err);
  throw serverError("Project document-folder request failed. Please retry.");
}

export function registerProjectDisciplineFoldersRoutes(app: Express): void {
  // List the discipline folders bound for a project.
  app.get(
    "/api/projects/:projectId/discipline-folders",
    requireAuth,
    requirePermission("documents", "view"),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      if (!parsed.success) throw badRequest("Invalid project id");
      try {
        res.json({ folders: await repo.listDisciplineFoldersForProject(parsed.data) });
      } catch (err) {
        handleError("list", err);
      }
    },
  );

  // List the live contents of a project's bound discipline folder (read-only,
  // with tracked-document overlay).
  app.get(
    "/api/projects/:projectId/discipline-folders/:discipline/documents",
    requireAuth,
    requirePermission("documents", "view"),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      const disc = disciplineSchema.safeParse(req.params.discipline);
      if (!parsed.success) throw badRequest("Invalid project id");
      if (!disc.success) throw badRequest("Invalid discipline");
      try {
        res.json(await listBoundFolderDocuments(parsed.data, disc.data));
      } catch (err) {
        handleError("documents", err);
      }
    },
  );

  // Bind (or re-bind) a SharePoint folder to a discipline for a project.
  app.put(
    "/api/projects/:projectId/discipline-folders",
    requireAuth,
    requirePermission("documents_provision", "edit"),
    validateBody(disciplineFolderBindSchema),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      if (!parsed.success) throw badRequest("Invalid project id");
      const body = req.body as z.infer<typeof disciplineFolderBindSchema>;
      try {
        const folder = await repo.bindDisciplineFolder({
          projectId: parsed.data,
          discipline: body.discipline,
          driveId: body.driveId,
          itemId: body.itemId,
          sharepointPath: body.sharepointPath ?? null,
          webUrl: body.webUrl ?? null,
          boundByUserId: actorId(req),
        });
        res.json({ folder });
      } catch (err) {
        handleError("bind", err);
      }
    },
  );

  // Unbind a discipline's folder (soft delete).
  app.delete(
    "/api/projects/:projectId/discipline-folders/:discipline",
    requireAuth,
    requirePermission("documents_provision", "edit"),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      const disc = disciplineSchema.safeParse(req.params.discipline);
      if (!parsed.success) throw badRequest("Invalid project id");
      if (!disc.success) throw badRequest("Invalid discipline");
      try {
        const removed = await repo.unbindDisciplineFolder(parsed.data, disc.data, actorId(req));
        if (!removed) throw notFound("Discipline folder binding");
        res.json({ ok: true });
      } catch (err) {
        handleError("unbind", err);
      }
    },
  );
}
