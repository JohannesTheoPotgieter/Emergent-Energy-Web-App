/**
 * Standup sessions routes (UI/UX audit — standup "Save & Close" persistence).
 *
 * The live-facilitator summary screen used to discard the whole session on
 * close ("Save & Close" persisted nothing). These endpoints make the
 * facilitation summary durable.
 *
 * Endpoints:
 *   POST /api/standups/sessions        persist a completed standup summary
 *   GET  /api/standups/sessions        list recent persisted summaries
 *
 * Conventions: requireAuth + requireRole on every endpoint, Zod-validated
 * body, all DB access via the repository, ApiError for known failures (no
 * raw DB/stack leakage). Role list is derived from the canonical
 * COMPANY_ROLES — never hardcoded.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { validateBody } from "../middleware/validateBody";
import { ApiError, serverError } from "../lib/api-error";
import { getEffectiveUser } from "../auth-context";
import { COMPANY_ROLES } from "@shared/schema/users";
import {
  createStandupSession,
  listRecentStandupSessions,
} from "../repositories/standup-sessions-repository";

// Standup is facilitated by engineering / quality leadership and execs.
// Selected from the canonical role list rather than hardcoded literals.
const STANDUP_FACILITATOR_ROLE_NAMES = [
  "COO_ADMIN",
  "CEO_ADMIN",
  "ENGINEERING_MANAGER",
  "ENGINEER",
  "QUALITY_MANAGER",
] as const;

const STANDUP_FACILITATOR_ROLES = COMPANY_ROLES.filter((r) =>
  (STANDUP_FACILITATOR_ROLE_NAMES as readonly string[]).includes(r),
);

const taskMovementSchema = z.object({
  taskId: z.number().int(),
  taskTitle: z.string(),
  userId: z.number().int(),
  userName: z.string(),
  fromStatus: z.string(),
  toStatus: z.string(),
  holdReason: z.string().optional(),
});

const facilitatorNoteSchema = z.object({
  userId: z.number().int(),
  userName: z.string(),
  note: z.string(),
});

const createStandupSessionSchema = z.object({
  scheduleId: z.number().int().positive().nullable().optional(),
  sessionDate: z.string().min(1),
  totalSeconds: z.number().int().nonnegative(),
  participantCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  avgSecondsPerSpeaker: z.number().int().nonnegative(),
  blockerCount: z.number().int().nonnegative(),
  taskMovements: z.array(taskMovementSchema).max(1000),
  moodCounts: z.record(z.string(), z.number().int().nonnegative()),
  facilitatorNotes: z.array(facilitatorNoteSchema).max(500),
});

type CreateStandupSessionBody = z.infer<typeof createStandupSessionSchema>;

export function registerStandupSessionsRoutes(app: Express): void {
  app.post(
    "/api/standups/sessions",
    requireAuth,
    requireRole(STANDUP_FACILITATOR_ROLES as unknown as string[]),
    validateBody(createStandupSessionSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = req.body as CreateStandupSessionBody;
        const user = getEffectiveUser(req);
        const session = await createStandupSession({
          scheduleId: body.scheduleId ?? null,
          facilitatorUserId: user?.id ?? null,
          sessionDate: body.sessionDate,
          totalSeconds: body.totalSeconds,
          participantCount: body.participantCount,
          completedCount: body.completedCount,
          skippedCount: body.skippedCount,
          avgSecondsPerSpeaker: body.avgSecondsPerSpeaker,
          blockerCount: body.blockerCount,
          taskMovements: body.taskMovements,
          moodCounts: body.moodCounts,
          facilitatorNotes: body.facilitatorNotes,
        });
        res.status(201).json({ session });
      } catch (err) {
        if (err instanceof ApiError) return next(err);
        console.error("[standup-sessions] create failed:", err);
        return next(serverError("Could not save the standup summary."));
      }
    },
  );

  app.get(
    "/api/standups/sessions",
    requireAuth,
    requireRole(STANDUP_FACILITATOR_ROLES as unknown as string[]),
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const sessions = await listRecentStandupSessions();
        res.json({ sessions });
      } catch (err) {
        if (err instanceof ApiError) return next(err);
        console.error("[standup-sessions] list failed:", err);
        return next(serverError("Could not load standup history."));
      }
    },
  );
}
