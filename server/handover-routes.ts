// @ts-nocheck
import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, desc, sql, and, inArray } from "drizzle-orm";
import { verifyToken } from "./jwt";
import { projectInfo, projectPhaseHistory, users, projectExecutionState, projectPdPmHandover, projectHandoverHistory, clients, evidenceOverrideRecords } from "@shared/schema";
import { syncProjectSplitTables } from "./lib/project-info-sync";
import { logAuditFromReq } from "./audit-logger";
import { evaluateEvidence, isEvidenceOverrideAuthorized, upsertEvidenceItem } from "./services/evidence-evaluation-service";
import { storage } from "./storage";
import { computePdPmSubmitBlockers, getProjectDevelopmentWorkspace } from "./services/project-development-workspace-service";
import { requirePermission } from "./permission-middleware";
import { notifyHandoverSubmitted, notifyHandoverAccepted, notifyHandoverRejected } from "./services/notification-service";
import { PM_REVIEW_ROLES, canReviewHandover } from "@shared/roles/pd-roles";
import { z } from "zod";

const deliverableItemSchema = z.object({
  reference: z.string().optional(),
  date: z.string().optional(),
  uploadedBy: z.string().optional(),
  uploadedAt: z.string().optional(),
}).passthrough();

const deliverablesSchema = z.object({
  handoverCharter: deliverableItemSchema.optional().nullable(),
  siteVisitReport: deliverableItemSchema.optional().nullable(),
  signedCostProposal: deliverableItemSchema.optional().nullable(),
}).passthrough();
const PD_PM_HANDOVER_GATE_ID = "PD_PM_HANDOVER";

/** @deprecated Used only by legacy gate management routes. Migrate to Drizzle query builder. */
function escapeSqlText(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function escapeSqlJson(value: unknown): string {
  return `'${JSON.stringify(value ?? {}).replace(/'/g, "''")}'::jsonb`;
}

function escapeSqlNumber(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "NULL";
}

function normalizeDeliverables(value: unknown) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value as Record<string, any>;
  return {};
}

function normalizeHandoverRow(row: any) {
  if (!row) return null;
  return {
    ...row,
    deliverables: normalizeDeliverables(row.deliverables),
  };
}

async function insertPdPmHandoverHistory(params: {
  projectId: number;
  action: string;
  req: Request;
  details?: Record<string, unknown>;
}) {
  const user = (params.req as any).user as any;
  await db.insert(projectHandoverHistory).values({
    projectId: params.projectId,
    gateId: PD_PM_HANDOVER_GATE_ID,
    action: params.action,
    performedByUserId: user?.id || null,
    performedByName: user?.name || "Unknown",
    performedByRole: user?.role || "unknown",
    details: params.details || {},
  });
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

  app.get("/api/projects/:id/handover-gates", requireAuth, requirePermission("handover", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const [project] = await db.select({
        id: projectInfo.id,
        projectName: projectInfo.projectName,
        phase: projectExecutionState.phase,
        pd: projectInfo.pd,
        pm: projectInfo.pm,
      }).from(projectInfo)
        .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
        .where(eq(projectInfo.id, projectId));

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
        let checkedItems: string[] = [];
        if (dbGate?.checked_items) {
          try {
            checkedItems = typeof dbGate.checked_items === "string" ? JSON.parse(dbGate.checked_items) : dbGate.checked_items;
          } catch {
            console.error(`[handover] Corrupted checked_items JSON for gate ${def.gateId}`);
          }
        }
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

  app.post("/api/projects/:id/handover-gates/:gateId/complete", requireAuth, requirePermission("handover", "edit"), async (req: Request, res: Response) => {
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

  app.post("/api/projects/:id/handover-gates/:gateId/update-checklist", requireAuth, requirePermission("handover", "edit"), async (req: Request, res: Response) => {
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

  app.post("/api/projects/:id/handover-gates/:gateId/reopen", requireAuth, requirePermission("handover", "override"), async (req: Request, res: Response) => {
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

  app.get("/api/projects/:id/handover-history", requireAuth, requirePermission("handover", "view"), async (req: Request, res: Response) => {
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
        details: (() => { try { return typeof r.details === "string" ? JSON.parse(r.details) : r.details; } catch { return {}; } })(),
      }));

      res.json({ history });
    } catch (err: any) {
      console.error("[handover] GET history error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/pd-pm-handover/status-map", requireAuth, requirePermission("handover", "view"), async (_req: Request, res: Response) => {
    try {
      const rows = await db.select({ projectId: projectPdPmHandover.projectId, status: projectPdPmHandover.status }).from(projectPdPmHandover);
      const statusMap: Record<string, string> = {};
      for (const row of rows) statusMap[String(row.projectId)] = row.status || "DRAFT";
      res.json({ statusMap });
    } catch (err: any) {
      console.error("[handover] GET status-map error:", err);
      res.status(500).json({
        error: "Could not load handover statuses. Likely reason: data access error. How to fix: refresh and retry; if it persists contact your admin.",
      });
    }
  });

  app.get("/api/pd-pm-handover/submitted", requireAuth, requirePermission("handover", "view"), async (_req: Request, res: Response) => {
    try {
      const rows = await db
        .select({
          project_id: projectPdPmHandover.projectId,
          status: projectPdPmHandover.status,
          updated_at: projectPdPmHandover.updatedAt,
          project_name: projectInfo.projectName,
          pd: projectInfo.pd,
          pm: projectInfo.pm,
        })
        .from(projectPdPmHandover)
        .innerJoin(projectInfo, eq(projectInfo.id, projectPdPmHandover.projectId))
        .where(inArray(projectPdPmHandover.status, ["SUBMITTED_FOR_PM_REVIEW", "REJECTED"]))
        .orderBy(desc(projectPdPmHandover.updatedAt));
      res.json({ items: rows });
    } catch (err: any) {
      console.error("[handover] GET submitted error:", err);
      res.status(500).json({ error: "Could not load PM review queue. Refresh and retry." });
    }
  });

  app.get("/api/pd-pm-handover/control", requireAuth, requirePermission("handover", "view"), async (_req: Request, res: Response) => {
    try {
      const rows = await db
        .select({
          project_id: projectInfo.id,
          project_name: projectInfo.projectName,
          client_name: sql<string>`COALESCE(${clients.name}, '')`,
          pd: projectInfo.pd,
          pm: projectInfo.pm,
          excel_tracker_link: projectInfo.excelTrackerLink,
          execution_enabled: projectInfo.executionEnabled,
          handover_status: projectPdPmHandover.status,
          pd_owner: projectPdPmHandover.pdOwner,
          pm_owner: projectPdPmHandover.pmOwner,
          submitted_date: projectPdPmHandover.submittedAt,
          updated_at: sql<Date>`COALESCE(${projectPdPmHandover.updatedAt}, ${projectInfo.updatedAt})`,
          rejection_reason: projectPdPmHandover.rejectionReason,
          deliverables: projectPdPmHandover.deliverables,
        })
        .from(projectInfo)
        .leftJoin(clients, eq(clients.id, projectInfo.clientId))
        .leftJoin(projectPdPmHandover, eq(projectPdPmHandover.projectId, projectInfo.id))
        .where(eq(projectInfo.isActive, true))
        .orderBy(sql`COALESCE(${projectPdPmHandover.updatedAt}, ${projectInfo.updatedAt}) DESC NULLS LAST`, projectInfo.projectName);

      const now = Date.now();
      const items = rows.map((row) => {
        const status = row.handover_status || "DRAFT";
        const deliverables = normalizeDeliverables(row.deliverables);
        const deliverablesComplete = ["handoverCharter", "siteVisitReport", "signedCostProposal"].every((key) => Boolean((deliverables as any)?.[key]));
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

  app.get("/api/pd-pm-handover/:projectId", requireAuth, requirePermission("handover", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project) return res.status(404).json({ error: "Project not found" });

      const handoverRows = await db.select().from(projectPdPmHandover).where(eq(projectPdPmHandover.projectId, projectId)).limit(1);
      const handover = handoverRows[0] ? normalizeHandoverRow(handoverRows[0]) : null;
      const deliverables = handover?.deliverables || {
        handoverCharter: null,
        siteVisitReport: null,
        signedCostProposal: null,
      };

      const workspace = await getProjectDevelopmentWorkspace({
        projectId,
        projectName: project.projectName,
        canonicalProjectId: project.canonicalProjectId,
        clientId: project.clientId,
        phase: project.phase,
        executionGateStatus: project.executionGateStatus,
        executionEnabled: project.executionEnabled,
        handover: handover ? { ...handover, deliverables } : { deliverables },
      });
      const missingItems = computePdPmSubmitBlockers({
        project,
        handover: handover ? { ...handover, deliverables } : { deliverables },
        workspace,
      });
      const user = (req as any).user as any;
      const evidence = await evaluateEvidence({
        projectId,
        completionType: "pd_pm_handover_submit",
        sourceType: "pd_pm_handover",
        sourceRef: String(projectId),
        evaluatorUserId: user?.id,
        evaluatorName: user?.name,
      });
      const historyRows = await db.select().from(projectHandoverHistory)
        .where(and(eq(projectHandoverHistory.projectId, projectId), eq(projectHandoverHistory.gateId, PD_PM_HANDOVER_GATE_ID)))
        .orderBy(desc(projectHandoverHistory.performedAt))
        .limit(20);
      const history = historyRows.map((row) => ({
        id: row.id,
        action: row.action,
        performedByName: row.performedByName,
        performedByRole: row.performedByRole,
        performedAt: row.performedAt,
        details: (() => { try { return typeof row.details === "string" ? JSON.parse(row.details as string) : row.details; } catch { return {}; } })(),
      }));

      res.json({
        project,
        handover: handover ? { ...handover, deliverables } : { status: "DRAFT", deliverables },
        blockers: missingItems,
        evidence,
        workspace,
        history,
      });
    } catch (err: any) {
      console.error("[handover] GET pd-pm handover error:", err);
      res.status(500).json({ error: "Could not load handover. Refresh and retry." });
    }
  });

  app.put("/api/pd-pm-handover/:projectId/draft", requireAuth, requirePermission("handover", "edit"), async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project) return res.status(404).json({ error: "Project not found" });

      const body = req.body || {};
      const user = (req as any).user as any;

      // Validate deliverables JSONB structure if provided
      if (body.deliverables && typeof body.deliverables === "object" && Object.keys(body.deliverables).length > 0) {
        const parsed = deliverablesSchema.safeParse(body.deliverables);
        if (!parsed.success) {
          return res.status(400).json({
            error: "Invalid deliverables format. Expected structure: { handoverCharter?: { reference, date }, siteVisitReport?: { reference, date }, signedCostProposal?: { reference, date } }",
            details: parsed.error.issues,
          });
        }
      }

      const existing = await db.select({ id: projectPdPmHandover.id }).from(projectPdPmHandover).where(eq(projectPdPmHandover.projectId, projectId)).limit(1);

      const handoverValues = {
        pdOwner: body.pdOwner || null,
        pmOwner: body.pmOwner || null,
        summary: body.summary || null,
        risks: body.risks || null,
        assumptions: body.assumptions || null,
        feasibilityStatus: body.feasibilityStatus || null,
        feasibilityNotes: body.feasibilityNotes || null,
        dependencySummary: body.dependencySummary || null,
        handoverReadinessStatus: body.handoverReadinessStatus || null,
        handoverReadinessNotes: body.handoverReadinessNotes || null,
        engineeringStatus: body.engineeringStatus || null,
        qualityStatus: body.qualityStatus || null,
        notesToPm: body.notesToPm || null,
        deliverables: body.deliverables || {},
        handoverSummary: body.handoverSummary || null,
        handoverStatusText: "Draft",
        updatedAt: new Date(),
      };

      if (existing.length > 0) {
        await db.update(projectPdPmHandover).set(handoverValues).where(eq(projectPdPmHandover.projectId, projectId));
      } else {
        await db.insert(projectPdPmHandover).values({
          projectId,
          status: "DRAFT",
          ...handoverValues,
        });
      }
      if (body.latestUpdate !== undefined) {
        const latestUpdateText = String(body.latestUpdate || "").trim();
        const actorName = user?.name || user?.role || "Unknown";
        await storage.upsertProjectEditableFields({
          projectName: project.projectName,
          latestUpdate: latestUpdateText || null,
          latestUpdateAt: latestUpdateText ? new Date() : null,
          latestUpdateBy: latestUpdateText ? actorName : null,
        } as any);
      }
      if (body.excelTrackerLink && body.status === "ACCEPTED") {
        const trackerFields = { excelTrackerLink: body.excelTrackerLink, updatedAt: new Date() };
        await db.update(projectInfo).set(trackerFields).where(eq(projectInfo.id, projectId));
        await syncProjectSplitTables(projectId, trackerFields);
      }
      logAuditFromReq(req, {
        entityType: "pd_pm_handover",
        entityId: String(projectId),
        action: "draft.saved",
        projectName: project.projectName,
        changesJson: {
          updatedBy: user?.name || "Unknown",
          latestUpdateSaved: body.latestUpdate !== undefined,
          readinessStatus: body.handoverReadinessStatus || null,
        },
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[handover] PUT draft error:", err);
      res.status(500).json({ error: "Could not save handover draft. Check your connection and retry. If it persists, contact your admin." });
    }
  });

  app.post("/api/pd-pm-handover/:projectId/submit", requireAuth, requirePermission("handover", "edit"), async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const submitRows = await db.select().from(projectPdPmHandover).where(eq(projectPdPmHandover.projectId, projectId)).limit(1);
      const handover = normalizeHandoverRow(submitRows[0]);
      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project || !handover) return res.status(400).json({ error: "Could not submit handover. Likely reason: no draft exists. Save a draft and retry." });
      const workspace = await getProjectDevelopmentWorkspace({
        projectId,
        projectName: project.projectName,
        canonicalProjectId: project.canonicalProjectId,
        clientId: project.clientId,
        phase: project.phase,
        executionGateStatus: project.executionGateStatus,
        executionEnabled: project.executionEnabled,
        handover,
      });
      const missing = computePdPmSubmitBlockers({ project, handover, workspace });
      const user = (req as any).user as any;
      const evidence = await evaluateEvidence({
        projectId,
        completionType: "pd_pm_handover_submit",
        sourceType: "pd_pm_handover",
        sourceRef: String(projectId),
        evaluatorUserId: user?.id,
        evaluatorName: user?.name,
      });
      const overrideReason = String(req.body?.evidenceOverrideReason || "").trim();
      const wantsOverride = !!overrideReason;
      if (missing.length > 0 || !evidence.pass) {
        if (!evidence.pass && wantsOverride) {
          if (!isEvidenceOverrideAuthorized(user?.role)) {
            return res.status(403).json({ error: "Evidence override requires authorized role." });
          }
          await db.insert(evidenceOverrideRecords).values({
            projectId,
            completionType: "pd_pm_handover_submit",
            sourceType: "pd_pm_handover",
            sourceRef: String(projectId),
            scorePercent: evidence.score,
            thresholdPercent: evidence.threshold,
            reason: overrideReason,
            authorizedByUserId: user?.id,
            authorizedByName: user?.name || null,
            authorizedByRole: user?.role || null,
          });
        } else {
          await insertPdPmHandoverHistory({
            projectId,
            req,
            action: "PD_PM_HANDOVER_SUBMIT_BLOCKED",
            details: {
              missingItems: missing,
              evidencePass: evidence.pass,
              evidenceScore: evidence.score,
              evidenceThreshold: evidence.threshold,
            },
          });
          return res.status(400).json({
            error: `Cannot submit handover. Missing items: ${missing.join(", ") || "Evidence threshold not met"}. Complete these fields/documents, then retry.`,
            missingItems: missing,
            evidence,
          });
        }
      }
      await db.update(projectPdPmHandover).set({
        status: "SUBMITTED_FOR_PM_REVIEW",
        handoverStatusText: "Submitted for PM Review",
        submittedBy: user?.name || "Unknown",
        submittedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(projectPdPmHandover.projectId, projectId));
      await insertPdPmHandoverHistory({
        projectId,
        req,
        action: "PD_PM_HANDOVER_SUBMITTED",
        details: {
          evidencePass: evidence.pass,
          evidenceScore: evidence.score,
          evidenceThreshold: evidence.threshold,
          evidenceOverrideReason: wantsOverride ? overrideReason : null,
          readinessStatus: handover.handover_readiness_status || null,
        },
      });
      logAuditFromReq(req, {
        entityType: "project_timeline",
        entityId: String(projectId),
        action: wantsOverride ? "evidence.override" : "evidence.completion_pass",
        projectName: project.projectName,
        changesJson: { sourceType: "pd_pm_handover", sourceRef: String(projectId), evidence, overrideReason: wantsOverride ? overrideReason : null },
      });
      logAuditFromReq(req, {
        entityType: "pd_pm_handover",
        entityId: String(projectId),
        action: "submitted",
        projectName: project.projectName,
        changesJson: { submittedBy: user?.name || "Unknown", readinessStatus: handover.handover_readiness_status || null },
      });
      // Notify PM reviewers
      try {
        const pmUsers = await db.select({ id: users.id }).from(users)
          .where(sql`${users.companyRole} IN ('PROJECT_MANAGER_SITE', 'PROGRAM_MANAGER', 'COO_ADMIN', 'CEO_ADMIN')`);
        const pmUserIds = pmUsers.map(u => u.id);
        if (pmUserIds.length > 0) {
          await notifyHandoverSubmitted(projectId, project.projectName, pmUserIds);
        }
      } catch (notifyErr) {
        console.warn("[handover] notification send failed (non-blocking):", notifyErr);
      }

      res.json({ success: true, status: "SUBMITTED_FOR_PM_REVIEW" });
    } catch (err: any) {
      console.error("[handover] submit error:", err);
      res.status(500).json({ error: "Could not submit handover. Likely reason: required deliverables are missing. Upload the missing files and retry." });
    }
  });

  app.post("/api/pd-pm-handover/:projectId/accept", requireAuth, requirePermission("handover", "approve"), async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const user = (req as any).user as any;
      if (!PM_REVIEW_ROLES.includes(user?.role)) {
        return res.status(403).json({ error: "Could not accept handover. Likely reason: your PM permission is missing or the handover is incomplete. Refresh, verify access, and retry." });
      }
      const acceptRows = await db.select().from(projectPdPmHandover).where(eq(projectPdPmHandover.projectId, projectId)).limit(1);
      const handover = acceptRows[0];
      if (!handover || handover.status !== "SUBMITTED_FOR_PM_REVIEW") {
        return res.status(400).json({ error: "Cannot accept handover: no submitted handover found for PM review." });
      }
      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      await db.update(projectPdPmHandover).set({
        status: "ACCEPTED",
        handoverStatusText: "Accepted",
        acceptedBy: user?.name || "Unknown",
        acceptedAt: new Date(),
        updatedAt: new Date(),
        rejectionReason: null,
      }).where(eq(projectPdPmHandover.projectId, projectId));
      const acceptFields = { executionEnabled: true, executionGateStatus: "ENABLED", phase: "PM Active", updatedAt: new Date() };
      await db.update(projectInfo).set(acceptFields).where(eq(projectInfo.id, projectId));
      await syncProjectSplitTables(projectId, acceptFields);
      if (project && user?.id && project.phase !== "PM Active") {
        await db.insert(projectPhaseHistory).values({
          projectId,
          fromPhase: project.phase || null,
          toPhase: "PM Active",
          changedByUserId: user.id,
          reason: "PD to PM handover accepted",
        });
      }
      await insertPdPmHandoverHistory({
        projectId,
        req,
        action: "PD_PM_HANDOVER_ACCEPTED",
        details: {
          acceptedBy: user?.name || "Unknown",
          fromPhase: project?.phase || null,
          toPhase: "PM Active",
          executionEnabled: true,
        },
      });
      logAuditFromReq(req, {
        entityType: "pd_pm_handover",
        entityId: String(projectId),
        action: "accepted",
        projectName: project?.projectName,
        changesJson: { acceptedBy: user?.name, fromPhase: project?.phase || null, toPhase: "PM Active" },
      });
      // Notify PD team about acceptance
      try {
        const pdOwnerName = handover.pdOwner ?? handover.pd_owner;
        if (pdOwnerName) {
          const pdOwnerUsers = await db.select({ id: users.id }).from(users)
            .where(sql`${users.name} = ${pdOwnerName}`);
          if (pdOwnerUsers.length > 0) {
            await notifyHandoverAccepted(projectId, project?.projectName || "Unknown", pdOwnerUsers.map(u => u.id));
          }
        }
      } catch (notifyErr) {
        console.warn("[handover] acceptance notification failed (non-blocking):", notifyErr);
      }

      res.json({ success: true, status: "ACCEPTED" });
    } catch (err: any) {
      console.error("[handover] accept error:", err);
      res.status(500).json({ error: "Could not accept handover. Likely reason: your PM permission is missing or the handover is incomplete. Refresh, verify access, and retry." });
    }
  });

  app.post("/api/pd-pm-handover/:projectId/reject", requireAuth, requirePermission("handover", "approve"), async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      const reason = String(req.body?.reason || "").trim();
      if (!reason) return res.status(400).json({ error: "Rejection reason is required." });
      const user = (req as any).user as any;
      if (!PM_REVIEW_ROLES.includes(user?.role)) {
        return res.status(403).json({ error: "Could not reject handover. Likely reason: your PM permission is missing. Refresh, verify PM access, and retry." });
      }
      const rejectRows = await db.select().from(projectPdPmHandover).where(eq(projectPdPmHandover.projectId, projectId)).limit(1);
      const handover = rejectRows[0];
      if (!handover || handover.status !== "SUBMITTED_FOR_PM_REVIEW") {
        return res.status(400).json({ error: "Cannot reject handover: no submitted handover found for PM review." });
      }
      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      await db.update(projectPdPmHandover).set({
        status: "REJECTED",
        handoverStatusText: "Rejected",
        rejectedBy: user?.name || "Unknown",
        rejectedAt: new Date(),
        rejectionReason: reason,
        updatedAt: new Date(),
      }).where(eq(projectPdPmHandover.projectId, projectId));
      const rejectFields = { executionEnabled: false, executionGateStatus: "NOT_ELIGIBLE", updatedAt: new Date() };
      await db.update(projectInfo).set(rejectFields).where(eq(projectInfo.id, projectId));
      await syncProjectSplitTables(projectId, rejectFields);
      await insertPdPmHandoverHistory({
        projectId,
        req,
        action: "PD_PM_HANDOVER_REJECTED",
        details: {
          rejectedBy: user?.name || "Unknown",
          reason,
          executionEnabled: false,
        },
      });
      logAuditFromReq(req, {
        entityType: "pd_pm_handover",
        entityId: String(projectId),
        action: "rejected",
        projectName: project?.projectName,
        changesJson: { rejectedBy: user?.name || "Unknown", reason },
      });

      // Notify PD team about rejection
      try {
        const pdOwnerName = handover.pdOwner ?? handover.pd_owner;
        if (pdOwnerName) {
          const pdOwnerUsers = await db.select({ id: users.id }).from(users)
            .where(sql`${users.name} = ${pdOwnerName}`);
          if (pdOwnerUsers.length > 0) {
            await notifyHandoverRejected(projectId, project?.projectName || "Unknown", reason, pdOwnerUsers.map(u => u.id));
          }
        }
      } catch (notifyErr) {
        console.warn("[handover] rejection notification failed (non-blocking):", notifyErr);
      }

      res.json({ success: true, status: "REJECTED" });
    } catch (err: any) {
      console.error("[handover] reject error:", err);
      res.status(500).json({ error: "Could not reject handover. Check reason and retry." });
    }
  });

  app.put("/api/pd-pm-handover/:projectId/excel-tracker", requireAuth, requirePermission("handover", "edit"), async (req: Request, res: Response) => {
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

      const trackerRows = await db.select({ status: projectPdPmHandover.status }).from(projectPdPmHandover).where(eq(projectPdPmHandover.projectId, projectId)).limit(1);
      const handover = trackerRows[0];
      if (!handover || handover.status !== "ACCEPTED") {
        return res.status(400).json({ error: "Excel tracker link can only be updated after handover is accepted." });
      }

      const excelFields = { excelTrackerLink: trackerLink, updatedAt: new Date() };
      await db.update(projectInfo).set(excelFields).where(eq(projectInfo.id, projectId));
      await syncProjectSplitTables(projectId, excelFields);
      logAuditFromReq(req, { entityType: "pd_pm_handover", entityId: String(projectId), action: "excel_tracker.updated", changesJson: { updatedBy: user?.name || "Unknown" } });

      res.json({ success: true });
    } catch (err: any) {
      console.error("[handover] excel tracker update error:", err);
      res.status(500).json({ error: "Could not update Excel tracker link. Refresh and retry. If it persists, contact your admin." });
    }
  });

  app.post("/api/pd-pm-handover/:projectId/evidence", requireAuth, requirePermission("handover", "edit"), async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const user = (req as any).user as any;
      const payload = req.body || {};

      await upsertEvidenceItem({
        projectId,
        completionType: "pd_pm_handover_submit",
        sourceType: "pd_pm_handover",
        sourceRef: String(projectId),
        requirementKey: payload.requirementKey || null,
        evidenceType: payload.evidenceType || "document",
        title: payload.title || null,
        valueRef: payload.valueRef || null,
        valueJson: payload.valueJson,
        uploadedByUserId: user?.id,
        uploadedByName: user?.name,
      });

      const evidence = await evaluateEvidence({
        projectId,
        completionType: "pd_pm_handover_submit",
        sourceType: "pd_pm_handover",
        sourceRef: String(projectId),
        evaluatorUserId: user?.id,
        evaluatorName: user?.name,
      });

      logAuditFromReq(req, {
        entityType: "project_timeline",
        entityId: String(projectId),
        action: "evidence.collected",
        changesJson: { sourceType: "pd_pm_handover", sourceRef: String(projectId), payload },
      });

      res.status(201).json({ success: true, evidence });
    } catch (err: any) {
      console.error("[handover] add evidence error:", err);
      res.status(500).json({ error: "Could not add handover evidence" });
    }
  });

}
