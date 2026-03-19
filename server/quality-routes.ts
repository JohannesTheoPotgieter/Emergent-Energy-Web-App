import { Express, NextFunction, Request, Response } from "express";
import { db } from "./db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
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
  users, projectInfo,
} from "@shared/schema";
import { requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";
import { getAllPMWorkItemsAsProjectPlan } from "./work-items-adapter";
import { getEffectiveUser, jwtAuth, requireAuth } from "./auth-context";
import { getAssignmentsForEntity, setEntityAssignment } from "./services/assignment-service";
import {
  computeQualityRiskSummary,
  evaluateQualityGovernanceItem,
  getQualityHandoverReasons,
  isHandoverQualityBlocked,
  isQualityStatusRequired,
} from "@shared/quality-governance";
import { getProjectLinkedItems } from "./project-linking-service";
import { computePdPmSubmitBlockers, getProjectDevelopmentWorkspace } from "./services/project-development-workspace-service";

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
type ProjectInfoRow = typeof projectInfo.$inferSelect;
type QcChecklistRow = typeof qcChecklist.$inferSelect;
type QcItemInstanceRow = typeof qcItemInstance.$inferSelect;
type QcTemplateItemRow = typeof qcTemplateItem.$inferSelect;
type QcTemplateGroupRow = typeof qcTemplateGroup.$inferSelect;
type QcTemplatePhaseRow = typeof qcTemplatePhase.$inferSelect;
type QcItemEvidenceRow = typeof qcItemEvidence.$inferSelect;

function getUser(req: Request): AppUser {
  return getEffectiveUser(req) as AppUser;
}

function getUserRole(req: Request): string {
  return getEffectiveUser(req)?.role || "";
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


async function resolveProjectIdForItemInstance(itemInstanceId: number): Promise<number | null> {
  const rows = await db.execute(sql`
    SELECT c.project_id
    FROM qc_item_instance i
    JOIN qc_checklist c ON c.id = i.checklist_id
    WHERE i.id = ${itemInstanceId}
    LIMIT 1
  `);
  const value = rows.rows?.[0]?.project_id;
  return typeof value === "number" ? value : null;
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

function uniqueNumberList(values: Array<number | null | undefined>): number[] {
  const result = new Set<number>();
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      result.add(value);
    }
  }
  return Array.from(result);
}

function normalizeHandoverRow(row: any) {
  if (!row) return null;
  const deliverables =
    typeof row.deliverables === "string"
      ? (() => {
          try {
            return JSON.parse(row.deliverables);
          } catch {
            return {};
          }
        })()
      : (row.deliverables || {});

  return {
    ...row,
    deliverables,
  };
}

async function loadProjectQualityGovernanceContext(projectName: string, userId: number) {
  const projectRows: ProjectInfoRow[] = await db.select().from(projectInfo).where(eq(projectInfo.projectName, projectName));
  const [project] = projectRows;
  const checklistRows: QcChecklistRow[] = await db.select().from(qcChecklist).where(eq(qcChecklist.projectName, projectName));
  const [checklist] = checklistRows;
  const warnings = await db.select().from(qcWarning)
    .where(and(eq(qcWarning.projectName, projectName), sql`${qcWarning.status} != 'resolved'`))
    .orderBy(desc(qcWarning.createdAt));

  if (!project || !checklist) {
    return {
      project: project || null,
      checklist: checklist || null,
      warnings,
      phaseSummaries: [] as any[],
      governanceItems: [] as any[],
      riskSummary: computeQualityRiskSummary({ items: [], warnings }),
      handover: {
        status: "DRAFT",
        rejectionReason: null,
        qualityStatus: null,
        qualityRequired: false,
        readinessStatus: null,
        executionEnabled: project?.executionEnabled ?? false,
        executionGateStatus: project?.executionGateStatus ?? "NOT_ELIGIBLE",
        blockers: [] as string[],
        blocked: false,
      },
      relevantMicrosoftItems: [] as any[],
      focusItems: [] as any[],
    };
  }

  const itemInstances: QcItemInstanceRow[] = await db.select().from(qcItemInstance).where(eq(qcItemInstance.checklistId, checklist.id));

  const templateItemIds = uniqueNumberList(itemInstances.map((item) => item.templateItemId));
  const templateItems: QcTemplateItemRow[] = templateItemIds.length > 0
    ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, templateItemIds))
    : [];
  const templateItemMap = new Map<number, QcTemplateItemRow>(templateItems.map((item) => [item.id, item]));

  const groupIds = uniqueNumberList(templateItems.map((item) => item.templateGroupId));
  const groups: QcTemplateGroupRow[] = groupIds.length > 0
    ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.id, groupIds))
    : [];
  const groupMap = new Map<number, QcTemplateGroupRow>(groups.map((group) => [group.id, group]));

  const phaseIds = uniqueNumberList(groups.map((group) => group.templatePhaseId));
  const phases: QcTemplatePhaseRow[] = phaseIds.length > 0
    ? await db.select().from(qcTemplatePhase).where(inArray(qcTemplatePhase.id, phaseIds))
    : [];
  const phaseMap = new Map<number, QcTemplatePhaseRow>(phases.map((phase) => [phase.id, phase]));

  const evidence: QcItemEvidenceRow[] = itemInstances.length > 0
    ? await db.select().from(qcItemEvidence).where(inArray(qcItemEvidence.itemInstanceId, itemInstances.map((item) => item.id)))
    : [];
  const evidenceCountMap = new Map<number, number>();
  for (const item of evidence) {
    evidenceCountMap.set(item.itemInstanceId, (evidenceCountMap.get(item.itemInstanceId) || 0) + 1);
  }

  const assigneeUserIds = [...new Set(
    itemInstances
      .map((item) => item.assigneeUserId)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
  )];
  const assigneeRows = assigneeUserIds.length > 0
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, assigneeUserIds))
    : [];
  const assigneeMap = new Map(assigneeRows.map((row) => [row.id, row.name]));

  const governanceItems = itemInstances.map((instance) => {
    const templateItem = templateItemMap.get(instance.templateItemId);
    const group = templateItem ? groupMap.get(templateItem.templateGroupId) : null;
    const phase = group ? phaseMap.get(group.templatePhaseId) : null;
    const evidenceCount = evidenceCountMap.get(instance.id) || 0;
    const evaluation = evaluateQualityGovernanceItem({
      qmStatus: instance.qmStatus,
      approved: instance.approved,
      isApplicable: instance.isApplicable,
      endDate: instance.endDate,
      scheduledDate: instance.scheduledDate,
      approvalComment: instance.approvalComment,
      isEvidenceRequired: templateItem?.isEvidenceRequired ?? false,
      evidenceCount,
    });

    return {
      ...instance,
      itemName: templateItem?.itemName || "Unknown",
      isEvidenceRequired: templateItem?.isEvidenceRequired ?? false,
      defaultSeverity: templateItem?.defaultSeverity || "Medium",
      groupId: group?.id || null,
      groupName: group?.groupName || "Unknown",
      phaseId: phase?.id || null,
      phaseName: phase?.phaseName || "Unknown",
      evidenceCount,
      assigneeName: instance.assigneeUserId ? (assigneeMap.get(instance.assigneeUserId) || null) : null,
      ...evaluation,
    };
  });

  const phaseSummaries = phases.map((phase) => {
    const phaseItems = governanceItems.filter((item) => item.phaseId === phase.id);
    const applicableItems = phaseItems.filter((item) => item.isApplicable !== false);
    const approvedItems = applicableItems.filter((item) => item.approved).length;
    return {
      phaseId: phase.id,
      phaseKey: phase.phaseKey,
      phaseName: phase.phaseName,
      totalItems: phaseItems.length,
      applicableItems: applicableItems.length,
      approvedItems,
      progressPercent: applicableItems.length > 0 ? Math.round((approvedItems / applicableItems.length) * 100) : 0,
    };
  });

  const handoverRows: any[] = await db.execute(sql.raw(
    `SELECT * FROM project_pd_pm_handover WHERE project_id = ${project.id} LIMIT 1`,
  )).then((result: any) => (Array.isArray(result) ? result : result.rows || []));
  const handover = normalizeHandoverRow(handoverRows[0]) || { deliverables: {} };

  const workspace = await getProjectDevelopmentWorkspace({
    projectId: project.id,
    projectName: project.projectName,
    canonicalProjectId: project.canonicalProjectId,
    clientId: project.clientId,
    phase: project.phase,
    executionGateStatus: project.executionGateStatus,
    executionEnabled: project.executionEnabled,
    handover,
  });

  const handoverBlockers = computePdPmSubmitBlockers({
    project,
    handover,
    workspace,
  });

  const handoverSummaryInput = {
    blockers: handoverBlockers,
    engineeringStatus: handover.engineering_status,
    qualityRequired: workspace.downstream.quality.qualityRequired,
    qualityStatus: workspace.downstream.quality.qualityStatus || handover.quality_status || null,
    handoverStatus: handover.status || "DRAFT",
    rejectionReason: handover.rejection_reason || null,
    executionEnabled: project.executionEnabled,
    executionGateStatus: project.executionGateStatus,
  };

  const relevantMicrosoftItems = (await getProjectLinkedItems(project.id, userId))
    .filter((item: any) => Boolean(item?.qualityContext?.itemInstanceId));

  const riskSummary = computeQualityRiskSummary({
    items: governanceItems,
    warnings,
    handover: handoverSummaryInput,
    linkedMicrosoftCount: relevantMicrosoftItems.length,
  });

  const focusItems = [...governanceItems]
    .filter((item) =>
      item.overdue ||
      item.evidenceMissing ||
      item.resubmissionNeeded ||
      item.approvalState === "pending_review",
    )
    .sort((left, right) => {
      const leftRank =
        (left.resubmissionNeeded ? 400 : 0) +
        (left.overdue ? 300 : 0) +
        (left.evidenceMissing ? 200 : 0) +
        (left.approvalState === "pending_review" ? 100 : 0) +
        Number(left.daysOverdue || 0);
      const rightRank =
        (right.resubmissionNeeded ? 400 : 0) +
        (right.overdue ? 300 : 0) +
        (right.evidenceMissing ? 200 : 0) +
        (right.approvalState === "pending_review" ? 100 : 0) +
        Number(right.daysOverdue || 0);
      return rightRank - leftRank;
    })
    .slice(0, 8);

  return {
    project,
    checklist,
    warnings,
    phaseSummaries,
    governanceItems,
    riskSummary,
    handover: {
      status: handover.status || "DRAFT",
      rejectionReason: handover.rejection_reason || null,
      qualityStatus: handoverSummaryInput.qualityStatus,
      qualityRequired: handoverSummaryInput.qualityRequired,
      readinessStatus: workspace.readiness.readinessStatus || handover.handover_readiness_status || null,
      executionEnabled: project.executionEnabled,
      executionGateStatus: project.executionGateStatus,
      blockers: getQualityHandoverReasons(handoverSummaryInput),
      blocked: isHandoverQualityBlocked(handoverSummaryInput),
    },
    relevantMicrosoftItems,
    focusItems,
  };
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

  app.get("/api/quality/templates", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const templates = await db.select().from(qcTemplate);
      res.json(templates);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/quality/templates/:templateId", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const tid = parseInt(String(req.params.templateId), 10);
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

  app.get("/api/quality/project/:projectName/checklist", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
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
      const assignmentEntries = await Promise.all(
        itemIds.map(async (itemId) => [itemId, await getAssignmentsForEntity("quality_item", itemId, "ASSIGNEE")] as const),
      );
      const assignmentMap = new Map(assignmentEntries);

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
        itemInstances: itemInstances.map((item) => {
          const assignments = assignmentMap.get(item.id) || [];
          const primaryAssignment = assignments[0] || null;
          return {
            ...item,
            assignments,
            primaryAssignment,
            assigneeDisplayLabel: primaryAssignment?.displayLabel || null,
            assigneeDisplayType: primaryAssignment?.assigneeType || null,
          };
        }),
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
      const itemId = parseInt(String(req.params.itemInstanceId), 10);
      const {
        startDate,
        endDate,
        isApplicable,
        notApplicableReason,
        approvalComment,
        allowedWorkingDays,
        qmStatus,
        assigneeUserId,
        assigneeType,
        assigneeId,
      } = req.body;

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
      const requestedAssigneeType = assigneeType ?? (assigneeUserId !== undefined && assigneeUserId !== null ? "internal_user" : assigneeUserId === null ? null : undefined);
      const requestedAssigneeId = assigneeId ?? (assigneeUserId !== undefined && assigneeUserId !== null ? parseInt(String(assigneeUserId), 10) : null);

      if (requestedAssigneeType !== undefined || assigneeUserId === null) {
        await setEntityAssignment(req, {
          entityType: "quality_item",
          entityId: itemId,
          assignmentRole: "ASSIGNEE",
          assigneeType: requestedAssigneeType ?? null,
          assigneeId: requestedAssigneeId,
          mode: requestedAssigneeType ? "replace" : "clear",
        });
      }

      const assignments = await getAssignmentsForEntity("quality_item", itemId, "ASSIGNEE");
      const pName = decodeURIComponent(String(req.params.projectName));
      recalculateWarnings(pName).catch((err) => console.error("[Quality] Warning recalculation failed:", err?.message || err));


      logAuditFromReq(req, {
        entityType: "quality_checklist",
        entityId: String(itemId),
        action: "update",
        projectName: pName,
        changesJson: {
          description: "Quality checklist item updated",
          qmStatus,
          assigneeType: requestedAssigneeType ?? null,
          assigneeId: requestedAssigneeId,
        },
      });
      res.json({ ...updated, assignments, primaryAssignment: assignments[0] || null });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/quality/project/:projectName/item/:itemInstanceId/approve", requireAuth, requireAdminOrQm, requirePermission('quality', 'approve'), async (req, res) => {
    try {
      const itemId = parseInt(String(req.params.itemInstanceId), 10);
      const { approved, comment } = req.body;
      const [existing] = await db.select().from(qcItemInstance).where(eq(qcItemInstance.id, itemId));

      if (approved) {
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
        if (existing?.qmStatus === "review") {
          updates.qmStatus = "fail";
        }
        updates.approvalComment = comment?.trim() ? comment.trim() : null;
      }

      const [updated] = await db.update(qcItemInstance).set(updates).where(eq(qcItemInstance.id, itemId)).returning();
      const pName = decodeURIComponent(String(req.params.projectName));
      recalculateWarnings(pName).catch((err) => console.error("[Quality] Warning recalculation failed:", err?.message || err));
      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(itemId), action: approved ? "approve" : "update", projectName: pName, changesJson: { description: approved ? "Quality item approved" : "Quality item approval revoked" } });
      res.json(updated);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/quality/project/:projectName/item/:itemInstanceId/evidence", requireAuth, requirePermission("quality", "edit"), async (req, res) => {
    try {
      const itemId = parseInt(String(req.params.itemInstanceId), 10);
      const { evidenceUrl, evidenceNote } = req.body;
      if (!evidenceUrl) return res.status(400).json({ error: "evidenceUrl required" });

      const projectId = await resolveProjectIdForItemInstance(itemId);
      if (!projectId) return res.status(400).json({ error: "project_context_missing", message: "Cannot attach evidence without project linkage" });

      const [evidence] = await db.insert(qcItemEvidence).values({
        projectId,
        itemInstanceId: itemId, evidenceUrl, evidenceNote,
      }).returning();
      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(itemId), action: "update", projectName: decodeURIComponent(String(req.params.projectName)), changesJson: { description: "Evidence added", evidenceUrl } });
      res.json(evidence);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/quality/project/:projectName/item/:itemInstanceId/evidence/upload", requireAuth, requireAdminOrQm, qmApprovalUpload.single("file"), async (req, res) => {
    try {
      const itemId = parseInt(String(req.params.itemInstanceId), 10);
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const note = req.body.note || "";

      const evidenceUrl = `/uploads/qm-approvals/${file.filename}`;
      const projectId = await resolveProjectIdForItemInstance(itemId);
      if (!projectId) return res.status(400).json({ error: "project_context_missing", message: "Cannot attach evidence without project linkage" });

      const [evidence] = await db.insert(qcItemEvidence).values({
        projectId,
        itemInstanceId: itemId,
        evidenceUrl,
        evidenceNote: note || file.originalname,
      }).returning();
      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(itemId), action: "update", projectName: decodeURIComponent(String(req.params.projectName)), changesJson: { description: "Evidence file uploaded", fileName: file.originalname } });
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

  app.post("/api/quality/project/:projectName/item/:itemInstanceId/send-for-approval", requireAuth, requireAdminOrQm, qmApprovalUpload.single("file"), async (req, res) => {
    try {
      const itemId = parseInt(String(req.params.itemInstanceId), 10);
      const projectName = decodeURIComponent(String(req.params.projectName));
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
      const projectId = await resolveProjectIdForItemInstance(itemId);
      if (!projectId) return res.status(400).json({ error: "project_context_missing", message: "Cannot attach evidence without project linkage" });

        await db.insert(qcItemEvidence).values({
          projectId,
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

      recalculateWarnings(projectName).catch((err) => console.error("[Quality] Warning recalculation failed:", err?.message || err));


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

  app.delete("/api/quality/evidence/:evidenceId", requireAuth, requirePermission("quality", "delete"), async (req, res) => {
    try {
      await db.delete(qcItemEvidence).where(eq(qcItemEvidence.id, parseInt(String(req.params.evidenceId), 10)));
      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(req.params.evidenceId), action: "delete", changesJson: { description: "Evidence deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== QC ITEM CREATE/DELETE ==========

  app.post("/api/quality/project/:projectName/items", requireAuth, requireAdminOrQm, requirePermission('pd_quality', 'edit'), async (req, res) => {
    try {
      const pName = decodeURIComponent(String(req.params.projectName));
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


      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(item.id), action: "create", projectName: pName, changesJson: { description: "Quality item created", itemName } });
      res.json(item);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/quality/project/:projectName/item/:itemInstanceId", requireAuth, requireAdminOrQm, requirePermission('pd_quality', 'delete'), async (req, res) => {
    try {
      const pName = decodeURIComponent(String(req.params.projectName));
      const itemId = parseInt(String(req.params.itemInstanceId), 10);

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

      recalculateWarnings(pName).catch((err) => console.error("[Quality] Warning recalculation failed:", err?.message || err));


      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(itemId), action: "delete", projectName: pName, changesJson: { description: "Quality item deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== RISK ANSWERS ==========

  app.post("/api/quality/project/:projectName/risk-answer", requireAuth, requirePermission("quality", "edit"), async (req, res) => {
    try {
      const { riskAnswerId, answerYesno, answerText, answerNumber } = req.body;
      const updates: any = { lastUpdatedBy: getUser(req).id, lastUpdatedAt: new Date() };
      if (answerYesno !== undefined) updates.answerYesno = answerYesno;
      if (answerText !== undefined) updates.answerText = answerText;
      if (answerNumber !== undefined) updates.answerNumber = answerNumber;

      const [updated] = await db.update(qcRiskAnswer).set(updates).where(eq(qcRiskAnswer.id, riskAnswerId)).returning();
      const pName = decodeURIComponent(String(req.params.projectName));
      recalculateWarnings(pName).catch((err) => console.error("[Quality] Warning recalculation failed:", err?.message || err));


      logAuditFromReq(req, { entityType: "qc_risk_answer", entityId: String(riskAnswerId), action: "update", projectName: pName, changesJson: { description: "Risk answer updated", answerYesno, answerText } });
      res.json(updated);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== WARNINGS ==========

  app.get("/api/quality/project/:projectName/warnings", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
      const warnings = await db.select().from(qcWarning)
        .where(eq(qcWarning.projectName, projectName))
        .orderBy(desc(qcWarning.createdAt));
      res.json(warnings);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/quality/warnings", requireAuth, requirePermission("quality", "view"), async (req, res) => {
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
        const templateItemIds = uniqueNumberList(allItems.map((item: any) => item.templateItemId));
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

  app.post("/api/quality/warning/:warningId/acknowledge", requireAuth, requirePermission("quality", "edit"), async (req, res) => {
    try {
      const warningId = parseInt(String(req.params.warningId), 10);
      const { note } = req.body;
      await db.update(qcWarning).set({ status: "in_progress", updatedAt: new Date() }).where(eq(qcWarning.id, warningId));
      await db.insert(qcWarningEvent).values({
        warningId, eventType: "acknowledged", note, actorUserId: getUser(req).id,
      });

      const [warning] = await db.select().from(qcWarning).where(eq(qcWarning.id, warningId));
      if (warning) {
      }

      logAuditFromReq(req, { entityType: "qc_warning", entityId: String(warningId), action: "update", projectName: warning?.projectName, changesJson: { description: "QC warning acknowledged", warningType: warning?.warningType } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/quality/warning/:warningId/resolve", requireAuth, requirePermission("quality", "edit"), async (req, res) => {
    try {
      const warningId = parseInt(String(req.params.warningId), 10);
      const { note } = req.body;
      await db.update(qcWarning).set({ status: "resolved", updatedAt: new Date() }).where(eq(qcWarning.id, warningId));
      await db.insert(qcWarningEvent).values({
        warningId, eventType: "resolved", note, actorUserId: getUser(req).id,
      });

      const [resolvedWarning] = await db.select().from(qcWarning).where(eq(qcWarning.id, warningId));
      if (resolvedWarning) {
      }

      logAuditFromReq(req, { entityType: "qc_warning", entityId: String(warningId), action: "update", changesJson: { description: "QC warning resolved" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== PLAN LINKS ==========

  app.get("/api/quality/project/:projectName/plan-links", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
      const links = await db.select().from(qcPlanLink).where(eq(qcPlanLink.projectName, projectName));
      res.json(links);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/quality/project/:projectName/plan-link", requireAuth, requirePermission("quality", "edit"), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
      const { planItemId, itemInstanceId, phaseId, linkType } = req.body;
      if (!planItemId) return res.status(400).json({ error: "planItemId is required" });
      if (!itemInstanceId && !phaseId) return res.status(400).json({ error: "Either phaseId or itemInstanceId is required" });
      const [link] = await db.insert(qcPlanLink).values({
        projectName, planItemId, itemInstanceId: itemInstanceId || null, phaseId: phaseId || null, linkType: linkType || "phase_task",
      }).returning();
      recalculateWarnings(projectName).catch((err) => console.error("[Quality] Warning recalculation failed:", err?.message || err));
      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(link.id), action: "create", projectName, changesJson: { description: "Plan link created", planItemId } });
      res.json(link);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/quality/plan-link/:linkId", requireAuth, requirePermission("quality", "delete"), async (req, res) => {
    try {
      const [deletedLink] = await db.select().from(qcPlanLink).where(eq(qcPlanLink.id, parseInt(String(req.params.linkId), 10)));
      await db.delete(qcPlanLink).where(eq(qcPlanLink.id, parseInt(String(req.params.linkId), 10)));
      if (deletedLink) recalculateWarnings(deletedLink.projectName).catch((err) => console.error("[Quality] Warning recalculation failed:", err?.message || err));
      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(req.params.linkId), action: "delete", projectName: deletedLink?.projectName, changesJson: { description: "Plan link deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== QUALITY SUMMARY (for dashboard) ==========

  app.get("/api/quality/project/:projectName/summary", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.projectName, projectName));
      const [checklist] = await db.select().from(qcChecklist).where(eq(qcChecklist.projectName, projectName));
      if (!checklist) {
        return res.json({
          hasChecklist: false,
          phases: [],
          governance: {
            overdueCount: 0,
            resubmissionCount: 0,
            evidenceGapCount: 0,
            pendingReviewCount: 0,
            blockedHandover: false,
            riskLevel: "low",
            riskScore: 0,
            },
        });
      }

      const itemInstances = await db.select().from(qcItemInstance).where(eq(qcItemInstance.checklistId, checklist.id));
      const templateItemIds = uniqueNumberList(itemInstances.map((item) => item.templateItemId));
      const templateItems: QcTemplateItemRow[] = templateItemIds.length > 0
        ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, templateItemIds))
        : [];
      const templateItemMap = new Map<number, QcTemplateItemRow>(templateItems.map((item) => [item.id, item]));
      const groupIds = uniqueNumberList(templateItems.map((item) => item.templateGroupId));
      const groups: QcTemplateGroupRow[] = groupIds.length > 0
        ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.id, groupIds))
        : [];
      const groupMap = new Map<number, QcTemplateGroupRow>(groups.map((group) => [group.id, group]));
      const phases: QcTemplatePhaseRow[] = await db.select().from(qcTemplatePhase).where(eq(qcTemplatePhase.templateId, checklist.templateId));
      const evidenceRows: QcItemEvidenceRow[] = itemInstances.length > 0
        ? await db.select().from(qcItemEvidence).where(inArray(qcItemEvidence.itemInstanceId, itemInstances.map((item) => item.id)))
        : [];
      const evidenceCountMap = new Map<number, number>();
      for (const evidence of evidenceRows) {
        evidenceCountMap.set(evidence.itemInstanceId, (evidenceCountMap.get(evidence.itemInstanceId) || 0) + 1);
      }
      const warnings = await db.select().from(qcWarning)
        .where(and(eq(qcWarning.projectName, projectName), sql`${qcWarning.status} != 'resolved'`));

      const phaseSummaries = phases.map((phase) => {
        const phaseGroups = groups.filter((group) => group.templatePhaseId === phase.id);
        const phaseGroupIds = phaseGroups.map((group) => group.id);
        const phaseTemplateItems = templateItems.filter((item) => phaseGroupIds.includes(item.templateGroupId));
        const phaseItemIds = phaseTemplateItems.map((item) => item.id);
        const phaseInstances = itemInstances.filter((item) => phaseItemIds.includes(item.templateItemId));
        const applicable = phaseInstances.filter((item) => item.isApplicable);
        const approved = applicable.filter((item) => item.approved);

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

      const handoverRows: any[] = project
        ? await db.execute(sql.raw(
            `SELECT project_id, status, engineering_status, quality_status, rejection_reason FROM project_pd_pm_handover WHERE project_id = ${project.id} LIMIT 1`,
          )).then((result: any) => (Array.isArray(result) ? result : result.rows || []))
        : [];
      const handover = handoverRows[0];
      const riskSummary = computeQualityRiskSummary({
        items: itemInstances.map((item) => ({
          qmStatus: item.qmStatus,
          approved: item.approved,
          isApplicable: item.isApplicable,
          endDate: item.endDate,
          scheduledDate: item.scheduledDate,
          approvalComment: item.approvalComment,
          isEvidenceRequired: templateItemMap.get(item.templateItemId)?.isEvidenceRequired ?? false,
          evidenceCount: evidenceCountMap.get(item.id) || 0,
        })),
        warnings,
        handover: {
          engineeringStatus: handover?.engineering_status || null,
          qualityRequired: isQualityStatusRequired(handover?.engineering_status || null),
          qualityStatus: handover?.quality_status || null,
          handoverStatus: handover?.status || null,
          rejectionReason: handover?.rejection_reason || null,
          executionEnabled: project?.executionEnabled ?? false,
          executionGateStatus: project?.executionGateStatus ?? "NOT_ELIGIBLE",
        },
      });

      res.json({
        hasChecklist: true,
        checklistId: checklist.id,
        status: checklist.status,
        phases: phaseSummaries,
        totalWarnings: warnings.length,
        highWarnings: warnings.filter((warning: any) => warning.severity === "High").length,
        openWarnings: warnings.filter((warning: any) => warning.status === "open").length,
        governance: {
          overdueCount: riskSummary.exposures.overdueCount,
          resubmissionCount: riskSummary.exposures.resubmissionCount,
          evidenceGapCount: riskSummary.exposures.evidenceGapCount,
          pendingReviewCount: riskSummary.exposures.pendingReviewCount,
          blockedHandover: riskSummary.exposures.blockedHandover,
          riskLevel: riskSummary.level,
          riskScore: riskSummary.score,
          handoverBlockers: getQualityHandoverReasons({
            engineeringStatus: handover?.engineering_status || null,
            qualityRequired: isQualityStatusRequired(handover?.engineering_status || null),
            qualityStatus: handover?.quality_status || null,
            handoverStatus: handover?.status || null,
            rejectionReason: handover?.rejection_reason || null,
            executionEnabled: project?.executionEnabled ?? false,
            executionGateStatus: project?.executionGateStatus ?? "NOT_ELIGIBLE",
          }),
        },
      });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/quality/project/:projectName/workspace", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
      const userId = getUser(req).id;
      const context = await loadProjectQualityGovernanceContext(projectName, userId);

      res.json({
        projectId: context.project?.id || null,
        projectName,
        hasChecklist: !!context.checklist,
        checklistId: context.checklist?.id || null,
        counts: {
          overdue: context.riskSummary.exposures.overdueCount,
          resubmissionNeeded: context.riskSummary.exposures.resubmissionCount,
          evidenceRequired: context.riskSummary.exposures.evidenceGapCount,
          pendingReview: context.riskSummary.exposures.pendingReviewCount,
          openWarnings: context.riskSummary.exposures.openWarningCount,
          blockedHandover: context.riskSummary.exposures.blockedHandover,
          linkedMicrosoftItems: context.riskSummary.exposures.linkedMicrosoftCount,
        },
        risk: {
          level: context.riskSummary.level,
          score: context.riskSummary.score,
          summary: context.riskSummary.summary,
        },
        handover: context.handover,
        focusItems: context.focusItems.map((item: any) => ({
          id: item.id,
          itemName: item.itemName,
          phaseName: item.phaseName,
          groupName: item.groupName,
          qmStatus: item.qmStatus,
          approved: item.approved,
          approvalState: item.approvalState,
          resubmissionNeeded: item.resubmissionNeeded,
          overdue: item.overdue,
          daysOverdue: item.daysOverdue,
          evidenceRequired: item.isEvidenceRequired,
          evidenceMissing: item.evidenceMissing,
          evidenceCount: item.evidenceCount,
          endDate: item.endDate,
          assigneeName: item.assigneeName,
          approvalComment: item.approvalComment,
        })),
        relevantMicrosoftItems: context.relevantMicrosoftItems.map((item: any) => ({
          id: item.id,
          type: item.type,
          subjectOrTitle: item.subjectOrTitle,
          senderOrOrganizer: item.senderOrOrganizer,
          receivedOrStartDatetime: item.receivedOrStartDatetime,
          webLink: item.webLink,
          actionRequired: item.actionRequired,
          linkedTaskId: item.linkedTaskId,
          taskContext: item.taskContext,
          qualityContext: item.qualityContext,
        })),
      });
    } catch (err: any) {
      console.error("[Quality] workspace error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== ALL ITEMS (flat list for bottom-up view) ==========

  app.get("/api/quality/all-items", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const projectFilter = req.query.project as string | undefined;
      const phaseFilter = req.query.phase as string | undefined;
      const statusFilter = req.query.status as string | undefined;

      const allInstances = await db.select().from(qcItemInstance);
      const allChecklists = await db.select().from(qcChecklist);

      const checklistMap = new Map<number, QcChecklistRow>(allChecklists.map(cl => [cl.id, cl]));

      let filtered = allInstances;
      if (projectFilter) {
        const matchingChecklistIds = allChecklists
          .filter(cl => cl.projectName === projectFilter)
          .map(cl => cl.id);
        filtered = filtered.filter(i => matchingChecklistIds.includes(i.checklistId));
      }
      if (statusFilter) {
        filtered = filtered.filter(i => i.qmStatus === statusFilter);
      }

      if (filtered.length === 0) {
        return res.json([]);
      }

      const templateItemIds = uniqueNumberList(filtered.map(i => i.templateItemId));
      const templateItems: QcTemplateItemRow[] = templateItemIds.length
        ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, templateItemIds))
        : [];
      const templateItemMap = new Map<number, QcTemplateItemRow>(templateItems.map(ti => [ti.id, ti]));

      const groupIds = uniqueNumberList(templateItems.map(ti => ti.templateGroupId));
      const groups: QcTemplateGroupRow[] = groupIds.length
        ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.id, groupIds))
        : [];
      const groupMap = new Map<number, QcTemplateGroupRow>(groups.map(g => [g.id, g]));

      const phaseIds = uniqueNumberList(groups.map(g => g.templatePhaseId));
      const phases: QcTemplatePhaseRow[] = phaseIds.length
        ? await db.select().from(qcTemplatePhase).where(inArray(qcTemplatePhase.id, phaseIds))
        : [];
      const phaseMap = new Map<number, QcTemplatePhaseRow>(phases.map(p => [p.id, p]));

      const itemInstanceIds = filtered.map(i => i.id);
      const allEvidence: QcItemEvidenceRow[] = itemInstanceIds.length
        ? await db.select().from(qcItemEvidence).where(inArray(qcItemEvidence.itemInstanceId, itemInstanceIds))
        : [];
      const evidenceCountMap = new Map<number, number>();
      for (const ev of allEvidence) {
        evidenceCountMap.set(ev.itemInstanceId, (evidenceCountMap.get(ev.itemInstanceId) || 0) + 1);
      }

      const assigneeUserIds = uniqueNumberList(filtered.map(i => i.assigneeUserId));
      let userMap = new Map<number, string>();
      if (assigneeUserIds.length) {
        const assignees = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, assigneeUserIds));
        userMap = new Map(assignees.map(u => [u.id, u.name]));
      }

      let items = filtered.map(inst => {
        const checklist = checklistMap.get(inst.checklistId);
        const templateItem = templateItemMap.get(inst.templateItemId);
        const group = templateItem ? groupMap.get(templateItem.templateGroupId) : undefined;
        const phase = group ? phaseMap.get(group.templatePhaseId) : undefined;
        const evidenceCount = evidenceCountMap.get(inst.id) || 0;
        const evaluation = evaluateQualityGovernanceItem({
          qmStatus: inst.qmStatus,
          approved: inst.approved,
          isApplicable: inst.isApplicable,
          endDate: inst.endDate,
          scheduledDate: inst.scheduledDate,
          approvalComment: inst.approvalComment,
          isEvidenceRequired: templateItem?.isEvidenceRequired ?? false,
          evidenceCount,
        });

        return {
          id: inst.id,
          itemName: templateItem?.itemName || "Unknown",
          description: templateItem?.defaultSeverity || null,
          projectName: checklist?.projectName || "Unknown",
          phaseName: phase?.phaseName || "Unknown",
          groupName: group?.groupName || "Unknown",
          qmStatus: inst.qmStatus,
          assigneeName: inst.assigneeUserId ? (userMap.get(inst.assigneeUserId) || null) : null,
          startDate: inst.startDate,
          endDate: inst.endDate,
          evidenceCount,
          evidenceRequired: templateItem?.isEvidenceRequired ?? false,
          evidenceMissing: evaluation.evidenceMissing,
          overdue: evaluation.overdue,
          daysOverdue: evaluation.daysOverdue,
          approvalState: evaluation.approvalState,
          resubmissionNeeded: evaluation.resubmissionNeeded,
          approved: inst.approved,
          approvedAt: inst.approvedAt,
          approvalComment: inst.approvalComment,
        };
      });

      if (phaseFilter) {
        items = items.filter(i => i.phaseName === phaseFilter);
      }

      res.json(items);
    } catch (err: any) {
      console.error("[Quality] all-items error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== CHECKLISTS LIST ==========

  app.get("/api/quality/checklists", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const allChecklists = await db.select().from(qcChecklist);
      const projectIds = uniqueNumberList(allChecklists.map((checklist) => checklist.projectId));
      const allProjects: ProjectInfoRow[] = projectIds.length > 0
        ? await db.select().from(projectInfo).where(inArray(projectInfo.id, projectIds))
        : [];
      const projectMap = new Map<number, ProjectInfoRow>(allProjects.map((project) => [project.id, project]));

      const handoverRows: any[] = projectIds.length > 0
        ? await db.execute(sql.raw(
            `SELECT project_id, status, engineering_status, quality_status, rejection_reason FROM project_pd_pm_handover WHERE project_id IN (${projectIds.join(",")})`,
          )).then((result: any) => (Array.isArray(result) ? result : result.rows || []))
        : [];
      const handoverMap = new Map(handoverRows.map((row: any) => [Number(row.project_id), row]));

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

      const templateItemIds = uniqueNumberList(allItems.map((i: any) => i.templateItemId));
      const templateItems: QcTemplateItemRow[] = templateItemIds.length
        ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, templateItemIds))
        : [];
      const templateItemMap = new Map<number, QcTemplateItemRow>(templateItems.map((item) => [item.id, item]));
      const groupIds = uniqueNumberList(templateItems.map(t => t.templateGroupId));
      const groups: QcTemplateGroupRow[] = groupIds.length
        ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.id, groupIds))
        : [];
      const groupMap = new Map<number, QcTemplateGroupRow>(groups.map((group) => [group.id, group]));
      const evidenceRows: QcItemEvidenceRow[] = allItems.length > 0
        ? await db.select().from(qcItemEvidence).where(inArray(qcItemEvidence.itemInstanceId, allItems.map((item) => item.id)))
        : [];
      const evidenceCountMap = new Map<number, number>();
      for (const evidence of evidenceRows) {
        evidenceCountMap.set(evidence.itemInstanceId, (evidenceCountMap.get(evidence.itemInstanceId) || 0) + 1);
      }

      const result = await Promise.all(allChecklists.map(async (cl) => {
        const phases = await db.select().from(qcTemplatePhase).where(eq(qcTemplatePhase.templateId, cl.templateId));
        const clItems = allItems.filter(i => i.checklistId === cl.id);
        const project = projectMap.get(cl.projectId);
        const handover = handoverMap.get(cl.projectId);

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

        const governanceItems = clItems.map((item) => {
          const templateItem = templateItemMap.get(item.templateItemId);
          const group = templateItem ? groupMap.get(templateItem.templateGroupId) : null;
          const evidenceCount = evidenceCountMap.get(item.id) || 0;
          return {
            qmStatus: item.qmStatus,
            approved: item.approved,
            isApplicable: item.isApplicable,
            endDate: item.endDate,
            scheduledDate: item.scheduledDate,
            approvalComment: item.approvalComment,
            isEvidenceRequired: templateItem?.isEvidenceRequired ?? false,
            evidenceCount,
            groupName: group?.groupName || null,
          };
        });

        const storedProjectWarnings = allWarnings.filter((warning) => warning.projectName === cl.projectName);
        const syntheticWarningCount = Math.max(0, (warningsByProject[cl.projectName] || 0) - storedProjectWarnings.length);
        const warningInputs = [
          ...storedProjectWarnings,
          ...Array.from({ length: syntheticWarningCount }, () => ({ severity: "High", status: "open" })),
        ];
        const handoverInput = {
          engineeringStatus: handover?.engineering_status || null,
          qualityRequired: isQualityStatusRequired(handover?.engineering_status || null),
          qualityStatus: handover?.quality_status || null,
          handoverStatus: handover?.status || null,
          rejectionReason: handover?.rejection_reason || null,
          executionEnabled: project?.executionEnabled ?? false,
          executionGateStatus: project?.executionGateStatus ?? "NOT_ELIGIBLE",
        };
        const riskSummary = computeQualityRiskSummary({
          items: governanceItems,
          warnings: warningInputs,
          handover: handoverInput,
        });

        return {
          id: cl.id,
          projectId: cl.projectId,
          projectName: cl.projectName,
          templateId: cl.templateId,
          status: cl.status,
          createdAt: cl.createdAt,
          updatedAt: (cl as any).updatedAt,
          phases: phaseData,
          warningCount: warningsByProject[cl.projectName] || 0,
          overdueCount: riskSummary.exposures.overdueCount,
          resubmissionCount: riskSummary.exposures.resubmissionCount,
          evidenceGapCount: riskSummary.exposures.evidenceGapCount,
          pendingReviewCount: riskSummary.exposures.pendingReviewCount,
          blockedHandover: riskSummary.exposures.blockedHandover,
          qualityRiskScore: riskSummary.score,
          qualityRiskLevel: riskSummary.level,
        };
      }));

      res.json(result);
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== GLOBAL QUALITY DASHBOARD ==========

  app.get("/api/quality/dashboard", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const allChecklists = await db.select().from(qcChecklist);
      const allWarnings = await db.select().from(qcWarning).where(sql`${qcWarning.status} != 'resolved'`);
      const allItems = await db.select().from(qcItemInstance);
      const projectIds = uniqueNumberList(allChecklists.map((checklist) => checklist.projectId));
      const allProjects: ProjectInfoRow[] = projectIds.length > 0
        ? await db.select().from(projectInfo).where(inArray(projectInfo.id, projectIds))
        : [];
      const projectMap = new Map<number, ProjectInfoRow>(allProjects.map((project) => [project.id, project]));

      const handoverRows: any[] = projectIds.length > 0
        ? await db.execute(sql.raw(
            `SELECT project_id, status, engineering_status, quality_status, rejection_reason FROM project_pd_pm_handover WHERE project_id IN (${projectIds.join(",")})`,
          )).then((result: any) => (Array.isArray(result) ? result : result.rows || []))
        : [];
      const handoverMap = new Map(handoverRows.map((row: any) => [Number(row.project_id), row]));

      const templateItemIds = uniqueNumberList(allItems.map((item) => item.templateItemId));
      const templateItems: QcTemplateItemRow[] = templateItemIds.length > 0
        ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, templateItemIds))
        : [];
      const templateItemMap = new Map<number, QcTemplateItemRow>(templateItems.map((item) => [item.id, item]));

      const evidenceRows: QcItemEvidenceRow[] = allItems.length > 0
        ? await db.select().from(qcItemEvidence).where(inArray(qcItemEvidence.itemInstanceId, allItems.map((item) => item.id)))
        : [];
      const evidenceCountMap = new Map<number, number>();
      for (const evidence of evidenceRows) {
        evidenceCountMap.set(evidence.itemInstanceId, (evidenceCountMap.get(evidence.itemInstanceId) || 0) + 1);
      }

      const pendingApprovals = allItems.filter(i => i.isApplicable && !i.approved);
      const projectWarningCounts: Record<string, { high: number; total: number; }> = {};
      for (const w of allWarnings) {
        if (!projectWarningCounts[w.projectName]) projectWarningCounts[w.projectName] = { high: 0, total: 0 };
        projectWarningCounts[w.projectName].total++;
        if (w.severity === "High") projectWarningCounts[w.projectName].high++;
      }

      const projectSummaries = allChecklists.map((checklist) => {
        const projectItems = allItems.filter((item) => item.checklistId === checklist.id);
        const project = projectMap.get(checklist.projectId);
        const handover = handoverMap.get(checklist.projectId);
        const warningInputs = allWarnings.filter((warning) => warning.projectName === checklist.projectName);

        const riskSummary = computeQualityRiskSummary({
          items: projectItems.map((item) => ({
            qmStatus: item.qmStatus,
            approved: item.approved,
            isApplicable: item.isApplicable,
            endDate: item.endDate,
            scheduledDate: item.scheduledDate,
            approvalComment: item.approvalComment,
            isEvidenceRequired: templateItemMap.get(item.templateItemId)?.isEvidenceRequired ?? false,
            evidenceCount: evidenceCountMap.get(item.id) || 0,
          })),
          warnings: warningInputs,
          handover: {
            engineeringStatus: handover?.engineering_status || null,
            qualityRequired: isQualityStatusRequired(handover?.engineering_status || null),
            qualityStatus: handover?.quality_status || null,
            handoverStatus: handover?.status || null,
            rejectionReason: handover?.rejection_reason || null,
            executionEnabled: project?.executionEnabled ?? false,
            executionGateStatus: project?.executionGateStatus ?? "NOT_ELIGIBLE",
          },
        });

        return {
          projectName: checklist.projectName,
          warningCount: warningInputs.length,
          ...riskSummary,
        };
      });

      const projectsAtRisk = projectSummaries
        .filter((project) => project.level === "high" || project.level === "critical")
        .map((project) => ({
          projectName: project.projectName,
          high: project.exposures.highWarningCount,
          total: project.warningCount,
          riskLevel: project.level,
          riskScore: project.score,
          blockedHandover: project.exposures.blockedHandover,
          overdueCount: project.exposures.overdueCount,
          resubmissionCount: project.exposures.resubmissionCount,
          evidenceGapCount: project.exposures.evidenceGapCount,
        }))
        .sort((left, right) => right.riskScore - left.riskScore);

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
        overdueActions: projectSummaries.reduce((sum, project) => sum + project.exposures.overdueCount, 0),
        resubmissionNeeded: projectSummaries.reduce((sum, project) => sum + project.exposures.resubmissionCount, 0),
        evidenceRequired: projectSummaries.reduce((sum, project) => sum + project.exposures.evidenceGapCount, 0),
        blockedHandovers: projectSummaries.filter((project) => project.exposures.blockedHandover).length,
        atRiskProjects: projectsAtRisk.length,
        topRiskProjects: projectsAtRisk.slice(0, 5),
        outstandingPostmortems,
      });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== WARNING ENGINE ==========

  app.post("/api/quality/project/:projectName/recalculate-warnings", requireAuth, requirePermission("quality", "edit"), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
      const count = await recalculateWarnings(projectName);
      logAuditFromReq(req, { entityType: "qc_warning", entityId: "0", action: "create", projectName, changesJson: { description: "Warnings recalculated", warningsGenerated: count } });
      res.json({ success: true, warningsGenerated: count });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== POST-MORTEM ==========

  app.get("/api/quality/postmortem/:projectName", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
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

  app.post("/api/quality/postmortem/:projectName", requireAuth, requirePermission("quality", "edit"), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
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
      await db.delete(calendarHoliday).where(eq(calendarHoliday.id, parseInt(String(req.params.id), 10)));
      logAuditFromReq(req, { entityType: "quality_template", entityId: String(req.params.id), action: "delete", changesJson: { description: "Holiday deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Quality] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== PLAN WARNINGS FOR TASK VIEW ==========

  app.get("/api/quality/plan-warnings/:projectName", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
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
      const userId = parseInt(String(req.params.userId), 10);
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
