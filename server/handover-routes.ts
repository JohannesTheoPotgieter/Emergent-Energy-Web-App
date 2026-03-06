import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, desc, sql } from "drizzle-orm";
import { verifyToken } from "./jwt";
import { projectInfo, users } from "@shared/schema";
import { logAuditFromReq } from "./audit-logger";

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
  res.status(401).json({ error: "auth_required", message: "Authentication required" });
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = (req as any).user?.role;
  if (role === "admin" || role === "COO_ADMIN" || role === "CEO_ADMIN") return next();
  res.status(403).json({ error: "Admin access required" });
}

const GATE_DEFINITIONS = [
  {
    gateId: "PD_TO_ENG",
    label: "PD → Engineering",
    fromRole: "Project Developer",
    toRole: "Engineer",
    checklist: [
      "Site assessment completed",
      "Client contract signed",
      "Cost proposal approved",
      "Project info captured in system",
    ],
  },
  {
    gateId: "ENG_TO_PM",
    label: "Engineering → PM",
    fromRole: "Engineer",
    toRole: "Project Manager",
    checklist: [
      "Engineering design pack complete",
      "BOM finalised",
      "Procurement packages released",
      "Construction timeline confirmed",
    ],
  },
  {
    gateId: "PM_TO_QM",
    label: "PM → Quality",
    fromRole: "Project Manager",
    toRole: "Quality Manager",
    checklist: [
      "Construction substantially complete",
      "Punch list items addressed",
      "As-built drawings updated",
      "Commissioning test plan ready",
    ],
  },
  {
    gateId: "EXEC_TO_CLOSEOUT",
    label: "Execution → Closeout",
    fromRole: "Quality Manager",
    toRole: "Program Manager",
    checklist: [
      "Commissioning tests passed",
      "Client handover completed",
      "All deliverables submitted",
      "Financial close-out initiated",
    ],
  },
];

export function registerHandoverRoutes(app: Express) {
  app.use("/api/projects/:id/handover-gates", jwtAuth);
  app.use("/api/projects/:id/handover-history", jwtAuth);

  app.get("/api/projects/:id/handover-gates", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const [project] = await db.select({
        id: projectInfo.id,
        projectName: projectInfo.projectName,
        phase: projectInfo.phase,
        pd: projectInfo.pd,
        pm: projectInfo.pm,
      }).from(projectInfo).where(eq(projectInfo.id, projectId));

      if (!project) return res.status(404).json({ error: "Project not found" });

      const gateRows: any[] = await db.execute(sql.raw(
        `SELECT * FROM project_handover_gates WHERE project_id = ${projectId} ORDER BY id`
      )).then((r: any) => (Array.isArray(r) ? r : r.rows || []));

      const gateMap = new Map<string, any>();
      for (const row of gateRows) {
        gateMap.set(row.gate_id, row);
      }

      const gates = GATE_DEFINITIONS.map(def => {
        const dbGate = gateMap.get(def.gateId);
        const checkedItems: string[] = dbGate?.checked_items ? (typeof dbGate.checked_items === "string" ? JSON.parse(dbGate.checked_items) : dbGate.checked_items) : [];
        return {
          gateId: def.gateId,
          label: def.label,
          fromRole: def.fromRole,
          toRole: def.toRole,
          checklist: def.checklist,
          checkedItems,
          status: dbGate?.status || "PENDING",
          completedAt: dbGate?.completed_at || null,
          completedByUserId: dbGate?.completed_by_user_id || null,
          completedByName: dbGate?.completed_by_name || null,
        };
      });

      res.json({ projectId, projectName: project.projectName, gates });
    } catch (err: any) {
      console.error("[handover] GET gates error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/projects/:id/handover-gates/:gateId/complete", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const gateId = req.params.gateId;
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const gateDef = GATE_DEFINITIONS.find(g => g.gateId === gateId);
      if (!gateDef) return res.status(400).json({ error: "Invalid gate ID" });

      const [project] = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName })
        .from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project) return res.status(404).json({ error: "Project not found" });

      const { checkedItems, notes } = req.body;
      if (!checkedItems || !Array.isArray(checkedItems)) {
        return res.status(400).json({ error: "checkedItems array required" });
      }

      const missingItems = gateDef.checklist.filter(item => !checkedItems.includes(item));
      if (missingItems.length > 0) {
        return res.status(400).json({
          error: "All checklist items must be checked before completing gate",
          missingItems,
        });
      }

      const userId = ((req as any).user as any)?.id;
      const userName = ((req as any).user as any)?.name || "Unknown";
      const userRole = ((req as any).user as any)?.role || "unknown";

      const existingRows: any[] = await db.execute(sql.raw(
        `SELECT id, status FROM project_handover_gates WHERE project_id = ${projectId} AND gate_id = '${gateId}'`
      )).then((r: any) => (Array.isArray(r) ? r : r.rows || []));

      const checkedJson = JSON.stringify(checkedItems);

      if (existingRows.length > 0) {
        await db.execute(sql.raw(
          `UPDATE project_handover_gates SET status = 'COMPLETE', checked_items = '${checkedJson}'::jsonb, completed_at = NOW(), completed_by_user_id = ${userId}, completed_by_name = '${userName.replace(/'/g, "''")}', notes = ${notes ? `'${String(notes).replace(/'/g, "''")}'` : "NULL"}, updated_at = NOW() WHERE project_id = ${projectId} AND gate_id = '${gateId}'`
        ));
      } else {
        await db.execute(sql.raw(
          `INSERT INTO project_handover_gates (project_id, gate_id, status, checked_items, completed_at, completed_by_user_id, completed_by_name, notes) VALUES (${projectId}, '${gateId}', 'COMPLETE', '${checkedJson}'::jsonb, NOW(), ${userId}, '${userName.replace(/'/g, "''")}', ${notes ? `'${String(notes).replace(/'/g, "''")}'` : "NULL"})`
        ));
      }

      await db.execute(sql.raw(
        `INSERT INTO project_handover_history (project_id, gate_id, action, performed_by_user_id, performed_by_name, performed_by_role, details) VALUES (${projectId}, '${gateId}', 'GATE_COMPLETED', ${userId}, '${userName.replace(/'/g, "''")}', '${userRole}', '${JSON.stringify({ checkedItems, notes: notes || null }).replace(/'/g, "''")}'::jsonb)`
      ));

      logAuditFromReq(req, {
        entityType: "handover_gate",
        entityId: String(projectId),
        action: "gate.completed",
        projectName: project.projectName,
        changesJson: { gateId, checkedItems, notes },
      });

      res.json({ success: true, gateId, status: "COMPLETE" });
    } catch (err: any) {
      console.error("[handover] POST complete error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/projects/:id/handover-gates/:gateId/update-checklist", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const gateId = req.params.gateId;
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const gateDef = GATE_DEFINITIONS.find(g => g.gateId === gateId);
      if (!gateDef) return res.status(400).json({ error: "Invalid gate ID" });

      const { checkedItems } = req.body;
      if (!checkedItems || !Array.isArray(checkedItems)) {
        return res.status(400).json({ error: "checkedItems array required" });
      }

      const checkedJson = JSON.stringify(checkedItems);

      const existingRows: any[] = await db.execute(sql.raw(
        `SELECT id FROM project_handover_gates WHERE project_id = ${projectId} AND gate_id = '${gateId}'`
      )).then((r: any) => (Array.isArray(r) ? r : r.rows || []));

      if (existingRows.length > 0) {
        await db.execute(sql.raw(
          `UPDATE project_handover_gates SET checked_items = '${checkedJson}'::jsonb, updated_at = NOW() WHERE project_id = ${projectId} AND gate_id = '${gateId}'`
        ));
      } else {
        await db.execute(sql.raw(
          `INSERT INTO project_handover_gates (project_id, gate_id, status, checked_items) VALUES (${projectId}, '${gateId}', 'PENDING', '${checkedJson}'::jsonb)`
        ));
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("[handover] POST update-checklist error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/projects/:id/handover-gates/:gateId/reopen", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const gateId = req.params.gateId;
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const role = ((req as any).user as any)?.role || "";
      const ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN", "admin", "PROGRAM_MANAGER"];
      if (!ADMIN_ROLES.includes(role)) {
        return res.status(403).json({ error: "Only admin/program manager can reopen gates" });
      }

      const [project] = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName })
        .from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project) return res.status(404).json({ error: "Project not found" });

      const userId = ((req as any).user as any)?.id;
      const userName = ((req as any).user as any)?.name || "Unknown";
      const userRole = role;
      const { reason } = req.body;

      await db.execute(sql.raw(
        `UPDATE project_handover_gates SET status = 'PENDING', completed_at = NULL, completed_by_user_id = NULL, completed_by_name = NULL, updated_at = NOW() WHERE project_id = ${projectId} AND gate_id = '${gateId}'`
      ));

      await db.execute(sql.raw(
        `INSERT INTO project_handover_history (project_id, gate_id, action, performed_by_user_id, performed_by_name, performed_by_role, details) VALUES (${projectId}, '${gateId}', 'GATE_REOPENED', ${userId}, '${userName.replace(/'/g, "''")}', '${userRole}', '${JSON.stringify({ reason: reason || null }).replace(/'/g, "''")}'::jsonb)`
      ));

      logAuditFromReq(req, {
        entityType: "handover_gate",
        entityId: String(projectId),
        action: "gate.reopened",
        projectName: project.projectName,
        changesJson: { gateId, reason },
      });

      res.json({ success: true, gateId, status: "PENDING" });
    } catch (err: any) {
      console.error("[handover] POST reopen error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/projects/:id/handover-history", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const rows: any[] = await db.execute(sql.raw(
        `SELECT * FROM project_handover_history WHERE project_id = ${projectId} ORDER BY performed_at DESC LIMIT 50`
      )).then((r: any) => (Array.isArray(r) ? r : r.rows || []));

      const history = rows.map(r => ({
        id: r.id,
        gateId: r.gate_id,
        action: r.action,
        performedByName: r.performed_by_name,
        performedByRole: r.performed_by_role,
        performedAt: r.performed_at,
        details: typeof r.details === "string" ? JSON.parse(r.details) : r.details,
      }));

      res.json({ history });
    } catch (err: any) {
      console.error("[handover] GET history error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}

export async function ensureHandoverTables() {
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS project_handover_gates (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
        gate_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        checked_items JSONB DEFAULT '[]',
        completed_at TIMESTAMP,
        completed_by_user_id INTEGER REFERENCES users(id),
        completed_by_name TEXT,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(project_id, gate_id)
      );

      CREATE TABLE IF NOT EXISTS project_handover_history (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
        gate_id TEXT NOT NULL,
        action TEXT NOT NULL,
        performed_by_user_id INTEGER REFERENCES users(id),
        performed_by_name TEXT,
        performed_by_role TEXT,
        details JSONB,
        performed_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `));
    console.log("[Handover] Tables ensured");
  } catch (err: any) {
    console.error("[Handover] Table creation error:", err.message);
  }
}
