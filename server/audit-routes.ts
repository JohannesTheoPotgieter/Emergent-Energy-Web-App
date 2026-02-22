import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { changeSets, fieldChanges, OVERRIDE_CATEGORIES } from "@shared/schema";
import { eq, desc, and, sql, gte, lte, or, like, count } from "drizzle-orm";
import { verifyToken } from "./jwt";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload) {
      (req as any).user = {
        id: payload.userId,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      };
      return next();
    }
  }
  res.status(401).json({ error: "auth_required", message: "Authentication required" });
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = (req as any).user?.role;
  if (role === "admin" || role === "COO_ADMIN" || role === "CEO_ADMIN") {
    return next();
  }
  res.status(403).json({ error: "Admin access required" });
}

export function registerAuditRoutes(app: Express) {
  // Project History Timeline - get all ChangeSets for a specific project
  app.get("/api/audit/project-history/:projectId", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId as string);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = (page - 1) * limit;
      const sourceFilter = req.query.source as string;

      const conditions = [eq(changeSets.projectId, projectId)];
      if (sourceFilter) {
        conditions.push(eq(changeSets.source, sourceFilter as any));
      }

      const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

      const [items, totalResult] = await Promise.all([
        db.select().from(changeSets)
          .where(whereClause)
          .orderBy(desc(changeSets.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(changeSets).where(whereClause),
      ]);

      const total = totalResult[0]?.total || 0;

      res.json({
        items,
        pagination: { page, limit, total, totalPages: Math.ceil(Number(total) / limit) },
      });
    } catch (err: any) {
      console.error("[audit] project-history error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Project history by project name
  app.get("/api/audit/project-history-by-name/:projectName", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName as string);
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = (page - 1) * limit;
      const sourceFilter = req.query.source as string;

      const conditions: any[] = [eq(changeSets.projectName, projectName)];
      if (sourceFilter) {
        conditions.push(eq(changeSets.source, sourceFilter as any));
      }

      const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

      const [items, totalResult] = await Promise.all([
        db.select().from(changeSets)
          .where(whereClause)
          .orderBy(desc(changeSets.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(changeSets).where(whereClause),
      ]);

      const total = totalResult[0]?.total || 0;

      res.json({
        items,
        pagination: { page, limit, total, totalPages: Math.ceil(Number(total) / limit) },
      });
    } catch (err: any) {
      console.error("[audit] project-history-by-name error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get ChangeSet detail with field changes (drill-down)
  app.get("/api/audit/changeset/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const [cs] = await db.select().from(changeSets).where(eq(changeSets.id, id));
      if (!cs) return res.status(404).json({ error: "ChangeSet not found" });

      const fields = await db.select().from(fieldChanges).where(eq(fieldChanges.changeSetId, id));

      res.json({ ...cs, fieldChanges: fields });
    } catch (err: any) {
      console.error("[audit] changeset detail error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin System Activity Log - all ChangeSets with filters
  app.get("/api/audit/activity-log", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = (page - 1) * limit;
      const sourceFilter = req.query.source as string;
      const entityTypeFilter = req.query.entityType as string;
      const projectNameFilter = req.query.projectName as string;
      const actionFilter = req.query.action as string;
      const fromDate = req.query.from as string;
      const toDate = req.query.to as string;
      const searchQuery = req.query.q as string;

      const conditions: any[] = [];
      if (sourceFilter) conditions.push(eq(changeSets.source, sourceFilter as any));
      if (entityTypeFilter) conditions.push(eq(changeSets.entityType, entityTypeFilter));
      if (projectNameFilter) conditions.push(eq(changeSets.projectName, projectNameFilter));
      if (actionFilter) conditions.push(eq(changeSets.action, actionFilter));
      if (fromDate) conditions.push(gte(changeSets.createdAt, new Date(fromDate)));
      if (toDate) conditions.push(lte(changeSets.createdAt, new Date(toDate)));
      if (searchQuery) {
        conditions.push(or(
          like(changeSets.summary, `%${searchQuery}%`),
          like(changeSets.action, `%${searchQuery}%`),
          like(changeSets.entityType, `%${searchQuery}%`),
        ));
      }

      const whereClause = conditions.length > 1 ? and(...conditions) : conditions.length === 1 ? conditions[0] : undefined;

      const [items, totalResult] = await Promise.all([
        db.select().from(changeSets)
          .where(whereClause)
          .orderBy(desc(changeSets.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(changeSets).where(whereClause),
      ]);

      const total = totalResult[0]?.total || 0;

      // Get distinct values for filter dropdowns
      const [sources, entityTypes, actions, projectNames] = await Promise.all([
        db.selectDistinct({ value: changeSets.source }).from(changeSets),
        db.selectDistinct({ value: changeSets.entityType }).from(changeSets),
        db.selectDistinct({ value: changeSets.action }).from(changeSets).limit(50),
        db.selectDistinct({ value: changeSets.projectName }).from(changeSets).limit(100),
      ]);

      res.json({
        items,
        pagination: { page, limit, total, totalPages: Math.ceil(Number(total) / limit) },
        filters: {
          sources: sources.map((s: any) => s.value),
          entityTypes: entityTypes.map((e: any) => e.value),
          actions: actions.map((a: any) => a.value),
          projectNames: projectNames.map((p: any) => p.value).filter(Boolean),
        },
      });
    } catch (err: any) {
      console.error("[audit] activity-log error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Override categories reference endpoint
  app.get("/api/audit/override-categories", requireAuth, (_req: Request, res: Response) => {
    res.json({ categories: OVERRIDE_CATEGORIES });
  });
}
