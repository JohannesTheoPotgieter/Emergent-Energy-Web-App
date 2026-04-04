/**
 * Parties Registry API — Wave 1 Step 3
 *
 * Reads from core.parties (promoted schema) to provide a unified view
 * of all business relationships (clients, suppliers, subcontractors, internal staff).
 *
 * READ-ONLY in Wave 1. Write endpoints added in Wave 2.
 *
 * Guardrail 1: This is a locked API contract. New screens must use this, not legacy routes.
 * Guardrail 5: Read-only — no write authority until party entity is fully wired.
 */

import { Router, type Request, type Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";

const router = Router();

/**
 * GET /api/parties
 *
 * Returns unified party list from core.parties.
 * Supports filtering by party_kind and search by name.
 */
router.get("/api/parties", async (req: Request, res: Response) => {
  try {
    const kind = req.query.kind as string | undefined;
    const search = req.query.search as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;

    let whereClause = sql`WHERE p.is_active = true`;
    if (kind) {
      whereClause = sql`${whereClause} AND p.party_kind = ${kind}`;
    }
    if (search) {
      whereClause = sql`${whereClause} AND p.name_canonical ILIKE ${'%' + search + '%'}`;
    }

    const rows = await db.execute(sql`
      SELECT
        p.id,
        p.party_type,
        p.party_kind,
        p.name_canonical AS name,
        p.legal_name,
        p.contact_person,
        p.contact_email,
        p.contact_phone,
        p.vat_number,
        p.is_active,
        p.legacy_client_id,
        p.legacy_counterparty_id,
        p.legacy_user_id,
        (
          SELECT COUNT(*)::int
          FROM core.project_party_links ppl
          WHERE ppl.party_id = p.id
        ) AS project_count
      FROM core.parties p
      ${whereClause}
      ORDER BY p.name_canonical ASC
      LIMIT ${limit} OFFSET ${offset}
    `);

    // Get total count for pagination
    const countResult = await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM core.parties p
      ${whereClause}
    `);

    res.json({
      parties: rows.rows,
      total: (countResult.rows[0] as { total: number })?.total ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error("[Parties] Failed to list:", err);
    res.status(500).json({ error: "Failed to fetch parties" });
  }
});

/**
 * GET /api/parties/:id
 *
 * Returns detail for a specific party, including linked projects.
 */
router.get("/api/parties/:id", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid party ID" });

    const partyResult = await db.execute(sql`
      SELECT
        p.id,
        p.party_type,
        p.party_kind,
        p.name_canonical AS name,
        p.legal_name,
        p.name_aliases,
        p.contact_person,
        p.contact_email,
        p.contact_phone,
        p.vat_number,
        p.registration_number,
        p.is_active,
        p.legacy_client_id,
        p.legacy_counterparty_id,
        p.legacy_user_id
      FROM core.parties p
      WHERE p.id = ${id}
    `);

    if (partyResult.rows.length === 0) {
      return res.status(404).json({ error: "Party not found" });
    }

    // Get linked projects
    const projectLinks = await db.execute(sql`
      SELECT
        ppl.role,
        pi.id AS project_instance_id,
        proj.project_name,
        pi.status AS project_status,
        pd.name AS current_phase
      FROM core.project_party_links ppl
      JOIN core.project_instances pi ON pi.id = ppl.project_instance_id
      JOIN core.projects proj ON proj.id = pi.legacy_project_id
      LEFT JOIN core.phase_definitions pd ON pd.id = pi.current_phase_definition_id
      WHERE ppl.party_id = ${id}
      ORDER BY proj.project_name ASC
    `);

    res.json({
      party: partyResult.rows[0],
      projectLinks: projectLinks.rows,
    });
  } catch (err) {
    console.error("[Parties] Failed to fetch detail:", err);
    res.status(500).json({ error: "Failed to fetch party detail" });
  }
});

/**
 * GET /api/parties/kinds
 *
 * Returns distinct party_kind values for filter dropdowns.
 */
router.get("/api/parties/kinds", async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT party_kind, COUNT(*)::int AS count
      FROM core.parties
      WHERE is_active = true AND party_kind IS NOT NULL
      GROUP BY party_kind
      ORDER BY party_kind
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("[Parties] Failed to fetch kinds:", err);
    res.status(500).json({ error: "Failed to fetch party kinds" });
  }
});

export function registerPartiesRoutes(app: import("express").Express) {
  app.use(router);
}

export default router;
