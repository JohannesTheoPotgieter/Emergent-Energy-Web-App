/**
 * Email / Teams project-link routes.
 *
 * Endpoints:
 *   GET    /api/projects/:projectId/emails
 *   GET    /api/projects/:projectId/teams-messages
 *   POST   /api/email-links         — create (auto or manual)
 *   POST   /api/teams-links         — create (auto or manual)
 *   DELETE /api/email-links/:id     — unlink (removes attribution)
 *   DELETE /api/teams-links/:id     — unlink
 *   GET    /api/email-domain-match?email=x@y.com — layered-signal test
 *
 * Auth: requireAuth for reads + manual links; super-users can unlink.
 * Real auto-linking driver (the Graph webhook consumer) calls
 * createEmailLink internally and doesn't go through HTTP.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, getEffectiveUser } from "../auth-context";
import { requireRole } from "../middleware/requireRole";
import {
  createEmailLink,
  createTeamsLink,
  listEmailLinksForProject,
  listTeamsLinksForProject,
  matchClientByDomain,
  removeEmailLink,
  removeTeamsLink,
} from "../repositories/email-links-repository";
import { ApiError, badRequest, notFound, serverError, unauthorized } from "../lib/api-error";

const projectIdParam = z.coerce.number().int().positive();
const idParam = z.coerce.number().int().positive();

const SUPER_ROLES = ["COO_ADMIN", "CEO_ADMIN"];

const emailSignalValues = ["client_domain", "client_contact", "subject_tag", "thread_inheritance", "pipedrive", "manual"] as const;
const teamsSignalValues = ["project_channel", "user_mention", "manual"] as const;

const createEmailLinkBodySchema = z.object({
  graphMessageId: z.string().min(1).max(512),
  graphConversationId: z.string().max(512).nullish(),
  projectId: z.number().int().positive().nullish(),
  clientId: z.number().int().positive().nullish(),
  signal: z.enum(emailSignalValues),
  senderEmail: z.string().email().max(320).nullish(),
  subjectSnapshot: z.string().max(1024).nullish(),
  phaseAtLinkTime: z.string().max(64).nullish(),
  linkNote: z.string().max(2000).nullish(),
  receivedAt: z.string().datetime().nullish().or(z.string().nullish()),
}).refine(
  (data) => data.projectId != null || data.clientId != null,
  { message: "projectId or clientId required" },
);

const createTeamsLinkBodySchema = z.object({
  graphMessageId: z.string().min(1).max(512),
  graphChannelId: z.string().max(512).nullish(),
  graphTeamId: z.string().max(512).nullish(),
  graphThreadId: z.string().max(512).nullish(),
  projectId: z.number().int().positive(),
  signal: z.enum(teamsSignalValues),
  senderEmail: z.string().email().max(320).nullish(),
  bodyPreview: z.string().max(2000).nullish(),
  phaseAtLinkTime: z.string().max(64).nullish(),
  linkNote: z.string().max(2000).nullish(),
  postedAt: z.string().datetime().nullish().or(z.string().nullish()),
});

const domainMatchQuerySchema = z.object({
  email: z.string().email().max(320),
});

export function registerEmailLinksRoutes(app: Express): void {
  // ---- Reads per project ---------------------------------------------
  app.get(
    "/api/projects/:projectId/emails",
    requireAuth,
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      if (!parsed.success) throw badRequest("Invalid projectId");
      try {
        const rows = await listEmailLinksForProject(parsed.data);
        res.json({ projectId: parsed.data, rows });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[email-links] list emails error:", err);
        throw serverError("Failed to load project emails");
      }
    },
  );

  app.get(
    "/api/projects/:projectId/teams-messages",
    requireAuth,
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.projectId);
      if (!parsed.success) throw badRequest("Invalid projectId");
      try {
        const rows = await listTeamsLinksForProject(parsed.data);
        res.json({ projectId: parsed.data, rows });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[email-links] list teams error:", err);
        throw serverError("Failed to load project Teams messages");
      }
    },
  );

  // ---- Layered-signal test endpoint ----------------------------------
  // Lets the UI (and tests) verify the domain-match logic without
  // creating an actual link. Useful for showing "would auto-link to X"
  // in a compose-email flow.
  app.get(
    "/api/email-domain-match",
    requireAuth,
    async (req: Request, res: Response) => {
      const parsed = domainMatchQuerySchema.safeParse(req.query);
      if (!parsed.success) throw badRequest("Provide ?email=user@domain.com");
      try {
        const match = await matchClientByDomain(parsed.data.email);
        res.json({ email: parsed.data.email, match });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[email-links] domain-match error:", err);
        throw serverError("Failed to run domain match");
      }
    },
  );

  // ---- Manual link creation ------------------------------------------
  app.post(
    "/api/email-links",
    requireAuth,
    async (req: Request, res: Response) => {
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      const parsed = createEmailLinkBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw badRequest("Invalid email-link payload", {
          issues: parsed.error.issues.map((i) => i.message).join("; "),
        });
      }
      try {
        const row = await createEmailLink({
          ...parsed.data,
          linkedByUserId: user.id,
        });
        res.status(201).json({ link: row });
      } catch (err) {
        console.error("[email-links] create error:", err);
        throw badRequest(err instanceof Error ? err.message : "Create failed");
      }
    },
  );

  app.post(
    "/api/teams-links",
    requireAuth,
    async (req: Request, res: Response) => {
      const user = getEffectiveUser(req);
      if (!user) throw unauthorized();
      const parsed = createTeamsLinkBodySchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("Invalid teams-link payload");
      try {
        const row = await createTeamsLink({
          ...parsed.data,
          linkedByUserId: user.id,
        });
        res.status(201).json({ link: row });
      } catch (err) {
        console.error("[email-links] teams create error:", err);
        throw badRequest(err instanceof Error ? err.message : "Create failed");
      }
    },
  );

  // ---- Unlink --------------------------------------------------------
  app.delete(
    "/api/email-links/:id",
    requireAuth,
    requireRole(SUPER_ROLES),
    async (req: Request, res: Response) => {
      const parsed = idParam.safeParse(req.params.id);
      if (!parsed.success) throw badRequest("Invalid id");
      try {
        await removeEmailLink(parsed.data);
        res.json({ ok: true });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[email-links] remove error:", err);
        throw serverError("Failed to remove email link");
      }
    },
  );

  app.delete(
    "/api/teams-links/:id",
    requireAuth,
    requireRole(SUPER_ROLES),
    async (req: Request, res: Response) => {
      const parsed = idParam.safeParse(req.params.id);
      if (!parsed.success) throw badRequest("Invalid id");
      try {
        await removeTeamsLink(parsed.data);
        res.json({ ok: true });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[email-links] teams remove error:", err);
        throw serverError("Failed to remove teams link");
      }
    },
  );
}
