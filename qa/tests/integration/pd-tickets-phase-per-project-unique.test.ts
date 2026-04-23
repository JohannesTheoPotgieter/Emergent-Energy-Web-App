/**
 * Integration test for migration 0022_sites_pdtickets_natural_key_uniques.sql
 * (pd_tickets portion).
 *
 * Verifies the partial UNIQUE index `pd_tickets_phase_per_project_uniq`:
 *   1. Is present on the `pd_tickets` table.
 *   2. Raises a Postgres unique_violation (SQLSTATE 23505) when a second
 *      live (deleted_at IS NULL) ticket tries to claim the same
 *      (opportunity_id, project_id, request_type) tuple — exactly the
 *      same-phase-duplicate case the application-only
 *      `countSamePhaseTickets` check guards today.
 *   3. Still allows recreation of a same-phase ticket once the original
 *      is soft-deleted (the index is partial — soft-deleted rows must
 *      not block recreation).
 *   4. Still allows tickets with NULL project_id (shadow tickets
 *      covered by the separate `pd_tickets_opportunity_shadow_unique`
 *      index — this index is intentionally orthogonal to that one).
 *
 * This is the defence-in-depth guarantee described in task #40 — the
 * application-side check in `opportunities-repository.ts` protects the
 * happy path; this index makes it impossible for any future code path
 * (manual SQL, a forgotten admin endpoint, a one-off script) to create
 * two live PD tickets for the same (opportunity, project, request_type).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("pd_tickets_phase_per_project_uniq partial unique index", () => {
  let pool: pg.Pool;
  let clientId: number;
  let opportunityId: number;
  let projectId: number;
  const SUFFIX = `${process.pid}_${Date.now()}`;
  const TEST_CLIENT_ID = `__test_pdt_uniq_${SUFFIX}`;
  const REQUEST_TYPE = "Cost Proposal";
  const PROJECT_SITE_NAME = `__test_pdt_site_${SUFFIX}`;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });

    const { rows: cRows } = await pool.query<{ id: number }>(
      `INSERT INTO clients (client_id, name) VALUES ($1, $2) RETURNING id`,
      [TEST_CLIENT_ID, "PD Tickets Uniqueness Test Client"],
    );
    clientId = cRows[0].id;

    const { rows: oRows } = await pool.query<{ id: number }>(
      `INSERT INTO opportunities (client_id, source, status)
       VALUES ($1, 'internal', 'active') RETURNING id`,
      [clientId],
    );
    opportunityId = oRows[0].id;

    const { rows: pRows } = await pool.query<{ id: number }>(
      `INSERT INTO project_info (project_name, client_id)
       VALUES ($1, $2) RETURNING id`,
      [`__test_pdt_proj_${SUFFIX}`, clientId],
    );
    projectId = pRows[0].id;
  });

  afterAll(async () => {
    if (pool) {
      // Order matters: drop dependents first.
      await pool.query(
        `DELETE FROM pd_tickets WHERE project_site_name = $1`,
        [PROJECT_SITE_NAME],
      );
      if (projectId) {
        await pool.query(`DELETE FROM project_info WHERE id = $1`, [projectId]);
      }
      if (opportunityId) {
        await pool.query(`DELETE FROM opportunities WHERE id = $1`, [
          opportunityId,
        ]);
      }
      await pool.query(`DELETE FROM clients WHERE client_id = $1`, [
        TEST_CLIENT_ID,
      ]);
      await pool.end();
    }
  });

  it("the partial unique index exists on pd_tickets(opportunity_id, project_id, request_type)", async () => {
    const { rows } = await pool.query<{
      indexname: string;
      indexdef: string;
    }>(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'pd_tickets'
          AND indexname = 'pd_tickets_phase_per_project_uniq'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/UNIQUE/i);
    expect(rows[0].indexdef).toMatch(/opportunity_id/);
    expect(rows[0].indexdef).toMatch(/project_id/);
    expect(rows[0].indexdef).toMatch(/request_type/);
    expect(rows[0].indexdef).toMatch(/WHERE .*deleted_at IS NULL/i);
  });

  it("raises a unique-violation when a second live ticket claims the same (opportunity, project, request_type)", async () => {
    await pool.query(
      `INSERT INTO pd_tickets (opportunity_id, project_id, project_site_name, request_type, priority, status)
       VALUES ($1, $2, $3, $4, 'Medium', 'to_do')`,
      [opportunityId, projectId, PROJECT_SITE_NAME, REQUEST_TYPE],
    );

    type PgError = Error & { code?: string; constraint?: string };
    let err: PgError | null = null;
    try {
      await pool.query(
        `INSERT INTO pd_tickets (opportunity_id, project_id, project_site_name, request_type, priority, status)
         VALUES ($1, $2, $3, $4, 'Medium', 'to_do')`,
        [opportunityId, projectId, PROJECT_SITE_NAME, REQUEST_TYPE],
      );
    } catch (e) {
      err = e as PgError;
    }

    expect(err).not.toBeNull();
    expect(err?.code).toBe("23505");
    expect(String(err?.constraint ?? err?.message ?? "")).toMatch(
      /pd_tickets_phase_per_project_uniq/,
    );
  });

  it("still allows recreating a same-phase ticket once the original is soft-deleted", async () => {
    // Self-contained: use a distinct request_type so this test does not
    // depend on rows seeded by other tests in this file (or ordering).
    const ISOLATED_REQUEST_TYPE = `__test_softdel_${SUFFIX}`;

    // Seed the row this test will soft-delete.
    await pool.query(
      `INSERT INTO pd_tickets (opportunity_id, project_id, project_site_name, request_type, priority, status)
         VALUES ($1, $2, $3, $4, 'Medium', 'to_do')`,
      [opportunityId, projectId, PROJECT_SITE_NAME, ISOLATED_REQUEST_TYPE],
    );

    // Soft-delete the row we just inserted.
    await pool.query(
      `UPDATE pd_tickets
          SET deleted_at = NOW()
        WHERE opportunity_id = $1 AND project_id = $2 AND request_type = $3
          AND deleted_at IS NULL`,
      [opportunityId, projectId, ISOLATED_REQUEST_TYPE],
    );

    // A fresh live row for the same (opportunity, project, request_type)
    // MUST be allowed — the partial filter excludes soft-deleted rows.
    await expect(
      pool.query(
        `INSERT INTO pd_tickets (opportunity_id, project_id, project_site_name, request_type, priority, status)
         VALUES ($1, $2, $3, $4, 'Medium', 'to_do')`,
        [opportunityId, projectId, PROJECT_SITE_NAME, ISOLATED_REQUEST_TYPE],
      ),
    ).resolves.toBeDefined();
  });

  it("still allows tickets with NULL project_id (handled by the separate shadow index)", async () => {
    // Shadow tickets (project_id IS NULL) are covered by
    // pd_tickets_opportunity_shadow_unique, NOT this index — the partial
    // filter requires project_id IS NOT NULL. Confirm a row with NULL
    // project_id is unaffected by this index.
    await expect(
      pool.query(
        `INSERT INTO pd_tickets (opportunity_id, project_id, project_site_name, request_type, priority, status)
         VALUES ($1, NULL, $2, $3, 'Medium', 'to_do')
         ON CONFLICT DO NOTHING`,
        [opportunityId, PROJECT_SITE_NAME, REQUEST_TYPE],
      ),
    ).resolves.toBeDefined();
  });
});
