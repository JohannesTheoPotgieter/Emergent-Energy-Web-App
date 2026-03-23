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
    const count = (res as any).rows?.length ?? 0;
    if (count > 0) {
      log(`Backfilled ${count} missing project_execution_state rows`, SRC);
    }
  } catch (err: any) {
    log(`project_execution_state backfill error: ${err.message}`, SRC);
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
    const count = (res as any).rows?.length ?? 0;
    if (count > 0) {
      log(`Backfilled ${count} missing project_settings rows`, SRC);
    }
  } catch (err: any) {
    log(`project_settings backfill error: ${err.message}`, SRC);
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
    const count = (res as any).rows?.length ?? 0;
    if (count > 0) {
      log(`Backfilled ${count} missing dashboard_project_metrics rows`, SRC);
    }
  } catch (err: any) {
    log(`dashboard_project_metrics backfill error: ${err.message}`, SRC);
  }
}
