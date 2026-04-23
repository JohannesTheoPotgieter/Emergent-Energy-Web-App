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

describe("Foundation linkage hardening — cascades and spine integrity (Task #34)", () => {
  let token: string;

  beforeAll(async () => {
    token = await loginAdmin();
  });

  it("GET /api/pd/tickets does not return any soft-deleted tickets", async () => {
    const res = await apiRequest("GET", "/api/pd/tickets", undefined, token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data) || Array.isArray(res.data?.tickets)).toBe(true);
    const tickets: any[] = Array.isArray(res.data) ? res.data : res.data.tickets;
    for (const t of tickets) {
      expect(t.deletedAt ?? null).toBeNull();
    }
  });

  it("GET /api/project-development/workspace/rollup returns totals + per-project rows with required shape", async () => {
    const res = await apiRequest("GET", "/api/project-development/workspace/rollup", undefined, token);
    expect(res.status).toBe(200);
    expect(res.data).toBeTruthy();
    expect(typeof res.data.generatedAt).toBe("string");
    expect(res.data.totals).toBeDefined();
    for (const k of [
      "projects", "spineGap", "cascadeAnomalies",
      "openPdTickets", "overduePdTickets",
      "openWorkItems", "blockedWorkItems", "overdueWorkItems",
      "openRaid",
    ]) {
      expect(typeof res.data.totals[k]).toBe("number");
    }
    expect(Array.isArray(res.data.rows)).toBe(true);
    if (res.data.rows.length > 0) {
      const row = res.data.rows[0];
      expect(typeof row.projectId).toBe("number");
      expect(row.pdTickets).toBeDefined();
      expect(row.workItems).toBeDefined();
      expect(row.raid).toBeDefined();
      expect(typeof row.spineGap).toBe("boolean");
    }
  });

  it("rollup cascadeAnomalies should be 0 — every work_items.pd_ticket_id must reference a live (not soft-deleted) ticket", async () => {
    const res = await apiRequest("GET", "/api/project-development/workspace/rollup", undefined, token);
    expect(res.status).toBe(200);
    expect(res.data.totals.cascadeAnomalies).toBe(0);
  });

  it("rollup endpoint requires auth", async () => {
    const res = await apiRequest("GET", "/api/project-development/workspace/rollup");
    expect([401, 403]).toContain(res.status);
  });

  it("pdTicketTaskRows in workspace endpoint reflects work_items aggregation (no longer hardcoded empty)", async () => {
    // Hit the project-development workspace for any project that has tickets.
    const rollup = await apiRequest("GET", "/api/project-development/workspace/rollup", undefined, token);
    const projectWithTickets = rollup.data?.rows?.find((r: any) => r.pdTickets.total > 0);
    if (!projectWithTickets) {
      console.warn("[skip] no projects with PD tickets — pdTicketTaskRows aggregation cannot be exercised");
      return;
    }
    const res = await apiRequest("GET", `/api/project-development/workspace/${projectWithTickets.projectId}`, undefined, token);
    expect(res.status).toBe(200);
    // pdTicketTaskRows should be an array; if any rows exist they must have numeric counts.
    const rows = res.data?.pdTicketTaskRows;
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) {
      expect(typeof r.pdTicketId === "number" || r.pdTicketId === null).toBe(true);
      expect(typeof r.totalCount).toBe("number");
      expect(typeof r.openCount).toBe("number");
    }
  });

  it("DB trigger rejects work_items linkage to a soft-deleted ticket (write-path guard, migrations 0021 + 0025)", async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const live = await pool.query(
        `SELECT id FROM engineering_tickets WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1`,
      );
      if (live.rowCount === 0) return;
      const ticketId = live.rows[0].id;
      await pool.query("BEGIN");
      try {
        await pool.query(`UPDATE engineering_tickets SET deleted_at = now() WHERE id = $1`, [ticketId]);
        let threw = false;
        try {
          await pool.query(
            `INSERT INTO work_items (title, status, engineering_ticket_id) VALUES ('cascade-guard-test', 'Open', $1)`,
            [ticketId],
          );
        } catch (e: any) {
          threw = true;
          expect(String(e.message)).toMatch(/soft-deleted/);
        }
        expect(threw).toBe(true);
      } finally {
        await pool.query("ROLLBACK");
      }
    } finally {
      await pool.end();
    }
  });

  // Vocabulary phase 2 (task #58): the rename from `pd_tickets` to
  // `engineering_tickets` (migration 0025) leaves a backwards-compat
  // VIEW + generated column for one release. This release-gate
  // assertion makes sure both the legacy and the new names continue to
  // resolve to the same logical row, so straggler code paths and
  // analytics queries do not silently break before the alias is dropped.
  it("Phase 2 rename: both legacy `pd_tickets` and new `engineering_tickets` resolve to the same row (migrations 0024 + 0025)", async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const live = await pool.query(
        `SELECT id, project_site_name FROM engineering_tickets WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1`,
      );
      if (live.rowCount === 0) {
        console.warn("[skip] no live engineering_tickets rows — alias parity cannot be exercised");
        return;
      }
      const { id, project_site_name } = live.rows[0];

      const legacy = await pool.query(
        `SELECT id, project_site_name FROM pd_tickets WHERE id = $1`,
        [id],
      );
      expect(legacy.rowCount).toBe(1);
      expect(legacy.rows[0].project_site_name).toBe(project_site_name);

      // work_items column alias parity: every value in the legacy
      // `pd_ticket_id` column must equal the new `engineering_ticket_id`
      // column on the same row.
      const cols = await pool.query(
        `SELECT COUNT(*)::int AS mismatches
           FROM work_items
          WHERE pd_ticket_id IS DISTINCT FROM engineering_ticket_id`,
      );
      expect(cols.rows[0].mismatches).toBe(0);
    } finally {
      await pool.end();
    }
  });
});
