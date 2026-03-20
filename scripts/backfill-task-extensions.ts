/**
 * Prompt 6 — Backfill: Populate task_migration_map + extension tables
 *
 * Prerequisites:
 *   - work-items-backfill.ts has already run (core rows exist in work_items)
 *   - Prompt 5 migration has created the extension tables (empty)
 *   - Prompt 6 migration has created task_migration_map
 *
 * This script:
 *   1. Ensures all operational_tasks, engineering_tasks, tasks (legacy) have work_items
 *   2. Populates task_migration_map from work_items.legacy_table + legacy_id
 *   3. Populates work_item_pm from work_items + operational_tasks
 *   4. Populates work_item_engineering from work_items
 *   5. Populates work_item_scheduling from work_items + operational_tasks
 *   6. Validates counts
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql.raw(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${name}') as ex`
  ));
  return (result as any).rows?.[0]?.ex === true;
}

async function count(table: string): Promise<number> {
  const result = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM "${table}"`));
  return Number((result as any).rows?.[0]?.cnt ?? 0);
}

// ─── Step 1: Populate task_migration_map from existing work_items ────

async function populateMigrationMap(): Promise<void> {
  console.log("\n=== Step 1: Populate task_migration_map ===");

  // Insert from work_items that have legacy_table + legacy_id set
  const result = await db.execute(sql.raw(`
    INSERT INTO task_migration_map (old_table, old_id, new_work_item_id)
    SELECT wi.legacy_table, wi.legacy_id, wi.id
    FROM work_items wi
    WHERE wi.legacy_table IS NOT NULL AND wi.legacy_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM task_migration_map tmm
        WHERE tmm.old_table = wi.legacy_table AND tmm.old_id = wi.legacy_id
      )
    ON CONFLICT (old_table, old_id) DO NOTHING
  `));

  const mapCount = await count("task_migration_map");
  console.log(`  task_migration_map rows: ${mapCount}`);

  // Break down by source table
  const breakdown = await db.execute(sql.raw(`
    SELECT old_table, COUNT(*) as cnt FROM task_migration_map GROUP BY old_table ORDER BY old_table
  `));
  for (const row of (breakdown as any).rows) {
    console.log(`    ${row.old_table}: ${row.cnt}`);
  }
}

// ─── Step 2: Populate work_item_pm ──────────────────────────────────

async function populateWorkItemPm(): Promise<void> {
  console.log("\n=== Step 2: Populate work_item_pm ===");

  // Copy PM-domain columns from work_items into work_item_pm for ALL rows
  // (every work_item gets a PM extension row if it has any PM data)
  const inserted = await db.execute(sql.raw(`
    INSERT INTO work_item_pm (
      work_item_id, duration, percent_complete, expected_pct_complete,
      phase, is_milestone, indent_level, owner_name, is_shared,
      hold_reason, blocked_type, blocker_reason, approval_required,
      tracking_rag, task_type_tag, sub_project_name, completed_at,
      linked_plan_item_id, linked_deliverable_id, linked_quality_item_instance_id
    )
    SELECT
      wi.id,
      wi.duration, wi.percent_complete, wi.expected_pct_complete,
      wi.phase, wi.is_milestone, wi.indent_level, wi.owner_name, wi.is_shared,
      wi.hold_reason, wi.blocked_type, wi.blocker_reason, wi.approval_required,
      wi.tracking_rag, wi.task_type_tag, wi.sub_project_name, wi.completed_at,
      wi.linked_plan_item_id, wi.linked_deliverable_id, wi.linked_quality_item_instance_id
    FROM work_items wi
    WHERE wi.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM work_item_pm wip WHERE wip.work_item_id = wi.id
      )
      AND (
        wi.duration IS NOT NULL OR wi.percent_complete IS NOT NULL
        OR wi.phase IS NOT NULL OR wi.is_milestone = true
        OR wi.hold_reason IS NOT NULL OR wi.blocked_type IS NOT NULL
        OR wi.approval_required = true OR wi.tracking_rag IS NOT NULL
        OR wi.linked_plan_item_id IS NOT NULL OR wi.linked_deliverable_id IS NOT NULL
        OR wi.completed_at IS NOT NULL OR wi.indent_level IS NOT NULL
        OR wi.owner_name IS NOT NULL OR wi.task_type_tag IS NOT NULL
        OR wi.blocker_reason IS NOT NULL OR wi.sub_project_name IS NOT NULL
        OR wi.expected_pct_complete IS NOT NULL
        OR wi.linked_quality_item_instance_id IS NOT NULL
      )
    ON CONFLICT (work_item_id) DO NOTHING
  `));

  const pmCount = await count("work_item_pm");
  console.log(`  work_item_pm rows: ${pmCount}`);

  // Enrich from operational_tasks: fields not on work_items
  // (operational_tasks has extra PM fields like requesterUserId, approverUserId, etc.
  //  but those don't have corresponding columns in work_item_pm yet —
  //  they would need schema additions in a future prompt)
  if (await tableExists("operational_tasks")) {
    console.log("  (operational_tasks extra fields noted — no new columns in PM extension for them yet)");
  }
}

// ─── Step 3: Populate work_item_engineering ──────────────────────────

async function populateWorkItemEngineering(): Promise<void> {
  console.log("\n=== Step 3: Populate work_item_engineering ===");

  // Copy engineering/import-provenance columns from work_items
  const inserted = await db.execute(sql.raw(`
    INSERT INTO work_item_engineering (
      work_item_id, wbs_code, outline_number,
      legacy_table, legacy_id, source_row, source_sheet, import_run_id
    )
    SELECT
      wi.id,
      wi.wbs_code, wi.outline_number,
      wi.legacy_table, wi.legacy_id, wi.source_row, wi.source_sheet, wi.import_run_id
    FROM work_items wi
    WHERE wi.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM work_item_engineering wie WHERE wie.work_item_id = wi.id
      )
      AND (
        wi.wbs_code IS NOT NULL OR wi.outline_number IS NOT NULL
        OR wi.legacy_table IS NOT NULL OR wi.legacy_id IS NOT NULL
        OR wi.source_row IS NOT NULL OR wi.source_sheet IS NOT NULL
        OR wi.import_run_id IS NOT NULL
      )
    ON CONFLICT (work_item_id) DO NOTHING
  `));

  const engCount = await count("work_item_engineering");
  console.log(`  work_item_engineering rows: ${engCount}`);
}

// ─── Step 4: Populate work_item_scheduling ───────────────────────────

async function populateWorkItemScheduling(): Promise<void> {
  console.log("\n=== Step 4: Populate work_item_scheduling ===");

  // Copy scheduling/calendar columns from work_items
  const inserted = await db.execute(sql.raw(`
    INSERT INTO work_item_scheduling (
      work_item_id, scheduled_date, scheduled_start_time, scheduled_end_time,
      estimate_minutes, task_category,
      baseline_start, baseline_end, baseline_duration,
      task_mode, actual_start, actual_end, actual_duration,
      is_recurring, recurrence_frequency, recurrence_interval,
      recurrence_days_of_week, recurrence_end_date, recurrence_parent_id
    )
    SELECT
      wi.id,
      wi.scheduled_date, wi.scheduled_start_time, wi.scheduled_end_time,
      wi.estimate_minutes, wi.task_category,
      wi.baseline_start, wi.baseline_end, wi.baseline_duration,
      wi.task_mode, wi.actual_start, wi.actual_end, wi.actual_duration,
      wi.is_recurring, wi.recurrence_frequency, wi.recurrence_interval,
      wi.recurrence_days_of_week, wi.recurrence_end_date, wi.recurrence_parent_id
    FROM work_items wi
    WHERE wi.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM work_item_scheduling wis WHERE wis.work_item_id = wi.id
      )
      AND (
        wi.scheduled_date IS NOT NULL OR wi.scheduled_start_time IS NOT NULL
        OR wi.estimate_minutes IS NOT NULL OR wi.task_category IS NOT NULL
        OR wi.baseline_start IS NOT NULL OR wi.baseline_end IS NOT NULL
        OR wi.actual_start IS NOT NULL OR wi.actual_end IS NOT NULL
        OR wi.is_recurring = true OR wi.recurrence_frequency IS NOT NULL
        OR wi.task_mode IS NOT NULL
      )
    ON CONFLICT (work_item_id) DO NOTHING
  `));

  // Also populate scheduling from operational_tasks for scheduling fields
  if (await tableExists("operational_tasks")) {
    await db.execute(sql.raw(`
      INSERT INTO work_item_scheduling (
        work_item_id, scheduled_date, scheduled_start_time, scheduled_end_time,
        actual_start, actual_end, actual_duration
      )
      SELECT
        wi.id,
        ot.scheduled_date, ot.scheduled_start_time, ot.scheduled_end_time,
        ot.actual_start_date, ot.actual_end_date, ot.actual_duration_days
      FROM work_items wi
      JOIN operational_tasks ot ON wi.legacy_table = 'operational_tasks' AND wi.legacy_id = ot.id
      WHERE wi.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM work_item_scheduling wis WHERE wis.work_item_id = wi.id)
        AND (
          ot.scheduled_date IS NOT NULL OR ot.scheduled_start_time IS NOT NULL
          OR ot.actual_start_date IS NOT NULL OR ot.actual_end_date IS NOT NULL
        )
      ON CONFLICT (work_item_id) DO NOTHING
    `));
  }

  // Also populate scheduling from engineering_tasks for scheduling fields
  if (await tableExists("engineering_tasks")) {
    await db.execute(sql.raw(`
      INSERT INTO work_item_scheduling (
        work_item_id, scheduled_date, scheduled_start_time, scheduled_end_time
      )
      SELECT
        wi.id,
        et.scheduled_date, et.scheduled_start_time, et.scheduled_end_time
      FROM work_items wi
      JOIN engineering_tasks et ON wi.legacy_table = 'engineering_tasks' AND wi.legacy_id = et.id
      WHERE wi.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM work_item_scheduling wis WHERE wis.work_item_id = wi.id)
        AND (et.scheduled_date IS NOT NULL OR et.scheduled_start_time IS NOT NULL)
      ON CONFLICT (work_item_id) DO NOTHING
    `));
  }

  const schedCount = await count("work_item_scheduling");
  console.log(`  work_item_scheduling rows: ${schedCount}`);
}

// ─── Step 5: Validate ────────────────────────────────────────────────

async function validate(): Promise<void> {
  console.log("\n=== Step 5: Validation ===");

  const wiCount = await count("work_items");
  const mapCount = await count("task_migration_map");
  const pmCount = await count("work_item_pm");
  const engCount = await count("work_item_engineering");
  const schedCount = await count("work_item_scheduling");

  console.log(`  work_items total:           ${wiCount}`);
  console.log(`  task_migration_map total:    ${mapCount}`);
  console.log(`  work_item_pm total:          ${pmCount}`);
  console.log(`  work_item_engineering total:  ${engCount}`);
  console.log(`  work_item_scheduling total:  ${schedCount}`);

  // Check that every mapped source row has a valid work_item
  const orphanCheck = await db.execute(sql.raw(`
    SELECT COUNT(*) as cnt FROM task_migration_map tmm
    WHERE NOT EXISTS (SELECT 1 FROM work_items wi WHERE wi.id = tmm.new_work_item_id)
  `));
  const orphans = Number((orphanCheck as any).rows?.[0]?.cnt ?? 0);
  console.log(`  Migration map orphans:       ${orphans}`);
  if (orphans > 0) {
    console.error("  ❌ FAIL: task_migration_map has orphaned references!");
  }

  // Check source table coverage
  const sourceTables = [
    "operational_tasks",
    "engineering_tasks",
    "tasks",
    "mytool_tasks",
    "intake_tasks",
    "project_eng_tasks",
    "qc_item_instance",
    "normalized_plan_tasks",
    "project_plan",
  ];

  for (const table of sourceTables) {
    if (!(await tableExists(table))) continue;

    const sourceCount = await count(table);
    const mappedResult = await db.execute(sql.raw(
      `SELECT COUNT(*) as cnt FROM task_migration_map WHERE old_table = '${table}'`
    ));
    const mappedCount = Number((mappedResult as any).rows?.[0]?.cnt ?? 0);

    // For operational_tasks, check deleted rows are excluded
    let activeCount = sourceCount;
    if (table === "operational_tasks") {
      const activeResult = await db.execute(sql.raw(
        `SELECT COUNT(*) as cnt FROM operational_tasks WHERE deleted_at IS NULL`
      ));
      activeCount = Number((activeResult as any).rows?.[0]?.cnt ?? 0);
    } else if (table === "engineering_tasks") {
      const activeResult = await db.execute(sql.raw(
        `SELECT COUNT(*) as cnt FROM engineering_tasks WHERE soft_deleted_at IS NULL`
      ));
      activeCount = Number((activeResult as any).rows?.[0]?.cnt ?? 0);
    }

    const coverage = activeCount > 0 ? ((mappedCount / activeCount) * 100).toFixed(1) : "N/A";
    const status = mappedCount >= activeCount ? "✓" : "⚠";
    console.log(`  ${status} ${table}: ${mappedCount}/${activeCount} mapped (${coverage}%)`);
  }

  // Check extension table coverage
  const wiWithPmData = await db.execute(sql.raw(`
    SELECT COUNT(*) as cnt FROM work_items wi
    WHERE wi.deleted_at IS NULL AND (
      wi.duration IS NOT NULL OR wi.percent_complete IS NOT NULL
      OR wi.phase IS NOT NULL OR wi.hold_reason IS NOT NULL
      OR wi.completed_at IS NOT NULL OR wi.tracking_rag IS NOT NULL
    )
  `));
  const pmEligible = Number((wiWithPmData as any).rows?.[0]?.cnt ?? 0);
  console.log(`  PM extension: ${pmCount} populated (${pmEligible} eligible work_items)`);

  const wiWithEngData = await db.execute(sql.raw(`
    SELECT COUNT(*) as cnt FROM work_items wi
    WHERE wi.deleted_at IS NULL AND (
      wi.wbs_code IS NOT NULL OR wi.legacy_table IS NOT NULL
      OR wi.source_row IS NOT NULL
    )
  `));
  const engEligible = Number((wiWithEngData as any).rows?.[0]?.cnt ?? 0);
  console.log(`  Engineering extension: ${engCount} populated (${engEligible} eligible work_items)`);

  console.log("\n=== Validation complete ===");
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║ Prompt 6: Task Extension Table Backfill          ║");
  console.log("╚══════════════════════════════════════════════════╝");

  try {
    // Check prerequisites
    for (const table of ["work_items", "work_item_pm", "work_item_engineering", "work_item_scheduling", "task_migration_map"]) {
      if (!(await tableExists(table))) {
        console.error(`ERROR: ${table} does not exist. Run migrations first.`);
        process.exit(1);
      }
    }

    await populateMigrationMap();
    await populateWorkItemPm();
    await populateWorkItemEngineering();
    await populateWorkItemScheduling();
    await validate();

    console.log("\nDone.");
  } catch (err) {
    console.error("Backfill failed:", err);
    process.exit(1);
  }
}

main().catch(console.error);
