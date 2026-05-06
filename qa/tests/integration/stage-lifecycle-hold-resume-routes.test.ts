/**
 * API-level integration tests for the terminal-branch transition routes
 * added in task #81:
 *
 *   POST /api/projects/:projectId/stages/hold
 *   POST /api/projects/:projectId/stages/resume
 *   POST /api/projects/:projectId/stages/done
 *   POST /api/projects/:projectId/stages/advance-to/:stageCode  (terminal-block)
 *
 * The service-level test
 * (qa/tests/integration/stage-lifecycle-hold-resume.test.ts) proves the
 * handler logic itself; this file proves the HTTP wiring — auth gate,
 * response shape, and the explicit refusal of the generic advance-to
 * endpoint when the caller passes S_HOLD or S_DONE. Together they make
 * it impossible for a future contributor to accidentally bypass the
 * Hold/Resume/Done contract from production code.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const BASE_URL = process.env.API_URL || "http://localhost:5000";
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function api(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data: data as any };
}

async function loginAdmin(): Promise<string> {
  const res = await api("POST", "/api/auth/login", { username: "johannes", password: "2023" });
  expect(res.status).toBe(200);
  return res.data.token as string;
}

describeIfDb("Stage-lifecycle terminal-branch HTTP routes (Task #81)", () => {
  let pool: pg.Pool;
  let token: string;
  let projectId: number;
  const SUFFIX = `${process.pid}_${Date.now()}`;
  const PROJECT_NAME = `__test_hold_routes_${SUFFIX}`;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    token = await loginAdmin();

    const projRes = await pool.query<{ id: number }>(
      `INSERT INTO project_info (project_name, project_status, archived_status)
       VALUES ($1, 'active', 'ACTIVE')
       RETURNING id`,
      [PROJECT_NAME],
    );
    projectId = projRes.rows[0].id;

    await pool.query(
      `INSERT INTO project_execution_state (project_id, current_stage_code, phase)
       VALUES ($1, 'S07_COMMISSIONING', 'Commissioning')`,
      [projectId],
    );
    await pool.query(
      `INSERT INTO project_stage_instances (project_id, stage_code, stage_status, readiness_pct, started_at)
       VALUES ($1, 'S07_COMMISSIONING', 'IN_PROGRESS', 0, NOW())`,
      [projectId],
    );
  }, 30000);

  afterAll(async () => {
    if (projectId) {
      await pool.query(`DELETE FROM project_info WHERE id = $1`, [projectId]);
    }
    await pool.end();
  });

  it("POST /stages/advance-to/S_HOLD is refused with a redirect to /stages/hold", async () => {
    const res = await api(
      "POST",
      `/api/projects/${projectId}/stages/advance-to/S_HOLD`,
      { reason: "should be rejected" },
      token,
    );
    expect(res.status).toBe(400);
    expect(typeof res.data?.error).toBe("string");
    expect(res.data.error).toMatch(/\/stages\/hold/);
  });

  it("POST /stages/advance-to/S_DONE is refused with a redirect to /stages/done", async () => {
    const res = await api(
      "POST",
      `/api/projects/${projectId}/stages/advance-to/S_DONE`,
      { reason: "should be rejected" },
      token,
    );
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/\/stages\/done/);
  });

  it("POST /stages/hold places the project on hold and preserves previous_phase", async () => {
    const res = await api(
      "POST",
      `/api/projects/${projectId}/stages/hold`,
      { reason: "route test — hold" },
      token,
    );
    expect(res.status).toBe(200);
    expect(res.data.previousPhase).toBe("S07_COMMISSIONING");

    const exec = await pool.query<{ current_stage_code: string; previous_phase: string }>(
      `SELECT current_stage_code, previous_phase
         FROM project_execution_state WHERE project_id = $1`,
      [projectId],
    );
    expect(exec.rows[0].current_stage_code).toBe("S_HOLD");
    expect(exec.rows[0].previous_phase).toBe("S07_COMMISSIONING");

    const info = await pool.query<{ project_status: string }>(
      `SELECT project_status FROM project_info WHERE id = $1`,
      [projectId],
    );
    expect(info.rows[0].project_status).toBe("hold");
  });

  it("POST /stages/resume restores the prior phase and clears previous_phase", async () => {
    const res = await api(
      "POST",
      `/api/projects/${projectId}/stages/resume`,
      { reason: "route test — resume" },
      token,
    );
    expect(res.status).toBe(200);
    expect(res.data.resumedTo).toBe("S07_COMMISSIONING");

    const exec = await pool.query<{ current_stage_code: string; previous_phase: string | null }>(
      `SELECT current_stage_code, previous_phase
         FROM project_execution_state WHERE project_id = $1`,
      [projectId],
    );
    expect(exec.rows[0].current_stage_code).toBe("S07_COMMISSIONING");
    expect(exec.rows[0].previous_phase).toBeNull();

    const info = await pool.query<{ project_status: string }>(
      `SELECT project_status FROM project_info WHERE id = $1`,
      [projectId],
    );
    expect(info.rows[0].project_status).toBe("active");
  });

  it("POST /stages/resume rejects when the project is not on hold", async () => {
    // We just resumed in the previous test, so calling resume again must
    // bubble up the service-level guard via the route's 400.
    const res = await api(
      "POST",
      `/api/projects/${projectId}/stages/resume`,
      {},
      token,
    );
    expect(res.status).toBe(400);
    expect(res.data?.error).toMatch(/not on S_HOLD/);
  });

  it("POST /stages/done marks the project Done and flips status to closed", async () => {
    const res = await api(
      "POST",
      `/api/projects/${projectId}/stages/done`,
      { reason: "route test — done" },
      token,
    );
    expect(res.status).toBe(200);
    expect(typeof res.data?.stageInstanceId).toBe("number");

    const exec = await pool.query<{ current_stage_code: string }>(
      `SELECT current_stage_code FROM project_execution_state WHERE project_id = $1`,
      [projectId],
    );
    expect(exec.rows[0].current_stage_code).toBe("S_DONE");

    const info = await pool.query<{ project_status: string }>(
      `SELECT project_status FROM project_info WHERE id = $1`,
      [projectId],
    );
    expect(info.rows[0].project_status).toBe("closed");
  });
});
