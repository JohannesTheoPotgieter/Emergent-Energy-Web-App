/**
 * C3: HSE module routes
 * CRUD for hse_incidents and corrective_actions
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { requirePermission } from "../permission-middleware";
import { db } from "../db";
import { eq, desc, and, isNull } from "drizzle-orm";
import { hseIncidents, correctiveActions } from "@shared/schema/hse";

const router = Router();

// ===================== HSE INCIDENTS =====================

router.get("/api/hse/incidents", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const conditions = [isNull(hseIncidents.deletedAt)];
    if (projectId) conditions.push(eq(hseIncidents.projectId, projectId));

    const rows = await db
      .select()
      .from(hseIncidents)
      .where(and(...conditions))
      .orderBy(desc(hseIncidents.incidentDate));

    res.json(rows);
  } catch (err) {
    console.error("[HSE] Failed to fetch incidents:", err);
    res.status(500).json({ error: "Failed to fetch HSE incidents" });
  }
});

router.post("/api/hse/incidents", requireAuth, requirePermission("hse", "create"), async (req: Request, res: Response) => {
  try {
    const [row] = await db.insert(hseIncidents).values(req.body).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[HSE] Failed to create incident:", err);
    res.status(500).json({ error: "Failed to create HSE incident" });
  }
});

router.patch("/api/hse/incidents/:id", requireAuth, requirePermission("hse", "edit"), async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .update(hseIncidents)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(hseIncidents.id, Number(req.params.id)))
      .returning();
    res.json(row);
  } catch (err) {
    console.error("[HSE] Failed to update incident:", err);
    res.status(500).json({ error: "Failed to update HSE incident" });
  }
});

// ===================== CORRECTIVE ACTIONS =====================

router.get("/api/hse/corrective-actions", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const sourceType = req.query.sourceType as string | undefined;
    const conditions = [isNull(correctiveActions.deletedAt)];
    if (projectId) conditions.push(eq(correctiveActions.projectId, projectId));
    if (sourceType) conditions.push(eq(correctiveActions.sourceType, sourceType));

    const rows = await db
      .select()
      .from(correctiveActions)
      .where(and(...conditions))
      .orderBy(desc(correctiveActions.createdAt));

    res.json(rows);
  } catch (err) {
    console.error("[HSE] Failed to fetch corrective actions:", err);
    res.status(500).json({ error: "Failed to fetch corrective actions" });
  }
});

router.post("/api/hse/corrective-actions", requireAuth, requirePermission("hse", "create"), async (req: Request, res: Response) => {
  try {
    const [row] = await db.insert(correctiveActions).values(req.body).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[HSE] Failed to create corrective action:", err);
    res.status(500).json({ error: "Failed to create corrective action" });
  }
});

router.patch("/api/hse/corrective-actions/:id", requireAuth, requirePermission("hse", "edit"), async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .update(correctiveActions)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(correctiveActions.id, Number(req.params.id)))
      .returning();
    res.json(row);
  } catch (err) {
    console.error("[HSE] Failed to update corrective action:", err);
    res.status(500).json({ error: "Failed to update corrective action" });
  }
});

export function registerHseRoutes(app: Express) {
  app.use(router);
}
