/**
 * C1: Construction module routes
 * CRUD for site_activities, snags, site_inspections, contractor_assignments
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { requirePermission } from "../permission-middleware";
import { db } from "../db";
import { eq, desc, and, isNull } from "drizzle-orm";
import {
  siteActivities,
  snags,
  siteInspections,
  contractorAssignments,
} from "@shared/schema/construction";

const router = Router();

// ===================== SITE ACTIVITIES =====================

router.get("/api/construction/activities", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const conditions = [isNull(siteActivities.deletedAt)];
    if (projectId) conditions.push(eq(siteActivities.projectId, projectId));

    const rows = await db
      .select()
      .from(siteActivities)
      .where(and(...conditions))
      .orderBy(desc(siteActivities.activityDate));

    res.json(rows);
  } catch (err) {
    console.error("[Construction] Failed to fetch site activities:", err);
    res.status(500).json({ error: "Failed to fetch site activities" });
  }
});

router.post("/api/construction/activities", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db.insert(siteActivities).values(req.body).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[Construction] Failed to create site activity:", err);
    res.status(500).json({ error: "Failed to create site activity" });
  }
});

router.patch("/api/construction/activities/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .update(siteActivities)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(siteActivities.id, Number(req.params.id)))
      .returning();
    res.json(row);
  } catch (err) {
    console.error("[Construction] Failed to update site activity:", err);
    res.status(500).json({ error: "Failed to update site activity" });
  }
});

// ===================== SNAGS =====================

router.get("/api/construction/snags", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const conditions = [isNull(snags.deletedAt)];
    if (projectId) conditions.push(eq(snags.projectId, projectId));

    const rows = await db
      .select()
      .from(snags)
      .where(and(...conditions))
      .orderBy(desc(snags.createdAt));

    res.json(rows);
  } catch (err) {
    console.error("[Construction] Failed to fetch snags:", err);
    res.status(500).json({ error: "Failed to fetch snags" });
  }
});

router.post("/api/construction/snags", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db.insert(snags).values(req.body).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[Construction] Failed to create snag:", err);
    res.status(500).json({ error: "Failed to create snag" });
  }
});

router.patch("/api/construction/snags/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .update(snags)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(snags.id, Number(req.params.id)))
      .returning();
    res.json(row);
  } catch (err) {
    console.error("[Construction] Failed to update snag:", err);
    res.status(500).json({ error: "Failed to update snag" });
  }
});

// ===================== SITE INSPECTIONS =====================

router.get("/api/construction/inspections", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const conditions = [isNull(siteInspections.deletedAt)];
    if (projectId) conditions.push(eq(siteInspections.projectId, projectId));

    const rows = await db
      .select()
      .from(siteInspections)
      .where(and(...conditions))
      .orderBy(desc(siteInspections.inspectionDate));

    res.json(rows);
  } catch (err) {
    console.error("[Construction] Failed to fetch inspections:", err);
    res.status(500).json({ error: "Failed to fetch inspections" });
  }
});

router.post("/api/construction/inspections", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db.insert(siteInspections).values(req.body).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[Construction] Failed to create inspection:", err);
    res.status(500).json({ error: "Failed to create inspection" });
  }
});

router.patch("/api/construction/inspections/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .update(siteInspections)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(siteInspections.id, Number(req.params.id)))
      .returning();
    res.json(row);
  } catch (err) {
    console.error("[Construction] Failed to update inspection:", err);
    res.status(500).json({ error: "Failed to update inspection" });
  }
});

// ===================== CONTRACTOR ASSIGNMENTS =====================

router.get("/api/construction/contractors", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const conditions = [isNull(contractorAssignments.deletedAt)];
    if (projectId) conditions.push(eq(contractorAssignments.projectId, projectId));

    const rows = await db
      .select()
      .from(contractorAssignments)
      .where(and(...conditions))
      .orderBy(desc(contractorAssignments.createdAt));

    res.json(rows);
  } catch (err) {
    console.error("[Construction] Failed to fetch contractor assignments:", err);
    res.status(500).json({ error: "Failed to fetch contractor assignments" });
  }
});

router.post("/api/construction/contractors", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db.insert(contractorAssignments).values(req.body).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[Construction] Failed to create contractor assignment:", err);
    res.status(500).json({ error: "Failed to create contractor assignment" });
  }
});

router.patch("/api/construction/contractors/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .update(contractorAssignments)
      .set(req.body)
      .where(eq(contractorAssignments.id, Number(req.params.id)))
      .returning();
    res.json(row);
  } catch (err) {
    console.error("[Construction] Failed to update contractor assignment:", err);
    res.status(500).json({ error: "Failed to update contractor assignment" });
  }
});

export function registerConstructionRoutes(app: Express) {
  app.use(router);
}
