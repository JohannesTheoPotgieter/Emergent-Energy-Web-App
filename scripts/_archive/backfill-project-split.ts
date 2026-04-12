/**
 * Backfill script: Populate project_execution_state and project_settings
 * from existing project_info data.
 *
 * Usage:
 *   npx tsx scripts/backfill-project-split.ts
 *
 * Prerequisites:
 *   - Run migrations/20260330_split_project_info.sql first
 *   - DATABASE_URL must be set in environment
 *
 * This script is idempotent (uses ON CONFLICT DO NOTHING).
 */

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  console.log("=== Backfill: project_info → project_execution_state + project_settings ===\n");

  // Step 1: Backfill project_execution_state
  console.log("1. Backfilling project_execution_state...");
  const execResult = await db.execute(sql`
    INSERT INTO project_execution_state (
      project_id,
      phase, phase_updated_at, phase_updated_by_user_id, phase_notes,
      pd_handover_date, construction_start_date, commissioning_date,
      om_handover_date, client_handover_date,
      construction_start_actual, pd_handover_actual,
      commissioning_actual, client_handover_actual,
      escalation_level,
      rag_status, rag_comment, rag_updated_at, rag_updated_by_user_id,
      is_active, archived_status,
      execution_enabled, execution_gate_status, execution_gate_reason, execution_phase,
      signed_status, signed_date, signed_document_link,
      cp_signed, cp_signed_date, cp_signed_by_user_id, cp_evidence_type, cp_evidence_ref,
      pm_task_pack_created, eng_post_cp_task_pack_created
    )
    SELECT
      id,
      phase, phase_updated_at, phase_updated_by_user_id, phase_notes,
      pd_handover_date, construction_start_date, commissioning_date,
      om_handover_date, client_handover_date,
      construction_start_actual, pd_handover_actual,
      commissioning_actual, client_handover_actual,
      escalation_level,
      rag_status, rag_comment, rag_updated_at, rag_updated_by_user_id,
      is_active, archived_status,
      execution_enabled, execution_gate_status, execution_gate_reason, execution_phase,
      signed_status, signed_date, signed_document_link,
      cp_signed, cp_signed_date, cp_signed_by_user_id, cp_evidence_type, cp_evidence_ref,
      pm_task_pack_created, eng_post_cp_task_pack_created
    FROM project_info
    ON CONFLICT (project_id) DO NOTHING
  `);
  console.log("   Done.\n");

  // Step 2: Backfill project_settings
  console.log("2. Backfilling project_settings...");
  const settingsResult = await db.execute(sql`
    INSERT INTO project_settings (
      project_id,
      excel_tracker_link
    )
    SELECT
      id,
      excel_tracker_link
    FROM project_info
    ON CONFLICT (project_id) DO NOTHING
  `);
  console.log("   Done.\n");

  // Step 3: Validate row counts match
  console.log("3. Validating row counts...");
  const counts = await db.execute(sql`
    SELECT 'project_info' AS tbl, COUNT(*)::int AS cnt FROM project_info
    UNION ALL
    SELECT 'project_execution_state', COUNT(*)::int FROM project_execution_state
    UNION ALL
    SELECT 'project_settings', COUNT(*)::int FROM project_settings
  `);

  const rows = counts.rows as Array<{ tbl: string; cnt: number }>;
  console.log("   Row counts:");
  for (const row of rows) {
    console.log(`     ${row.tbl}: ${row.cnt}`);
  }

  const allMatch = rows.every((r) => r.cnt === rows[0].cnt);
  if (allMatch) {
    console.log("\n   PASS: All tables have matching row counts.");
  } else {
    console.error("\n   FAIL: Row counts do not match!");
    process.exit(1);
  }

  // Step 4: Spot-check a few columns
  console.log("\n4. Spot-checking column values...");
  const spotCheck = await db.execute(sql`
    SELECT
      pi.id,
      pi.project_name,
      (pi.rag_status IS NOT DISTINCT FROM pes.rag_status) AS rag_match,
      (pi.phase IS NOT DISTINCT FROM pes.phase) AS phase_match,
      (pi.is_active IS NOT DISTINCT FROM pes.is_active) AS active_match,
      (pi.excel_tracker_link IS NOT DISTINCT FROM ps.excel_tracker_link) AS link_match
    FROM project_info pi
    JOIN project_execution_state pes ON pes.project_id = pi.id
    JOIN project_settings ps ON ps.project_id = pi.id
    LIMIT 10
  `);

  const checks = spotCheck.rows as Array<{
    id: number;
    project_name: string;
    rag_match: boolean;
    phase_match: boolean;
    active_match: boolean;
    link_match: boolean;
  }>;

  let allGood = true;
  for (const row of checks) {
    const ok = row.rag_match && row.phase_match && row.active_match && row.link_match;
    if (!ok) allGood = false;
    console.log(
      `   Project ${row.id} (${row.project_name}): rag=${row.rag_match} phase=${row.phase_match} active=${row.active_match} link=${row.link_match} ${ok ? "OK" : "MISMATCH"}`
    );
  }

  if (!allGood) {
    console.error("\n   FAIL: Some spot-check values do not match!");
    process.exit(1);
  }

  console.log("\n=== Backfill complete. All validations passed. ===");
  await pool.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
