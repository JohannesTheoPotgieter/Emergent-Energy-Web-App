/**
 * Admin data backfill endpoints — extract data from existing records
 * into new entity tables created by the architecture migration.
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { requirePermission } from "../permission-middleware";
import { db } from "../db";
import { sql } from "drizzle-orm";

const router = Router();

/**
 * GET /api/admin/backfill/status
 * Check which tables have data and which are empty.
 *
 * Previously guarded by `requireAuth` only — any authenticated user
 * could read backfill status. Now restricted to `admin:view` so
 * non-admin roles cannot probe table row counts.
 */
router.get("/api/admin/backfill/status", requireAuth, requirePermission("admin", "view"), async (_req: Request, res: Response) => {
  try {
    // SAFETY: table names are from this hardcoded whitelist only — not user input
    const tables = [
      "sites", "opportunities", "budget_baselines",
      "site_activities", "snags", "site_inspections", "contractor_assignments",
      "hse_incidents", "corrective_actions",
      "handover_packs", "handover_checklist_items", "sseg_items",
      "pipedrive_sync_log",
    ];

    const counts: Record<string, number> = {};
    for (const table of tables) {
      try {
        const result = await db.execute(sql`SELECT COUNT(*)::int as count FROM ${sql.raw(`"${table}"`)}`);

        counts[table] = Number((result as any).rows?.[0]?.count ?? 0);
      } catch {
        counts[table] = -1; // table doesn't exist yet
      }
    }

    // Also check enriched columns on existing tables
    const enrichedChecks: Record<string, number> = {};
    try {
      const r = await db.execute(sql`SELECT COUNT(*)::int as count FROM clients WHERE legal_entity_name IS NOT NULL`);
      enrichedChecks["clients_enriched"] = Number((r as any).rows?.[0]?.count ?? 0);
    } catch { enrichedChecks["clients_enriched"] = -1; }
    try {
      const r = await db.execute(sql`SELECT COUNT(*)::int as count FROM project_info WHERE site_id IS NOT NULL`);
      enrichedChecks["projects_with_site"] = Number((r as any).rows?.[0]?.count ?? 0);
    } catch { enrichedChecks["projects_with_site"] = -1; }
    try {
      const r = await db.execute(sql`SELECT COUNT(*)::int as count FROM project_info WHERE opportunity_id IS NOT NULL`);
      enrichedChecks["projects_with_opportunity"] = Number((r as any).rows?.[0]?.count ?? 0);
    } catch { enrichedChecks["projects_with_opportunity"] = -1; }

    res.json({ tableCounts: counts, enrichedChecks, checkedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[Backfill] Status check failed:", err);
    res.status(500).json({ error: "Failed to check backfill status" });
  }
});

/**
 * POST /api/admin/backfill/sites-from-projects
 * Creates site records from distinct project locations.
 * Non-destructive: only creates sites that don't already exist.
 */
router.post("/api/admin/backfill/sites-from-projects", requireAuth, requirePermission("admin", "edit"), async (_req: Request, res: Response) => {
  try {
    // Extract distinct client+location combinations from projects that have clients
    const result = await db.execute(sql`
      INSERT INTO sites (client_id, site_name, status, created_at, updated_at)
      SELECT DISTINCT
        pi.client_id,
        COALESCE(c.name, pi.project_name) || ' Site',
        'active',
        NOW(),
        NOW()
      FROM project_info pi
      LEFT JOIN clients c ON c.id = pi.client_id
      WHERE pi.client_id IS NOT NULL
        AND pi.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM sites s WHERE s.client_id = pi.client_id
        )
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    const created = (result as any).rows?.length ?? 0;

    // Link projects to their client's site
    if (created > 0) {
      await db.execute(sql`
        UPDATE project_info pi
        SET site_id = s.id
        FROM sites s
        WHERE pi.client_id = s.client_id
          AND pi.site_id IS NULL
          AND pi.deleted_at IS NULL
      `);
    }

    const linkResult = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM project_info WHERE site_id IS NOT NULL
    `);
    const linked = Number((linkResult as any).rows?.[0]?.count ?? 0);

    res.json({
      sitesCreated: created,
      projectsLinked: linked,
      message: `Created ${created} sites and linked ${linked} projects`,
    });
  } catch (err) {
    console.error("[Backfill] Sites backfill failed:", err);
    res.status(500).json({ error: "Sites backfill failed" });
  }
});

/**
 * POST /api/admin/backfill/opportunities-from-pd-tickets
 * Creates opportunity records from PD tickets that have handover data.
 * Non-destructive: only creates opportunities that don't already exist.
 */
router.post("/api/admin/backfill/opportunities-from-pd-tickets", requireAuth, requirePermission("admin", "edit"), async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      INSERT INTO opportunities (client_id, stage, notes, status, created_at, updated_at)
      SELECT DISTINCT
        pt.client_id,
        CASE
          WHEN pt.status = 'accepted' THEN 'won'
          WHEN pt.status = 'submitted' THEN 'negotiation'
          WHEN pt.status = 'in_progress' THEN 'proposal'
          ELSE 'prospect'
        END,
        'Auto-created from PD ticket: ' || pt.title,
        'active',
        NOW(),
        NOW()
      FROM pd_tickets pt
      WHERE pt.client_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM opportunities o WHERE o.client_id = pt.client_id
        )
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    const created = (result as any).rows?.length ?? 0;

    // Link PD tickets to opportunities
    if (created > 0) {
      await db.execute(sql`
        UPDATE pd_tickets pt
        SET opportunity_id = o.id
        FROM opportunities o
        WHERE pt.client_id = o.client_id
          AND pt.opportunity_id IS NULL
      `);
    }

    const linkResult = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM pd_tickets WHERE opportunity_id IS NOT NULL
    `);
    const linked = Number((linkResult as any).rows?.[0]?.count ?? 0);

    res.json({
      opportunitiesCreated: created,
      ticketsLinked: linked,
      message: `Created ${created} opportunities and linked ${linked} PD tickets`,
    });
  } catch (err) {
    console.error("[Backfill] Opportunities backfill failed:", err);
    res.status(500).json({ error: "Opportunities backfill failed" });
  }
});

export function registerDataBackfillRoutes(app: Express) {
  app.use(router);
}
