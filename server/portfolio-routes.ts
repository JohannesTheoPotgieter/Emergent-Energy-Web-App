import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, sql, and, inArray, desc } from "drizzle-orm";
import { verifyToken } from "./jwt";
import {
  portfolios, portfolioRolloutPlans, portfolioRolloutPhases,
  projectPortfolioAssignments, projectInfo, users,
  qcChecklist, qcItemInstance, normalizedCostLines, normalizedRevenueLines,
} from "@shared/schema";
import { logAuditFromReq } from "./audit-logger";
import { getAllPMWorkItemsAsProjectPlan } from "./work-items-adapter";

function computeProjectCompletion(plans: any[]): { actualPct: number; expectedPct: number; delta: number } {
  const todayStr = new Date().toISOString().split("T")[0];
  const validPlans = plans.filter((p: any) => {
    const hasActual = (p.actualPctComplete ?? p.percentComplete) != null;
    const hasExpected = (p.expectedPctComplete ?? p.expectedProgress) != null;
    const hasDateRange = p.actualStart && p.actualEnd;
    return hasActual || hasExpected || hasDateRange;
  });
  if (validPlans.length === 0) return { actualPct: 0, expectedPct: 0, delta: 0 };

  let totalWeight = 0, weightedActual = 0, weightedExpected = 0;
  for (const p of validPlans) {
    const dur = (p.durationDays && p.durationDays > 0) ? p.durationDays : 1;
    const act = p.actualPctComplete ?? p.percentComplete ?? 0;
    weightedActual += (parseFloat(act) || 0) * dur;
    let exp = p.expectedPctComplete ?? p.expectedProgress ?? null;
    if (exp == null) {
      const tStart = p.actualStart?.substring(0, 10);
      const tEnd = p.actualEnd?.substring(0, 10);
      if (tStart && tEnd && /^\d{4}-\d{2}-\d{2}/.test(tStart) && /^\d{4}-\d{2}-\d{2}/.test(tEnd)) {
        if (todayStr >= tEnd) exp = 1.0;
        else if (todayStr <= tStart) exp = 0.0;
        else {
          const totalDays = Math.max(1, (new Date(tEnd).getTime() - new Date(tStart).getTime()) / 86400000);
          const elapsedDays = (new Date(todayStr).getTime() - new Date(tStart).getTime()) / 86400000;
          exp = Math.min(elapsedDays / totalDays, 1.0);
        }
      } else {
        exp = 0;
      }
    }
    weightedExpected += (parseFloat(exp) || 0) * dur;
    totalWeight += dur;
  }

  if (totalWeight === 0) return { actualPct: 0, expectedPct: 0, delta: 0 };
  const rawActual = weightedActual / totalWeight;
  const rawExpected = weightedExpected / totalWeight;
  const actualPct = rawActual <= 1.0 ? Math.round(rawActual * 1000) / 10 : Math.round(rawActual * 10) / 10;
  const expectedPct = rawExpected <= 1.0 ? Math.round(rawExpected * 1000) / 10 : Math.round(rawExpected * 10) / 10;
  return { actualPct, expectedPct, delta: Math.round((actualPct - expectedPct) * 10) / 10 };
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

const MANAGE_ROLES = ["COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER", "admin"];
const COO_ROLES = ["COO_ADMIN", "CEO_ADMIN", "admin"];

function requireManageRole(req: Request, res: Response, next: NextFunction) {
  const role = ((req as any).user as any)?.role || "";
  if (MANAGE_ROLES.includes(role)) return next();
  res.status(403).json({ error: "forbidden", message: "Program Manager or higher role required" });
}

function requireCooRole(req: Request, res: Response, next: NextFunction) {
  const role = ((req as any).user as any)?.role || "";
  if (COO_ROLES.includes(role)) return next();
  res.status(403).json({ error: "forbidden", message: "COO role required for this action" });
}

export function registerPortfolioRoutes(app: Express) {
  app.get("/api/portfolios", jwtAuth, requireAuth, async (_req, res) => {
    try {
      const allPortfolios = await db.select().from(portfolios).orderBy(desc(portfolios.createdAt));
      const assignments = await db.select().from(projectPortfolioAssignments);
      const allProjects = await db.select({
        id: projectInfo.id,
        projectName: projectInfo.projectName,
        phase: projectInfo.phase,
        sizeKwp: projectInfo.sizeKwp,
        pm: projectInfo.pm,
        isActive: projectInfo.isActive,
      }).from(projectInfo);

      const ownerIds = allPortfolios.map(p => p.ownerUserId).filter(Boolean) as number[];
      const allUsers = ownerIds.length > 0 ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ownerIds)) : [];
      const userMap = new Map(allUsers.map(u => [u.id, u.name]));

      const projectMap = new Map(allProjects.map(p => [p.id, p]));
      const portfolioProjects = new Map<number, typeof allProjects>();

      for (const a of assignments) {
        const proj = projectMap.get(a.projectId);
        if (proj) {
          if (!portfolioProjects.has(a.portfolioId)) portfolioProjects.set(a.portfolioId, []);
          portfolioProjects.get(a.portfolioId)!.push(proj);
        }
      }

      const result = allPortfolios.map(p => {
        const projs = portfolioProjects.get(p.id) || [];
        return {
          ...p,
          ownerName: p.ownerUserId ? userMap.get(p.ownerUserId) || null : null,
          projectCount: projs.length,
          totalKwp: projs.reduce((sum, pr) => sum + (parseFloat(String(pr.sizeKwp || "0")) || 0), 0),
          projects: projs.map(pr => ({ id: pr.id, projectName: pr.projectName, phase: pr.phase, sizeKwp: pr.sizeKwp, pm: pr.pm })),
        };
      });

      res.json(result);
    } catch (err: any) {
      console.error("[Portfolio] List error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/portfolios/:id", jwtAuth, requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [portfolio] = await db.select().from(portfolios).where(eq(portfolios.id, id));
      if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });

      const assignments = await db.select().from(projectPortfolioAssignments).where(eq(projectPortfolioAssignments.portfolioId, id));
      const projectIds = assignments.map(a => a.projectId);

      let projects: any[] = [];
      if (projectIds.length > 0) {
        projects = await db.select().from(projectInfo).where(inArray(projectInfo.id, projectIds));
      }

      const rolloutPlans = await db.select().from(portfolioRolloutPlans).where(eq(portfolioRolloutPlans.portfolioId, id));
      let phases: any[] = [];
      if (rolloutPlans.length > 0) {
        const planIds = rolloutPlans.map(rp => rp.id);
        phases = await db.select().from(portfolioRolloutPhases).where(inArray(portfolioRolloutPhases.rolloutPlanId, planIds));
      }

      let ownerName = null;
      if (portfolio.ownerUserId) {
        const [owner] = await db.select({ name: users.name }).from(users).where(eq(users.id, portfolio.ownerUserId));
        ownerName = owner?.name || null;
      }

      res.json({
        ...portfolio,
        ownerName,
        projects,
        assignments,
        rolloutPlans: rolloutPlans.map(rp => ({
          ...rp,
          phases: phases.filter(ph => ph.rolloutPlanId === rp.id).sort((a, b) => a.sortOrder - b.sortOrder),
        })),
      });
    } catch (err: any) {
      console.error("[Portfolio] Get error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/portfolios", jwtAuth, requireAuth, requireManageRole, async (req, res) => {
    try {
      const userId = ((req as any).user as any)?.id;
      const { name, clientName, status, description, ownerUserId } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Portfolio name is required" });

      const [created] = await db.insert(portfolios).values({
        name: name.trim(),
        clientName: clientName?.trim() || null,
        status: status || "Active",
        description: description?.trim() || null,
        ownerUserId: ownerUserId || userId,
        createdBy: userId,
        updatedBy: userId,
      }).returning();

      logAuditFromReq(req, { entityType: "portfolio", entityId: String(created.id), action: "create", changesJson: { description: "Portfolio created", name: created.name } });
      res.json(created);
    } catch (err: any) {
      console.error("[Portfolio] Create error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/portfolios/:id", jwtAuth, requireAuth, requireManageRole, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = ((req as any).user as any)?.id;
      const { name, clientName, status, description, ownerUserId } = req.body;

      const updates: any = { updatedBy: userId, updatedAt: new Date() };
      if (name !== undefined) updates.name = name.trim();
      if (clientName !== undefined) updates.clientName = clientName?.trim() || null;
      if (status !== undefined) updates.status = status;
      if (description !== undefined) updates.description = description?.trim() || null;
      if (ownerUserId !== undefined) updates.ownerUserId = ownerUserId;

      const [updated] = await db.update(portfolios).set(updates).where(eq(portfolios.id, id)).returning();
      if (!updated) return res.status(404).json({ error: "Portfolio not found" });

      logAuditFromReq(req, { entityType: "portfolio", entityId: String(id), action: "update", changesJson: { description: "Portfolio updated", name: updated.name } });
      res.json(updated);
    } catch (err: any) {
      console.error("[Portfolio] Update error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/portfolios/:id", jwtAuth, requireAuth, requireManageRole, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(portfolios).where(eq(portfolios.id, id));
      logAuditFromReq(req, { entityType: "portfolio", entityId: String(id), action: "delete", changesJson: { description: "Portfolio deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Portfolio] Delete error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/portfolios/:id/assign-project", jwtAuth, requireAuth, requireManageRole, async (req, res) => {
    try {
      const portfolioId = parseInt(req.params.id);
      const userId = ((req as any).user as any)?.id;
      const { projectId } = req.body;
      if (!projectId) return res.status(400).json({ error: "projectId is required" });

      const existing = await db.select().from(projectPortfolioAssignments).where(eq(projectPortfolioAssignments.projectId, projectId));
      if (existing.length > 0) {
        const [existingPortfolio] = await db.select({ name: portfolios.name }).from(portfolios).where(eq(portfolios.id, existing[0].portfolioId));
        return res.status(409).json({
          error: "already_assigned",
          message: `Project is already assigned to portfolio "${existingPortfolio?.name || "Unknown"}"`,
          currentPortfolioId: existing[0].portfolioId,
          currentPortfolioName: existingPortfolio?.name,
        });
      }

      const [assignment] = await db.insert(projectPortfolioAssignments).values({
        projectId,
        portfolioId,
        assignedBy: userId,
      }).returning();

      logAuditFromReq(req, { entityType: "portfolio_assignment", entityId: String(assignment.id), action: "create", changesJson: { description: "Project assigned to portfolio", projectId, portfolioId } });
      res.json(assignment);
    } catch (err: any) {
      console.error("[Portfolio] Assign error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/portfolios/:id/move-project", jwtAuth, requireAuth, requireCooRole, async (req, res) => {
    try {
      const targetPortfolioId = parseInt(req.params.id);
      const userId = ((req as any).user as any)?.id;
      const { projectId } = req.body;
      if (!projectId) return res.status(400).json({ error: "projectId is required" });

      const existing = await db.select().from(projectPortfolioAssignments).where(eq(projectPortfolioAssignments.projectId, projectId));

      if (existing.length > 0) {
        const [updated] = await db.update(projectPortfolioAssignments)
          .set({ portfolioId: targetPortfolioId, movedBy: userId, movedAt: new Date() })
          .where(eq(projectPortfolioAssignments.projectId, projectId))
          .returning();
        logAuditFromReq(req, { entityType: "portfolio_assignment", entityId: String(updated.id), action: "update", changesJson: { description: "Project moved to portfolio", projectId, targetPortfolioId } });
        res.json(updated);
      } else {
        const [assignment] = await db.insert(projectPortfolioAssignments).values({
          projectId,
          portfolioId: targetPortfolioId,
          assignedBy: userId,
        }).returning();
        logAuditFromReq(req, { entityType: "portfolio_assignment", entityId: String(assignment.id), action: "create", changesJson: { description: "Project assigned to portfolio via move", projectId, targetPortfolioId } });
        res.json(assignment);
      }
    } catch (err: any) {
      console.error("[Portfolio] Move error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/portfolios/:id/remove-project/:projectId", jwtAuth, requireAuth, requireManageRole, async (req, res) => {
    try {
      const portfolioId = parseInt(req.params.id);
      const projectId = parseInt(req.params.projectId);
      await db.delete(projectPortfolioAssignments).where(
        and(eq(projectPortfolioAssignments.portfolioId, portfolioId), eq(projectPortfolioAssignments.projectId, projectId))
      );
      logAuditFromReq(req, { entityType: "portfolio_assignment", entityId: String(projectId), action: "delete", changesJson: { description: "Project removed from portfolio", portfolioId, projectId } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Portfolio] Remove project error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/portfolios/:id/rollups", jwtAuth, requireAuth, async (req, res) => {
    try {
      const portfolioId = parseInt(req.params.id);
      const assignments = await db.select().from(projectPortfolioAssignments).where(eq(projectPortfolioAssignments.portfolioId, portfolioId));
      const projectIds = assignments.map(a => a.projectId);

      if (projectIds.length === 0) {
        return res.json({
          finance: { totalPlannedRevenue: 0, totalActualRevenue: 0, totalPlannedExpenses: 0, totalActualExpenses: 0, grossProfit: 0, grossMarginPct: 0 },
          schedule: { avgActualPct: 0, avgExpectedPct: 0, avgDelta: 0, behindCount: 0, onTrackCount: 0, atRiskCount: 0 },
          quality: { totalItems: 0, approvedItems: 0, pendingItems: 0, failedItems: 0 },
          engineering: { totalStages: 0, completedStages: 0, inProgressStages: 0 },
          projects: [],
        });
      }

      const projects = await db.select().from(projectInfo).where(inArray(projectInfo.id, projectIds));
      const projectNames = projects.map(p => p.projectName);

      const { adaptCostToExpense, adaptRevenueToInflow } = await import("./lib/data-merge");
      const rawCosts = await db.select().from(normalizedCostLines).where(inArray(normalizedCostLines.projectName, projectNames));
      const rawRev = await db.select().from(normalizedRevenueLines).where(inArray(normalizedRevenueLines.projectName, projectNames));
      const rawExpenses = rawCosts.map(c => adaptCostToExpense(c, c.projectName));
      const rawInflows = rawRev.map(r => adaptRevenueToInflow(r, r.projectName));
      const allWorkItems = await getAllPMWorkItemsAsProjectPlan();
      const allPlans = allWorkItems.filter((wi: any) => projectNames.includes(wi.projectName));

      const plansByProject = new Map<string, any[]>();
      for (const p of allPlans) {
        if (!plansByProject.has(p.projectName)) plansByProject.set(p.projectName, []);
        plansByProject.get(p.projectName)!.push(p);
      }

      const completionByProject = new Map<string, { actualPct: number; expectedPct: number; delta: number }>();
      for (const pn of projectNames) {
        const projPlans = plansByProject.get(pn) || [];
        completionByProject.set(pn, computeProjectCompletion(projPlans));
      }

      const projectInfoMap = new Map(projects.map(p => [p.projectName, p]));

      const perProjectFinance = new Map<string, { plannedRev: number; actualRev: number; plannedExp: number; actualExp: number; gp: number }>();
      for (const pn of projectNames) {
        const projInflows = rawInflows.filter(r => r.projectName === pn);
        const projExpenses = rawExpenses.filter(e => e.projectName === pn);
        let costedRev = projInflows.reduce((s, r) => s + (parseFloat(String(r.revenueAmount || "0")) || 0), 0);
        if (costedRev === 0) {
          const pInfo = projectInfoMap.get(pn);
          if (pInfo?.contractValue) costedRev = parseFloat(String(pInfo.contractValue)) || 0;
        }
        const actualRev = projInflows.reduce((s, r) => s + (parseFloat(String(r.milestoneAmount || "0")) || 0), 0);
        const costedExp = projExpenses.reduce((s, e) => s + (parseFloat(String(e.budgetTotal || "0")) || 0), 0);
        let actualExp = projExpenses.reduce((s, e) => s + (parseFloat(String(e.expenseActualTotal || "0")) || 0), 0);
        if (actualExp === 0) {
          actualExp = projExpenses.reduce((s, e) => s + (parseFloat(String(e.actualCosTotal || "0")) || 0), 0);
        }
        perProjectFinance.set(pn, { plannedRev: costedRev, actualRev, plannedExp: costedExp, actualExp, gp: actualRev - actualExp });
      }

      let totalPlannedRev = 0, totalActualRev = 0, totalPlannedExp = 0, totalActualExp = 0;
      for (const [, fin] of perProjectFinance) {
        totalPlannedRev += fin.plannedRev;
        totalActualRev += fin.actualRev;
        totalPlannedExp += fin.plannedExp;
        totalActualExp += fin.actualExp;
      }
      const totalGp = totalActualRev - totalActualExp;

      const finance = {
        totalPlannedRevenue: totalPlannedRev,
        totalActualRevenue: totalActualRev,
        totalPlannedExpenses: totalPlannedExp,
        totalActualExpenses: totalActualExp,
        grossProfit: totalGp,
        grossMarginPct: 0,
      };
      if (totalActualRev > 0) {
        finance.grossMarginPct = Math.round((totalGp / totalActualRev) * 10000) / 100;
      }

      const scheduleItems = projectNames.map(pn => completionByProject.get(pn) || { actualPct: 0, expectedPct: 0, delta: 0 });
      const validSchedule = scheduleItems.filter(s => s.actualPct > 0 || s.expectedPct > 0);
      const schedule = {
        avgActualPct: validSchedule.length > 0 ? Math.round(validSchedule.reduce((s, i) => s + i.actualPct, 0) / validSchedule.length * 10) / 10 : 0,
        avgExpectedPct: validSchedule.length > 0 ? Math.round(validSchedule.reduce((s, i) => s + i.expectedPct, 0) / validSchedule.length * 10) / 10 : 0,
        avgDelta: validSchedule.length > 0 ? Math.round(validSchedule.reduce((s, i) => s + i.delta, 0) / validSchedule.length * 10) / 10 : 0,
        behindCount: scheduleItems.filter(i => i.delta < -5).length,
        onTrackCount: scheduleItems.filter(i => i.delta >= -5).length,
        atRiskCount: scheduleItems.filter(i => i.delta < -10).length,
      };

      let qualityData = { totalItems: 0, approvedItems: 0, pendingItems: 0, failedItems: 0 };
      try {
        const checklists = await db.select().from(qcChecklist).where(inArray(qcChecklist.projectName, projectNames));
        const checklistIds = checklists.map(c => c.id);
        if (checklistIds.length > 0) {
          const items = await db.select().from(qcItemInstance).where(inArray(qcItemInstance.checklistId, checklistIds));
          qualityData = {
            totalItems: items.length,
            approvedItems: items.filter(i => i.status === "APPROVED").length,
            pendingItems: items.filter(i => i.status === "PENDING" || i.status === "IN_PROGRESS").length,
            failedItems: items.filter(i => i.status === "FAILED" || i.status === "REJECTED").length,
          };
        }
      } catch (e) {}

      let engData = { totalStages: 0, completedStages: 0, inProgressStages: 0 };
      try {
        const stagesResult = await db.execute(sql`
          SELECT status, COUNT(*)::int as cnt FROM project_eng_stages
          WHERE project_id IN (${sql.join(projectIds.map(id => sql`${id}`), sql`, `)})
          GROUP BY status
        `);
        const rows = stagesResult.rows || [];
        for (const row of rows) {
          const cnt = parseInt(String(row.cnt || "0"));
          engData.totalStages += cnt;
          if (row.status === "complete") engData.completedStages += cnt;
          if (row.status === "in_progress") engData.inProgressStages += cnt;
        }
      } catch (e) {}

      const projectDetails = projects.map(p => {
        const comp = completionByProject.get(p.projectName) || { actualPct: 0, expectedPct: 0, delta: 0 };
        const rawFin = perProjectFinance.get(p.projectName);
        return {
          id: p.id,
          projectName: p.projectName,
          phase: p.phase,
          sizeKwp: p.sizeKwp,
          pm: p.pm,
          pd: p.pd,
          isActive: p.isActive,
          ragStatus: comp.delta < -10 ? "RED" : comp.delta < -5 ? "AMBER" : "GREEN",
          actualPct: comp.actualPct,
          expectedPct: comp.expectedPct,
          delta: comp.delta,
          plannedRevenue: rawFin?.plannedRev || 0,
          actualRevenue: rawFin?.actualRev || 0,
          plannedExpenses: rawFin?.plannedExp || 0,
          actualExpenses: rawFin?.actualExp || 0,
          grossProfit: rawFin?.gp || 0,
        };
      });

      res.json({ finance, schedule, quality: qualityData, engineering: engData, projects: projectDetails });
    } catch (err: any) {
      console.error("[Portfolio] Rollups error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/portfolios/:id/available-projects", jwtAuth, requireAuth, async (req, res) => {
    try {
      const portfolioId = parseInt(req.params.id);
      const allProjects = await db.select({
        id: projectInfo.id,
        projectName: projectInfo.projectName,
        phase: projectInfo.phase,
        sizeKwp: projectInfo.sizeKwp,
        pm: projectInfo.pm,
        isActive: projectInfo.isActive,
      }).from(projectInfo);

      const allAssignments = await db.select().from(projectPortfolioAssignments);
      const assignmentMap = new Map(allAssignments.map(a => [a.projectId, a.portfolioId]));

      const allPortfolios = await db.select({ id: portfolios.id, name: portfolios.name }).from(portfolios);
      const portfolioMap = new Map(allPortfolios.map(p => [p.id, p.name]));

      const result = allProjects.map(p => ({
        ...p,
        assignedPortfolioId: assignmentMap.get(p.id) || null,
        assignedPortfolioName: assignmentMap.has(p.id) ? portfolioMap.get(assignmentMap.get(p.id)!) || null : null,
      }));

      res.json(result);
    } catch (err: any) {
      console.error("[Portfolio] Available projects error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/portfolios/:id/rollout-plans", jwtAuth, requireAuth, requireManageRole, async (req, res) => {
    try {
      const portfolioId = parseInt(req.params.id);
      const userId = ((req as any).user as any)?.id;
      const { name, notes, phases } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Plan name is required" });

      const [plan] = await db.insert(portfolioRolloutPlans).values({
        portfolioId,
        name: name.trim(),
        notes: notes?.trim() || null,
        createdBy: userId,
        updatedBy: userId,
      }).returning();

      if (phases && Array.isArray(phases)) {
        for (let i = 0; i < phases.length; i++) {
          await db.insert(portfolioRolloutPhases).values({
            rolloutPlanId: plan.id,
            phaseName: phases[i].phaseName || `Phase ${i + 1}`,
            startDate: phases[i].startDate || null,
            endDate: phases[i].endDate || null,
            targetKwp: phases[i].targetKwp || null,
            targetRevenue: phases[i].targetRevenue || null,
            sortOrder: i,
          });
        }
      }

      logAuditFromReq(req, { entityType: "portfolio_rollout", entityId: String(plan.id), action: "create", changesJson: { description: "Rollout plan created", name: plan.name, portfolioId } });
      res.json(plan);
    } catch (err: any) {
      console.error("[Portfolio] Create rollout plan error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/portfolios/:portfolioId/rollout-plans/:planId", jwtAuth, requireAuth, requireManageRole, async (req, res) => {
    try {
      const planId = parseInt(req.params.planId);
      const userId = ((req as any).user as any)?.id;
      const { name, notes, phases } = req.body;

      const updates: any = { updatedBy: userId, updatedAt: new Date() };
      if (name !== undefined) updates.name = name.trim();
      if (notes !== undefined) updates.notes = notes?.trim() || null;

      const [updated] = await db.update(portfolioRolloutPlans).set(updates).where(eq(portfolioRolloutPlans.id, planId)).returning();

      if (phases && Array.isArray(phases)) {
        await db.delete(portfolioRolloutPhases).where(eq(portfolioRolloutPhases.rolloutPlanId, planId));
        for (let i = 0; i < phases.length; i++) {
          await db.insert(portfolioRolloutPhases).values({
            rolloutPlanId: planId,
            phaseName: phases[i].phaseName || `Phase ${i + 1}`,
            startDate: phases[i].startDate || null,
            endDate: phases[i].endDate || null,
            targetKwp: phases[i].targetKwp || null,
            targetRevenue: phases[i].targetRevenue || null,
            sortOrder: i,
          });
        }
      }

      logAuditFromReq(req, { entityType: "portfolio_rollout", entityId: String(planId), action: "update", changesJson: { description: "Rollout plan updated", name: updated?.name } });
      res.json(updated);
    } catch (err: any) {
      console.error("[Portfolio] Update rollout plan error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/portfolios/:portfolioId/rollout-plans/:planId", jwtAuth, requireAuth, requireManageRole, async (req, res) => {
    try {
      const planId = parseInt(req.params.planId);
      await db.delete(portfolioRolloutPlans).where(eq(portfolioRolloutPlans.id, planId));
      logAuditFromReq(req, { entityType: "portfolio_rollout", entityId: String(planId), action: "delete", changesJson: { description: "Rollout plan deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Portfolio] Delete rollout plan error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/portfolio-dashboard", jwtAuth, requireAuth, async (req, res) => {
    try {
      const viewMode = (req.query.view as string) || "management";

      const allPortfolios = await db.select().from(portfolios).orderBy(desc(portfolios.createdAt));
      const assignments = await db.select().from(projectPortfolioAssignments);
      const allProjects = await db.select().from(projectInfo);

      const ownerIds = allPortfolios.map(p => p.ownerUserId).filter(Boolean) as number[];
      const allUsers = ownerIds.length > 0 ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ownerIds)) : [];
      const userMap = new Map(allUsers.map(u => [u.id, u.name]));

      const projectMap = new Map(allProjects.map(p => [p.id, p]));

      const { adaptCostToExpense, adaptRevenueToInflow, createNameResolver } = await import("./lib/data-merge");
      const [allCosts, allRev, piNames] = await Promise.all([
        db.select().from(normalizedCostLines),
        db.select().from(normalizedRevenueLines),
        db.select({ projectName: projectInfo.projectName }).from(projectInfo),
      ]);
      const resolve = createNameResolver(piNames.map(p => p.projectName));
      const allExpenses = allCosts.map(c => adaptCostToExpense(c, resolve(c.projectName)));
      const allInflows = allRev.map(r => adaptRevenueToInflow(r, resolve(r.projectName)));
      const allPlanTasks = await getAllPMWorkItemsAsProjectPlan();

      const expenseByProject = new Map<string, any[]>();
      const inflowByProject = new Map<string, any[]>();
      const plansByProject = new Map<string, any[]>();
      for (const e of allExpenses) {
        if (!expenseByProject.has(e.projectName)) expenseByProject.set(e.projectName, []);
        expenseByProject.get(e.projectName)!.push(e);
      }
      for (const r of allInflows) {
        if (!inflowByProject.has(r.projectName)) inflowByProject.set(r.projectName, []);
        inflowByProject.get(r.projectName)!.push(r);
      }
      for (const p of allPlanTasks) {
        if (!plansByProject.has(p.projectName)) plansByProject.set(p.projectName, []);
        plansByProject.get(p.projectName)!.push(p);
      }

      const completionCache = new Map<string, { actualPct: number; expectedPct: number; delta: number }>();
      for (const [pn, plans] of plansByProject.entries()) {
        completionCache.set(pn, computeProjectCompletion(plans));
      }

      let engStageRows: any[] = [];
      let qualityRows: any[] = [];
      try {
        const engResult = await db.execute(sql`SELECT project_id, status FROM project_eng_stages`);
        engStageRows = engResult.rows || [];
      } catch (e) {}
      try {
        const allChecklists = await db.select().from(qcChecklist);
        const checklistIds = allChecklists.map(c => c.id);
        if (checklistIds.length > 0) {
          const items = await db.select().from(qcItemInstance).where(inArray(qcItemInstance.checklistId, checklistIds));
          const checklistProjectMap = new Map(allChecklists.map(c => [c.id, c.projectName]));
          qualityRows = items.map(item => ({ ...item, projectName: checklistProjectMap.get(item.checklistId) || "" }));
        }
      } catch (e) {}

      const result = allPortfolios.map(portfolio => {
        const portfolioAssignments = assignments.filter(a => a.portfolioId === portfolio.id);
        const portfolioProjects = portfolioAssignments.map(a => projectMap.get(a.projectId)).filter(Boolean) as any[];
        const portfolioProjectIds = portfolioProjects.map(p => p.id);
        const portfolioProjectNames = portfolioProjects.map(p => p.projectName);

        const totalKwp = portfolioProjects.reduce((s, p) => s + (parseFloat(String(p.sizeKwp || "0")) || 0), 0);

        const projectCompletions = portfolioProjects.map(p => completionCache.get(p.projectName) || { actualPct: 0, expectedPct: 0, delta: 0 });
        const validCompletions = projectCompletions.filter(c => c.actualPct > 0 || c.expectedPct > 0);
        const scheduleDeltas = projectCompletions.map(c => c.delta);
        const hasBehind = scheduleDeltas.some(d => d < -5);
        const hasAtRisk = scheduleDeltas.some(d => d < -10);

        let overallHealth: string = "On Track";
        if (hasAtRisk) overallHealth = "At Risk";
        else if (hasBehind) overallHealth = "Behind";

        const projectFinanceBreakdown = portfolioProjects.map(proj => {
          const expenses = expenseByProject.get(proj.projectName) || [];
          const inflows = inflowByProject.get(proj.projectName) || [];
          let costedRev = inflows.reduce((s: number, r: any) => s + (parseFloat(String(r.revenueAmount || "0")) || 0), 0);
          if (costedRev === 0 && proj.contractValue) {
            costedRev = parseFloat(String(proj.contractValue)) || 0;
          }
          const actualRev = inflows.reduce((s: number, r: any) => s + (parseFloat(String(r.milestoneAmount || "0")) || 0), 0);
          const costedExp = expenses.reduce((s: number, e: any) => s + (parseFloat(String(e.budgetTotal || "0")) || 0), 0);
          let actualExp = expenses.reduce((s: number, e: any) => s + (parseFloat(String(e.expenseActualTotal || "0")) || 0), 0);
          if (actualExp === 0) {
            actualExp = expenses.reduce((s: number, e: any) => s + (parseFloat(String(e.actualCosTotal || "0")) || 0), 0);
          }
          const gp = actualRev - actualExp;
          return {
            projectName: proj.projectName,
            costedRevenue: Math.round(costedRev),
            actualRevenue: Math.round(actualRev),
            costedExpenses: Math.round(costedExp),
            actualExpenses: Math.round(actualExp),
            grossProfit: Math.round(gp),
            gpMarginPct: actualRev > 0 ? Math.round((gp / actualRev) * 10000) / 100 : 0,
          };
        });

        const financeRollup = {
          costedRevenue: projectFinanceBreakdown.reduce((s, p) => s + p.costedRevenue, 0),
          actualRevenue: projectFinanceBreakdown.reduce((s, p) => s + p.actualRevenue, 0),
          costedExpenses: projectFinanceBreakdown.reduce((s, p) => s + p.costedExpenses, 0),
          actualExpenses: projectFinanceBreakdown.reduce((s, p) => s + p.actualExpenses, 0),
          grossProfit: projectFinanceBreakdown.reduce((s, p) => s + p.grossProfit, 0),
          totalPlannedRevenue: projectFinanceBreakdown.reduce((s, p) => s + p.costedRevenue, 0),
          revenueRealised: projectFinanceBreakdown.reduce((s, p) => s + p.actualRevenue, 0),
          totalPlannedExpenses: projectFinanceBreakdown.reduce((s, p) => s + p.costedExpenses, 0),
          cosRealised: projectFinanceBreakdown.reduce((s, p) => s + p.actualExpenses, 0),
        };

        const phaseCounts: Record<string, number> = {};
        for (const p of portfolioProjects) {
          const ph = p.phase || "Unknown";
          phaseCounts[ph] = (phaseCounts[ph] || 0) + 1;
        }

        const projectSchedule = portfolioProjects.map(p => {
          const comp = completionCache.get(p.projectName) || { actualPct: 0, expectedPct: 0, delta: 0 };
          return {
            projectName: p.projectName,
            actualPct: comp.actualPct,
            expectedPct: comp.expectedPct,
            delta: comp.delta,
            phase: p.phase || null,
          };
        });

        const portEngStages = engStageRows.filter((r: any) => portfolioProjectIds.includes(r.project_id));
        const engSummary = {
          total: portEngStages.length,
          complete: portEngStages.filter((r: any) => r.status === "complete").length,
          inProgress: portEngStages.filter((r: any) => r.status === "in_progress").length,
          notStarted: portEngStages.filter((r: any) => r.status === "not_started" || !r.status).length,
        };

        const portQuality = qualityRows.filter((r: any) => portfolioProjectNames.includes(r.projectName));
        const qualitySummary = {
          total: portQuality.length,
          approved: portQuality.filter((r: any) => r.status === "APPROVED").length,
          pending: portQuality.filter((r: any) => r.status === "PENDING" || r.status === "IN_PROGRESS").length,
          failed: portQuality.filter((r: any) => r.status === "FAILED" || r.status === "REJECTED").length,
        };

        return {
          id: portfolio.id,
          name: portfolio.name,
          clientName: portfolio.clientName,
          status: portfolio.status,
          ownerName: portfolio.ownerUserId ? userMap.get(portfolio.ownerUserId) || null : null,
          projectCount: portfolioProjects.length,
          totalKwp: Math.round(totalKwp * 100) / 100,
          overallHealth,
          behindCount: scheduleDeltas.filter(d => d < -5).length,
          avgActualPct: validCompletions.length > 0 ? Math.round(validCompletions.reduce((s, c) => s + c.actualPct, 0) / validCompletions.length * 10) / 10 : 0,
          avgExpectedPct: validCompletions.length > 0 ? Math.round(validCompletions.reduce((s, c) => s + c.expectedPct, 0) / validCompletions.length * 10) / 10 : 0,
          finance: financeRollup,
          projectFinanceBreakdown,
          phaseCounts,
          projectSchedule,
          engSummary,
          qualitySummary,
        };
      });

      const unassignedCount = allProjects.filter(p => !assignments.some(a => a.projectId === p.id)).length;

      res.json({ portfolios: result, unassignedProjectCount: unassignedCount, totalPortfolios: allPortfolios.length });
    } catch (err: any) {
      console.error("[Portfolio] Dashboard error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/portfolios/:id/timeline", jwtAuth, requireAuth, async (req, res) => {
    try {
      const portfolioId = parseInt(req.params.id);
      const assignments = await db.select().from(projectPortfolioAssignments).where(eq(projectPortfolioAssignments.portfolioId, portfolioId));
      const projectIds = assignments.map(a => a.projectId);

      if (projectIds.length === 0) return res.json([]);

      const projects = await db.select().from(projectInfo).where(inArray(projectInfo.id, projectIds));
      const projectNames = projects.map(p => p.projectName);

      const allWiPlans = await getAllPMWorkItemsAsProjectPlan();
      const plans = allWiPlans.filter((wi: any) => projectNames.includes(wi.projectName));

      const plansByProject = new Map<string, any[]>();
      for (const p of plans) {
        if (!plansByProject.has(p.projectName)) plansByProject.set(p.projectName, []);
        plansByProject.get(p.projectName)!.push(p);
      }

      const timeline: any[] = [];

      for (const proj of projects) {
        const projPlans = plansByProject.get(proj.projectName) || [];

        let startDate: string | null = null;
        let endDate: string | null = null;
        let commDate: string | null = null;
        let constructionStartDate: string | null = null;

        for (const task of projPlans) {
          const title = (task.title || task.highLevelProgramme || "").toLowerCase();
          const taskStart = task.actualStart;
          const taskEnd = task.actualEnd;

          if (title.includes("site establishment") && taskStart) {
            if (!startDate || taskStart < startDate) startDate = taskStart;
          }
          if (title.includes("handover to client") && taskEnd) {
            if (!endDate || taskEnd > endDate) endDate = taskEnd;
          }
          if (title.includes("commissioning") && taskEnd) {
            commDate = taskEnd;
            if (!endDate || taskEnd > endDate) endDate = taskEnd;
          }
          if (title.includes("construction") && taskStart) {
            constructionStartDate = taskStart;
          }
          if (taskStart && (!startDate || taskStart < startDate)) startDate = taskStart;
          if (taskEnd && (!endDate || taskEnd > endDate)) endDate = taskEnd;
        }

        if (!startDate) startDate = (proj as any).constructionStartDate || null;
        if (!endDate) endDate = (proj as any).clientHandoverDate || (proj as any).commissioningDate || null;
        if (!commDate) commDate = (proj as any).commissioningDate || null;
        if (!startDate) continue;

        const comp = computeProjectCompletion(projPlans);

        timeline.push({
          projectName: proj.projectName,
          startDate,
          endDate: endDate && endDate >= startDate ? endDate : startDate,
          phase: proj.phase || null,
          actualPct: comp.actualPct,
          expectedPct: comp.expectedPct,
          delta: comp.delta,
          pm: proj.pm || null,
          sizeKwp: proj.sizeKwp ?? null,
          commissioningDate: commDate && commDate >= '1950-01-01' ? commDate : null,
          constructionStartDate: constructionStartDate,
        });
      }

      timeline.sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
      res.json(timeline);
    } catch (err: any) {
      console.error("[Portfolio] Timeline error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/portfolios/:id/key-dates", jwtAuth, requireAuth, async (req, res) => {
    try {
      const portfolioId = parseInt(req.params.id);
      const assignments = await db.select().from(projectPortfolioAssignments).where(eq(projectPortfolioAssignments.portfolioId, portfolioId));
      const projectIds = assignments.map(a => a.projectId);

      if (projectIds.length === 0) return res.json([]);

      const projects = await db.select().from(projectInfo).where(inArray(projectInfo.id, projectIds));
      const projectNames = projects.map(p => p.projectName);

      const allWiForKeyDates = await getAllPMWorkItemsAsProjectPlan();
      const plansForKeyDates = allWiForKeyDates.filter((wi: any) => projectNames.includes(wi.projectName));

      const plansByProject = new Map<string, any[]>();
      for (const p of plansForKeyDates) {
        if (!plansByProject.has(p.projectName)) plansByProject.set(p.projectName, []);
        plansByProject.get(p.projectName)!.push(p);
      }

      const autoMappings = [
        { keyDateName: "PD Handover", patterns: ['bd handover', 'project charter handover'], dateField: 'actualEnd' as const, sortOrder: 1 },
        { keyDateName: "Construction Start", patterns: ['site establishment'], dateField: 'actualStart' as const, sortOrder: 2 },
        { keyDateName: "Commissioning", patterns: ['commissioning'], dateField: 'actualEnd' as const, sortOrder: 3 },
        { keyDateName: "Practical Completion", patterns: ['practical completion'], dateField: 'actualEnd' as const, sortOrder: 4 },
        { keyDateName: "O&M Handover", patterns: ['handover to matriarch'], dateField: 'actualEnd' as const, sortOrder: 5 },
        { keyDateName: "Client Handover", patterns: ['handover to client'], dateField: 'actualEnd' as const, sortOrder: 6 },
      ];

      const result = projects.map(proj => {
        const projPlans = plansByProject.get(proj.projectName) || [];

        const comp = computeProjectCompletion(projPlans);

        const keyDates = autoMappings.map(mapping => {
          let matchedTask: any = null;
          let effectiveDate: string | null = null;

          for (const task of projPlans) {
            const desc = (task.highLevelProgramme || task.title || '').toLowerCase();
            const matches = mapping.patterns.some(p => desc.includes(p));
            if (matches) {
              const dateVal = mapping.dateField === 'actualStart' ? (task.actualStart || task.baselineStart) : (task.actualEnd || task.baselineEnd);
              if (dateVal && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
                const dateStr = dateVal.substring(0, 10);
                if (mapping.dateField === 'actualStart') {
                  if (!effectiveDate || dateStr < effectiveDate) {
                    effectiveDate = dateStr;
                    matchedTask = task;
                  }
                } else {
                  if (!effectiveDate || dateStr > effectiveDate) {
                    effectiveDate = dateStr;
                    matchedTask = task;
                  }
                }
              }
            }
          }

          const plannedStart = matchedTask?.baselineStart?.substring(0, 10) || null;
          const plannedEnd = matchedTask?.baselineEnd?.substring(0, 10) || null;
          const plannedDate = mapping.dateField === 'actualStart' ? plannedStart : plannedEnd;

          return {
            keyDateName: mapping.keyDateName,
            sortOrder: mapping.sortOrder,
            plannedDate,
            effectiveDate,
            linked: !!matchedTask,
          };
        });

        let projectStart: string | null = null;
        let projectEnd: string | null = null;
        for (const task of projPlans) {
          const ts = task.actualStart || task.baselineStart;
          const te = task.actualEnd || task.baselineEnd;
          if (ts && (!projectStart || ts < projectStart)) projectStart = ts?.substring(0, 10);
          if (te && (!projectEnd || te > projectEnd)) projectEnd = te?.substring(0, 10);
        }
        if (!projectStart) projectStart = (proj as any).constructionStartDate || null;
        if (!projectEnd) projectEnd = (proj as any).clientHandoverDate || (proj as any).commissioningDate || null;

        return {
          projectId: proj.id,
          projectName: proj.projectName,
          phase: proj.phase || null,
          pm: proj.pm || null,
          sizeKwp: proj.sizeKwp ?? null,
          actualPct: comp.actualPct,
          expectedPct: comp.expectedPct,
          delta: comp.delta,
          projectStart: projectStart?.substring(0, 10) || null,
          projectEnd: projectEnd?.substring(0, 10) || null,
          keyDates,
        };
      });

      result.sort((a, b) => (a.projectStart || 'z').localeCompare(b.projectStart || 'z'));
      res.json(result);
    } catch (err: any) {
      console.error("[Portfolio] Key dates error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}
