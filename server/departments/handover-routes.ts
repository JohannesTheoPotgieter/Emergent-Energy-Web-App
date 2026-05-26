/**
 * C4: Handover packs, checklist items, and SSEG items routes
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { db } from "../db";
import { parseBody } from "../lib/input-validation";
import { eq, desc, and, isNull } from "drizzle-orm";
import { DEFAULT_QUERY_LIMIT } from "../lib/safe-query";
import {
  handoverPacks,
  insertHandoverPackSchema,
  handoverChecklistItems,
  ssegItems,
  insertSsegItemSchema,
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
      .orderBy(desc(handoverPacks.createdAt))
      .limit(DEFAULT_QUERY_LIMIT);

    res.json(rows);
  } catch (err) {
    console.error("[Handover] Failed to fetch packs:", err);
    res.status(500).json({ error: "Failed to fetch handover packs" });
  }
});

router.post("/api/handover/packs", requireAuth, async (req: Request, res: Response) => {
  try {
    const [parsed, validationError] = parseBody(req.body, insertHandoverPackSchema);
    if (validationError) return res.status(400).json(validationError);
    const [row] = await db.insert(handoverPacks).values(parsed).returning();
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
      .set({ ...req.body, createdAt: undefined, deletedAt: undefined, id: undefined })
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
      .orderBy(desc(ssegItems.createdAt))
      .limit(DEFAULT_QUERY_LIMIT);

    res.json(rows);
  } catch (err) {
    console.error("[Handover] Failed to fetch SSEG items:", err);
    res.status(500).json({ error: "Failed to fetch SSEG items" });
  }
});

router.post("/api/handover/sseg", requireAuth, async (req: Request, res: Response) => {
  try {
    const [parsed, validationError] = parseBody(req.body, insertSsegItemSchema);
    if (validationError) return res.status(400).json(validationError);
    const [row] = await db.insert(ssegItems).values(parsed).returning();
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
      .set({ ...req.body, updatedAt: new Date(), createdAt: undefined, deletedAt: undefined, id: undefined })
      .where(eq(ssegItems.id, Number(req.params.id)))
      .returning();
    res.json(row);
  } catch (err) {
    console.error("[Handover] Failed to update SSEG item:", err);
    res.status(500).json({ error: "Failed to update SSEG item" });
  }
});

export function registerHandoverPacksRoutes(app: Express) {
  app.use(router);
}

// Legacy alias — the registrar previously imported this file under
// the same name as `server/handover-routes.ts`. The two files cover
// disjoint URL prefixes (packs / sseg / checklist-items here; pd-pm
// handover + lessons + handover-gates in the legacy file), but sharing
// the name made wiring confusing. Keep the alias so any forgotten
// import site keeps compiling; new imports should use the explicit name.
export const registerHandoverRoutes = registerHandoverPacksRoutes;
