/**
 * Parties Registry API — Wave 1 (reads) + Wave 2 (writes)
 *
 * Reads and writes to core.parties (promoted schema) to provide a unified view
 * of all business relationships (clients, suppliers, subcontractors, internal staff).
 *
 * Guardrail 1: This is a locked API contract. New screens must use this, not legacy routes.
 * Guardrail 5: Write authority controlled via checkPermission middleware.
 */

import { Router, type Request, type Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { checkPermission, requireAuth } from "../middleware/check-permission";

const router = Router();

/**
 * GET /api/parties
 *
 * Returns unified party list from core.parties.
 * Supports filtering by party_kind and search by name.
 */
router.get("/api/parties", requireAuth, checkPermission("counterparties", "view"), async (req: Request, res: Response) => {
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
router.get("/api/parties/:id", requireAuth, checkPermission("counterparties", "view"), async (req: Request, res: Response) => {
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
router.get("/api/parties/kinds", requireAuth, checkPermission("counterparties", "view"), async (_req: Request, res: Response) => {
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

// ─── Wave 2: Write Endpoints ─────────────────────────────────────

/**
 * POST /api/parties
 *
 * Creates a new party in core.parties.
 * Syncs to legacy clients/counterparties table via bridge writer.
 */
router.post("/api/parties", requireAuth, checkPermission("counterparties", "create"), async (req: Request, res: Response) => {
  try {
    const { name, partyKind, partyType, legalName, contactPerson, contactEmail, contactPhone, vatNumber, registrationNumber } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const result = await db.execute(sql`
      INSERT INTO core.parties (name_canonical, party_kind, party_type, legal_name, contact_person, contact_email, contact_phone, vat_number, registration_number, is_active)
      VALUES (${name}, ${partyKind || 'organisation'}, ${partyType || 'supplier'}, ${legalName || null}, ${contactPerson || null}, ${contactEmail || null}, ${contactPhone || null}, ${vatNumber || null}, ${registrationNumber || null}, true)
      RETURNING *
    `);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("[Parties] Failed to create:", err);
    res.status(500).json({ error: "Failed to create party" });
  }
});

/**
 * PATCH /api/parties/:id
 *
 * Updates an existing party.
 */
router.patch("/api/parties/:id", requireAuth, checkPermission("counterparties", "edit"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid party ID" });

    const { name, legalName, contactPerson, contactEmail, contactPhone, vatNumber, registrationNumber, partyKind, isActive } = req.body;

    // Update all mutable fields — null values clear the field
    const result = await db.execute(sql`
      UPDATE core.parties SET
        name_canonical = COALESCE(${name ?? null}, name_canonical),
        legal_name = CASE WHEN ${name !== undefined} THEN ${legalName ?? null} ELSE legal_name END,
        contact_person = CASE WHEN ${contactPerson !== undefined} THEN ${contactPerson ?? null} ELSE contact_person END,
        contact_email = CASE WHEN ${contactEmail !== undefined} THEN ${contactEmail ?? null} ELSE contact_email END,
        contact_phone = CASE WHEN ${contactPhone !== undefined} THEN ${contactPhone ?? null} ELSE contact_phone END,
        vat_number = CASE WHEN ${vatNumber !== undefined} THEN ${vatNumber ?? null} ELSE vat_number END,
        registration_number = CASE WHEN ${registrationNumber !== undefined} THEN ${registrationNumber ?? null} ELSE registration_number END,
        party_kind = CASE WHEN ${partyKind !== undefined} THEN ${partyKind ?? null} ELSE party_kind END,
        is_active = CASE WHEN ${isActive !== undefined} THEN ${isActive ?? true} ELSE is_active END
      WHERE id = ${id}
      RETURNING *
    `);

    if (result.rows.length === 0) return res.status(404).json({ error: "Party not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[Parties] Failed to update:", err);
    res.status(500).json({ error: "Failed to update party" });
  }
});

/**
 * POST /api/project-party-links
 *
 * Links a party to a project with a specific role.
 */
router.post("/api/project-party-links", requireAuth, checkPermission("projects", "edit"), async (req: Request, res: Response) => {
  try {
    const { projectInstanceId, partyId, role } = req.body;
    if (!projectInstanceId || !partyId || !role) {
      return res.status(400).json({ error: "projectInstanceId, partyId, and role are required" });
    }

    const result = await db.execute(sql`
      INSERT INTO core.project_party_links (project_instance_id, party_id, role)
      VALUES (${projectInstanceId}, ${partyId}, ${role})
      ON CONFLICT (project_instance_id, party_id, role) DO NOTHING
      RETURNING *
    `);

    if (result.rows.length === 0) {
      return res.status(409).json({ error: "Link already exists" });
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("[Parties] Failed to create project party link:", err);
    res.status(500).json({ error: "Failed to create project party link" });
  }
});

/**
 * GET /api/project-party-links
 *
 * Returns party links for a project.
 */
router.get("/api/project-party-links", requireAuth, checkPermission("projects", "view"), async (req: Request, res: Response) => {
  try {
    const projectInstanceId = parseInt(req.query.projectInstanceId as string);
    if (isNaN(projectInstanceId)) return res.status(400).json({ error: "projectInstanceId is required" });

    const result = await db.execute(sql`
      SELECT
        ppl.id,
        ppl.project_instance_id,
        ppl.party_id,
        ppl.role,
        p.name_canonical AS party_name,
        p.party_kind,
        p.contact_email
      FROM core.project_party_links ppl
      JOIN core.parties p ON p.id = ppl.party_id
      WHERE ppl.project_instance_id = ${projectInstanceId}
      ORDER BY ppl.role, p.name_canonical
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("[Parties] Failed to fetch project party links:", err);
    res.status(500).json({ error: "Failed to fetch project party links" });
  }
});

/**
 * DELETE /api/project-party-links/:id
 *
 * Removes a project-party link.
 */
router.delete("/api/project-party-links/:id", requireAuth, checkPermission("projects", "edit"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid link ID" });

    const result = await db.execute(sql`
      DELETE FROM core.project_party_links WHERE id = ${id} RETURNING id
    `);

    if (result.rows.length === 0) return res.status(404).json({ error: "Link not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error("[Parties] Failed to delete project party link:", err);
    res.status(500).json({ error: "Failed to delete project party link" });
  }
});

export function registerPartiesRoutes(app: import("express").Express) {
  app.use(router);
}

export default router;
