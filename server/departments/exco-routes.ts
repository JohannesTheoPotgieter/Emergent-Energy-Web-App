// @ts-nocheck
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth, requireAdmin, requirePriorityAdmin } from './shared-middleware';
import { storage } from "../storage";
import { db } from "../db";
import { requirePermission } from "../permission-middleware";
import { eq, and, or, sql, isNull } from "drizzle-orm";
import { projectInfo } from "@shared/schema";
import path from "path";
import fs from "fs";
import multer from "multer";

const router = Router();

function computeNextRecurrenceDate(
  currentDate: string,
  frequency: string,
  interval: number,
  daysOfWeek: string | null
): string {
  const d = new Date(currentDate + "T00:00:00Z");

  switch (frequency) {
    case "daily":
      d.setUTCDate(d.getUTCDate() + interval);
      break;
    case "weekly":
      if (daysOfWeek) {
        const days = daysOfWeek.split(",").map(Number).sort();
        const currentDay = d.getUTCDay();
        const nextDay = days.find(day => day > currentDay);
        if (nextDay !== undefined) {
          d.setUTCDate(d.getUTCDate() + (nextDay - currentDay));
        } else {
          const daysToAdd = 7 * interval - currentDay + days[0];
          d.setUTCDate(d.getUTCDate() + daysToAdd);
        }
      } else {
        d.setUTCDate(d.getUTCDate() + 7 * interval);
      }
      break;
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + interval);
      break;
  }

  return d.toISOString().slice(0, 10);
}

function computeNextDueDate(currentDue: Date, frequency: string, interval: number): Date {
  const d = new Date(currentDue);
  switch (frequency) {
    case "daily":
      d.setDate(d.getDate() + interval);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7 * interval);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + interval);
      break;
  }
  return d;
}

// ==================== MY TOOL - SETTINGS ====================

router.get("/api/mytool/settings", requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = await storage.getMytoolSettings();
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/mytool/settings", requireAuth, requireAdmin, async (req, res) => {
  try {
    const updated = await storage.updateMytoolSettings(req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== MY TOOL - TASKS ====================

router.get("/api/mytool/tasks", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const { date } = req.query;
    let tasks;
    if (date && typeof date === 'string') {
      tasks = await storage.getMytoolTasksByDate(userId, date);
    } else {
      tasks = await storage.getMytoolTasks(userId);
    }
    res.json(tasks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/mytool/tasks", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const bucket = req.body.bucket || 'personal';
    if (bucket === 'project' && !req.body.projectName) {
      return res.status(400).json({ error: "Project name is required when bucket is 'project'" });
    }
    if (bucket !== 'project' && req.body.projectName) {
      req.body.projectName = null;
    }
    const task = await storage.createMytoolTask({ ...req.body, bucket, ownerUserId: userId });
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/mytool/tasks/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const userId = (req.user as any).id;
    const existingTask = await storage.getMytoolTask(taskId);

    if (req.body.bucket !== undefined || req.body.projectName !== undefined) {
      const bucket = req.body.bucket || existingTask?.bucket || 'personal';
      const projectName = req.body.projectName !== undefined ? req.body.projectName : existingTask?.projectName;
      if (bucket === 'project' && !projectName) {
        return res.status(400).json({ error: "Project name is required when bucket is 'project'" });
      }
      if (bucket !== 'project') {
        req.body.projectName = null;
      }
    }

    if (req.body.status === 'done' && existingTask) {
      const dod = req.body.definitionOfDone || existingTask.definitionOfDone;
      if (!dod || !dod.trim()) {
        return res.status(422).json({ error: "Cannot mark task as done without a Definition of Done." });
      }
    }

    const task = await storage.updateMytoolTask(taskId, req.body);

    if (
      req.body.status === "done" &&
      existingTask &&
      existingTask.isRecurring &&
      existingTask.recurrenceFrequency
    ) {
      const nextDate = computeNextRecurrenceDate(
        existingTask.plannedForDate || new Date().toISOString().slice(0, 10),
        existingTask.recurrenceFrequency,
        existingTask.recurrenceInterval || 1,
        existingTask.recurrenceDaysOfWeek
      );

      if (!existingTask.recurrenceEndDate || nextDate <= existingTask.recurrenceEndDate) {
        await storage.createMytoolTask({
          ownerUserId: userId,
          title: existingTask.title,
          status: "planned",
          priority: existingTask.priority,
          plannedForDate: nextDate,
          dueAt: existingTask.dueAt ? computeNextDueDate(existingTask.dueAt, existingTask.recurrenceFrequency, existingTask.recurrenceInterval || 1) : null,
          notes: existingTask.notes,
          projectName: existingTask.projectName,
          tag: existingTask.tag,
          sortOrder: existingTask.sortOrder,
          isRecurring: true,
          recurrenceFrequency: existingTask.recurrenceFrequency,
          recurrenceInterval: existingTask.recurrenceInterval,
          recurrenceDaysOfWeek: existingTask.recurrenceDaysOfWeek,
          recurrenceEndDate: existingTask.recurrenceEndDate,
          recurrenceParentId: existingTask.recurrenceParentId || existingTask.id,
        });
      }
    }

    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/mytool/tasks/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await storage.deleteMytoolTask(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== MY TOOL - TIMEBLOCKS ====================

router.get("/api/mytool/timeblocks", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const { date } = req.query;
    if (!date || typeof date !== 'string') {
      return res.status(400).json({ error: "date query parameter required" });
    }
    const blocks = await storage.getMytoolTimeblocks(userId, date);
    res.json(blocks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/mytool/timeblocks", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const block = await storage.createMytoolTimeblock({ ...req.body, ownerUserId: userId });
    res.json(block);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/mytool/timeblocks/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const block = await storage.updateMytoolTimeblock(parseInt(req.params.id), req.body);
    res.json(block);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/mytool/timeblocks/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await storage.deleteMytoolTimeblock(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== MY TOOL - DAILY REVIEWS ====================

router.get("/api/mytool/daily-review", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const { date } = req.query;
    if (!date || typeof date !== 'string') {
      return res.status(400).json({ error: "date query parameter required" });
    }
    const review = await storage.getMytoolDailyReview(userId, date);
    res.json(review || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/mytool/daily-review", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const review = await storage.upsertMytoolDailyReview({ ...req.body, ownerUserId: userId });
    res.json(review);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== MY TOOL - COMPANY PRIORITIES ====================

router.get("/api/mytool/company-priorities", requireAuth, async (req, res) => {
  try {
    const { horizon } = req.query;
    const priorities = await storage.getMytoolCompanyPriorities(horizon as string | undefined);
    const nullRanked = priorities.filter(p => p.priorityRank == null);
    if (nullRanked.length > 0) {
      const deptMaxRanks: Record<string, number> = {};
      priorities.forEach(p => {
        const dept = p.department || "_none_";
        if (p.priorityRank != null) {
          deptMaxRanks[dept] = Math.max(deptMaxRanks[dept] || 0, p.priorityRank);
        }
      });
      for (const p of nullRanked) {
        const dept = p.department || "_none_";
        const nextRank = (deptMaxRanks[dept] || 0) + 1;
        deptMaxRanks[dept] = nextRank;
        await storage.updateMytoolCompanyPriority(p.id, { priorityRank: nextRank });
        p.priorityRank = nextRank;
      }
    }
    const { priorityLinks: plTable } = await import("@shared/schema");
    const allLinks = await db.select().from(plTable);
    const linksByPriority: Record<number, any[]> = {};
    allLinks.forEach(l => {
      if (!linksByPriority[l.priorityId]) linksByPriority[l.priorityId] = [];
      linksByPriority[l.priorityId].push(l);
    });

    // Enrich with derived metrics from the strategic view for consistency
    let allMetrics: any[] = [];
    try {
      const metricsRows = await db.execute(sql`SELECT * FROM priority_derived_metrics`);
      allMetrics = (metricsRows.rows || metricsRows) as any[];
    } catch (_) {
      // View may not exist yet
    }
    const metricsMap = new Map(allMetrics.map((m: any) => [m.priority_id, m]));

    const enriched = priorities.map(p => {
      const metrics = metricsMap.get(p.id);
      const projectCount = Number(metrics?.project_count || 0);
      const hasProjects = projectCount > 0;
      return {
        ...p,
        links: linksByPriority[p.id] || [],
        effectiveHealth: hasProjects
          ? (metrics?.derived_health || "healthy")
          : (p.manualHealth || "healthy"),
        effectiveProgress: hasProjects
          ? Math.round(Number(metrics?.avg_progress || 0))
          : (p.manualProgress || 0),
        projectCount,
        hasProjects,
      };
    });
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/mytool/company-priorities", requireAuth, requirePriorityAdmin, async (req, res) => {
  try {
    const priority = await storage.createMytoolCompanyPriority(req.body);
    res.json(priority);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/mytool/company-priorities/:id", requireAuth, requirePriorityAdmin, async (req, res) => {
  try {
    const priority = await storage.updateMytoolCompanyPriority(parseInt(req.params.id), req.body);
    res.json(priority);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/mytool/company-priorities/:id", requireAuth, requirePriorityAdmin, async (req, res) => {
  try {
    await storage.deleteMytoolCompanyPriority(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PRIORITY LINKS (many-to-many) ====================

router.get("/api/mytool/company-priorities/:id/links", requireAuth, async (req, res) => {
  try {
    const { priorityLinks: plTable } = await import("@shared/schema");
    const links = await db.select().from(plTable).where(eq(plTable.priorityId, parseInt(req.params.id)));
    res.json(links);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/mytool/priority-links", requireAuth, async (_req, res) => {
  try {
    const { priorityLinks: plTable } = await import("@shared/schema");
    const links = await db.select().from(plTable);
    res.json(links);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/mytool/company-priorities/:id/links", requireAuth, requirePriorityAdmin, async (req, res) => {
  try {
    const { priorityLinks: plTable } = await import("@shared/schema");
    const priorityId = parseInt(req.params.id);
    const { linkType, projectName, taskId, taskType } = req.body;
    if (!linkType) return res.status(400).json({ error: "linkType is required" });
    const [link] = await db.insert(plTable).values({
      priorityId,
      linkType,
      projectName: projectName || null,
      taskId: taskId ? parseInt(taskId) : null,
      taskType: taskType || null,
    }).returning();
    res.json(link);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/mytool/priority-links/:linkId", requireAuth, requirePriorityAdmin, async (req, res) => {
  try {
    const { priorityLinks: plTable } = await import("@shared/schema");
    await db.delete(plTable).where(eq(plTable.id, parseInt(req.params.linkId)));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/mytool/escalated-priorities", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [allProjectInfo, allOpTasks] = await Promise.all([
      storage.getAllProjectInfo(),
      storage.getAllOperationalTasks(),
    ]);

    const escalated: Array<{
      id: string;
      type: 'project' | 'task';
      title: string;
      projectName: string;
      escalationLevel: string;
      status: string | null;
      priority: string | null;
      dueDate: string | null;
      assignees: string[] | null;
    }> = [];

    for (const proj of allProjectInfo) {
      if (proj.escalationLevel === 'Highest') {
        escalated.push({
          id: `project-${proj.id}`,
          type: 'project',
          title: proj.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " "),
          projectName: proj.projectName,
          escalationLevel: proj.escalationLevel,
          status: proj.phase || null,
          priority: null,
          dueDate: null,
          assignees: proj.pm ? [proj.pm] : null,
        });
      }
    }

    for (const task of allOpTasks) {
      if (task.escalationLevel === 'Highest') {
        escalated.push({
          id: `task-${task.id}`,
          type: 'task',
          title: task.title,
          projectName: task.projectName,
          escalationLevel: task.escalationLevel,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          assignees: task.assignees,
        });
      }
    }

    res.json(escalated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== MY TOOL - USER PREFERENCES ====================

router.get("/api/mytool/preferences", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const prefs = await storage.getMytoolUserPreferences(userId);
    res.json(prefs || { ownerUserId: userId, defaultView: 'today', workdayStartTime: '08:00', workdayEndTime: '17:00', showCompanyPriorities: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/mytool/preferences", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const prefs = await storage.upsertMytoolUserPreferences({ ...req.body, ownerUserId: userId });
    res.json(prefs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== MY TOOL - EMAIL LINKS ====================

router.get("/api/mytool/email-links", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { taskId, priorityId, operationalTaskId } = req.query;
    if (taskId) {
      const links = await storage.getEmailLinksByTask(parseInt(taskId as string));
      return res.json(links);
    }
    if (operationalTaskId) {
      const links = await storage.getEmailLinksByOperationalTask(parseInt(operationalTaskId as string));
      return res.json(links);
    }
    if (priorityId) {
      const links = await storage.getEmailLinksByPriority(parseInt(priorityId as string));
      return res.json(links);
    }
    res.json([]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/mytool/email-links", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = (req.user as any)?.id || null;
    const link = await storage.createEmailLink({ ...req.body, createdBy: userId });
    res.json(link);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/mytool/email-links/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await storage.deleteEmailLink(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// My Tool - DoD Templates
router.get("/api/mytool/dod-templates", requireAuth, requireAdmin, async (req, res) => {
  try {
    const templates = await storage.getMytoolDodTemplates();
    res.json(templates);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/mytool/dod-templates", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const template = await storage.createMytoolDodTemplate({ ...req.body, createdBy: userId });
    res.json(template);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/mytool/dod-templates/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await storage.deleteMytoolDodTemplate(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Support Tickets
router.post("/api/mytool/support-ticket", requireAuth, async (req, res) => {
  try {
    const { summary, stepsToReproduce, currentRoute, userAgent } = req.body;
    if (!summary || !stepsToReproduce) {
      return res.status(400).json({ error: "Summary and steps to reproduce are required" });
    }
    const correlationId = `ST-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const ticket = await storage.createSupportTicket({
      userId: (req.user as any).id,
      summary,
      stepsToReproduce,
      currentRoute: currentRoute || null,
      userAgent: userAgent || null,
      correlationId,
      status: "open",
    });
    res.json(ticket);
  } catch (error: any) {
    console.error("Error creating support ticket:", error);
    res.status(500).json({ error: "Failed to create support ticket" });
  }
});

router.get("/api/mytool/support-tickets", requireAuth, requireAdmin, async (req, res) => {
  try {
    const tickets = await storage.getSupportTickets();
    res.json(tickets);
  } catch (error: any) {
    console.error("Error fetching support tickets:", error);
    res.status(500).json({ error: "Failed to fetch support tickets" });
  }
});

// ==================== ERROR LOG ====================

router.post("/api/error-log", requireAuth, async (req, res) => {
  try {
    const { route, action, errorMessage, errorStack, payloadShape } = req.body;
    const correlationId = `ERR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await storage.createErrorLog({
      userId: (req.user as any).id,
      route: route || null,
      action: action || null,
      correlationId,
      errorMessage: errorMessage || "Unknown error",
      errorStack: errorStack || null,
      payloadShape: payloadShape || null,
    });
    res.json({ correlationId });
  } catch (error: any) {
    console.error("Error logging error:", error);
    res.status(500).json({ error: "Failed to log error" });
  }
});

// ─── Outlook Integration (Replit Connector) ───

router.get("/api/outlook/status", requireAuth, async (req, res) => {
  try {
    const outlook = await import("../outlook");
    const status = await outlook.getConnectionStatus();
    res.json(status);
  } catch (err: any) {
    res.json({ configured: false, connected: false });
  }
});

router.get("/api/outlook/events", requireAuth, async (req, res) => {
  try {
    const outlook = await import("../outlook");
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: "start and end query params required (YYYY-MM-DD)" });
    }

    const userId = (req.user as any)?.id;
    let userToken: string | null = null;
    if (userId) {
      try {
        const { getSsoTokenForUser } = await import("../ms-account-service");
        userToken = await getSsoTokenForUser(userId);
      } catch {}
    }

    let events: any[] = [];
    if (userToken) {
      try {
        events = await outlook.getCalendarEvents(start as string, end as string, userToken);
      } catch (graphErr: any) {
        console.log("[Outlook] Graph API call failed with user token:", graphErr.message);
      }
    } else {
      try {
        events = await outlook.getCalendarEvents(start as string, end as string);
      } catch (fallbackErr: any) {
        console.log("[Outlook] Connector fallback failed:", fallbackErr.message);
      }
    }

    if (events.length === 0 && userId) {
      try {
        const { db } = await import("../db");
        const { msObjects } = await import("@shared/schema");
        const { and, eq, gte, lte } = await import("drizzle-orm");
        const startDate = `${start}T00:00:00`;
        const endDate = `${end}T23:59:59`;
        const synced = await db.select().from(msObjects).where(
          and(
            eq(msObjects.userId, userId),
            eq(msObjects.type, "event"),
            gte(msObjects.receivedOrStartDatetime, startDate),
            lte(msObjects.receivedOrStartDatetime, endDate)
          )
        );
        events = synced.map((s: any) => {
          const meta = s.metadata || {};
          return {
            id: s.msId || String(s.id),
            subject: s.subjectOrTitle || "No Subject",
            start: s.receivedOrStartDatetime,
            end: s.endDatetime || s.receivedOrStartDatetime,
            isAllDay: meta.isAllDay || false,
            location: meta.location || null,
            organizer: s.senderOrOrganizer || null,
            showAs: meta.showAs || "busy",
            isCancelled: false,
            isRecurring: meta.isRecurring || false,
            source: "synced",
            webLink: s.webLink,
          };
        });
      } catch (dbErr: any) {
        console.log("[Outlook] DB fallback failed:", dbErr.message);
      }
    }

    res.json(events);
  } catch (err: any) {
    if (err.message?.includes("not connected") || err.message?.includes("not available")) {
      return res.json([]);
    }
    console.error("[Outlook] Events error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/outlook/events", requireAuth, requireAdmin, async (req, res) => {
  try {
    const outlook = await import("../outlook");
    const { date, startTime, endTime, label, idempotencyKey } = req.body;
    if (!date || !startTime || !endTime || !label) {
      return res.status(400).json({ error: "date, startTime, endTime, label are required" });
    }
    const eventId = await outlook.createOutlookEvent({
      date, startTime, endTime, label,
      idempotencyKey: idempotencyKey || `tb-${Date.now()}`,
    });
    res.json({ eventId });
  } catch (err: any) {
    console.error("[Outlook] Create event error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/outlook/events/:eventId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const outlook = await import("../outlook");
    const { calendarId, date, startTime, endTime, label } = req.body;
    await outlook.updateOutlookEvent(req.params.eventId, calendarId || null, {
      date, startTime, endTime, label,
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error("[Outlook] Update event error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/outlook/events/:eventId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const outlook = await import("../outlook");
    const { calendarId } = req.query;
    await outlook.deleteOutlookEvent(req.params.eventId, (calendarId as string) || null);
    res.json({ success: true });
  } catch (err: any) {
    console.error("[Outlook] Delete event error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/outlook/messages", requireAuth, async (req, res) => {
  try {
    const outlook = await import("../outlook");
    const { search, top, skip, folder } = req.query;
    const messages = await outlook.listMessages({
      search: search ? String(search) : undefined,
      top: top ? parseInt(String(top)) : 20,
      skip: skip ? parseInt(String(skip)) : 0,
      folder: folder ? String(folder) : "inbox",
    });
    res.json(messages);
  } catch (err: any) {
    if (err.message?.includes("not connected") || err.message?.includes("not available") || err.message?.includes("not configured")) {
      return res.json([]);
    }
    console.error("[Outlook] Messages error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/outlook/messages/:id", requireAuth, async (req, res) => {
  try {
    const outlook = await import("../outlook");
    const msg = await outlook.getMessageDetail(req.params.id);
    res.json(msg);
  } catch (err: any) {
    console.error("[Outlook] Message detail error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/outlook/email-to-task", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const {
      outlookMessageId, subject, sender, receivedAt, snippet, webLink,
      targetType, targetId,
      projectName, assigneeUserId, priority, dueDate, description,
      sourceType,
    } = req.body;

    if (!subject) {
      return res.status(400).json({ error: "subject is required" });
    }

    let taskId: number | null = null;
    let operationalTaskId: number | null = null;

    if (targetType === "operational_new") {
      if (!projectName) {
        return res.status(400).json({ error: "projectName is required for project tasks" });
      }

      const projectExists = await db.select({ id: projectInfo.id })
        .from(projectInfo)
        .where(eq(projectInfo.projectName, projectName))
        .limit(1);
      if (projectExists.length === 0) {
        return res.status(400).json({ error: `Project "${projectName}" not found` });
      }
      const sourceLabel = sourceType === "teams" ? "Teams Message" : "Outlook Email";
      const notesLines = [];
      if (sender) notesLines.push(`Source: ${sourceLabel} from ${sender}`);
      if (receivedAt) notesLines.push(`Date: ${new Date(receivedAt).toLocaleDateString()}`);
      if (snippet) notesLines.push(`\n${snippet}`);
      if (webLink) notesLines.push(`\nLink: ${webLink}`);

      const opTask = await storage.createOperationalTask({
        projectName,
        title: subject,
        description: description || notesLines.join("\n") || null,
        status: "TO DO",
        priority: priority || "Med",
        ownerUserId: assigneeUserId ? parseInt(String(assigneeUserId)) : null,
        requesterUserId: userId,
        dueDate: dueDate || null,
        sortOrder: 0,
        externalSource: sourceType === "teams" ? "teams_message" : "outlook_email",
        externalTaskId: outlookMessageId || null,
        createdBy: userId,
        domain: "BOTH",
        percentComplete: 0,
      });
      operationalTaskId = opTask.id;

      await storage.createTaskActivityLog({
        taskId: opTask.id,
        actorId: userId,
        actionType: 'created',
        fieldName: 'source',
        oldValue: null,
        newValue: `Created from ${sourceLabel}`,
      });

      // Notifications feature removed - task assignment notification is now a no-op
    } else if (targetType === "new") {
      const task = await storage.createMytoolTask({
        ownerUserId: userId,
        title: subject,
        status: "inbox",
        priority: "normal",
        notes: snippet ? `Email from: ${sender || "unknown"}\n\n${snippet}` : null,
        sortOrder: 0,
        isRecurring: false,
      });
      taskId = task.id;
    } else if (targetType === "mytool" && targetId) {
      taskId = parseInt(String(targetId));
    } else if (targetType === "operational" && targetId) {
      operationalTaskId = parseInt(String(targetId));
    }

    const emailLink = await storage.createEmailLink({
      subject,
      sender: sender || null,
      emailDate: receivedAt ? new Date(receivedAt).toISOString().slice(0, 10) : null,
      snippet: snippet || null,
      outlookMessageId: outlookMessageId || null,
      webLink: webLink || null,
      linkedTaskId: taskId,
      linkedOperationalTaskId: operationalTaskId,
      linkedPriorityId: null,
      createdBy: userId,
    });

    res.json({
      task: taskId ? { id: taskId } : null,
      operationalTask: operationalTaskId ? { id: operationalTaskId } : null,
      emailLink,
    });
  } catch (err: any) {
    console.error("[Outlook] Email-to-task error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/outlook/send-approval", requireAuth, requireAdmin, async (req, res) => {
  try {
    const outlook = await import("../outlook");
    const { to, subject, approvalTitle, approvalDescription, approveUrl, rejectUrl } = req.body;
    if (!to || !subject || !approvalTitle) {
      return res.status(400).json({ error: "to, subject, and approvalTitle are required" });
    }
    await outlook.sendApprovalEmail({
      to, subject, approvalTitle,
      approvalDescription: approvalDescription || "",
      approveUrl: approveUrl || "#",
      rejectUrl: rejectUrl || "#",
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error("[Outlook] Send approval error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/outlook/folders", requireAuth, async (req, res) => {
  try {
    const outlook = await import("../outlook");
    const folders = await outlook.listMailFolders();
    res.json(folders);
  } catch (err: any) {
    if (err.message?.includes("not connected") || err.message?.includes("not available") || err.message?.includes("not configured")) {
      return res.json([]);
    }
    console.error("[Outlook] Folders error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/outlook/send", requireAuth, requireAdmin, async (req, res) => {
  try {
    const outlook = await import("../outlook");
    const { to, cc, subject, body, bodyType } = req.body;
    if (!to || !Array.isArray(to) || to.length === 0 || !subject) {
      return res.status(400).json({ error: "to (array) and subject are required" });
    }
    await outlook.sendMail({ to, cc: cc || [], subject, body: body || "", bodyType: bodyType || "Text" });
    res.json({ success: true });
  } catch (err: any) {
    console.error("[Outlook] Send mail error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/outlook/messages/:id/reply", requireAuth, requireAdmin, async (req, res) => {
  try {
    const outlook = await import("../outlook");
    const { comment, replyAll } = req.body;
    if (!comment) {
      return res.status(400).json({ error: "comment is required" });
    }
    await outlook.replyToMessage(req.params.id, comment, !!replyAll);
    res.json({ success: true });
  } catch (err: any) {
    console.error("[Outlook] Reply error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/outlook/messages/:id/forward", requireAuth, requireAdmin, async (req, res) => {
  try {
    const outlook = await import("../outlook");
    const { comment, to } = req.body;
    if (!to || !Array.isArray(to) || to.length === 0) {
      return res.status(400).json({ error: "to (array) is required" });
    }
    await outlook.forwardMessage(req.params.id, comment || "", to);
    res.json({ success: true });
  } catch (err: any) {
    console.error("[Outlook] Forward error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== TRIAGE RULES CRUD ====================

router.get("/api/mytool/triage-rules", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const { triageRules: triageRulesTable } = await import("@shared/schema");
    const rules = await db.select().from(triageRulesTable).where(eq(triageRulesTable.ownerUserId, userId));
    res.json(rules);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/mytool/triage-rules", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const { ruleType, value } = req.body;
    if (!ruleType || !value) return res.status(400).json({ error: "ruleType and value required" });
    const { triageRules: triageRulesTable } = await import("@shared/schema");
    const [rule] = await db.insert(triageRulesTable).values({
      ownerUserId: userId,
      ruleType,
      value: value.trim(),
      enabled: true,
    }).returning();
    res.json(rule);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/mytool/triage-rules/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const ruleId = parseInt(req.params.id);
    const { triageRules: triageRulesTable } = await import("@shared/schema");
    const updates: any = {};
    if (req.body.value !== undefined) updates.value = req.body.value.trim();
    if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
    const [rule] = await db.update(triageRulesTable).set(updates).where(eq(triageRulesTable.id, ruleId)).returning();
    res.json(rule);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/mytool/triage-rules/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const ruleId = parseInt(req.params.id);
    const { triageRules: triageRulesTable } = await import("@shared/schema");
    await db.delete(triageRulesTable).where(eq(triageRulesTable.id, ruleId));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== TRIAGE INBOX ====================

router.get("/api/mytool/triage-inbox", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    const outlook = await import("../outlook");
    if (!outlook.isOutlookConfigured()) {
      return res.json({ flagged: [], keywordMatches: [], senderMatches: [], rules: [] });
    }

    const { triageRules: triageRulesTable } = await import("@shared/schema");
    const rules = await db.select().from(triageRulesTable)
      .where(and(eq(triageRulesTable.ownerUserId, userId), eq(triageRulesTable.enabled, true)));

    const keywords = rules.filter(r => r.ruleType === 'keyword').map(r => r.value.toLowerCase());
    const senders = rules.filter(r => r.ruleType === 'sender').map(r => r.value.toLowerCase());
    const domains = rules.filter(r => r.ruleType === 'domain').map(r => r.value.toLowerCase());

    let flagged: any[] = [];
    try {
      flagged = await outlook.listFlaggedMessages(30);
    } catch {}

    let recentEmails: any[] = [];
    try {
      recentEmails = await outlook.listMessages({ top: 50 });
    } catch {}

    const keywordMatches: any[] = [];
    const senderMatches: any[] = [];
    const flaggedIds = new Set(flagged.map((e: any) => e.id));

    for (const email of recentEmails) {
      if (flaggedIds.has(email.id)) continue;
      const subjectLower = (email.subject || "").toLowerCase();
      const snippetLower = (email.snippet || "").toLowerCase();
      const senderEmailLower = (email.senderEmail || "").toLowerCase();

      const matchedKeyword = keywords.find(kw => subjectLower.includes(kw) || snippetLower.includes(kw));
      if (matchedKeyword) {
        keywordMatches.push({ ...email, matchedRule: matchedKeyword, matchType: 'keyword' });
        continue;
      }

      const matchedSender = senders.find(s => senderEmailLower === s || (email.sender || "").toLowerCase() === s);
      if (matchedSender) {
        senderMatches.push({ ...email, matchedRule: matchedSender, matchType: 'sender' });
        continue;
      }

      const matchedDomain = domains.find(d => senderEmailLower.endsWith("@" + d) || senderEmailLower.endsWith("." + d));
      if (matchedDomain) {
        senderMatches.push({ ...email, matchedRule: matchedDomain, matchType: 'domain' });
      }
    }

    res.json({ flagged, keywordMatches, senderMatches, rules });
  } catch (err: any) {
    if (err.message?.includes("not connected") || err.message?.includes("not available")) {
      return res.json({ flagged: [], keywordMatches: [], senderMatches: [], rules: [] });
    }
    res.status(500).json({ error: err.message });
  }
});

// ==================== UNCLASSIFIED TASKS ====================

router.get("/api/mytool/unclassified-tasks", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { mytoolTasks: mytoolTasksTable } = await import("@shared/schema");
    const tasks = await db.select().from(mytoolTasksTable)
      .where(
        or(
          isNull(mytoolTasksTable.bucket),
          and(eq(mytoolTasksTable.bucket, 'project'), isNull(mytoolTasksTable.projectName))
        )
      );
    res.json(tasks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Microsoft Account Mapping ───

const COO_ROLES = ["COO_ADMIN", "CEO_ADMIN", "admin"];

router.get("/api/admin/users/microsoft-mapping", requireAuth, async (req, res) => {
  try {
    const userRole = (req.user as any).role;
    if (!COO_ROLES.includes(userRole)) return res.status(403).json({ error: "Admin access required" });

    const { users: usersTable } = await import("@shared/schema");
    const allUsers = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      username: usersTable.username,
      email: usersTable.email,
      role: usersTable.role,
      microsoftId: usersTable.microsoft_id,
    }).from(usersTable).orderBy(usersTable.name);

    res.json(allUsers);
  } catch (err: any) {
    console.error("[MS Mapping] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/admin/users/:id/microsoft-id", requireAuth, async (req, res) => {
  try {
    const userRole = (req.user as any).role;
    if (!COO_ROLES.includes(userRole)) return res.status(403).json({ error: "Admin access required" });

    const userId = parseInt(req.params.id);
    const { microsoftId, email } = req.body;

    const { users: usersTable } = await import("@shared/schema");
    await db.update(usersTable)
      .set({
        microsoft_id: microsoftId || null,
        ...(email ? { email } : {}),
      })
      .where(eq(usersTable.id, userId));

    res.json({ success: true });
  } catch (err: any) {
    console.error("[MS Mapping] Update error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Teams Chat Groups ───

router.get("/api/teams/groups", requireAuth, async (req, res) => {
  try {
    const { teamsChatGroups, teamsChatMembers, users: usersTable } = await import("@shared/schema");
    const userId = (req.user as any).id;
    const userRole = (req.user as any).role;
    const isCoo = COO_ROLES.includes(userRole);

    const allGroups = await db.select().from(teamsChatGroups).orderBy(teamsChatGroups.groupType, teamsChatGroups.name);

    const members = await db.select({
      id: teamsChatMembers.id,
      groupId: teamsChatMembers.groupId,
      userId: teamsChatMembers.userId,
      role: teamsChatMembers.role,
      addedAt: teamsChatMembers.addedAt,
      userName: usersTable.name,
      userRole: usersTable.role,
      userEmail: usersTable.email,
    })
      .from(teamsChatMembers)
      .innerJoin(usersTable, eq(teamsChatMembers.userId, usersTable.id));

    const membersByGroup: Record<number, any[]> = {};
    for (const m of members) {
      if (!membersByGroup[m.groupId]) membersByGroup[m.groupId] = [];
      membersByGroup[m.groupId].push(m);
    }

    const groups = allGroups.map(g => {
      const groupMembers = membersByGroup[g.id] || [];
      const isMember = groupMembers.some(m => m.userId === userId);
      const isGroupAdmin = groupMembers.some(m => m.userId === userId && m.role === "admin");
      return {
        ...g,
        members: groupMembers,
        memberCount: groupMembers.length,
        isMember,
        isGroupAdmin,
        canManage: isCoo || isGroupAdmin || g.createdBy === userId,
      };
    });

    res.json(groups);
  } catch (err: any) {
    console.error("[Teams Groups] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/teams/groups", requireAuth, async (req, res) => {
  try {
    const { teamsChatGroups, teamsChatMembers } = await import("@shared/schema");
    const userId = (req.user as any).id;
    const userRole = (req.user as any).role;
    const isCoo = COO_ROLES.includes(userRole);

    const { name, groupType, department, projectName, projectId, description } = req.body;

    if (!name || !groupType) {
      return res.status(400).json({ error: "name and groupType are required" });
    }

    if (groupType === "project" && !isCoo) {
      const { projectInfo: piTable } = await import("@shared/schema");
      if (projectName) {
        const proj = await db.select().from(piTable)
          .where(eq(piTable.projectName, projectName)).limit(1);
        if (proj.length > 0 && proj[0].pmUserId !== userId) {
          return res.status(403).json({ error: "Only the PM or COO can create project groups" });
        }
      }
    }

    const [group] = await db.insert(teamsChatGroups).values({
      name,
      groupType,
      department: department || null,
      projectName: projectName || null,
      projectId: projectId || null,
      description: description || null,
      createdBy: userId,
    }).returning();

    await db.insert(teamsChatMembers).values({
      groupId: group.id,
      userId,
      role: "admin",
      addedBy: userId,
    });

    res.json(group);
  } catch (err: any) {
    console.error("[Teams Groups] Create error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/teams/groups/:id", requireAuth, async (req, res) => {
  try {
    const { teamsChatGroups, teamsChatMembers } = await import("@shared/schema");
    const groupId = parseInt(req.params.id);
    const userId = (req.user as any).id;
    const userRole = (req.user as any).role;
    const isCoo = COO_ROLES.includes(userRole);

    const [group] = await db.select().from(teamsChatGroups).where(eq(teamsChatGroups.id, groupId));
    if (!group) return res.status(404).json({ error: "Group not found" });

    if (!isCoo && group.createdBy !== userId) {
      const adminMember = await db.select().from(teamsChatMembers)
        .where(and(eq(teamsChatMembers.groupId, groupId), eq(teamsChatMembers.userId, userId), eq(teamsChatMembers.role, "admin")));
      if (adminMember.length === 0) {
        return res.status(403).json({ error: "Only group admin or COO can delete groups" });
      }
    }

    await db.delete(teamsChatGroups).where(eq(teamsChatGroups.id, groupId));
    res.json({ success: true });
  } catch (err: any) {
    console.error("[Teams Groups] Delete error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/teams/groups/:id/members", requireAuth, async (req, res) => {
  try {
    const { teamsChatGroups, teamsChatMembers } = await import("@shared/schema");
    const groupId = parseInt(req.params.id);
    const actingUserId = (req.user as any).id;
    const actingRole = (req.user as any).role;
    const isCoo = COO_ROLES.includes(actingRole);

    const [group] = await db.select().from(teamsChatGroups).where(eq(teamsChatGroups.id, groupId));
    if (!group) return res.status(404).json({ error: "Group not found" });

    if (!isCoo && group.createdBy !== actingUserId) {
      const adminCheck = await db.select().from(teamsChatMembers)
        .where(and(eq(teamsChatMembers.groupId, groupId), eq(teamsChatMembers.userId, actingUserId), eq(teamsChatMembers.role, "admin")));
      if (adminCheck.length === 0) {
        if (group.groupType === "project") {
          const { projectInfo: piTable } = await import("@shared/schema");
          if (group.projectName) {
            const proj = await db.select().from(piTable)
              .where(eq(piTable.projectName, group.projectName)).limit(1);
            if (proj.length === 0 || proj[0].pmUserId !== actingUserId) {
              return res.status(403).json({ error: "Only the PM, group admin, or COO can manage members" });
            }
          } else {
            return res.status(403).json({ error: "Only group admin or COO can manage members" });
          }
        } else {
          return res.status(403).json({ error: "Only group admin or COO can manage members" });
        }
      }
    }

    const { userIds, role: memberRole } = req.body;
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "userIds array is required" });
    }

    const results = [];
    for (const uid of userIds) {
      try {
        const [member] = await db.insert(teamsChatMembers).values({
          groupId,
          userId: uid,
          role: memberRole || "member",
          addedBy: actingUserId,
        }).onConflictDoNothing().returning();
        if (member) results.push(member);
      } catch {}
    }

    res.json({ added: results.length });
  } catch (err: any) {
    console.error("[Teams Groups] Add members error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/teams/groups/:id/members/:userId", requireAuth, async (req, res) => {
  try {
    const { teamsChatGroups, teamsChatMembers } = await import("@shared/schema");
    const groupId = parseInt(req.params.id);
    const targetUserId = parseInt(req.params.userId);
    const actingUserId = (req.user as any).id;
    const actingRole = (req.user as any).role;
    const isCoo = COO_ROLES.includes(actingRole);

    if (!isCoo && actingUserId !== targetUserId) {
      const [group] = await db.select().from(teamsChatGroups).where(eq(teamsChatGroups.id, groupId));
      if (!group) return res.status(404).json({ error: "Group not found" });

      const adminCheck = await db.select().from(teamsChatMembers)
        .where(and(eq(teamsChatMembers.groupId, groupId), eq(teamsChatMembers.userId, actingUserId), eq(teamsChatMembers.role, "admin")));
      if (adminCheck.length === 0 && group.createdBy !== actingUserId) {
        if (group.groupType === "project" && group.projectName) {
          const { projectInfo: piTable } = await import("@shared/schema");
          const proj = await db.select().from(piTable)
            .where(eq(piTable.projectName, group.projectName)).limit(1);
          if (proj.length === 0 || proj[0].pmUserId !== actingUserId) {
            return res.status(403).json({ error: "Not authorized to remove members" });
          }
        } else {
          return res.status(403).json({ error: "Not authorized to remove members" });
        }
      }
    }

    await db.delete(teamsChatMembers)
      .where(and(eq(teamsChatMembers.groupId, groupId), eq(teamsChatMembers.userId, targetUserId)));
    res.json({ success: true });
  } catch (err: any) {
    console.error("[Teams Groups] Remove member error:", err);
    res.status(500).json({ error: err.message });
  }
});

async function checkGroupMembership(groupId: number, userId: number): Promise<boolean> {
  const { teamsChatMembers } = await import("@shared/schema");
  const membership = await db.select().from(teamsChatMembers)
    .where(and(eq(teamsChatMembers.groupId, groupId), eq(teamsChatMembers.userId, userId)))
    .limit(1);
  return membership.length > 0;
}

router.get("/api/teams/groups/:id/messages", requireAuth, async (req, res) => {
  try {
    const { teamsChatMessages, users: usersTable } = await import("@shared/schema");
    const groupId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit as string) || 50;

    const messages = await db.select({
      id: teamsChatMessages.id,
      groupId: teamsChatMessages.groupId,
      content: teamsChatMessages.content,
      senderName: teamsChatMessages.senderName,
      senderUserId: teamsChatMessages.senderUserId,
      teamsMessageId: teamsChatMessages.teamsMessageId,
      isFromTeams: teamsChatMessages.isFromTeams,
      fileName: teamsChatMessages.fileName,
      filePath: teamsChatMessages.filePath,
      fileSize: teamsChatMessages.fileSize,
      fileType: teamsChatMessages.fileType,
      createdAt: teamsChatMessages.createdAt,
      userName: usersTable.name,
    })
      .from(teamsChatMessages)
      .leftJoin(usersTable, eq(teamsChatMessages.senderUserId, usersTable.id))
      .where(eq(teamsChatMessages.groupId, groupId))
      .orderBy(sql`${teamsChatMessages.createdAt} DESC`)
      .limit(limit);

    res.json(messages.reverse());
  } catch (err: any) {
    console.error("[Teams Groups] Messages error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/teams/groups/:id/messages", requireAuth, async (req, res) => {
  try {
    const { teamsChatMessages } = await import("@shared/schema");
    const groupId = parseInt(req.params.id);
    const userId = (req.user as any).id;
    const userName = (req.user as any).name;
    const userRole = (req.user as any).role;
    const { content } = req.body;

    if (!content?.trim()) {
      return res.status(400).json({ error: "content is required" });
    }

    const isCoo = COO_ROLES.includes(userRole);
    if (!isCoo) {
      const isMember = await checkGroupMembership(groupId, userId);
      if (!isMember) return res.status(403).json({ error: "You must be a member of this channel to send messages" });
    }

    const [msg] = await db.insert(teamsChatMessages).values({
      groupId,
      senderUserId: userId,
      senderName: userName,
      content: content.trim(),
      isFromTeams: false,
    }).returning();

    res.json(msg);
  } catch (err: any) {
    console.error("[Teams Groups] Send message error:", err);
    res.status(500).json({ error: err.message });
  }
});

const chatUploadDir = path.join(process.cwd(), "uploads", "chat-files");
const chatStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(chatUploadDir)) fs.mkdirSync(chatUploadDir, { recursive: true });
    cb(null, chatUploadDir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}-${file.originalname}`);
  },
});
const chatUpload = multer({ storage: chatStorage, limits: { fileSize: 25 * 1024 * 1024 } });

router.post("/api/teams/groups/:id/files", requireAuth, chatUpload.single("file"), async (req: any, res) => {
  try {
    const { teamsChatMessages } = await import("@shared/schema");
    const groupId = parseInt(req.params.id);
    const userId = (req.user as any).id;
    const userName = (req.user as any).name;
    const userRole = (req.user as any).role;
    const file = req.file;

    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const isCoo = COO_ROLES.includes(userRole);
    if (!isCoo) {
      const isMember = await checkGroupMembership(groupId, userId);
      if (!isMember) return res.status(403).json({ error: "You must be a member of this channel to upload files" });
    }

    const [msg] = await db.insert(teamsChatMessages).values({
      groupId,
      senderUserId: userId,
      senderName: userName,
      content: req.body.content?.trim() || `Shared a file: ${file.originalname}`,
      isFromTeams: false,
      fileName: file.originalname,
      filePath: `/uploads/chat-files/${file.filename}`,
      fileSize: file.size,
      fileType: file.mimetype,
    }).returning();

    res.json(msg);
  } catch (err: any) {
    console.error("[Teams Groups] File upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/teams/project-group/:projectName", requireAuth, async (req, res) => {
  try {
    const { teamsChatGroups, teamsChatMembers, users: usersTable, projectInfo: piTable } = await import("@shared/schema");
    const pName = decodeURIComponent(req.params.projectName);
    const userId = (req.user as any).id;
    const userRole = (req.user as any).role;
    const isCoo = COO_ROLES.includes(userRole);

    if (!isCoo) {
      const [proj] = await db.select().from(piTable).where(eq(piTable.projectName, pName)).limit(1);
      if (!proj) return res.status(404).json({ error: "Project not found" });
      const userName = (req.user as any).name || (req.user as any).username || "";
      const isPmOrPd = proj.pmUserId === userId || (proj.pd && proj.pd.toLowerCase() === userName.toLowerCase());
      const existingGroup = await db.select().from(teamsChatGroups)
        .where(and(eq(teamsChatGroups.groupType, "project"), eq(teamsChatGroups.projectName, pName)))
        .limit(1);
      if (existingGroup.length > 0) {
        const memberCheck = await db.select().from(teamsChatMembers)
          .where(and(eq(teamsChatMembers.groupId, existingGroup[0].id), eq(teamsChatMembers.userId, userId)))
          .limit(1);
        if (!isPmOrPd && memberCheck.length === 0) {
          return res.status(403).json({ error: "You don't have access to this project chat" });
        }
      } else if (!isPmOrPd) {
        return res.status(403).json({ error: "Only the PM or PD can start a project chat" });
      }
    }

    let [group] = await db.select().from(teamsChatGroups)
      .where(and(eq(teamsChatGroups.groupType, "project"), eq(teamsChatGroups.projectName, pName)))
      .limit(1);

    if (!group) {
      [group] = await db.insert(teamsChatGroups).values({
        name: `${pName} — Project Chat`,
        groupType: "project",
        projectName: pName,
        description: `Auto-created project chat for ${pName}`,
        createdBy: userId,
      }).returning();

      await db.insert(teamsChatMembers).values({
        groupId: group.id,
        userId,
        role: "admin",
        addedBy: userId,
      });
    }

    const members = await db.select({
      id: teamsChatMembers.id,
      groupId: teamsChatMembers.groupId,
      userId: teamsChatMembers.userId,
      role: teamsChatMembers.role,
      addedAt: teamsChatMembers.addedAt,
      userName: usersTable.name,
      userRole: usersTable.role,
    })
      .from(teamsChatMembers)
      .innerJoin(usersTable, eq(teamsChatMembers.userId, usersTable.id))
      .where(eq(teamsChatMembers.groupId, group.id));

    const isMember = members.some(m => m.userId === userId);

    if (!isMember) {
      await db.insert(teamsChatMembers).values({
        groupId: group.id,
        userId,
        role: "member",
        addedBy: userId,
      }).onConflictDoNothing();
    }

    res.json({
      ...group,
      members,
      memberCount: members.length + (isMember ? 0 : 1),
      isMember: true,
    });
  } catch (err: any) {
    console.error("[Teams Project Group] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/sp-config", requireAuth, async (req, res) => {
  try {
    const settings = await storage.getSpSettings();
    if (!settings) return res.json(null);
    res.json({
      driveId: settings.driveId,
      folderItemId: settings.folderItemId,
      folderPath: settings.folderPath,
      enabled: settings.enabled,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/sp-project-browse", requireAuth, async (req, res) => {
  try {
    const driveId = req.query.driveId as string;
    const folderId = req.query.folderId as string | undefined;
    if (!driveId) {
      return res.status(400).json({ error: "driveId is required" });
    }
    const { browseFolders } = await import("../sharepoint");
    const items = await browseFolders(driveId, folderId || undefined);
    res.json(items);
  } catch (err: any) {
    console.error("[SP Browse] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/sp-project-files", requireAuth, async (req, res) => {
  try {
    const driveId = req.query.driveId as string;
    const folderId = req.query.folderId as string;
    if (!driveId || !folderId) {
      return res.status(400).json({ error: "driveId and folderId are required" });
    }
    const { getAccessToken } = await import("../sharepoint");
    const token = await getAccessToken();
    const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}/children`;
    const graphRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!graphRes.ok) {
      const text = await graphRes.text();
      throw new Error(`Graph API ${graphRes.status}: ${text}`);
    }
    const data = await graphRes.json();
    const items = (data.value || []).map((item: any) => ({
      id: item.id,
      name: item.name,
      size: item.size,
      lastModified: item.lastModifiedDateTime,
      isFolder: !!item.folder,
      childCount: item.folder?.childCount ?? 0,
      webUrl: item.webUrl,
      mimeType: item.file?.mimeType,
      downloadUrl: item["@microsoft.graph.downloadUrl"],
    }));
    res.json(items);
  } catch (err: any) {
    console.error("[SP Files] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

export function registerExcoRoutes(app: Express) {
  app.use(router);
}
