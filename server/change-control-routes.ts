import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, sql, desc } from "drizzle-orm";
import { verifyToken } from "./jwt";
import { changeRequests, projectInfo, users, approvals } from "@shared/schema";
import { requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  if (req.isAuthenticated?.()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const payload = verifyToken(authHeader.substring(7));
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

const VALID_STATUSES = ['draft', 'submitted', 'under_review', 'approved', 'rejected', 'implemented', 'closed'] as const;
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['submitted'],
  submitted: ['under_review', 'rejected'],
  under_review: ['approved', 'rejected'],
  approved: ['implemented', 'closed'],
  rejected: ['draft', 'closed'],
  implemented: ['closed'],
  closed: [],
};

export async function ensureChangeControlTables() {
  try {
    await db.execute(sql.raw(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'change_request_type') THEN CREATE TYPE change_request_type AS ENUM ('scope','cost','schedule','technical','commercial'); END IF; END $$`));
    await db.execute(sql.raw(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'change_request_status') THEN CREATE TYPE change_request_status AS ENUM ('draft','submitted','under_review','approved','rejected','implemented','closed'); END IF; END $$`));
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS change_requests (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES project_info(id),
      title TEXT NOT NULL,
      description TEXT,
      change_type change_request_type NOT NULL,
      requested_by_user_id INTEGER REFERENCES users(id),
      owner_user_id INTEGER REFERENCES users(id),
      impact_summary TEXT,
      cost_impact REAL,
      schedule_impact_days INTEGER,
      status change_request_status NOT NULL DEFAULT 'draft',
      approval_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`));
    console.log("[ChangeControl] Tables ensured");
  } catch (err: any) {
    console.error("[ChangeControl] Table error:", err.message);
  }
}

export function registerChangeControlRoutes(app: Express) {
  app.get("/api/change-requests/project/:projectId", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

      const rows = await db.execute(sql.raw(`
        SELECT cr.*, 
          u1.name as requested_by_name, 
          u2.name as owner_name,
          pi.project_name
        FROM change_requests cr
        LEFT JOIN users u1 ON cr.requested_by_user_id = u1.id
        LEFT JOIN users u2 ON cr.owner_user_id = u2.id
        LEFT JOIN project_info pi ON cr.project_id = pi.id
        WHERE cr.project_id = ${projectId}
        ORDER BY cr.created_at DESC
      `));
      const items = Array.isArray(rows) ? rows : (rows as any).rows || [];
      res.json(items);
    } catch (err: any) {
      console.error("[ChangeControl] List error:", err.message);
      res.status(500).json({ error: "Failed to fetch change requests" });
    }
  });

  app.get("/api/change-requests/:id", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await db.execute(sql.raw(`
        SELECT cr.*, u1.name as requested_by_name, u2.name as owner_name, pi.project_name
        FROM change_requests cr
        LEFT JOIN users u1 ON cr.requested_by_user_id = u1.id
        LEFT JOIN users u2 ON cr.owner_user_id = u2.id
        LEFT JOIN project_info pi ON cr.project_id = pi.id
        WHERE cr.id = ${id}
      `));
      const items = Array.isArray(rows) ? rows : (rows as any).rows || [];
      if (items.length === 0) return res.status(404).json({ error: "Not found" });
      res.json(items[0]);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch change request" });
    }
  });

  app.post("/api/change-requests", jwtAuth, requireAuth, requirePermission("projects", "create"), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { projectId, title, description, changeType, ownerUserId, impactSummary, costImpact, scheduleImpactDays } = req.body;
      if (!projectId || !title || !changeType) return res.status(400).json({ error: "projectId, title, changeType required" });

      const result = await db.insert(changeRequests).values({
        projectId,
        title,
        description: description || null,
        changeType,
        requestedByUserId: user.id,
        ownerUserId: ownerUserId || null,
        impactSummary: impactSummary || null,
        costImpact: costImpact || null,
        scheduleImpact: scheduleImpactDays || null,
        status: 'draft',
      }).returning();

      logAuditFromReq(req, {
        entityType: "change_request",
        entityId: String(result[0].id),
        action: "create",
        changesJson: { title, changeType, projectId },
      });

      res.status(201).json(result[0]);
    } catch (err: any) {
      console.error("[ChangeControl] Create error:", err.message);
      res.status(500).json({ error: "Failed to create change request" });
    }
  });

  app.patch("/api/change-requests/:id", jwtAuth, requireAuth, requirePermission("projects", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const existing = await db.select().from(changeRequests).where(eq(changeRequests.id, id));
      if (existing.length === 0) return res.status(404).json({ error: "Not found" });
      const old = existing[0];

      const updates: any = { updatedAt: new Date() };
      const { title, description, changeType, ownerUserId, impactSummary, costImpact, scheduleImpactDays, status } = req.body;

      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (changeType !== undefined) updates.changeType = changeType;
      if (ownerUserId !== undefined) updates.ownerUserId = ownerUserId;
      if (impactSummary !== undefined) updates.impactSummary = impactSummary;
      if (costImpact !== undefined) updates.costImpact = costImpact;
      if (scheduleImpactDays !== undefined) updates.scheduleImpact = scheduleImpactDays;

      if (status !== undefined && status !== old.status) {
        const allowed = VALID_TRANSITIONS[old.status] || [];
        if (!allowed.includes(status)) {
          return res.status(400).json({ error: `Cannot transition from ${old.status} to ${status}` });
        }
        updates.status = status;

        if (status === 'submitted') {
          try {
            const user = (req as any).user;
            const approvalResult = await db.insert(approvals).values({
              type: 'change_request',
              title: `Change Request: ${old.title}`,
              description: old.impactSummary || old.description || '',
              status: 'pending',
              requestedBy: user.id,
            }).returning();
            updates.approvalId = approvalResult[0].id;
          } catch (approvalErr: any) {
            console.warn("[ChangeControl] Approval creation failed:", approvalErr.message);
          }
        }
      }

      const result = await db.update(changeRequests).set(updates).where(eq(changeRequests.id, id)).returning();

      logAuditFromReq(req, {
        entityType: "change_request",
        entityId: String(id),
        action: "update",
        changesJson: { before: { status: old.status }, after: { status: result[0].status }, updates: req.body },
      });

      res.json(result[0]);
    } catch (err: any) {
      console.error("[ChangeControl] Update error:", err.message);
      res.status(500).json({ error: "Failed to update change request" });
    }
  });

  app.delete("/api/change-requests/:id", jwtAuth, requireAuth, requirePermission("projects", "delete"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const existing = await db.select().from(changeRequests).where(eq(changeRequests.id, id));
      if (existing.length === 0) return res.status(404).json({ error: "Not found" });

      await db.delete(changeRequests).where(eq(changeRequests.id, id));

      logAuditFromReq(req, {
        entityType: "change_request",
        entityId: String(id),
        action: "delete",
        changesJson: { title: existing[0].title, status: existing[0].status },
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to delete change request" });
    }
  });

  app.get("/api/change-requests/cross-project/summary", jwtAuth, requireAuth, async (_req: Request, res: Response) => {
    try {
      const rows = await db.execute(sql.raw(`
        SELECT cr.status, cr.change_type, COUNT(*)::int as count, pi.project_name
        FROM change_requests cr
        JOIN project_info pi ON cr.project_id = pi.id
        WHERE cr.status NOT IN ('closed')
        GROUP BY cr.status, cr.change_type, pi.project_name
        ORDER BY pi.project_name, cr.status
      `));
      const items = Array.isArray(rows) ? rows : (rows as any).rows || [];
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch cross-project summary" });
    }
  });
}
