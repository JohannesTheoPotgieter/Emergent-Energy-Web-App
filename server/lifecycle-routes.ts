import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, sql, inArray } from "drizzle-orm";
import { verifyToken } from "./jwt";
import { projectInfo, operationalTasks, projectPlan } from "@shared/schema";

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
      }).from(projectInfo);

      const allEngTasks = await db.select({
        projectName: operationalTasks.projectName,
        status: operationalTasks.status,
      }).from(operationalTasks);

      const allPlanTasks = await db.select({
        projectName: projectPlan.projectName,
        actualPctComplete: projectPlan.actualPctComplete,
      }).from(projectPlan);

      const DONE_STATUSES = ["DONE", "QC APPROVED", "COMPLETED"];

      const engByNorm = new Map<string, { total: number; done: number; rawName: string }>();
      for (const t of allEngTasks) {
        const name = t.projectName;
        if (!name) continue;
        const norm = normalizeName(name);
        if (!engByNorm.has(norm)) engByNorm.set(norm, { total: 0, done: 0, rawName: name });
        const entry = engByNorm.get(norm)!;
        entry.total++;
        if (t.status && DONE_STATUSES.includes(t.status.toUpperCase())) {
          entry.done++;
        }
      }

      const planByNorm = new Map<string, { total: number; sumPct: number; count: number }>();
      for (const p of allPlanTasks) {
        const name = p.projectName;
        if (!name) continue;
        const norm = normalizeName(name);
        if (!planByNorm.has(norm)) planByNorm.set(norm, { total: 0, sumPct: 0, count: 0 });
        const entry = planByNorm.get(norm)!;
        entry.total++;
        if (p.actualPctComplete != null) {
          entry.sumPct += Number(p.actualPctComplete);
          entry.count++;
        }
      }

      const projectNormNames = new Set<string>();
      const results: any[] = [];

      for (const proj of allProjects) {
        const norm = normalizeName(proj.projectName);
        projectNormNames.add(norm);

        const eng = engByNorm.get(norm) || { total: 0, done: 0, rawName: "" };
        const plan = planByNorm.get(norm) || { total: 0, sumPct: 0, count: 0 };

        let source: "excel" | "engineering" | "both" = "excel";
        if (eng.total > 0) source = "both";

        const projectPctComplete = plan.count > 0 ? plan.sumPct / plan.count : null;

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
          source,
          engTotal: eng.total,
          engDone: eng.done,
          planTotal: plan.total,
          planAvgPct: plan.total > 0 ? Math.round((plan.sumPct / plan.total) * 100) / 100 : 0,
          projectPctComplete,
        });
      }

      const engNormKeys = Array.from(engByNorm.keys());
      for (const norm of engNormKeys) {
        if (projectNormNames.has(norm)) continue;

        const eng = engByNorm.get(norm)!;
        const plan = planByNorm.get(norm) || { total: 0, sumPct: 0, count: 0 };
        const projectPctComplete = plan.count > 0 ? plan.sumPct / plan.count : null;

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
          planTotal: plan.total,
          planAvgPct: plan.total > 0 ? Math.round((plan.sumPct / plan.total) * 100) / 100 : 0,
          projectPctComplete,
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
      const { sourceProjectId, targetProjectId } = req.body;
      if (!sourceProjectId || !targetProjectId) {
        return res.status(400).json({ error: "sourceProjectId and targetProjectId are required" });
      }
      if (sourceProjectId === targetProjectId) {
        return res.status(400).json({ error: "Cannot merge a project with itself" });
      }

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

        await tx.delete(projectInfo).where(eq(projectInfo.id, sourceProjectId));

        return {
          merged: true,
          movedTasks: movedTasks.length,
          movedPlanEntries: movedPlan.length,
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
        await db.update(projectInfo).set({
          phase: phase || "First Assessment",
          isActive: true,
          phaseUpdatedAt: new Date(),
          phaseUpdatedByUserId: userId,
        }).where(eq(projectInfo.id, existing.id));
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

      const { sizeKwp, pd, pm, contractValue, escalationLevel, phase, ragStatus } = req.body;
      const updates: Record<string, any> = { updatedAt: new Date() };

      if (sizeKwp !== undefined) updates.sizeKwp = sizeKwp || null;
      if (pd !== undefined) updates.pd = pd || null;
      if (pm !== undefined) updates.pm = pm || null;
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

      res.json(updated);
    } catch (err: any) {
      console.error("[lifecycle-board] PATCH phase error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}
