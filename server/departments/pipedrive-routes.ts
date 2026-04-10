/**
 * D1: Pipedrive sync admin page
 * Trigger sync, view sync log, show last sync status
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { requirePermission } from "../permission-middleware";
import { db } from "../db";
import { desc, sql } from "drizzle-orm";
import { syncPipedriveDeals } from "../services/pipedrive-sync-service";

const router = Router();

// Get sync log (admin only)
router.get("/api/admin/pipedrive/sync-log", requireAuth, requirePermission("admin", "view"), async (_req: Request, res: Response) => {
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

// Trigger manual sync (admin only)
router.post("/api/admin/pipedrive/sync", requireAuth, requirePermission("admin", "edit"), async (_req: Request, res: Response) => {
  try {
    // Insert sync log entry and capture its ID
    const insertResult = await db.execute(sql`
      INSERT INTO pipedrive_sync_log (sync_type, started_at, status)
      VALUES ('manual', NOW(), 'running')
      RETURNING id
    `);
    const syncLogId = (insertResult as any).rows?.[0]?.id;

    const result = await syncPipedriveDeals();

    // Update the specific log entry by ID (safe for concurrent syncs)
    const syncStatus = result.errors.length > 0 && result.dealsProcessed === 0 ? 'failed' : 'completed';
    const errorsJson = result.errors.length > 0 ? JSON.stringify(result.errors) : null;
    if (syncLogId) {
      await db.execute(sql`
        UPDATE pipedrive_sync_log
        SET completed_at = NOW(),
            deals_processed = ${result.dealsProcessed},
            deals_created = ${result.dealsCreated},
            deals_updated = ${result.dealsUpdated},
            errors = ${errorsJson},
            status = ${syncStatus}
        WHERE id = ${syncLogId}
      `);
    }

    res.json(result);
  } catch (err) {
    console.error("[Pipedrive] Sync failed:", err);
    res.status(500).json({ error: "Sync failed", message: err instanceof Error ? err.message : String(err) });
  }
});

// Check if Pipedrive is configured (admin only)
router.get("/api/admin/pipedrive/status", requireAuth, requirePermission("admin", "view"), async (_req: Request, res: Response) => {
  const configured = !!process.env.PIPEDRIVE_API_TOKEN;
  res.json({ configured });
});

export function registerPipedriveRoutes(app: Express) {
  app.use(router);
}
