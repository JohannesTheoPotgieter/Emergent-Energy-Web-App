import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, desc, asc, sql, inArray, isNull, count } from "drizzle-orm";
import {
  standupSchedules, standupParticipants, standupEntries,
  notifications, notificationThrottle,
  users, projectInfo, workItems, workItemStatusHistory,
  type InsertStandupSchedule, type InsertStandupEntry, type InsertStandupParticipant,
} from "@shared/schema";
import { getEffectiveUser, requireAuth } from "./auth-context";
import { requirePermission } from "./permission-middleware";

type AppUser = { id: number; email: string; name: string; role: string };

function getUser(req: Request): AppUser {
  return getEffectiveUser(req) as AppUser;
}

/** Check if today is a standup day for a given schedule */
function isStandupDay(anchorDate: string, cadenceDays: number, checkDate: string): boolean {
  const anchor = new Date(anchorDate);
  const check = new Date(checkDate);
  const diffMs = check.getTime() - anchor.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays % cadenceDays === 0;
}

/** Get today as YYYY-MM-DD */
function today(): string {
  return new Date().toISOString().split("T")[0];
}

export function registerStandupRoutes(app: Express) {

  // ── Schedules ──────────────────────────────────────────────────────────────

  /** List all standup schedules the current user participates in */
  app.get("/api/standups/schedules", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const participantRows = await db
        .select({ scheduleId: standupParticipants.scheduleId })
        .from(standupParticipants)
        .where(eq(standupParticipants.userId, user.id));

      const scheduleIds = participantRows.map((r) => r.scheduleId);

      let schedules;
      if (scheduleIds.length > 0) {
        schedules = await db
          .select()
          .from(standupSchedules)
          .where(and(
            inArray(standupSchedules.id, scheduleIds),
            eq(standupSchedules.isActive, true)
          ))
          .orderBy(desc(standupSchedules.createdAt));
      } else {
        schedules = [];
      }

      res.json(schedules);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Create a standup schedule */
  app.post("/api/standups/schedules", requireAuth, requirePermission("standups", "create"), async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const { name, teamLabel, projectId, cadence, cadenceDays, anchorDate, deadlineTime } = req.body;

      const [schedule] = await db.insert(standupSchedules).values({
        name,
        teamLabel: teamLabel || null,
        projectId: projectId || null,
        cadence: cadence || "EVERY_2_DAYS",
        cadenceDays: cadenceDays || 2,
        anchorDate: anchorDate || today(),
        deadlineTime: deadlineTime || "10:00",
        createdBy: user.id,
      }).returning();

      // Auto-add creator as participant
      await db.insert(standupParticipants).values({
        scheduleId: schedule.id,
        userId: user.id,
        isRequired: true,
      });

      res.status(201).json(schedule);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Update a standup schedule */
  app.patch("/api/standups/schedules/:id", requireAuth, requirePermission("standups", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updates: Partial<InsertStandupSchedule> = {};
      const allowed = ["name", "teamLabel", "projectId", "cadence", "cadenceDays", "anchorDate", "deadlineTime", "isActive"] as const;
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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Delete a standup schedule */
  app.delete("/api/standups/schedules/:id", requireAuth, requirePermission("standups", "delete"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(standupSchedules).where(eq(standupSchedules.id, id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Participants ───────────────────────────────────────────────────────────

  /** List participants for a schedule */
  app.get("/api/standups/schedules/:id/participants", requireAuth, async (req: Request, res: Response) => {
    try {
      const scheduleId = parseInt(req.params.id);
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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Add participant to schedule */
  app.post("/api/standups/schedules/:id/participants", requireAuth, async (req: Request, res: Response) => {
    try {
      const scheduleId = parseInt(req.params.id);
      const { userId, isRequired } = req.body;

      const [participant] = await db.insert(standupParticipants).values({
        scheduleId,
        userId,
        isRequired: isRequired !== false,
      }).returning();

      res.status(201).json(participant);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Remove participant from schedule */
  app.delete("/api/standups/schedules/:scheduleId/participants/:userId", requireAuth, async (req: Request, res: Response) => {
    try {
      const scheduleId = parseInt(req.params.scheduleId);
      const userId = parseInt(req.params.userId);

      await db.delete(standupParticipants).where(
        and(
          eq(standupParticipants.scheduleId, scheduleId),
          eq(standupParticipants.userId, userId)
        )
      );

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Entries ────────────────────────────────────────────────────────────────

  /** Get today's standup info (which schedules need a submission) */
  app.get("/api/standups/today", requireAuth, async (req: Request, res: Response) => {
    try {
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
          eq(standupSchedules.isActive, true)
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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Submit a standup entry */
  app.post("/api/standups/entries", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const { scheduleId, standupDate, whatIDid, whatImDoing, blockers, mood } = req.body;

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

      // Check if late
      const schedule = await db
        .select()
        .from(standupSchedules)
        .where(eq(standupSchedules.id, scheduleId))
        .limit(1);

      let isLate = false;
      if (schedule.length > 0 && schedule[0].deadlineTime) {
        const now = new Date();
        const [h, m] = schedule[0].deadlineTime.split(":").map(Number);
        const deadline = new Date(now);
        deadline.setHours(h, m, 0, 0);
        isLate = now > deadline;
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

      res.status(201).json(entry);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Update a standup entry */
  app.patch("/api/standups/entries/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { whatIDid, whatImDoing, blockers, mood } = req.body;

      const [updated] = await db
        .update(standupEntries)
        .set({
          whatIDid, whatImDoing, blockers,
          mood: mood || undefined,
          updatedAt: new Date(),
        })
        .where(eq(standupEntries.id, id))
        .returning();

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** List entries for a schedule on a specific date */
  app.get("/api/standups/entries/:scheduleId", requireAuth, async (req: Request, res: Response) => {
    try {
      const scheduleId = parseInt(req.params.scheduleId);
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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Standup history for a schedule (with pagination and search) */
  app.get("/api/standups/entries/:scheduleId/history", requireAuth, async (req: Request, res: Response) => {
    try {
      const scheduleId = parseInt(req.params.scheduleId);
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;
      const search = req.query.search as string;

      let query = db
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
        .where(eq(standupEntries.scheduleId, scheduleId))
        .orderBy(desc(standupEntries.standupDate), asc(standupEntries.submittedAt))
        .limit(limit)
        .offset(offset);

      const entries = await query;

      // Group by date
      const grouped: Record<string, typeof entries> = {};
      for (const entry of entries) {
        const date = entry.standupDate;
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(entry);
      }

      res.json({ entries: grouped, total: entries.length, limit, offset });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Standup analytics for a schedule */
  app.get("/api/standups/analytics/:scheduleId", requireAuth, async (req: Request, res: Response) => {
    try {
      const scheduleId = parseInt(req.params.scheduleId);

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

      res.json({
        totalEntries: totalResult.count,
        lateEntries: lateResult.count,
        totalParticipants: participantsResult.count,
        recentBlockers: blockerEntries,
        moodDistribution: moodDist,
        participationRate: participantsResult.count > 0
          ? Math.round((totalResult.count / participantsResult.count) * 100) / 100
          : 0,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
        .filter((c) => c.newStatus === "Complete" || c.newStatus === "In Progress")
        .map((c) => `${c.newStatus === "Complete" ? "Completed" : "Started"}: ${c.title}`)
        .slice(0, 5);

      const whatImDoing = inProgress
        .map((item) => `Working on: ${item.title}`)
        .slice(0, 5);

      res.json({ whatIDid, whatImDoing });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
