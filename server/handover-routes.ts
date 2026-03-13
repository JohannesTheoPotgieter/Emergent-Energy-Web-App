import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, desc, sql } from "drizzle-orm";
import { verifyToken } from "./jwt";
import { projectInfo, users } from "@shared/schema";
import { logAuditFromReq } from "./audit-logger";

const PM_REVIEW_ROLES = ["PROJECT_MANAGER_SITE", "PROGRAM_MANAGER", "COO_ADMIN", "CEO_ADMIN", "admin"];

function requiresQualityStatus(engineeringStatus: string): boolean {
  const normalized = engineeringStatus.trim().toLowerCase();
  if (!normalized) return true;
  return ["na", "n/a", "not applicable", "not started"].every((token) => !normalized.includes(token));
}

function computeSubmitBlockers(project: any, handover: any): string[] {
  const deliverables = handover?.deliverables || {};
  const engineeringStatus = String(handover?.engineering_status || "").trim();
  const qualityStatus = String(handover?.quality_status || "").trim();

  const missingItems: string[] = [];
  const need = (ok: boolean, label: string) => {
    if (!ok) missingItems.push(label);
  };

  need(!!deliverables?.handoverCharter?.reference, "Handover Charter");
  need(!!deliverables?.siteVisitReport?.reference, "Site Visit Report");
  need(!!deliverables?.signedCostProposal?.reference, "Signed Cost Proposal");
  need(!!project.pm, "PM assignment");
  need(!!handover?.summary, "Scope summary");
  need(!!project.clientId, "Linked master project/client");
  need(!!(handover?.pd_owner || project.pd), "PD owner");
  need(!!engineeringStatus, "Engineering status");
  need(!!handover?.risks, "Risks");
  need(!!handover?.assumptions, "Assumptions");
  if (requiresQualityStatus(engineeringStatus)) {
    need(!!qualityStatus, "Quality status");
  }
  return missingItems;
}

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

  app.get("/api/pd-pm-handover/status-map", requireAuth, async (_req: Request, res: Response) => {
    try {
      const rows: any[] = await db.execute(sql.raw(`SELECT project_id, status FROM project_pd_pm_handover`)).then((r: any) => (Array.isArray(r) ? r : r.rows || []));
      const statusMap: Record<string, string> = {};
      for (const row of rows) statusMap[String(row.project_id)] = row.status || "DRAFT";
      res.json({ statusMap });
    } catch (err: any) {
      console.error("[handover] GET status-map error:", err);
      res.status(500).json({
        error: "Could not load handover statuses. Likely reason: data access error. How to fix: refresh and retry; if it persists contact your admin.",
      });
    }
  });

  app.get("/api/pd-pm-handover/submitted", requireAuth, async (_req: Request, res: Response) => {
    try {
      const rows: any[] = await db.execute(sql.raw(`
        SELECT h.project_id, h.status, h.updated_at, p.project_name, p.pd, p.pm
        FROM project_pd_pm_handover h
        JOIN project_info p ON p.id = h.project_id
        WHERE h.status IN ('SUBMITTED_FOR_PM_REVIEW', 'REJECTED')
        ORDER BY h.updated_at DESC
      `)).then((r: any) => (Array.isArray(r) ? r : r.rows || []));
      res.json({ items: rows });
    } catch (err: any) {
      console.error("[handover] GET submitted error:", err);
      res.status(500).json({ error: "Could not load PM review queue. Refresh and retry." });
    }
  });

  app.get("/api/pd-pm-handover/control", requireAuth, async (_req: Request, res: Response) => {
    try {
      const rows: any[] = await db.execute(sql.raw(`
        SELECT
          p.id AS project_id,
          p.project_name,
          p.client_name,
          p.pd,
          p.pm,
          p.excel_tracker_link,
          p.execution_enabled,
          h.status AS handover_status,
          h.pd_owner,
          h.pm_owner,
          h.submitted_at AS submitted_date,
          h.updated_at,
          h.rejection_reason,
          h.deliverables
        FROM project_info p
        LEFT JOIN project_pd_pm_handover h ON h.project_id = p.id
        WHERE p.is_active = true
        ORDER BY COALESCE(h.updated_at, p.updated_at) DESC NULLS LAST, p.project_name ASC
      `)).then((r: any) => (Array.isArray(r) ? r : r.rows || []));

      const now = Date.now();
      const items = rows.map((row) => {
        const status = row.handover_status || "DRAFT";
        const deliverables = typeof row.deliverables === "string" ? JSON.parse(row.deliverables) : (row.deliverables || {});
        const deliverablesComplete = ["handoverCharter", "siteVisitReport", "signedCostProposal"].every((key) => Boolean(deliverables?.[key]));
        const trackerLinked = Boolean(row.excel_tracker_link);
        const executionEnabled = row.execution_enabled === true;
        const daysInStatus = row.updated_at ? Math.max(0, Math.floor((now - new Date(row.updated_at).getTime()) / (1000 * 60 * 60 * 24))) : 0;

        let nextAction = "Continue lifecycle progression";
        let actionOwner = row.pm || row.pm_owner || "Operations";
        if (status !== "ACCEPTED") {
          nextAction = status === "SUBMITTED_FOR_PM_REVIEW" ? "PM decision required" : "PD to complete and submit handover";
          actionOwner = status === "SUBMITTED_FOR_PM_REVIEW" ? (row.pm || row.pm_owner || "PM") : (row.pd || row.pd_owner || "PD");
        } else if (!trackerLinked) {
          nextAction = "Link tracker import";
        } else if (!row.pm && !row.pm_owner) {
          nextAction = "Assign PM owner";
          actionOwner = "Operations";
        }

        return {
          ...row,
          handover_status: status,
          deliverables_complete: deliverablesComplete,
          tracker_linked: trackerLinked,
          execution_enabled: executionEnabled,
          days_in_status: daysInStatus,
          next_action: nextAction,
          action_owner: actionOwner,
        };
      });

      res.json({ items });
    } catch (err: any) {
      console.error("[handover] GET control error:", err);
      res.status(500).json({ error: "Could not load handover control view. Refresh and retry." });
    }
  });

  app.get("/api/pd-pm-handover/:projectId", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project) return res.status(404).json({ error: "Project not found" });

      const rows: any[] = await db.execute(sql.raw(`SELECT * FROM project_pd_pm_handover WHERE project_id = ${projectId} LIMIT 1`)).then((r: any) => (Array.isArray(r) ? r : r.rows || []));
      const handover = rows[0] || null;
      const deliverables = handover?.deliverables || {
        handoverCharter: null,
        siteVisitReport: null,
        signedCostProposal: null,
      };

      const missingItems = computeSubmitBlockers(project, handover);

      res.json({
        project,
        handover: handover ? { ...handover, deliverables } : { status: "DRAFT", deliverables },
        blockers: missingItems,
      });
    } catch (err: any) {
      console.error("[handover] GET pd-pm handover error:", err);
      res.status(500).json({ error: "Could not load handover. Refresh and retry." });
    }
  });

  app.put("/api/pd-pm-handover/:projectId/draft", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project) return res.status(404).json({ error: "Project not found" });

      const body = req.body || {};
      const user = (req as any).user as any;
      const existing: any[] = await db.execute(sql.raw(`SELECT id, status FROM project_pd_pm_handover WHERE project_id = ${projectId}`)).then((r: any) => (Array.isArray(r) ? r : r.rows || []));
      const safeDeliverables = JSON.stringify(body.deliverables || {});

      if (existing.length > 0) {
        await db.execute(sql.raw(`
          UPDATE project_pd_pm_handover
          SET pd_owner = ${body.pdOwner ? `'${String(body.pdOwner).replace(/'/g, "''")}'` : "NULL"},
              pm_owner = ${body.pmOwner ? `'${String(body.pmOwner).replace(/'/g, "''")}'` : "NULL"},
              summary = ${body.summary ? `'${String(body.summary).replace(/'/g, "''")}'` : "NULL"},
              risks = ${body.risks ? `'${String(body.risks).replace(/'/g, "''")}'` : "NULL"},
              assumptions = ${body.assumptions ? `'${String(body.assumptions).replace(/'/g, "''")}'` : "NULL"},
              engineering_status = ${body.engineeringStatus ? `'${String(body.engineeringStatus).replace(/'/g, "''")}'` : "NULL"},
              quality_status = ${body.qualityStatus ? `'${String(body.qualityStatus).replace(/'/g, "''")}'` : "NULL"},
              notes_to_pm = ${body.notesToPm ? `'${String(body.notesToPm).replace(/'/g, "''")}'` : "NULL"},
              deliverables = '${safeDeliverables.replace(/'/g, "''")}'::jsonb,
              handover_summary = ${body.handoverSummary ? `'${String(body.handoverSummary).replace(/'/g, "''")}'` : "NULL"},
              handover_status_text = 'Draft',
              updated_at = NOW()
          WHERE project_id = ${projectId}
        `));
      } else {
        await db.execute(sql.raw(`
          INSERT INTO project_pd_pm_handover (project_id, status, pd_owner, pm_owner, summary, risks, assumptions, engineering_status, quality_status, notes_to_pm, deliverables, handover_summary, created_at, updated_at)
          VALUES (${projectId}, 'DRAFT',
            ${body.pdOwner ? `'${String(body.pdOwner).replace(/'/g, "''")}'` : "NULL"},
            ${body.pmOwner ? `'${String(body.pmOwner).replace(/'/g, "''")}'` : "NULL"},
            ${body.summary ? `'${String(body.summary).replace(/'/g, "''")}'` : "NULL"},
            ${body.risks ? `'${String(body.risks).replace(/'/g, "''")}'` : "NULL"},
            ${body.assumptions ? `'${String(body.assumptions).replace(/'/g, "''")}'` : "NULL"},
            ${body.engineeringStatus ? `'${String(body.engineeringStatus).replace(/'/g, "''")}'` : "NULL"},
            ${body.qualityStatus ? `'${String(body.qualityStatus).replace(/'/g, "''")}'` : "NULL"},
            ${body.notesToPm ? `'${String(body.notesToPm).replace(/'/g, "''")}'` : "NULL"},
            '${safeDeliverables.replace(/'/g, "''")}'::jsonb,
            ${body.handoverSummary ? `'${String(body.handoverSummary).replace(/'/g, "''")}'` : "NULL"}, NOW(), NOW())
        `));
      }
      if (body.excelTrackerLink && body.status === "ACCEPTED") {
        await db.update(projectInfo).set({ excelTrackerLink: body.excelTrackerLink, updatedAt: new Date() }).where(eq(projectInfo.id, projectId));
      }
      logAuditFromReq(req, { entityType: "pd_pm_handover", entityId: String(projectId), action: "draft.saved", projectName: project.projectName, changesJson: { updatedBy: user?.name || "Unknown" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[handover] PUT draft error:", err);
      res.status(500).json({ error: "Could not save handover draft. Check your connection and retry. If it persists, contact your admin." });
    }
  });

  app.post("/api/pd-pm-handover/:projectId/submit", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const rows: any[] = await db.execute(sql.raw(`SELECT * FROM project_pd_pm_handover WHERE project_id = ${projectId} LIMIT 1`)).then((r: any) => (Array.isArray(r) ? r : r.rows || []));
      const handover = rows[0];
      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project || !handover) return res.status(400).json({ error: "Could not submit handover. Likely reason: no draft exists. Save a draft and retry." });
      const missing = computeSubmitBlockers(project, handover);
      if (missing.length > 0) {
        return res.status(400).json({
          error: `Cannot submit handover. Missing items: ${missing.join(", ")}. Complete these fields/documents, then retry.`,
          missingItems: missing,
        });
      }
      const user = (req as any).user as any;
      await db.execute(sql.raw(`UPDATE project_pd_pm_handover SET status = 'SUBMITTED_FOR_PM_REVIEW', handover_status_text = 'Submitted for PM Review', submitted_by = '${(user?.name || 'Unknown').replace(/'/g, "''")}', submitted_at = NOW(), updated_at = NOW() WHERE project_id = ${projectId}`));
      res.json({ success: true, status: "SUBMITTED_FOR_PM_REVIEW" });
    } catch (err: any) {
      console.error("[handover] submit error:", err);
      res.status(500).json({ error: "Could not submit handover. Likely reason: required deliverables are missing. Upload the missing files and retry." });
    }
  });

  app.post("/api/pd-pm-handover/:projectId/accept", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const user = (req as any).user as any;
      if (!PM_REVIEW_ROLES.includes(user?.role)) {
        return res.status(403).json({ error: "Could not accept handover. Likely reason: your PM permission is missing or the handover is incomplete. Refresh, verify access, and retry." });
      }
      const rows: any[] = await db.execute(sql.raw(`SELECT * FROM project_pd_pm_handover WHERE project_id = ${projectId} LIMIT 1`)).then((r: any) => (Array.isArray(r) ? r : r.rows || []));
      const handover = rows[0];
      if (!handover || handover.status !== "SUBMITTED_FOR_PM_REVIEW") {
        return res.status(400).json({ error: "Cannot accept handover: no submitted handover found for PM review." });
      }
      await db.execute(sql.raw(`UPDATE project_pd_pm_handover SET status = 'ACCEPTED', handover_status_text = 'Accepted', accepted_by = '${(user?.name || 'Unknown').replace(/'/g, "''")}', accepted_at = NOW(), updated_at = NOW(), rejection_reason = NULL WHERE project_id = ${projectId}`));
      await db.update(projectInfo).set({ executionEnabled: true, executionGateStatus: "ENABLED", phase: "PM Active", updatedAt: new Date() }).where(eq(projectInfo.id, projectId));
      logAuditFromReq(req, { entityType: "pd_pm_handover", entityId: String(projectId), action: "accepted", changesJson: { acceptedBy: user?.name } });
      res.json({ success: true, status: "ACCEPTED" });
    } catch (err: any) {
      console.error("[handover] accept error:", err);
      res.status(500).json({ error: "Could not accept handover. Likely reason: your PM permission is missing or the handover is incomplete. Refresh, verify access, and retry." });
    }
  });

  app.post("/api/pd-pm-handover/:projectId/reject", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      const reason = String(req.body?.reason || "").trim();
      if (!reason) return res.status(400).json({ error: "Rejection reason is required." });
      const user = (req as any).user as any;
      if (!PM_REVIEW_ROLES.includes(user?.role)) {
        return res.status(403).json({ error: "Could not reject handover. Likely reason: your PM permission is missing. Refresh, verify PM access, and retry." });
      }
      await db.execute(sql.raw(`UPDATE project_pd_pm_handover SET status = 'REJECTED', handover_status_text = 'Rejected', rejected_by = '${(user?.name || 'Unknown').replace(/'/g, "''")}', rejected_at = NOW(), rejection_reason = '${reason.replace(/'/g, "''")}', updated_at = NOW() WHERE project_id = ${projectId}`));
      await db.update(projectInfo).set({ executionEnabled: false, executionGateStatus: "NOT_ELIGIBLE", updatedAt: new Date() }).where(eq(projectInfo.id, projectId));
      res.json({ success: true, status: "REJECTED" });
    } catch (err: any) {
      console.error("[handover] reject error:", err);
      res.status(500).json({ error: "Could not reject handover. Check reason and retry." });
    }
  });

  app.put("/api/pd-pm-handover/:projectId/excel-tracker", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const user = (req as any).user as any;
      if (!PM_REVIEW_ROLES.includes(user?.role)) {
        return res.status(403).json({ error: "Could not update Excel tracker link. Likely reason: PM/admin access is required." });
      }

      const trackerLink = String(req.body?.excelTrackerLink || "").trim();
      if (!trackerLink) {
        return res.status(400).json({ error: "PM Excel Tracker Link is required." });
      }
      if (!/^https?:\/\//i.test(trackerLink)) {
        return res.status(400).json({ error: "PM Excel Tracker Link must start with http:// or https://" });
      }

      const rows: any[] = await db.execute(sql.raw(`SELECT status FROM project_pd_pm_handover WHERE project_id = ${projectId} LIMIT 1`)).then((r: any) => (Array.isArray(r) ? r : r.rows || []));
      const handover = rows[0];
      if (!handover || handover.status !== "ACCEPTED") {
        return res.status(400).json({ error: "Excel tracker link can only be updated after handover is accepted." });
      }

      await db.update(projectInfo).set({ excelTrackerLink: trackerLink, updatedAt: new Date() }).where(eq(projectInfo.id, projectId));
      logAuditFromReq(req, { entityType: "pd_pm_handover", entityId: String(projectId), action: "excel_tracker.updated", changesJson: { updatedBy: user?.name || "Unknown" } });

      res.json({ success: true });
    } catch (err: any) {
      console.error("[handover] excel tracker update error:", err);
      res.status(500).json({ error: "Could not update Excel tracker link. Refresh and retry. If it persists, contact your admin." });
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

      CREATE TABLE IF NOT EXISTS project_pd_pm_handover (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL UNIQUE REFERENCES project_info(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        handover_status_text TEXT,
        pd_owner TEXT,
        pm_owner TEXT,
        summary TEXT,
        risks TEXT,
        assumptions TEXT,
        engineering_status TEXT,
        quality_status TEXT,
        notes_to_pm TEXT,
        handover_summary TEXT,
        deliverables JSONB NOT NULL DEFAULT '{}'::jsonb,
        submitted_by TEXT,
        submitted_at TIMESTAMP,
        accepted_by TEXT,
        accepted_at TIMESTAMP,
        rejected_by TEXT,
        rejected_at TIMESTAMP,
        rejection_reason TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `));
    console.log("[Handover] Tables ensured");
  } catch (err: any) {
    console.error("[Handover] Table creation error:", err.message);
  }
}
