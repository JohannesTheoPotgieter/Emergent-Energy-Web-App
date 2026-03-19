import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { sql, eq } from "drizzle-orm";
import { verifyToken } from "./jwt";
import {
  projectInfo,
  pmSiteVisits,
  pmOnTheGoActions,
  pmModePreferences,
} from "@shared/schema";
import multer from "multer";
import path from "path";
import fs from "fs";
// import { isOutlookConfigured, sendMail } from "./outlook"; // removed with notifications
import { logAuditFromReq } from "./audit-logger";

const photoUploadDir = path.join(process.cwd(), "uploads", "pm-photos");
if (!fs.existsSync(photoUploadDir)) {
  fs.mkdirSync(photoUploadDir, { recursive: true });
}

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, photoUploadDir),
    filename: (_req, file, cb) => {
      const ts = Date.now();
      const sanitized = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_");
      cb(null, `${ts}_${sanitized}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image and audio files are allowed."));
    }
  },
});

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const payload = verifyToken(authHeader.substring(7));
    if (payload) {
      (req as any).user = {
        id: payload.userId,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      };
    }
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.() || (req as any).user) return next();
  res.status(401).json({ error: "Authentication required" });
}

const ADMIN_ROLES = ["admin", "COO_ADMIN", "CEO_ADMIN", "CCO", "PROGRAM_MANAGER", "CONSTRUCTION_MANAGER"];

function requireProjectManagerOrAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user || req.user;
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (user.role !== "PROJECT_MANAGER_SITE" && !ADMIN_ROLES.includes(user.role)) {
    return res.status(403).json({ error: "Access denied. PM or admin role required." });
  }
  next();
}

async function requirePmAssignment(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user || req.user;
  const projectId = parseInt(req.params.projectId as string);
  if (!user || !projectId || isNaN(projectId)) {
    return res.status(400).json({ error: "Invalid project ID" });
  }
  if (ADMIN_ROLES.includes(user.role)) return next();
  try {
    const rows = await db
      .select({ pmUserId: projectInfo.pmUserId })
      .from(projectInfo)
      .where(eq(projectInfo.id, projectId))
      .limit(1);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }
    if (!rows[0].pmUserId || rows[0].pmUserId !== user.id) {
      return res.status(403).json({ error: "You are not assigned to this project" });
    }
    next();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

function getUser(req: Request): { id: number; name: string; role: string; email: string } {
  const u = (req as any).user || req.user;
  return { id: u.id, name: u.name, role: u.role, email: u.email };
}

// Notifications feature removed - throttledNotify is now a no-op
async function throttledNotify(
  _recipientUserId: number,
  _eventType: string,
  _title: string,
  _body: string | null,
  _opts: { projectName?: string } = {}
) {
  // no-op: notifications feature removed
}

// Notifications feature removed - notifyAndEmail is now a no-op
async function notifyAndEmail(
  _projectId: number,
  _eventType: string,
  _title: string,
  _body: string,
  _projectName: string,
  _actorName: string
) {
  // no-op: notifications feature removed
}

function getWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  return monday.toISOString().split("T")[0];
}

export function registerPmOnTheGoRoutes(app: Express) {
  app.use("/api/pm-otg", jwtAuth);

  app.get(
    "/api/pm-otg/mode",
    requireAuth,
    requireProjectManagerOrAdmin,
    async (req: Request, res: Response) => {
      try {
        const user = getUser(req);
        const rows = await db
          .select()
          .from(pmModePreferences)
          .where(eq(pmModePreferences.userId, user.id))
          .limit(1);
        res.json({ mode: rows.length > 0 ? rows[0].preferredMode : "full_detail" });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.put(
    "/api/pm-otg/mode",
    requireAuth,
    requireProjectManagerOrAdmin,
    async (req: Request, res: Response) => {
      try {
        const user = getUser(req);
        const { mode } = req.body;
        if (!["on_the_go", "full_detail"].includes(mode)) {
          return res.status(400).json({ error: "Invalid mode. Must be 'on_the_go' or 'full_detail'." });
        }
        const existing = await db
          .select()
          .from(pmModePreferences)
          .where(eq(pmModePreferences.userId, user.id))
          .limit(1);
        if (existing.length > 0) {
          await db.execute(
            sql`UPDATE pm_mode_preferences SET preferred_mode = ${mode}, updated_at = NOW() WHERE user_id = ${user.id}`
          );
        } else {
          await db.insert(pmModePreferences).values({ userId: user.id, preferredMode: mode });
        }
        logAuditFromReq(req, { entityType: "pm_mode_preference", entityId: String(user.id), action: "update", changesJson: { description: "Mode preference updated", mode } });
        res.json({ mode });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.get(
    "/api/pm-otg/projects",
    requireAuth,
    requireProjectManagerOrAdmin,
    async (req: Request, res: Response) => {
      try {
        const user = getUser(req);
        const projects = await db.execute(sql`
          SELECT
            pi.id,
            pi.project_name,
            pi.phase,
            pi.rag_status,
            pi.contract_value,
            pi.size_kwp,
            pi.escalation_level,
            pi.is_active,
            COALESCE(
              (SELECT SUM(CAST(ncl.amount_ex_vat AS NUMERIC))
               FROM normalized_cost_lines ncl WHERE ncl.project_name = pi.project_name), 0
            ) AS total_budget,
            COALESCE(
              (SELECT SUM(CAST(ncl.amount_ex_vat AS NUMERIC))
               FROM normalized_cost_lines ncl WHERE ncl.project_name = pi.project_name
               AND ncl.paid_date IS NOT NULL AND ncl.paid_date != ''), 0
            ) AS total_spent,
            COALESCE(
              (SELECT COUNT(*) FROM pm_on_the_go_actions a
               WHERE a.project_id = pi.id AND a.action_type = 'log_risk'
               AND a.status NOT IN ('completed', 'rejected')), 0
            ) AS open_risks,
            COALESCE(
              (SELECT SUM(CAST(a.amount AS NUMERIC)) FROM pm_on_the_go_actions a
               WHERE a.project_id = pi.id AND a.action_type = 'raise_variation'
               AND a.status = 'pending'), 0
            ) AS vo_pending,
            COALESCE(
              (SELECT AVG(wi.percent_complete) * 100 FROM work_items wi
               WHERE wi.project_id = pi.id
               AND wi.workstream = 'PM' AND wi.source = 'SMART_IMPORT' AND wi.deleted_at IS NULL
               AND wi.percent_complete IS NOT NULL), 0
            ) AS schedule_pct,
            COALESCE(
              (SELECT COUNT(*) FROM pm_on_the_go_actions a
               WHERE a.project_id = pi.id AND a.action_type = 'escalate'
               AND a.status = 'pending'), 0
            ) AS open_escalations
          FROM project_info pi
          WHERE ${ADMIN_ROLES.includes(user.role) ? sql`TRUE` : sql`pi.pm_user_id = ${user.id}`}
            AND pi.archived_status = 'ACTIVE'
          ORDER BY pi.project_name
        `);

        const result = (projects.rows as any[]).map((p) => {
          const budget = parseFloat(p.total_budget) || 0;
          const spent = parseFloat(p.total_spent) || 0;
          return {
            id: p.id,
            projectName: p.project_name,
            phase: p.phase,
            ragStatus: p.rag_status,
            contractValue: parseFloat(p.contract_value) || 0,
            sizeKwp: parseFloat(p.size_kwp) || 0,
            escalationLevel: p.escalation_level,
            isActive: p.is_active,
            budget,
            spent,
            spendPercent: budget > 0 ? Math.round((spent / budget) * 100) : 0,
            openRisks: parseInt(p.open_risks) || 0,
            voPending: parseFloat(p.vo_pending) || 0,
            schedulePct: Math.round(parseFloat(p.schedule_pct) || 0),
            openEscalations: parseInt(p.open_escalations) || 0,
          };
        });

        res.json({ projects: result });
      } catch (err: any) {
        console.error("[PM-OTG] Projects error:", err.message);
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.get(
    "/api/pm-otg/projects/:projectId/snapshot",
    requireAuth,
    requireProjectManagerOrAdmin,
    requirePmAssignment,
    async (req: Request, res: Response) => {
      try {
        const projectId = parseInt(req.params.projectId as string);
        const project = await db
          .select()
          .from(projectInfo)
          .where(eq(projectInfo.id, projectId))
          .limit(1);
        if (project.length === 0) return res.status(404).json({ error: "Project not found" });

        const p = project[0];

        const financials = await db.execute(sql`
          SELECT
            COALESCE(SUM(CAST(amount_ex_vat AS NUMERIC)), 0) AS total_budget,
            COALESCE(SUM(CASE WHEN paid_date IS NOT NULL AND paid_date != '' THEN CAST(amount_ex_vat AS NUMERIC) ELSE 0 END), 0) AS total_spent,
            COALESCE(SUM(CASE WHEN po_number IS NOT NULL AND po_number != '' THEN CAST(amount_ex_vat AS NUMERIC) ELSE 0 END), 0) AS committed
          FROM normalized_cost_lines
          WHERE project_name = ${p.projectName}
        `);
        const fin = (financials.rows as any[])[0] || {};
        const budget = parseFloat(fin.total_budget) || 0;
        const spent = parseFloat(fin.total_spent) || 0;
        const committed = parseFloat(fin.committed) || 0;

        const voPendingResult = await db.execute(sql`
          SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0) AS vo_pending
          FROM pm_on_the_go_actions
          WHERE project_id = ${projectId} AND action_type = 'raise_variation' AND status = 'pending'
        `);
        const voPending = parseFloat((voPendingResult.rows as any[])[0]?.vo_pending) || 0;

        const spendRatio = budget > 0 ? (spent / budget) * 100 : 0;
        let cashflowStatus: "on_track" | "risk" | "critical" = "on_track";
        if (spendRatio > 110) cashflowStatus = "critical";
        else if (spendRatio > 90) cashflowStatus = "risk";

        const scheduleResult = await db.execute(sql`
          SELECT
            COALESCE(AVG(wi.percent_complete) * 100, 0) AS actual_pct,
            COALESCE(
              AVG(
                CASE WHEN wi.start_date IS NOT NULL AND wi.end_date IS NOT NULL
                  AND wi.start_date != '' AND wi.end_date != ''
                THEN LEAST(1.0, GREATEST(0.0,
                  (EXTRACT(EPOCH FROM CURRENT_DATE) - EXTRACT(EPOCH FROM wi.start_date::date))
                  / NULLIF(EXTRACT(EPOCH FROM wi.end_date::date) - EXTRACT(EPOCH FROM wi.start_date::date), 0)
                )) ELSE NULL END
              ) * 100, 0
            ) AS expected_pct
          FROM work_items wi
          WHERE wi.project_id = ${projectId}
            AND wi.workstream = 'PM' AND wi.source = 'SMART_IMPORT' AND wi.deleted_at IS NULL
            AND wi.duration > 0
        `);
        const sched = (scheduleResult.rows as any[])[0] || {};
        const actualPct = Math.round(parseFloat(sched.actual_pct) || 0);
        const expectedPct = Math.round(parseFloat(sched.expected_pct) || 0);
        const daysDelta = Math.round((actualPct - expectedPct) * 0.5);

        const safetyResult = await db.execute(sql`
          SELECT safety_status FROM pm_site_visits
          WHERE project_id = ${projectId}
          ORDER BY created_at DESC LIMIT 1
        `);
        const safetyStatus =
          (safetyResult.rows as any[])[0]?.safety_status || "clear";

        res.json({
          projectId,
          projectName: p.projectName,
          phase: p.phase,
          budget,
          committed,
          spent,
          spendPercent: budget > 0 ? Math.round((spent / budget) * 100) : 0,
          voPending,
          cashflowStatus,
          schedulePct: actualPct,
          expectedPct,
          daysBehindAhead: daysDelta,
          safetyStatus,
        });
      } catch (err: any) {
        console.error("[PM-OTG] Snapshot error:", err.message);
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/site-visit",
    requireAuth,
    requireProjectManagerOrAdmin,
    requirePmAssignment,
    photoUpload.array("photos", 10),
    async (req: Request, res: Response) => {
      try {
        const user = getUser(req);
        const projectId = parseInt(req.params.projectId as string);
        const { notes, weatherConditions, safetyStatus, visitDate } = req.body;
        const files = (req.files as Express.Multer.File[]) || [];
        const photoIds = files.map((f) => `/uploads/pm-photos/${f.filename}`);

        const [visit] = await db
          .insert(pmSiteVisits)
          .values({
            projectId,
            userId: user.id,
            visitDate: visitDate || new Date().toISOString().split("T")[0],
            notes: notes || null,
            weatherConditions: weatherConditions || null,
            safetyStatus: safetyStatus === "issue_open" ? "issue_open" : "clear",
            photoIds,
            createdBy: user.name,
            updatedBy: user.name,
            source: "on_the_go",
          })
          .returning();

        await db.insert(pmOnTheGoActions).values({
          projectId,
          userId: user.id,
          actionType: "site_visit",
          title: `Site visit logged`,
          description: notes || null,
          metadata: { visitId: visit.id, weather: weatherConditions, safety: safetyStatus, photos: photoIds },
          createdBy: user.name,
          updatedBy: user.name,
          source: "on_the_go",
        });

        const pName = await getProjectName(projectId);
        await notifyAndEmail(
          projectId,
          "pm_otg.site_visit",
          `Site visit logged: ${pName}`,
          `${user.name} logged a site visit. Safety: ${safetyStatus || "clear"}.${notes ? ` Notes: ${notes}` : ""}`,
          pName,
          user.name
        );

        if (safetyStatus === "issue_open") {
          await notifyAndEmail(
            projectId,
            "pm_otg.safety_issue",
            `⚠️ Safety issue: ${pName}`,
            `${user.name} reported a safety issue during site visit.${notes ? ` Notes: ${notes}` : ""}`,
            pName,
            user.name
          );
        }

        logAuditFromReq(req, { entityType: "pm_otg_action", entityId: String(visit.id), action: "create", projectName: pName, changesJson: { description: "Site visit logged", safetyStatus, photoCount: photoIds.length } });
        res.json({ success: true, visit });
      } catch (err: any) {
        console.error("[PM-OTG] Site visit error:", err.message);
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/generate-po",
    requireAuth,
    requireProjectManagerOrAdmin,
    requirePmAssignment,
    async (req: Request, res: Response) => {
      try {
        const user = getUser(req);
        const projectId = parseInt(req.params.projectId as string);
        const { poNumber, description, amount, supplier } = req.body;
        if (!poNumber || !description) {
          return res.status(400).json({ error: "PO number and description are required" });
        }

        const [action] = await db
          .insert(pmOnTheGoActions)
          .values({
            projectId,
            userId: user.id,
            actionType: "generate_po",
            title: `PO Request: ${poNumber}`,
            description,
            amount: amount || null,
            status: "pending",
            metadata: { poNumber, supplier: supplier || null },
            createdBy: user.name,
            updatedBy: user.name,
            source: "on_the_go",
          })
          .returning();

        const pName = await getProjectName(projectId);
        await notifyAndEmail(
          projectId,
          "pm_otg.generate_po",
          `PO Request: ${poNumber} — ${pName}`,
          `${user.name} requested PO ${poNumber}. Amount: R${parseFloat(amount || 0).toLocaleString()}. Supplier: ${supplier || "N/A"}. ${description}`,
          pName,
          user.name
        );

        logAuditFromReq(req, { entityType: "pm_otg_action", entityId: String(action.id), action: "create", projectName: pName, changesJson: { description: "PO request generated", poNumber, amount, supplier } });
        res.json({ success: true, action });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/link-invoice",
    requireAuth,
    requireProjectManagerOrAdmin,
    requirePmAssignment,
    async (req: Request, res: Response) => {
      try {
        const user = getUser(req);
        const projectId = parseInt(req.params.projectId as string);
        const { invoiceNumber, amount, poReference } = req.body;
        if (!invoiceNumber) {
          return res.status(400).json({ error: "Invoice number is required" });
        }

        const [action] = await db
          .insert(pmOnTheGoActions)
          .values({
            projectId,
            userId: user.id,
            actionType: "link_invoice",
            title: `Invoice linked: ${invoiceNumber}`,
            description: `PO Ref: ${poReference || "N/A"}`,
            amount: amount || null,
            metadata: { invoiceNumber, poReference: poReference || null },
            createdBy: user.name,
            updatedBy: user.name,
            source: "on_the_go",
          })
          .returning();

        const pName = await getProjectName(projectId);
        await notifyAndEmail(
          projectId,
          "pm_otg.link_invoice",
          `Invoice linked: ${invoiceNumber} — ${pName}`,
          `${user.name} linked invoice ${invoiceNumber}. Amount: R${parseFloat(amount || 0).toLocaleString()}. PO: ${poReference || "N/A"}`,
          pName,
          user.name
        );

        logAuditFromReq(req, { entityType: "pm_otg_action", entityId: String(action.id), action: "create", projectName: pName, changesJson: { description: "Invoice linked", invoiceNumber, amount, poReference } });
        res.json({ success: true, action });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/raise-variation",
    requireAuth,
    requireProjectManagerOrAdmin,
    requirePmAssignment,
    async (req: Request, res: Response) => {
      try {
        const user = getUser(req);
        const projectId = parseInt(req.params.projectId as string);
        const { description, amount, justification } = req.body;
        if (!description || !amount) {
          return res.status(400).json({ error: "Description and amount are required" });
        }

        const [action] = await db
          .insert(pmOnTheGoActions)
          .values({
            projectId,
            userId: user.id,
            actionType: "raise_variation",
            title: `Variation Order: R${parseFloat(amount).toLocaleString()}`,
            description,
            amount,
            status: "pending",
            metadata: { justification: justification || null },
            createdBy: user.name,
            updatedBy: user.name,
            source: "on_the_go",
          })
          .returning();

        const pName = await getProjectName(projectId);
        await notifyAndEmail(
          projectId,
          "pm_otg.raise_variation",
          `VO Raised: R${parseFloat(amount).toLocaleString()} — ${pName}`,
          `${user.name} raised a variation order for R${parseFloat(amount).toLocaleString()}. ${description}. Justification: ${justification || "None"}`,
          pName,
          user.name
        );

        logAuditFromReq(req, { entityType: "pm_otg_action", entityId: String(action.id), action: "create", projectName: pName, changesJson: { description: "Variation order raised", amount, justification } });
        res.json({ success: true, action });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/log-delay",
    requireAuth,
    requireProjectManagerOrAdmin,
    requirePmAssignment,
    async (req: Request, res: Response) => {
      try {
        const user = getUser(req);
        const projectId = parseInt(req.params.projectId as string);
        const { description, daysDelayed, impact } = req.body;
        if (!description) {
          return res.status(400).json({ error: "Description is required" });
        }

        const [action] = await db
          .insert(pmOnTheGoActions)
          .values({
            projectId,
            userId: user.id,
            actionType: "log_delay",
            title: `Delay: ${daysDelayed || "?"} days`,
            description,
            severity: impact || "Medium",
            metadata: { daysDelayed: parseInt(daysDelayed) || 0, impact: impact || "Medium" },
            createdBy: user.name,
            updatedBy: user.name,
            source: "on_the_go",
          })
          .returning();

        const pName = await getProjectName(projectId);
        await notifyAndEmail(
          projectId,
          "pm_otg.log_delay",
          `Delay logged: ${daysDelayed || "?"} days — ${pName}`,
          `${user.name} logged a delay of ${daysDelayed || "?"} days. Impact: ${impact || "Medium"}. ${description}`,
          pName,
          user.name
        );

        logAuditFromReq(req, { entityType: "pm_otg_action", entityId: String(action.id), action: "create", projectName: pName, changesJson: { description: "Delay logged", daysDelayed, impact } });
        res.json({ success: true, action });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/log-risk",
    requireAuth,
    requireProjectManagerOrAdmin,
    requirePmAssignment,
    async (req: Request, res: Response) => {
      try {
        const user = getUser(req);
        const projectId = parseInt(req.params.projectId as string);
        const { description, severity, mitigationNotes } = req.body;
        if (!description || !severity) {
          return res.status(400).json({ error: "Description and severity are required" });
        }

        const [action] = await db
          .insert(pmOnTheGoActions)
          .values({
            projectId,
            userId: user.id,
            actionType: "log_risk",
            title: `Risk: ${severity}`,
            description,
            severity,
            metadata: { mitigationNotes: mitigationNotes || null },
            createdBy: user.name,
            updatedBy: user.name,
            source: "on_the_go",
          })
          .returning();

        const pName = await getProjectName(projectId);
        await notifyAndEmail(
          projectId,
          "pm_otg.log_risk",
          `Risk logged (${severity}): ${pName}`,
          `${user.name} logged a ${severity} risk. ${description}. Mitigation: ${mitigationNotes || "None"}`,
          pName,
          user.name
        );

        logAuditFromReq(req, { entityType: "pm_otg_action", entityId: String(action.id), action: "create", projectName: pName, changesJson: { description: "Risk logged", severity, mitigationNotes } });
        res.json({ success: true, action });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/upload-photo",
    requireAuth,
    requireProjectManagerOrAdmin,
    requirePmAssignment,
    photoUpload.single("photo"),
    async (req: Request, res: Response) => {
      try {
        const user = getUser(req);
        const projectId = parseInt(req.params.projectId as string);
        const file = req.file;
        if (!file) {
          return res.status(400).json({ error: "Photo file is required" });
        }
        const { caption, linkedEvent } = req.body;
        const photoUrl = `/uploads/pm-photos/${file.filename}`;

        const [action] = await db
          .insert(pmOnTheGoActions)
          .values({
            projectId,
            userId: user.id,
            actionType: "upload_photo",
            title: caption || "Photo uploaded",
            description: caption || null,
            metadata: { photoUrl, linkedEvent: linkedEvent || null },
            createdBy: user.name,
            updatedBy: user.name,
            source: "on_the_go",
          })
          .returning();

        const pName = await getProjectName(projectId);

        logAuditFromReq(req, { entityType: "pm_otg_action", entityId: String(action.id), action: "create", projectName: pName, changesJson: { description: "Photo uploaded", caption } });
        res.json({ success: true, action, photoUrl });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/update-progress",
    requireAuth,
    requireProjectManagerOrAdmin,
    requirePmAssignment,
    async (req: Request, res: Response) => {
      try {
        const user = getUser(req);
        const projectId = parseInt(req.params.projectId as string);
        const { progressPercent, notes } = req.body;
        const pct = parseInt(progressPercent);
        if (isNaN(pct) || pct < 0 || pct > 100) {
          return res.status(400).json({ error: "Progress must be 0-100" });
        }

        const [action] = await db
          .insert(pmOnTheGoActions)
          .values({
            projectId,
            userId: user.id,
            actionType: "update_progress",
            title: `Progress updated to ${pct}%`,
            description: notes || null,
            metadata: { progressPercent: pct },
            createdBy: user.name,
            updatedBy: user.name,
            source: "on_the_go",
          })
          .returning();

        const pName = await getProjectName(projectId);
        await notifyAndEmail(
          projectId,
          "pm_otg.update_progress",
          `Progress: ${pct}% — ${pName}`,
          `${user.name} updated progress to ${pct}%.${notes ? ` Notes: ${notes}` : ""}`,
          pName,
          user.name
        );

        const weekStart = getWeekStart();
        await db.execute(sql`
          INSERT INTO pm_compliance_tracking (project_id, user_id, week_start_date, weekly_progress_done)
          VALUES (${projectId}, ${user.id}, ${weekStart}, true)
          ON CONFLICT (project_id, user_id, week_start_date)
          DO UPDATE SET weekly_progress_done = true, updated_at = NOW()
        `).catch(() => {
          db.execute(sql`
            UPDATE pm_compliance_tracking
            SET weekly_progress_done = true, updated_at = NOW()
            WHERE project_id = ${projectId} AND user_id = ${user.id} AND week_start_date = ${weekStart}
          `).catch(() => {});
        });

        logAuditFromReq(req, { entityType: "pm_otg_action", entityId: String(action.id), action: "create", projectName: pName, changesJson: { description: "Progress updated", progressPercent: pct, notes } });
        res.json({ success: true, action });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/escalate",
    requireAuth,
    requireProjectManagerOrAdmin,
    requirePmAssignment,
    async (req: Request, res: Response) => {
      try {
        const user = getUser(req);
        const projectId = parseInt(req.params.projectId as string);
        const { description, escalationLevel, urgency } = req.body;
        if (!description) {
          return res.status(400).json({ error: "Description is required" });
        }

        const [action] = await db
          .insert(pmOnTheGoActions)
          .values({
            projectId,
            userId: user.id,
            actionType: "escalate",
            title: `Escalation: ${escalationLevel || "High"}`,
            description,
            severity: urgency || "High",
            status: "pending",
            metadata: { escalationLevel: escalationLevel || "High", urgency: urgency || "High" },
            createdBy: user.name,
            updatedBy: user.name,
            source: "on_the_go",
          })
          .returning();

        await db.execute(
          sql`UPDATE project_info SET escalation_level = ${escalationLevel || "High"} WHERE id = ${projectId}`
        );

        const pName = await getProjectName(projectId);
        await notifyAndEmail(
          projectId,
          "pm_otg.escalate",
          `🚨 Escalation: ${pName}`,
          `${user.name} escalated project. Level: ${escalationLevel || "High"}. Urgency: ${urgency || "High"}. ${description}`,
          pName,
          user.name
        );

        logAuditFromReq(req, { entityType: "pm_otg_action", entityId: String(action.id), action: "create", projectName: pName, changesJson: { description: "Escalation raised", escalationLevel, urgency } });
        res.json({ success: true, action });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.get(
    "/api/pm-otg/projects/:projectId/compliance",
    requireAuth,
    requireProjectManagerOrAdmin,
    requirePmAssignment,
    async (req: Request, res: Response) => {
      try {
        const user = getUser(req);
        const projectId = parseInt(req.params.projectId as string);
        const weekStart = getWeekStart();

        const rows = await db.execute(sql`
          SELECT * FROM pm_compliance_tracking
          WHERE project_id = ${projectId}
            AND user_id = ${user.id}
            AND week_start_date = ${weekStart}
          LIMIT 1
        `);

        if ((rows.rows as any[]).length === 0) {
          const today = new Date().toISOString().split("T")[0];
          const hasSiteVisitToday = await db.execute(sql`
            SELECT 1 FROM pm_site_visits
            WHERE project_id = ${projectId} AND user_id = ${user.id}
              AND visit_date = ${today}
            LIMIT 1
          `);

          return res.json({
            weekStartDate: weekStart,
            dailyDiaryDone: (hasSiteVisitToday.rows as any[]).length > 0 ? [today] : [],
            weeklyProgressDone: false,
            weeklyRiskDone: false,
          });
        }

        const row = (rows.rows as any[])[0];
        res.json({
          weekStartDate: weekStart,
          dailyDiaryDone: row.daily_diary_done || [],
          weeklyProgressDone: row.weekly_progress_done || false,
          weeklyRiskDone: row.weekly_risk_done || false,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/compliance/risk-confirm",
    requireAuth,
    requireProjectManagerOrAdmin,
    requirePmAssignment,
    async (req: Request, res: Response) => {
      try {
        const user = getUser(req);
        const projectId = parseInt(req.params.projectId as string);
        const weekStart = getWeekStart();

        await db.execute(sql`
          INSERT INTO pm_compliance_tracking (project_id, user_id, week_start_date, weekly_risk_done)
          VALUES (${projectId}, ${user.id}, ${weekStart}, true)
          ON CONFLICT (project_id, user_id, week_start_date)
          DO UPDATE SET weekly_risk_done = true, updated_at = NOW()
        `).catch(() => {
          db.execute(sql`
            UPDATE pm_compliance_tracking
            SET weekly_risk_done = true, updated_at = NOW()
            WHERE project_id = ${projectId} AND user_id = ${user.id} AND week_start_date = ${weekStart}
          `).catch(() => {});
        });

        logAuditFromReq(req, { entityType: "pm_compliance", entityId: String(projectId), action: "update", changesJson: { description: "Weekly risk compliance confirmed", weekStart } });
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );
}

async function getProjectName(projectId: number): Promise<string> {
  const rows = await db
    .select({ projectName: projectInfo.projectName })
    .from(projectInfo)
    .where(eq(projectInfo.id, projectId))
    .limit(1);
  return rows.length > 0 ? rows[0].projectName : "Unknown Project";
}
