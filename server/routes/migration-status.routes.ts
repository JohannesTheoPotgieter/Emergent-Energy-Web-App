/**
 * Admin Migration Status API — Wave 1 Step 5
 *
 * Aggregates migration progress across all phases (A-H).
 * Reads from promoted schema tables and legacy tables to compute parity.
 *
 * READ-ONLY. Uses existing reconciliation infrastructure.
 */

import { Router, type Request, type Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { checkPermission, requireAuth } from "../middleware/check-permission";

const router = Router();

interface DomainStatus {
  domain: string;
  promotedTable: string;
  legacyTable: string;
  promotedCount: number;
  legacyCount: number;
  parity: boolean;
  wave: string;
}

/**
 * GET /api/admin/migration-status
 *
 * Returns per-domain migration progress showing promoted vs legacy row counts.
 */
router.get("/api/admin/migration-status", requireAuth, checkPermission("admin", "view"), async (req: Request, res: Response) => {
  try {

    // Count rows in promoted vs legacy tables for each domain
    const domains: DomainStatus[] = [];

    const queries: Array<{ domain: string; promoted: string; legacy: string; wave: string }> = [
      { domain: "Parties", promoted: "core.parties", legacy: "public.clients", wave: "Wave 2" },
      { domain: "User Accounts", promoted: "core.user_accounts", legacy: "public.users", wave: "Wave 2" },
      { domain: "Project Instances", promoted: "core.project_instances", legacy: "public.project_info", wave: "Wave 2" },
      { domain: "Project Info", promoted: "core.projects", legacy: "public.project_info", wave: "Wave 2" },
      { domain: "Work Packages", promoted: "core.work_packages", legacy: "(derived)", wave: "Wave 2" },
      { domain: "Work Items", promoted: "core.work_items_clean", legacy: "public.work_items", wave: "Wave 2" },
      { domain: "Governed Processes", promoted: "core.governed_processes", legacy: "(derived)", wave: "Wave 3" },
      { domain: "Deliverable Definitions", promoted: "documentation.deliverable_definitions", legacy: "(derived)", wave: "Wave 4" },
      { domain: "Approval Rules", promoted: "documentation.approval_rules", legacy: "(derived)", wave: "Wave 4" },
      { domain: "Approval Instances", promoted: "documentation.document_approvals", legacy: "public.approvals", wave: "Wave 4" },
      { domain: "Finance Records", promoted: "finance.finance_records", legacy: "(aggregated)", wave: "Wave 5" },
      { domain: "Budget Lines", promoted: "finance.budget_lines", legacy: "(derived)", wave: "Wave 5" },
      { domain: "External Resources", promoted: "documentation.external_resources", legacy: "(new)", wave: "Wave 4-5" },
      { domain: "Activity Log", promoted: "internal.activity_log", legacy: "(new)", wave: "Wave 2" },
    ];

    for (const q of queries) {
      try {
        const promotedResult = await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM ${q.promoted}`));
        const promotedCount = (promotedResult.rows[0] as { cnt: number })?.cnt ?? 0;

        let legacyCount = 0;
        if (!q.legacy.startsWith("(")) {
          const legacyResult = await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM ${q.legacy}`));
          legacyCount = (legacyResult.rows[0] as { cnt: number })?.cnt ?? 0;
        }

        domains.push({
          domain: q.domain,
          promotedTable: q.promoted,
          legacyTable: q.legacy,
          promotedCount,
          legacyCount,
          parity: q.legacy.startsWith("(") || promotedCount >= legacyCount,
          wave: q.wave,
        });
      } catch {
        // Table may not exist yet — mark as 0
        domains.push({
          domain: q.domain,
          promotedTable: q.promoted,
          legacyTable: q.legacy,
          promotedCount: 0,
          legacyCount: 0,
          parity: false,
          wave: q.wave,
        });
      }
    }

    // Wave status summary
    const waves = [
      { wave: "Wave 0", label: "Design Decisions", status: "complete" },
      { wave: "Wave 1", label: "Shell + Control Pack", status: "complete" },
      { wave: "Wave 2", label: "Core Master Objects", status: "complete" },
      { wave: "Wave 3", label: "Governed Processes", status: "complete" },
      { wave: "Wave 4", label: "Deliverables + Approvals", status: "complete" },
      { wave: "Wave 5", label: "Transactional Finance", status: "complete" },
      { wave: "Wave 6", label: "Compatibility Cleanup", status: "complete" },
    ];

    res.json({ domains, waves });
  } catch (err) {
    console.error("[MigrationStatus] Failed:", err);
    res.status(500).json({ error: "Failed to fetch migration status" });
  }
});

export function registerMigrationStatusRoutes(app: import("express").Express) {
  app.use(router);
}

export default router;
