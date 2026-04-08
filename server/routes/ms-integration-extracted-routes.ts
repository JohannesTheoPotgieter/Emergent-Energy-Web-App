/**
 * MS Integration Routes — Extracted from server/routes.ts (Phase 2)
 *
 * 23 handlers covering:
 *   - Outlook status/refresh (2)
 *   - MS integration status (1)
 *   - Outlook calendar events CRUD (4)
 *   - Outlook messages (2)
 *   - Outlook email-to-task (1)
 *   - Outlook send-approval (1)
 *   - Outlook folders (1)
 *   - Outlook send/reply/forward (3)
 *   - MS Teams joined/chats/messages (6)
 *   - SharePoint discover-sites/site-drives (2)
 *
 * External dependencies: ./outlook, ./ms-account-service
 * Storage coupling: email-to-task handler only (createOperationalTask, createMytoolTask, createEmailLink)
 */

import type { Express } from "express";
import { paramStr } from "../lib/req-params";
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { logAuditFromReq } from "../audit-logger";

// ── SSO helpers (moved from routes.ts) ──

async function getUserSsoToken(req: any): Promise<string | null> {
  const userId = req.user?.id || req.user?.userId;
  if (!userId) return null;
  try {
    const { getSsoTokenForUser } = await import("../ms-account-service");
    return await getSsoTokenForUser(userId);
  } catch {
    return null;
  }
}

async function userHasMsAccount(req: any): Promise<boolean> {
  const userId = req.user?.id || req.user?.userId;
  if (!userId) return false;
  try {
    const { getMsAccountForUser } = await import("../ms-account-service");
    const account = await getMsAccountForUser(userId);
    return !!(account && account.status === "active");
  } catch {
    return false;
  }
}

// ── Main registration function ──

export async function registerMsIntegrationRoutes(app: Express): Promise<void> {

  const outlook = await import("../outlook");

  // ==================== OUTLOOK STATUS ====================

  app.get("/api/outlook/status", requireAuth, async (req, res) => {
    try {
      const status = await outlook.getConnectionStatus();
      res.json(status);
    } catch (err: any) {
      res.json({ configured: false, connected: false });
    }
  });

  app.post("/api/outlook/refresh", requireAuth, async (req, res) => {
    try {
      outlook.clearCachedToken();
      const status = await outlook.getConnectionStatus();
      res.json(status);
    } catch (err: any) {
      res.json({ configured: false, connected: false, error: err.message });
    }
  });

  // ==================== MS INTEGRATION STATUS ====================

  app.get("/api/ms-integration/status", requireAuth, async (req, res) => {
    try {
      const outlookStatus = await outlook.getConnectionStatus();

      let config: Record<string, any> = {};
      try {
        const rows = await db.execute(sql`SELECT config_key, config_value FROM ms_integration_settings`);
        for (const row of rows.rows) {
          config[row.config_key as string] = row.config_value;
        }
      } catch {}

      const featureFlags = config.feature_flags || {};
      const spConfig = config.sharepoint_project_docs || {};
      const teamsConfig = config.teams_config || {};

      res.json({
        outlook: {
          configured: outlookStatus.configured,
          connected: outlookStatus.connected,
          email: outlookStatus.email || null,
        },
        sharepoint: {
          enabled: !!featureFlags.feature_ms_sharepoint_docs,
          connected: spConfig.connectionStatus === "connected",
          siteName: spConfig.siteName || null,
          driveName: spConfig.driveName || null,
        },
        teams: {
          enabled: !!featureFlags.feature_ms_teams,
          configured: !!(teamsConfig.unansweredThresholdHours || teamsConfig.tags?.length),
          tags: teamsConfig.tags || [],
        },
        user: {
          id: (req.user as any)?.id,
          name: (req.user as any)?.name,
          role: (req.user as any)?.role,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== OUTLOOK CALENDAR EVENTS ====================

  app.get("/api/outlook/events", requireAuth, async (req, res) => {
    try {
      const { start, end } = req.query;
      if (!start || !end) {
        return res.status(400).json({ error: "start and end query params required (YYYY-MM-DD)" });
      }
      const userToken = await getUserSsoToken(req);
      let events: any[] = [];
      if (userToken) {
        try {
          events = await outlook.getCalendarEvents(start as string, end as string, userToken);
        } catch (graphErr: any) {
          console.log("[Outlook] Graph API call failed with user token:", graphErr.message);
        }
      }
      if (events.length === 0) {
        const userId = (req.user as any)?.id;
        if (userId) {
          try {
            const { db } = await import("../db");
            const { msObjects } = await import("@shared/schema");
            const { and, eq, gte, lte } = await import("drizzle-orm");
            const startDate = new Date(`${start}T00:00:00`);
            const endDate = new Date(`${end}T23:59:59`);
            const { sql: sqlTag } = await import("drizzle-orm");
            const synced = await db.select().from(msObjects).where(
              and(
                eq(msObjects.userId, userId),
                eq(msObjects.type, "event"),
                sqlTag`${msObjects.receivedOrStartDatetime} >= ${startDate}`,
                sqlTag`${msObjects.receivedOrStartDatetime} <= ${endDate}`
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

  app.post("/api/outlook/events", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { date, startTime, endTime, label, idempotencyKey } = req.body;
      if (!date || !startTime || !endTime || !label) {
        return res.status(400).json({ error: "date, startTime, endTime, label are required" });
      }
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.status(401).json({ error: "Microsoft sign-in required to create calendar events." });
      }
      const eventId = await outlook.createOutlookEvent({
        date, startTime, endTime, label,
        idempotencyKey: idempotencyKey || `tb-${Date.now()}`,
      }, userToken);
      logAuditFromReq(req, { entityType: "outlook_event", action: "create", entityId: eventId, changesJson: { description: "Outlook calendar event created", label, date } });
      res.json({ eventId });
    } catch (err: any) {
      console.error("[Outlook] Create event error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/outlook/events/:eventId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { calendarId, date, startTime, endTime, label } = req.body;
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.status(401).json({ error: "Microsoft sign-in required to update calendar events." });
      }
      await outlook.updateOutlookEvent(paramStr(req.params.eventId), calendarId || null, {
        date, startTime, endTime, label,
      }, userToken);
      logAuditFromReq(req, { entityType: "outlook_event", action: "update", entityId: paramStr(req.params.eventId), changesJson: { description: "Outlook event updated", label } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Outlook] Update event error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/outlook/events/:eventId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { calendarId } = req.query;
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.status(401).json({ error: "Microsoft sign-in required to delete calendar events." });
      }
      await outlook.deleteOutlookEvent(paramStr(req.params.eventId), (calendarId as string) || null, userToken);
      logAuditFromReq(req, { entityType: "outlook_event", action: "delete", entityId: paramStr(req.params.eventId), changesJson: { description: "Outlook event deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Outlook] Delete event error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== OUTLOOK MESSAGES ====================

  app.get("/api/outlook/messages", requireAuth, async (req, res) => {
    try {
      const { search, top, skip, folder } = req.query;
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.json([]);
      }
      const messages = await outlook.listMessages({
        search: search ? String(search) : undefined,
        top: top ? parseInt(String(top)) : 20,
        skip: skip ? parseInt(String(skip)) : 0,
        folder: folder ? String(folder) : "inbox",
      }, userToken);
      res.json(messages);
    } catch (err: any) {
      if (err.message?.includes("not connected") || err.message?.includes("not available") || err.message?.includes("not configured")) {
        return res.json([]);
      }
      console.error("[Outlook] Messages error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/outlook/messages/:id", requireAuth, async (req, res) => {
    try {
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.status(401).json({ error: "Microsoft sign-in required to view emails. Please sign in with Microsoft." });
      }
      const msg = await outlook.getMessageDetail(paramStr(req.params.id), userToken);
      res.json(msg);
    } catch (err: any) {
      console.error("[Outlook] Message detail error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== OUTLOOK EMAIL-TO-TASK ====================

  app.post("/api/outlook/email-to-task", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { getFeatureFlag } = await import("../lib/feature-flags");
      const enabled = await getFeatureFlag("ms_create_action");
      if (!enabled) {
        return res.status(404).json({ error: "Microsoft create actions are not enabled" });
      }

      const userId = (req.user as any).id;
      const {
        sourceType,
        sourceRef,
        webLink,
        subject,
        sender,
        receivedAt,
        snippet,
        createType,
        category,
        projectBehavior,
        projectName,
        assigneeUserId,
        priority,
        dueDate,
        description,
        suggestions,
        chosenValues,
        overrideReasons,
      } = req.body || {};

      const normalizedSourceType = sourceType === "teams" || sourceType === "sharepoint" || sourceType === "email" ? sourceType : null;
      const normalizedCreateType = createType === "task" || createType === "action" ? createType : null;
      const normalizedProjectBehavior = projectBehavior === "accept_suggested" || projectBehavior === "choose_other" || projectBehavior === "leave_unlinked" ? projectBehavior : null;
      if (!normalizedSourceType || !normalizedCreateType || !normalizedProjectBehavior) {
        return res.status(400).json({ error: "sourceType, createType, and projectBehavior are required" });
      }
      if (!sourceRef || !subject || !category) {
        return res.status(400).json({ error: "sourceRef, subject, and category are required" });
      }
      if ((normalizedProjectBehavior === "accept_suggested" || normalizedProjectBehavior === "choose_other") && !projectName) {
        return res.status(400).json({ error: "projectName is required for linked items" });
      }
      if (normalizedCreateType === "task" && normalizedProjectBehavior === "leave_unlinked") {
        return res.status(400).json({ error: "Unlinked creation is not supported for task items in the canonical task model. Choose action or link a project." });
      }

      const suggested = suggestions || {};
      const chosen = chosenValues || {
        projectName: projectName || null,
        assigneeUserId: assigneeUserId || null,
        dueDate: dueDate || null,
        title: subject,
        summary: description || snippet || null,
      };
      const reasons = overrideReasons || {};

      const overrideFields = ["projectName", "assigneeUserId", "dueDate", "title", "summary"] as const;
      for (const field of overrideFields) {
        const suggestedValue = suggested[field] ?? null;
        const chosenValue = chosen[field] ?? null;
        if (suggestedValue !== null && chosenValue !== suggestedValue) {
          const reason = reasons[field];
          if (!reason || !String(reason).trim()) {
            return res.status(400).json({ error: `Override reason required for ${field}` });
          }
          logAuditFromReq(req, {
            entityType: "ms_create_action",
            action: "suggestion_overridden",
            entityId: `${normalizedSourceType}:${sourceRef}`,
            changesJson: { field, suggestedValue, chosenValue, reason: String(reason).trim() },
          });
          logAuditFromReq(req, {
            entityType: "ms_create_action",
            action: "override_reason_captured",
            entityId: `${normalizedSourceType}:${sourceRef}`,
            changesJson: { field, reason: String(reason).trim() },
          });
        } else if (suggestedValue !== null) {
          logAuditFromReq(req, {
            entityType: "ms_create_action",
            action: "suggestion_accepted",
            entityId: `${normalizedSourceType}:${sourceRef}`,
            changesJson: { field, value: chosenValue },
          });
        }
      }

      logAuditFromReq(req, {
        entityType: "ms_create_action",
        action: "source_item_opened",
        entityId: `${normalizedSourceType}:${sourceRef}`,
        changesJson: { sourceType: normalizedSourceType, sourceRef, webLink: webLink || null },
      });
      logAuditFromReq(req, {
        entityType: "ms_create_action",
        action: "create_clicked",
        entityId: `${normalizedSourceType}:${sourceRef}`,
        changesJson: { createType: normalizedCreateType, category, projectBehavior: normalizedProjectBehavior },
      });
      logAuditFromReq(req, {
        entityType: "ms_create_action",
        action: "suggestions_presented",
        entityId: `${normalizedSourceType}:${sourceRef}`,
        changesJson: { suggestions: suggested, chosenValues: chosen },
      });

      const existing = await db.execute(sql`
        SELECT id, created_item_type, created_item_id
        FROM ms_create_item_links
        WHERE source_type = ${normalizedSourceType}
          AND source_ref = ${sourceRef}
          AND created_item_type = ${normalizedCreateType}
        LIMIT 1
      `).then((r: any) => r.rows || r);
      if (existing?.length) {
        return res.status(409).json({
          error: "Duplicate create prevented",
          existing: existing[0],
        });
      }

      let createdItemType = normalizedCreateType;
      let createdItemId: number | null = null;

      if (normalizedCreateType === "task") {
        const opTask = await storage.createOperationalTask({
          projectName: String(projectName),
          title: String(chosen.title || subject),
          description: description || String(chosen.summary || snippet || ""),
          status: "TO DO",
          priority: priority || "Med",
          ownerUserId: assigneeUserId ? parseInt(String(assigneeUserId)) : null,
          requesterUserId: userId,
          dueDate: dueDate || null,
          sortOrder: 0,
          externalSource: normalizedSourceType,
          externalTaskId: sourceRef,
          createdBy: userId,
          domain: "BOTH",
          percentComplete: 0,
          taskTypeTag: category,
        });
        createdItemId = opTask.id;
      } else {
        const task = await storage.createMytoolTask({
          ownerUserId: assigneeUserId ? parseInt(String(assigneeUserId)) : userId,
          title: String(chosen.title || subject),
          status: "inbox",
          priority: "normal",
          notes: description || String(chosen.summary || snippet || ""),
          sortOrder: 0,
          isRecurring: false,
          bucket: projectName ? "project" : "personal",
          projectName: projectName || null,
          tag: category,
          sourceEmailId: normalizedSourceType === "email" ? sourceRef : null,
          sourceEmailSubject: normalizedSourceType === "email" ? subject : null,
          dueAt: dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null,
        });
        createdItemId = task.id;
      }

      const [trace] = await db.execute(sql`
        INSERT INTO ms_create_item_links (
          source_type, source_ref, source_deep_link, source_title, source_sender_or_author,
          created_item_type, created_item_id, category, project_behavior,
          suggested_values, chosen_values, override_reasons, created_by
        ) VALUES (
          ${normalizedSourceType}, ${sourceRef}, ${webLink || null}, ${subject}, ${sender || null},
          ${createdItemType}, ${createdItemId}, ${category}, ${normalizedProjectBehavior},
          ${JSON.stringify(suggested)}, ${JSON.stringify(chosen)}, ${JSON.stringify(reasons)}, ${userId}
        ) RETURNING *
      `).then((r: any) => r.rows || r);

      if (normalizedSourceType === "email") {
        await storage.createEmailLink({
          subject,
          sender: sender || null,
          emailDate: receivedAt ? new Date(receivedAt).toISOString().slice(0, 10) : null,
          snippet: snippet || null,
          outlookMessageId: sourceRef,
          webLink: webLink || null,
          linkedTaskId: normalizedCreateType === "action" ? createdItemId : null,
          linkedOperationalTaskId: normalizedCreateType === "task" ? createdItemId : null,
          linkedPriorityId: null,
          createdBy: userId,
        });
      }

      logAuditFromReq(req, {
        entityType: "ms_create_action",
        action: "create_confirmed",
        entityId: `${normalizedSourceType}:${sourceRef}`,
        changesJson: { createType: normalizedCreateType, category, createdItemId },
      });
      logAuditFromReq(req, {
        entityType: "ms_create_action",
        action: "create_succeeded",
        entityId: `${normalizedSourceType}:${sourceRef}`,
        changesJson: { createdItemType, createdItemId, projectName: projectName || null },
      });

      res.json({
        createdItem: { type: createdItemType, id: createdItemId },
        trace,
      });
    } catch (err: any) {
      logAuditFromReq(req, {
        entityType: "ms_create_action",
        action: "create_failed",
        changesJson: { error: err?.message || "Unknown error" },
      });
      console.error("[Outlook] Email-to-task error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== OUTLOOK SEND APPROVAL ====================

  app.post("/api/outlook/send-approval", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { to, subject, approvalTitle, approvalDescription, approveUrl, rejectUrl } = req.body;
      if (!to || !subject || !approvalTitle) {
        return res.status(400).json({ error: "to, subject, and approvalTitle are required" });
      }
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.status(401).json({ error: "Microsoft sign-in required. Please sign in with Microsoft." });
      }
      await outlook.sendApprovalEmail({
        to, subject, approvalTitle,
        approvalDescription: approvalDescription || "",
        approveUrl: approveUrl || "#",
        rejectUrl: rejectUrl || "#",
      }, userToken);
      logAuditFromReq(req, { entityType: "outlook_email", action: "send_approval", changesJson: { description: "Approval email sent", to, subject } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Outlook] Send approval error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== OUTLOOK FOLDERS ====================

  app.get("/api/outlook/folders", requireAuth, async (req, res) => {
    try {
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.json([]);
      }
      const folders = await outlook.listMailFolders(userToken);
      res.json(folders);
    } catch (err: any) {
      if (err.message?.includes("not connected") || err.message?.includes("not available") || err.message?.includes("not configured")) {
        return res.json([]);
      }
      console.error("[Outlook] Folders error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== OUTLOOK SEND / REPLY / FORWARD ====================

  app.post("/api/outlook/send", requireAuth, async (req, res) => {
    try {
      const { to, cc, subject, body, bodyType } = req.body;
      if (!to || !Array.isArray(to) || to.length === 0 || !subject) {
        return res.status(400).json({ error: "to (array) and subject are required" });
      }
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.status(401).json({ error: "Microsoft sign-in required. Please sign in with Microsoft." });
      }
      await outlook.sendMail({ to, cc: cc || [], subject, body: body || "", bodyType: bodyType || "Text" }, userToken);
      logAuditFromReq(req, { entityType: "outlook_email", action: "send", changesJson: { description: "Email sent", to, subject } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Outlook] Send mail error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/outlook/messages/:id/reply", requireAuth, async (req, res) => {
    try {
      const { comment, replyAll } = req.body;
      if (!comment) {
        return res.status(400).json({ error: "comment is required" });
      }
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.status(401).json({ error: "Microsoft sign-in required. Please sign in with Microsoft." });
      }
      await outlook.replyToMessage(paramStr(req.params.id), comment, !!replyAll, userToken);
      logAuditFromReq(req, { entityType: "outlook_email", action: "reply", entityId: paramStr(req.params.id), changesJson: { description: "Email reply sent", replyAll: !!replyAll } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Outlook] Reply error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/outlook/messages/:id/forward", requireAuth, async (req, res) => {
    try {
      const { comment, to } = req.body;
      if (!to || !Array.isArray(to) || to.length === 0) {
        return res.status(400).json({ error: "to (array) is required" });
      }
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.status(401).json({ error: "Microsoft sign-in required. Please sign in with Microsoft." });
      }
      await outlook.forwardMessage(paramStr(req.params.id), comment || "", to, userToken);
      logAuditFromReq(req, { entityType: "outlook_email", action: "forward", entityId: paramStr(req.params.id), changesJson: { description: "Email forwarded", to } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Outlook] Forward error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MS TEAMS ====================

  app.get("/api/ms-teams/joined", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id || (req as any).user?.userId;
      let ssoToken: string | null = null;
      if (userId) {
        try {
          const { getSsoTokenForUser } = await import("../ms-account-service");
          ssoToken = await getSsoTokenForUser(userId);
        } catch {}
      }
      if (!ssoToken) {
        return res.json({ data: [], ssoRequired: true, message: "Sign in with Microsoft to access Teams data" });
      }
      const teams = await outlook.getJoinedTeams(ssoToken);
      const result: any[] = [];
      for (const team of teams) {
        const channels = await outlook.getTeamChannels(team.id, ssoToken);
        result.push({ ...team, channels });
      }
      res.json(result);
    } catch (err: any) {
      if (err.message?.includes("not connected") || err.message?.includes("not available")) {
        return res.json([]);
      }
      if (err.message?.includes("403")) {
        return res.json({ data: [], ssoRequired: true, message: "Teams session expired — please sign in with Microsoft again" });
      }
      console.error("[Teams Graph] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ms-teams/chats", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id || (req as any).user?.userId;
      let ssoToken: string | null = null;
      if (userId) {
        try {
          const { getSsoTokenForUser } = await import("../ms-account-service");
          ssoToken = await getSsoTokenForUser(userId);
        } catch {}
      }
      if (!ssoToken) {
        return res.json({ data: [], ssoRequired: true, message: "Sign in with Microsoft to access Teams chats" });
      }
      const chats = await outlook.getMyChats(30, ssoToken);
      res.json(chats);
    } catch (err: any) {
      if (err.message?.includes("not connected") || err.message?.includes("not available")) {
        return res.json([]);
      }
      if (err.message?.includes("403")) {
        return res.json({ data: [], ssoRequired: true, message: "Teams session expired — please sign in with Microsoft again" });
      }
      console.error("[Teams Graph] Chats error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ms-teams/chats/:chatId/messages", requireAuth, async (req, res) => {
    try {
      const ssoToken = await getUserSsoToken(req);
      if (!ssoToken) {
        return res.json({ messages: [], ssoRequired: true });
      }
      const messages = await outlook.getChatMessages(paramStr(req.params.chatId), 50, ssoToken);
      res.json({ messages });
    } catch (err: any) {
      if (err.message?.includes("403")) {
        return res.json({ messages: [], ssoRequired: true });
      }
      console.error("[Teams] Chat messages error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ms-teams/channels/:teamId/:channelId/messages", requireAuth, async (req, res) => {
    try {
      const ssoToken = await getUserSsoToken(req);
      if (!ssoToken) {
        return res.json({ messages: [], ssoRequired: true });
      }
      const messages = await outlook.getChannelMessages(paramStr(req.params.teamId), paramStr(req.params.channelId), 50, ssoToken);
      res.json({ messages });
    } catch (err: any) {
      if (err.message?.includes("403")) {
        return res.json({ messages: [], ssoRequired: true });
      }
      console.error("[Teams] Channel messages error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ms-teams/chats/:chatId/messages", requireAuth, async (req, res) => {
    try {
      const ssoToken = await getUserSsoToken(req);
      if (!ssoToken) {
        return res.status(401).json({ error: "Microsoft sign-in required" });
      }
      const { content } = req.body;
      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Message content is required" });
      }
      const result = await outlook.sendChatMessage(paramStr(req.params.chatId), content.trim(), ssoToken);
      logAuditFromReq(req, { entityType: "ms_teams_chat", entityId: paramStr(req.params.chatId), action: "send_message" });
      res.json({ success: true, message: result });
    } catch (err: any) {
      console.error("[Teams] Send chat message error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ms-teams/channels/:teamId/:channelId/messages", requireAuth, async (req, res) => {
    try {
      const ssoToken = await getUserSsoToken(req);
      if (!ssoToken) {
        return res.status(401).json({ error: "Microsoft sign-in required" });
      }
      const { content } = req.body;
      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Message content is required" });
      }
      const result = await outlook.sendChannelMessage(paramStr(req.params.teamId), paramStr(req.params.channelId), content.trim(), ssoToken);
      logAuditFromReq(req, { entityType: "ms_teams_channel", entityId: `${paramStr(req.params.teamId)}/${paramStr(req.params.channelId)}`, action: "send_message" });
      res.json({ success: true, message: result });
    } catch (err: any) {
      console.error("[Teams] Send channel message error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== SHAREPOINT ====================

  app.get("/api/sharepoint/discover-sites", requireAuth, async (req, res) => {
    try {
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.json([]);
      }
      const sites = await outlook.discoverSharePointSites(userToken);
      res.json(sites);
    } catch (err: any) {
      if (err.message?.includes("not connected") || err.message?.includes("not available")) {
        return res.json([]);
      }
      console.error("[SharePoint] Discover sites error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sharepoint/site-drives/:siteId", requireAuth, async (req, res) => {
    try {
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.json([]);
      }
      const drives = await outlook.getSiteDrives(paramStr(req.params.siteId), userToken);
      res.json(drives);
    } catch (err: any) {
      console.error("[SharePoint] Site drives error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}
