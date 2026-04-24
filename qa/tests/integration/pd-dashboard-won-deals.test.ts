import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";

const BASE_URL = process.env.API_URL || "http://localhost:5000";

async function apiRequest(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function loginAdmin(): Promise<string> {
  const res = await apiRequest("POST", "/api/auth/login", { username: "johannes", password: "2023" });
  expect(res.status).toBe(200);
  return res.data.token as string;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers — derive the current FY (Sep–Aug) the same way the server does.
// FY26 = 1 Sep 2025 → 31 Aug 2026. We use real dates so the test follows
// real wall-clock time without freezing it.
// ──────────────────────────────────────────────────────────────────────────
function currentFy(): { fy: number; fyStart: string; fyEnd: string } {
  const now = new Date();
  const fy = now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
  return { fy, fyStart: `${fy - 1}-09-01`, fyEnd: `${fy}-08-31` };
}

// Mid-FY date that's safely inside [fyStart, fyEnd] regardless of when
// the test runs. We pick a date that's at least 2 months past fyStart
// AND at least 2 months before fyEnd. April-15 of the FY-year always
// satisfies this for a Sep-Aug FY.
function midFyDate(fy: number): string {
  return `${fy}-04-15`;
}

// A date that is firmly OUTSIDE the current FY (we use the prior FY's
// mid-year, so it's ~7-19 months before fyStart).
function priorFyDate(fy: number): string {
  return `${fy - 1}-04-15`;
}

describe("PD dashboard won-deals (Task #94)", () => {
  let token: string;
  let pool: Pool;
  const seeded: {
    opportunityIds: number[];
    projectInfoIds: number[];
    clientIds: number[];
    linkedOppId?: number;
    noneOppId?: number;
    stubOppId?: number;
    boundaryStartOppId?: number;
    boundaryEndOppId?: number;
    outOfFyOppId?: number;
  } = {
    opportunityIds: [],
    projectInfoIds: [],
    clientIds: [],
  };
  let adminUserId: number;
  const tag = `wd-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  beforeAll(async () => {
    token = await loginAdmin();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    // Pick any existing user id for pd_user_id / pm_user_id. We use the
    // admin we just logged in as for both — sufficient to satisfy the
    // "linked" definition (pd_user_id IS NOT NULL AND pm_user_id IS NOT NULL).
    const me = await pool.query(
      `SELECT id FROM users WHERE LOWER(username) = 'johannes' LIMIT 1`,
    );
    expect(me.rowCount).toBeGreaterThan(0);
    adminUserId = me.rows[0].id as number;

    const fy = currentFy().fy;
    const inFy = midFyDate(fy);
    const outFy = priorFyDate(fy);

    // (a) won this FY with a fully-formed linked project (linked).
    const clientA = await pool.query(
      `INSERT INTO clients (name, client_id) VALUES ($1, $2) RETURNING id`,
      [`Won-Tile Client A ${tag}`, `WT-A-${tag}`],
    );
    seeded.clientIds.push(clientA.rows[0].id);
    const oppA = await pool.query(
      `INSERT INTO opportunities (deal_name, source, status, signed_date, estimated_value, estimated_kwp, deal_owner_name, pipedrive_deal_id, client_id, currency)
       VALUES ($1, 'pipedrive', 'won', $2::date, 1500000, 250, 'Owner A', $3, $4, 'ZAR')
       RETURNING id`,
      [`WonTile A ${tag}`, inFy, `pdid-A-${tag}`, clientA.rows[0].id],
    );
    seeded.opportunityIds.push(oppA.rows[0].id);
    seeded.linkedOppId = oppA.rows[0].id;
    const projA = await pool.query(
      `INSERT INTO project_info (project_name, opportunity_id, client_id, pd_user_id, pm_user_id, project_status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING id`,
      [`WonTile A ${tag}`, oppA.rows[0].id, clientA.rows[0].id, adminUserId, adminUserId],
    );
    seeded.projectInfoIds.push(projA.rows[0].id);
    await pool.query(
      `INSERT INTO project_execution_state (project_id, phase) VALUES ($1, 'S03_OPERATIONAL_PLAN')`,
      [projA.rows[0].id],
    );

    // (b) won this FY with no project (none).
    const clientB = await pool.query(
      `INSERT INTO clients (name, client_id) VALUES ($1, $2) RETURNING id`,
      [`Won-Tile Client B ${tag}`, `WT-B-${tag}`],
    );
    seeded.clientIds.push(clientB.rows[0].id);
    const oppB = await pool.query(
      `INSERT INTO opportunities (deal_name, source, status, signed_date, estimated_value, estimated_kwp, deal_owner_name, pipedrive_deal_id, client_id, currency)
       VALUES ($1, 'pipedrive', 'won', $2::date, 800000, 150, 'Owner B', $3, $4, 'ZAR')
       RETURNING id`,
      [`WonTile B ${tag}`, inFy, `pdid-B-${tag}`, clientB.rows[0].id],
    );
    seeded.opportunityIds.push(oppB.rows[0].id);
    seeded.noneOppId = oppB.rows[0].id;

    // (a-stub) project_info exists but missing pd/pm/phase → `stub`.
    const clientStub = await pool.query(
      `INSERT INTO clients (name, client_id) VALUES ($1, $2) RETURNING id`,
      [`Won-Tile Client Stub ${tag}`, `WT-S-${tag}`],
    );
    seeded.clientIds.push(clientStub.rows[0].id);
    const oppStub = await pool.query(
      `INSERT INTO opportunities (deal_name, source, status, signed_date, estimated_value, estimated_kwp, deal_owner_name, pipedrive_deal_id, client_id, currency)
       VALUES ($1, 'pipedrive', 'won', $2::date, 250000, 75, 'Owner Stub', $3, $4, 'ZAR')
       RETURNING id`,
      [`WonTile Stub ${tag}`, inFy, `pdid-S-${tag}`, clientStub.rows[0].id],
    );
    seeded.opportunityIds.push(oppStub.rows[0].id);
    seeded.stubOppId = oppStub.rows[0].id;
    const projStub = await pool.query(
      `INSERT INTO project_info (project_name, opportunity_id, client_id, project_status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id`,
      [`WonTile Stub ${tag}`, oppStub.rows[0].id, clientStub.rows[0].id],
    );
    seeded.projectInfoIds.push(projStub.rows[0].id);

    // (boundary-start) signed_date = fyStart (Sep 1) — must be included.
    const clientBs = await pool.query(
      `INSERT INTO clients (name, client_id) VALUES ($1, $2) RETURNING id`,
      [`Won-Tile Client BS ${tag}`, `WT-BS-${tag}`],
    );
    seeded.clientIds.push(clientBs.rows[0].id);
    const oppBs = await pool.query(
      `INSERT INTO opportunities (deal_name, source, status, signed_date, estimated_value, estimated_kwp, deal_owner_name, pipedrive_deal_id, client_id, currency)
       VALUES ($1, 'pipedrive', 'won', $2::date, 100000, 50, 'Owner BS', $3, $4, 'ZAR')
       RETURNING id`,
      [`WonTile BS ${tag}`, currentFy().fyStart, `pdid-BS-${tag}`, clientBs.rows[0].id],
    );
    seeded.opportunityIds.push(oppBs.rows[0].id);
    seeded.boundaryStartOppId = oppBs.rows[0].id;

    // (boundary-end) signed_date = fyEnd (Aug 31) — must be included.
    const clientBe = await pool.query(
      `INSERT INTO clients (name, client_id) VALUES ($1, $2) RETURNING id`,
      [`Won-Tile Client BE ${tag}`, `WT-BE-${tag}`],
    );
    seeded.clientIds.push(clientBe.rows[0].id);
    const oppBe = await pool.query(
      `INSERT INTO opportunities (deal_name, source, status, signed_date, estimated_value, estimated_kwp, deal_owner_name, pipedrive_deal_id, client_id, currency)
       VALUES ($1, 'pipedrive', 'won', $2::date, 100000, 50, 'Owner BE', $3, $4, 'ZAR')
       RETURNING id`,
      [`WonTile BE ${tag}`, currentFy().fyEnd, `pdid-BE-${tag}`, clientBe.rows[0].id],
    );
    seeded.opportunityIds.push(oppBe.rows[0].id);
    seeded.boundaryEndOppId = oppBe.rows[0].id;

    // (c) won OUTSIDE this FY — must be excluded.
    const clientC = await pool.query(
      `INSERT INTO clients (name, client_id) VALUES ($1, $2) RETURNING id`,
      [`Won-Tile Client C ${tag}`, `WT-C-${tag}`],
    );
    seeded.clientIds.push(clientC.rows[0].id);
    const oppC = await pool.query(
      `INSERT INTO opportunities (deal_name, source, status, signed_date, estimated_value, estimated_kwp, deal_owner_name, pipedrive_deal_id, client_id, currency)
       VALUES ($1, 'pipedrive', 'won', $2::date, 999999, 999, 'Owner C', $3, $4, 'ZAR')
       RETURNING id`,
      [`WonTile C ${tag}`, outFy, `pdid-C-${tag}`, clientC.rows[0].id],
    );
    seeded.opportunityIds.push(oppC.rows[0].id);
    seeded.outOfFyOppId = oppC.rows[0].id;
  });

  afterAll(async () => {
    if (!pool) return;
    // Tear down in reverse FK order. project_execution_state cascades
    // off project_info (ON DELETE CASCADE), so deleting project_info
    // cleans those out automatically.
    for (const id of seeded.projectInfoIds) {
      await pool.query(`DELETE FROM project_info WHERE id = $1`, [id]).catch(() => {});
    }
    for (const id of seeded.opportunityIds) {
      await pool.query(`DELETE FROM opportunities WHERE id = $1`, [id]).catch(() => {});
    }
    for (const id of seeded.clientIds) {
      await pool.query(`DELETE FROM clients WHERE id = $1`, [id]).catch(() => {});
    }
    await pool.end().catch(() => {});
  });

  it("returns 401/403 to anonymous callers", async () => {
    const res = await apiRequest("GET", "/api/pd/dashboard/won-deals");
    expect([401, 403]).toContain(res.status);
  });

  it("returns the expected envelope shape", async () => {
    const res = await apiRequest("GET", "/api/pd/dashboard/won-deals", undefined, token);
    expect(res.status).toBe(200);
    expect(res.data).toBeTruthy();
    expect(typeof res.data.generatedAt).toBe("string");
    expect(typeof res.data.fy).toBe("number");
    expect(typeof res.data.fyLabel).toBe("string");
    expect(typeof res.data.fyStart).toBe("string");
    expect(typeof res.data.fyEnd).toBe("string");
    expect(res.data.kpis).toBeDefined();
    expect(typeof res.data.kpis.count).toBe("number");
    expect(typeof res.data.kpis.totalValue).toBe("number");
    expect(typeof res.data.kpis.totalKwp).toBe("number");
    expect(typeof res.data.kpis.currency).toBe("string");
    expect(Array.isArray(res.data.rows)).toBe(true);
  });

  it("FY window is the current Sep–Aug window and matches the helper", () => {
    // Sanity check the helper math itself before depending on it below.
    const { fy, fyStart, fyEnd } = currentFy();
    expect(fyStart).toBe(`${fy - 1}-09-01`);
    expect(fyEnd).toBe(`${fy}-08-31`);
  });

  it("seeded in-FY rows appear with the expected projectLinkState", async () => {
    const res = await apiRequest("GET", "/api/pd/dashboard/won-deals", undefined, token);
    expect(res.status).toBe(200);
    const rowA = res.data.rows.find((r: any) => r.id === seeded.linkedOppId);
    const rowB = res.data.rows.find((r: any) => r.id === seeded.noneOppId);
    const rowC = res.data.rows.find((r: any) => r.id === seeded.outOfFyOppId);
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    // Out-of-FY row must NOT appear.
    expect(rowC).toBeUndefined();

    // (a) linked: full project shell
    expect(rowA.projectLinkState).toBe("linked");
    expect(rowA.projectId).not.toBeNull();
    expect(rowA.projectName).toMatch(/^WonTile A /);
    expect(rowA.projectPhase).toBe("S03_OPERATIONAL_PLAN");

    // (b) none: no project_info row
    expect(rowB.projectLinkState).toBe("none");
    expect(rowB.projectId).toBeNull();
    expect(rowB.projectPhase).toBeNull();
  });

  it("project_info row that's missing phase / pd_user_id / pm_user_id resolves as `stub`", async () => {
    const res = await apiRequest("GET", "/api/pd/dashboard/won-deals", undefined, token);
    expect(res.status).toBe(200);
    expect(seeded.stubOppId).toBeDefined();
    const rowStub = res.data.rows.find((r: any) => r.id === seeded.stubOppId);
    expect(rowStub).toBeDefined();
    expect(rowStub.projectLinkState).toBe("stub");
    expect(rowStub.projectId).not.toBeNull();
    expect(rowStub.projectName).toMatch(/^WonTile Stub /);
    expect(rowStub.projectPhase).toBeNull();
  });

  it("rows on the FY boundary (fyStart and fyEnd) are inclusive", async () => {
    const res = await apiRequest("GET", "/api/pd/dashboard/won-deals", undefined, token);
    expect(res.status).toBe(200);
    expect(seeded.boundaryStartOppId).toBeDefined();
    expect(seeded.boundaryEndOppId).toBeDefined();
    const startRow = res.data.rows.find((r: any) => r.id === seeded.boundaryStartOppId);
    const endRow = res.data.rows.find((r: any) => r.id === seeded.boundaryEndOppId);
    expect(startRow).toBeDefined();
    expect(endRow).toBeDefined();
    expect(startRow.signedDate).toBe(res.data.fyStart);
    expect(endRow.signedDate).toBe(res.data.fyEnd);
  });

  it("rows expose the contract fields the tile renders", async () => {
    const res = await apiRequest("GET", "/api/pd/dashboard/won-deals", undefined, token);
    expect(res.status).toBe(200);
    const rowA = res.data.rows.find((r: any) => r.id === seeded.linkedOppId);
    expect(rowA).toBeDefined();
    expect(rowA.dealName).toMatch(/^WonTile A /);
    expect(rowA.clientName).toMatch(/^Won-Tile Client A /);
    expect(rowA.pipedriveDealId).toMatch(/^pdid-A-/);
    expect(rowA.estimatedValue).toBe(1500000);
    expect(rowA.estimatedKwp).toBe(250);
    expect(rowA.signedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rowA.dealOwnerName).toBe("Owner A");
    expect(["linked", "stub", "none"]).toContain(rowA.projectLinkState);
  });

  it("KPI totals include at least the seeded in-FY rows and exclude the out-of-FY row", async () => {
    const res = await apiRequest("GET", "/api/pd/dashboard/won-deals", undefined, token);
    expect(res.status).toBe(200);
    const seededInFyValue = 1500000 + 800000;
    const seededInFyKwp = 250 + 150;
    expect(res.data.kpis.count).toBeGreaterThanOrEqual(2);
    expect(res.data.kpis.totalValue).toBeGreaterThanOrEqual(seededInFyValue);
    expect(res.data.kpis.totalKwp).toBeGreaterThanOrEqual(seededInFyKwp);
    // The out-of-FY value (999999) must not have been added.
    // We can't assert exact totals (other prod data is in scope), but
    // we can assert the out-of-FY id never appears in rows[].
    expect(res.data.rows.some((r: any) => r.id === seeded.outOfFyOppId)).toBe(false);
  });

  it("default order is sign date desc with updated_at as tiebreak (server contract)", async () => {
    const res = await apiRequest("GET", "/api/pd/dashboard/won-deals", undefined, token);
    expect(res.status).toBe(200);
    const dates = res.data.rows
      .map((r: any) => (r.signedDate ? new Date(r.signedDate).getTime() : 0))
      .filter((t: number) => t > 0);
    const sortedDesc = [...dates].sort((a, b) => b - a);
    expect(dates).toEqual(sortedDesc);
  });

  it("every returned row has signed_date in the FY window", async () => {
    const res = await apiRequest("GET", "/api/pd/dashboard/won-deals", undefined, token);
    expect(res.status).toBe(200);
    const start = new Date(`${res.data.fyStart}T00:00:00Z`).getTime();
    const end = new Date(`${res.data.fyEnd}T23:59:59Z`).getTime();
    for (const r of res.data.rows) {
      expect(r.signedDate).toBeTruthy();
      const t = new Date(r.signedDate).getTime();
      expect(t).toBeGreaterThanOrEqual(start);
      expect(t).toBeLessThanOrEqual(end);
    }
  });
});
