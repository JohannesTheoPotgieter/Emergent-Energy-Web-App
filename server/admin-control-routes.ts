import { Router, type Express, type Request, type Response, type NextFunction } from "express";
import { requireAuth, requireAdmin } from "./departments/shared-middleware";
import { db } from "./db";
import { sql, eq } from "drizzle-orm";
import { appSettings, users, projectInfo, smartImportRuns, auditEvents } from "@shared/schema";
import { getFeatureFlag, setFeatureFlag } from "./lib/feature-flags";
import { logAuditFromReq } from "./audit-logger";

const router = Router();

router.get("/api/admin/control-center/health", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { getDbConfigStatus } = await import("./db-config");
    const dbStatus = getDbConfigStatus();

    const [userCountResult] = await db.execute(sql`SELECT COUNT(*) as count FROM users`).then((r: any) => r.rows || r);
    const [projectCountResult] = await db.execute(sql`SELECT COUNT(*) as count FROM project_info`).then((r: any) => r.rows || r);
    const [activeProjectCount] = await db.execute(sql`SELECT COUNT(*) as count FROM project_info WHERE is_active = true`).then((r: any) => r.rows || r);

    let importStats = { total: 0, committed: 0, failed: 0, lastRun: null as string | null };
    try {
      const importRows: any[] = await db.execute(sql`
        SELECT status, COUNT(*) as count FROM smart_import_runs GROUP BY status
      `).then((r: any) => r.rows || r);
      for (const row of importRows) {
        importStats.total += parseInt(row.count);
        if (row.status === "COMMITTED") importStats.committed += parseInt(row.count);
        if (row.status === "FAILED") importStats.failed += parseInt(row.count);
      }
      const [lastRun] = await db.execute(sql`SELECT uploaded_at FROM smart_import_runs ORDER BY uploaded_at DESC LIMIT 1`).then((r: any) => r.rows || r);
      if (lastRun) importStats.lastRun = lastRun.uploaded_at;
    } catch {}

    let auditCount = 0;
    try {
      const [auditResult] = await db.execute(sql`SELECT COUNT(*) as count FROM audit_events`).then((r: any) => r.rows || r);
      auditCount = parseInt(auditResult?.count || "0");
    } catch {}

    res.json({
      db: {
        connected: dbStatus.connected,
        host: dbStatus.host,
        error: dbStatus.error || null,
      },
      users: parseInt(userCountResult?.count || "0"),
      projects: {
        total: parseInt(projectCountResult?.count || "0"),
        active: parseInt(activeProjectCount?.count || "0"),
      },
      imports: importStats,
      auditEvents: auditCount,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch system health", message: err.message });
  }
});

router.get("/api/admin/control-center/feature-flags", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const allSettings = await db.select().from(appSettings);
    const flags = allSettings.map(s => ({
      key: s.key,
      value: s.value === "true" || s.value === "1",
      rawValue: s.value,
      updatedBy: s.updatedBy,
      updatedAt: s.updatedAt,
    }));
    res.json(flags);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch feature flags" });
  }
});

router.put("/api/admin/control-center/feature-flags/:key", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const userName = (req.user as any)?.name || "admin";
    await setFeatureFlag(key, !!value, userName);

    logAuditFromReq(req, {
      entityType: "feature_flag",
      entityId: key,
      action: "toggle",
      source: "SETTINGS",
      changesJson: { key, value: !!value },
    });

    res.json({ success: true, key, value: !!value });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update feature flag" });
  }
});

router.get("/api/admin/control-center/enums", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const phases = [
      "Construction", "QA", "Commissioning", "Handover", "Compliance Handover",
      "Commercial Close Out", "Commercial Close out", "DLP", "Financial Close",
      "Planning", "Cost Proposal"
    ];
    const ragValues = ["Green", "Amber", "Red"];

    let statusValues: string[] = [];
    try {
      const statusRows: any[] = await db.execute(sql`SELECT DISTINCT phase FROM project_info WHERE phase IS NOT NULL ORDER BY phase`).then((r: any) => r.rows || r);
      statusValues = statusRows.map((r: any) => r.phase);
    } catch {}

    let workstreamValues: string[] = [];
    try {
      const wsRows: any[] = await db.execute(sql`SELECT DISTINCT workstream FROM operational_tasks WHERE workstream IS NOT NULL ORDER BY workstream`).then((r: any) => r.rows || r);
      workstreamValues = wsRows.map((r: any) => r.workstream);
    } catch {}

    res.json({
      executionPhases: phases,
      ragValues,
      projectPhases: statusValues,
      workstreams: workstreamValues,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch enums" });
  }
});

router.get("/api/admin/control-center/integrations", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    let msStatus = { outlook: false, sharepoint: false, teams: false, objectCount: 0 };
    try {
      const [msCount] = await db.execute(sql`SELECT COUNT(*) as count FROM ms_objects`).then((r: any) => r.rows || r);
      msStatus.objectCount = parseInt(msCount?.count || "0");
      const types: any[] = await db.execute(sql`SELECT DISTINCT object_type FROM ms_objects`).then((r: any) => r.rows || r);
      for (const t of types) {
        if (t.object_type === "email") msStatus.outlook = true;
        if (t.object_type === "file" || t.object_type === "folder") msStatus.sharepoint = true;
        if (t.object_type === "chat" || t.object_type === "channel") msStatus.teams = true;
      }
    } catch {}

    res.json(msStatus);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch integration status" });
  }
});

router.post("/api/admin/control-center/dangerous/clear-sessions", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    await db.execute(sql`DELETE FROM "session"`);
    logAuditFromReq(req, {
      entityType: "system",
      action: "clear_sessions",
      source: "SETTINGS",
      changesJson: { action: "Cleared all user sessions" },
    });
    res.json({ success: true, message: "All sessions cleared" });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to clear sessions", message: err.message });
  }
});

router.post("/api/admin/control-center/dangerous/clear-audit-log", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { olderThanDays } = req.body;
    const days = parseInt(olderThanDays) || 90;
    await db.execute(sql`DELETE FROM audit_events WHERE created_at < NOW() - ${days}::int * INTERVAL '1 day'`);
    logAuditFromReq(req, {
      entityType: "system",
      action: "clear_audit_log",
      source: "SETTINGS",
      changesJson: { olderThanDays: days },
    });
    res.json({ success: true, message: `Audit events older than ${days} days cleared` });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to clear audit log", message: err.message });
  }
});

router.get("/api/admin/control-center/active-sessions", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const rows: any[] = await db.execute(sql`SELECT sid, sess, expire FROM "session" WHERE expire > NOW() ORDER BY expire DESC`).then((r: any) => r.rows || r);
    const sessions = rows.map((row: any) => {
      const sess = typeof row.sess === "string" ? JSON.parse(row.sess) : row.sess;
      const passport = sess?.passport || {};
      const userId = passport?.user;
      return {
        sid: row.sid,
        userId: userId || null,
        expire: row.expire,
        cookie: sess?.cookie || {},
      };
    });

    const userIds = sessions.map((s: any) => s.userId).filter(Boolean);
    let userMap: Record<number, { name: string; username: string; role: string }> = {};
    if (userIds.length > 0) {
      const userRows: any[] = await db.execute(
        sql`SELECT id, name, username, role FROM users WHERE id = ANY(${userIds}::int[])`
      ).then((r: any) => r.rows || r);
      for (const u of userRows) {
        userMap[u.id] = { name: u.name, username: u.username, role: u.role };
      }
    }

    const enriched = sessions.map((s: any) => ({
      sid: s.sid,
      userId: s.userId,
      userName: userMap[s.userId]?.name || null,
      username: userMap[s.userId]?.username || null,
      userRole: userMap[s.userId]?.role || null,
      expiresAt: s.expire,
    }));

    res.json({ count: enriched.length, sessions: enriched });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch sessions", message: err.message });
  }
});

router.delete("/api/admin/control-center/sessions/:sid", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { sid } = req.params;
    await db.execute(sql`DELETE FROM "session" WHERE sid = ${sid}`);
    logAuditFromReq(req, {
      entityType: "system",
      action: "force_logout",
      source: "SETTINGS",
      changesJson: { sessionId: sid },
    });
    res.json({ success: true, message: "Session terminated" });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete session", message: err.message });
  }
});

router.get("/api/admin/control-center/recent-import-failures", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const rows: any[] = await db.execute(sql`
      SELECT sir.id, sir.project_name, sir.source_file_name, sir.uploaded_at, sir.status,
             sir.records_attempted, sir.records_failed, sir.summary_json,
             u.name as uploaded_by_name
      FROM smart_import_runs sir
      LEFT JOIN users u ON sir.uploaded_by = u.id
      WHERE sir.status = 'FAILED'
      ORDER BY sir.uploaded_at DESC
      LIMIT 10
    `).then((r: any) => r.rows || r);

    const enriched = [];
    for (const row of rows) {
      let issueCount = 0;
      let topIssue = null;
      try {
        const [issueResult] = await db.execute(
          sql`SELECT COUNT(*) as count FROM import_issues WHERE import_run_id = ${row.id} AND severity = 'BLOCKER'`
        ).then((r: any) => r.rows || r);
        issueCount = parseInt(issueResult?.count || "0");
        const issueRows: any[] = await db.execute(
          sql`SELECT message FROM import_issues WHERE import_run_id = ${row.id} AND severity = 'BLOCKER' ORDER BY id LIMIT 1`
        ).then((r: any) => r.rows || r);
        topIssue = issueRows[0]?.message || null;
      } catch {}
      enriched.push({
        id: row.id,
        projectName: row.project_name,
        fileName: row.source_file_name,
        uploadedAt: row.uploaded_at,
        uploadedBy: row.uploaded_by_name,
        recordsAttempted: row.records_attempted,
        recordsFailed: row.records_failed,
        blockerCount: issueCount,
        topError: topIssue,
      });
    }

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch import failures", message: err.message });
  }
});

router.get("/api/admin/control-center/recent-issues", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const rows: any[] = await db.execute(sql`
      SELECT id, entity_type, entity_id, action, user_name, project_name, created_at, changes_json, request_path
      FROM audit_events
      WHERE action IN ('error', 'system_error', 'clear_sessions', 'clear_audit_log', 'admin_recovery_restore', 'admin_recovery_delete', 'force_logout')
         OR action LIKE '%error%'
         OR action LIKE '%fail%'
      ORDER BY created_at DESC
      LIMIT 20
    `).then((r: any) => r.rows || r);

    res.json(rows.map((r: any) => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      userName: r.user_name,
      projectName: r.project_name,
      createdAt: r.created_at,
      details: r.changes_json,
      requestPath: r.request_path,
    })));
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch recent issues", message: err.message });
  }
});

router.get("/api/admin/control-center/integration-health", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const integrations: any[] = [];

    const types = ["email", "file", "folder", "chat", "channel"];
    const typeLabels: Record<string, string> = {
      email: "Outlook",
      file: "SharePoint Files",
      folder: "SharePoint Folders",
      chat: "Teams Chat",
      channel: "Teams Channels",
    };

    for (const t of types) {
      try {
        const [countRow] = await db.execute(
          sql`SELECT COUNT(*) as count FROM ms_objects WHERE type = ${t}::ms_object_type`
        ).then((r: any) => r.rows || r);
        const [lastSync] = await db.execute(
          sql`SELECT MAX(last_synced_at) as last_sync FROM ms_objects WHERE type = ${t}::ms_object_type`
        ).then((r: any) => r.rows || r);

        const count = parseInt(countRow?.count || "0");
        if (count > 0) {
          integrations.push({
            name: typeLabels[t] || t,
            type: t,
            objectCount: count,
            lastSyncTime: lastSync?.last_sync || null,
            status: "connected",
          });
        }
      } catch {}
    }

    if (integrations.length === 0) {
      integrations.push(
        { name: "Outlook", type: "email", objectCount: 0, lastSyncTime: null, status: "not_connected" },
        { name: "SharePoint", type: "file", objectCount: 0, lastSyncTime: null, status: "not_connected" },
        { name: "Teams", type: "chat", objectCount: 0, lastSyncTime: null, status: "not_connected" },
      );
    }

    res.json(integrations);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch integration health", message: err.message });
  }
});

router.get("/api/admin/control-center/operational-exceptions", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const [unassignedTasksResult, unassignedProjectsResult, overdueByOwnerResult, blockedItemsResult] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*) as count FROM work_items
        WHERE deleted_at IS NULL
        AND (status IS NULL OR LOWER(status) NOT IN ('complete','done','completed','cancelled','canceled'))
        AND (assigned_to IS NULL OR assigned_to = '')
      `).then((r: any) => ((r.rows || r)[0]) || { count: 0 }),
      db.execute(sql`
        SELECT COUNT(*) as count FROM project_info
        WHERE is_active = true
        AND (pm IS NULL OR pm = '')
      `).then((r: any) => ((r.rows || r)[0]) || { count: 0 }),
      db.execute(sql`
        SELECT COALESCE(wi.assigned_to, 'Unassigned') as owner, COUNT(*) as count
        FROM work_items wi
        WHERE wi.deleted_at IS NULL
        AND LOWER(wi.status) NOT IN ('complete','done','completed','cancelled','canceled')
        AND wi.due_date IS NOT NULL AND wi.due_date < NOW()
        GROUP BY COALESCE(wi.assigned_to, 'Unassigned')
        ORDER BY count DESC
        LIMIT 10
      `).then((r: any) => (r.rows || r) || []),
      db.execute(sql`
        SELECT COUNT(*) as count FROM work_items
        WHERE deleted_at IS NULL
        AND LOWER(status) = 'blocked'
      `).then((r: any) => ((r.rows || r)[0]) || { count: 0 }),
    ]);

    res.json({
      unassignedTasks: parseInt(unassignedTasksResult?.count || "0"),
      unassignedProjects: parseInt(unassignedProjectsResult?.count || "0"),
      blockedItems: parseInt(blockedItemsResult?.count || "0"),
      overdueByOwner: (overdueByOwnerResult as any[]).map((r: any) => ({
        owner: r.owner,
        count: parseInt(r.count || "0"),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch operational exceptions", message: err.message });
  }
});

export function registerAdminControlRoutes(app: Express) {
  app.use(router);
}
