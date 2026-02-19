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

      const planByNorm = new Map<string, { total: number; sumPct: number }>();
      for (const p of allPlanTasks) {
        const name = p.projectName;
        if (!name) continue;
        const norm = normalizeName(name);
        if (!planByNorm.has(norm)) planByNorm.set(norm, { total: 0, sumPct: 0 });
        const entry = planByNorm.get(norm)!;
        entry.total++;
        if (p.actualPctComplete != null) {
          entry.sumPct += Number(p.actualPctComplete);
        }
      }

      const projectNormNames = new Set<string>();
      const results: any[] = [];

      for (const proj of allProjects) {
        const norm = normalizeName(proj.projectName);
        projectNormNames.add(norm);

        const eng = engByNorm.get(norm) || { total: 0, done: 0, rawName: "" };
        const plan = planByNorm.get(norm) || { total: 0, sumPct: 0 };

        let source: "excel" | "engineering" | "both" = "excel";
        if (eng.total > 0) source = "both";

        results.push({
          id: proj.id,
          projectName: proj.projectName,
          sizeKwp: proj.sizeKwp,
          pd: proj.pd,
          pm: proj.pm,
          contractValue: proj.contractValue,
          phase: proj.phase,
          isActive: proj.isActive,
          source,
          engTotal: eng.total,
          engDone: eng.done,
          planTotal: plan.total,
          planAvgPct: plan.total > 0 ? Math.round((plan.sumPct / plan.total) * 100) / 100 : 0,
        });
      }

      const engNormKeys = Array.from(engByNorm.keys());
      for (const norm of engNormKeys) {
        if (projectNormNames.has(norm)) continue;

        const eng = engByNorm.get(norm)!;
        const plan = planByNorm.get(norm) || { total: 0, sumPct: 0 };

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
        });
      }

      res.json(results);
    } catch (err: any) {
      console.error("[lifecycle-board] GET projects error:", err);
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
