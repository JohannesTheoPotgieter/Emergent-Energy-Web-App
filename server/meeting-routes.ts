import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, desc, sql } from "drizzle-orm";
import { verifyToken } from "./jwt";
import {
  meetingSummaries,
  meetingActionItems,
  mytoolTasks,
  mytoolCompanyPriorities,
  projectInfo,
} from "@shared/schema";
import { z } from "zod";

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  if (req.isAuthenticated?.()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload) {
      (req as any).user = { id: payload.userId, email: payload.email, name: payload.name, role: payload.role };
    }
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.() || (req as any).user) return next();
  res.status(401).json({ error: "auth_required" });
}

const ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN", "admin"];

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = ((req as any).user as any)?.role || "";
  if (ADMIN_ROLES.includes(role)) return next();
  res.status(403).json({ error: "forbidden" });
}

export function registerMeetingRoutes(app: Express) {

  // ==================== WEBHOOK - Read.ai ====================
  app.post("/api/webhooks/read-ai", async (req: Request, res: Response) => {
    try {
      const body = req.body;

      const title = body.title || body.meeting_title || "Untitled Meeting";
      const externalId = body.meeting_id || body.id || null;
      const startTime = body.start_time ? new Date(body.start_time) : null;
      const endTime = body.end_time ? new Date(body.end_time) : null;
      const participants: string[] = [];
      if (Array.isArray(body.participants)) {
        for (const p of body.participants) {
          if (typeof p === "string") participants.push(p);
          else if (p?.name) participants.push(p.name);
          else if (p?.email) participants.push(p.email);
        }
      }
      const summary = body.summary || body.meeting_summary || null;
      const reportUrl = body.report_url || body.reportUrl || null;

      const [meeting] = await db
        .insert(meetingSummaries)
        .values({
          externalMeetingId: externalId,
          title,
          startTime,
          endTime,
          participants,
          summary,
          reportUrl,
          source: "read_ai",
          rawPayload: JSON.stringify(body),
        })
        .returning();

      const actionItems: Array<{ text: string; owner?: string; dueDate?: string }> = [];
      const rawItems = body.action_items || body.actionItems || body.tasks || [];
      for (const item of rawItems) {
        if (typeof item === "string") {
          actionItems.push({ text: item });
        } else if (item?.text || item?.description || item?.title) {
          actionItems.push({
            text: item.text || item.description || item.title,
            owner: item.owner || item.assignee || item.assigned_to || null,
            dueDate: item.due_date || item.dueDate || item.deadline || null,
          });
        }
      }

      if (actionItems.length > 0) {
        await db.insert(meetingActionItems).values(
          actionItems.map((ai) => ({
            meetingId: meeting.id,
            text: ai.text,
            owner: ai.owner || null,
            dueDate: ai.dueDate || null,
          }))
        );
      }

      res.status(200).json({ status: "ok", meetingId: meeting.id, actionItemCount: actionItems.length });
    } catch (err: any) {
      console.error("[Read.ai Webhook] Error:", err.message);
      res.status(500).json({ error: "webhook_processing_failed" });
    }
  });

  // ==================== MEETING MANAGEMENT ====================
  app.use("/api/meetings", jwtAuth);

  app.get("/api/meetings", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const meetings = await db
        .select()
        .from(meetingSummaries)
        .orderBy(desc(meetingSummaries.createdAt))
        .limit(50);

      const meetingIds = meetings.map((m) => m.id);
      let allItems: any[] = [];
      if (meetingIds.length > 0) {
        allItems = await db
          .select()
          .from(meetingActionItems)
          .where(sql`${meetingActionItems.meetingId} = ANY(${meetingIds})`);
      }

      const result = meetings.map((m) => {
        let keyTopics: string[] = [];
        let highlights: string[] = [];
        if (m.rawPayload) {
          try {
            const payload = JSON.parse(m.rawPayload);
            if (Array.isArray(payload.key_topics)) keyTopics = payload.key_topics;
            else if (Array.isArray(payload.topics)) keyTopics = payload.topics.map((t: any) => typeof t === 'string' ? t : t?.name || t?.topic || '');
            if (Array.isArray(payload.highlights)) highlights = payload.highlights.map((h: any) => typeof h === 'string' ? h : h?.text || '');
            else if (Array.isArray(payload.key_points)) highlights = payload.key_points;
            else if (Array.isArray(payload.important_points)) highlights = payload.important_points;
          } catch {}
        }
        return {
          ...m,
          rawPayload: undefined,
          keyTopics: keyTopics.filter(Boolean),
          highlights: highlights.filter(Boolean),
          actionItems: allItems.filter((ai) => ai.meetingId === m.id),
        };
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/meetings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const [meeting] = await db.select().from(meetingSummaries).where(eq(meetingSummaries.id, id));
      if (!meeting) return res.status(404).json({ error: "Meeting not found" });

      const items = await db.select().from(meetingActionItems).where(eq(meetingActionItems.meetingId, id));

      let keyTopics: string[] = [];
      let highlights: string[] = [];
      if (meeting.rawPayload) {
        try {
          const payload = JSON.parse(meeting.rawPayload);
          if (Array.isArray(payload.key_topics)) keyTopics = payload.key_topics;
          else if (Array.isArray(payload.topics)) keyTopics = payload.topics.map((t: any) => typeof t === 'string' ? t : t?.name || t?.topic || '');
          if (Array.isArray(payload.highlights)) highlights = payload.highlights.map((h: any) => typeof h === 'string' ? h : h?.text || '');
          else if (Array.isArray(payload.key_points)) highlights = payload.key_points;
          else if (Array.isArray(payload.important_points)) highlights = payload.important_points;
        } catch {}
      }

      res.json({
        ...meeting,
        rawPayload: undefined,
        keyTopics: keyTopics.filter(Boolean),
        highlights: highlights.filter(Boolean),
        actionItems: items,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/meetings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(meetingSummaries).where(eq(meetingSummaries.id, id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== ACTION ITEM MANAGEMENT ====================

  app.patch("/api/meetings/action-items/:id/dismiss", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const [updated] = await db
        .update(meetingActionItems)
        .set({ status: "dismissed" })
        .where(eq(meetingActionItems.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: "Action item not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== CONVERSION ENDPOINTS ====================

  app.post("/api/meetings/action-items/:id/convert-to-task", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const actionItemId = parseInt(req.params.id);
      const userId = (req as any).user.id;

      const [actionItem] = await db.select().from(meetingActionItems).where(eq(meetingActionItems.id, actionItemId));
      if (!actionItem) return res.status(404).json({ error: "Action item not found" });
      if (actionItem.status === "converted") return res.status(400).json({ error: "Already converted" });

      const [meeting] = await db.select().from(meetingSummaries).where(eq(meetingSummaries.id, actionItem.meetingId));

      const overrides = req.body || {};

      const [task] = await db
        .insert(mytoolTasks)
        .values({
          ownerUserId: userId,
          title: overrides.title || actionItem.text,
          status: "inbox",
          priority: overrides.priority || "normal",
          plannedForDate: overrides.plannedForDate || null,
          dueAt: actionItem.dueDate ? new Date(actionItem.dueDate) : null,
          notes: `From meeting: ${meeting?.title || "Unknown"}\nOwner: ${actionItem.owner || "Unassigned"}${overrides.notes ? "\n" + overrides.notes : ""}`,
          bucket: overrides.bucket || "company_ops",
          projectName: overrides.projectName || null,
          department: overrides.department || null,
        })
        .returning();

      await db
        .update(meetingActionItems)
        .set({ status: "converted", convertedToType: "mytool_task", convertedToId: task.id })
        .where(eq(meetingActionItems.id, actionItemId));

      res.json({ task, actionItem: { id: actionItemId, status: "converted", convertedToType: "mytool_task", convertedToId: task.id } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/meetings/action-items/:id/convert-to-priority", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const actionItemId = parseInt(req.params.id);
      const [actionItem] = await db.select().from(meetingActionItems).where(eq(meetingActionItems.id, actionItemId));
      if (!actionItem) return res.status(404).json({ error: "Action item not found" });
      if (actionItem.status === "converted") return res.status(400).json({ error: "Already converted" });

      const [meeting] = await db.select().from(meetingSummaries).where(eq(meetingSummaries.id, actionItem.meetingId));
      const overrides = req.body || {};

      const [priority] = await db
        .insert(mytoolCompanyPriorities)
        .values({
          title: overrides.title || actionItem.text,
          description: `From meeting: ${meeting?.title || "Unknown"}\nOwner: ${actionItem.owner || "Unassigned"}${overrides.description ? "\n" + overrides.description : ""}`,
          department: overrides.department || null,
          horizon: overrides.horizon || "week",
          ownerRole: overrides.ownerRole || null,
          severity: overrides.severity || "normal",
          status: "active",
          dueDate: actionItem.dueDate || overrides.dueDate || null,
        })
        .returning();

      await db
        .update(meetingActionItems)
        .set({ status: "converted", convertedToType: "company_priority", convertedToId: priority.id })
        .where(eq(meetingActionItems.id, actionItemId));

      res.json({ priority, actionItem: { id: actionItemId, status: "converted", convertedToType: "company_priority", convertedToId: priority.id } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/meetings/action-items/:id/convert-to-project", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const actionItemId = parseInt(req.params.id);
      const [actionItem] = await db.select().from(meetingActionItems).where(eq(meetingActionItems.id, actionItemId));
      if (!actionItem) return res.status(404).json({ error: "Action item not found" });
      if (actionItem.status === "converted") return res.status(400).json({ error: "Already converted" });

      const overrides = req.body || {};
      const projectName = overrides.projectName || actionItem.text.substring(0, 100);

      const [project] = await db
        .insert(projectInfo)
        .values({
          projectName,
          sizeKwp: overrides.sizeKwp || null,
          pd: overrides.pd || actionItem.owner || null,
          pm: overrides.pm || null,
        })
        .returning();

      await db
        .update(meetingActionItems)
        .set({ status: "converted", convertedToType: "project", convertedToId: project.id })
        .where(eq(meetingActionItems.id, actionItemId));

      res.json({ project, actionItem: { id: actionItemId, status: "converted", convertedToType: "project", convertedToId: project.id } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MANUAL MEETING ENTRY ====================
  app.post("/api/meetings/manual", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const body = req.body;
      const schema = z.object({
        title: z.string().min(1),
        summary: z.string().optional(),
        participants: z.array(z.string()).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        actionItems: z.array(z.object({
          text: z.string().min(1),
          owner: z.string().optional(),
          dueDate: z.string().optional(),
        })).optional(),
      });

      const parsed = schema.parse(body);

      const [meeting] = await db
        .insert(meetingSummaries)
        .values({
          title: parsed.title,
          summary: parsed.summary || null,
          participants: parsed.participants || [],
          startTime: parsed.startTime ? new Date(parsed.startTime) : null,
          endTime: parsed.endTime ? new Date(parsed.endTime) : null,
          source: "manual",
        })
        .returning();

      if (parsed.actionItems && parsed.actionItems.length > 0) {
        await db.insert(meetingActionItems).values(
          parsed.actionItems.map((ai) => ({
            meetingId: meeting.id,
            text: ai.text,
            owner: ai.owner || null,
            dueDate: ai.dueDate || null,
          }))
        );
      }

      const items = await db.select().from(meetingActionItems).where(eq(meetingActionItems.meetingId, meeting.id));
      res.json({ ...meeting, actionItems: items });
    } catch (err: any) {
      if (err.name === "ZodError") return res.status(400).json({ error: "Validation failed", details: err.errors });
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== WEBHOOK STATUS ====================
  app.get("/api/meetings/webhook-status", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const [stats] = await db
        .select({
          totalMeetings: sql<number>`count(*)::int`,
          webhookMeetings: sql<number>`count(*) filter (where ${meetingSummaries.source} = 'read_ai')::int`,
          lastWebhookAt: sql<string>`max(${meetingSummaries.createdAt}) filter (where ${meetingSummaries.source} = 'read_ai')`,
          totalActionItems: sql<number>`(select count(*)::int from ${meetingActionItems})`,
          pendingItems: sql<number>`(select count(*)::int from ${meetingActionItems} where ${meetingActionItems.status} = 'pending')`,
          convertedItems: sql<number>`(select count(*)::int from ${meetingActionItems} where ${meetingActionItems.status} = 'converted')`,
        })
        .from(meetingSummaries);

      const connected = (stats?.webhookMeetings ?? 0) > 0;
      res.json({
        connected,
        totalMeetings: stats?.totalMeetings ?? 0,
        webhookMeetings: stats?.webhookMeetings ?? 0,
        lastWebhookAt: stats?.lastWebhookAt ?? null,
        totalActionItems: stats?.totalActionItems ?? 0,
        pendingItems: stats?.pendingItems ?? 0,
        convertedItems: stats?.convertedItems ?? 0,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== TEST WEBHOOK ====================
  app.post("/api/meetings/test-webhook", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const testPayload = {
        meeting_id: `test_${Date.now()}`,
        title: "Test Meeting - Connection Verification",
        start_time: new Date().toISOString(),
        end_time: new Date(Date.now() + 3600000).toISOString(),
        participants: [{ name: "System Test" }],
        summary: "This is an automated test to verify the webhook connection is working correctly. You can safely delete this meeting.",
        report_url: null,
        action_items: [
          { text: "Webhook test action item - verify this appears", owner: "System", due_date: null },
        ],
      };

      const [meeting] = await db
        .insert(meetingSummaries)
        .values({
          externalMeetingId: testPayload.meeting_id,
          title: testPayload.title,
          startTime: new Date(testPayload.start_time),
          endTime: new Date(testPayload.end_time),
          participants: ["System Test"],
          summary: testPayload.summary,
          source: "test",
          rawPayload: JSON.stringify(testPayload),
        })
        .returning();

      await db.insert(meetingActionItems).values({
        meetingId: meeting.id,
        text: testPayload.action_items[0].text,
        owner: testPayload.action_items[0].owner,
      });

      res.json({ ok: true, meetingId: meeting.id, message: "Test meeting created successfully" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== WEBHOOK INFO (legacy) ====================
  app.get("/api/meetings/webhook-info", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const host = req.headers.host || req.hostname;
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const webhookUrl = `${protocol}://${host}/api/webhooks/read-ai`;
      res.json({ webhookUrl });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
