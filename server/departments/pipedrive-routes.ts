/**
 * D1: Pipedrive sync admin page
 * Trigger sync, view sync log, show last sync status
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { requirePermission } from "../permission-middleware";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { syncPipedriveDeals, type PipedrivePullScope } from "../services/pipedrive-sync-service";
import { logAuditFromReq } from "../audit-logger";

const router = Router();

// Roles allowed to pull ALL Pipedrive deals. Everyone else can still
// press the "Pull from Pipedrive" button, but the server filters the
// sync to deals owned by their own Pipedrive user (matched by email).
// Kept as a local constant — this is not a permission-table decision
// but a policy ("COO/CEO/CCO see the whole pipeline; PDs see their own").
const PIPEDRIVE_PULL_ALL_ROLES = new Set([
  "COO_ADMIN",
  "CEO_ADMIN",
  "CCO",
]);

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
    res.status(500).json({ error: "Sync failed" });
  }
});

// Check if Pipedrive is configured (admin only)
router.get("/api/admin/pipedrive/status", requireAuth, requirePermission("admin", "view"), async (_req: Request, res: Response) => {
  const configured = !!process.env.PIPEDRIVE_API_TOKEN;
  res.json({ configured });
});

/**
 * Unified "Pull from Pipedrive" endpoint.
 *
 * Both the COO-style admin pull and the per-PD pull share this route.
 * The server decides the scope from the caller's role:
 *
 *   - `COO_ADMIN` / `CEO_ADMIN` / `CCO`  →  pulls every deal (scope=all)
 *   - everyone else                      →  filters by `deal.owner_id.email
 *                                             === caller.email`
 *                                             (scope=owner)
 *
 * No duplicates are possible because the sync service upserts by
 * `pipedrive_deal_id` — a PD pulling, then a COO pulling, still yields
 * exactly one row per Pipedrive deal.
 *
 * Gated on `opportunities:view` so that any role who can see the
 * Opportunities page can also refresh the data they are allowed to see.
 */
router.get("/api/pipedrive/pull/scope", requireAuth, requirePermission("opportunities", "view"), async (req: Request, res: Response) => {
  const user = req.user;
  const role = String(user?.role || "");
  const isAdminScope = PIPEDRIVE_PULL_ALL_ROLES.has(role);
  const email = (user?.email || "").trim();
  const canPull = isAdminScope || Boolean(email);
  res.json({
    role,
    scope: isAdminScope ? "all" : "owner",
    ownerEmail: isAdminScope ? null : (email || null),
    configured: !!process.env.PIPEDRIVE_API_TOKEN,
    canPull,
    blockedReason: canPull
      ? null
      : "Your account has no email on file, so we cannot match your Pipedrive deals. Ask an admin to set your work email.",
  });
});

router.post("/api/pipedrive/pull", requireAuth, requirePermission("opportunities", "view"), async (req: Request, res: Response) => {
  try {
    const user = req.user;
    const role = String(user?.role || "");
    const email = (user?.email || "").trim();
    const isAdminScope = PIPEDRIVE_PULL_ALL_ROLES.has(role);

    if (!isAdminScope && !email) {
      return res.status(400).json({
        error: "missing_email",
        message: "Your account has no email on file, so we cannot match your Pipedrive deals. Ask an admin to set your work email.",
      });
    }

    const scope: PipedrivePullScope = isAdminScope
      ? { scope: "all" }
      : { scope: "owner", ownerEmail: email };

    // Sweep stuck `running` rows so a crashed earlier pull does not
    // block a new one forever. Same threshold as the admin route.
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

    // Concurrency guard: a single Pipedrive pull runs at a time. The
    // admin endpoint uses the same guard, so a COO pull-all will
    // block an individual PD pull and vice-versa — acceptable because
    // syncs are short and the alternative is interleaved writes on
    // the same `opportunities` rows.
    const runningCheck = await db.execute(sql`
      SELECT id, started_at FROM pipedrive_sync_log
      WHERE status = 'running'
      ORDER BY started_at DESC
      LIMIT 1
    `);
    const runningRow = (runningCheck as any).rows?.[0];
    if (runningRow) {
      return res.status(409).json({
        error: "sync_in_progress",
        message: "Another Pipedrive pull is already running. Wait for it to finish before starting a new one.",
        runningSyncId: runningRow.id,
        runningSyncStartedAt: runningRow.started_at,
      });
    }

    const syncType = isAdminScope ? "manual_all" : "manual_owner";
    const insertResult = await db.execute(sql`
      INSERT INTO pipedrive_sync_log (sync_type, started_at, status)
      VALUES (${syncType}, NOW(), 'running')
      RETURNING id
    `);
    const syncLogId = (insertResult as any).rows?.[0]?.id;

    let result;
    try {
      result = await syncPipedriveDeals(scope);
    } catch (err) {
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

    const syncStatus =
      result.errors.length === 0
        ? "completed"
        : result.dealsProcessed > 0
          ? "partial"
          : "failed";
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

    logAuditFromReq(req, {
      entityType: "pipedrive_pull",
      entityId: String(syncLogId ?? ""),
      action: isAdminScope ? "pull_all" : "pull_owner",
      changesJson: {
        scope: scope.scope,
        ownerEmail: scope.scope === "owner" ? scope.ownerEmail : null,
        dealsProcessed: result.dealsProcessed,
        dealsCreated: result.dealsCreated,
        dealsUpdated: result.dealsUpdated,
        errorCount: result.errors.length,
        syncStatus,
      },
    });

    res.json({
      ...result,
      syncStatus,
      scope: scope.scope,
      ownerEmail: scope.scope === "owner" ? scope.ownerEmail : null,
    });
  } catch (err) {
    console.error("[Pipedrive] Pull failed:", err);
    res.status(500).json({ error: "pull_failed" });
  }
});

export function registerPipedriveRoutes(app: Express) {
  app.use(router);
}
