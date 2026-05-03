/**
 * Integration test for the terminal-branch transition handlers added in
 * task #81 alongside migration 0030_canonical_lifecycle_phases_v2.sql:
 *
 *   placeProjectOnHold      — moves a project to S_HOLD, captures the
 *                             outgoing sequential phase on
 *                             project_execution_state.previous_phase, and
 *                             flips project_status to 'hold'.
 *   resumeProjectFromHold   — restores previous_phase as current_stage_code,
 *                             clears previous_phase, flips status to
 *                             'active'.
 *   markProjectDone         — moves a project to S_DONE (terminal) and
 *                             flips status to 'closed'.
 *
 * The Hold→Resume round-trip is the contract the canonical lifecycle
 * needs: parking a project on Hold must not lose the prior position, and
 * resuming must drop the project back exactly where it was. The test
 * exercises that path against a real Postgres DB so future refactors of
 * the service can't silently regress the round-trip.
 *
 * Test isolation: a unique project_info row is created with a recognisably
 * fake name (containing the PID + timestamp) and torn down in afterAll, so
 * the test never collides with real rows or other parallel runs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("Stage-lifecycle terminal transitions: Hold / Resume / Done (Task #81)", () => {
  let pool: pg.Pool;
  let projectId: number;
  let actorUserId: number;
  const SUFFIX = `${process.pid}_${Date.now()}`;
  const PROJECT_NAME = `__test_hold_resume_${SUFFIX}`;

  // Service handlers are imported dynamically inside beforeAll so this
  // file can still be collected (and skipped) when DATABASE_URL is unset
  // — top-level imports of server/* would fail to resolve drizzle config.
  let placeProjectOnHold: (p: { projectId: number; actorUserId: number; reason?: string }) => Promise<{ previousPhase: string | null; stageInstanceId: number }>;
  let resumeProjectFromHold: (p: { projectId: number; actorUserId: number; reason?: string }) => Promise<{ resumedTo: string }>;
  let markProjectDone: (p: { projectId: number; actorUserId: number; reason?: string }) => Promise<{ stageInstanceId: number }>;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });

    // server/db.ts exports `db` as a let-binding that's only populated
    // once initializeDatabase() runs — without this the service would
    // call .select on `undefined`. Importing dynamically also keeps the
    // top-level skip-without-DATABASE_URL path side-effect free.
    const dbMod = await import("../../../server/db");
    await dbMod.initializeDatabase();

    const mod = await import("../../../server/services/stage-lifecycle-service");
    placeProjectOnHold = mod.placeProjectOnHold;
    resumeProjectFromHold = mod.resumeProjectFromHold;
    markProjectDone = mod.markProjectDone;

    // Pick any existing user to satisfy the FK on decided_by_user_id;
    // tests don't care which — we just need a non-null id.
    const userRes = await pool.query<{ id: number }>(
      `SELECT id FROM users ORDER BY id LIMIT 1`,
    );
    if (userRes.rowCount === 0) {
      throw new Error("No users in DB — integration test requires at least one user row");
    }
    actorUserId = userRes.rows[0].id;

    // Create a fresh project_info + project_execution_state pair seeded
    // at a sequential mid-cycle stage (S06_CONSTRUCTION) so we have a
    // meaningful "previous_phase" value to preserve across the Hold round-trip.
    const projRes = await pool.query<{ id: number }>(
      `INSERT INTO project_info (project_name, project_status, archived_status)
       VALUES ($1, 'active', 'ACTIVE')
       RETURNING id`,
      [PROJECT_NAME],
    );
    projectId = projRes.rows[0].id;

    await pool.query(
      `INSERT INTO project_execution_state (project_id, current_stage_code, phase)
       VALUES ($1, 'S06_CONSTRUCTION', 'Construction')`,
      [projectId],
    );

    // Seed a sequential stage instance so the project looks "real" enough
    // to the audit-trail joins (decisions don't strictly require it but
    // future invariants might).
    await pool.query(
      `INSERT INTO project_stage_instances (project_id, stage_code, stage_status, readiness_pct, started_at)
       VALUES ($1, 'S06_CONSTRUCTION', 'IN_PROGRESS', 0, NOW())`,
      [projectId],
    );
  }, 30000);

  afterAll(async () => {
    if (projectId) {
      // Cascade FKs handle the dependent rows (execution_state,
      // stage_instances, decisions). Project_info has ON DELETE CASCADE
      // for these via the schema.
      await pool.query(`DELETE FROM project_info WHERE id = $1`, [projectId]);
    }
    await pool.end();
  });

  it("placeProjectOnHold preserves current_stage_code on previous_phase and flips status to 'hold'", async () => {
    const result = await placeProjectOnHold({
      projectId,
      actorUserId,
      reason: "integration test — going on hold",
    });

    expect(result.previousPhase).toBe("S06_CONSTRUCTION");
    expect(result.stageInstanceId).toBeGreaterThan(0);

    const exec = await pool.query<{
      current_stage_code: string;
      previous_phase: string | null;
    }>(
      `SELECT current_stage_code, previous_phase
         FROM project_execution_state
        WHERE project_id = $1`,
      [projectId],
    );
    expect(exec.rows[0].current_stage_code).toBe("S_HOLD");
    expect(exec.rows[0].previous_phase).toBe("S06_CONSTRUCTION");

    const info = await pool.query<{ project_status: string }>(
      `SELECT project_status FROM project_info WHERE id = $1`,
      [projectId],
    );
    expect(info.rows[0].project_status).toBe("hold");

    const holdInst = await pool.query<{ stage_status: string }>(
      `SELECT stage_status FROM project_stage_instances
        WHERE project_id = $1 AND stage_code = 'S_HOLD'`,
      [projectId],
    );
    expect(holdInst.rowCount).toBe(1);
    expect(holdInst.rows[0].stage_status).toBe("IN_PROGRESS");

    const decision = await pool.query(
      `SELECT decision_type, stage_code FROM project_stage_decisions
        WHERE project_id = $1 AND stage_code = 'S_HOLD'`,
      [projectId],
    );
    expect(decision.rowCount).toBe(1);
    expect(decision.rows[0].decision_type).toBe("STAGE_OVERRIDE");
  });

  it("resumeProjectFromHold restores previous_phase, clears it, and flips status to 'active'", async () => {
    const result = await resumeProjectFromHold({
      projectId,
      actorUserId,
      reason: "integration test — back from hold",
    });

    expect(result.resumedTo).toBe("S06_CONSTRUCTION");

    const exec = await pool.query<{
      current_stage_code: string;
      previous_phase: string | null;
    }>(
      `SELECT current_stage_code, previous_phase
         FROM project_execution_state
        WHERE project_id = $1`,
      [projectId],
    );
    expect(exec.rows[0].current_stage_code).toBe("S06_CONSTRUCTION");
    expect(exec.rows[0].previous_phase).toBeNull();

    const info = await pool.query<{ project_status: string }>(
      `SELECT project_status FROM project_info WHERE id = $1`,
      [projectId],
    );
    expect(info.rows[0].project_status).toBe("active");

    // The S_HOLD instance should be marked PROGRESSED so the audit trail
    // shows the hold ended cleanly rather than vanishing.
    const holdInst = await pool.query<{ stage_status: string; completed_at: Date | null }>(
      `SELECT stage_status, completed_at FROM project_stage_instances
        WHERE project_id = $1 AND stage_code = 'S_HOLD'`,
      [projectId],
    );
    expect(holdInst.rowCount).toBe(1);
    expect(holdInst.rows[0].stage_status).toBe("PROGRESSED");
    expect(holdInst.rows[0].completed_at).not.toBeNull();
  });

  it("resumeProjectFromHold throws when the project is not on S_HOLD", async () => {
    // We just resumed in the previous test, so current_stage_code is now
    // S06_CONSTRUCTION — calling resume again must reject.
    await expect(
      resumeProjectFromHold({ projectId, actorUserId }),
    ).rejects.toThrow(/not on S_HOLD/);
  });

  it("placeProjectOnHold upserts project_execution_state when no row exists yet (defensive)", async () => {
    // Edge case: a project might be placed on hold before
    // initialiseStages ever ran, so it has no exec_state row. A plain
    // UPDATE would silently no-op, leaving project_status='hold'
    // hanging without a current_stage_code. ON CONFLICT DO UPDATE in
    // the service insert path covers this.
    const sibName = `__test_hold_no_exec_${SUFFIX}`;
    const sib = await pool.query<{ id: number }>(
      `INSERT INTO project_info (project_name, project_status, archived_status)
       VALUES ($1, 'active', 'ACTIVE') RETURNING id`,
      [sibName],
    );
    const sibId = sib.rows[0].id;
    try {
      // Deliberately do NOT insert a project_execution_state row.
      const result = await placeProjectOnHold({
        projectId: sibId,
        actorUserId,
        reason: "no-exec-state edge case",
      });
      expect(result.previousPhase).toBeNull();
      expect(result.stageInstanceId).toBeGreaterThan(0);

      const exec = await pool.query<{ current_stage_code: string }>(
        `SELECT current_stage_code FROM project_execution_state WHERE project_id = $1`,
        [sibId],
      );
      expect(exec.rowCount).toBe(1);
      expect(exec.rows[0].current_stage_code).toBe("S_HOLD");
    } finally {
      await pool.query(`DELETE FROM project_info WHERE id = $1`, [sibId]);
    }
  });

  it("resumeProjectFromHold rejects a non-canonical previous_phase (defence-in-depth)", async () => {
    // Set up a sibling project parked on S_HOLD with a NON-canonical
    // previous_phase value (a label, not a code) — exactly the shape a
    // pre-task-#81 export or a manual SQL edit could leave behind.
    // The runtime guard must refuse rather than corrupt current_stage_code.
    const sibName = `__test_resume_guard_${SUFFIX}`;
    const sib = await pool.query<{ id: number }>(
      `INSERT INTO project_info (project_name, project_status, archived_status)
       VALUES ($1, 'hold', 'ACTIVE') RETURNING id`,
      [sibName],
    );
    const sibId = sib.rows[0].id;
    try {
      await pool.query(
        `INSERT INTO project_execution_state (project_id, current_stage_code, previous_phase)
         VALUES ($1, 'S_HOLD', 'Construction')`,
        [sibId],
      );
      await expect(
        resumeProjectFromHold({ projectId: sibId, actorUserId }),
      ).rejects.toThrow(/not a canonical sequential stage code/);
    } finally {
      await pool.query(`DELETE FROM project_info WHERE id = $1`, [sibId]);
    }
  });

  it("markProjectDone moves the project to S_DONE and flips status to 'closed'", async () => {
    const result = await markProjectDone({
      projectId,
      actorUserId,
      reason: "integration test — closing out",
    });
    expect(result.stageInstanceId).toBeGreaterThan(0);

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

    const doneInst = await pool.query<{ stage_status: string }>(
      `SELECT stage_status FROM project_stage_instances
        WHERE project_id = $1 AND stage_code = 'S_DONE'`,
      [projectId],
    );
    expect(doneInst.rowCount).toBe(1);
    expect(doneInst.rows[0].stage_status).toBe("IN_PROGRESS");
  });
});
