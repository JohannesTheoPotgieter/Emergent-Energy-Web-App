import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, sql, inArray } from "drizzle-orm";
import { verifyToken } from "./jwt";
import { projectInfo, operationalTasks, projectPlan, projectPlanOverrides, executionGateLog, mergeAuditLog, programExpense, programInflows, qcChecklist, qcItemInstance, PHASE_TO_ENG_STAGES } from "@shared/schema";
import { generateEngStagesForProject } from "./eng-stage-routes";

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

const EXEC_ROLES = ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO", "PROGRAM_MANAGER", "ENGINEERING_MANAGER", "admin"];

function requireExecRole(req: Request, res: Response, next: NextFunction) {
  const role = ((req as any).user as any)?.role || "";
  if (EXEC_ROLES.includes(role)) return next();
  res.status(403).json({ error: "forbidden", message: "Executive role required" });
}

function normalizeName(name: string): string {
  return name
    .replace(/_Tracker$/i, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .trim();
}

function formatDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateStr.substring(0, 10).split('-').map(Number);
  return { year: y, month: m, day: d };
}

function computeEaster(year: number): { year: number; month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function getSAPublicHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const add = (m: number, d: number) => {
    holidays.add(formatDateKey(year, m, d));
    const dt = new Date(Date.UTC(year, m - 1, d));
    if (dt.getUTCDay() === 0) {
      const next = new Date(dt);
      next.setUTCDate(next.getUTCDate() + 1);
      holidays.add(formatDateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()));
    }
  };
  add(1, 1); add(3, 21); add(4, 27); add(5, 1); add(6, 16); add(8, 9); add(9, 24); add(12, 16); add(12, 25); add(12, 26);
  const easter = computeEaster(year);
  const goodFriday = new Date(Date.UTC(easter.year, easter.month - 1, easter.day));
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  holidays.add(formatDateKey(goodFriday.getUTCFullYear(), goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate()));
  const familyDay = new Date(Date.UTC(easter.year, easter.month - 1, easter.day));
  familyDay.setUTCDate(familyDay.getUTCDate() + 1);
  holidays.add(formatDateKey(familyDay.getUTCFullYear(), familyDay.getUTCMonth() + 1, familyDay.getUTCDate()));
  return holidays;
}

const lcHolidayCacheByYear = new Map<number, Set<string>>();
function isHoliday(dateStr: string): boolean {
  const year = parseInt(dateStr.substring(0, 4));
  if (!lcHolidayCacheByYear.has(year)) {
    lcHolidayCacheByYear.set(year, getSAPublicHolidays(year));
  }
  return lcHolidayCacheByYear.get(year)!.has(dateStr);
}

function saWorkingDays(startDateStr: string | null, endDateStr: string | null): number | null {
  if (!startDateStr || !endDateStr || !/^\d{4}-\d{2}-\d{2}/.test(startDateStr) || !/^\d{4}-\d{2}-\d{2}/.test(endDateStr)) return null;
  const s = parseDateParts(startDateStr);
  const e = parseDateParts(endDateStr);
  const start = new Date(Date.UTC(s.year, s.month - 1, s.day));
  const end = new Date(Date.UTC(e.year, e.month - 1, e.day));
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    const ds = formatDateKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
    if (dow !== 0 && dow !== 6 && !isHoliday(ds)) {
      count++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function registerLifecycleRoutes(app: Express) {
  app.use("/api/lifecycle-board", jwtAuth);

  app.get("/api/lifecycle-board/projects", async (_req: Request, res: Response) => {
    try {
      const allProjects = await db.select({
        id: projectInfo.id,
        projectName: projectInfo.projectName,
        sizeKwp: projectInfo.sizeKwp,
        pd: projectInfo.pd,
        pm: projectInfo.pm,
        contractValue: projectInfo.contractValue,
        phase: projectInfo.phase,
        isActive: projectInfo.isActive,
        escalationLevel: projectInfo.escalationLevel,
        ragStatus: projectInfo.ragStatus,
        executionEnabled: projectInfo.executionEnabled,
        executionGateStatus: projectInfo.executionGateStatus,
        signedStatus: projectInfo.signedStatus,
        signedDate: projectInfo.signedDate,
        signedDocumentLink: projectInfo.signedDocumentLink,
        executionPhase: projectInfo.executionPhase,
        archivedStatus: projectInfo.archivedStatus,
        phaseUpdatedAt: projectInfo.phaseUpdatedAt,
        updatedAt: projectInfo.updatedAt,
        constructionStartDate: projectInfo.constructionStartDate,
        commissioningDate: projectInfo.commissioningDate,
        clientHandoverDate: projectInfo.clientHandoverDate,
      }).from(projectInfo);

      const allEngTasks = await db.select({
        projectName: operationalTasks.projectName,
        status: operationalTasks.status,
        dueDate: operationalTasks.dueDate,
        priority: operationalTasks.priority,
        assignees: operationalTasks.assignees,
      }).from(operationalTasks);

      const rawPlanTasks = await db.select({
        projectName: projectPlan.projectName,
        actualPctComplete: projectPlan.actualPctComplete,
        expectedPctComplete: projectPlan.expectedPctComplete,
        durationDays: projectPlan.durationDays,
        taskNo: projectPlan.taskNo,
        rowNumber: projectPlan.rowNumber,
        actualStart: projectPlan.actualStart,
        actualEnd: projectPlan.actualEnd,
      }).from(projectPlan);

      const allPlanOverrides = await db.select().from(projectPlanOverrides);
      const deletedKeys = new Set<string>();
      const overrideMap = new Map<string, Map<number, Map<string, any>>>();
      for (const o of allPlanOverrides) {
        if (o.fieldName === "isDeleted" && o.overrideValue === "true") {
          deletedKeys.add(`${o.projectName}::${o.rowNumber}`);
          continue;
        }
        if (!overrideMap.has(o.projectName)) overrideMap.set(o.projectName, new Map());
        const projMap = overrideMap.get(o.projectName)!;
        if (!projMap.has(o.rowNumber)) projMap.set(o.rowNumber, new Map());
        const val = o.overrideValue;
        const fieldName = o.fieldName;
        let coerced: any = val;
        if (val !== null && val !== undefined && val !== "") {
          if (fieldName === "actualPctComplete" || fieldName === "expectedPctComplete" || fieldName === "durationDays") {
            const num = Number(val);
            coerced = isNaN(num) ? null : num;
          }
        } else {
          coerced = null;
        }
        projMap.get(o.rowNumber)!.set(fieldName, coerced);
      }

      const allPlanTasks = rawPlanTasks
        .filter(row => {
          if (!row.rowNumber) return true;
          return !deletedKeys.has(`${row.projectName}::${row.rowNumber}`);
        })
        .map(row => {
          const projOverrides = overrideMap.get(row.projectName);
          if (!projOverrides || !row.rowNumber || !projOverrides.has(row.rowNumber)) return row;
          const fieldOverrides = projOverrides.get(row.rowNumber)!;
          const updated = { ...row };
          fieldOverrides.forEach((value, fieldName) => {
            (updated as any)[fieldName] = value;
          });
          return updated;
        });

      const allQmData = await db.select({
        projectName: qcChecklist.projectName,
        isApplicable: qcItemInstance.isApplicable,
        approved: qcItemInstance.approved,
      }).from(qcChecklist)
        .innerJoin(qcItemInstance, eq(qcItemInstance.checklistId, qcChecklist.id));

      const trackerProjectNames = new Set<string>();
      const expenseNames = await db.selectDistinct({ projectName: programExpense.projectName }).from(programExpense);
      for (const e of expenseNames) {
        if (e.projectName) trackerProjectNames.add(normalizeName(e.projectName));
      }
      const inflowNames = await db.selectDistinct({ projectName: programInflows.projectName }).from(programInflows);
      for (const i of inflowNames) {
        if (i.projectName) trackerProjectNames.add(normalizeName(i.projectName));
      }
      const planNames = await db.selectDistinct({ projectName: projectPlan.projectName }).from(projectPlan);
      for (const p of planNames) {
        if (p.projectName) trackerProjectNames.add(normalizeName(p.projectName));
      }

      const DONE_STATUSES = ["DONE", "QC APPROVED", "COMPLETED"];
      const today = new Date().toISOString().split("T")[0];

      const engByNorm = new Map<string, { total: number; done: number; overdue: number; highPriority: number; assignees: Set<string>; rawName: string }>();
      for (const t of allEngTasks) {
        const name = t.projectName;
        if (!name) continue;
        const norm = normalizeName(name);
        if (!engByNorm.has(norm)) engByNorm.set(norm, { total: 0, done: 0, overdue: 0, highPriority: 0, assignees: new Set(), rawName: name });
        const entry = engByNorm.get(norm)!;
        entry.total++;
        const isDone = t.status && DONE_STATUSES.includes(t.status.toUpperCase());
        if (isDone) {
          entry.done++;
        } else {
          if (t.dueDate && t.dueDate < today) entry.overdue++;
          if (t.priority && ["High", "Urgent", "Highest"].includes(t.priority)) entry.highPriority++;
        }
        if (t.assignees && Array.isArray(t.assignees)) {
          for (const a of t.assignees) {
            if (a) entry.assignees.add(a);
          }
        }
      }

      const todayDate = new Date().toISOString().split("T")[0];
      const planByNorm = new Map<string, { total: number; weightedPct: number; totalWeight: number; weightedExpPct: number; totalExpWeight: number }>();
      for (const p of allPlanTasks) {
        const name = p.projectName;
        if (!name) continue;
        const taskNo = (p.taskNo || '').toString().toLowerCase().trim();
        const isSummary = taskNo === 'no.' || taskNo === 'no' || taskNo === '#';
        if (isSummary) continue;
        const norm = normalizeName(name);
        if (!planByNorm.has(norm)) planByNorm.set(norm, { total: 0, weightedPct: 0, totalWeight: 0, weightedExpPct: 0, totalExpWeight: 0 });
        const entry = planByNorm.get(norm)!;
        entry.total++;
        const dur = p.durationDays && p.durationDays > 0 ? Number(p.durationDays) : 1;
        entry.weightedPct += Number(p.actualPctComplete ?? 0) * dur;
        entry.totalWeight += dur;
        entry.totalExpWeight += dur;
        if (p.expectedPctComplete !== null && p.expectedPctComplete !== undefined) {
          entry.weightedExpPct += Number(p.expectedPctComplete) * dur;
        } else {
          const tStart = (p as any).actualStart?.substring(0, 10);
          const tEnd = (p as any).actualEnd?.substring(0, 10);
          if (tStart && tEnd && /^\d{4}-\d{2}-\d{2}/.test(tStart) && /^\d{4}-\d{2}-\d{2}/.test(tEnd)) {
            let exp = 0;
            if (todayDate >= tEnd) {
              exp = 1.0;
            } else if (todayDate <= tStart) {
              exp = 0.0;
            } else {
              const totalWd = saWorkingDays(tStart, tEnd);
              const elapsedWd = saWorkingDays(tStart, todayDate);
              if (totalWd && totalWd > 0 && elapsedWd !== null) {
                exp = Math.min(elapsedWd / totalWd, 1.0);
              }
            }
            entry.weightedExpPct += exp * dur;
          }
        }
      }

      const qmByNorm = new Map<string, { total: number; approved: number }>();
      for (const q of allQmData) {
        const name = q.projectName;
        if (!name) continue;
        const norm = normalizeName(name);
        if (!qmByNorm.has(norm)) qmByNorm.set(norm, { total: 0, approved: 0 });
        const entry = qmByNorm.get(norm)!;
        if (q.isApplicable) {
          entry.total++;
          if (q.approved) entry.approved++;
        }
      }

      const projectNormNames = new Set<string>();
      const results: any[] = [];

      for (const proj of allProjects) {
        const norm = normalizeName(proj.projectName);
        projectNormNames.add(norm);

        const eng = engByNorm.get(norm) || { total: 0, done: 0, overdue: 0, highPriority: 0, assignees: new Set<string>(), rawName: "" };
        const plan = planByNorm.get(norm) || { total: 0, weightedPct: 0, totalWeight: 0, weightedExpPct: 0, totalExpWeight: 0 };
        const qm = qmByNorm.get(norm) || { total: 0, approved: 0 };

        const hasTracker = trackerProjectNames.has(norm);
        let source: "excel" | "engineering" | "both" = hasTracker ? "excel" : "none" as any;
        if (eng.total > 0 && hasTracker) source = "both";
        else if (eng.total > 0) source = "engineering";
        else if (hasTracker) source = "excel";

        const projectPctComplete = plan.totalWeight > 0 ? plan.weightedPct / plan.totalWeight : null;
        const expectedPctComplete = plan.totalExpWeight > 0 ? plan.weightedExpPct / plan.totalExpWeight : null;

        results.push({
          id: proj.id,
          projectName: proj.projectName,
          sizeKwp: proj.sizeKwp,
          pd: proj.pd,
          pm: proj.pm,
          contractValue: proj.contractValue,
          phase: proj.phase,
          isActive: proj.isActive,
          escalationLevel: proj.escalationLevel,
          ragStatus: proj.ragStatus,
          executionEnabled: proj.executionEnabled,
          executionGateStatus: proj.executionGateStatus,
          signedStatus: proj.signedStatus,
          executionPhase: proj.executionPhase,
          archivedStatus: proj.archivedStatus,
          source,
          engTotal: eng.total,
          engDone: eng.done,
          engOverdue: eng.overdue,
          engHighPriority: eng.highPriority,
          engAssignees: Array.from(eng.assignees),
          planTotal: plan.total,
          planAvgPct: plan.totalWeight > 0 ? Math.round((plan.weightedPct / plan.totalWeight) * 100) / 100 : 0,
          projectPctComplete,
          expectedPctComplete,
          qmTotal: qm.total,
          qmApproved: qm.approved,
          phaseUpdatedAt: proj.phaseUpdatedAt,
          updatedAt: proj.updatedAt,
          constructionStartDate: proj.constructionStartDate,
          commissioningDate: proj.commissioningDate,
          clientHandoverDate: proj.clientHandoverDate,
        });
      }

      const engNormKeys = Array.from(engByNorm.keys());
      for (const norm of engNormKeys) {
        if (projectNormNames.has(norm)) continue;

        const eng = engByNorm.get(norm)!;
        const plan = planByNorm.get(norm) || { total: 0, weightedPct: 0, totalWeight: 0, weightedExpPct: 0, totalExpWeight: 0 };
        const qm = qmByNorm.get(norm) || { total: 0, approved: 0 };
        const projectPctComplete = plan.totalWeight > 0 ? plan.weightedPct / plan.totalWeight : null;

        results.push({
          id: null,
          projectName: eng.rawName,
          sizeKwp: null,
          pd: null,
          pm: null,
          contractValue: null,
          phase: null,
          isActive: true,
          source: "engineering" as const,
          engTotal: eng.total,
          engDone: eng.done,
          engOverdue: eng.overdue,
          engHighPriority: eng.highPriority,
          engAssignees: Array.from(eng.assignees),
          planTotal: plan.total,
          planAvgPct: plan.totalWeight > 0 ? Math.round((plan.weightedPct / plan.totalWeight) * 100) / 100 : 0,
          projectPctComplete,
          qmTotal: qm.total,
          qmApproved: qm.approved,
          phaseUpdatedAt: null,
          updatedAt: null,
          constructionStartDate: null,
          commissioningDate: null,
          clientHandoverDate: null,
        });
      }

      res.json(results);
    } catch (err: any) {
      console.error("[lifecycle-board] GET projects error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/lifecycle-board/projects/link-engineering", requireAuth, requireExecRole, async (req: Request, res: Response) => {
    try {
      const { engineeringProjectName, targetProjectId } = req.body;
      if (!engineeringProjectName || !targetProjectId) {
        return res.status(400).json({ error: "engineeringProjectName and targetProjectId are required" });
      }

      const [target] = await db.select().from(projectInfo).where(eq(projectInfo.id, targetProjectId));
      if (!target) return res.status(404).json({ error: "Target project not found" });

      const updated = await db.update(operationalTasks)
        .set({ projectName: target.projectName.replace(/_Tracker$/i, "").replace(/_/g, " ") })
        .where(eq(operationalTasks.projectName, engineeringProjectName))
        .returning();

      res.json({ linked: updated.length, targetProject: target.projectName });
    } catch (err: any) {
      console.error("[lifecycle-board] POST link-engineering error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/lifecycle-board/projects/merge", requireAuth, requireExecRole, async (req: Request, res: Response) => {
    try {
      const { sourceProjectId, targetProjectId, reason } = req.body;
      if (!sourceProjectId || !targetProjectId) {
        return res.status(400).json({ error: "sourceProjectId and targetProjectId are required" });
      }
      if (sourceProjectId === targetProjectId) {
        return res.status(400).json({ error: "Cannot merge a project with itself" });
      }

      const userId = ((req as any).user as any)?.id || null;
      const userRole = ((req as any).user as any)?.role || null;

      const result = await db.transaction(async (tx: any) => {
        const [source] = await tx.select().from(projectInfo).where(eq(projectInfo.id, sourceProjectId));
        const [target] = await tx.select().from(projectInfo).where(eq(projectInfo.id, targetProjectId));
        if (!source) throw new Error("Source project not found");
        if (!target) throw new Error("Target project not found");

        const sourceClean = source.projectName.replace(/_Tracker$/i, "").replace(/_/g, " ");
        const targetClean = target.projectName.replace(/_Tracker$/i, "").replace(/_/g, " ");

        const movedTasks = await tx.update(operationalTasks)
          .set({ projectName: targetClean })
          .where(eq(operationalTasks.projectName, sourceClean))
          .returning();

        const movedPlan = await tx.update(projectPlan)
          .set({ projectName: target.projectName })
          .where(eq(projectPlan.projectName, source.projectName))
          .returning();

        const fillFields: Record<string, any> = {};
        const conflicts: { field: string; primaryValue: any; secondaryValue: any }[] = [];
        const mergeFields = ['sizeKwp', 'pd', 'pm', 'contractValue', 'signedStatus', 'signedDate', 'signedDocumentLink'] as const;
        for (const field of mergeFields) {
          const tVal = (target as any)[field];
          const sVal = (source as any)[field];
          if ((tVal == null || tVal === '' || tVal === 'NONE') && sVal != null && sVal !== '' && sVal !== 'NONE') {
            fillFields[field] = sVal;
          } else if (tVal != null && sVal != null && tVal !== sVal) {
            conflicts.push({ field, primaryValue: tVal, secondaryValue: sVal });
          }
        }
        if (Object.keys(fillFields).length > 0) {
          fillFields.updatedAt = new Date();
          await tx.update(projectInfo).set(fillFields).where(eq(projectInfo.id, targetProjectId));
        }

        await tx.update(projectInfo).set({
          archivedStatus: 'ARCHIVED_MERGED',
          canonicalProjectId: targetProjectId,
          isActive: false,
          updatedAt: new Date(),
        }).where(eq(projectInfo.id, sourceProjectId));

        await tx.insert(mergeAuditLog).values({
          primaryProjectId: targetProjectId,
          secondaryProjectId: sourceProjectId,
          primaryProjectName: target.projectName,
          secondaryProjectName: source.projectName,
          mergedByUserId: userId,
          mergedByRole: userRole,
          reason: reason || null,
          conflictsJson: conflicts.length > 0 ? JSON.stringify(conflicts) : null,
          movedTaskCount: movedTasks.length,
          movedPlanCount: movedPlan.length,
        });

        return {
          merged: true,
          movedTasks: movedTasks.length,
          movedPlanEntries: movedPlan.length,
          fieldsFilled: Object.keys(fillFields).filter(k => k !== 'updatedAt'),
          conflicts,
          source: source.projectName,
          target: target.projectName,
        };
      });

      res.json(result);
    } catch (err: any) {
      console.error("[lifecycle-board] POST merge error:", err);
      if (err.message === "Source project not found" || err.message === "Target project not found") {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/lifecycle-board/projects/promote-engineering", requireAuth, requireExecRole, async (req: Request, res: Response) => {
    try {
      const { engineeringProjectName, phase } = req.body;
      if (!engineeringProjectName) {
        return res.status(400).json({ error: "engineeringProjectName is required" });
      }

      const cleanName = engineeringProjectName.replace(/_Tracker$/i, "").replace(/_/g, " ");
      const userId = ((req as any).user as any)?.id || null;

      const allProjects = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo);
      const normTarget = normalizeName(cleanName);
      const existing = allProjects.find((p: any) => normalizeName(p.projectName) === normTarget);
      if (existing) {
        const targetPhase = phase || "First Assessment";
        await db.update(projectInfo).set({
          phase: targetPhase,
          isActive: true,
          phaseUpdatedAt: new Date(),
          phaseUpdatedByUserId: userId,
        }).where(eq(projectInfo.id, existing.id));

        const promoteStageNames = PHASE_TO_ENG_STAGES[targetPhase];
        if (promoteStageNames && promoteStageNames.length > 0 && userId) {
          try {
            const result = await generateEngStagesForProject(existing.id, userId, promoteStageNames);
            if (result.stagesCreated > 0) {
              console.log(`[lifecycle-board] Auto-generated eng stages for re-activated project ${existing.id}: ${result.stageDetails.join(", ")}`);
            }
          } catch (err: any) {
            console.warn("[lifecycle-board] Eng stage auto-generation on promote error (non-fatal):", err.message);
          }
        }

        const [updated] = await db.select().from(projectInfo).where(eq(projectInfo.id, existing.id));
        return res.json(updated);
      }

      const [created] = await db.insert(projectInfo).values({
        projectName: cleanName,
        phase: phase || "First Assessment",
        isActive: true,
        phaseUpdatedAt: new Date(),
        phaseUpdatedByUserId: userId,
      }).returning();

      const targetPhase = phase || "First Assessment";
      const stageNames = PHASE_TO_ENG_STAGES[targetPhase];
      if (stageNames && stageNames.length > 0 && userId) {
        try {
          const result = await generateEngStagesForProject(created.id, userId, stageNames);
          if (result.stagesCreated > 0) {
            console.log(`[lifecycle-board] Auto-generated eng stages for promoted project ${created.id}: ${result.stageDetails.join(", ")}`);
          }
        } catch (err: any) {
          console.warn("[lifecycle-board] Eng stage auto-generation on promote error (non-fatal):", err.message);
        }
      }

      res.json(created);
    } catch (err: any) {
      console.error("[lifecycle-board] POST promote-engineering error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/lifecycle-board/projects/:id", requireAuth, requireExecRole, async (req: Request, res: Response) => {
    try {
      const idParam = req.params.id as string;
      const id = parseInt(idParam);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid project id" });

      const [existing] = await db.select().from(projectInfo).where(eq(projectInfo.id, id));
      if (!existing) return res.status(404).json({ error: "Project not found" });

      const { sizeKwp, pd, pm, pmUserId, contractValue, escalationLevel, phase, ragStatus, projectName: newName } = req.body;
      const updates: Record<string, any> = { updatedAt: new Date() };

      if (newName !== undefined && newName.trim() && newName.trim() !== existing.projectName) {
        updates.projectName = newName.trim();
      }
      if (sizeKwp !== undefined) updates.sizeKwp = sizeKwp || null;
      if (pd !== undefined) updates.pd = pd || null;
      if (pm !== undefined) {
        updates.pm = pm || null;
        updates.pmUserId = pmUserId ?? null;
      }
      if (contractValue !== undefined) updates.contractValue = contractValue || null;
      if (escalationLevel !== undefined) updates.escalationLevel = (escalationLevel && escalationLevel !== "none") ? escalationLevel : null;
      if (ragStatus !== undefined) updates.ragStatus = (ragStatus && ragStatus !== "none") ? ragStatus : null;
      if (phase !== undefined && phase !== existing.phase) {
        updates.phase = phase;
        updates.phaseUpdatedAt = new Date();
        updates.phaseUpdatedByUserId = ((req as any).user as any)?.id || null;
      }

      const [updated] = await db.update(projectInfo).set(updates).where(eq(projectInfo.id, id)).returning();
      res.json(updated);
    } catch (err: any) {
      console.error("[lifecycle-board] PATCH project error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/lifecycle-board/projects/:id/phase", requireAuth, requireExecRole, async (req: Request, res: Response) => {
    try {
      const idParam = req.params.id as string;
      const id = parseInt(idParam);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid project id" });

      const { phase } = req.body;
      if (!phase || typeof phase !== "string") {
        return res.status(400).json({ error: "phase is required and must be a string" });
      }

      const [existing] = await db.select().from(projectInfo).where(eq(projectInfo.id, id));
      if (!existing) return res.status(404).json({ error: "Project not found" });

      const userId = ((req as any).user as any)?.id || null;

      const [updated] = await db.update(projectInfo).set({
        phase: phase.trim(),
        phaseUpdatedAt: new Date(),
        phaseUpdatedByUserId: userId,
        updatedAt: new Date(),
      }).where(eq(projectInfo.id, id)).returning();

      let engStagesResult: any = null;
      const stageNames = PHASE_TO_ENG_STAGES[phase.trim()];
      if (stageNames && stageNames.length > 0 && userId) {
        try {
          engStagesResult = await generateEngStagesForProject(id, userId, stageNames);
          if (engStagesResult.stagesCreated > 0) {
            console.log(`[lifecycle-board] Auto-generated eng stages for project ${id}: ${engStagesResult.stageDetails.join(", ")}`);
          }
        } catch (err: any) {
          console.warn("[lifecycle-board] Eng stage auto-generation error (non-fatal):", err.message);
        }
      }

      res.json({ ...updated, engStagesResult });
    } catch (err: any) {
      console.error("[lifecycle-board] PATCH phase error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/lifecycle-board/projects/:id/execution-gate", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid project id" });

      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, id));
      if (!project) return res.status(404).json({ error: "Project not found" });

      const isEligible = project.signedStatus !== 'NONE' && project.signedDate != null && project.signedDocumentLink != null && project.signedDocumentLink.trim() !== '';
      const gateStatus = project.executionEnabled ? 'ENABLED' : (isEligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE');
      const eligibilityReasons: string[] = [];
      if (project.signedStatus === 'NONE') eligibilityReasons.push('No signed status set');
      if (!project.signedDate) eligibilityReasons.push('No signed date');
      if (!project.signedDocumentLink?.trim()) eligibilityReasons.push('No signed document link');

      res.json({
        id: project.id,
        projectName: project.projectName,
        signedStatus: project.signedStatus,
        signedDate: project.signedDate,
        signedDocumentLink: project.signedDocumentLink,
        executionEnabled: project.executionEnabled,
        executionGateStatus: gateStatus,
        executionGateReason: project.executionGateReason,
        executionPhase: project.executionPhase,
        excelTrackerLink: project.excelTrackerLink,
        eligibilityReasons,
        isEligible,
      });
    } catch (err: any) {
      console.error("[lifecycle-board] GET execution-gate error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/lifecycle-board/projects/:id/execution-gate", requireAuth, requireExecRole, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid project id" });

      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, id));
      if (!project) return res.status(404).json({ error: "Project not found" });

      const { signedStatus, signedDate, signedDocumentLink, executionEnabled, reason } = req.body;

      const updates: Record<string, any> = { updatedAt: new Date() };
      if (signedStatus !== undefined) updates.signedStatus = signedStatus;
      if (signedDate !== undefined) updates.signedDate = signedDate;
      if (signedDocumentLink !== undefined) updates.signedDocumentLink = signedDocumentLink;

      const effectiveSignedStatus = signedStatus !== undefined ? signedStatus : project.signedStatus;
      const effectiveSignedDate = signedDate !== undefined ? signedDate : project.signedDate;
      const effectiveSignedDocumentLink = signedDocumentLink !== undefined ? signedDocumentLink : project.signedDocumentLink;

      const isEligible = effectiveSignedStatus !== 'NONE' && effectiveSignedDate != null && effectiveSignedDocumentLink != null && effectiveSignedDocumentLink.trim() !== '';

      if (executionEnabled === true && !isEligible && !reason) {
        const eligibilityReasons: string[] = [];
        if (effectiveSignedStatus === 'NONE') eligibilityReasons.push('No signed status set');
        if (!effectiveSignedDate) eligibilityReasons.push('No signed date');
        if (!effectiveSignedDocumentLink?.trim()) eligibilityReasons.push('No signed document link');
        return res.status(400).json({
          error: "Project is not eligible for execution",
          eligibilityReasons,
          message: "Provide a reason to override eligibility requirements",
        });
      }

      if (executionEnabled !== undefined) updates.executionEnabled = executionEnabled;

      const effectiveExecutionEnabled = executionEnabled !== undefined ? executionEnabled : project.executionEnabled;
      const newGateStatus = effectiveExecutionEnabled ? 'ENABLED' : (isEligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE');
      updates.executionGateStatus = newGateStatus;
      if (reason !== undefined) updates.executionGateReason = reason;

      const previousStatus = project.executionGateStatus;

      const [updated] = await db.update(projectInfo).set(updates).where(eq(projectInfo.id, id)).returning();

      const user = (req as any).user as any;
      await db.insert(executionGateLog).values({
        projectId: id,
        action: executionEnabled !== undefined ? (executionEnabled ? 'ENABLE' : 'DISABLE') : 'UPDATE',
        previousStatus,
        newStatus: newGateStatus,
        reason: reason || null,
        changedByUserId: user?.id || null,
        changedByRole: user?.role || null,
      });

      const responseEligibilityReasons: string[] = [];
      if (effectiveSignedStatus === 'NONE') responseEligibilityReasons.push('No signed status set');
      if (!effectiveSignedDate) responseEligibilityReasons.push('No signed date');
      if (!effectiveSignedDocumentLink?.trim()) responseEligibilityReasons.push('No signed document link');

      res.json({
        id: updated.id,
        projectName: updated.projectName,
        signedStatus: updated.signedStatus,
        signedDate: updated.signedDate,
        signedDocumentLink: updated.signedDocumentLink,
        executionEnabled: updated.executionEnabled,
        executionGateStatus: newGateStatus,
        executionGateReason: updated.executionGateReason,
        executionPhase: updated.executionPhase,
        excelTrackerLink: updated.excelTrackerLink,
        eligibilityReasons: responseEligibilityReasons,
        isEligible,
      });
    } catch (err: any) {
      console.error("[lifecycle-board] PATCH execution-gate error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/lifecycle-board/projects/merge-preview", requireAuth, requireExecRole, async (req: Request, res: Response) => {
    try {
      const primaryId = parseInt(req.query.primaryId as string);
      const secondaryId = parseInt(req.query.secondaryId as string);
      if (isNaN(primaryId) || isNaN(secondaryId)) {
        return res.status(400).json({ error: "primaryId and secondaryId query params are required" });
      }

      const [primary] = await db.select().from(projectInfo).where(eq(projectInfo.id, primaryId));
      const [secondary] = await db.select().from(projectInfo).where(eq(projectInfo.id, secondaryId));
      if (!primary) return res.status(404).json({ error: "Primary project not found" });
      if (!secondary) return res.status(404).json({ error: "Secondary project not found" });

      const primaryClean = primary.projectName.replace(/_Tracker$/i, "").replace(/_/g, " ");
      const secondaryClean = secondary.projectName.replace(/_Tracker$/i, "").replace(/_/g, " ");

      const allTasks = await db.select({ projectName: operationalTasks.projectName }).from(operationalTasks);
      const allPlans = await db.select({ projectName: projectPlan.projectName }).from(projectPlan);

      const primaryNorm = normalizeName(primary.projectName);
      const secondaryNorm = normalizeName(secondary.projectName);

      let primaryTaskCount = 0;
      let secondaryTaskCount = 0;
      for (const t of allTasks) {
        if (!t.projectName) continue;
        const norm = normalizeName(t.projectName);
        if (norm === primaryNorm) primaryTaskCount++;
        if (norm === secondaryNorm) secondaryTaskCount++;
      }

      let primaryPlanCount = 0;
      let secondaryPlanCount = 0;
      for (const p of allPlans) {
        if (!p.projectName) continue;
        if (p.projectName === primary.projectName) primaryPlanCount++;
        if (p.projectName === secondary.projectName) secondaryPlanCount++;
      }

      const compareFields = [
        "sizeKwp", "pd", "pm", "contractValue", "phase", "escalationLevel", "ragStatus",
        "executionEnabled", "executionGateStatus", "signedStatus", "signedDate", "signedDocumentLink",
      ] as const;

      const conflicts: { field: string; primaryValue: any; secondaryValue: any }[] = [];
      for (const field of compareFields) {
        const pVal = (primary as any)[field];
        const sVal = (secondary as any)[field];
        if (pVal !== sVal && (pVal != null || sVal != null)) {
          conflicts.push({ field, primaryValue: pVal, secondaryValue: sVal });
        }
      }

      res.json({
        primary: {
          id: primary.id,
          projectName: primary.projectName,
          sizeKwp: primary.sizeKwp,
          pd: primary.pd,
          pm: primary.pm,
          contractValue: primary.contractValue,
          phase: primary.phase,
          escalationLevel: primary.escalationLevel,
          ragStatus: primary.ragStatus,
        },
        secondary: {
          id: secondary.id,
          projectName: secondary.projectName,
          sizeKwp: secondary.sizeKwp,
          pd: secondary.pd,
          pm: secondary.pm,
          contractValue: secondary.contractValue,
          phase: secondary.phase,
          escalationLevel: secondary.escalationLevel,
          ragStatus: secondary.ragStatus,
        },
        conflicts,
        primaryTaskCount,
        secondaryTaskCount,
        primaryPlanCount,
        secondaryPlanCount,
      });
    } catch (err: any) {
      console.error("[lifecycle-board] GET merge-preview error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/lifecycle-board/projects/:id", requireAuth, requireExecRole, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id as string, 10);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project) return res.status(404).json({ error: "Project not found" });

      if (project.archivedStatus === "ARCHIVED_DELETED") {
        return res.status(400).json({ error: "Project is already deleted" });
      }

      await db.update(projectInfo)
        .set({ archivedStatus: "ARCHIVED_DELETED", isActive: false })
        .where(eq(projectInfo.id, projectId));

      console.log(`[lifecycle-board] Project ${projectId} (${project.projectName}) soft-deleted by ${((req as any).user as any)?.email || "unknown"}`);

      res.json({ success: true, projectName: project.projectName });
    } catch (err: any) {
      console.error("[lifecycle-board] DELETE project error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}
