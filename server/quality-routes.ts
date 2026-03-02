import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { verifyToken } from "./jwt";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  qcTemplate, qcTemplatePhase, qcTemplateGroup, qcTemplateItem,
  qcTemplateRiskQuestion, qcTemplatePostmortemMetric,
  qcChecklist, qcItemInstance, qcItemEvidence, qcRiskAnswer,
  qcPlanLink, qcWarning, qcWarningEvent,
  qcPostmortem, qcPostmortemMetricValue, qcPostmortemSummary,
  qcAccessChallenge, calendarHoliday,
  notifications, notificationThrottle,
} from "@shared/schema";
import { requirePermission } from "./permission-middleware";
import { sendExcelSyncNotification } from "./excel-sync-notifications";
import { logAuditFromReq } from "./audit-logger";
import { getAllPMWorkItemsAsProjectPlan } from "./work-items-adapter";

const qmApprovalUploadsDir = path.join(process.cwd(), "uploads", "qm-approvals");
if (!fs.existsSync(qmApprovalUploadsDir)) fs.mkdirSync(qmApprovalUploadsDir, { recursive: true });
const qmApprovalUpload = multer({
  storage: multer.diskStorage({
    destination: qmApprovalUploadsDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

type AppUser = { id: number; email: string; name: string; role: string; };

function getUser(req: Request): AppUser {
  return req.user as any as AppUser;
}

function getUserRole(req: Request): string {
  return (req.user as any)?.role || "";
}

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  if (req.isAuthenticated?.()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
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

function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (roles.includes(getUserRole(req))) return next();
    res.status(403).json({ error: "forbidden", message: `Requires one of: ${roles.join(', ')}` });
  };
}

function isAdminRole(role: string) {
  return role === "admin" || role === "COO_ADMIN" || role === "CEO_ADMIN";
}

function requireQmChallenge(req: Request, res: Response, next: NextFunction) {
  if (isAdminRole(getUserRole(req))) return next();
  if ((req.session as any)?.qmChallengePassed) return next();
  res.status(403).json({ error: "qm_challenge_required", message: "Quality Manager access code required", code: "QM_CHALLENGE_REQUIRED" });
}

function requireEpmChallenge(req: Request, res: Response, next: NextFunction) {
  if (isAdminRole(getUserRole(req))) return next();
  if ((req.session as any)?.epmChallengePassed) return next();
  res.status(403).json({ error: "epm_challenge_required", message: "Engineering Program Manager access code required", code: "EPM_CHALLENGE_REQUIRED" });
}

function requireAdminOrQm(req: Request, res: Response, next: NextFunction) {
  const role = getUserRole(req);
  if (isAdminRole(role) || role === "quality_manager" || role === "QUALITY_MANAGER") return next();
  res.status(403).json({ error: "forbidden", message: "Admin or Quality Manager access required" });
}

function requireAdminOrEpm(req: Request, res: Response, next: NextFunction) {
  const role = getUserRole(req);
  if (isAdminRole(role) || role === "eng_program_manager" || role === "ENGINEERING_MANAGER") return next();
  res.status(403).json({ error: "forbidden", message: "Admin or Engineering Program Manager access required" });
}

import { gt } from "drizzle-orm";

async function createQmNotification(recipientUserId: number, eventType: string, title: string, body: string | null, opts: {
  projectName?: string; linkedTaskId?: number;
} = {}) {
  const throttleKey = `${eventType}:${opts.linkedTaskId || 0}`;
  const existing = await db.select().from(notificationThrottle)
    .where(and(
      eq(notificationThrottle.recipientUserId, recipientUserId),
      eq(notificationThrottle.eventType, eventType),
      eq(notificationThrottle.entityType, throttleKey.split(':')[0] || 'generic'),
      eq(notificationThrottle.entityId, opts.linkedTaskId || 0),
      gt(notificationThrottle.lastSentAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
    ));
  if (existing.length > 0) return null;

  const [notif] = await db.insert(notifications).values({
    recipientUserId, eventType, title, body,
    projectName: opts.projectName || null,
    linkedTaskId: opts.linkedTaskId || null,
  }).returning();

  await db.insert(notificationThrottle).values({
    recipientUserId, eventType,
    entityType: throttleKey.split(':')[0] || 'generic',
    entityId: opts.linkedTaskId || 0,
  }).onConflictDoNothing();

  return notif;
}

function businessDaysBetween(startStr: string, endStr: string, holidays: string[]): number {
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  const holSet = new Set(holidays);
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getDay();
    const dateStr = cur.toISOString().split('T')[0];
    if (day !== 0 && day !== 6 && !holSet.has(dateStr)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export function registerQualityRoutes(app: Express) {

  app.use("/api/quality", jwtAuth);
  app.use("/api/engineering", jwtAuth);

  // ========== QM ACCESS CHALLENGE ==========

  app.post("/api/quality/access/verify", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      const { code } = req.body;
      const userId = getUser(req).id;
      const role = getUser(req).role;
      const expectedCode = process.env.QM_ACCESS_CODE;

      if (!expectedCode) {
        return res.status(503).json({ error: "QM_ACCESS_CODE not configured. Contact admin." });
      }

      let [challenge] = await db.select().from(qcAccessChallenge)
        .where(and(eq(qcAccessChallenge.userId, userId), eq(qcAccessChallenge.role, role)));

      if (!challenge) {
        [challenge] = await db.insert(qcAccessChallenge).values({
          userId, role, failedAttemptsCount: 0,
        }).returning();
      }

      if (challenge.lockedUntil && new Date(challenge.lockedUntil) > new Date()) {
        const remaining = Math.ceil((new Date(challenge.lockedUntil).getTime() - Date.now()) / 60000);
        return res.status(429).json({ error: `Account locked. Try again in ${remaining} minutes.`, locked: true });
      }

      if (code === expectedCode) {
        await db.update(qcAccessChallenge)
          .set({ lastSuccessAt: new Date(), failedAttemptsCount: 0, lockedUntil: null, updatedAt: new Date() })
          .where(eq(qcAccessChallenge.id, challenge.id));
        (req.session as any).qmChallengePassed = true;
        return res.json({ success: true });
      }

      const newCount = (challenge.failedAttemptsCount || 0) + 1;
      const updates: any = { failedAttemptsCount: newCount, updatedAt: new Date() };
      if (newCount >= 5) {
        updates.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      await db.update(qcAccessChallenge).set(updates).where(eq(qcAccessChallenge.id, challenge.id));

      if (newCount >= 5) {
        return res.status(429).json({ error: "Too many failed attempts. Locked for 15 minutes.", locked: true });
      }
      return res.status(401).json({ error: "Invalid access code", attemptsRemaining: 5 - newCount });
    } catch (err: any) {
      console.error("[Quality] Access verify error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/quality/access/status", requireAuth, async (req, res) => {
    try {
      const hasCode = !!process.env.QM_ACCESS_CODE;
      const challenged = !!(req.session as any)?.qmChallengePassed;
      const userRole = getUserRole(req);
      const needsChallenge = (userRole === "quality_manager") && !challenged;
      res.json({ hasCode, challenged, needsChallenge, role: userRole });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== EPM ACCESS CHALLENGE ==========

  app.post("/api/engineering/access/verify", requireAuth, requireAdminOrEpm, async (req, res) => {
    try {
      const { code } = req.body;
      const userId = getUser(req).id;
      const role = "eng_program_manager";
      const expectedCode = process.env.EPM_ACCESS_CODE;

      if (!expectedCode) {
        return res.status(503).json({ error: "EPM_ACCESS_CODE not configured. Contact admin." });
      }

      let [challenge] = await db.select().from(qcAccessChallenge)
        .where(and(eq(qcAccessChallenge.userId, userId), eq(qcAccessChallenge.role, role)));

      if (!challenge) {
        [challenge] = await db.insert(qcAccessChallenge).values({
          userId, role, failedAttemptsCount: 0,
        }).returning();
      }

      if (challenge.lockedUntil && new Date(challenge.lockedUntil) > new Date()) {
        const remaining = Math.ceil((new Date(challenge.lockedUntil).getTime() - Date.now()) / 60000);
        return res.status(429).json({ error: `Account locked. Try again in ${remaining} minutes.`, locked: true });
      }

      if (code === expectedCode) {
        await db.update(qcAccessChallenge)
          .set({ lastSuccessAt: new Date(), failedAttemptsCount: 0, lockedUntil: null, updatedAt: new Date() })
          .where(eq(qcAccessChallenge.id, challenge.id));
        (req.session as any).epmChallengePassed = true;
        return res.json({ success: true });
      }

      const newCount = (challenge.failedAttemptsCount || 0) + 1;
      const updates: any = { failedAttemptsCount: newCount, updatedAt: new Date() };
      if (newCount >= 5) {
        updates.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      await db.update(qcAccessChallenge).set(updates).where(eq(qcAccessChallenge.id, challenge.id));

      if (newCount >= 5) {
        return res.status(429).json({ error: "Too many failed attempts. Locked for 15 minutes.", locked: true });
      }
      return res.status(401).json({ error: "Invalid access code", attemptsRemaining: 5 - newCount });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/engineering/access/status", requireAuth, async (req, res) => {
    try {
      const hasCode = !!process.env.EPM_ACCESS_CODE;
      const challenged = !!(req.session as any)?.epmChallengePassed;
      const userRole = getUserRole(req);
      const needsChallenge = (userRole === "eng_program_manager") && !challenged;
      res.json({ hasCode, challenged, needsChallenge, role: userRole });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== TEMPLATES (admin read) ==========

  app.get("/api/quality/templates", requireAuth, async (req, res) => {
    try {
      const templates = await db.select().from(qcTemplate);
      res.json(templates);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/quality/templates/:templateId", requireAuth, async (req, res) => {
    try {
      const tid = parseInt(req.params.templateId);
      const [tmpl] = await db.select().from(qcTemplate).where(eq(qcTemplate.id, tid));
      if (!tmpl) return res.status(404).json({ error: "Template not found" });

      const phases = await db.select().from(qcTemplatePhase).where(eq(qcTemplatePhase.templateId, tid));
      const phaseIds = phases.map(p => p.id);

      const groups = phaseIds.length ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.templatePhaseId, phaseIds)) : [];
      const groupIds = groups.map(g => g.id);
      const items = groupIds.length ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.templateGroupId, groupIds)) : [];
      const riskQuestions = phaseIds.length ? await db.select().from(qcTemplateRiskQuestion).where(inArray(qcTemplateRiskQuestion.templatePhaseId, phaseIds)) : [];
      const metrics = await db.select().from(qcTemplatePostmortemMetric);

      res.json({ template: tmpl, phases, groups, items, riskQuestions, metrics });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== PROJECT CHECKLIST ==========

  app.get("/api/quality/project/:projectName/checklist", requireAuth, async (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);
      let [checklist] = await db.select().from(qcChecklist).where(eq(qcChecklist.projectName, projectName));

      if (!checklist) {
        const [activeTemplate] = await db.select().from(qcTemplate).where(eq(qcTemplate.isActive, true));
        if (!activeTemplate) return res.json({ checklist: null, phases: [], items: [], riskQuestions: [], riskAnswers: [], evidence: [] });

        [checklist] = await db.insert(qcChecklist).values({
          projectName, templateId: activeTemplate.id, status: "active",
        }).returning();

        const phases = await db.select().from(qcTemplatePhase).where(eq(qcTemplatePhase.templateId, activeTemplate.id));
        const phaseIds = phases.map(p => p.id);
        const groups = phaseIds.length ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.templatePhaseId, phaseIds)) : [];
        const groupIds = groups.map(g => g.id);
        const templateItems = groupIds.length ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.templateGroupId, groupIds)) : [];

        if (templateItems.length) {
          await db.insert(qcItemInstance).values(
            templateItems.map(ti => ({ checklistId: checklist.id, templateItemId: ti.id }))
          );
        }

        const riskQuestions = phaseIds.length ? await db.select().from(qcTemplateRiskQuestion).where(inArray(qcTemplateRiskQuestion.templatePhaseId, phaseIds)) : [];
        if (riskQuestions.length) {
          await db.insert(qcRiskAnswer).values(
            riskQuestions.map(rq => ({ checklistId: checklist.id, templateRiskQuestionId: rq.id }))
          );
        }
      }

      const itemInstances = await db.select().from(qcItemInstance).where(eq(qcItemInstance.checklistId, checklist.id));
      const riskAnswers = await db.select().from(qcRiskAnswer).where(eq(qcRiskAnswer.checklistId, checklist.id));

      const itemIds = itemInstances.map(i => i.id);
      const evidence = itemIds.length ? await db.select().from(qcItemEvidence).where(inArray(qcItemEvidence.itemInstanceId, itemIds)) : [];

      const templateId = checklist.templateId;
      const phases = await db.select().from(qcTemplatePhase).where(eq(qcTemplatePhase.templateId, templateId));
      const phaseIds = phases.map(p => p.id);
      const groups = phaseIds.length ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.templatePhaseId, phaseIds)) : [];
      const groupIds = groups.map(g => g.id);
      const templateItems = groupIds.length ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.templateGroupId, groupIds)) : [];
      const riskQuestions = phaseIds.length ? await db.select().from(qcTemplateRiskQuestion).where(inArray(qcTemplateRiskQuestion.templatePhaseId, phaseIds)) : [];

      res.json({
        checklist,
        phases,
        groups,
        templateItems,
        itemInstances,
        riskQuestions,
        riskAnswers,
        evidence,
      });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== CHECKLIST ITEM OPERATIONS ==========

  app.post("/api/quality/project/:projectName/item/:itemInstanceId", requireAuth, requireAdminOrQm, requirePermission('pd_quality', 'edit'), async (req, res) => {
    try {
      const itemId = parseInt(req.params.itemInstanceId);
      const { startDate, endDate, isApplicable, notApplicableReason, approvalComment, allowedWorkingDays, qmStatus } = req.body;

      const ALLOWED_QM_STATUSES = ["pending", "pass", "fail", "review", "na"];
      if (qmStatus !== undefined && !ALLOWED_QM_STATUSES.includes(qmStatus)) {
        return res.status(400).json({ error: "invalid_input", message: `qmStatus must be one of: ${ALLOWED_QM_STATUSES.join(', ')}` });
      }

      if (allowedWorkingDays !== undefined && (typeof allowedWorkingDays !== 'number' || allowedWorkingDays < 0)) {
        return res.status(400).json({ error: "invalid_input", message: "allowedWorkingDays must be a non-negative number" });
      }

      if (qmStatus === "pass") {
        const [existing] = await db.select().from(qcItemInstance).where(eq(qcItemInstance.id, itemId));
        if (existing && (existing.qmStatus === "review" || existing.qmStatus === "fail")) {
          const role = getUserRole(req);
          const isQmManager = isAdminRole(role) || role === "quality_manager" || role === "QUALITY_MANAGER";
          if (!isQmManager) {
            return res.status(403).json({ error: "forbidden", message: "Only QM Manager can move items from Review or Failed back to Pass" });
          }
        }
      }

      const updates: any = { lastUpdatedAt: new Date() };
      if (startDate !== undefined) updates.startDate = startDate;
      if (endDate !== undefined) updates.endDate = endDate;
      if (allowedWorkingDays !== undefined) updates.allowedWorkingDays = allowedWorkingDays;
      if (isApplicable !== undefined) {
        updates.isApplicable = isApplicable;
      }
      if (notApplicableReason !== undefined) updates.notApplicableReason = notApplicableReason;
      if (approvalComment !== undefined) updates.approvalComment = approvalComment;

      if (qmStatus !== undefined) {
        updates.qmStatus = qmStatus;
        if (qmStatus === "pass") {
          updates.approved = true;
          updates.isApplicable = true;
          updates.approvedByUserId = getUser(req).id;
          updates.approvedAt = new Date();
        } else if (qmStatus === "na") {
          updates.isApplicable = false;
          updates.approved = false;
          updates.approvedByUserId = null;
          updates.approvedAt = null;
        } else {
          updates.isApplicable = true;
          updates.approved = false;
          updates.approvedByUserId = null;
          updates.approvedAt = null;
        }
      }

      if (startDate && endDate) {
        const holidays = await db.select().from(calendarHoliday);
        updates.workingDays = businessDaysBetween(startDate, endDate, holidays.map(h => h.date));
      }

      const [updated] = await db.update(qcItemInstance).set(updates).where(eq(qcItemInstance.id, itemId)).returning();
      const pName = decodeURIComponent(req.params.projectName);
      recalculateWarnings(pName).catch(() => {});

      sendExcelSyncNotification({
        projectName: pName,
        changedByUserId: getUser(req).id,
        changeType: "quality_update",
        changeDescription: "Quality checklist item was updated.",
        details: { itemInstanceId: itemId, qmStatus: qmStatus || undefined },
      }).catch(() => {});

      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(itemId), action: "update", projectName: pName, changesJson: { description: "Quality checklist item updated", qmStatus } });
      res.json(updated);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/quality/project/:projectName/item/:itemInstanceId/approve", requireAuth, requireAdminOrQm, requirePermission('quality', 'approve'), async (req, res) => {
    try {
      const itemId = parseInt(req.params.itemInstanceId);
      const { approved, comment } = req.body;

      if (approved) {
        const [existing] = await db.select().from(qcItemInstance).where(eq(qcItemInstance.id, itemId));
        if (existing && (existing.qmStatus === "review" || existing.qmStatus === "fail")) {
          const role = getUserRole(req);
          const isQmManager = isAdminRole(role) || role === "quality_manager" || role === "QUALITY_MANAGER";
          if (!isQmManager) {
            return res.status(403).json({ error: "forbidden", message: "Only QM Manager can approve items in Review or Failed status" });
          }
        }
      }

      const updates: any = {
        approved: !!approved,
        lastUpdatedAt: new Date(),
      };
      if (approved) {
        updates.approvedByUserId = getUser(req).id;
        updates.approvedAt = new Date();
        updates.qmStatus = "pass";
        if (comment) updates.approvalComment = comment;
      } else {
        updates.approvedByUserId = null;
        updates.approvedAt = null;
      }

      const [updated] = await db.update(qcItemInstance).set(updates).where(eq(qcItemInstance.id, itemId)).returning();
      const pName = decodeURIComponent(req.params.projectName);
      recalculateWarnings(pName).catch(() => {});
      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(itemId), action: approved ? "approve" : "update", projectName: pName, changesJson: { description: approved ? "Quality item approved" : "Quality item approval revoked" } });
      res.json(updated);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/quality/project/:projectName/item/:itemInstanceId/evidence", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      const itemId = parseInt(req.params.itemInstanceId);
      const { evidenceUrl, evidenceNote } = req.body;
      if (!evidenceUrl) return res.status(400).json({ error: "evidenceUrl required" });

      const [evidence] = await db.insert(qcItemEvidence).values({
        itemInstanceId: itemId, evidenceUrl, evidenceNote,
      }).returning();
      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(itemId), action: "update", projectName: decodeURIComponent(req.params.projectName), changesJson: { description: "Evidence added", evidenceUrl } });
      res.json(evidence);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/quality/project/:projectName/item/:itemInstanceId/evidence/upload", requireAuth, requireAdminOrQm, qmApprovalUpload.single("file"), async (req, res) => {
    try {
      const itemId = parseInt(req.params.itemInstanceId);
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const note = req.body.note || "";

      const evidenceUrl = `/uploads/qm-approvals/${file.filename}`;
      const [evidence] = await db.insert(qcItemEvidence).values({
        itemInstanceId: itemId,
        evidenceUrl,
        evidenceNote: note || file.originalname,
      }).returning();
      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(itemId), action: "update", projectName: decodeURIComponent(req.params.projectName), changesJson: { description: "Evidence file uploaded", fileName: file.originalname } });
      res.json(evidence);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/quality/sp-browse", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      const { browseFolders, isSharePointConfigured } = await import("./sharepoint");
      if (!isSharePointConfigured()) {
        return res.status(400).json({ error: "SharePoint not configured" });
      }
      const { storage } = await import("./storage");
      const settings = await storage.getSpSettings();
      if (!settings?.driveId) return res.status(400).json({ error: "SharePoint drive not configured" });

      const folderId = req.query.folderId as string | undefined;
      const items = await browseFolders(settings.driveId, folderId || undefined);
      res.json({ driveId: settings.driveId, items });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/quality/sp-file-link", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      const { isSharePointConfigured } = await import("./sharepoint");
      if (!isSharePointConfigured()) return res.status(400).json({ error: "SharePoint not configured" });

      const { storage } = await import("./storage");
      const settings = await storage.getSpSettings();
      if (!settings?.driveId) return res.status(400).json({ error: "SharePoint drive not configured" });

      const itemId = req.query.itemId as string;
      if (!itemId) return res.status(400).json({ error: "itemId required" });

      const { getFileMetadata } = await import("./sharepoint");
      const meta = await getFileMetadata(settings.driveId, itemId);
      const webUrl = meta.webUrl || meta["@microsoft.graph.downloadUrl"] || "";
      res.json({ name: meta.name, webUrl, size: meta.size });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/quality/project/:projectName/item/:itemInstanceId/send-for-approval", requireAuth, qmApprovalUpload.single("file"), async (req, res) => {
    try {
      const itemId = parseInt(req.params.itemInstanceId);
      const projectName = decodeURIComponent(req.params.projectName);
      const approverUserId = parseInt(req.body.approverUserId);
      if (!approverUserId) return res.status(400).json({ error: "Approver is required" });

      const [existing] = await db.select().from(qcItemInstance).where(eq(qcItemInstance.id, itemId));
      if (!existing) return res.status(404).json({ error: "Quality item not found" });

      const note = req.body.note || "";
      const file = req.file;

      const [updated] = await db.update(qcItemInstance).set({
        qmStatus: "review",
        approvalComment: note.trim() || null,
      }).where(eq(qcItemInstance.id, itemId)).returning();

      if (file) {
        const evidenceUrl = `/uploads/qm-approvals/${file.filename}`;
        await db.insert(qcItemEvidence).values({
          itemInstanceId: itemId,
          evidenceUrl,
          evidenceNote: `Submitted for approval: ${file.originalname}`,
        });
      }

      await createQmNotification(approverUserId, "quality.submitted_for_approval",
        `QM Approval needed: ${projectName}`,
        `A quality item has been submitted for your approval${file ? ` with attachment: ${file.originalname}` : ""}`,
        { projectName }
      );

      recalculateWarnings(projectName).catch(() => {});

      sendExcelSyncNotification({
        projectName,
        changedByUserId: getUser(req).id,
        changeType: "quality_update",
        changeDescription: "Quality item submitted for approval.",
        details: { itemInstanceId: itemId, approverUserId },
      }).catch(() => {});

      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(itemId), action: "update", projectName, changesJson: { description: "Sent for approval", approverUserId } });
      res.json({
        ...updated,
        uploadedFile: file ? { filename: file.filename, originalName: file.originalname, size: file.size } : null,
      });
    } catch (err: any) {
      console.error("[QM] Send for approval error:", err);
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/quality/evidence/:evidenceId", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      await db.delete(qcItemEvidence).where(eq(qcItemEvidence.id, parseInt(req.params.evidenceId)));
      logAuditFromReq(req, { entityType: "quality_checklist", entityId: req.params.evidenceId, action: "delete", changesJson: { description: "Evidence deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== QC ITEM CREATE/DELETE ==========

  app.post("/api/quality/project/:projectName/items", requireAuth, requireAdminOrQm, requirePermission('pd_quality', 'edit'), async (req, res) => {
    try {
      const pName = decodeURIComponent(req.params.projectName);
      const { itemName, groupId } = req.body;
      if (!itemName) return res.status(400).json({ error: "itemName required" });

      const [checklist] = await db.select().from(qcChecklist).where(eq(qcChecklist.projectName, pName));
      if (!checklist) return res.status(404).json({ error: "No checklist found for this project" });

      let templateItemId: number;
      if (groupId) {
        const [templateItem] = await db.insert(qcTemplateItem).values({
          templateGroupId: groupId,
          itemName,
          sortOrder: 999,
          isEvidenceRequired: false,
          defaultSeverity: "Medium",
        }).returning();
        templateItemId = templateItem.id;
      } else {
        const [groups] = await db.select().from(qcTemplateGroup).limit(1);
        if (!groups) return res.status(400).json({ error: "No template groups exist" });
        const [templateItem] = await db.insert(qcTemplateItem).values({
          templateGroupId: groups.id,
          itemName,
          sortOrder: 999,
          isEvidenceRequired: false,
          defaultSeverity: "Medium",
        }).returning();
        templateItemId = templateItem.id;
      }

      const [item] = await db.insert(qcItemInstance).values({
        checklistId: checklist.id,
        templateItemId,
        isApplicable: true,
        qmStatus: "not_started",
      }).returning();

      sendExcelSyncNotification({
        projectName: pName,
        changedByUserId: getUser(req).id,
        changeType: "quality_update",
        changeDescription: `Quality item created: ${itemName}.`,
        details: { itemInstanceId: item.id, itemName },
      }).catch(() => {});

      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(item.id), action: "create", projectName: pName, changesJson: { description: "Quality item created", itemName } });
      res.json(item);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/quality/project/:projectName/item/:itemInstanceId", requireAuth, requireAdminOrQm, requirePermission('pd_quality', 'delete'), async (req, res) => {
    try {
      const pName = decodeURIComponent(req.params.projectName);
      const itemId = parseInt(req.params.itemInstanceId);

      const [checklist] = await db.select().from(qcChecklist).where(eq(qcChecklist.projectName, pName));
      if (!checklist) return res.status(404).json({ error: "No checklist found for this project" });

      const [instance] = await db.select().from(qcItemInstance).where(
        and(eq(qcItemInstance.id, itemId), eq(qcItemInstance.checklistId, checklist.id))
      );
      if (!instance) return res.status(404).json({ error: "Item not found in this project's checklist" });

      await db.transaction(async (tx) => {
        await tx.delete(qcItemEvidence).where(eq(qcItemEvidence.itemInstanceId, itemId));
        await tx.delete(qcPlanLink).where(eq(qcPlanLink.itemInstanceId, itemId));
        await tx.delete(qcItemInstance).where(eq(qcItemInstance.id, itemId));
      });

      recalculateWarnings(pName).catch(() => {});

      sendExcelSyncNotification({
        projectName: pName,
        changedByUserId: getUser(req).id,
        changeType: "quality_update",
        changeDescription: "Quality item deleted.",
        details: { itemInstanceId: itemId },
      }).catch(() => {});

      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(itemId), action: "delete", projectName: pName, changesJson: { description: "Quality item deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== RISK ANSWERS ==========

  app.post("/api/quality/project/:projectName/risk-answer", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      const { riskAnswerId, answerYesno, answerText, answerNumber } = req.body;
      const updates: any = { lastUpdatedBy: getUser(req).id, lastUpdatedAt: new Date() };
      if (answerYesno !== undefined) updates.answerYesno = answerYesno;
      if (answerText !== undefined) updates.answerText = answerText;
      if (answerNumber !== undefined) updates.answerNumber = answerNumber;

      const [updated] = await db.update(qcRiskAnswer).set(updates).where(eq(qcRiskAnswer.id, riskAnswerId)).returning();
      const pName = decodeURIComponent(req.params.projectName);
      recalculateWarnings(pName).catch(() => {});

      sendExcelSyncNotification({
        projectName: pName,
        changedByUserId: getUser(req).id,
        changeType: "quality_update",
        changeDescription: "QC risk answer updated.",
        details: { riskAnswerId, answerYesno, answerText },
      }).catch(() => {});

      logAuditFromReq(req, { entityType: "qc_risk_answer", entityId: String(riskAnswerId), action: "update", projectName: pName, changesJson: { description: "Risk answer updated", answerYesno, answerText } });
      res.json(updated);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== WARNINGS ==========

  app.get("/api/quality/project/:projectName/warnings", requireAuth, async (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);
      const warnings = await db.select().from(qcWarning)
        .where(eq(qcWarning.projectName, projectName))
        .orderBy(desc(qcWarning.createdAt));
      res.json(warnings);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/quality/warnings", requireAuth, async (req, res) => {
    try {
      const statusFilter = req.query.status as string;
      let storedWarnings: any[];
      if (statusFilter) {
        storedWarnings = await db.select().from(qcWarning)
          .where(eq(qcWarning.status, statusFilter))
          .orderBy(desc(qcWarning.createdAt));
      } else {
        storedWarnings = await db.select().from(qcWarning).orderBy(desc(qcWarning.createdAt));
      }

      const warnings = storedWarnings.filter((w: any) => w.warningType !== "task_complete_unapproved");

      const allPlanLinks = await db.select().from(qcPlanLink);
      if (allPlanLinks.length) {
        const allItems = await db.select().from(qcItemInstance);
        const projectsWithLinks = [...new Set(allPlanLinks.map((l: any) => l.projectName))];
        const allWiTasks = await getAllPMWorkItemsAsProjectPlan();
        const allPlanTasks = allWiTasks.filter((t: any) => projectsWithLinks.includes(t.projectName));
        const templateItemIds = [...new Set(allItems.map((i: any) => i.templateItemId))];
        const templateItems = templateItemIds.length
          ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, templateItemIds))
          : [];

        for (const link of allPlanLinks) {
          if (!link.itemInstanceId) continue;
          const item = allItems.find((i: any) => i.id === link.itemInstanceId);
          if (!item || !item.isApplicable || item.approved) continue;
          const task = allPlanTasks.find((t: any) => t.id === link.planItemId);
          if (task && (task.actualPctComplete ?? 0) >= 1) {
            const tmpl = templateItems.find((t: any) => t.id === item.templateItemId);
            warnings.push({
              id: -(link.id),
              projectName: link.projectName,
              severity: "High",
              warningType: "task_complete_unapproved",
              title: `Task done — QC not checked: ${tmpl?.itemName || 'Unknown item'}`,
              description: `Task "${task.taskNo || task.highLevelProgramme}" is 100% complete but linked quality item "${tmpl?.itemName}" has not been approved`,
              relatedPlanItemId: task.id,
              relatedItemInstanceId: item.id,
              status: "open",
              createdAt: new Date().toISOString(),
            });
          }
        }
      }

      res.json(warnings);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/quality/warning/:warningId/acknowledge", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      const warningId = parseInt(req.params.warningId);
      const { note } = req.body;
      await db.update(qcWarning).set({ status: "in_progress", updatedAt: new Date() }).where(eq(qcWarning.id, warningId));
      await db.insert(qcWarningEvent).values({
        warningId, eventType: "acknowledged", note, actorUserId: getUser(req).id,
      });

      const [warning] = await db.select().from(qcWarning).where(eq(qcWarning.id, warningId));
      if (warning) {
        sendExcelSyncNotification({
          projectName: warning.projectName,
          changedByUserId: getUser(req).id,
          changeType: "quality_update",
          changeDescription: `QC warning acknowledged: ${warning.title}`,
          details: { warningId, warningType: warning.warningType, note },
        }).catch(() => {});
      }

      logAuditFromReq(req, { entityType: "qc_warning", entityId: String(warningId), action: "update", projectName: warning?.projectName, changesJson: { description: "QC warning acknowledged", warningType: warning?.warningType } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/quality/warning/:warningId/resolve", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      const warningId = parseInt(req.params.warningId);
      const { note } = req.body;
      await db.update(qcWarning).set({ status: "resolved", updatedAt: new Date() }).where(eq(qcWarning.id, warningId));
      await db.insert(qcWarningEvent).values({
        warningId, eventType: "resolved", note, actorUserId: getUser(req).id,
      });

      const [resolvedWarning] = await db.select().from(qcWarning).where(eq(qcWarning.id, warningId));
      if (resolvedWarning) {
        sendExcelSyncNotification({
          projectName: resolvedWarning.projectName,
          changedByUserId: getUser(req).id,
          changeType: "quality_update",
          changeDescription: `QC warning resolved: ${resolvedWarning.title}`,
          details: { warningId, warningType: resolvedWarning.warningType, note },
        }).catch(() => {});
      }

      logAuditFromReq(req, { entityType: "qc_warning", entityId: String(warningId), action: "update", changesJson: { description: "QC warning resolved" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== PLAN LINKS ==========

  app.get("/api/quality/project/:projectName/plan-links", requireAuth, async (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);
      const links = await db.select().from(qcPlanLink).where(eq(qcPlanLink.projectName, projectName));
      res.json(links);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/quality/project/:projectName/plan-link", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);
      const { planItemId, itemInstanceId, phaseId, linkType } = req.body;
      if (!planItemId) return res.status(400).json({ error: "planItemId is required" });
      if (!itemInstanceId && !phaseId) return res.status(400).json({ error: "Either phaseId or itemInstanceId is required" });
      const [link] = await db.insert(qcPlanLink).values({
        projectName, planItemId, itemInstanceId: itemInstanceId || null, phaseId: phaseId || null, linkType: linkType || "phase_task",
      }).returning();
      recalculateWarnings(projectName).catch(() => {});
      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(link.id), action: "create", projectName, changesJson: { description: "Plan link created", planItemId } });
      res.json(link);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/quality/plan-link/:linkId", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      const [deletedLink] = await db.select().from(qcPlanLink).where(eq(qcPlanLink.id, parseInt(req.params.linkId)));
      await db.delete(qcPlanLink).where(eq(qcPlanLink.id, parseInt(req.params.linkId)));
      if (deletedLink) recalculateWarnings(deletedLink.projectName).catch(() => {});
      logAuditFromReq(req, { entityType: "quality_checklist", entityId: req.params.linkId, action: "delete", projectName: deletedLink?.projectName, changesJson: { description: "Plan link deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== QUALITY SUMMARY (for dashboard) ==========

  app.get("/api/quality/project/:projectName/summary", requireAuth, async (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);
      const [checklist] = await db.select().from(qcChecklist).where(eq(qcChecklist.projectName, projectName));
      if (!checklist) return res.json({ hasChecklist: false, phases: [] });

      const itemInstances = await db.select().from(qcItemInstance).where(eq(qcItemInstance.checklistId, checklist.id));
      const templateItems = itemInstances.length
        ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, itemInstances.map(i => i.templateItemId)))
        : [];
      const groups = templateItems.length
        ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.id, templateItems.map(t => t.templateGroupId)))
        : [];
      const phases = await db.select().from(qcTemplatePhase).where(eq(qcTemplatePhase.templateId, checklist.templateId));

      const warnings = await db.select().from(qcWarning)
        .where(and(eq(qcWarning.projectName, projectName), sql`${qcWarning.status} != 'resolved'`));

      const phaseSummaries = phases.map(phase => {
        const phaseGroups = groups.filter(g => g.templatePhaseId === phase.id);
        const phaseGroupIds = phaseGroups.map(g => g.id);
        const phaseTemplateItems = templateItems.filter(ti => phaseGroupIds.includes(ti.templateGroupId));
        const phaseItemIds = phaseTemplateItems.map(ti => ti.id);
        const phaseInstances = itemInstances.filter(ii => phaseItemIds.includes(ii.templateItemId));

        const applicable = phaseInstances.filter(i => i.isApplicable);
        const approved = applicable.filter(i => i.approved);

        return {
          phaseId: phase.id,
          phaseKey: phase.phaseKey,
          phaseName: phase.phaseName,
          totalItems: phaseInstances.length,
          applicableItems: applicable.length,
          approvedItems: approved.length,
          progressPercent: applicable.length > 0 ? Math.round((approved.length / applicable.length) * 100) : 0,
        };
      });

      res.json({
        hasChecklist: true,
        checklistId: checklist.id,
        status: checklist.status,
        phases: phaseSummaries,
        totalWarnings: warnings.length,
        highWarnings: warnings.filter(w => w.severity === "High").length,
        openWarnings: warnings.filter(w => w.status === "open").length,
      });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== CHECKLISTS LIST ==========

  app.get("/api/quality/checklists", requireAuth, async (req, res) => {
    try {
      const allChecklists = await db.select().from(qcChecklist);

      const allWarnings = await db.select().from(qcWarning).where(sql`${qcWarning.status} != 'resolved'`);
      const warningsByProject: Record<string, number> = {};
      for (const w of allWarnings) {
        if (w.warningType === "task_complete_unapproved") continue;
        warningsByProject[w.projectName] = (warningsByProject[w.projectName] || 0) + 1;
      }

      const allPlanLinks = await db.select().from(qcPlanLink);
      const allItems = await db.select().from(qcItemInstance);

      const projectsWithLinks = [...new Set(allPlanLinks.map((l: any) => l.projectName))];
      const allWiTasksQ = await getAllPMWorkItemsAsProjectPlan();
      const allPlanTasks = projectsWithLinks.length
        ? allWiTasksQ.filter((t: any) => projectsWithLinks.includes(t.projectName))
        : [];

      for (const link of allPlanLinks) {
        if (!link.itemInstanceId) continue;
        const item = allItems.find((i: any) => i.id === link.itemInstanceId);
        if (!item || !item.isApplicable || item.approved) continue;
        const task = allPlanTasks.find((t: any) => t.id === link.planItemId);
        if (task && (task.actualPctComplete ?? 0) >= 1) {
          warningsByProject[link.projectName] = (warningsByProject[link.projectName] || 0) + 1;
        }
      }

      const templateItemIds = [...new Set(allItems.map((i: any) => i.templateItemId))];
      const templateItems = templateItemIds.length
        ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, templateItemIds))
        : [];
      const groupIds = [...new Set(templateItems.map(t => t.templateGroupId))];
      const groups = groupIds.length
        ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.id, groupIds))
        : [];

      const result = await Promise.all(allChecklists.map(async (cl) => {
        const phases = await db.select().from(qcTemplatePhase).where(eq(qcTemplatePhase.templateId, cl.templateId));
        const clItems = allItems.filter(i => i.checklistId === cl.id);

        const phaseData = phases.map(phase => {
          const phaseGroups = groups.filter(g => g.templatePhaseId === phase.id);
          const phaseGroupIds = phaseGroups.map(g => g.id);
          const phaseTemplateItems = templateItems.filter(ti => phaseGroupIds.includes(ti.templateGroupId));
          const phaseItemIds = phaseTemplateItems.map(ti => ti.id);
          const phaseInstances = clItems.filter(ii => phaseItemIds.includes(ii.templateItemId));
          const applicable = phaseInstances.filter(i => i.isApplicable);
          const passed = applicable.filter(i => i.qmStatus === "pass" || (i.qmStatus === "not_started" && i.approved));
          const failed = applicable.filter(i => i.qmStatus === "fail");
          const inReview = applicable.filter(i => i.qmStatus === "review");

          return {
            phaseId: phase.id,
            phaseName: phase.phaseName,
            total: applicable.length,
            completed: passed.length,
            failed: failed.length,
            inReview: inReview.length,
          };
        });

        return {
          id: cl.id,
          projectName: cl.projectName,
          templateId: cl.templateId,
          status: cl.status,
          createdAt: cl.createdAt,
          updatedAt: cl.updatedAt,
          phases: phaseData,
          warningCount: warningsByProject[cl.projectName] || 0,
        };
      }));

      res.json(result);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== GLOBAL QUALITY DASHBOARD ==========

  app.get("/api/quality/dashboard", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      const allChecklists = await db.select().from(qcChecklist);
      const allWarnings = await db.select().from(qcWarning).where(sql`${qcWarning.status} != 'resolved'`);
      const allItems = await db.select().from(qcItemInstance);

      const pendingApprovals = allItems.filter(i => i.isApplicable && !i.approved);
      const projectWarningCounts: Record<string, { high: number; total: number; }> = {};
      for (const w of allWarnings) {
        if (!projectWarningCounts[w.projectName]) projectWarningCounts[w.projectName] = { high: 0, total: 0 };
        projectWarningCounts[w.projectName].total++;
        if (w.severity === "High") projectWarningCounts[w.projectName].high++;
      }

      const projectsAtRisk = Object.entries(projectWarningCounts)
        .filter(([, v]) => v.high > 0)
        .map(([projectName, v]) => ({ projectName, ...v }));

      const postmortems = await db.select().from(qcPostmortem);
      const checklistProjects = allChecklists.map(c => c.projectName);
      const postmortemProjects = postmortems.filter(p => p.completedAt).map(p => p.projectName);
      const outstandingPostmortems = checklistProjects.filter(p => !postmortemProjects.includes(p));

      res.json({
        totalChecklists: allChecklists.length,
        pendingApprovals: pendingApprovals.length,
        openWarnings: allWarnings.filter(w => w.status === "open").length,
        totalWarnings: allWarnings.length,
        projectsAtRisk,
        outstandingPostmortems,
      });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== WARNING ENGINE ==========

  app.post("/api/quality/project/:projectName/recalculate-warnings", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);
      const count = await recalculateWarnings(projectName);
      logAuditFromReq(req, { entityType: "qc_warning", entityId: "0", action: "create", projectName, changesJson: { description: "Warnings recalculated", warningsGenerated: count } });
      res.json({ success: true, warningsGenerated: count });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== POST-MORTEM ==========

  app.get("/api/quality/postmortem/:projectName", requireAuth, async (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);
      const [pm] = await db.select().from(qcPostmortem).where(eq(qcPostmortem.projectName, projectName));
      if (!pm) return res.json({ postmortem: null, metricValues: [], summary: null });

      const metricValues = await db.select().from(qcPostmortemMetricValue).where(eq(qcPostmortemMetricValue.postmortemId, pm.id));
      const [summary] = await db.select().from(qcPostmortemSummary).where(eq(qcPostmortemSummary.postmortemId, pm.id));
      const metrics = await db.select().from(qcTemplatePostmortemMetric);

      res.json({ postmortem: pm, metricValues, summary, metrics });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/quality/postmortem/:projectName", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);
      const { metricInputs } = req.body;

      let [pm] = await db.select().from(qcPostmortem).where(eq(qcPostmortem.projectName, projectName));
      if (!pm) {
        [pm] = await db.insert(qcPostmortem).values({ projectName }).returning();
      }

      await db.delete(qcPostmortemMetricValue).where(eq(qcPostmortemMetricValue.postmortemId, pm.id));
      await db.delete(qcPostmortemSummary).where(eq(qcPostmortemSummary.postmortemId, pm.id));

      const metrics = await db.select().from(qcTemplatePostmortemMetric);
      const values: any[] = [];

      for (const input of metricInputs) {
        const metric = metrics.find(m => m.id === input.templateMetricId);
        if (!metric) continue;

        let score: number | null = null;
        const rule = metric.scoringRuleJson as any;
        if (rule) {
          if (metric.inputType === "choice" && rule.choices && input.inputValueChoice) {
            score = rule.choices[input.inputValueChoice] ?? null;
          } else if (metric.inputType === "count" && rule.formula && input.inputValueNumber != null) {
            const val = input.inputValueNumber;
            const formula = rule.formula.replace(/count|days/g, String(val));
            try { score = Math.max(0, Math.min(1, eval(formula))); } catch { score = null; }
          }
        }

        values.push({
          postmortemId: pm.id,
          templateMetricId: input.templateMetricId,
          inputValueNumber: input.inputValueNumber ?? null,
          inputValueChoice: input.inputValueChoice ?? null,
          score,
        });
      }

      if (values.length) {
        await db.insert(qcPostmortemMetricValue).values(values);
      }

      const contractorMetrics = values.filter(v => {
        const m = metrics.find(mm => mm.id === v.templateMetricId);
        return m?.metricGroup === "contractor_quality" && v.score != null;
      });
      const engineeringMetrics = values.filter(v => {
        const m = metrics.find(mm => mm.id === v.templateMetricId);
        return m?.metricGroup === "engineering_quality" && v.score != null;
      });

      const contractorScore = contractorMetrics.length
        ? contractorMetrics.reduce((a, b) => a + (b.score || 0), 0) / contractorMetrics.length
        : null;
      const engineeringScore = engineeringMetrics.length
        ? engineeringMetrics.reduce((a, b) => a + (b.score || 0), 0) / engineeringMetrics.length
        : null;

      const redFlag = (contractorScore != null && contractorScore < 0.85) || (engineeringScore != null && engineeringScore < 0.85);

      await db.insert(qcPostmortemSummary).values({
        postmortemId: pm.id,
        contractorQualityScore: contractorScore,
        engineeringQualityScore: engineeringScore,
        redFlag,
      });

      await db.update(qcPostmortem).set({
        completedAt: new Date(),
        completedByUserId: getUser(req).id,
      }).where(eq(qcPostmortem.id, pm.id));

      logAuditFromReq(req, { entityType: "quality_template", entityId: String(pm.id), action: "create", projectName, changesJson: { description: "Post-mortem completed", contractorScore, engineeringScore, redFlag } });
      res.json({ success: true, contractorScore, engineeringScore, redFlag });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== HOLIDAYS ==========

  app.get("/api/quality/holidays", requireAuth, async (req, res) => {
    try {
      const holidays = await db.select().from(calendarHoliday);
      res.json(holidays);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/quality/holidays", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const { date, name, countryCode } = req.body;
      const [h] = await db.insert(calendarHoliday).values({ date, name, countryCode: countryCode || "ZA" }).returning();
      logAuditFromReq(req, { entityType: "quality_template", entityId: String(h.id), action: "create", changesJson: { description: "Holiday created", date, name } });
      res.json(h);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/quality/holidays/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      await db.delete(calendarHoliday).where(eq(calendarHoliday.id, parseInt(req.params.id)));
      logAuditFromReq(req, { entityType: "quality_template", entityId: req.params.id, action: "delete", changesJson: { description: "Holiday deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== PLAN WARNINGS FOR TASK VIEW ==========

  app.get("/api/quality/plan-warnings/:projectName", requireAuth, async (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);
      const warnings = await db.select().from(qcWarning)
        .where(and(
          eq(qcWarning.projectName, projectName),
          sql`${qcWarning.status} != 'resolved'`,
          sql`${qcWarning.relatedPlanItemId} IS NOT NULL`
        ));

      const byPlanItem: Record<number, typeof warnings> = {};
      for (const w of warnings) {
        if (w.relatedPlanItemId) {
          if (!byPlanItem[w.relatedPlanItemId]) byPlanItem[w.relatedPlanItemId] = [];
          byPlanItem[w.relatedPlanItemId].push(w);
        }
      }
      res.json(byPlanItem);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== QM USER MANAGEMENT ==========

  app.get("/api/quality/users", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const { users } = await import("@shared/schema");
      const allUsers = await db.select({ id: users.id, email: users.email, name: users.name, role: users.role }).from(users);
      res.json(allUsers);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/quality/users/:userId/role", requireAuth, async (req, res) => {
    try {
      const role = getUserRole(req);
      if (!isAdminRole(role)) {
        return res.status(403).json({ error: "Admin access required" });
      }
      const userId = parseInt(req.params.userId);
      const { role: newRole } = req.body;
      if (!newRole) return res.status(400).json({ error: "Role is required" });
      const { users } = await import("@shared/schema");
      const [updated] = await db.update(users).set({ role: newRole }).where(eq(users.id, userId)).returning();
      logAuditFromReq(req, { entityType: "quality_template", entityId: String(userId), action: "update", changesJson: { description: "User role updated", newRole, userName: updated.name } });
      res.json({ id: updated.id, email: updated.email, name: updated.name, role: updated.role });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/quality/admin/bulk-create-checklists", requireAuth, async (req, res) => {
    try {
      const role = getUserRole(req);
      if (!isAdminRole(role)) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const { projectNames } = req.body;
      if (!Array.isArray(projectNames) || projectNames.length === 0) {
        return res.status(400).json({ error: "projectNames array is required" });
      }

      const [activeTemplate] = await db.select().from(qcTemplate).where(eq(qcTemplate.isActive, true));
      if (!activeTemplate) {
        return res.status(400).json({ error: "No active quality template found" });
      }

      const phases = await db.select().from(qcTemplatePhase).where(eq(qcTemplatePhase.templateId, activeTemplate.id));
      const phaseIds = phases.map(p => p.id);
      const groups = phaseIds.length ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.templatePhaseId, phaseIds)) : [];
      const groupIds = groups.map(g => g.id);
      const templateItems = groupIds.length ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.templateGroupId, groupIds)) : [];
      const riskQuestions = phaseIds.length ? await db.select().from(qcTemplateRiskQuestion).where(inArray(qcTemplateRiskQuestion.templatePhaseId, phaseIds)) : [];

      const results: { project: string; status: string }[] = [];

      for (const projectName of projectNames) {
        const [existing] = await db.select().from(qcChecklist).where(eq(qcChecklist.projectName, projectName));
        if (existing) {
          results.push({ project: projectName, status: "already exists" });
          continue;
        }

        const [checklist] = await db.insert(qcChecklist).values({
          projectName, templateId: activeTemplate.id, status: "active",
        }).returning();

        if (templateItems.length) {
          await db.insert(qcItemInstance).values(
            templateItems.map(ti => ({ checklistId: checklist.id, templateItemId: ti.id }))
          );
        }

        if (riskQuestions.length) {
          await db.insert(qcRiskAnswer).values(
            riskQuestions.map(rq => ({ checklistId: checklist.id, templateRiskQuestionId: rq.id }))
          );
        }

        results.push({ project: projectName, status: "created" });
      }

      logAuditFromReq(req, { entityType: "quality_template", entityId: "0", action: "create", changesJson: { description: "Bulk checklists created", count: results.filter(r => r.status === "created").length } });
      res.json({ success: true, results });
    } catch (err: any) {
      console.error("[Quality] Bulk Create Checklists error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}

// ========== WARNING ENGINE (recalculate) ==========

export async function recalculateWarnings(projectName: string): Promise<number> {
  const [checklist] = await db.select().from(qcChecklist).where(eq(qcChecklist.projectName, projectName));
  if (!checklist) return 0;

  const items = await db.select().from(qcItemInstance).where(eq(qcItemInstance.checklistId, checklist.id));
  const templateItems = items.length
    ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, items.map(i => i.templateItemId)))
    : [];
  const riskAnswers = await db.select().from(qcRiskAnswer).where(eq(qcRiskAnswer.checklistId, checklist.id));
  const riskQuestions = riskAnswers.length
    ? await db.select().from(qcTemplateRiskQuestion).where(inArray(qcTemplateRiskQuestion.id, riskAnswers.map(r => r.templateRiskQuestionId)))
    : [];
  const planLinks = await db.select().from(qcPlanLink).where(eq(qcPlanLink.projectName, projectName));

  await db.delete(qcWarning).where(and(
    eq(qcWarning.projectName, projectName),
    sql`${qcWarning.status} = 'open'`
  ));

  const newWarnings: any[] = [];
  const today = new Date().toISOString().split('T')[0];

  for (const item of items) {
    if (!item.isApplicable) continue;
    const tmpl = templateItems.find(t => t.id === item.templateItemId);

    if (item.endDate && item.endDate < today && !item.approved) {
      newWarnings.push({
        projectName, severity: "High", warningType: "overdue",
        title: `Overdue: ${tmpl?.itemName || 'Unknown item'}`,
        description: `Item was due ${item.endDate} but has not been approved`,
        relatedItemInstanceId: item.id,
      });
    }

    if (item.startDate && item.endDate && item.endDate < item.startDate) {
      newWarnings.push({
        projectName, severity: "High", warningType: "invalid_dates",
        title: `Invalid dates: ${tmpl?.itemName || 'Unknown item'}`,
        description: `End date (${item.endDate}) is before start date (${item.startDate})`,
        relatedItemInstanceId: item.id,
      });
    }

    if (item.approved && tmpl?.isEvidenceRequired) {
      const evidence = await db.select().from(qcItemEvidence).where(eq(qcItemEvidence.itemInstanceId, item.id));
      if (!evidence.length) {
        newWarnings.push({
          projectName, severity: "High", warningType: "missing_evidence",
          title: `Missing evidence: ${tmpl.itemName}`,
          description: `Item is approved but required evidence has not been uploaded`,
          relatedItemInstanceId: item.id,
        });
      }
    }
  }

  for (const answer of riskAnswers) {
    const question = riskQuestions.find(q => q.id === answer.templateRiskQuestionId);
    if (!question || !question.triggersWarning) continue;

    let triggered = false;
    if (question.triggerCondition === "yes" && answer.answerYesno === true) triggered = true;
    if (question.triggerCondition === "no" && answer.answerYesno === false) triggered = true;

    if (triggered) {
      newWarnings.push({
        projectName, severity: question.triggerSeverity || "Medium", warningType: "risk_trigger",
        title: `Risk: ${question.questionText.substring(0, 80)}`,
        description: question.questionText,
      });
    }
  }

  if (planLinks.length) {
    const allWiTasksForProject = await getAllPMWorkItemsAsProjectPlan();
    const planTasks = allWiTasksForProject.filter((t: any) => t.projectName === projectName);

    for (const link of planLinks) {
      const task = planTasks.find(t => t.id === link.planItemId);
      if (!task) continue;

      const linkedItem = link.itemInstanceId ? items.find(i => i.id === link.itemInstanceId) : null;
      if (linkedItem && !linkedItem.approved && linkedItem.isApplicable) {
        const taskPct = task.actualPctComplete ?? 0;
        const tmpl = templateItems.find(t => t.id === linkedItem.templateItemId);

        if (taskPct >= 1) {
          newWarnings.push({
            projectName, severity: "High", warningType: "task_complete_unapproved",
            title: `Task done — QC not checked: ${tmpl?.itemName || 'Unknown item'}`,
            description: `Task "${task.taskNo || task.highLevelProgramme}" is 100% complete but linked quality item "${tmpl?.itemName}" has not been approved`,
            relatedPlanItemId: task.id,
            relatedItemInstanceId: linkedItem.id,
          });
        } else if (task.actualEnd) {
          const taskEndDate = new Date(task.actualEnd);
          const daysUntil = Math.floor((taskEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          if (daysUntil <= 7 && daysUntil >= 0) {
            newWarnings.push({
              projectName, severity: "High", warningType: "phase_incomplete",
              title: `Incomplete QC near milestone: ${task.taskNo || task.highLevelProgramme}`,
              description: `Linked checklist item "${tmpl?.itemName}" is not approved, but milestone is due in ${daysUntil} days`,
              relatedPlanItemId: task.id,
              relatedItemInstanceId: linkedItem.id,
            });
          }
        }
      }
    }
  }

  if (newWarnings.length) {
    await db.insert(qcWarning).values(newWarnings);
  }

  return newWarnings.length;
}
