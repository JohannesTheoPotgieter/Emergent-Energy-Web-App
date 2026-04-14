import { Express, Request, Response } from "express";
import { db, getDbMode } from "./db";
import { eq, and, desc, asc, sql, inArray, isNull, count } from "drizzle-orm";
import {
  standupSchedules, standupParticipants, standupEntries,
  users, projectInfo, workItems, workItemStatusHistory, notifications, workItemAssignments,
  priorityProjects, mytoolCompanyPriorities,
  type InsertStandupSchedule, type InsertStandupEntry, type InsertStandupParticipant,
} from "@shared/schema";
import { getEffectiveUser, requireAuth } from "./auth-context";
import { requirePermission } from "./permission-middleware";
import { blockInProduction } from "./middleware/production-safety";

type AppUser = { id: number; email: string; name: string; role: string };

function getUser(req: Request): AppUser {
  return getEffectiveUser(req) as AppUser;
}

/** Check if today is a standup day for a given schedule (uses UTC to avoid DST issues) */
function isStandupDay(anchorDate: string, cadenceDays: number, checkDate: string): boolean {
  const anchor = new Date(`${anchorDate}T00:00:00Z`);
  const check = new Date(`${checkDate}T00:00:00Z`);
  const diffMs = check.getTime() - anchor.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays % cadenceDays === 0;
}

/** Get today as YYYY-MM-DD */
function today(): string {
  return new Date().toISOString().split("T")[0];
}

/** Notify other participants when someone submits a standup or flags a blocker */
async function notifyStandupParticipants(
  scheduleId: number,
  submitter: AppUser,
  entry: { blockers: string | null; mood: string | null },
  scheduleName: string,
) {
  try {
    const participants = await db
      .select({ userId: standupParticipants.userId })
      .from(standupParticipants)
      .where(eq(standupParticipants.scheduleId, scheduleId));

    const hasBlocker = entry.blockers && entry.blockers.trim().length > 0;
    const isBlocked = entry.mood === "blocked" || entry.mood === "struggling";

    // Only notify on blockers/struggling — regular submissions are too noisy
    if (!hasBlocker && !isBlocked) return;

    const title = hasBlocker
      ? `Blocker flagged by ${submitter.name}`
      : `${submitter.name} is ${entry.mood}`;
    const body = hasBlocker
      ? `${submitter.name} flagged a blocker in "${scheduleName}": ${entry.blockers!.slice(0, 200)}`
      : `${submitter.name} reported feeling ${entry.mood} in "${scheduleName}"`;

    const notificationRows = participants
      .filter((p: any) => p.userId !== submitter.id)
      .map((p: any) => ({
        recipientUserId: p.userId,
        eventType: hasBlocker ? "standup.blocker" : "standup.mood_alert",
        title,
        body,
      }));

    if (notificationRows.length > 0) {
      await db.insert(notifications).values(notificationRows);
    }
  } catch (err) {
    console.error("[Standup] Failed to send notifications:", err);
  }
}

async function ensureStandupV2Table() {
  const isPostgres = getDbMode() === "postgres";
  const idCol = isPostgres ? "id SERIAL PRIMARY KEY" : "id INTEGER PRIMARY KEY AUTOINCREMENT";
  const tsDefault = isPostgres ? "DEFAULT NOW()" : "DEFAULT CURRENT_TIMESTAMP";
  await db.execute(sql`CREATE TABLE IF NOT EXISTS standup_entries_v2 (${sql.raw(idCol)}, user_id INTEGER NOT NULL, date TEXT NOT NULL, yesterday TEXT, today TEXT, blockers TEXT, project_id INTEGER, team_id INTEGER, created_at TIMESTAMP NOT NULL ${sql.raw(tsDefault)})`);
}

/** Ensure deleted_at/deleted_by columns exist on standup_schedules (mirrors migration 20260372) */
async function ensureStandupScheduleColumns() {
  try {
    if (getDbMode() === "postgres") {
      await db.execute(sql`ALTER TABLE standup_schedules ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
      await db.execute(sql`ALTER TABLE standup_schedules ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id)`);
    } else {
      // SQLite: check pragma then add if missing
      const cols: any[] = await db.all(sql`PRAGMA table_info(standup_schedules)`);
      const colNames = cols.map((c: any) => c.name);
      if (!colNames.includes("deleted_at")) {
        await db.run(sql`ALTER TABLE standup_schedules ADD COLUMN deleted_at TIMESTAMP`);
      }
      if (!colNames.includes("deleted_by")) {
        await db.run(sql`ALTER TABLE standup_schedules ADD COLUMN deleted_by INTEGER`);
      }
    }
  } catch (err) {
    console.error("[Standup] Failed to ensure standup_schedules columns:", err);
  }
}

export function registerStandupRoutes(app: Express) {
  // Auto-repair schema on startup so queries referencing deleted_at don't crash
  ensureStandupScheduleColumns().catch(err =>
    console.error("[Standup] Column repair failed:", err),
  );

  // ── Schedules ──────────────────────────────────────────────────────────────

  /** List all standup schedules the current user participates in */
  app.get("/api/standups/schedules", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const participantRows = await db
        .select({ scheduleId: standupParticipants.scheduleId })
        .from(standupParticipants)
        .where(eq(standupParticipants.userId, user.id));

      const scheduleIds = participantRows.map((r: any) => r.scheduleId);

      let schedules;
      if (scheduleIds.length > 0) {
        const isActiveVal = getDbMode() === "sqlite" ? 1 : true;
        schedules = await db
          .select()
          .from(standupSchedules)
          .where(and(
            inArray(standupSchedules.id, scheduleIds),
            eq(standupSchedules.isActive, isActiveVal as any),
            isNull(standupSchedules.deletedAt)
          ))
          .orderBy(desc(standupSchedules.createdAt));
      } else {
        schedules = [];
      }

      res.json(schedules);
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  /** List all standup schedules (admin view) */
  app.get("/api/standups/schedules/all", requireAuth, async (_req: Request, res: Response) => {
    try {
      const schedules = await db
        .select()
        .from(standupSchedules)
        .orderBy(desc(standupSchedules.createdAt));
      res.json(schedules);
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  /** Create a standup schedule */
  app.post("/api/standups/schedules", requireAuth, requirePermission("standups", "create"), async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const { name, teamLabel, projectId, cadence, cadenceDays, anchorDate, deadlineTime, deadlineTimezone } = req.body;

      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Schedule name is required" });
      }

      const [schedule] = await db.insert(standupSchedules).values({
        name,
        teamLabel: teamLabel || null,
        projectId: projectId || null,
        cadence: cadence || "EVERY_2_DAYS",
        cadenceDays: cadenceDays || 2,
        anchorDate: anchorDate || today(),
        deadlineTime: deadlineTime || "10:00",
        deadlineTimezone: deadlineTimezone || "Africa/Johannesburg",
        createdBy: user.id,
      }).returning();

      // Auto-add creator as participant
      await db.insert(standupParticipants).values({
        scheduleId: schedule.id,
        userId: user.id,
        isRequired: true,
      });

      res.status(201).json(schedule);
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  /** Update a standup schedule */
  app.patch("/api/standups/schedules/:id", requireAuth, requirePermission("standups", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const updates: Partial<InsertStandupSchedule> = {};
      const allowed = ["name", "teamLabel", "projectId", "cadence", "cadenceDays", "anchorDate", "deadlineTime", "deadlineTimezone", "isActive"] as const;
      for (const key of allowed) {
        if (req.body[key] !== undefined) (updates as any)[key] = req.body[key];
      }
      (updates as any).updatedAt = new Date();

      const [updated] = await db
        .update(standupSchedules)
        .set(updates)
        .where(eq(standupSchedules.id, id))
        .returning();

      res.json(updated);
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  /** Delete a standup schedule */
  app.delete("/api/standups/schedules/:id", requireAuth, requirePermission("standups", "delete"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      await db.update(standupSchedules).set({ deletedAt: new Date(), deletedBy: req.user?.id }).where(eq(standupSchedules.id, id)).returning();
      res.json({ success: true });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  // ── Participants ───────────────────────────────────────────────────────────

  /** List participants for a schedule */
  app.get("/api/standups/schedules/:id/participants", requireAuth, async (req: Request, res: Response) => {
    try {
      const scheduleId = parseInt(req.params.id as string);
      const participants = await db
        .select({
          id: standupParticipants.id,
          scheduleId: standupParticipants.scheduleId,
          userId: standupParticipants.userId,
          isRequired: standupParticipants.isRequired,
          addedAt: standupParticipants.addedAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(standupParticipants)
        .leftJoin(users, eq(standupParticipants.userId, users.id))
        .where(eq(standupParticipants.scheduleId, scheduleId))
        .orderBy(asc(users.name));

      res.json(participants);
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  /** Add participant to schedule */
  app.post("/api/standups/schedules/:id/participants", requireAuth, requirePermission("standups", "edit"), async (req: Request, res: Response) => {
    try {
      const scheduleId = parseInt(req.params.id as string);
      const { userId, isRequired } = req.body;

      const [participant] = await db.insert(standupParticipants).values({
        scheduleId,
        userId,
        isRequired: isRequired !== false,
      }).returning();

      res.status(201).json(participant);
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  /** Remove participant from schedule */
  app.delete("/api/standups/schedules/:scheduleId/participants/:userId", requireAuth, requirePermission("standups", "edit"), async (req: Request, res: Response) => {
    try {
      const scheduleId = parseInt(req.params.scheduleId as string);
      const userId = parseInt(req.params.userId as string);

      await db.delete(standupParticipants).where(
        and(
          eq(standupParticipants.scheduleId, scheduleId),
          eq(standupParticipants.userId, userId)
        )
      );

      res.json({ success: true });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  // ── Entries ────────────────────────────────────────────────────────────────

  /** Get today's standup info (which schedules need a submission) */
  app.get("/api/standups/today", requireAuth, async (req: Request, res: Response) => {
    try {
      if (req.query.team_id) {
        const date = new Date().toISOString().slice(0, 10);
        const teamId = Number(req.query.team_id);
        await ensureStandupV2Table();
        const rows = await db.execute(sql`
          SELECT e.*, u.name as user_name, u.email as user_email
          FROM standup_entries_v2 e
          LEFT JOIN users u ON u.id = e.user_id
          WHERE e.date = ${date} AND (${teamId} IS NULL OR e.team_id = ${teamId})
          ORDER BY e.created_at ASC
        `);
        return res.json({ date, items: rows.rows || [] });
      }

      const user = getUser(req);
      const todayStr = today();

      // Find all active schedules user participates in
      const mySchedules = await db
        .select({
          schedule: standupSchedules,
          isRequired: standupParticipants.isRequired,
        })
        .from(standupParticipants)
        .innerJoin(standupSchedules, eq(standupParticipants.scheduleId, standupSchedules.id))
        .where(and(
          eq(standupParticipants.userId, user.id),
          eq(standupSchedules.isActive, (getDbMode() === "sqlite" ? 1 : true) as any)
        ));

      // Check which have a standup today and if user already submitted
      const todayStandups = [];
      for (const { schedule, isRequired } of mySchedules) {
        if (isStandupDay(schedule.anchorDate, schedule.cadenceDays, todayStr)) {
          const existing = await db
            .select()
            .from(standupEntries)
            .where(and(
              eq(standupEntries.scheduleId, schedule.id),
              eq(standupEntries.userId, user.id),
              eq(standupEntries.standupDate, todayStr)
            ))
            .limit(1);

          todayStandups.push({
            schedule,
            isRequired,
            hasSubmitted: existing.length > 0,
            entry: existing[0] || null,
          });
        }
      }

      res.json(todayStandups);
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  /** Submit a standup entry */
  app.post("/api/standups/entries", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const { scheduleId, standupDate, whatIDid, whatImDoing, blockers, mood } = req.body;

      if (!scheduleId || typeof scheduleId !== "number") {
        return res.status(400).json({ error: "scheduleId is required and must be a number" });
      }

      const dateStr = standupDate || today();

      // Check if already submitted for this schedule+date
      const existing = await db
        .select()
        .from(standupEntries)
        .where(and(
          eq(standupEntries.scheduleId, scheduleId),
          eq(standupEntries.userId, user.id),
          eq(standupEntries.standupDate, dateStr)
        ))
        .limit(1);

      if (existing.length > 0) {
        // Update existing entry
        const [updated] = await db
          .update(standupEntries)
          .set({
            whatIDid, whatImDoing, blockers,
            mood: mood || null,
            updatedAt: new Date(),
          })
          .where(eq(standupEntries.id, existing[0].id))
          .returning();
        return res.json(updated);
      }

      // Check if late (timezone-aware using schedule's deadlineTimezone)
      const schedule = await db
        .select()
        .from(standupSchedules)
        .where(eq(standupSchedules.id, scheduleId))
        .limit(1);

      let isLate = false;
      if (schedule.length > 0 && schedule[0].deadlineTime) {
        const tz = schedule[0].deadlineTimezone || "Africa/Johannesburg";
        const nowInTz = new Date().toLocaleString("en-US", { timeZone: tz });
        const nowLocal = new Date(nowInTz);
        const [h, m] = schedule[0].deadlineTime.split(":").map(Number);
        const deadline = new Date(nowLocal);
        deadline.setHours(h, m, 0, 0);
        isLate = nowLocal > deadline;
      }

      const [entry] = await db.insert(standupEntries).values({
        scheduleId,
        userId: user.id,
        standupDate: dateStr,
        whatIDid,
        whatImDoing,
        blockers,
        mood: mood || null,
        isLate,
      }).returning();

      // Notify other participants about this submission (async, non-blocking)
      notifyStandupParticipants(scheduleId, user, entry, schedule[0]?.name || "Standup").catch(() => {});

      res.status(201).json(entry);
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  /** Update a standup entry */
  app.patch("/api/standups/entries/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const { whatIDid, whatImDoing, blockers, mood } = req.body;

      const [updated] = await db
        .update(standupEntries)
        .set({
          whatIDid, whatImDoing, blockers,
          mood: mood || null,
          updatedAt: new Date(),
        })
        .where(eq(standupEntries.id, id))
        .returning();

      res.json(updated);
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  /** List entries for a schedule on a specific date */
  app.get("/api/standups/entries/:scheduleId", requireAuth, async (req: Request, res: Response) => {
    try {
      const scheduleId = parseInt(req.params.scheduleId as string);
      const date = (req.query.date as string) || today();

      const entries = await db
        .select({
          id: standupEntries.id,
          scheduleId: standupEntries.scheduleId,
          userId: standupEntries.userId,
          standupDate: standupEntries.standupDate,
          whatIDid: standupEntries.whatIDid,
          whatImDoing: standupEntries.whatImDoing,
          blockers: standupEntries.blockers,
          mood: standupEntries.mood,
          isLate: standupEntries.isLate,
          submittedAt: standupEntries.submittedAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(standupEntries)
        .leftJoin(users, eq(standupEntries.userId, users.id))
        .where(and(
          eq(standupEntries.scheduleId, scheduleId),
          eq(standupEntries.standupDate, date)
        ))
        .orderBy(asc(standupEntries.submittedAt));

      res.json(entries);
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  /** Standup history for a schedule (with pagination and search) */
  app.get("/api/standups/entries/:scheduleId/history", requireAuth, async (req: Request, res: Response) => {
    try {
      const scheduleId = parseInt(req.params.scheduleId as string);
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;
      const search = req.query.search as string;

      const conditions = [eq(standupEntries.scheduleId, scheduleId)];
      if (search) {
        const pattern = `%${search}%`;
        conditions.push(sql`(
          ${standupEntries.whatIDid} ILIKE ${pattern} OR
          ${standupEntries.whatImDoing} ILIKE ${pattern} OR
          ${standupEntries.blockers} ILIKE ${pattern}
        )`);
      }

      const entries = await db
        .select({
          id: standupEntries.id,
          userId: standupEntries.userId,
          standupDate: standupEntries.standupDate,
          whatIDid: standupEntries.whatIDid,
          whatImDoing: standupEntries.whatImDoing,
          blockers: standupEntries.blockers,
          mood: standupEntries.mood,
          isLate: standupEntries.isLate,
          submittedAt: standupEntries.submittedAt,
          userName: users.name,
        })
        .from(standupEntries)
        .leftJoin(users, eq(standupEntries.userId, users.id))
        .where(and(...conditions))
        .orderBy(desc(standupEntries.standupDate), asc(standupEntries.submittedAt))
        .limit(limit)
        .offset(offset);

      // Group by date
      const grouped: Record<string, typeof entries> = {};
      for (const entry of entries) {
        const date = entry.standupDate;
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(entry);
      }

      // Get total count for pagination
      const totalConditions = [eq(standupEntries.scheduleId, scheduleId)];
      if (search) {
        const searchPattern = `%${search}%`;
        totalConditions.push(sql`(
          ${standupEntries.whatIDid} ILIKE ${searchPattern} OR
          ${standupEntries.whatImDoing} ILIKE ${searchPattern} OR
          ${standupEntries.blockers} ILIKE ${searchPattern}
        )`);
      }
      const [totalCountResult] = await db
        .select({ count: count() })
        .from(standupEntries)
        .where(and(...totalConditions));

      const totalCount = Number(totalCountResult.count);

      res.json({ entries: grouped, total: totalCount, limit, offset, hasMore: offset + limit < totalCount });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  /** Standup analytics for a schedule */
  app.get("/api/standups/analytics/:scheduleId", requireAuth, async (req: Request, res: Response) => {
    try {
      const scheduleId = parseInt(req.params.scheduleId as string);

      // Total entries
      const [totalResult] = await db
        .select({ count: count() })
        .from(standupEntries)
        .where(eq(standupEntries.scheduleId, scheduleId));

      // Late entries
      const [lateResult] = await db
        .select({ count: count() })
        .from(standupEntries)
        .where(and(
          eq(standupEntries.scheduleId, scheduleId),
          eq(standupEntries.isLate, true)
        ));

      // Entries with blockers
      const blockerEntries = await db
        .select({
          standupDate: standupEntries.standupDate,
          blockers: standupEntries.blockers,
          userName: users.name,
        })
        .from(standupEntries)
        .leftJoin(users, eq(standupEntries.userId, users.id))
        .where(and(
          eq(standupEntries.scheduleId, scheduleId),
          sql`${standupEntries.blockers} IS NOT NULL AND ${standupEntries.blockers} != ''`
        ))
        .orderBy(desc(standupEntries.standupDate))
        .limit(20);

      // Mood distribution
      const moodDist = await db
        .select({
          mood: standupEntries.mood,
          count: count(),
        })
        .from(standupEntries)
        .where(and(
          eq(standupEntries.scheduleId, scheduleId),
          sql`${standupEntries.mood} IS NOT NULL`
        ))
        .groupBy(standupEntries.mood);

      // Participants count
      const [participantsResult] = await db
        .select({ count: count() })
        .from(standupParticipants)
        .where(eq(standupParticipants.scheduleId, scheduleId));

      // Count unique standup dates to compute average per-standup participation
      const [dateCountResult] = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${standupEntries.standupDate})` })
        .from(standupEntries)
        .where(eq(standupEntries.scheduleId, scheduleId));

      const uniqueDates = Number(dateCountResult.count) || 0;
      const avgParticipation = (uniqueDates > 0 && participantsResult.count > 0)
        ? Math.round(((totalResult.count / uniqueDates) / participantsResult.count) * 100)
        : 0;

      res.json({
        totalEntries: totalResult.count,
        lateEntries: lateResult.count,
        totalParticipants: participantsResult.count,
        recentBlockers: blockerEntries,
        moodDistribution: moodDist,
        participationRate: avgParticipation,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  /** Standup trends over time (for time-series charts) */
  app.get("/api/standups/analytics/:scheduleId/trends", requireAuth, async (req: Request, res: Response) => {
    try {
      const scheduleId = parseInt(req.params.scheduleId as string);
      const days = parseInt(req.query.days as string) || 30;

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffStr = cutoffDate.toISOString().split("T")[0];

      // Participation per standup date
      const participationTrend = await db
        .select({
          standupDate: standupEntries.standupDate,
          submissions: count(),
        })
        .from(standupEntries)
        .where(and(
          eq(standupEntries.scheduleId, scheduleId),
          sql`${standupEntries.standupDate} >= ${cutoffStr}`
        ))
        .groupBy(standupEntries.standupDate)
        .orderBy(asc(standupEntries.standupDate));

      // Mood trend per standup date
      const moodTrend = await db
        .select({
          standupDate: standupEntries.standupDate,
          mood: standupEntries.mood,
          count: count(),
        })
        .from(standupEntries)
        .where(and(
          eq(standupEntries.scheduleId, scheduleId),
          sql`${standupEntries.standupDate} >= ${cutoffStr}`,
          sql`${standupEntries.mood} IS NOT NULL`
        ))
        .groupBy(standupEntries.standupDate, standupEntries.mood)
        .orderBy(asc(standupEntries.standupDate));

      // Blocker count per standup date
      const blockerTrend = await db
        .select({
          standupDate: standupEntries.standupDate,
          blockerCount: count(),
        })
        .from(standupEntries)
        .where(and(
          eq(standupEntries.scheduleId, scheduleId),
          sql`${standupEntries.standupDate} >= ${cutoffStr}`,
          sql`${standupEntries.blockers} IS NOT NULL AND ${standupEntries.blockers} != ''`
        ))
        .groupBy(standupEntries.standupDate)
        .orderBy(asc(standupEntries.standupDate));

      // Total participant count for rate calculation
      const [participantsResult] = await db
        .select({ count: count() })
        .from(standupParticipants)
        .where(eq(standupParticipants.scheduleId, scheduleId));

      const totalParticipants = Number(participantsResult.count) || 1;

      // Build unified date series
      const dateSet = new Set<string>();
      participationTrend.forEach((r: any) => dateSet.add(r.standupDate));
      const dates = Array.from(dateSet).sort();

      const participationMap = new Map(participationTrend.map((r: any) => [r.standupDate, Number(r.submissions)]));
      const blockerMap = new Map(blockerTrend.map((r: any) => [r.standupDate, Number(r.blockerCount)]));

      // Mood score: great=5, good=4, okay=3, struggling=2, blocked=1
      const moodScores: Record<string, number> = { great: 5, good: 4, okay: 3, struggling: 2, blocked: 1 };
      const moodByDate = new Map<string, { total: number; count: number }>();
      for (const row of moodTrend) {
        const existing = moodByDate.get(row.standupDate) || { total: 0, count: 0 };
        existing.total += (moodScores[row.mood || "okay"] || 3) * Number(row.count);
        existing.count += Number(row.count);
        moodByDate.set(row.standupDate, existing);
      }

      const series = dates.map((date) => {
        const submissions = participationMap.get(date) || 0;
        const moodData = moodByDate.get(date);
        return {
          date,
          submissions,
          participationRate: Math.round((Number(submissions) / totalParticipants) * 100),
          blockers: blockerMap.get(date) || 0,
          avgMoodScore: moodData ? Math.round((moodData.total / moodData.count) * 10) / 10 : null,
        };
      });

      res.json({ series, totalParticipants });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  /** Per-person analytics for a schedule */
  app.get("/api/standups/analytics/:scheduleId/per-person", requireAuth, async (req: Request, res: Response) => {
    try {
      const scheduleId = parseInt(req.params.scheduleId as string);

      // All participants
      const participants = await db
        .select({
          userId: standupParticipants.userId,
          isRequired: standupParticipants.isRequired,
          userName: users.name,
          userEmail: users.email,
        })
        .from(standupParticipants)
        .leftJoin(users, eq(standupParticipants.userId, users.id))
        .where(eq(standupParticipants.scheduleId, scheduleId));

      // All entries for this schedule
      const entries = await db
        .select({
          userId: standupEntries.userId,
          standupDate: standupEntries.standupDate,
          mood: standupEntries.mood,
          isLate: standupEntries.isLate,
          blockers: standupEntries.blockers,
        })
        .from(standupEntries)
        .where(eq(standupEntries.scheduleId, scheduleId))
        .orderBy(asc(standupEntries.standupDate));

      // Unique standup dates (total possible submissions)
      const uniqueDates = new Set(entries.map((e: any) => e.standupDate));
      const totalStandups = uniqueDates.size;

      const moodScores: Record<string, number> = { great: 5, good: 4, okay: 3, struggling: 2, blocked: 1 };

      const personStats = participants.map((p: any) => {
        const userEntries = entries.filter((e: any) => e.userId === p.userId);
        const totalSubmissions = userEntries.length;
        const lateCount = userEntries.filter((e: any) => e.isLate).length;
        const blockerCount = userEntries.filter((e: any) => e.blockers && e.blockers.trim()).length;
        const moodEntries = userEntries.filter((e: any) => e.mood);
        const avgMood = moodEntries.length > 0
          ? Math.round((moodEntries.reduce((sum: any, e: any) => sum + (moodScores[e.mood!] || 3), 0) / moodEntries.length) * 10) / 10
          : null;

        // Calculate current streak (consecutive submissions from most recent)
        const sortedDates = Array.from(uniqueDates).sort().reverse();
        let streak = 0;
        for (const date of sortedDates) {
          if (userEntries.some((e: any) => e.standupDate === date)) {
            streak++;
          } else {
            break;
          }
        }

        return {
          userId: p.userId,
          userName: p.userName,
          userEmail: p.userEmail,
          isRequired: p.isRequired,
          totalSubmissions,
          participationRate: totalStandups > 0 ? Math.round((totalSubmissions / totalStandups) * 100) : 0,
          lateCount,
          onTimeRate: totalSubmissions > 0 ? Math.round(((totalSubmissions - lateCount) / totalSubmissions) * 100) : 0,
          blockerCount,
          avgMoodScore: avgMood,
          currentStreak: streak,
        };
      });

      res.json({ members: personStats, totalStandups });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  /** Generate formatted digest of a specific standup date */
  app.get("/api/standups/digest/:scheduleId", requireAuth, async (req: Request, res: Response) => {
    try {
      const scheduleId = parseInt(req.params.scheduleId as string);
      const date = (req.query.date as string) || today();

      const schedule = await db
        .select()
        .from(standupSchedules)
        .where(eq(standupSchedules.id, scheduleId))
        .limit(1);

      const entries = await db
        .select({
          userName: users.name,
          whatIDid: standupEntries.whatIDid,
          whatImDoing: standupEntries.whatImDoing,
          blockers: standupEntries.blockers,
          mood: standupEntries.mood,
          isLate: standupEntries.isLate,
        })
        .from(standupEntries)
        .leftJoin(users, eq(standupEntries.userId, users.id))
        .where(and(
          eq(standupEntries.scheduleId, scheduleId),
          eq(standupEntries.standupDate, date)
        ))
        .orderBy(asc(users.name));

      const participants = await db
        .select({ userName: users.name })
        .from(standupParticipants)
        .leftJoin(users, eq(standupParticipants.userId, users.id))
        .where(eq(standupParticipants.scheduleId, scheduleId));

      const submittedNames = new Set(entries.map((e: any) => e.userName));
      const missing = participants.filter((p: any) => !submittedNames.has(p.userName)).map((p: any) => p.userName);

      const scheduleName = schedule[0]?.name || "Standup";
      const blockerEntries = entries.filter((e: any) => e.blockers && e.blockers.trim());

      // Build text digest
      let text = `📋 ${scheduleName} — ${date}\n`;
      text += `${entries.length}/${participants.length} submitted\n\n`;

      for (const entry of entries) {
        text += `👤 ${entry.userName}${entry.isLate ? " (late)" : ""}${entry.mood ? ` [${entry.mood}]` : ""}\n`;
        if (entry.whatIDid) text += `  ✅ ${entry.whatIDid}\n`;
        if (entry.whatImDoing) text += `  🔄 ${entry.whatImDoing}\n`;
        if (entry.blockers) text += `  🚧 ${entry.blockers}\n`;
        text += "\n";
      }

      if (blockerEntries.length > 0) {
        text += `⚠️ BLOCKERS (${blockerEntries.length}):\n`;
        for (const e of blockerEntries) {
          text += `  • ${e.userName}: ${e.blockers}\n`;
        }
        text += "\n";
      }

      if (missing.length > 0) {
        text += `❌ Not submitted: ${missing.join(", ")}\n`;
      }

      // Build markdown digest
      let markdown = `## ${scheduleName} — ${date}\n\n`;
      markdown += `**${entries.length}/${participants.length}** submitted\n\n`;

      for (const entry of entries) {
        markdown += `### ${entry.userName}${entry.isLate ? " *(late)*" : ""}${entry.mood ? ` — ${entry.mood}` : ""}\n`;
        if (entry.whatIDid) markdown += `- **Completed:** ${entry.whatIDid}\n`;
        if (entry.whatImDoing) markdown += `- **Working on:** ${entry.whatImDoing}\n`;
        if (entry.blockers) markdown += `- **Blocker:** ${entry.blockers}\n`;
        markdown += "\n";
      }

      if (blockerEntries.length > 0) {
        markdown += `### ⚠️ Blockers\n`;
        for (const e of blockerEntries) {
          markdown += `- **${e.userName}:** ${e.blockers}\n`;
        }
        markdown += "\n";
      }

      if (missing.length > 0) {
        markdown += `*Not submitted: ${missing.join(", ")}*\n`;
      }

      res.json({ text, markdown, date, scheduleName, submissionCount: entries.length, participantCount: participants.length, blockerCount: blockerEntries.length, missingCount: missing.length });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  /** Auto-populated suggestions from recent task activity */
  app.get("/api/standups/suggestions", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);

      // Recent work item status changes by this user
      const recentChanges = await db
        .select({
          workItemId: workItemStatusHistory.workItemId,
          oldStatus: workItemStatusHistory.oldStatus,
          newStatus: workItemStatusHistory.newStatus,
          changedAt: workItemStatusHistory.changedAt,
          title: workItems.title,
          status: workItems.status,
        })
        .from(workItemStatusHistory)
        .innerJoin(workItems, eq(workItemStatusHistory.workItemId, workItems.id))
        .where(eq(workItemStatusHistory.changedBy, user.id))
        .orderBy(desc(workItemStatusHistory.changedAt))
        .limit(10);

      // Current in-progress items
      const inProgress = await db
        .select({
          id: workItems.id,
          title: workItems.title,
          status: workItems.status,
          priority: workItems.priority,
        })
        .from(workItems)
        .where(and(
          eq(workItems.ownerUserId, user.id),
          eq(workItems.status, "In Progress"),
          isNull(workItems.deletedAt)
        ))
        .orderBy(desc(workItems.updatedAt))
        .limit(10);

      // Build suggestions
      const whatIDid = recentChanges
        .filter((c: any) => c.newStatus === "Complete" || c.newStatus === "In Progress")
        .map((c: any) => `${c.newStatus === "Complete" ? "Completed" : "Started"}: ${c.title}`)
        .slice(0, 5);

      const whatImDoing = inProgress
        .map((item: any) => `Working on: ${item.title}`)
        .slice(0, 5);

      res.json({ whatIDid, whatImDoing });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  // ── Meeting Mode ────────────────────────────────────────────────────────

  /** Get meeting data: all participants with their entries + assigned tasks for the meeting carousel */
  app.get("/api/standups/meeting/:scheduleId", requireAuth, async (req: Request, res: Response) => {
    try {
      const scheduleId = parseInt(req.params.scheduleId as string);
      const date = (req.query.date as string) || today();

      // Get all participants
      const participants = await db
        .select({
          userId: standupParticipants.userId,
          isRequired: standupParticipants.isRequired,
          userName: users.name,
          userEmail: users.email,
        })
        .from(standupParticipants)
        .leftJoin(users, eq(standupParticipants.userId, users.id))
        .where(eq(standupParticipants.scheduleId, scheduleId))
        .orderBy(asc(users.name));

      // Get all entries for this date
      const entries = await db
        .select({
          id: standupEntries.id,
          scheduleId: standupEntries.scheduleId,
          userId: standupEntries.userId,
          standupDate: standupEntries.standupDate,
          whatIDid: standupEntries.whatIDid,
          whatImDoing: standupEntries.whatImDoing,
          blockers: standupEntries.blockers,
          mood: standupEntries.mood,
          isLate: standupEntries.isLate,
          submittedAt: standupEntries.submittedAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(standupEntries)
        .leftJoin(users, eq(standupEntries.userId, users.id))
        .where(and(
          eq(standupEntries.scheduleId, scheduleId),
          eq(standupEntries.standupDate, date)
        ))
        .orderBy(asc(standupEntries.submittedAt));

      const entryByUser = new Map(entries.map((e: any) => [e.userId, e]));

      // For each participant, get their assigned work items (tasks)
      const todayStr = today();
      const meetingParticipants = await Promise.all(
        participants.map(async (p: any) => {
          // Get tasks owned by or assigned to this user
          const ownedTasks = await db
            .select({
              id: workItems.id,
              title: workItems.title,
              status: workItems.status,
              priority: workItems.priority,
              endDate: workItems.endDate,
              percentComplete: workItems.percentComplete,
              projectId: workItems.projectId,
              projectName: projectInfo.projectName,
            })
            .from(workItems)
            .leftJoin(projectInfo, eq(workItems.projectId, projectInfo.id))
            .where(and(
              eq(workItems.ownerUserId, p.userId),
              sql`${workItems.deletedAt} IS NULL`,
              sql`UPPER(${workItems.status}) NOT IN ('COMPLETE', 'COMPLETED', 'DONE', 'CANCELLED', 'CANCELED')`
            ))
            .orderBy(
              sql`CASE ${workItems.priority}
                WHEN 'Urgent' THEN 0
                WHEN 'High' THEN 1
                WHEN 'Med' THEN 2
                WHEN 'Low' THEN 3
                ELSE 4
              END`,
              asc(workItems.endDate)
            )
            .limit(25);

          // Also get tasks assigned via work_item_assignments
          const assignedTaskIds = await db
            .select({ workItemId: workItemAssignments.workItemId })
            .from(workItemAssignments)
            .where(eq(workItemAssignments.userId, p.userId));

          const assignedIds = assignedTaskIds.map((r: any) => r.workItemId);
          const ownedIds = new Set(ownedTasks.map((t: any) => t.id));

          let additionalTasks: typeof ownedTasks = [];
          if (assignedIds.length > 0) {
            const missingIds = assignedIds.filter((id: any) => !ownedIds.has(id));
            if (missingIds.length > 0) {
              additionalTasks = await db
                .select({
                  id: workItems.id,
                  title: workItems.title,
                  status: workItems.status,
                  priority: workItems.priority,
                  endDate: workItems.endDate,
                  percentComplete: workItems.percentComplete,
                  projectId: workItems.projectId,
                  projectName: projectInfo.projectName,
                })
                .from(workItems)
                .leftJoin(projectInfo, eq(workItems.projectId, projectInfo.id))
                .where(and(
                  inArray(workItems.id, missingIds),
                  sql`${workItems.deletedAt} IS NULL`,
                  sql`UPPER(${workItems.status}) NOT IN ('COMPLETE', 'COMPLETED', 'DONE', 'CANCELLED', 'CANCELED')`
                ))
                .orderBy(
                  sql`CASE ${workItems.priority}
                    WHEN 'Urgent' THEN 0
                    WHEN 'High' THEN 1
                    WHEN 'Med' THEN 2
                    WHEN 'Low' THEN 3
                    ELSE 4
                  END`,
                  asc(workItems.endDate)
                )
                .limit(15);
            }
          }

          const rawTasks = [...ownedTasks, ...additionalTasks];

          // Look up company priorities linked to each task's project
          const projectIds = [...new Set(rawTasks.map((t) => t.projectId).filter(Boolean))] as number[];
          let priorityByProject = new Map<number, { id: number; title: string; severity: string }>();
          if (projectIds.length > 0) {
            const ppRows = await db
              .select({
                projectId: priorityProjects.projectId,
                priorityId: mytoolCompanyPriorities.id,
                priorityTitle: mytoolCompanyPriorities.title,
                severity: mytoolCompanyPriorities.severity,
              })
              .from(priorityProjects)
              .innerJoin(mytoolCompanyPriorities, eq(priorityProjects.priorityId, mytoolCompanyPriorities.id))
              .where(and(
                inArray(priorityProjects.projectId, projectIds),
                sql`${mytoolCompanyPriorities.status} != 'closed'`
              ));
            for (const row of ppRows) {
              // Keep the highest-severity priority per project
              const existing = priorityByProject.get(row.projectId);
              const sevRank = (s: string) => s === "critical" ? 2 : s === "important" ? 1 : 0;
              if (!existing || sevRank(row.severity) > sevRank(existing.severity)) {
                priorityByProject.set(row.projectId, {
                  id: row.priorityId,
                  title: row.priorityTitle,
                  severity: row.severity,
                });
              }
            }
          }

          // Enrich tasks with company priority linkage
          const allTasks = rawTasks.map((t) => ({
            ...t,
            linkedPriority: t.projectId ? (priorityByProject.get(t.projectId) || null) : null,
          }));

          // Classify tasks
          const overdue = allTasks.filter((t) => t.endDate && t.endDate < todayStr);
          const dueSoon = allTasks.filter((t) => {
            if (!t.endDate || t.endDate < todayStr) return false;
            const soon = new Date(`${todayStr}T00:00:00Z`);
            soon.setUTCDate(soon.getUTCDate() + 7);
            return t.endDate <= soon.toISOString().split("T")[0];
          });
          const inProgress = allTasks.filter((t) => {
            const s = (t.status || "").toUpperCase();
            return ["IN PROGRESS", "NEEDS APPROVAL", "PROVIDE FEEDBACK"].includes(s);
          });
          const onHold = allTasks.filter((t) => {
            const s = (t.status || "").toUpperCase();
            return ["HOLD", "ON HOLD"].includes(s);
          });

          return {
            userId: p.userId,
            userName: p.userName,
            userEmail: p.userEmail,
            isRequired: p.isRequired,
            entry: entryByUser.get(p.userId) || null,
            hasSubmitted: entryByUser.has(p.userId),
            tasks: {
              total: allTasks.length,
              overdue,
              dueSoon,
              inProgress,
              onHold,
              byPriority: {
                urgent: allTasks.filter((t) => t.priority === "Urgent"),
                high: allTasks.filter((t) => t.priority === "High"),
                med: allTasks.filter((t) => t.priority === "Med"),
                low: allTasks.filter((t) => t.priority === "Low"),
              },
            },
          };
        })
      );

      // Aggregate blockers across all entries
      const allBlockers = entries
        .filter((e: any) => e.blockers && e.blockers.trim())
        .map((e: any) => ({
          userId: e.userId,
          userName: e.userName,
          blockers: e.blockers!,
          mood: e.mood,
        }));

      res.json({
        date,
        participants: meetingParticipants,
        summary: {
          total: participants.length,
          submitted: entries.length,
          blockerCount: allBlockers.length,
          blockers: allBlockers,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Advanced daily standup workflow ───────────────────────────────────────
  app.post("/api/standups/entry", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const { yesterday, today: todayPlan, blockers, project_id, team_id } = req.body || {};
      if (!todayPlan || typeof todayPlan !== "string") {
        return res.status(400).json({ error: "today field is required" });
      }
      const date = new Date().toISOString().slice(0, 10);
      await ensureStandupV2Table();
      await db.execute(sql`
        INSERT INTO standup_entries_v2 (user_id, date, yesterday, today, blockers, project_id, team_id, created_at)
        VALUES (${user.id}, ${date}, ${yesterday ?? null}, ${todayPlan}, ${blockers ?? null}, ${project_id ?? null}, ${team_id ?? null}, ${new Date().toISOString()})
      `);
      res.status(201).json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  app.get("/api/standups/history", requireAuth, async (req: Request, res: Response) => {
    try {
      const teamId = req.query.team_id ? Number(req.query.team_id) : null;
      const from = String(req.query.from || "1900-01-01");
      const to = String(req.query.to || "2999-12-31");
      await ensureStandupV2Table();
      const rows = await db.execute(sql`
        SELECT e.*, u.name as user_name, u.email as user_email
        FROM standup_entries_v2 e
        LEFT JOIN users u ON u.id = e.user_id
        WHERE e.date >= ${from} AND e.date <= ${to} AND (${teamId} IS NULL OR e.team_id = ${teamId})
        ORDER BY e.date DESC, e.created_at DESC
      `);
      res.json({ items: rows.rows || [] });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  app.get("/api/standups/blockers/active", requireAuth, async (_req: Request, res: Response) => {
    try {
      await ensureStandupV2Table();
      const isPostgres = getDbMode() === "postgres";
      const ageDaysExpr = isPostgres
        ? "EXTRACT(EPOCH FROM (NOW() - e.date::date)) / 86400"
        : "CAST(julianday('now') - julianday(e.date) AS INTEGER)";
      const rows = await db.execute(sql.raw(`
        SELECT e.id, e.date, e.blockers, e.project_id, e.team_id, e.user_id, u.name as owner_name,
               ${ageDaysExpr} as age_days
        FROM standup_entries_v2 e
        LEFT JOIN users u ON u.id = e.user_id
        WHERE e.blockers IS NOT NULL AND TRIM(e.blockers) <> ''
        ORDER BY e.date ASC
      `));
      res.json({ items: rows.rows || [] });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  // ── Auto-seed default standup schedule (Mon/Wed/Fri) ──────────────────────
  app.post("/api/standups/seed-default", requireAuth, blockInProduction("Standup seed route is disabled in production."), async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      // Check if a default project standup already exists (ignore soft-deleted)
      const existing = await db
        .select()
        .from(standupSchedules)
        .where(and(
          eq(standupSchedules.name, "Project Standup (Mon/Wed/Fri)"),
          isNull(standupSchedules.deletedAt)
        ));

      if (existing.length > 0) {
        return res.json({ seeded: false, message: "Default standup schedule already exists", schedule: existing[0] });
      }

      // Anchor on a Monday so EVERY_2_DAYS hits Mon, Wed, Fri pattern
      // Find the most recent Monday
      const now = new Date();
      const dayOfWeek = now.getDay();
      const daysToMonday = dayOfWeek === 0 ? 1 : (dayOfWeek === 1 ? 0 : 8 - dayOfWeek);
      const nextMonday = new Date(now);
      nextMonday.setDate(now.getDate() - dayOfWeek + 1); // Go to this week's Monday
      const anchorDate = nextMonday.toISOString().split("T")[0];

      // Use raw SQL for SQLite compatibility (Drizzle pgTable defaults use NOW() which SQLite doesn't support)
      const isSqlite = getDbMode() === "sqlite";
      let schedule: any;
      if (isSqlite) {
        const result = await db.run(sql`INSERT INTO standup_schedules (name, team_label, cadence, cadence_days, anchor_date, deadline_time, deadline_timezone, created_by) VALUES ('Project Standup (Mon/Wed/Fri)', 'All Teams', 'EVERY_2_DAYS', 2, ${anchorDate}, '09:00', 'Africa/Johannesburg', ${user.id})`);
        const lastId = (result as any)?.lastInsertRowid ?? (result as any)?.insertId;
        const rows = await db.select().from(standupSchedules).where(eq(standupSchedules.id, Number(lastId)));
        schedule = rows[0];
      } else {
        const [s] = await db.insert(standupSchedules).values({
          name: "Project Standup (Mon/Wed/Fri)",
          teamLabel: "All Teams",
          cadence: "EVERY_2_DAYS",
          cadenceDays: 2,
          anchorDate,
          deadlineTime: "09:00",
          deadlineTimezone: "Africa/Johannesburg",
          createdBy: user.id,
        }).returning();
        schedule = s;
      }

      // Add creator as participant
      if (isSqlite) {
        await db.run(sql`INSERT INTO standup_participants (schedule_id, user_id, is_required) VALUES (${schedule.id}, ${user.id}, 1)`);
      } else {
        await db.insert(standupParticipants).values({
          scheduleId: schedule.id,
          userId: user.id,
          isRequired: true,
        });
      }

      // Add all active users as participants (exclude soft-deleted users)
      const allUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(isNull(users.deletedAt));

      const participantValues = allUsers
        .filter((u: any) => u.id !== user.id)
        .map((u: any) => ({
          scheduleId: schedule.id,
          userId: u.id,
          isRequired: true,
        }));

      if (participantValues.length > 0) {
        if (isSqlite) {
          for (const pv of participantValues) {
            await db.run(sql`INSERT INTO standup_participants (schedule_id, user_id, is_required) VALUES (${pv.scheduleId}, ${pv.userId}, 1)`);
          }
        } else {
          await db.insert(standupParticipants).values(participantValues);
        }
      }

      res.status(201).json({ seeded: true, schedule });
    } catch (err: unknown) {
      res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });
}
