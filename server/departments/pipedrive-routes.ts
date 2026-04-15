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

/**
 * A sync is considered "stuck" if its log entry is still in `running`
 * state and was started more than this many minutes ago. The admin
 * sync route sweeps those on entry so they do not block new runs.
 */
const STUCK_RUNNING_THRESHOLD_MINUTES = 30;

// Trigger manual sync (admin only)
router.post("/api/admin/pipedrive/sync", requireAuth, requirePermission("admin", "edit"), async (_req: Request, res: Response) => {
  try {
    // Sweep any stale `running` rows so a crashed sync does not block
    // the admin button forever. This only marks entries older than the
    // threshold — an in-flight sync started seconds ago is untouched.
    const staleErrorMsg = JSON.stringify([
      `Sync abandoned — process did not finish within ${STUCK_RUNNING_THRESHOLD_MINUTES} minutes`,
    ]);
    await db.execute(sql`
      UPDATE pipedrive_sync_log
      SET status = 'failed',
          completed_at = NOW(),
          errors = COALESCE(errors, ${staleErrorMsg})
      WHERE status = 'running'
        AND started_at < NOW() - make_interval(mins => ${STUCK_RUNNING_THRESHOLD_MINUTES})
    `);

    // Concurrency guard: if another sync is already running (and not
    // stale), refuse to start a second one. Two parallel syncs would
    // race on the same deals and duplicate work on the integration
    // health log.
    const runningCheck = await db.execute(sql`
      SELECT id, started_at FROM pipedrive_sync_log
      WHERE status = 'running'
      ORDER BY started_at DESC
      LIMIT 1
    `);
    const runningRow = (runningCheck as any).rows?.[0];
    if (runningRow) {
      return res.status(409).json({
        error: "Sync already in progress",
        message: "Another Pipedrive sync is currently running. Wait for it to finish before starting a new one.",
        runningSyncId: runningRow.id,
        runningSyncStartedAt: runningRow.started_at,
      });
    }

    // Insert sync log entry and capture its ID
    const insertResult = await db.execute(sql`
      INSERT INTO pipedrive_sync_log (sync_type, started_at, status)
      VALUES ('manual', NOW(), 'running')
      RETURNING id
    `);
    const syncLogId = (insertResult as any).rows?.[0]?.id;

    let result;
    try {
      result = await syncPipedriveDeals();
    } catch (err) {
      // Fatal sync failure — mark the log row so it doesn't sit in `running`.
      if (syncLogId) {
        const msg = err instanceof Error ? err.message : String(err);
        await db.execute(sql`
          UPDATE pipedrive_sync_log
          SET completed_at = NOW(),
              status = 'failed',
              errors = ${JSON.stringify([msg])}
          WHERE id = ${syncLogId}
        `);
      }
      throw err;
    }

    // Map sync-service status semantics onto the sync_log status field.
    // - No errors                     -> 'completed'
    // - Some errors but progress made -> 'partial' (visible in admin UI)
    // - No progress at all            -> 'failed'
    const syncStatus =
      result.errors.length === 0
        ? 'completed'
        : result.dealsProcessed > 0
          ? 'partial'
          : 'failed';
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

    res.json({ ...result, syncStatus });
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
