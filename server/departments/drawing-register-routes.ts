/**
 * Engineering drawing register routes — CRUD for drawings and revisions
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { db } from "../db";
import { eq, desc, and, isNull } from "drizzle-orm";
import { drawingRegister, drawingRevisions } from "@shared/schema/engineering";

const router = Router();

router.get("/api/drawings", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const conditions = [isNull(drawingRegister.deletedAt)];
    if (projectId) conditions.push(eq(drawingRegister.projectId, projectId));

    const rows = await db
      .select()
      .from(drawingRegister)
      .where(and(...conditions))
      .orderBy(desc(drawingRegister.updatedAt));

    res.json(rows);
  } catch (err) {
    console.error("[Drawings] Failed to fetch:", err);
    res.status(500).json({ error: "Failed to fetch drawings" });
  }
});

router.post("/api/drawings", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db.insert(drawingRegister).values(req.body).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[Drawings] Failed to create:", err);
    res.status(500).json({ error: "Failed to create drawing" });
  }
});

router.patch("/api/drawings/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .update(drawingRegister)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(drawingRegister.id, Number(req.params.id)))
      .returning();
    res.json(row);
  } catch (err) {
    console.error("[Drawings] Failed to update:", err);
    res.status(500).json({ error: "Failed to update drawing" });
  }
});

// Revisions
router.get("/api/drawings/:drawingId/revisions", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(drawingRevisions)
      .where(eq(drawingRevisions.drawingId, Number(req.params.drawingId)))
      .orderBy(desc(drawingRevisions.createdAt));
    res.json(rows);
  } catch (err) {
    console.error("[Drawings] Failed to fetch revisions:", err);
    res.status(500).json({ error: "Failed to fetch revisions" });
  }
});

router.post("/api/drawings/:drawingId/revisions", requireAuth, async (req: Request, res: Response) => {
  try {
    const drawingId = Number(req.params.drawingId);
    const [rev] = await db.insert(drawingRevisions).values({ ...req.body, drawingId }).returning();

    // Update the drawing's current revision
    await db.update(drawingRegister).set({
      currentRevision: rev.revision,
      revisionDate: rev.revisionDate,
      updatedAt: new Date(),
    }).where(eq(drawingRegister.id, drawingId));

    res.status(201).json(rev);
  } catch (err) {
    console.error("[Drawings] Failed to create revision:", err);
    res.status(500).json({ error: "Failed to create revision" });
  }
});

export function registerDrawingRegisterRoutes(app: Express) {
  app.use(router);
}
