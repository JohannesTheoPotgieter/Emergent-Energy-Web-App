/**
 * Task #83 — `GET /api/opportunities/:id/workflow` must return `pd: null`
 * (not undefined, not a 404, not a lazy-spawned shadow row) when the
 * opportunity has no engineering shadow ticket.
 *
 * This test creates a deterministic fixture opportunity with no
 * `engineering_tickets` row, hits the workflow endpoint, asserts the
 * JSON contract that the drawer relies on, then cleans up. The
 * partner Playwright spec at `qa/tests/e2e/opportunity-drawer-no-shadow.spec.ts`
 * exercises the matching client-side render contract end-to-end.
 *
 * Bug context: before the fix, the server destructured
 * `[shadow] = await db.select()...` and put the resulting `undefined`
 * into the `pd` field. JSON.stringify dropped the key, the drawer's
 * `merged = data.pd ?? null` was therefore `null`, the gate
 * `isError || !data || !merged` fell through, and every opportunity
 * without a shadow showed "Could not load opportunity." Auto-spawn of
 * shadow tickets was deliberately removed 2026-04-23, so the
 * no-shadow case is now the common case — this test is the canonical
 * regression guard against the symptom returning.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE_URL = process.env.API_URL || "http://localhost:5000";

async function apiRequest(method: string, p: string, body?: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function loginAdmin(): Promise<string> {
  const res = await apiRequest("POST", "/api/auth/login", { username: "johannes", password: "2023" });
  expect(res.status, `login failed: ${JSON.stringify(res.data)}`).toBe(200);
  return res.data.token as string;
}

describe("Opportunity workflow returns pd: null when no engineering shadow exists (Task #83)", () => {
  let token: string;
  let pool: any;
  let fixtureOpportunityId: number;
  // Sentinel deal name that's both unique-per-run (timestamp) and easy
  // to identify if cleanup ever fails (the `TASK_83_NO_SHADOW_FIXTURE_`
  // prefix can be grepped/swept by hand).
  const sentinel = `TASK_83_NO_SHADOW_FIXTURE_${Date.now()}`;

  beforeAll(async () => {
    const { Pool } = await import("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    token = await loginAdmin();
    // Insert a minimal opportunity row owned by no-one. All NOT NULL
    // columns on `opportunities` have defaults (source='internal',
    // currency='ZAR', activities_count=0, status='active', deleted_at
    // null), so the only fields we set are the sentinel `deal_name`
    // (used for cleanup safety) and `notes` (a human-readable hint).
    const ins = await pool.query(
      `INSERT INTO opportunities (deal_name, notes)
            VALUES ($1, 'Created by qa/tests/integration/opportunity-drawer-no-shadow.test.ts (Task #83). Safe to delete.')
       RETURNING id`,
      [sentinel],
    );
    fixtureOpportunityId = ins.rows[0].id as number;
    // Belt-and-suspenders: confirm no engineering shadow exists for
    // this id. The Drizzle table `engineeringTickets` maps to the SQL
    // table `engineering_tickets`.
    const shadowCheck = await pool.query(
      `SELECT 1 FROM engineering_tickets WHERE opportunity_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [fixtureOpportunityId],
    );
    expect(shadowCheck.rowCount, "fixture pre-condition: opportunity must have NO engineering shadow ticket").toBe(0);
  });

  afterAll(async () => {
    if (pool && fixtureOpportunityId) {
      // Sweep any engineering shadow that may have been spawned by a
      // future regression of the auto-spawn removal — leaving the row
      // would re-create the historical lazy-create behaviour for the
      // next test run.
      await pool.query(`DELETE FROM engineering_tickets WHERE opportunity_id = $1`, [fixtureOpportunityId]).catch(() => {});
      await pool.query(`DELETE FROM opportunities WHERE id = $1`, [fixtureOpportunityId]).catch(() => {});
    }
    await pool?.end().catch(() => {});
  });

  it("requires authentication", async () => {
    const res = await apiRequest("GET", `/api/opportunities/${fixtureOpportunityId}/workflow`);
    expect([401, 403]).toContain(res.status);
  });

  it("returns pd: null, tasks: [], and the CRM block for an opportunity with no engineering shadow", async () => {
    const res = await apiRequest("GET", `/api/opportunities/${fixtureOpportunityId}/workflow`, undefined, token);
    expect(res.status, `expected 200 but got ${res.status}: ${JSON.stringify(res.data)}`).toBe(200);
    expect(res.data, "response body must not be empty").toBeTruthy();

    // The CRM block must always be present — that's the opportunity itself.
    expect(res.data.crm, "crm block missing — drawer relies on it for header / value / owner").toBeTruthy();
    expect(res.data.crm.id).toBe(fixtureOpportunityId);
    expect(res.data.crm.dealName).toBe(sentinel);

    // The PD block MUST be exactly null (not undefined, not a lazily
    // auto-spawned shadow row). This is the contract the drawer
    // depends on after the Task #83 fix.
    expect(res.data.pd, "pd must be null when no engineering shadow ticket exists").toBeNull();

    // Tasks must be an array (not undefined) — the drawer calls
    // .length on it unconditionally.
    expect(Array.isArray(res.data.tasks), "tasks must be an array").toBe(true);
    expect(res.data.tasks.length).toBe(0);

    // tickets is also an array on the contract; for an opportunity
    // with no shadow there is no engineering ticket to list.
    expect(Array.isArray(res.data.tickets ?? []), "tickets must be an array (or omitted)").toBe(true);
  });
});
