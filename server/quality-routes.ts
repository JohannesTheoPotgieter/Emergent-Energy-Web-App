import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { verifyToken } from "./jwt";
import {
  qcTemplate, qcTemplatePhase, qcTemplateGroup, qcTemplateItem,
  qcTemplateRiskQuestion, qcTemplatePostmortemMetric,
  qcChecklist, qcItemInstance, qcItemEvidence, qcRiskAnswer,
  qcPlanLink, qcWarning, qcWarningEvent,
  qcPostmortem, qcPostmortemMetricValue, qcPostmortemSummary,
  qcAccessChallenge, calendarHoliday, projectPlan,
} from "@shared/schema";
import { requirePermission } from "./permission-middleware";

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
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
    }
  });

  // ========== TEMPLATES (admin read) ==========

  app.get("/api/quality/templates", requireAuth, async (req, res) => {
    try {
      const templates = await db.select().from(qcTemplate);
      res.json(templates);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
    }
  });

  // ========== CHECKLIST ITEM OPERATIONS ==========

  app.post("/api/quality/project/:projectName/item/:itemInstanceId", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      const itemId = parseInt(req.params.itemInstanceId);
      const { startDate, endDate, isApplicable, notApplicableReason, approvalComment, allowedWorkingDays } = req.body;

      const updates: any = { lastUpdatedAt: new Date() };
      if (startDate !== undefined) updates.startDate = startDate;
      if (endDate !== undefined) updates.endDate = endDate;
      if (allowedWorkingDays !== undefined) updates.allowedWorkingDays = allowedWorkingDays;
      if (isApplicable !== undefined) {
        updates.isApplicable = isApplicable;
        if (!isApplicable && notApplicableReason) updates.notApplicableReason = notApplicableReason;
      }
      if (approvalComment !== undefined) updates.approvalComment = approvalComment;

      if (startDate && endDate) {
        const holidays = await db.select().from(calendarHoliday);
        updates.workingDays = businessDaysBetween(startDate, endDate, holidays.map(h => h.date));
      }

      const [updated] = await db.update(qcItemInstance).set(updates).where(eq(qcItemInstance.id, itemId)).returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/quality/project/:projectName/item/:itemInstanceId/approve", requireAuth, requireAdminOrQm, requirePermission('quality', 'approve'), async (req, res) => {
    try {
      const itemId = parseInt(req.params.itemInstanceId);
      const { approved, comment } = req.body;

      const updates: any = {
        approved: !!approved,
        lastUpdatedAt: new Date(),
      };
      if (approved) {
        updates.approvedByUserId = getUser(req).id;
        updates.approvedAt = new Date();
        if (comment) updates.approvalComment = comment;
      } else {
        updates.approvedByUserId = null;
        updates.approvedAt = null;
      }

      const [updated] = await db.update(qcItemInstance).set(updates).where(eq(qcItemInstance.id, itemId)).returning();
      const pName = decodeURIComponent(req.params.projectName);
      recalculateWarnings(pName).catch(() => {});
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.json(evidence);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/quality/evidence/:evidenceId", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      await db.delete(qcItemEvidence).where(eq(qcItemEvidence.id, parseInt(req.params.evidenceId)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
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
        const allPlanTasks = await db.select().from(projectPlan)
          .where(inArray(projectPlan.projectName, projectsWithLinks));
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
      res.status(500).json({ error: err.message });
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
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== PLAN LINKS ==========

  app.get("/api/quality/project/:projectName/plan-links", requireAuth, async (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);
      const links = await db.select().from(qcPlanLink).where(eq(qcPlanLink.projectName, projectName));
      res.json(links);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.json(link);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/quality/plan-link/:linkId", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      const [deletedLink] = await db.select().from(qcPlanLink).where(eq(qcPlanLink.id, parseInt(req.params.linkId)));
      await db.delete(qcPlanLink).where(eq(qcPlanLink.id, parseInt(req.params.linkId)));
      if (deletedLink) recalculateWarnings(deletedLink.projectName).catch(() => {});
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
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
      const allPlanTasks = projectsWithLinks.length
        ? await db.select().from(projectPlan).where(inArray(projectPlan.projectName, projectsWithLinks))
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
          const approved = applicable.filter(i => i.approved);

          return {
            phaseId: phase.id,
            phaseName: phase.phaseName,
            total: applicable.length,
            completed: approved.length,
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
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
    }
  });

  // ========== WARNING ENGINE ==========

  app.post("/api/quality/project/:projectName/recalculate-warnings", requireAuth, requireAdminOrQm, async (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);
      const count = await recalculateWarnings(projectName);
      res.json({ success: true, warningsGenerated: count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
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

      res.json({ success: true, contractorScore, engineeringScore, redFlag });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== HOLIDAYS ==========

  app.get("/api/quality/holidays", requireAuth, async (req, res) => {
    try {
      const holidays = await db.select().from(calendarHoliday);
      res.json(holidays);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/quality/holidays", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const { date, name, countryCode } = req.body;
      const [h] = await db.insert(calendarHoliday).values({ date, name, countryCode: countryCode || "ZA" }).returning();
      res.json(h);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/quality/holidays/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      await db.delete(calendarHoliday).where(eq(calendarHoliday.id, parseInt(req.params.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
    }
  });

  // ========== QM USER MANAGEMENT ==========

  app.get("/api/quality/users", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const { users } = await import("@shared/schema");
      const allUsers = await db.select({ id: users.id, email: users.email, name: users.name, role: users.role }).from(users);
      res.json(allUsers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.json({ id: updated.id, email: updated.email, name: updated.name, role: updated.role });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
    const planTasks = await db.select().from(projectPlan)
      .where(eq(projectPlan.projectName, projectName));

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
