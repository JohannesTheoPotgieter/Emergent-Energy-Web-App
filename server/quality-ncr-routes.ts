import type { Express, Request, Response } from "express";
import { db, getDbMode } from "./db";
import { sql } from "drizzle-orm";
import { requireAuth, getEffectiveUser } from "./auth-context";

const STATUS_ORDER = ["open", "investigating", "corrective_action", "verification", "closed"] as const;

function canTransition(from: string, to: string) {
  const fromIdx = STATUS_ORDER.indexOf(from as any);
  const toIdx = STATUS_ORDER.indexOf(to as any);
  if (fromIdx < 0 || toIdx < 0) return false;
  return toIdx <= fromIdx + 1;
}

/**
 * Dev-only table bootstrap for SQLite mode.
 * In production/staging, these tables are created by migrations/20260404_create_ncr_tables.sql.
 */
async function ensureNcrTables() {
  if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging") return;

  const isPostgres = getDbMode() === "postgres";
  const idCol = isPostgres ? "id SERIAL PRIMARY KEY" : "id INTEGER PRIMARY KEY AUTOINCREMENT";
  const timestampDefault = isPostgres ? "DEFAULT NOW()" : "DEFAULT CURRENT_TIMESTAMP";

  await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS ncr_reports (
    ${idCol},
    project_id INTEGER NOT NULL,
    reported_by INTEGER NOT NULL,
    assigned_to INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    severity TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    root_cause TEXT,
    corrective_action TEXT,
    preventive_action TEXT,
    due_date TEXT,
    closed_at TEXT,
    created_at TIMESTAMP NOT NULL ${timestampDefault},
    updated_at TIMESTAMP NOT NULL ${timestampDefault}
  )`));
  await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS ncr_attachments (
    ${idCol},
    ncr_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    uploaded_by INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL ${timestampDefault}
  )`));
  await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS ncr_comments (
    ${idCol},
    ncr_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    comment TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL ${timestampDefault}
  )`));
}

export function registerQualityNcrRoutes(app: Express) {
  app.get("/api/quality/ncrs", requireAuth, async (req: Request, res: Response) => {
    try {
      await ensureNcrTables();
      const status = req.query.status ? String(req.query.status) : null;
      const severity = req.query.severity ? String(req.query.severity) : null;
      const isPostgres = getDbMode() === "postgres";
      const ageDaysExpr = isPostgres
        ? "EXTRACT(EPOCH FROM (NOW() - r.created_at)) / 86400"
        : "CAST(julianday('now') - julianday(r.created_at) AS INTEGER)";
      const rows = await db.execute(sql`
        SELECT r.*, u.name as assignee_name,
               ${sql.raw(ageDaysExpr)} AS age_days
        FROM ncr_reports r
        LEFT JOIN users u ON u.id = r.assigned_to
        WHERE (${status} IS NULL OR r.status = ${status})
          AND (${severity} IS NULL OR r.severity = ${severity})
        ORDER BY r.updated_at DESC
      `);
      res.json({ items: (rows as any).rows || [] });
    } catch (err) {
      console.error("[QualityNCR] Failed to fetch NCRs:", err);
      res.status(500).json({ error: "Failed to fetch NCR reports" });
    }
  });

  app.post("/api/quality/ncrs", requireAuth, async (req: Request, res: Response) => {
    try {
      await ensureNcrTables();
      const user = getEffectiveUser(req);
      const { project_id, assigned_to, title, description, severity, due_date } = req.body || {};
      if (!project_id || !title || !severity) return res.status(400).json({ error: "project_id, title, severity required" });
      await db.execute(sql`
        INSERT INTO ncr_reports (project_id, reported_by, assigned_to, title, description, severity, status, due_date, created_at, updated_at)
        VALUES (${project_id}, ${user?.id}, ${assigned_to ?? null}, ${title}, ${description ?? null}, ${severity}, 'open', ${due_date ?? null}, ${new Date().toISOString()}, ${new Date().toISOString()})
      `);
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error("[QualityNCR] Failed to create NCR:", err);
      res.status(500).json({ error: "Failed to create NCR report" });
    }
  });

  app.get("/api/quality/ncrs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await ensureNcrTables();
      const id = Number(req.params.id);
      const ncrRows = await db.execute(sql`SELECT * FROM ncr_reports WHERE id = ${id} LIMIT 1`);
      const ncr = (ncrRows as any).rows?.[0];
      if (!ncr) return res.status(404).json({ error: "not_found" });
      const comments = await db.execute(sql`SELECT c.*, u.name as user_name FROM ncr_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.ncr_id = ${id} ORDER BY c.created_at ASC`);
      const attachments = await db.execute(sql`SELECT * FROM ncr_attachments WHERE ncr_id = ${id} ORDER BY created_at DESC`);
      res.json({ ncr, comments: (comments as any).rows || [], attachments: (attachments as any).rows || [] });
    } catch (err) {
      console.error("[QualityNCR] Failed to fetch NCR:", err);
      res.status(500).json({ error: "Failed to fetch NCR report" });
    }
  });

  app.put("/api/quality/ncrs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await ensureNcrTables();
      const id = Number(req.params.id);
      const currentRows = await db.execute(sql`SELECT status FROM ncr_reports WHERE id = ${id} LIMIT 1`);
      const current = String((currentRows as any).rows?.[0]?.status || "open");
      const next = req.body?.status ? String(req.body.status) : current;
      if (next !== current && !canTransition(current, next)) {
        return res.status(400).json({ error: "invalid_transition", message: `Cannot transition ${current} -> ${next}` });
      }
      await db.execute(sql`
        UPDATE ncr_reports
        SET title = COALESCE(${req.body?.title ?? null}, title),
            description = COALESCE(${req.body?.description ?? null}, description),
            severity = COALESCE(${req.body?.severity ?? null}, severity),
            status = ${next},
            root_cause = COALESCE(${req.body?.root_cause ?? null}, root_cause),
            corrective_action = COALESCE(${req.body?.corrective_action ?? null}, corrective_action),
            preventive_action = COALESCE(${req.body?.preventive_action ?? null}, preventive_action),
            assigned_to = COALESCE(${req.body?.assigned_to ?? null}, assigned_to),
            due_date = COALESCE(${req.body?.due_date ?? null}, due_date),
            closed_at = CASE WHEN ${next} = 'closed' THEN ${new Date().toISOString()} ELSE closed_at END,
            updated_at = ${new Date().toISOString()}
        WHERE id = ${id}
      `);
      res.json({ ok: true });
    } catch (err) {
      console.error("[QualityNCR] Failed to update NCR:", err);
      res.status(500).json({ error: "Failed to update NCR report" });
    }
  });

  app.delete("/api/quality/ncrs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await ensureNcrTables();
      const id = Number(req.params.id);
      await db.execute(sql`DELETE FROM ncr_comments WHERE ncr_id = ${id}`);
      await db.execute(sql`DELETE FROM ncr_attachments WHERE ncr_id = ${id}`);
      await db.execute(sql`DELETE FROM ncr_reports WHERE id = ${id}`);
      res.json({ ok: true });
    } catch (err) {
      console.error("[QualityNCR] Failed to delete NCR:", err);
      res.status(500).json({ error: "Failed to delete NCR report" });
    }
  });

  app.post("/api/quality/ncrs/:id/comments", requireAuth, async (req: Request, res: Response) => {
    try {
      await ensureNcrTables();
      const user = getEffectiveUser(req);
      const id = Number(req.params.id);
      await db.execute(sql`INSERT INTO ncr_comments (ncr_id, user_id, comment, created_at) VALUES (${id}, ${user?.id}, ${req.body?.comment || ""}, ${new Date().toISOString()})`);
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error("[QualityNCR] Failed to add comment:", err);
      res.status(500).json({ error: "Failed to add comment" });
    }
  });

  app.get("/api/quality/dashboard", requireAuth, async (req: Request, res: Response, next) => {
    if (!req.query.project_id) return next();
    try {
      await ensureNcrTables();
      const projectId = Number(req.query.project_id);
      const isPostgres = getDbMode() === "postgres";
      const daysDiffExpr = isPostgres
        ? "EXTRACT(EPOCH FROM (closed_at::timestamp - created_at::timestamp)) / 86400"
        : "julianday(closed_at) - julianday(created_at)";
      const nowDiffExpr = isPostgres
        ? "EXTRACT(EPOCH FROM (NOW() - created_at::timestamp)) / 86400"
        : "julianday('now') - julianday(created_at)";
      const monthExpr = isPostgres
        ? "TO_CHAR(created_at::timestamp, 'YYYY-MM')"
        : "substr(created_at,1,7)";

      const bySeverity = await db.execute(sql`SELECT severity, COUNT(*) as count FROM ncr_reports WHERE project_id = ${projectId} AND status <> 'closed' GROUP BY severity`);
      const avgClose = await db.execute(sql`SELECT AVG(${sql.raw(daysDiffExpr)}) as avg_days FROM ncr_reports WHERE project_id = ${projectId} AND closed_at IS NOT NULL`);
      const trend = await db.execute(sql`SELECT ${sql.raw(monthExpr)} as month, COUNT(*) as opened, SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) as closed FROM ncr_reports WHERE project_id = ${projectId} GROUP BY ${sql.raw(monthExpr)} ORDER BY month ASC`);
      const openCount = Number(((bySeverity as any).rows || []).reduce((sum: number, r: any) => sum + Number(r.count || 0), 0));
      const slaCompliant = await db.execute(sql`SELECT COUNT(*) as total, SUM(CASE WHEN (status='closed' AND (${sql.raw(daysDiffExpr)}) <= 30) OR (status<>'closed' AND (${sql.raw(nowDiffExpr)}) <= 30) THEN 1 ELSE 0 END) as compliant FROM ncr_reports WHERE project_id = ${projectId}`);
      const total = Number((slaCompliant as any).rows?.[0]?.total || 0);
      const compliant = Number((slaCompliant as any).rows?.[0]?.compliant || 0);
      res.json({
        openNcrsBySeverity: (bySeverity as any).rows || [],
        averageTimeToCloseDays: Number((avgClose as any).rows?.[0]?.avg_days || 0),
        ncrTrend: (trend as any).rows || [],
        inspectionPassRate: Math.max(60, 100 - openCount * 3),
        slaCompliancePercentage: total > 0 ? Math.round((compliant / total) * 100) : 100,
      });
    } catch (err) {
      console.error("[QualityNCR] Failed to fetch dashboard:", err);
      res.status(500).json({ error: "Failed to fetch quality dashboard" });
    }
  });
}
