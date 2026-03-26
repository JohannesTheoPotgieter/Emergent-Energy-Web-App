/**
 * C4: Handover packs, checklist items, and SSEG items routes
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { db } from "../db";
import { eq, desc, and, isNull } from "drizzle-orm";
import { createHandoverPackApproval } from "../services/approval-service";
import {
  handoverPacks,
  handoverChecklistItems,
  ssegItems,
} from "@shared/schema/handover";

const router = Router();

// ===================== HANDOVER PACKS =====================

router.get("/api/handover/packs", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const packType = req.query.packType as string | undefined;
    const conditions = [isNull(handoverPacks.deletedAt)];
    if (projectId) conditions.push(eq(handoverPacks.projectId, projectId));
    if (packType) conditions.push(eq(handoverPacks.packType, packType));

    const rows = await db
      .select()
      .from(handoverPacks)
      .where(and(...conditions))
      .orderBy(desc(handoverPacks.createdAt));

    res.json(rows);
  } catch (err) {
    console.error("[Handover] Failed to fetch packs:", err);
    res.status(500).json({ error: "Failed to fetch handover packs" });
  }
});

router.post("/api/handover/packs", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db.insert(handoverPacks).values(req.body).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[Handover] Failed to create pack:", err);
    res.status(500).json({ error: "Failed to create handover pack" });
  }
});

router.patch("/api/handover/packs/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .update(handoverPacks)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(handoverPacks.id, Number(req.params.id)))
      .returning();

    // B8: Create approval when pack is submitted for review
    if (req.body.status === "submitted" && row) {
      const userId = (req as any).user?.id;
      try {
        await createHandoverPackApproval({
          projectId: row.projectId,
          handoverPackId: row.id,
          packType: row.packType,
          requestedByUserId: userId,
          approverUserId: userId, // TODO: resolve actual approver from project role assignments
        });
      } catch (approvalErr) {
        console.warn("[Handover] Approval creation failed (non-blocking):", approvalErr);
      }
    }

    res.json(row);
  } catch (err) {
    console.error("[Handover] Failed to update pack:", err);
    res.status(500).json({ error: "Failed to update handover pack" });
  }
});

// ===================== HANDOVER CHECKLIST ITEMS =====================

router.get("/api/handover/packs/:packId/items", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(handoverChecklistItems)
      .where(eq(handoverChecklistItems.handoverPackId, Number(req.params.packId)));

    res.json(rows);
  } catch (err) {
    console.error("[Handover] Failed to fetch checklist items:", err);
    res.status(500).json({ error: "Failed to fetch checklist items" });
  }
});

router.post("/api/handover/packs/:packId/items", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .insert(handoverChecklistItems)
      .values({ ...req.body, handoverPackId: Number(req.params.packId) })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[Handover] Failed to create checklist item:", err);
    res.status(500).json({ error: "Failed to create checklist item" });
  }
});

router.patch("/api/handover/checklist-items/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .update(handoverChecklistItems)
      .set(req.body)
      .where(eq(handoverChecklistItems.id, Number(req.params.id)))
      .returning();
    res.json(row);
  } catch (err) {
    console.error("[Handover] Failed to update checklist item:", err);
    res.status(500).json({ error: "Failed to update checklist item" });
  }
});

// ===================== SSEG ITEMS =====================

router.get("/api/handover/sseg", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const conditions = [isNull(ssegItems.deletedAt)];
    if (projectId) conditions.push(eq(ssegItems.projectId, projectId));

    const rows = await db
      .select()
      .from(ssegItems)
      .where(and(...conditions))
      .orderBy(desc(ssegItems.createdAt));

    res.json(rows);
  } catch (err) {
    console.error("[Handover] Failed to fetch SSEG items:", err);
    res.status(500).json({ error: "Failed to fetch SSEG items" });
  }
});

router.post("/api/handover/sseg", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db.insert(ssegItems).values(req.body).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[Handover] Failed to create SSEG item:", err);
    res.status(500).json({ error: "Failed to create SSEG item" });
  }
});

router.patch("/api/handover/sseg/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .update(ssegItems)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(ssegItems.id, Number(req.params.id)))
      .returning();
    res.json(row);
  } catch (err) {
    console.error("[Handover] Failed to update SSEG item:", err);
    res.status(500).json({ error: "Failed to update SSEG item" });
  }
});

export function registerHandoverRoutes(app: Express) {
  app.use(router);
}
