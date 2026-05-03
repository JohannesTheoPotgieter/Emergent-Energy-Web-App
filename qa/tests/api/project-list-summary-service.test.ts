/**
 * Service-level integration test for getProjectListSummaries — the
 * foundation read used by GET /api/priorities/:id linkedProjects (and the
 * POST /api/priorities/:id/projects link response).
 *
 * Seeds a deterministic cache-miss fixture (real work_items, NO
 * derived_project_kpis row, NO manual ragStatus) directly via SQL and
 * asserts the helper returns derived RAG and live % Complete — i.e. the
 * exact "Mondi in Financial Close" scenario the task was raised for. The
 * test cleans up its own rows in `finally` so it leaves no residue.
 *
 * Skips gracefully when the DB is unreachable (e.g. if a contributor runs
 * just this file outside the dev shell).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

let dbModule: typeof import("../../../server/db") | null = null;
let serviceModule: typeof import("../../../server/services/project-platform-summary-service") | null = null;
let dbReady = false;

const SENTINEL = `__qa_priority_summary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
let createdProjectId: number | null = null;

beforeAll(async () => {
  try {
    dbModule = await import("../../../server/db");
    await dbModule.initializeDatabase();
    serviceModule = await import("../../../server/services/project-platform-summary-service");
    // Ping
    await dbModule.db.execute(sql`SELECT 1`);
    dbReady = true;
  } catch (err: any) {
    console.warn(`[project-list-summary-service] DB unavailable, skipping: ${err?.message}`);
    dbReady = false;
  }
});

afterAll(async () => {
  if (!dbReady || !dbModule || createdProjectId == null) return;
  try {
    await dbModule.db.execute(sql`DELETE FROM work_items WHERE project_id = ${createdProjectId}`);
    await dbModule.db.execute(sql`DELETE FROM project_execution_state WHERE project_id = ${createdProjectId}`);
    await dbModule.db.execute(sql`DELETE FROM derived_project_kpis WHERE project_id = ${createdProjectId} OR project_key = ${SENTINEL}`);
    await dbModule.db.execute(sql`DELETE FROM project_info WHERE id = ${createdProjectId}`);
  } catch (err: any) {
    console.warn(`[project-list-summary-service] cleanup failed: ${err?.message}`);
  }
});

describe("getProjectListSummaries — cache-miss fixture", () => {
  it("returns derived RAG (schedule variance) and live % Complete when no manual RAG and no derived_project_kpis row exist", async () => {
    if (!dbReady || !dbModule || !serviceModule) return;
    const { db } = dbModule;
    const { getProjectListSummaries } = serviceModule;

    // ── Seed a project with work_items only — no derived_project_kpis row,
    //    no projectExecutionState.ragStatus. This is the bug repro.
    const inserted: any = await db.execute(sql`
      INSERT INTO project_info (project_name, pm)
      VALUES (${SENTINEL}, 'QA Bot')
      RETURNING id
    `);
    const insertedRows = inserted.rows ?? inserted;
    createdProjectId = Number(insertedRows[0].id);
    expect(createdProjectId).toBeGreaterThan(0);

    // Pick any existing user id for created_by (NOT NULL FK).
    const userRow: any = await db.execute(sql`SELECT id FROM users ORDER BY id LIMIT 1`);
    const userRows = userRow.rows ?? userRow;
    if (userRows.length === 0) {
      console.warn("[project-list-summary-service] no users in DB — skipping");
      return;
    }
    const userId = Number(userRows[0].id);

    // 4 work items, avg actual = 30, avg expected = 50 → variance −20 → red
    await db.execute(sql`
      INSERT INTO work_items (project_id, workstream, title, status, percent_complete, expected_pct_complete, created_by)
      VALUES
        (${createdProjectId}, 'PM', 'T1', 'in_progress', 20, 50, ${userId}),
        (${createdProjectId}, 'PM', 'T2', 'in_progress', 30, 50, ${userId}),
        (${createdProjectId}, 'PM', 'T3', 'in_progress', 40, 50, ${userId}),
        (${createdProjectId}, 'PM', 'T4', 'in_progress', 30, 50, ${userId})
    `);

    const result = await getProjectListSummaries({ projectIds: [createdProjectId] });
    const row = result.get(createdProjectId);
    expect(row).toBeDefined();
    if (!row) return;

    // ── The bug: without the foundation, ragStatus would be null ("—") and
    //    percentComplete would be 0. With it:
    expect(row.ragSource).toBe("derived");
    expect(row.ragStatus).toBe("red"); // variance −20 → red
    expect(row.percentCompleteSource).toBe("live");
    expect(row.percentComplete).toBe(30); // AVG(20,30,40,30)
    expect(row.name).toBe(SENTINEL);
  }, 30_000);

  it("treats cached zero in derived_project_kpis as a cache miss", async () => {
    if (!dbReady || !dbModule || !serviceModule || createdProjectId == null) return;
    const { db } = dbModule;
    const { getProjectListSummaries } = serviceModule;

    // Materialise a cache row with the buggy zeros (project_key is the
    // unique key on derived_project_kpis).
    await db.execute(sql`
      INSERT INTO derived_project_kpis (project_key, project_name, project_id, avg_actual_pct_complete, avg_expected_pct_complete)
      VALUES (${SENTINEL}, ${SENTINEL}, ${createdProjectId}, 0, 0)
      ON CONFLICT (project_key) DO UPDATE SET
        avg_actual_pct_complete = EXCLUDED.avg_actual_pct_complete,
        avg_expected_pct_complete = EXCLUDED.avg_expected_pct_complete,
        project_id = EXCLUDED.project_id
    `);

    const result = await getProjectListSummaries({ projectIds: [createdProjectId] });
    const row = result.get(createdProjectId);
    expect(row).toBeDefined();
    if (!row) return;

    // Cached zero must NOT win — live AVG should still surface 30%.
    expect(row.percentCompleteSource).toBe("live");
    expect(row.percentComplete).toBe(30);
  }, 30_000);
});
