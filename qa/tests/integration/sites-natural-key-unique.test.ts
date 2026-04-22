/**
 * Integration test for migration 0022_sites_pdtickets_natural_key_uniques.sql
 * (sites portion).
 *
 * Verifies the partial UNIQUE index `sites_client_site_name_uniq`:
 *   1. Is present on the `sites` table.
 *   2. Raises a Postgres unique_violation (SQLSTATE 23505) when a second
 *      live (deleted_at IS NULL) row tries to claim the same
 *      (client_id, site_name) pair.
 *   3. Still allows multiple sites per client+name when the duplicates
 *      are soft-deleted (the index is partial — soft-deleted rows
 *      must not block recreation of an active site for the same
 *      natural key).
 *   4. Still allows multiple sites with NULL client_id (the partial
 *      filter excludes them so app-owned, unattributed sites remain
 *      insertable without colliding).
 *
 * This is the defence-in-depth guarantee described in task #40 — the
 * application-side checks in `data-backfill-routes.ts` and the
 * `POST /api/sites` route protect the happy path; this index makes it
 * impossible for any future code path (manual SQL, a forgotten admin
 * endpoint, a one-off script, a future PD-driven site sync) to create
 * duplicate live sites for the same client+name.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("sites_client_site_name_uniq partial unique index", () => {
  let pool: pg.Pool;
  let testClientId: number;
  // Recognisably-fake site names so we can't possibly collide with real rows.
  const SUFFIX = `${process.pid}_${Date.now()}`;
  const SITE_LIVE = `__test_site_live_${SUFFIX}`;
  const SITE_SOFTDEL = `__test_site_softdel_${SUFFIX}`;
  const SITE_NULL_CLIENT = `__test_site_nullclient_${SUFFIX}`;
  const TEST_CLIENT_ID = `__test_sites_uniq_${SUFFIX}`;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO clients (client_id, name) VALUES ($1, $2) RETURNING id`,
      [TEST_CLIENT_ID, "Sites Uniqueness Test Client"],
    );
    testClientId = rows[0].id;
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(
        `DELETE FROM sites WHERE site_name = ANY($1::text[])`,
        [[SITE_LIVE, SITE_SOFTDEL, SITE_NULL_CLIENT]],
      );
      await pool.query(`DELETE FROM clients WHERE client_id = $1`, [
        TEST_CLIENT_ID,
      ]);
      await pool.end();
    }
  });

  it("the partial unique index exists on sites(client_id, site_name)", async () => {
    const { rows } = await pool.query<{
      indexname: string;
      indexdef: string;
    }>(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'sites'
          AND indexname = 'sites_client_site_name_uniq'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/UNIQUE/i);
    expect(rows[0].indexdef).toMatch(/client_id/);
    expect(rows[0].indexdef).toMatch(/site_name/);
    // Partial: must filter on deleted_at IS NULL so soft-deleted rows
    // don't block re-creation of a site for the same natural key.
    expect(rows[0].indexdef).toMatch(/WHERE .*deleted_at IS NULL/i);
  });

  it("raises a unique-violation when a second live site claims the same (client_id, site_name)", async () => {
    await pool.query(
      `INSERT INTO sites (client_id, site_name) VALUES ($1, $2)`,
      [testClientId, SITE_LIVE],
    );

    type PgError = Error & { code?: string; constraint?: string };
    let err: PgError | null = null;
    try {
      await pool.query(
        `INSERT INTO sites (client_id, site_name) VALUES ($1, $2)`,
        [testClientId, SITE_LIVE],
      );
    } catch (e) {
      err = e as PgError;
    }

    expect(err).not.toBeNull();
    expect(err?.code).toBe("23505");
    expect(String(err?.constraint ?? err?.message ?? "")).toMatch(
      /sites_client_site_name_uniq/,
    );
  });

  it("still allows re-creating a site for the same client+name once the original is soft-deleted", async () => {
    // First insert + soft-delete
    const { rows: r1 } = await pool.query<{ id: number }>(
      `INSERT INTO sites (client_id, site_name) VALUES ($1, $2) RETURNING id`,
      [testClientId, SITE_SOFTDEL],
    );
    await pool.query(`UPDATE sites SET deleted_at = NOW() WHERE id = $1`, [
      r1[0].id,
    ]);

    // A new live row with the same (client_id, site_name) MUST be allowed —
    // the partial index excludes soft-deleted rows so this is the
    // intended behaviour, and a non-partial UNIQUE would have blocked it.
    await expect(
      pool.query(
        `INSERT INTO sites (client_id, site_name) VALUES ($1, $2)`,
        [testClientId, SITE_SOFTDEL],
      ),
    ).resolves.toBeDefined();
  });

  it("still allows multiple sites with NULL client_id (partial index excludes them)", async () => {
    // Two app-owned sites without a client must coexist — the partial
    // filter requires client_id IS NOT NULL, so neither row is covered.
    await pool.query(`INSERT INTO sites (client_id, site_name) VALUES (NULL, $1)`, [
      SITE_NULL_CLIENT,
    ]);
    await pool.query(`INSERT INTO sites (client_id, site_name) VALUES (NULL, $1)`, [
      SITE_NULL_CLIENT,
    ]);

    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sites WHERE site_name = $1 AND client_id IS NULL`,
      [SITE_NULL_CLIENT],
    );
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(2);
  });
});
