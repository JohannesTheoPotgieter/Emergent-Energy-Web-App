/**
 * B2: Sites CRUD routes
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { db } from "../db";
import { eq, desc, isNull, and } from "drizzle-orm";
import { sites } from "@shared/schema/projects";
import { z, ZodError } from "zod";

const siteCreateSchema = z.object({
  siteName: z.string().min(1),
  clientId: z.number().int().optional(),
  address: z.string().optional(),
  municipality: z.string().optional(),
  roofType: z.string().optional(),
  gpsLat: z.string().optional(),
  gpsLng: z.string().optional(),
});

const router = Router();

router.get("/api/sites", requireAuth, async (req: Request, res: Response) => {
  try {
    const clientId = req.query.clientId ? Number(req.query.clientId) : undefined;
    const conditions = [isNull(sites.deletedAt)];
    if (clientId) conditions.push(eq(sites.clientId, clientId));

    const rows = await db
      .select()
      .from(sites)
      .where(and(...conditions))
      .orderBy(desc(sites.createdAt));

    res.json(rows);
  } catch (err) {
    console.error("[Sites] Failed to fetch sites:", err);
    res.status(500).json({ error: "Failed to fetch sites" });
  }
});

router.get("/api/sites/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(sites)
      .where(eq(sites.id, Number(req.params.id)));

    if (!row) return res.status(404).json({ error: "Site not found" });
    res.json(row);
  } catch (err) {
    console.error("[Sites] Failed to fetch site:", err);
    res.status(500).json({ error: "Failed to fetch site" });
  }
});

router.post("/api/sites", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = siteCreateSchema.parse(req.body);
    const [row] = await db.insert(sites).values(parsed).returning();
    res.status(201).json(row);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    console.error("[Sites] Failed to create site:", err);
    res.status(500).json({ error: "Failed to create site" });
  }
});

router.patch("/api/sites/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = siteCreateSchema.partial().parse(req.body);
    const [row] = await db
      .update(sites)
      .set({ ...parsed, updatedAt: new Date() })
      .where(eq(sites.id, Number(req.params.id)))
      .returning();
    res.json(row);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    console.error("[Sites] Failed to update site:", err);
    res.status(500).json({ error: "Failed to update site" });
  }
});

router.delete("/api/sites/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .update(sites)
      .set({ deletedAt: new Date() })
      .where(eq(sites.id, Number(req.params.id)))
      .returning();
    if (!row) return res.status(404).json({ error: "Site not found" });
    res.json(row);
  } catch (err) {
    console.error("[Sites] Failed to delete site:", err);
    res.status(500).json({ error: "Failed to delete site" });
  }
});

export function registerSitesRoutes(app: Express) {
  app.use(router);
}
