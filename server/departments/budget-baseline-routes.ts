/**
 * B5: Budget baseline CRUD + lock/version routes
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { db } from "../db";
import { eq, desc, and, max } from "drizzle-orm";
import { budgetBaselines } from "@shared/schema/finance";

const router = Router();

router.get("/api/budget-baselines", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    if (!projectId) return res.status(400).json({ error: "projectId is required" });

    const rows = await db
      .select()
      .from(budgetBaselines)
      .where(eq(budgetBaselines.projectId, projectId))
      .orderBy(desc(budgetBaselines.version));

    res.json(rows);
  } catch (err) {
    console.error("[BudgetBaseline] Failed to fetch:", err);
    res.status(500).json({ error: "Failed to fetch budget baselines" });
  }
});

router.post("/api/budget-baselines", requireAuth, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ error: "projectId is required" });

    // Auto-increment version
    const [latest] = await db
      .select({ maxVersion: max(budgetBaselines.version) })
      .from(budgetBaselines)
      .where(eq(budgetBaselines.projectId, projectId));

    const nextVersion = (latest?.maxVersion ?? 0) + 1;

    const [row] = await db
      .insert(budgetBaselines)
      .values({ ...req.body, version: nextVersion })
      .returning();

    res.status(201).json(row);
  } catch (err) {
    console.error("[BudgetBaseline] Failed to create:", err);
    res.status(500).json({ error: "Failed to create budget baseline" });
  }
});

router.post("/api/budget-baselines/:id/lock", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const userId = (req as any).user?.id;

    const [row] = await db
      .update(budgetBaselines)
      .set({
        changeLocked: true,
        approvedByUserId: userId,
        approvedDate: new Date(),
      })
      .where(and(eq(budgetBaselines.id, id), eq(budgetBaselines.changeLocked, false)))
      .returning();

    if (!row) return res.status(404).json({ error: "Baseline not found or already locked" });
    res.json(row);
  } catch (err) {
    console.error("[BudgetBaseline] Failed to lock:", err);
    res.status(500).json({ error: "Failed to lock budget baseline" });
  }
});

export function registerBudgetBaselineRoutes(app: Express) {
  app.use(router);
}
