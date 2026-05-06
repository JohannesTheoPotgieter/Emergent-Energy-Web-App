/**
 * Integration test for migration 0018_clients_unique_pipedrive_org.sql.
 *
 * Verifies the partial UNIQUE index `clients_pipedrive_org_id_uniq`:
 *   1. Is present on the `clients` table.
 *   2. Raises a Postgres unique_violation (SQLSTATE 23505) when a second
 *      row tries to claim the same `pipedrive_org_id`.
 *   3. Still allows multiple clients with NULL `pipedrive_org_id`
 *      (the index is partial — app-owned clients without a Pipedrive
 *      org id must remain insertable).
 *
 * This is the defence-in-depth guarantee called out in task #31: the
 * Pipedrive sync's advisory-locked transaction protects against races
 * at the application layer, but this index makes it impossible for any
 * future code path (manual SQL, a forgotten admin endpoint, a one-off
 * script) to create duplicate client rows for the same Pipedrive org.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("clients_pipedrive_org_id_uniq partial unique index", () => {
  let pool: pg.Pool;
  // Use a recognisably-fake org id outside the range Pipedrive ever issues
  // so we can't possibly collide with a real client row.
  const ORG_ID = `__test_pd_org_${process.pid}_${Date.now()}`;
  const CLIENT_A = `__test_client_a_${process.pid}_${Date.now()}`;
  const CLIENT_B = `__test_client_b_${process.pid}_${Date.now()}`;
  const CLIENT_NULL_1 = `__test_client_null1_${process.pid}_${Date.now()}`;
  const CLIENT_NULL_2 = `__test_client_null2_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(
        `DELETE FROM clients WHERE client_id = ANY($1::text[])`,
        [[CLIENT_A, CLIENT_B, CLIENT_NULL_1, CLIENT_NULL_2]],
      );
      await pool.end();
    }
  });

  it("the partial unique index exists on clients(pipedrive_org_id)", async () => {
    const { rows } = await pool.query<{
      indexname: string;
      indexdef: string;
    }>(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'clients'
          AND indexname = 'clients_pipedrive_org_id_uniq'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/UNIQUE/i);
    expect(rows[0].indexdef).toMatch(/pipedrive_org_id/);
    // Partial: it must filter on NOT NULL so app-owned clients aren't
    // covered.
    expect(rows[0].indexdef).toMatch(/WHERE .*pipedrive_org_id IS NOT NULL/i);
  });

  it("raises a unique-violation when a second client claims the same pipedrive_org_id", async () => {
    await pool.query(
      `INSERT INTO clients (client_id, name, pipedrive_org_id) VALUES ($1, $2, $3)`,
      [CLIENT_A, "Test Client A", ORG_ID],
    );

    type PgError = Error & { code?: string; constraint?: string };
    let err: PgError | null = null;
    try {
      await pool.query(
        `INSERT INTO clients (client_id, name, pipedrive_org_id) VALUES ($1, $2, $3)`,
        [CLIENT_B, "Test Client B", ORG_ID],
      );
    } catch (e) {
      err = e as PgError;
    }

    expect(err).not.toBeNull();
    // 23505 = unique_violation. Asserting on the SQLSTATE keeps the test
    // resilient to Postgres wording changes across versions.
    expect(err?.code).toBe("23505");
    expect(String(err?.constraint ?? err?.message ?? "")).toMatch(
      /clients_pipedrive_org_id_uniq/,
    );
  });

  it("still allows multiple clients with NULL pipedrive_org_id (partial index)", async () => {
    // Two app-owned clients without a Pipedrive org id must coexist —
    // a non-partial UNIQUE would have rejected the second row.
    await pool.query(
      `INSERT INTO clients (client_id, name, pipedrive_org_id) VALUES ($1, $2, NULL)`,
      [CLIENT_NULL_1, "App-owned Client 1"],
    );
    await pool.query(
      `INSERT INTO clients (client_id, name, pipedrive_org_id) VALUES ($1, $2, NULL)`,
      [CLIENT_NULL_2, "App-owned Client 2"],
    );

    const { rows } = await pool.query<{ client_id: string }>(
      `SELECT client_id FROM clients WHERE client_id = ANY($1::text[]) ORDER BY client_id`,
      [[CLIENT_NULL_1, CLIENT_NULL_2]],
    );
    expect(rows.map((r) => r.client_id)).toEqual(
      [CLIENT_NULL_1, CLIENT_NULL_2].sort(),
    );
  });
});
