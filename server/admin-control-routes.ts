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

export function registerAdminControlRoutes(app: Express) {
  app.use(router);
}
