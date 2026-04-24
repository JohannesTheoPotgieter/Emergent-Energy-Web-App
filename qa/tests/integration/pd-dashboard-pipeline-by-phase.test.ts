import { describe, it, expect, beforeAll } from "vitest";

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
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function loginAdmin(): Promise<string> {
  const res = await apiRequest("POST", "/api/auth/login", { username: "johannes", password: "2023" });
  expect(res.status).toBe(200);
  return res.data.token as string;
}

describe("PD dashboard pipeline-by-phase (Task #77)", () => {
  let token: string;

  beforeAll(async () => {
    token = await loginAdmin();
  });

  it("returns 401/403 to anonymous callers", async () => {
    const res = await apiRequest("GET", "/api/pd/dashboard/pipeline-by-phase");
    expect([401, 403]).toContain(res.status);
  });

  it("returns the expected envelope shape", async () => {
    const res = await apiRequest("GET", "/api/pd/dashboard/pipeline-by-phase", undefined, token);
    expect(res.status).toBe(200);
    expect(res.data).toBeTruthy();
    expect(typeof res.data.generatedAt).toBe("string");
    expect(res.data.totals).toBeDefined();
    expect(typeof res.data.totals.count).toBe("number");
    expect(typeof res.data.totals.totalKwp).toBe("number");
    expect(typeof res.data.totals.totalValue).toBe("number");
    expect(Array.isArray(res.data.byPhase)).toBe(true);
    expect(Array.isArray(res.data.rows)).toBe(true);
  });

  it("byPhase rows carry the contract fields the KPI card consumes", async () => {
    const res = await apiRequest("GET", "/api/pd/dashboard/pipeline-by-phase", undefined, token);
    expect(res.status).toBe(200);
    for (const p of res.data.byPhase) {
      expect(typeof p.code).toBe("string");
      expect(typeof p.label).toBe("string");
      expect(typeof p.displayNumber).toBe("number");
      expect(typeof p.count).toBe("number");
      expect(typeof p.totalKwp).toBe("number");
      expect(typeof p.totalValue).toBe("number");
      expect(typeof p.sharePct).toBe("number");
      expect(p.sharePct).toBeGreaterThanOrEqual(0);
      expect(p.sharePct).toBeLessThanOrEqual(100.0001);
    }
  });

  it("byPhase is sorted by canonical lifecycle display order (S01 < S02 < S03 < … < _UNSCOPED)", async () => {
    const res = await apiRequest("GET", "/api/pd/dashboard/pipeline-by-phase", undefined, token);
    expect(res.status).toBe(200);
    const numbers = res.data.byPhase.map((p: any) => p.displayNumber);
    const sortedAscending = [...numbers].sort((a, b) => a - b);
    expect(numbers).toEqual(sortedAscending);
  });

  it("excludes won/lost opportunities from rows (active sales pipeline only)", async () => {
    const res = await apiRequest("GET", "/api/pd/dashboard/pipeline-by-phase", undefined, token);
    expect(res.status).toBe(200);
    for (const r of res.data.rows) {
      const stage = (r.stage || "").toLowerCase();
      expect(["won", "lost"]).not.toContain(stage);
    }
  });

  it("each opportunity row carries identity, phase resolution and a nullable expected close date", async () => {
    const res = await apiRequest("GET", "/api/pd/dashboard/pipeline-by-phase", undefined, token);
    expect(res.status).toBe(200);
    for (const r of res.data.rows) {
      expect(typeof r.id).toBe("number");
      expect(typeof r.dealName).toBe("string");
      expect(r.dealName.length).toBeGreaterThan(0);
      expect(typeof r.phaseLabel).toBe("string");
      // phaseCode is null when the stage couldn't be mapped (and is then
      // bucketed under '_UNSCOPED' in byPhase).
      expect(r.phaseCode === null || typeof r.phaseCode === "string").toBe(true);
      expect(r.expectedCloseDate === null || typeof r.expectedCloseDate === "string").toBe(true);
      expect(r.estimatedKwp === null || typeof r.estimatedKwp === "number").toBe(true);
      expect(r.estimatedValue === null || typeof r.estimatedValue === "number").toBe(true);
    }
  });

  it("totals.count equals the rows[].length (no double-counting in aggregation)", async () => {
    const res = await apiRequest("GET", "/api/pd/dashboard/pipeline-by-phase", undefined, token);
    expect(res.status).toBe(200);
    expect(res.data.totals.count).toBe(res.data.rows.length);
    const sumOfPhaseCounts = res.data.byPhase.reduce((s: number, p: any) => s + p.count, 0);
    expect(sumOfPhaseCounts).toBe(res.data.rows.length);
  });

  it("excludes soft-deleted opportunities (tombstoned via opportunities.deleted_at)", async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    let victimId: number | null = null;
    try {
      const before = await apiRequest("GET", "/api/pd/dashboard/pipeline-by-phase", undefined, token);
      expect(before.status).toBe(200);
      if (before.data.rows.length === 0) {
        console.warn("[skip] no active opportunities to exercise soft-delete exclusion");
        return;
      }
      victimId = before.data.rows[0].id as number;

      // Tombstone the victim and verify it disappears from the response.
      await pool.query(`UPDATE opportunities SET deleted_at = now() WHERE id = $1`, [victimId]);
      const after = await apiRequest("GET", "/api/pd/dashboard/pipeline-by-phase", undefined, token);
      expect(after.status).toBe(200);
      const stillThere = after.data.rows.some((r: any) => r.id === victimId);
      expect(stillThere).toBe(false);
      // Per-phase counts should also exclude the victim.
      expect(after.data.totals.count).toBe(before.data.totals.count - 1);
    } finally {
      if (victimId != null) {
        await pool.query(`UPDATE opportunities SET deleted_at = NULL WHERE id = $1`, [victimId]).catch(() => {});
      }
      await pool.end().catch(() => {});
    }
  });

  it("excludes opportunities tied to a soft-deleted client", async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    let victimClientId: number | null = null;
    let victimOppId: number | null = null;
    try {
      // Find an active opportunity that has a client linked.
      const candidate = await pool.query(
        `SELECT o.id AS opp_id, o.client_id
           FROM opportunities o
           JOIN clients c ON c.id = o.client_id AND c.deleted_at IS NULL
          WHERE o.deleted_at IS NULL
            AND o.client_id IS NOT NULL
            AND POSITION('won'  IN LOWER(COALESCE(o.stage,  ''))) = 0
            AND POSITION('lost' IN LOWER(COALESCE(o.stage,  ''))) = 0
            AND POSITION('won'  IN LOWER(COALESCE(o.status, ''))) = 0
            AND POSITION('lost' IN LOWER(COALESCE(o.status, ''))) = 0
            AND o.signed_date IS NULL
          LIMIT 1`,
      );
      if (candidate.rowCount === 0) {
        console.warn("[skip] no active opportunity with a client to exercise client-tombstone exclusion");
        return;
      }
      victimOppId = candidate.rows[0].opp_id;
      victimClientId = candidate.rows[0].client_id;

      const before = await apiRequest("GET", "/api/pd/dashboard/pipeline-by-phase", undefined, token);
      expect(before.status).toBe(200);
      const wasThereBefore = before.data.rows.some((r: any) => r.id === victimOppId);
      expect(wasThereBefore).toBe(true);

      await pool.query(`UPDATE clients SET deleted_at = now() WHERE id = $1`, [victimClientId]);
      const after = await apiRequest("GET", "/api/pd/dashboard/pipeline-by-phase", undefined, token);
      expect(after.status).toBe(200);
      const stillThere = after.data.rows.some((r: any) => r.id === victimOppId);
      expect(stillThere).toBe(false);
    } finally {
      if (victimClientId != null) {
        await pool.query(`UPDATE clients SET deleted_at = NULL WHERE id = $1`, [victimClientId]).catch(() => {});
      }
      await pool.end().catch(() => {});
    }
  });
});
