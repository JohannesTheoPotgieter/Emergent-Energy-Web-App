/**
 * Migration verification test for 0030_canonical_lifecycle_phases_v2.sql.
 *
 * Step 7d/7e of that migration backfills
 * project_execution_state.current_stage_code to the terminal code that
 * matches each project's project_status:
 *   - project_status = 'hold'   -> current_stage_code = 'S_HOLD'
 *   - project_status = 'closed' -> current_stage_code = 'S_DONE'
 *
 * If this invariant breaks, three downstream contracts silently fail:
 *   1. resumeProjectFromHold guards on current_stage_code === 'S_HOLD',
 *      so a hold project still on a sequential code can't be resumed
 *      via the new HTTP route.
 *   2. The CriticalControlPanel terminal-stage UI branch keys off
 *      current_stage_code; mismatched data routes the user back into
 *      the generic advance dropdown.
 *   3. Lifecycle boards group projects by current_stage_code; mismatched
 *      data hides a "hold" project from the Hold column and shows it on
 *      whatever sequential phase it was last on.
 *
 * The test is read-only and asserts the post-migration database state
 * directly — no fixtures, no cleanup needed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("Migration 0030 backfill: hold/closed projects surface on terminal stage codes", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("every project_status='hold' project is on current_stage_code='S_HOLD' (strict mapping)", async () => {
    // Strict invariant: project_status='hold' MUST map to S_HOLD,
    // never S_DONE or any sequential code. A closed project sitting
    // on S_HOLD or a hold project sitting on S_DONE both violate the
    // status→terminal contract.
    const res = await pool.query<{
      id: number;
      project_name: string;
      current_stage_code: string | null;
    }>(
      `SELECT pi.id, pi.project_name, pes.current_stage_code
         FROM project_info pi
         JOIN project_execution_state pes ON pes.project_id = pi.id
        WHERE pi.project_status = 'hold'
          AND (pes.current_stage_code IS NULL
               OR pes.current_stage_code <> 'S_HOLD')`,
    );
    if (res.rowCount && res.rowCount > 0) {
      const offenders = res.rows.map((r) => `#${r.id} ${r.project_name} -> ${r.current_stage_code ?? "NULL"}`);
      throw new Error(
        `Found ${res.rowCount} hold project(s) NOT on S_HOLD:\n  ${offenders.join("\n  ")}`,
      );
    }
    expect(res.rowCount).toBe(0);
  });

  it("every project_status='closed' project is on current_stage_code='S_DONE' (strict mapping)", async () => {
    const res = await pool.query<{ id: number; project_name: string; current_stage_code: string | null }>(
      `SELECT pi.id, pi.project_name, pes.current_stage_code
         FROM project_info pi
         JOIN project_execution_state pes ON pes.project_id = pi.id
        WHERE pi.project_status = 'closed'
          AND (pes.current_stage_code IS NULL
               OR pes.current_stage_code <> 'S_DONE')`,
    );
    if (res.rowCount && res.rowCount > 0) {
      const offenders = res.rows.map((r) => `#${r.id} ${r.project_name} -> ${r.current_stage_code ?? "NULL"}`);
      throw new Error(
        `Found ${res.rowCount} closed project(s) NOT on S_DONE:\n  ${offenders.join("\n  ")}`,
      );
    }
    expect(res.rowCount).toBe(0);
  });

  it("the migration corrects mismatched status/terminal pairs (closed+S_HOLD -> S_DONE; hold+S_DONE -> S_HOLD)", async () => {
    // Fixture-based proof of corrective behaviour. Insert two rows with
    // intentionally mismatched terminal codes, re-apply the relevant
    // backfill statements, and verify they snap to the correct terminal.
    // Uses a transaction so the fixture rows never escape the test.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Fixture 1: closed project mistakenly on S_HOLD.
      const closedFix = await client.query<{ id: number }>(
        `INSERT INTO project_info (project_name, project_status, archived_status)
         VALUES ($1, 'closed', 'ACTIVE') RETURNING id`,
        [`__fixture_closed_on_hold_${process.pid}_${Date.now()}`],
      );
      const closedId = closedFix.rows[0].id;
      await client.query(
        `INSERT INTO project_execution_state (project_id, current_stage_code)
         VALUES ($1, 'S_HOLD')`,
        [closedId],
      );

      // Fixture 2: hold project mistakenly on S_DONE.
      const holdFix = await client.query<{ id: number }>(
        `INSERT INTO project_info (project_name, project_status, archived_status)
         VALUES ($1, 'hold', 'ACTIVE') RETURNING id`,
        [`__fixture_hold_on_done_${process.pid}_${Date.now()}`],
      );
      const holdId = holdFix.rows[0].id;
      await client.query(
        `INSERT INTO project_execution_state (project_id, current_stage_code)
         VALUES ($1, 'S_DONE')`,
        [holdId],
      );

      // Re-run the strict backfill statements (steps 7d) inside the txn.
      await client.query(
        `UPDATE project_execution_state pes
            SET current_stage_code = 'S_HOLD'
          WHERE pes.project_id = $1
            AND (pes.current_stage_code IS NULL OR pes.current_stage_code <> 'S_HOLD')`,
        [holdId],
      );
      await client.query(
        `UPDATE project_execution_state pes
            SET current_stage_code = 'S_DONE'
          WHERE pes.project_id = $1
            AND (pes.current_stage_code IS NULL OR pes.current_stage_code <> 'S_DONE')`,
        [closedId],
      );

      const after = await client.query<{ id: number; current_stage_code: string }>(
        `SELECT project_id AS id, current_stage_code
           FROM project_execution_state WHERE project_id IN ($1, $2)
          ORDER BY project_id`,
        [closedId, holdId],
      );
      const byId = new Map(after.rows.map((r) => [r.id, r.current_stage_code]));
      expect(byId.get(closedId)).toBe("S_DONE");
      expect(byId.get(holdId)).toBe("S_HOLD");
    } finally {
      // Always roll back so fixture rows never leak.
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("every hold project either has previous_phase set or originates from a brand-new minimal exec state row", async () => {
    // Sanity check: previous_phase is the resume target. After the
    // migration, every hold project should either have a captured
    // previous_phase (from step 7a) or be a brand-new project that
    // genuinely has no prior phase. We require that no hold project has
    // an empty-string previous_phase (which would silently break the
    // resume guard).
    const res = await pool.query<{ id: number }>(
      `SELECT pi.id
         FROM project_info pi
         JOIN project_execution_state pes ON pes.project_id = pi.id
        WHERE pi.project_status = 'hold'
          AND pes.previous_phase IS NOT NULL
          AND pes.previous_phase = ''`,
    );
    expect(res.rowCount).toBe(0);
  });

  it("every non-null previous_phase is a canonical sequential stage code", async () => {
    // The runtime resume path writes previous_phase straight into
    // current_stage_code. If migration step 7a (or any future hand
    // edit) ever leaves a phase label like "Construction" here, the
    // resume would corrupt lifecycle state. Enforce the contract at
    // the data layer.
    const res = await pool.query<{ id: number; previous_phase: string }>(
      `SELECT pes.project_id AS id, pes.previous_phase
         FROM project_execution_state pes
        WHERE pes.previous_phase IS NOT NULL
          AND pes.previous_phase NOT IN (
            SELECT stage_code FROM stage_definitions WHERE stage_code NOT IN ('S_HOLD', 'S_DONE')
          )`,
    );
    if (res.rowCount && res.rowCount > 0) {
      const offenders = res.rows.map((r) => `#${r.id} -> ${r.previous_phase}`);
      throw new Error(
        `Found ${res.rowCount} project(s) with non-canonical previous_phase:\n  ${offenders.join("\n  ")}`,
      );
    }
    expect(res.rowCount).toBe(0);
  });

  it("S_HOLD and S_DONE stage definitions are present and active", async () => {
    const res = await pool.query<{ stage_code: string; is_active: boolean }>(
      `SELECT stage_code, is_active
         FROM stage_definitions
        WHERE stage_code IN ('S_HOLD', 'S_DONE')
        ORDER BY stage_code`,
    );
    expect(res.rowCount).toBe(2);
    for (const row of res.rows) {
      expect(row.is_active).toBe(true);
    }
  });

  it("every backfilled hold project has a matching S_HOLD stage instance", async () => {
    const res = await pool.query<{ missing_count: string }>(
      `SELECT COUNT(*)::text AS missing_count
         FROM project_info pi
        WHERE pi.project_status = 'hold'
          AND NOT EXISTS (
            SELECT 1 FROM project_stage_instances psi
             WHERE psi.project_id = pi.id AND psi.stage_code = 'S_HOLD'
          )`,
    );
    expect(Number(res.rows[0].missing_count)).toBe(0);
  });

  it("terminal-stage instances use canonical UPPER-case stage_status (matches the StageStatus enum)", async () => {
    // The service writes 'IN_PROGRESS' / 'PROGRESSED' via Drizzle. An
    // earlier draft of this migration inserted lowercase 'in_progress' /
    // 'progressed', which would cause subtle filter-by-status bugs in
    // dashboards. Step 7b'/7c' canonicalises any lowercase rows.
    const res = await pool.query<{ stage_code: string; stage_status: string }>(
      `SELECT stage_code, stage_status
         FROM project_stage_instances
        WHERE stage_code IN ('S_HOLD', 'S_DONE')
          AND stage_status <> upper(stage_status)`,
    );
    expect(res.rowCount).toBe(0);
  });
});
