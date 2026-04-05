/**
 * D1: Pipedrive sync admin page
 * Trigger sync, view sync log, show last sync status
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "./shared-middleware";
import { db } from "../db";
import { desc, sql } from "drizzle-orm";
import { syncPipedriveDeals } from "../services/pipedrive-sync-service";

const router = Router();

// Get sync log
router.get("/api/admin/pipedrive/sync-log", requireAuth, async (_req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`
      SELECT * FROM pipedrive_sync_log
      ORDER BY started_at DESC
      LIMIT 20
    `);
    res.json((rows as any).rows || []);
  } catch (err) {
    console.error("[Pipedrive] Failed to fetch sync log:", err);
    res.status(500).json({ error: "Failed to fetch sync log" });
  }
});

// Trigger manual sync
router.post("/api/admin/pipedrive/sync", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    // Log the sync start
    await db.execute(sql`
      INSERT INTO pipedrive_sync_log (sync_type, started_at, status)
      VALUES ('manual', NOW(), 'running')
    `);

    const result = await syncPipedriveDeals();

    // Update the log entry
    await db.execute(sql`
      UPDATE pipedrive_sync_log
      SET completed_at = NOW(),
          deals_processed = ${result.dealsProcessed},
          deals_created = ${result.dealsCreated},
          deals_updated = ${result.dealsUpdated},
          errors = ${result.errors.length > 0 ? JSON.stringify(result.errors) : null},
          status = ${result.errors.length > 0 && result.dealsProcessed === 0 ? 'failed' : 'completed'}
      WHERE id = (SELECT MAX(id) FROM pipedrive_sync_log WHERE sync_type = 'manual')
    `);

    res.json(result);
  } catch (err) {
    console.error("[Pipedrive] Sync failed:", err);
    res.status(500).json({ error: "Sync failed", message: err instanceof Error ? err.message : String(err) });
  }
});

// Check if Pipedrive is configured
router.get("/api/admin/pipedrive/status", requireAuth, async (_req: Request, res: Response) => {
  const configured = !!process.env.PIPEDRIVE_API_TOKEN;
  res.json({ configured });
});

export function registerPipedriveRoutes(app: Express) {
  app.use(router);
}
