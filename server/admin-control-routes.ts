import { Router, type Express, type Request, type Response, type NextFunction } from "express";
import { requireAuth, requireAdmin } from "./departments/shared-middleware";
import { db } from "./db";
import { sql, eq } from "drizzle-orm";
import { appSettings, users, projectInfo, smartImportRuns, auditEvents } from "@shared/schema";
import { getFeatureFlag, getRolloutFeatureFlags, setFeatureFlag } from "./lib/feature-flags";
import { ROLLOUT_FEATURE_FLAGS } from "@shared/feature-flags";
import { logAuditFromReq } from "./audit-logger";
import { getStartupFlags } from "./startup-flags";
const { rawEnv: startupRawFlags, modes: startupEffectiveModes } = getStartupFlags();

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
      startupFlags: {
        raw: startupRawFlags,
        effective: startupEffectiveModes,
      },
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
    const { value, reason, suggestedValue } = req.body;
    const normalizedValue = !!value;
    const normalizedSuggestedValue = suggestedValue === undefined || suggestedValue === null ? null : !!suggestedValue;
    const normalizedReason = typeof reason === "string" ? reason.trim() : "";

    if (normalizedSuggestedValue !== null && normalizedSuggestedValue !== normalizedValue && !normalizedReason) {
      return res.status(400).json({ error: "Override reason is required when the chosen value differs from the suggested value." });
    }

    const userName = (req.user as any)?.name || "admin";
    await setFeatureFlag(key, normalizedValue, userName);

    logAuditFromReq(req, {
      entityType: "feature_flag",
      entityId: key,
      action: normalizedSuggestedValue !== null && normalizedSuggestedValue !== normalizedValue ? "override" : "toggle",
      source: "SETTINGS",
      changesJson: {
        key,
        suggestedValue: normalizedSuggestedValue,
        finalValue: normalizedValue,
        reason: normalizedReason || null,
      },
    });

    res.json({ success: true, key, value: normalizedValue });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update feature flag" });
  }
});


router.get("/api/admin/control-center/rollout-foundation", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const flags = await getRolloutFeatureFlags();
    res.json({
      flags: ROLLOUT_FEATURE_FLAGS.map((flag) => ({
        key: flag.key,
        label: flag.label,
        description: flag.description,
        defaultValue: flag.defaultValue,
        value: flags[flag.key],
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch rollout foundation" });
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
    // Canonical auth session state lives in the postgres "session" table (connect-pg-simple store).
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

router.get("/api/admin/control-center/permission-enforcement", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const backendEnforced = [
      { route: "POST /api/po/generate", entity: "procurement", action: "edit", level: "requirePermission" },
      { route: "PATCH /api/po/:poId/status", entity: "procurement", action: "edit", level: "requirePermission" },
      { route: "DELETE /api/po/:poId", entity: "procurement", action: "delete", level: "requirePermission" },
      { route: "POST /api/pd/clients", entity: "pd_quality", action: "edit", level: "requirePermission" },
      { route: "PATCH /api/pd/clients/:id", entity: "pd_quality", action: "edit", level: "requirePermission" },
      { route: "POST /api/pd/tickets", entity: "pd_quality", action: "edit", level: "requirePermission" },
      { route: "PATCH /api/pd/tickets/:id", entity: "pd_quality", action: "edit", level: "requirePermission" },
      { route: "POST /api/pd/tickets/:id/spawn-tasks", entity: "pd_quality", action: "edit", level: "requirePermission" },
      { route: "PATCH /api/projects-summary/:projectName/latest-update", entity: "projects", action: "edit", level: "requirePermission" },
      { route: "PATCH /api/project-info/:id/assign-pm", entity: "projects", action: "edit", level: "requirePermission" },
      { route: "POST /api/weekly-reviews/:projectName", entity: "projects", action: "edit", level: "requirePermission" },
      { route: "PATCH /api/weekly-reviews/:projectName/:id", entity: "projects", action: "edit", level: "requirePermission" },
      { route: "POST /api/lifecycle-board/projects/:id/rag", entity: "projects", action: "edit", level: "requirePermission + role check" },
      { route: "POST /api/lifecycle-board/projects/link-engineering", entity: "projects", action: "edit", level: "requirePermission + requireExecRole" },
      { route: "POST /api/lifecycle-board/projects/merge", entity: "projects", action: "edit", level: "requirePermission + requireExecRole" },
      { route: "PATCH /api/lifecycle-board/projects/:id", entity: "projects", action: "edit", level: "requirePermission + requireExecRole" },
      { route: "DELETE /api/lifecycle-board/projects/:id", entity: "projects", action: "delete", level: "requirePermission + requireExecRole" },
      { route: "POST /api/invoice-patterns", entity: "procurement", action: "edit", level: "requirePermission" },
      { route: "PATCH /api/invoice-patterns/:id", entity: "procurement", action: "edit", level: "requirePermission" },
      { route: "DELETE /api/invoice-patterns/:id", entity: "procurement", action: "delete", level: "requirePermission" },
      { route: "POST /api/counterparties", entity: "procurement", action: "edit", level: "requirePermission" },
      { route: "PATCH /api/counterparties/:id", entity: "procurement", action: "edit", level: "requirePermission" },
      { route: "DELETE /api/counterparties/:id", entity: "procurement", action: "delete", level: "requirePermission" },
      { route: "POST /api/procurement-analysis/run", entity: "procurement", action: "edit", level: "requirePermission" },
      { route: "POST /api/subcontractor-dashboard/link-counterparty", entity: "procurement", action: "edit", level: "requirePermission" },
      { route: "PATCH /api/subcontractor-dashboard/rename", entity: "procurement", action: "edit", level: "requirePermission" },
      { route: "DELETE /api/subcontractor-dashboard/counterparty/:name", entity: "procurement", action: "edit", level: "requirePermission" },
      { route: "POST /api/subcontractor-dashboard/merge", entity: "procurement", action: "edit", level: "requirePermission" },
      { route: "POST /api/smart-import/upload", entity: "admin", action: "all", level: "requireImportRole" },
      { route: "POST /api/smart-import/:runId/commit", entity: "admin", action: "all", level: "requireImportRole" },
      { route: "POST /api/smart-import/:runId/rollback", entity: "admin", action: "all", level: "requireImportRole" },
      { route: "POST /api/smart-import/bulk-commit", entity: "admin", action: "all", level: "requireImportRole" },
      { route: "GET /api/smart-import/project-matches/:name", entity: "admin", action: "all", level: "requireImportRole" },
      { route: "PATCH /api/smart-import/:runId/assign-project", entity: "admin", action: "all", level: "requireImportRole" },
      { route: "POST /api/smart-import/:runId/ignore-all-blockers", entity: "admin", action: "all", level: "requireImportRole" },
      { route: "POST /api/smart-import/:runId/allow-all", entity: "admin", action: "all", level: "requireImportRole" },
      { route: "POST /api/smart-import/:runId/apply-prior-resolutions", entity: "admin", action: "all", level: "requireImportRole" },
      { route: "POST /api/operational-tasks", entity: "tasks", action: "create", level: "requireAdmin" },
      { route: "PATCH /api/operational-tasks/:id", entity: "tasks", action: "edit", level: "requireAdmin" },
      { route: "DELETE /api/operational-tasks/:id", entity: "tasks", action: "delete", level: "requireAdmin" },
      { route: "PUT /api/settings", entity: "admin", action: "all", level: "requireAdmin" },
      { route: "POST /api/eng/tasks/:id/send-for-approval", entity: "engineering", action: "approve", level: "requireAuth" },
      { route: "POST /api/quality/.../approve", entity: "quality", action: "approve", level: "requirePermission('quality','approve')" },
      { route: "POST /api/financial-edit-requests", entity: "financials", action: "edit", level: "requireFinancialEditor" },
      { route: "POST /api/financial-edit-requests/:id/approve", entity: "financials", action: "approve", level: "requireFinancialApprover" },
      { route: "PATCH /api/tasks/reassign", entity: "tasks", action: "edit", level: "requireAuth + inline role check" },
    ];

    const ownershipScoping = [
      { endpoint: "GET /api/projects-summary", scope: "ownership metadata + optional scope=owned filter", enforced: "backend" },
      { endpoint: "GET /api/tasks", scope: "non-management scoped to assigned/owned tasks", enforced: "backend" },
      { endpoint: "GET /api/my-work/all-tasks", scope: "strictly scoped to current user", enforced: "backend" },
      { endpoint: "GET /api/pd/tickets", scope: "PD sees own tickets, admin sees all", enforced: "backend" },
      { endpoint: "GET /api/projects-summary (management roles)", scope: "full oversight for admin/COO/CEO/CCO/CFO/PM", enforced: "backend" },
    ];

    const applicationLogicOnly = [
      { endpoint: "GET /api/work-items (project-specific)", scope: "filtered by project context", status: "application_logic" },
      { endpoint: "GET /api/engineering tasks", scope: "project-scoped by frontend context", status: "application_logic" },
    ];

    let recentDenials = 0;
    try {
      const [result] = await db.execute(sql`
        SELECT COUNT(*) as count FROM audit_events
        WHERE action IN ('permission_denied', 'forbidden')
        AND created_at > NOW() - INTERVAL '7 days'
      `).then((r: any) => r.rows || r);
      recentDenials = parseInt(result?.count || "0");
    } catch {}

    let recentImportIssues = 0;
    try {
      const [result] = await db.execute(sql`
        SELECT COUNT(*) as count FROM smart_import_runs
        WHERE status IN ('FAILED', 'ERROR')
        AND uploaded_at > NOW() - INTERVAL '7 days'
      `).then((r: any) => r.rows || r);
      recentImportIssues = parseInt(result?.count || "0");
    } catch {}

    res.json({
      summary: {
        totalBackendEnforcedRoutes: backendEnforced.length,
        totalOwnershipScopedEndpoints: ownershipScoping.length,
        totalApplicationLogicOnly: applicationLogicOnly.length,
        recentAccessDenials7d: recentDenials,
        recentImportIssues7d: recentImportIssues,
      },
      backendEnforced,
      ownershipScoping,
      applicationLogicOnly,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch permission enforcement data", message: err.message });
  }
});

export function registerAdminControlRoutes(app: Express) {
  app.use(router);
}
