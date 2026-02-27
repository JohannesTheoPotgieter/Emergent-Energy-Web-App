import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, sql, and, inArray, desc } from "drizzle-orm";
import { verifyToken } from "./jwt";
import {
  portfolios, portfolioRolloutPlans, portfolioRolloutPhases,
  projectPortfolioAssignments, projectInfo, derivedProjectKpis, users,
  qcChecklist, qcItemInstance,
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

      const finance = {
        totalPlannedRevenue: kpis.reduce((s, k) => s + (parseFloat(k.totalPlannedRevenue || "0") || 0), 0),
        totalActualRevenue: kpis.reduce((s, k) => s + (parseFloat(k.revenueRealised || "0") || 0), 0),
        totalPlannedExpenses: kpis.reduce((s, k) => s + (parseFloat(k.totalPlannedExpenses || "0") || 0), 0),
        totalActualExpenses: kpis.reduce((s, k) => s + (parseFloat(k.cosRealised || "0") || 0), 0),
        grossProfit: kpis.reduce((s, k) => s + (parseFloat(k.grossProfit || "0") || 0), 0),
        grossMarginPct: 0,
      };
      if (finance.totalActualRevenue > 0) {
        finance.grossMarginPct = Math.round((finance.grossProfit / finance.totalActualRevenue) * 10000) / 100;
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
          plannedRevenue: kpi ? parseFloat(kpi.totalPlannedRevenue || "0") || 0 : 0,
          actualRevenue: kpi ? parseFloat(kpi.revenueRealised || "0") || 0 : 0,
          plannedExpenses: kpi ? parseFloat(kpi.totalPlannedExpenses || "0") || 0 : 0,
          actualExpenses: kpi ? parseFloat(kpi.cosRealised || "0") || 0 : 0,
          grossProfit: kpi ? parseFloat(kpi.grossProfit || "0") || 0 : 0,
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

      const result = allPortfolios.map(portfolio => {
        const portfolioAssignments = assignments.filter(a => a.portfolioId === portfolio.id);
        const portfolioProjects = portfolioAssignments.map(a => projectMap.get(a.projectId)).filter(Boolean) as any[];
        const portfolioKpis = portfolioProjects.map(p => kpiMap.get(p.projectName)).filter(Boolean) as any[];

        const totalKwp = portfolioProjects.reduce((s, p) => s + (parseFloat(String(p.sizeKwp || "0")) || 0), 0);

        const scheduleDeltas = portfolioKpis.map(k => parseFloat(k.scheduleDelta || "0") || 0);
        const hasBehind = scheduleDeltas.some(d => d < -5);
        const hasAtRisk = scheduleDeltas.some(d => d < -10);

        let overallHealth: string = "On Track";
        if (hasAtRisk) overallHealth = "At Risk";
        else if (hasBehind) overallHealth = "Behind";

        const financeRollup = {
          totalPlannedRevenue: portfolioKpis.reduce((s, k) => s + (parseFloat(k.totalPlannedRevenue || "0") || 0), 0),
          revenueRealised: portfolioKpis.reduce((s, k) => s + (parseFloat(k.revenueRealised || "0") || 0), 0),
          totalPlannedExpenses: portfolioKpis.reduce((s, k) => s + (parseFloat(k.totalPlannedExpenses || "0") || 0), 0),
          cosRealised: portfolioKpis.reduce((s, k) => s + (parseFloat(k.cosRealised || "0") || 0), 0),
          grossProfit: portfolioKpis.reduce((s, k) => s + (parseFloat(k.grossProfit || "0") || 0), 0),
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
        };
      });

      const unassignedCount = allProjects.filter(p => !assignments.some(a => a.projectId === p.id)).length;

      res.json({ portfolios: result, unassignedProjectCount: unassignedCount, totalPortfolios: allPortfolios.length });
    } catch (err: any) {
      console.error("[Portfolio] Dashboard error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}
