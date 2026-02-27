import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, sql, and, inArray, desc } from "drizzle-orm";
import { verifyToken } from "./jwt";
import {
  portfolios, portfolioRolloutPlans, portfolioRolloutPhases,
  projectPortfolioAssignments, projectInfo, derivedProjectKpis, users,
  qcChecklist, qcItemInstance, programExpense, programInflows, projectPlan,
} from "@shared/schema";

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
        res.json(updated);
      } else {
        const [assignment] = await db.insert(projectPortfolioAssignments).values({
          projectId,
          portfolioId: targetPortfolioId,
          assignedBy: userId,
        }).returning();
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

      let kpis: any[] = [];
      if (projectNames.length > 0) {
        kpis = await db.select().from(derivedProjectKpis).where(inArray(derivedProjectKpis.projectName, projectNames));
      }

      let kpiPlannedRev = kpis.reduce((s, k) => s + (parseFloat(k.totalPlannedRevenue || "0") || 0), 0);
      let kpiPlannedExp = kpis.reduce((s, k) => s + (parseFloat(k.totalPlannedExpenses || "0") || 0), 0);
      let kpiActualRev = kpis.reduce((s, k) => s + (parseFloat(k.revenueRealised || "0") || 0), 0);
      let kpiActualExp = kpis.reduce((s, k) => s + (parseFloat(k.cosRealised || "0") || 0), 0);
      let kpiGP = kpis.reduce((s, k) => s + (parseFloat(k.grossProfit || "0") || 0), 0);

      const rawExpenses = await db.select().from(programExpense).where(inArray(programExpense.projectName, projectNames));
      const rawInflows = await db.select().from(programInflows).where(inArray(programInflows.projectName, projectNames));

      const rawPlannedRev = rawInflows.reduce((s, r) => s + (parseFloat(String(r.revenueAmount || "0")) || 0), 0);
      const rawPlannedExp = rawExpenses.reduce((s, e) => s + (parseFloat(String(e.budgetTotal || "0")) || 0), 0);
      const rawActualExp = rawExpenses.reduce((s, e) => s + (parseFloat(String(e.actualCosTotal || "0")) || 0), 0);

      const perProjectFinance = new Map<string, { plannedRev: number; actualRev: number; plannedExp: number; actualExp: number; gp: number }>();
      for (const pn of projectNames) {
        const projInflows = rawInflows.filter(r => r.projectName === pn);
        const projExpenses = rawExpenses.filter(e => e.projectName === pn);
        const kpi = kpis.find(k => k.projectName === pn);
        const pRev = projInflows.reduce((s, r) => s + (parseFloat(String(r.revenueAmount || "0")) || 0), 0);
        const pExp = projExpenses.reduce((s, e) => s + (parseFloat(String(e.budgetTotal || "0")) || 0), 0);
        const aRev = kpi ? (parseFloat(kpi.revenueRealised || "0") || 0) : projInflows.reduce((s, r) => s + (parseFloat(String(r.revenueAmount || "0")) || 0), 0);
        const aExp = projExpenses.reduce((s, e) => s + (parseFloat(String(e.actualCosTotal || "0")) || 0), 0);
        perProjectFinance.set(pn, { plannedRev: pRev || (kpi ? parseFloat(kpi.totalPlannedRevenue || "0") || 0 : 0), actualRev: aRev, plannedExp: pExp || (kpi ? parseFloat(kpi.totalPlannedExpenses || "0") || 0 : 0), actualExp: aExp || (kpi ? parseFloat(kpi.cosRealised || "0") || 0 : 0), gp: aRev - aExp });
      }

      const finance = {
        totalPlannedRevenue: kpiPlannedRev > 0 ? kpiPlannedRev : rawPlannedRev,
        totalActualRevenue: kpiActualRev > 0 ? kpiActualRev : rawPlannedRev,
        totalPlannedExpenses: kpiPlannedExp > 0 ? kpiPlannedExp : rawPlannedExp,
        totalActualExpenses: kpiActualExp > 0 ? kpiActualExp : rawActualExp,
        grossProfit: kpiGP !== 0 ? kpiGP : ((kpiActualRev > 0 ? kpiActualRev : rawPlannedRev) - (kpiActualExp > 0 ? kpiActualExp : rawActualExp)),
        grossMarginPct: 0,
      };
      const effectiveRev = finance.totalActualRevenue || finance.totalPlannedRevenue;
      if (effectiveRev > 0) {
        finance.grossMarginPct = Math.round((finance.grossProfit / effectiveRev) * 10000) / 100;
      }

      const scheduleItems = kpis.map(k => ({
        actualPct: parseFloat(k.avgActualPctComplete || "0") || 0,
        expectedPct: parseFloat(k.avgExpectedPctComplete || "0") || 0,
        delta: parseFloat(k.scheduleDelta || "0") || 0,
      }));
      const schedule = {
        avgActualPct: scheduleItems.length > 0 ? Math.round(scheduleItems.reduce((s, i) => s + i.actualPct, 0) / scheduleItems.length * 10) / 10 : 0,
        avgExpectedPct: scheduleItems.length > 0 ? Math.round(scheduleItems.reduce((s, i) => s + i.expectedPct, 0) / scheduleItems.length * 10) / 10 : 0,
        avgDelta: scheduleItems.length > 0 ? Math.round(scheduleItems.reduce((s, i) => s + i.delta, 0) / scheduleItems.length * 10) / 10 : 0,
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
        const kpi = kpis.find(k => k.projectName === p.projectName);
        const rawFin = perProjectFinance.get(p.projectName);
        return {
          id: p.id,
          projectName: p.projectName,
          phase: p.phase,
          sizeKwp: p.sizeKwp,
          pm: p.pm,
          pd: p.pd,
          isActive: p.isActive,
          ragStatus: kpi?.ragStatus || null,
          actualPct: kpi ? parseFloat(kpi.avgActualPctComplete || "0") || 0 : 0,
          expectedPct: kpi ? parseFloat(kpi.avgExpectedPctComplete || "0") || 0 : 0,
          delta: kpi ? parseFloat(kpi.scheduleDelta || "0") || 0 : 0,
          plannedRevenue: rawFin?.plannedRev || (kpi ? parseFloat(kpi.totalPlannedRevenue || "0") || 0 : 0),
          actualRevenue: rawFin?.actualRev || (kpi ? parseFloat(kpi.revenueRealised || "0") || 0 : 0),
          plannedExpenses: rawFin?.plannedExp || (kpi ? parseFloat(kpi.totalPlannedExpenses || "0") || 0 : 0),
          actualExpenses: rawFin?.actualExp || (kpi ? parseFloat(kpi.cosRealised || "0") || 0 : 0),
          grossProfit: rawFin?.gp ?? (kpi ? parseFloat(kpi.grossProfit || "0") || 0 : 0),
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
      const kpis = await db.select().from(derivedProjectKpis);

      const ownerIds = allPortfolios.map(p => p.ownerUserId).filter(Boolean) as number[];
      const allUsers = ownerIds.length > 0 ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ownerIds)) : [];
      const userMap = new Map(allUsers.map(u => [u.id, u.name]));

      const projectMap = new Map(allProjects.map(p => [p.id, p]));
      const kpiMap = new Map(kpis.map(k => [k.projectName, k]));

      const allExpenses = await db.select().from(programExpense);
      const allInflows = await db.select().from(programInflows);
      const expenseByProject = new Map<string, any[]>();
      const inflowByProject = new Map<string, any[]>();
      for (const e of allExpenses) {
        if (!expenseByProject.has(e.projectName)) expenseByProject.set(e.projectName, []);
        expenseByProject.get(e.projectName)!.push(e);
      }
      for (const r of allInflows) {
        if (!inflowByProject.has(r.projectName)) inflowByProject.set(r.projectName, []);
        inflowByProject.get(r.projectName)!.push(r);
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
        const portfolioKpis = portfolioProjects.map(p => kpiMap.get(p.projectName)).filter(Boolean) as any[];
        const portfolioProjectIds = portfolioProjects.map(p => p.id);
        const portfolioProjectNames = portfolioProjects.map(p => p.projectName);

        const totalKwp = portfolioProjects.reduce((s, p) => s + (parseFloat(String(p.sizeKwp || "0")) || 0), 0);

        const scheduleDeltas = portfolioKpis.map(k => parseFloat(k.scheduleDelta || "0") || 0);
        const hasBehind = scheduleDeltas.some(d => d < -5);
        const hasAtRisk = scheduleDeltas.some(d => d < -10);

        let overallHealth: string = "On Track";
        if (hasAtRisk) overallHealth = "At Risk";
        else if (hasBehind) overallHealth = "Behind";

        const projectFinanceBreakdown = portfolioProjects.map(proj => {
          const kpi = kpiMap.get(proj.projectName);
          const expenses = expenseByProject.get(proj.projectName) || [];
          const inflows = inflowByProject.get(proj.projectName) || [];
          const costedRev = inflows.reduce((s: number, r: any) => s + (parseFloat(String(r.revenueAmount || "0")) || 0), 0) || (kpi ? parseFloat(kpi.totalPlannedRevenue || "0") || 0 : 0);
          const actualRev = kpi ? (parseFloat(kpi.revenueRealised || "0") || 0) : 0;
          const costedExp = expenses.reduce((s: number, e: any) => s + (parseFloat(String(e.budgetTotal || "0")) || 0), 0) || (kpi ? parseFloat(kpi.totalPlannedExpenses || "0") || 0 : 0);
          const actualExp = expenses.reduce((s: number, e: any) => s + (parseFloat(String(e.actualCosTotal || "0")) || 0), 0) || (kpi ? parseFloat(kpi.cosRealised || "0") || 0 : 0);
          return {
            projectName: proj.projectName,
            costedRevenue: Math.round(costedRev),
            actualRevenue: Math.round(actualRev),
            costedExpenses: Math.round(costedExp),
            actualExpenses: Math.round(actualExp),
            grossProfit: Math.round(actualRev - actualExp),
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
          const kpi = kpiMap.get(p.projectName);
          return {
            projectName: p.projectName,
            actualPct: kpi ? parseFloat(kpi.avgActualPctComplete || "0") || 0 : 0,
            expectedPct: kpi ? parseFloat(kpi.avgExpectedPctComplete || "0") || 0 : 0,
            delta: kpi ? parseFloat(kpi.scheduleDelta || "0") || 0 : 0,
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
          avgActualPct: portfolioKpis.length > 0 ? Math.round(portfolioKpis.reduce((s, k) => s + (parseFloat(k.avgActualPctComplete || "0") || 0), 0) / portfolioKpis.length * 10) / 10 : 0,
          avgExpectedPct: portfolioKpis.length > 0 ? Math.round(portfolioKpis.reduce((s, k) => s + (parseFloat(k.avgExpectedPctComplete || "0") || 0), 0) / portfolioKpis.length * 10) / 10 : 0,
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

      const plans = projectNames.length > 0
        ? await db.select().from(projectPlan).where(inArray(projectPlan.projectName, projectNames))
        : [];

      const kpis = projectNames.length > 0
        ? await db.select().from(derivedProjectKpis).where(inArray(derivedProjectKpis.projectName, projectNames))
        : [];
      const kpiMap = new Map(kpis.map(k => [k.projectName, k]));

      const plansByProject = new Map<string, any[]>();
      for (const p of plans) {
        if (!plansByProject.has(p.projectName)) plansByProject.set(p.projectName, []);
        plansByProject.get(p.projectName)!.push(p);
      }

      const timeline: any[] = [];

      for (const proj of projects) {
        const projPlans = plansByProject.get(proj.projectName) || [];
        const kpi = kpiMap.get(proj.projectName);

        let startDate: string | null = null;
        let endDate: string | null = null;
        let commDate: string | null = null;
        let constructionStartDate: string | null = null;

        for (const task of projPlans) {
          const title = (task.title || "").toLowerCase();
          const taskStart = task.actualStart || task.baselineStart;
          const taskEnd = task.actualEnd || task.baselineEnd;

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

        const actualPct = kpi ? parseFloat(kpi.avgActualPctComplete || "0") || 0 : 0;
        const expectedPct = kpi ? parseFloat(kpi.avgExpectedPctComplete || "0") || 0 : 0;

        timeline.push({
          projectName: proj.projectName,
          startDate,
          endDate: endDate && endDate >= startDate ? endDate : startDate,
          phase: proj.phase || null,
          actualPct: Math.round(actualPct * 10) / 10,
          expectedPct: Math.round(expectedPct * 10) / 10,
          delta: Math.round((actualPct - expectedPct) * 10) / 10,
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
}
