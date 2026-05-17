/**
 * Standup sessions repository.
 *
 * Persists a completed live-facilitator standup summary (the "Save & Close"
 * action). Facilitation metadata only — no message bodies / attachments.
 *
 * All DB access for standup sessions goes through this module; route handlers
 * never touch `db` directly.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  standupSessions,
  type StandupSession,
} from "@shared/schema/collaboration";

export interface CreateStandupSessionInput {
  scheduleId: number | null;
  facilitatorUserId: number | null;
  sessionDate: string;
  totalSeconds: number;
  participantCount: number;
  completedCount: number;
  skippedCount: number;
  avgSecondsPerSpeaker: number;
  blockerCount: number;
  taskMovements: unknown;
  moodCounts: unknown;
  facilitatorNotes: unknown;
}

function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /42P01|does not exist|no such table/i.test(msg);
}

export async function createStandupSession(
  input: CreateStandupSessionInput,
): Promise<StandupSession> {
  const [row] = await db
    .insert(standupSessions)
    .values({
      scheduleId: input.scheduleId,
      facilitatorUserId: input.facilitatorUserId,
      sessionDate: input.sessionDate,
      totalSeconds: input.totalSeconds,
      participantCount: input.participantCount,
      completedCount: input.completedCount,
      skippedCount: input.skippedCount,
      avgSecondsPerSpeaker: input.avgSecondsPerSpeaker,
      blockerCount: input.blockerCount,
      taskMovements: input.taskMovements as never,
      moodCounts: input.moodCounts as never,
      facilitatorNotes: input.facilitatorNotes as never,
    })
    .returning();
  return row;
}

export async function listRecentStandupSessions(
  limit = 20,
): Promise<StandupSession[]> {
  try {
    return await db
      .select()
      .from(standupSessions)
      .orderBy(desc(standupSessions.createdAt))
      .limit(limit);
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

export async function getStandupSessionById(
  id: number,
): Promise<StandupSession | null> {
  const [row] = await db
    .select()
    .from(standupSessions)
    .where(eq(standupSessions.id, id))
    .limit(1);
  return row ?? null;
}
