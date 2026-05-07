// Error breakdown: TS7006 implicit-any: 16, TS2345 query/param types: 9, other: 2
// Fix guide: use queryStr/queryInt from server/lib/req-parse for query params,
// add explicit ': any' to .map/.filter callback params on db result rows.
import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, desc, sql, and, inArray, isNull, ilike } from "drizzle-orm";
import { projectInfo, projectPhaseHistory, users, projectExecutionState, projectPdPmHandover, projectHandoverHistory, clients, evidenceOverrideRecords, lessonsLearnt, handoverStakeholders, projectSettings } from "@shared/schema";
import { syncProjectSplitTables } from "./lib/project-info-sync";
import { logAuditFromReq } from "./audit-logger";
import { evaluateEvidence, isEvidenceOverrideAuthorized, upsertEvidenceItem } from "./services/evidence-evaluation-service";
import { storage } from "./storage";
import { computePdPmSubmitBlockers, getProjectDevelopmentWorkspace } from "./services/project-development-workspace-service";
import { requirePermission } from "./permission-middleware";
import { notifyHandoverSubmitted, notifyHandoverAccepted, notifyHandoverRejected } from "./services/notification-service";
import { PM_REVIEW_ROLES } from "@shared/roles/pd-roles";
import { findEntityRegistry } from "@shared/permissions/registry";
import { evaluateHandoverAcceptDecision } from "./lib/handover-accept-override-eval";

// Snapshotted at module init from the canonical entity registry. Plan v3 § 2.5 / D.6 #1.
const HANDOVER_OVERRIDE_ROLES: ReadonlySet<string> = new Set(
  findEntityRegistry("handover")?.override_roles ?? [],
);
import { z } from "zod";
import { jwtAuth, requireAuth } from "./auth-context";
import { requireAdmin } from "./middleware/requireAdmin";
import { paramStr, parseIntParam } from "./lib/req-params";

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

// Removed legacy `escapeSqlText`/`escapeSqlJson`/`escapeSqlNumber` helpers.
// They were string-concat SQL escapers left over from the pre-Drizzle era,
// marked deprecated, and not referenced anywhere in this file. Keeping
// them around risked someone reaching for them instead of the parameterized
// Drizzle builder.

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
      const projectId = parseIntParam(req.params.id);
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

      const gateRows: any[] = await db.execute(
        sql`SELECT * FROM project_handover_gates WHERE project_id = ${projectId} ORDER BY id`
      ).then((r: any) => (Array.isArray(r) ? r : r.rows || []));

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
      throw err;
    }
  });

  app.post("/api/projects/:id/handover-gates/:gateId/complete", requireAuth, requirePermission("handover", "edit"), async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.id);
      const gateId = paramStr(req.params.gateId);
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

      const existingRows: any[] = await db.execute(
        sql`SELECT id, status FROM project_handover_gates WHERE project_id = ${projectId} AND gate_id = ${gateId}`
      ).then((r: any) => (Array.isArray(r) ? r : r.rows || []));

      const checkedJson = JSON.stringify(checkedItems);
      const notesValue = notes ? String(notes) : null;

      if (existingRows.length > 0) {
        await db.execute(
          sql`UPDATE project_handover_gates SET status = 'COMPLETE', checked_items = ${checkedJson}::jsonb, completed_at = NOW(), completed_by_user_id = ${userId}, completed_by_name = ${userName}, notes = ${notesValue}, updated_at = NOW() WHERE project_id = ${projectId} AND gate_id = ${gateId}`
        );
      } else {
        await db.execute(
          sql`INSERT INTO project_handover_gates (project_id, gate_id, status, checked_items, completed_at, completed_by_user_id, completed_by_name, notes) VALUES (${projectId}, ${gateId}, 'COMPLETE', ${checkedJson}::jsonb, NOW(), ${userId}, ${userName}, ${notesValue})`
        );
      }

      const historyDetails = JSON.stringify({ checkedItems, notes: notes || null });
      await db.execute(
        sql`INSERT INTO project_handover_history (project_id, gate_id, action, performed_by_user_id, performed_by_name, performed_by_role, details) VALUES (${projectId}, ${gateId}, 'GATE_COMPLETED', ${userId}, ${userName}, ${userRole}, ${historyDetails}::jsonb)`
      );

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
      throw err;
    }
  });

  app.post("/api/projects/:id/handover-gates/:gateId/update-checklist", requireAuth, requirePermission("handover", "edit"), async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.id);
      const gateId = paramStr(req.params.gateId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const gateDef = GATE_DEFINITIONS.find(g => g.gateId === gateId);
      if (!gateDef) return res.status(400).json({ error: "Invalid gate ID" });

      const { checkedItems } = req.body;
      if (!checkedItems || !Array.isArray(checkedItems)) {
        return res.status(400).json({ error: "checkedItems array required" });
      }

      const checkedJson = JSON.stringify(checkedItems);

      const existingRows: any[] = await db.execute(
        sql`SELECT id FROM project_handover_gates WHERE project_id = ${projectId} AND gate_id = ${gateId}`
      ).then((r: any) => (Array.isArray(r) ? r : r.rows || []));

      if (existingRows.length > 0) {
        await db.execute(
          sql`UPDATE project_handover_gates SET checked_items = ${checkedJson}::jsonb, updated_at = NOW() WHERE project_id = ${projectId} AND gate_id = ${gateId}`
        );
      } else {
        await db.execute(
          sql`INSERT INTO project_handover_gates (project_id, gate_id, status, checked_items) VALUES (${projectId}, ${gateId}, 'PENDING', ${checkedJson}::jsonb)`
        );
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("[handover] POST update-checklist error:", err);
      throw err;
    }
  });

  app.post("/api/projects/:id/handover-gates/:gateId/reopen", requireAuth, requirePermission("handover", "override"), async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.id);
      const gateId = paramStr(req.params.gateId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const role = ((req as any).user as any)?.role || "";
      const ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER"];
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

      await db.execute(
        sql`UPDATE project_handover_gates SET status = 'PENDING', completed_at = NULL, completed_by_user_id = NULL, completed_by_name = NULL, updated_at = NOW() WHERE project_id = ${projectId} AND gate_id = ${gateId}`
      );

      const reopenDetails = JSON.stringify({ reason: reason || null });
      await db.execute(
        sql`INSERT INTO project_handover_history (project_id, gate_id, action, performed_by_user_id, performed_by_name, performed_by_role, details) VALUES (${projectId}, ${gateId}, 'GATE_REOPENED', ${userId}, ${userName}, ${userRole}, ${reopenDetails}::jsonb)`
      );

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
      throw err;
    }
  });

  app.get("/api/projects/:id/handover-history", requireAuth, requirePermission("handover", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.id);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const rows: any[] = await db.execute(
        sql`SELECT * FROM project_handover_history WHERE project_id = ${projectId} ORDER BY performed_at DESC LIMIT 50`
      ).then((r: any) => (Array.isArray(r) ? r : r.rows || []));

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
      throw err;
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
        .where(inArray(projectPdPmHandover.status, ["SUBMITTED_FOR_PM_REVIEW", "REJECTED", "HANDOVER_COMPLETE"]))
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
          excel_tracker_link: projectSettings.excelTrackerLink,
          execution_enabled: projectExecutionState.executionEnabled,
          handover_status: projectPdPmHandover.status,
          pd_owner: projectPdPmHandover.pdOwner,
          pm_owner: projectPdPmHandover.pmOwner,
          submitted_date: projectPdPmHandover.submittedAt,
          updated_at: sql<Date>`COALESCE(${projectPdPmHandover.updatedAt}, ${projectInfo.updatedAt})`,
          rejection_reason: projectPdPmHandover.rejectionReason,
          deliverables: projectPdPmHandover.deliverables,
          readiness_score: projectPdPmHandover.readinessScore,
          handover_form_data: projectPdPmHandover.handoverFormData,
          kickoff_date: projectPdPmHandover.kickoffDate,
          lessons_reviewed: projectPdPmHandover.lessonsReviewed,
          pd_sign_off_at: projectPdPmHandover.pdSignOffAt,
          pm_sign_off_at: projectPdPmHandover.pmSignOffAt,
        })
        .from(projectInfo)
        .innerJoin(projectPdPmHandover, eq(projectPdPmHandover.projectId, projectInfo.id))
        .leftJoin(clients, eq(clients.id, projectInfo.clientId))
        .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
        .leftJoin(projectSettings, eq(projectSettings.projectId, projectInfo.id))
        .where(eq(projectExecutionState.isActive, true))
        .orderBy(sql`COALESCE(${projectPdPmHandover.updatedAt}, ${projectInfo.updatedAt}) DESC NULLS LAST`, projectInfo.projectName);

      const now = Date.now();
      const items = rows.map((row: any) => {
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

        const missingInputs: string[] = [];
        if (!row.pd_owner && !row.pd) missingInputs.push("PD owner");
        if (!row.pm_owner && !row.pm) missingInputs.push("PM owner");
        if (!row.submitted_date) missingInputs.push("Submitted date");
        if (!row.updated_at) missingInputs.push("Last update");
        if (!row.kickoff_date) missingInputs.push("Kickoff date");
        if (!row.handover_form_data) missingInputs.push("Handover form");

        const blockers = [
          !deliverablesComplete ? "Missing deliverables evidence" : null,
        ].filter(Boolean) as string[];

        const warnings = [
          !trackerLinked ? "Tracker not linked" : null,
          !executionEnabled && status === "HANDOVER_COMPLETE" ? "Execution not enabled" : null,
        ].filter(Boolean) as string[];

        const healthScore =
          missingInputs.length > 0
            ? null
            : Math.max(
                0,
                Math.min(
                  100,
                  Number(row.readiness_score ?? 0) -
                    blockers.length * 20 -
                    warnings.length * 5 -
                    (daysInStatus > 7 ? 10 : 0),
                ),
              );

        return {
          ...row,
          handover_status: status,
          deliverables_complete: deliverablesComplete,
          tracker_linked: trackerLinked,
          execution_enabled: executionEnabled,
          days_in_status: daysInStatus,
          next_action: nextAction,
          action_owner: actionOwner,
          health_score: healthScore,
          health_blockers: blockers,
          health_warnings: warnings,
          health_missing_inputs: missingInputs,
          health_not_enough_data: missingInputs.length > 0,
        };
      });

      const startOfMonth = new Date();
      startOfMonth.setUTCDate(1);
      startOfMonth.setUTCHours(0, 0, 0, 0);

      const dashboard = {
        readyForPmReview: items.filter((r: any) => r.handover_status === "SUBMITTED_FOR_PM_REVIEW").length,
        rejectedReturnedToPd: items.filter((r: any) => r.handover_status === "REJECTED").length,
        overdueHandovers: items.filter((r: any) => r.handover_status === "SUBMITTED_FOR_PM_REVIEW" && Number(r.days_in_status || 0) > 5).length,
        missingRequiredEvidence: items.filter((r: any) => (Array.isArray(r.health_blockers) && r.health_blockers.includes("Missing deliverables evidence")) || r.health_not_enough_data).length,
        acceptedThisMonth: items.filter((r: any) => r.handover_status === "ACCEPTED" && r.pm_sign_off_at && new Date(r.pm_sign_off_at).getTime() >= startOfMonth.getTime()).length,
      };
      res.json({ items, dashboard });
    } catch (err: any) {
      const msg = err?.message || '';
      if (/relation.*does not exist|no such table/i.test(msg) || err?.code === '42P01') {
        console.warn("[handover] control: table missing, returning empty");
        return res.json({ items: [] });
      }
      console.error("[handover] GET control error:", err);
      res.status(500).json({ error: "Could not load handover control view. Refresh and retry." });
    }
  });

  app.get("/api/pd-pm-handover/:projectId", requireAuth, requirePermission("handover", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
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
      const history = historyRows.map((row: any) => ({
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
      const projectId = parseIntParam(req.params.projectId);
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

      const handoverValues: Record<string, any> = {
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

      // V2 enhanced fields
      if (body.handoverFormData !== undefined) handoverValues.handoverFormData = body.handoverFormData;
      if (body.readinessChecklist !== undefined) {
        handoverValues.readinessChecklist = body.readinessChecklist;
        const items = body.readinessChecklist || {};
        const total = Object.keys(items).length;
        const checked = Object.values(items).filter(Boolean).length;
        handoverValues.readinessScore = total > 0 ? Math.round((checked / total) * 100) : 0;
      }
      if (body.kickoffDate !== undefined) handoverValues.kickoffDate = body.kickoffDate || null;
      if (body.lessonsReviewed !== undefined) handoverValues.lessonsReviewed = body.lessonsReviewed === true;

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
      const projectId = parseIntParam(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const submitRows = await db.select().from(projectPdPmHandover).where(eq(projectPdPmHandover.projectId, projectId)).limit(1);
      const handover = normalizeHandoverRow(submitRows[0]);
      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project) {
        return res.status(404).json({ error: "Project not found." });
      }
      if (!handover) {
        return res.status(400).json({ error: "Could not submit handover. Likely reason: no draft exists. Save a draft and retry." });
      }
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
      // B6 (audit closeout): PD->PM handover submission is a FORMAL PROCESS,
      // NOT A BLOCKER. Per direction from the breakdown discussion, we no
      // longer reject submissions that have missing DoR items or that fall
      // below the evidence threshold. Instead:
      //   1. We compute the completeness snapshot (missing items + evidence
      //      score + traffic light) at the moment of submit.
      //   2. The submission always proceeds — status moves to
      //      SUBMITTED_FOR_PM_REVIEW regardless of gaps.
      //   3. The full completeness state is recorded in the handover history
      //      log so the post-mortem trail shows exactly what was present
      //      when the PD team handed off to the PM team.
      //   4. Action is PD_PM_HANDOVER_SUBMITTED_WITH_GAPS when items are
      //      missing, PD_PM_HANDOVER_SUBMITTED when clean. Callers that
      //      want the old "block and force override" behaviour should move
      //      to a dedicated admin review endpoint — this path is designed
      //      for formal handover, not gate enforcement.
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

      // W1/W5: Capture integration freshness at submission time. This is
      // non-blocking — stale data does NOT prevent handover submission (B6
      // principle), but warnings are recorded in the history and returned
      // to the UI so the submitter sees the integration health posture.
      let integrationFreshness: {
        overallHealth: string;
        warnings: string[];
        staleIntegrations: string[];
      } = { overallHealth: "unknown", warnings: [], staleIntegrations: [] };
      try {
        const { getIntegrationFreshnessReport } = await import("./services/integration-freshness-service");
        const freshnessReport = await getIntegrationFreshnessReport();
        integrationFreshness = {
          overallHealth: freshnessReport.overallHealth,
          warnings: freshnessReport.warnings,
          staleIntegrations: freshnessReport.integrations
            .filter(i => i.health !== "healthy")
            .map(i => i.name),
        };
      } catch (freshnessErr) {
        console.warn("[handover] integration freshness check failed (non-blocking):", freshnessErr);
      }

      // B6: compute a simple completeness percentage driven by the same
      // blocker list the UI shows. Thresholds match B1: 100 -> green,
      // 80-99 -> amber, <80 -> red. Evidence-score shortfall is folded
      // into the missing list for history purposes only.
      const gatesTotal = Math.max(missing.length + 1, 1);   // +1 so a clean handover always reads as 1/1
      const gatesPassed = missing.length === 0 ? gatesTotal : Math.max(gatesTotal - missing.length, 0);
      const readinessPct = gatesTotal > 0 ? Math.round((gatesPassed / gatesTotal) * 100) : 100;
      const trafficLight: "green" | "amber" | "red" =
        readinessPct >= 100 ? "green" : readinessPct >= 80 ? "amber" : "red";
      const hasGaps = missing.length > 0 || !evidence.pass;
      const userRole = String(user?.role || "");
      const cooOverrideRequested = req.body?.cooOverride === true;
      const cooOverrideReason = String(req.body?.cooOverrideReason || "").trim();
      const cooOverrideAllowed = ["COO_ADMIN", "CEO_ADMIN"].includes(userRole) && cooOverrideRequested && cooOverrideReason.length > 0;

      if (hasGaps && !cooOverrideAllowed) {
        return res.status(400).json({
          error: "Cannot submit handover: mandatory sections are incomplete. Complete all blockers or obtain COO override to submit with exceptions.",
          missingItems: missing,
          evidencePass: evidence.pass,
          canSubmitWithExceptions: ["COO_ADMIN", "CEO_ADMIN"].includes(userRole),
        });
      }

      await db.update(projectPdPmHandover).set({
        status: "SUBMITTED_FOR_PM_REVIEW",
        handoverStatusText: hasGaps ? "Submitted with Exceptions" : "Submitted for PM Review",
        submittedBy: user?.name || "Unknown",
        submittedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(projectPdPmHandover.projectId, projectId));
      await insertPdPmHandoverHistory({
        projectId,
        req,
        action: hasGaps ? "PD_PM_HANDOVER_SUBMITTED_WITH_EXCEPTIONS" : "PD_PM_HANDOVER_SUBMITTED",
        details: {
          missingItems: missing,
          evidencePass: evidence.pass,
          evidenceScore: evidence.score,
          evidenceThreshold: evidence.threshold,
          readinessPct,
          trafficLight,
          readinessStatus: handover.handoverReadinessStatus || null,
          integrationFreshness,
          submittedWithExceptions: hasGaps,
          cooOverrideAllowed: hasGaps ? cooOverrideAllowed : false,
          cooOverrideReason: hasGaps ? cooOverrideReason : null,
        },
      });
      logAuditFromReq(req, {
        entityType: "project_timeline",
        entityId: String(projectId),
        // B6: submissions always log as completion_pass or completion_with_gaps
        // — no override path, no gate-block flag. The completeness state is
        // in the handover history row.
        action: hasGaps ? "evidence.completion_with_gaps" : "evidence.completion_pass",
        projectName: project.projectName,
        changesJson: { sourceType: "pd_pm_handover", sourceRef: String(projectId), evidence, missingItems: missing, readinessPct, trafficLight, integrationFreshness },
      });
      logAuditFromReq(req, {
        entityType: "pd_pm_handover",
        entityId: String(projectId),
        action: "submitted",
        projectName: project.projectName,
        changesJson: { submittedBy: user?.name || "Unknown", readinessStatus: handover.handoverReadinessStatus || null },
      });
      // Notify PM reviewers
      try {
        const pmUsers = await db.select({ id: users.id }).from(users)
          .where(sql`${(users as any).companyRole ?? users.role} IN ('PROJECT_MANAGER_SITE', 'PROGRAM_MANAGER', 'COO_ADMIN', 'CEO_ADMIN')`);
        const pmUserIds = pmUsers.map((u: any) => u.id);
        if (pmUserIds.length > 0) {
          await notifyHandoverSubmitted(projectId, project.projectName, pmUserIds);
        }
      } catch (notifyErr) {
        console.warn("[handover] notification send failed (non-blocking):", notifyErr);
      }

      // B6: response includes the completeness snapshot so the UI can surface
      // the amber/red badge on the success screen. The submission always
      // succeeds — the readinessPct, trafficLight and missingItems fields
      // are the formal audit trail, not an error payload.
      res.json({
        success: true,
        status: "SUBMITTED_FOR_PM_REVIEW",
        readinessPct,
        trafficLight,
        hasGaps,
        missingItems: missing,
        evidencePass: evidence.pass,
        integrationFreshness,
      });
    } catch (err: any) {
      console.error("[handover] submit error:", err);
      res.status(500).json({ error: "Could not submit handover — server error. Check server logs." });
    }
  });

  // B6: live readiness endpoint used by the PD→PM handover workspace to
  // show the traffic-light badge and checklist BEFORE the user clicks
  // submit. Non-blocking — pure read of the current handover record.
  app.get("/api/pd-pm-handover/:projectId/readiness", requireAuth, requirePermission("handover", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const [handoverRow] = await db.select().from(projectPdPmHandover).where(eq(projectPdPmHandover.projectId, projectId)).limit(1);
      const handover = normalizeHandoverRow(handoverRow);
      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project || !handover) {
        return res.status(404).json({
          error: "Handover draft not found",
          projectId,
          readinessPct: 0,
          trafficLight: "red",
          missingItems: ["No handover draft exists — create one first"],
        });
      }
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
      const gatesTotal = Math.max(missing.length + 1, 1);
      const gatesPassed = missing.length === 0 ? gatesTotal : Math.max(gatesTotal - missing.length, 0);
      const readinessPct = gatesTotal > 0 ? Math.round((gatesPassed / gatesTotal) * 100) : 100;
      const trafficLight: "green" | "amber" | "red" =
        readinessPct >= 100 ? "green" : readinessPct >= 80 ? "amber" : "red";

      // W1/W5: Include integration freshness in the readiness response so
      // the UI can show warnings before the user clicks submit.
      let integrationFreshness: {
        overallHealth: string;
        warnings: string[];
        staleIntegrations: string[];
      } = { overallHealth: "unknown", warnings: [], staleIntegrations: [] };
      try {
        const { getIntegrationFreshnessReport } = await import("./services/integration-freshness-service");
        const freshnessReport = await getIntegrationFreshnessReport();
        integrationFreshness = {
          overallHealth: freshnessReport.overallHealth,
          warnings: freshnessReport.warnings,
          staleIntegrations: freshnessReport.integrations
            .filter(i => i.health !== "healthy")
            .map(i => i.name),
        };
      } catch (freshnessErr) {
        console.warn("[handover] integration freshness check failed (non-blocking):", freshnessErr);
      }

      res.json({
        projectId,
        projectName: project.projectName,
        status: handover.status,
        readinessPct,
        trafficLight,
        gatesTotal,
        gatesPassed,
        gatesMissing: missing.length,
        hasGaps: missing.length > 0,
        missingItems: missing,
        integrationFreshness,
      });
    } catch (err: any) {
      console.error("[handover] readiness error:", err);
      res.status(500).json({ error: "Could not compute handover readiness — server error. Check server logs." });
    }
  });

  app.post("/api/pd-pm-handover/:projectId/accept", requireAuth, requirePermission("handover", "approve"), async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
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
      if (!project) return res.status(404).json({ error: "Project not found." });
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
      const missingItems = computePdPmSubmitBlockers({ project, handover, workspace });
      const decision = evaluateHandoverAcceptDecision({
        userRole: user?.role,
        missingItems,
        rawOverrideReason: req.body?.override_reason,
        overrideRoles: HANDOVER_OVERRIDE_ROLES,
      });
      if (decision.kind === "reject") {
        return res.status(decision.status).json(decision.body);
      }
      const overrideApplied = decision.kind === "accept_with_override";
      const overrideReason = overrideApplied ? decision.reason : null;
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
        action: overrideApplied ? "accepted_with_override" : "accepted",
        projectName: project?.projectName,
        changesJson: {
          acceptedBy: user?.name,
          fromPhase: project?.phase || null,
          toPhase: "PM Active",
          ...(overrideApplied
            ? {
                overrideApplied: true,
                overrideReason,
                missingItemsAtAccept: missingItems,
              }
            : {}),
        },
      });
      // Notify PD team about acceptance
      try {
        const pdOwnerName = handover.pdOwner;
        if (pdOwnerName) {
          const pdOwnerUsers = await db.select({ id: users.id }).from(users)
            .where(sql`${users.name} = ${pdOwnerName}`);
          if (pdOwnerUsers.length > 0) {
            await notifyHandoverAccepted(projectId, project?.projectName || "Unknown", pdOwnerUsers.map((u: any) => u.id));
          }
        }
      } catch (notifyErr) {
        console.warn("[handover] acceptance notification failed (non-blocking):", notifyErr);
      }

      // B7 (audit closeout): auto-seed the OHSA Safety File items with a
      // 7-day due date from acceptance. Non-blocking — a failure here must
      // not break handover acceptance, so errors are logged and swallowed.
      let safetyFileSeeded = 0;
      try {
        const { seedDefaultSafetyFileItems } = await import("./services/safety-file-service");
        const result = await seedDefaultSafetyFileItems({
          projectId,
          handoverAcceptedAt: new Date(),
          createdByUserId: user?.id ?? null,
        });
        safetyFileSeeded = result.inserted;
        if (result.inserted > 0) {
          logAuditFromReq(req, {
            entityType: "pd_pm_handover",
            entityId: String(projectId),
            action: "safety_file.seeded_on_handover",
            projectName: project?.projectName,
            changesJson: {
              itemsSeeded: result.inserted,
              dueDate: result.dueDate,
              source: "pd_pm_handover_accepted",
            },
          });
        }
      } catch (seedErr) {
        console.warn("[handover] Safety File auto-seed failed (non-blocking):", seedErr);
      }

      res.json({
        success: true,
        status: "ACCEPTED",
        safetyFileSeeded,
        ...(overrideApplied
          ? { override_applied: true, override_reason: overrideReason }
          : {}),
      });
    } catch (err: any) {
      console.error("[handover] accept error:", err);
      res.status(500).json({ error: "Could not accept handover. Likely reason: your PM permission is missing or the handover is incomplete. Refresh, verify access, and retry." });
    }
  });

  app.post("/api/pd-pm-handover/:projectId/reject", requireAuth, requirePermission("handover", "approve"), async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
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
        const pdOwnerName = handover.pdOwner;
        if (pdOwnerName) {
          const pdOwnerUsers = await db.select({ id: users.id }).from(users)
            .where(sql`${users.name} = ${pdOwnerName}`);
          if (pdOwnerUsers.length > 0) {
            await notifyHandoverRejected(projectId, project?.projectName || "Unknown", reason, pdOwnerUsers.map((u: any) => u.id));
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
      const projectId = parseIntParam(req.params.projectId);
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
      const projectId = parseIntParam(req.params.projectId);
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

  // ===================== PD SIGN-OFF =====================

  app.post("/api/pd-pm-handover/:projectId/pd-sign-off", requireAuth, requirePermission("handover", "edit"), async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const user = (req as any).user as any;
      const PD_ROLES = ["PROJECT_DEVELOPER", "COO_ADMIN", "CEO_ADMIN", "admin"];
      if (!PD_ROLES.includes(user?.role)) {
        return res.status(403).json({ error: "PD sign-off requires Project Developer role." });
      }
      const handoverRows = await db.select().from(projectPdPmHandover).where(eq(projectPdPmHandover.projectId, projectId)).limit(1);
      const handover = handoverRows[0];
      if (!handover || handover.status !== "ACCEPTED") {
        return res.status(400).json({ error: "PD sign-off requires handover in ACCEPTED status." });
      }
      await db.update(projectPdPmHandover).set({
        pdSignOffAt: new Date(),
        pdSignOffBy: user?.name || "Unknown",
        updatedAt: new Date(),
      }).where(eq(projectPdPmHandover.projectId, projectId));
      await insertPdPmHandoverHistory({ projectId, req, action: "PD_PM_HANDOVER_PD_SIGN_OFF", details: { signedBy: user?.name } });
      logAuditFromReq(req, { entityType: "pd_pm_handover", entityId: String(projectId), action: "pd_sign_off", changesJson: { signedBy: user?.name } });

      // Check if PM has also signed — if so, complete handover
      const [updated] = await db.select().from(projectPdPmHandover).where(eq(projectPdPmHandover.projectId, projectId)).limit(1);
      if (updated?.pmSignOffAt) {
        await completeHandover(projectId, req);
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error("[handover] PD sign-off error:", err);
      res.status(500).json({ error: "Could not record PD sign-off." });
    }
  });

  // ===================== PM SIGN-OFF =====================

  app.post("/api/pd-pm-handover/:projectId/pm-sign-off", requireAuth, requirePermission("handover", "approve"), async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const user = (req as any).user as any;
      if (!PM_REVIEW_ROLES.includes(user?.role)) {
        return res.status(403).json({ error: "PM sign-off requires PM role." });
      }
      const handoverRows = await db.select().from(projectPdPmHandover).where(eq(projectPdPmHandover.projectId, projectId)).limit(1);
      const handover = handoverRows[0];
      if (!handover || handover.status !== "ACCEPTED") {
        return res.status(400).json({ error: "PM sign-off requires handover in ACCEPTED status." });
      }
      await db.update(projectPdPmHandover).set({
        pmSignOffAt: new Date(),
        pmSignOffBy: user?.name || "Unknown",
        updatedAt: new Date(),
      }).where(eq(projectPdPmHandover.projectId, projectId));
      await insertPdPmHandoverHistory({ projectId, req, action: "PD_PM_HANDOVER_PM_SIGN_OFF", details: { signedBy: user?.name } });
      logAuditFromReq(req, { entityType: "pd_pm_handover", entityId: String(projectId), action: "pm_sign_off", changesJson: { signedBy: user?.name } });

      // Check if PD has also signed — if so, complete handover
      const [updated] = await db.select().from(projectPdPmHandover).where(eq(projectPdPmHandover.projectId, projectId)).limit(1);
      if (updated?.pdSignOffAt) {
        await completeHandover(projectId, req);
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error("[handover] PM sign-off error:", err);
      res.status(500).json({ error: "Could not record PM sign-off." });
    }
  });

  async function completeHandover(projectId: number, req: Request) {
    await db.update(projectPdPmHandover).set({
      status: "HANDOVER_COMPLETE",
      handoverStatusText: "Handover Complete",
      updatedAt: new Date(),
    }).where(eq(projectPdPmHandover.projectId, projectId));

    const completeFields = { executionEnabled: true, executionGateStatus: "ENABLED", updatedAt: new Date() };
    await db.update(projectInfo).set(completeFields).where(eq(projectInfo.id, projectId));
    await syncProjectSplitTables(projectId, completeFields);

    await insertPdPmHandoverHistory({ projectId, req, action: "PD_PM_HANDOVER_COMPLETE", details: {} });
    const [project] = await db.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, projectId));
    logAuditFromReq(req, { entityType: "pd_pm_handover", entityId: String(projectId), action: "handover_complete", projectName: project?.projectName, changesJson: {} });
  }

  // ===================== LESSONS LEARNT =====================
  // Lessons learnt are part of the handover knowledge base, so they gate
  // on the `handover` permission entity. Without this, any authenticated
  // user (including ENGINEERS and ACCOUNTANTS) could read/write the
  // lessons table.

  app.get("/api/lessons-learnt", requireAuth, requirePermission("handover", "view"), async (req: Request, res: Response) => {
    try {
      const projectType = String(req.query.projectType || "").trim();
      const search = String(req.query.search || "").trim();
      const limitNum = Math.min(Number(req.query.limit) || 50, 200);

      let query = db.select().from(lessonsLearnt).where(isNull(lessonsLearnt.deletedAt));

      const conditions: any[] = [isNull(lessonsLearnt.deletedAt)];
      if (projectType) {
        conditions.push(eq(lessonsLearnt.projectType, projectType));
      }
      if (search) {
        conditions.push(sql`(${lessonsLearnt.title} ILIKE ${'%' + search + '%'} OR ${lessonsLearnt.description} ILIKE ${'%' + search + '%'})`);
      }

      const rows = await db.select().from(lessonsLearnt)
        .where(and(...conditions))
        .orderBy(desc(lessonsLearnt.createdAt))
        .limit(limitNum);

      res.json({ items: rows });
    } catch (err: any) {
      console.error("[handover] GET lessons-learnt error:", err);
      res.status(500).json({ error: "Could not load lessons learnt." });
    }
  });

  app.post("/api/lessons-learnt", requireAuth, requirePermission("handover", "create"), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as any;
      const body = req.body || {};
      if (!body.title || !body.description) {
        return res.status(400).json({ error: "Title and description are required." });
      }
      const [row] = await db.insert(lessonsLearnt).values({
        title: body.title,
        description: body.description,
        tags: body.tags || [],
        projectType: body.projectType || null,
        technologyTags: body.technologyTags || [],
        addedByUserId: user?.id || null,
        addedByName: user?.name || "Unknown",
      }).returning();
      res.status(201).json(row);
    } catch (err: any) {
      console.error("[handover] POST lessons-learnt error:", err);
      res.status(500).json({ error: "Could not create lesson." });
    }
  });

  app.patch("/api/lessons-learnt/:id", requireAuth, requirePermission("handover", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const body = req.body || {};
      const updates: Record<string, any> = { updatedAt: new Date() };
      if (body.title !== undefined) updates.title = body.title;
      if (body.description !== undefined) updates.description = body.description;
      if (body.tags !== undefined) updates.tags = body.tags;
      if (body.projectType !== undefined) updates.projectType = body.projectType;
      if (body.technologyTags !== undefined) updates.technologyTags = body.technologyTags;
      const [row] = await db.update(lessonsLearnt).set(updates).where(eq(lessonsLearnt.id, id)).returning();
      if (!row) return res.status(404).json({ error: "Lesson not found" });
      res.json(row);
    } catch (err: any) {
      console.error("[handover] PATCH lessons-learnt error:", err);
      res.status(500).json({ error: "Could not update lesson." });
    }
  });

  app.delete("/api/lessons-learnt/:id", requireAuth, requirePermission("handover", "delete"), async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const [row] = await db.update(lessonsLearnt).set({ deletedAt: new Date() }).where(eq(lessonsLearnt.id, id)).returning();
      if (!row) return res.status(404).json({ error: "Lesson not found" });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[handover] DELETE lessons-learnt error:", err);
      res.status(500).json({ error: "Could not delete lesson." });
    }
  });

  // ===================== HANDOVER STAKEHOLDERS =====================

  app.get("/api/pd-pm-handover/:projectId/stakeholders", requireAuth, requirePermission("handover", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const handoverRows = await db.select({ id: projectPdPmHandover.id }).from(projectPdPmHandover).where(eq(projectPdPmHandover.projectId, projectId)).limit(1);
      if (!handoverRows[0]) return res.json({ items: [] });
      const rows = await db.select().from(handoverStakeholders).where(and(eq(handoverStakeholders.handoverId, handoverRows[0].id), isNull(handoverStakeholders.deletedAt))).orderBy(handoverStakeholders.createdAt);
      res.json({ items: rows });
    } catch (err: any) {
      console.error("[handover] GET stakeholders error:", err);
      res.status(500).json({ error: "Could not load stakeholders." });
    }
  });

  app.post("/api/pd-pm-handover/:projectId/stakeholders", requireAuth, requirePermission("handover", "edit"), async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const handoverRows = await db.select({ id: projectPdPmHandover.id }).from(projectPdPmHandover).where(eq(projectPdPmHandover.projectId, projectId)).limit(1);
      if (!handoverRows[0]) return res.status(404).json({ error: "Handover not found. Save a draft first." });
      const body = req.body || {};
      if (!body.name || !body.role) return res.status(400).json({ error: "Name and role are required." });
      const [row] = await db.insert(handoverStakeholders).values({
        handoverId: handoverRows[0].id,
        name: body.name,
        role: body.role,
        company: body.company || null,
        phone: body.phone || null,
        email: body.email || null,
        notes: body.notes || null,
        counterpartyId: body.counterpartyId || null,
      }).returning();
      res.status(201).json(row);
    } catch (err: any) {
      console.error("[handover] POST stakeholders error:", err);
      res.status(500).json({ error: "Could not add stakeholder." });
    }
  });

  app.patch("/api/pd-pm-handover/:projectId/stakeholders/:id", requireAuth, requirePermission("handover", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid stakeholder ID" });
      const body = req.body || {};
      const updates: Record<string, any> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.role !== undefined) updates.role = body.role;
      if (body.company !== undefined) updates.company = body.company;
      if (body.phone !== undefined) updates.phone = body.phone;
      if (body.email !== undefined) updates.email = body.email;
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.counterpartyId !== undefined) updates.counterpartyId = body.counterpartyId;
      const [row] = await db.update(handoverStakeholders).set(updates).where(eq(handoverStakeholders.id, id)).returning();
      if (!row) return res.status(404).json({ error: "Stakeholder not found" });
      res.json(row);
    } catch (err: any) {
      console.error("[handover] PATCH stakeholders error:", err);
      res.status(500).json({ error: "Could not update stakeholder." });
    }
  });

  app.delete("/api/pd-pm-handover/:projectId/stakeholders/:id", requireAuth, requirePermission("handover", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid stakeholder ID" });
      const deleted = await db.update(handoverStakeholders).set({ deletedAt: new Date(), deletedBy: req.user?.id }).where(eq(handoverStakeholders.id, id)).returning();
      if (deleted.length === 0) return res.status(404).json({ error: "Stakeholder not found" });
      res.json({ success: true, record: deleted[0] });
    } catch (err: any) {
      console.error("[handover] DELETE stakeholders error:", err);
      res.status(500).json({ error: "Could not delete stakeholder." });
    }
  });

  // ===================== HANDOVER COMPLETE PROJECTS (for PM dashboard) =====================

  app.get("/api/pd-pm-handover/completed", requireAuth, requirePermission("handover", "view"), async (_req: Request, res: Response) => {
    try {
      const rows = await db
        .select({
          project_id: projectPdPmHandover.projectId,
          status: projectPdPmHandover.status,
          kickoff_date: projectPdPmHandover.kickoffDate,
          pd_sign_off_at: projectPdPmHandover.pdSignOffAt,
          pm_sign_off_at: projectPdPmHandover.pmSignOffAt,
          updated_at: projectPdPmHandover.updatedAt,
          project_name: projectInfo.projectName,
          client_name: sql<string>`COALESCE(${clients.name}, '')`,
          size_kwp: projectInfo.sizeKwp,
          pd: projectInfo.pd,
          pm: projectInfo.pm,
        })
        .from(projectPdPmHandover)
        .innerJoin(projectInfo, eq(projectInfo.id, projectPdPmHandover.projectId))
        .leftJoin(clients, eq(clients.id, projectInfo.clientId))
        .where(eq(projectPdPmHandover.status, "HANDOVER_COMPLETE"))
        .orderBy(desc(projectPdPmHandover.updatedAt));
      res.json({ items: rows });
    } catch (err: any) {
      console.error("[handover] GET completed error:", err);
      res.status(500).json({ error: "Could not load completed handovers." });
    }
  });

  // ===================== ADMIN OVERRIDE (version handover after sign-off) =====================

  app.put("/api/pd-pm-handover/:projectId/admin-override", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const handoverRows = await db.select().from(projectPdPmHandover).where(eq(projectPdPmHandover.projectId, projectId)).limit(1);
      const handover = handoverRows[0];
      if (!handover || handover.status !== "HANDOVER_COMPLETE") {
        return res.status(400).json({ error: "Admin override only applies to completed handovers." });
      }
      const user = (req as any).user as any;

      // Archive current state
      await insertPdPmHandoverHistory({
        projectId,
        req,
        action: "ADMIN_EDIT_OVERRIDE",
        details: {
          previousVersion: handover.version,
          archivedFormData: handover.handoverFormData,
          archivedBy: user?.name,
        },
      });

      const body = req.body || {};
      const updates: Record<string, any> = {
        version: (handover.version || 1) + 1,
        updatedAt: new Date(),
      };
      if (body.handoverFormData !== undefined) updates.handoverFormData = body.handoverFormData;
      if (body.readinessChecklist !== undefined) updates.readinessChecklist = body.readinessChecklist;
      if (body.kickoffDate !== undefined) updates.kickoffDate = body.kickoffDate;

      await db.update(projectPdPmHandover).set(updates).where(eq(projectPdPmHandover.projectId, projectId));
      logAuditFromReq(req, { entityType: "pd_pm_handover", entityId: String(projectId), action: "admin_override", changesJson: { newVersion: updates.version, editedBy: user?.name } });
      res.json({ success: true, version: updates.version });
    } catch (err: any) {
      console.error("[handover] admin-override error:", err);
      res.status(500).json({ error: "Could not apply admin override." });
    }
  });

}
