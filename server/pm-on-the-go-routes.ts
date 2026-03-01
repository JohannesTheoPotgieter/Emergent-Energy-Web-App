import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { sql, eq, and, gt } from "drizzle-orm";
import { verifyToken } from "./jwt";
import {
  projectInfo,
  pmSiteVisits,
  pmOnTheGoActions,
  pmComplianceTracking,
  pmModePreferences,
  notifications,
  notificationThrottle,
  users,
} from "@shared/schema";
import multer from "multer";
import path from "path";
import fs from "fs";
import { isOutlookConfigured, sendMail } from "./outlook";
import { sendExcelSyncNotification } from "./excel-sync-notifications";

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

function requireProjectManagerSite(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user || req.user;
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (user.role !== "PROJECT_MANAGER_SITE") {
    return res.status(403).json({ error: "Access denied. PROJECT_MANAGER_SITE role required." });
  }
  next();
}

async function requirePmAssignment(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user || req.user;
  const projectId = parseInt(req.params.projectId as string);
  if (!user || !projectId || isNaN(projectId)) {
    return res.status(400).json({ error: "Invalid project ID" });
  }
  try {
    const rows = await db
      .select({ pmUserId: projectInfo.pmUserId })
      .from(projectInfo)
      .where(eq(projectInfo.id, projectId))
      .limit(1);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }
    if (rows[0].pmUserId !== user.id) {
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

const DEDUP_WINDOW_MS = 2 * 60 * 1000;

async function throttledNotify(
  recipientUserId: number,
  eventType: string,
  title: string,
  body: string | null,
  opts: { projectName?: string } = {}
) {
  const existing = await db
    .select()
    .from(notificationThrottle)
    .where(
      and(
        eq(notificationThrottle.recipientUserId, recipientUserId),
        eq(notificationThrottle.eventType, eventType),
        eq(notificationThrottle.entityType, "pm_otg"),
        gt(notificationThrottle.lastSentAt, new Date(Date.now() - DEDUP_WINDOW_MS))
      )
    );
  if (existing.length > 0) return;

  await db.insert(notifications).values({
    recipientUserId,
    eventType,
    title,
    body,
    projectName: opts.projectName || null,
  });
  await db
    .insert(notificationThrottle)
    .values({
      recipientUserId,
      eventType,
      entityType: "pm_otg",
      entityId: 0,
    })
    .onConflictDoNothing();
}

async function getNotificationRecipients(projectId: number): Promise<{ id: number; email: string; name: string }[]> {
  const targetRoles = ["PROGRAM_MANAGER", "COO_ADMIN"];

  const project = await db
    .select({ phase: projectInfo.phase })
    .from(projectInfo)
    .where(eq(projectInfo.id, projectId))
    .limit(1);

  const isConstruction =
    project.length > 0 &&
    ["Construction", "Commissioning"].some((p) =>
      (project[0].phase || "").toLowerCase().includes(p.toLowerCase())
    );

  if (isConstruction) {
    targetRoles.push("CONSTRUCTION_MANAGER");
  }

  const recipients = await db.execute(
    sql`SELECT id, email, name FROM users WHERE role = ANY(${`{${targetRoles.join(",")}}`}::text[])`
  );
  return (recipients.rows as any[]).map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
  }));
}

async function notifyAndEmail(
  projectId: number,
  eventType: string,
  title: string,
  body: string,
  projectName: string,
  actorName: string
) {
  const recipients = await getNotificationRecipients(projectId);
  for (const r of recipients) {
    await throttledNotify(r.id, eventType, title, body, { projectName });
  }

  if (isOutlookConfigured() && recipients.length > 0) {
    try {
      await sendMail({
        to: recipients.map((r) => r.email),
        subject: `[PM On-The-Go] ${title}`,
        body: `${actorName} — ${body}\n\nProject: ${projectName}`,
        bodyType: "Text",
      });
    } catch (err: any) {
      console.warn("[PM-OTG] Email send failed:", err.message);
    }
  }
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
    requireProjectManagerSite,
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
    requireProjectManagerSite,
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
        res.json({ mode });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.get(
    "/api/pm-otg/projects",
    requireAuth,
    requireProjectManagerSite,
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
              (SELECT SUM(CAST(pe.budget_total AS NUMERIC))
               FROM program_expense pe WHERE pe.project_name = pi.project_name AND pe.row_type = 'item'), 0
            ) AS total_budget,
            COALESCE(
              (SELECT SUM(CAST(pe.expense_actual_total AS NUMERIC))
               FROM program_expense pe WHERE pe.project_name = pi.project_name AND pe.row_type = 'item'), 0
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
              (SELECT AVG(npt.pct_complete) * 100 FROM normalized_plan_tasks npt
               WHERE npt.project_name = pi.project_name
               AND npt.pct_complete IS NOT NULL), 0
            ) AS schedule_pct,
            COALESCE(
              (SELECT COUNT(*) FROM pm_on_the_go_actions a
               WHERE a.project_id = pi.id AND a.action_type = 'escalate'
               AND a.status = 'pending'), 0
            ) AS open_escalations
          FROM project_info pi
          WHERE pi.pm_user_id = ${user.id}
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
    requireProjectManagerSite,
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
            COALESCE(SUM(CAST(budget_total AS NUMERIC)), 0) AS total_budget,
            COALESCE(SUM(CAST(expense_actual_total AS NUMERIC)), 0) AS total_spent,
            COALESCE(SUM(CASE WHEN expense_po_number IS NOT NULL AND expense_po_number != '' THEN CAST(expense_actual_total AS NUMERIC) ELSE 0 END), 0) AS committed
          FROM program_expense
          WHERE project_name = ${p.projectName} AND row_type = 'item'
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
            COALESCE(AVG(npt.pct_complete) * 100, 0) AS actual_pct,
            COALESCE(
              AVG(
                CASE WHEN npt.actual_start IS NOT NULL AND npt.actual_end IS NOT NULL
                  AND npt.actual_start != '' AND npt.actual_end != ''
                THEN LEAST(1.0, GREATEST(0.0,
                  (EXTRACT(EPOCH FROM CURRENT_DATE) - EXTRACT(EPOCH FROM npt.actual_start::date))
                  / NULLIF(EXTRACT(EPOCH FROM npt.actual_end::date) - EXTRACT(EPOCH FROM npt.actual_start::date), 0)
                )) ELSE NULL END
              ) * 100, 0
            ) AS expected_pct
          FROM normalized_plan_tasks npt
          WHERE npt.project_name = ${p.projectName}
            AND npt.duration_days > 0
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
    requireProjectManagerSite,
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

        sendExcelSyncNotification({
          projectName: pName,
          changedByUserId: user.id,
          changeType: "pm_otg_action",
          changeDescription: `Site visit logged by ${user.name}. Safety: ${safetyStatus || "clear"}.`,
          details: { actionType: "site_visit", safetyStatus, visitId: visit.id },
        }).catch(() => {});

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
    requireProjectManagerSite,
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

        sendExcelSyncNotification({
          projectName: pName,
          changedByUserId: user.id,
          changeType: "pm_otg_action",
          changeDescription: `PO request ${poNumber} by ${user.name}.`,
          details: { actionType: "generate_po", poNumber, amount, supplier },
        }).catch(() => {});

        res.json({ success: true, action });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/link-invoice",
    requireAuth,
    requireProjectManagerSite,
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

        sendExcelSyncNotification({
          projectName: pName,
          changedByUserId: user.id,
          changeType: "pm_otg_action",
          changeDescription: `Invoice ${invoiceNumber} linked by ${user.name}.`,
          details: { actionType: "link_invoice", invoiceNumber, amount, poReference },
        }).catch(() => {});

        res.json({ success: true, action });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/raise-variation",
    requireAuth,
    requireProjectManagerSite,
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

        sendExcelSyncNotification({
          projectName: pName,
          changedByUserId: user.id,
          changeType: "pm_otg_action",
          changeDescription: `Variation order raised by ${user.name} for R${parseFloat(amount).toLocaleString()}.`,
          details: { actionType: "raise_variation", amount, description, justification },
        }).catch(() => {});

        res.json({ success: true, action });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/log-delay",
    requireAuth,
    requireProjectManagerSite,
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

        sendExcelSyncNotification({
          projectName: pName,
          changedByUserId: user.id,
          changeType: "pm_otg_action",
          changeDescription: `Delay of ${daysDelayed || "?"} days logged by ${user.name}.`,
          details: { actionType: "log_delay", daysDelayed, impact, description },
        }).catch(() => {});

        res.json({ success: true, action });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/log-risk",
    requireAuth,
    requireProjectManagerSite,
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

        sendExcelSyncNotification({
          projectName: pName,
          changedByUserId: user.id,
          changeType: "pm_otg_action",
          changeDescription: `${severity} risk logged by ${user.name}.`,
          details: { actionType: "log_risk", severity, description, mitigationNotes },
        }).catch(() => {});

        res.json({ success: true, action });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/upload-photo",
    requireAuth,
    requireProjectManagerSite,
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
        sendExcelSyncNotification({
          projectName: pName,
          changedByUserId: user.id,
          changeType: "pm_otg_action",
          changeDescription: `Photo uploaded by ${user.name}.`,
          details: { actionType: "upload_photo", caption },
        }).catch(() => {});

        res.json({ success: true, action, photoUrl });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/update-progress",
    requireAuth,
    requireProjectManagerSite,
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

        sendExcelSyncNotification({
          projectName: pName,
          changedByUserId: user.id,
          changeType: "pm_otg_action",
          changeDescription: `Progress updated to ${pct}% by ${user.name}.`,
          details: { actionType: "update_progress", progressPercent: pct, notes },
        }).catch(() => {});

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

        res.json({ success: true, action });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/pm-otg/projects/:projectId/escalate",
    requireAuth,
    requireProjectManagerSite,
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

        sendExcelSyncNotification({
          projectName: pName,
          changedByUserId: user.id,
          changeType: "pm_otg_action",
          changeDescription: `Project escalated by ${user.name}. Level: ${escalationLevel || "High"}.`,
          details: { actionType: "escalate", escalationLevel, urgency, description },
        }).catch(() => {});

        res.json({ success: true, action });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.get(
    "/api/pm-otg/projects/:projectId/compliance",
    requireAuth,
    requireProjectManagerSite,
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
    requireProjectManagerSite,
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
