/**
 * B3: Opportunities CRUD routes
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { requirePermission } from "../permission-middleware";
import { db } from "../db";
import { eq, desc, isNull, and } from "drizzle-orm";
import { opportunities } from "@shared/schema/projects";

const router = Router();

router.get("/api/opportunities", requireAuth, async (req: Request, res: Response) => {
  try {
    const clientId = req.query.clientId ? Number(req.query.clientId) : undefined;
    const stage = req.query.stage as string | undefined;
    const conditions = [isNull(opportunities.deletedAt)];
    if (clientId) conditions.push(eq(opportunities.clientId, clientId));
    if (stage) conditions.push(eq(opportunities.stage, stage));

    const rows = await db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(desc(opportunities.createdAt));

    res.json(rows);
  } catch (err) {
    console.error("[Opportunities] Failed to fetch:", err);
    res.status(500).json({ error: "Failed to fetch opportunities" });
  }
});

router.get("/api/opportunities/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, Number(req.params.id)));

    if (!row) return res.status(404).json({ error: "Opportunity not found" });
    res.json(row);
  } catch (err) {
    console.error("[Opportunities] Failed to fetch:", err);
    res.status(500).json({ error: "Failed to fetch opportunity" });
  }
});

router.post("/api/opportunities", requireAuth, requirePermission("pd_dashboard", "create"), async (req: Request, res: Response) => {
  try {
    const [row] = await db.insert(opportunities).values(req.body).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[Opportunities] Failed to create:", err);
    res.status(500).json({ error: "Failed to create opportunity" });
  }
});

router.patch("/api/opportunities/:id", requireAuth, requirePermission("pd_dashboard", "edit"), async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .update(opportunities)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(opportunities.id, Number(req.params.id)))
      .returning();
    res.json(row);
  } catch (err) {
    console.error("[Opportunities] Failed to update:", err);
    res.status(500).json({ error: "Failed to update opportunity" });
  }
});

export function registerOpportunitiesRoutes(app: Express) {
  app.use(router);
}
