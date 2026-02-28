import { Router, type Express, type Request, type Response } from "express";
import { requireAuth, requireAdmin, requirePriorityAdmin } from './shared-middleware';
import { storage } from "../storage";
import { db } from "../db";
import { requirePermission } from "../permission-middleware";
import { eq, and, or, sql, isNull } from "drizzle-orm";
import { projectInfo } from "@shared/schema";

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
    const enriched = priorities.map(p => ({ ...p, links: linksByPriority[p.id] || [] }));
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
    const events = await outlook.getCalendarEvents(start as string, end as string);
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

      if (assigneeUserId && parseInt(String(assigneeUserId)) !== userId) {
        try {
          const { notifications } = await import("@shared/schema");
          await db.insert(notifications).values({
            recipientUserId: parseInt(String(assigneeUserId)),
            eventType: "task.assigned",
            title: `New task assigned: ${subject}`,
            body: `You've been assigned a task from ${sourceLabel}: "${subject}" on project ${projectName}`,
            projectName,
            linkedTaskId: opTask.id,
            isRead: false,
          });
        } catch (notifErr) {
          console.error("[Email-to-task] Notification error:", notifErr);
        }
      }
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

// ==================== COO COCKPIT ====================

router.get("/api/exec/cockpit", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projects = await db.select().from(projectInfo)
      .where(eq(projectInfo.isActive, true));

    const { qcWarning } = await import("@shared/schema");

    const allWarnings = await db.select({
      id: qcWarning.id,
      severity: qcWarning.severity,
      projectName: qcWarning.projectName,
      title: qcWarning.title,
      status: qcWarning.status,
    }).from(qcWarning).where(eq(qcWarning.status, "open"));

    const highWarnings = allWarnings.filter(w =>
      w.severity === "High" || w.severity === "HIGH"
    );

    const projectsAtRisk = projects.filter(p => {
      const cleanName = p.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
      return highWarnings.some(w => w.projectName === cleanName);
    }).map(p => {
      const cleanName = p.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
      const warnings = highWarnings.filter(w => w.projectName === cleanName);
      return {
        id: p.id,
        projectName: cleanName,
        phase: p.phase || "P0_FIRST_ASSESSMENT",
        warningCount: warnings.length,
        warnings: warnings.slice(0, 5).map(w => ({ title: w.title, severity: w.severity })),
      };
    });

    const { mytoolTasks: mytoolTasksTable } = await import("@shared/schema");
    const overdueTasks = await db.select().from(mytoolTasksTable)
      .where(
        and(
          sql`${mytoolTasksTable.dueAt} < NOW()`,
          sql`${mytoolTasksTable.status} NOT IN ('done', 'cancelled')`,
        )
      );

    const overdueByOwner: Record<string, any[]> = {};
    for (const t of overdueTasks) {
      const owner = String(t.ownerUserId);
      if (!overdueByOwner[owner]) overdueByOwner[owner] = [];
      overdueByOwner[owner].push({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt,
        status: t.status,
        projectName: t.projectName,
      });
    }

    const { operationalTasks: opTasksTable } = await import("@shared/schema");
    const upcomingMilestones = await db.select().from(opTasksTable)
      .where(
        and(
          sql`${opTasksTable.dueDate} IS NOT NULL AND ${opTasksTable.dueDate} != ''`,
          sql`${opTasksTable.dueDate}::date >= CURRENT_DATE`,
          sql`${opTasksTable.dueDate}::date <= CURRENT_DATE + INTERVAL '14 days'`,
          sql`${opTasksTable.status} != 'Complete'`,
        )
      );

    const milestones = upcomingMilestones.map(m => ({
      id: m.id,
      title: m.title,
      projectName: m.projectName,
      dueDate: m.dueDate,
      status: m.status,
      priority: m.priority,
    }));

    res.json({
      projectsAtRisk,
      milestones,
      overdueByOwner,
      overdueTotalCount: overdueTasks.length,
      totalProjects: projects.length,
      totalOpenWarnings: allWarnings.length,
      totalHighWarnings: highWarnings.length,
    });
  } catch (err: any) {
    console.error("[Cockpit] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

export function registerExcoRoutes(app: Express) {
  app.use(router);
}
