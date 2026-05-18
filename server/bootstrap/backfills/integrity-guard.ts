/**
 * Startup Integrity Guard — ensures critical 1:1 relationships and
 * dashboard metrics coverage are never missing at runtime.
 *
 * Runs as a startup backfill. Idempotent (ON CONFLICT DO NOTHING).
 */

import { db, getDbMode } from "../../db";
import { sql } from "drizzle-orm";

export async function runIntegrityGuard(
  log: (message: string, source?: string) => void,
): Promise<void> {
  if (getDbMode() !== "postgres") return;

  const SRC = "Startup:IntegrityGuard";

  // ── 1:1 coverage: project_execution_state ──────────────────────────
  try {
    const res = await db.execute(sql.raw(`
      INSERT INTO project_execution_state (project_id)
      SELECT pi.id FROM project_info pi
      LEFT JOIN project_execution_state pes ON pi.id = pes.project_id
      WHERE pes.id IS NULL
      ON CONFLICT (project_id) DO NOTHING
      RETURNING project_id
    `));
    const count = (res as { rows?: unknown[] }).rows?.length ?? 0;
    if (count > 0) {
      log(`Backfilled ${count} missing project_execution_state rows`, SRC);
    }
  } catch (err: unknown) {
    log(`project_execution_state backfill error: ${(err instanceof Error ? err.message : String(err))}`, SRC);
  }

  // ── Ensure currentStageCode is populated for projects missing it ───
  try {
    const res = await db.execute(sql.raw(`
      UPDATE project_execution_state
      SET current_stage_code = 'S01_FIRST_ASSESSMENT',
          gate_status = COALESCE(gate_status, 'IN_PROGRESS'),
          updated_at = NOW()
      WHERE current_stage_code IS NULL
        AND is_active = true
      RETURNING project_id
    `));
    const count = (res as { rows?: unknown[] }).rows?.length ?? 0;
    if (count > 0) {
      log(`Set default current_stage_code for ${count} projects`, SRC);
    }
  } catch (err: unknown) {
    log(`currentStageCode backfill error: ${(err instanceof Error ? err.message : String(err))}`, SRC);
  }

  // ── 1:1 coverage: project_settings ─────────────────────────────────
  try {
    const res = await db.execute(sql.raw(`
      INSERT INTO project_settings (project_id)
      SELECT pi.id FROM project_info pi
      LEFT JOIN project_settings ps ON pi.id = ps.project_id
      WHERE ps.id IS NULL
      ON CONFLICT (project_id) DO NOTHING
      RETURNING project_id
    `));
    const count = (res as { rows?: unknown[] }).rows?.length ?? 0;
    if (count > 0) {
      log(`Backfilled ${count} missing project_settings rows`, SRC);
    }
  } catch (err: unknown) {
    log(`project_settings backfill error: ${(err instanceof Error ? err.message : String(err))}`, SRC);
  }

  // ── Dashboard metrics coverage ─────────────────────────────────────
  try {
    const res = await db.execute(sql.raw(`
      INSERT INTO dashboard_project_metrics (
        project_id, phase, rag_status, contract_value,
        total_revenue, received_revenue, outstanding_revenue,
        total_cost, paid_cost, outstanding_cost,
        task_count, tasks_completed, tasks_in_progress, tasks_overdue
      )
      SELECT
        pi.id,
        pes.phase, pes.rag_status, pi.contract_value,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0
      FROM project_info pi
      LEFT JOIN project_execution_state pes ON pi.id = pes.project_id
      LEFT JOIN dashboard_project_metrics dpm ON pi.id = dpm.project_id
      WHERE dpm.id IS NULL
      ON CONFLICT (project_id) DO NOTHING
      RETURNING project_id
    `));
    const count = (res as { rows?: unknown[] }).rows?.length ?? 0;
    if (count > 0) {
      log(`Backfilled ${count} missing dashboard_project_metrics rows`, SRC);
    }
  } catch (err: unknown) {
    log(`dashboard_project_metrics backfill error: ${(err instanceof Error ? err.message : String(err))}`, SRC);
  }
}
