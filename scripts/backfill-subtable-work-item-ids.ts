/**
 * Prompt 7 — Backfill: Repoint task sub-tables → work_items
 *
 * For each sub-table (task_comments, task_checklists, task_attachments,
 * task_activity_log, task_watchers, task_deliverables):
 *   1. Resolve taskId → work_item_id via task_migration_map
 *   2. Fall back to direct match if taskId IS a work_items.id
 *   3. Report orphans (rows that can't be resolved)
 *
 * Prerequisites:
 *   - Prompt 6 migration + backfill complete (task_migration_map populated)
 *   - Prompt 7 migration applied (work_item_id columns exist)
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql.raw(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${name}') as ex`
  ));
  return (result as any).rows?.[0]?.ex === true;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql.raw(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}') as ex`
  ));
  return (result as any).rows?.[0]?.ex === true;
}

async function count(table: string, where?: string): Promise<number> {
  const q = where ? `SELECT COUNT(*) as cnt FROM "${table}" WHERE ${where}` : `SELECT COUNT(*) as cnt FROM "${table}"`;
  const result = await db.execute(sql.raw(q));
  return Number((result as any).rows?.[0]?.cnt ?? 0);
}

/**
 * Backfill work_item_id for a sub-table.
 *
 * Strategy (in order of priority):
 *   1. Match via task_migration_map: try each old_table that could be the source
 *   2. Direct match: if taskId is already a valid work_items.id
 *
 * The old taskId column is polymorphic — it could reference operational_tasks,
 * engineering_tasks, or (post-migration) work_items directly.
 */
async function backfillSubtable(table: string): Promise<{
  total: number;
  resolved: number;
  orphans: number;
}> {
  console.log(`\n--- ${table} ---`);

  if (!(await tableExists(table))) {
    console.log(`  Table does not exist, skipping`);
    return { total: 0, resolved: 0, orphans: 0 };
  }

  if (!(await columnExists(table, "work_item_id"))) {
    console.log(`  work_item_id column missing — run migration first`);
    return { total: 0, resolved: 0, orphans: 0 };
  }

  const total = await count(table);
  const alreadyResolved = await count(table, "work_item_id IS NOT NULL");
  if (alreadyResolved === total && total > 0) {
    console.log(`  Already fully resolved (${total} rows)`);
    return { total, resolved: total, orphans: 0 };
  }

  // Strategy 1: Match via task_migration_map (try all source tables)
  // The taskId in sub-tables most commonly refers to operational_tasks.id,
  // but could also be engineering_tasks.id or other source tables.
  const sourceTables = [
    "operational_tasks",
    "engineering_tasks",
    "tasks",
    "normalized_plan_tasks",
    "mytool_tasks",
    "intake_tasks",
    "project_eng_tasks",
    "qc_item_instance",
    "project_plan",
  ];

  for (const sourceTable of sourceTables) {
    const updated = await db.execute(sql.raw(`
      UPDATE "${table}" sub
      SET work_item_id = tmm.new_work_item_id
      FROM task_migration_map tmm
      WHERE tmm.old_table = '${sourceTable}'
        AND tmm.old_id = sub.task_id
        AND sub.work_item_id IS NULL
    `));
    const updatedCount = (updated as any).rowCount ?? 0;
    if (updatedCount > 0) {
      console.log(`  Resolved ${updatedCount} rows via task_migration_map (${sourceTable})`);
    }
  }

  // Strategy 2: Direct match — taskId might already be a work_items.id
  // (if code was already writing work_items IDs after the migration)
  const directUpdated = await db.execute(sql.raw(`
    UPDATE "${table}" sub
    SET work_item_id = wi.id
    FROM work_items wi
    WHERE wi.id = sub.task_id
      AND sub.work_item_id IS NULL
      AND wi.deleted_at IS NULL
  `));
  const directCount = (directUpdated as any).rowCount ?? 0;
  if (directCount > 0) {
    console.log(`  Resolved ${directCount} rows via direct work_items match`);
  }

  const resolved = await count(table, "work_item_id IS NOT NULL");
  const orphans = total - resolved;

  console.log(`  Total: ${total} | Resolved: ${resolved} | Orphans: ${orphans}`);

  return { total, resolved, orphans };
}

// ─── Validation + Orphan Report ──────────────────────────────────────

async function generateOrphanReport(tables: string[]): Promise<void> {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║ Orphan Report                                    ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  let totalOrphans = 0;

  for (const table of tables) {
    if (!(await tableExists(table))) continue;
    if (!(await columnExists(table, "work_item_id"))) continue;

    const orphanCount = await count(table, "work_item_id IS NULL");
    if (orphanCount === 0) {
      console.log(`  ✓ ${table}: no orphans`);
      continue;
    }

    totalOrphans += orphanCount;
    console.log(`  ⚠ ${table}: ${orphanCount} orphans`);

    // Sample orphans for debugging
    const samples = await db.execute(sql.raw(`
      SELECT id, task_id FROM "${table}" WHERE work_item_id IS NULL LIMIT 5
    `));
    for (const row of (samples as any).rows) {
      console.log(`    id=${row.id} task_id=${row.task_id}`);
    }
  }

  if (totalOrphans === 0) {
    console.log("\n  All sub-table rows successfully resolved to work_items.");
  } else {
    console.log(`\n  Total orphans across all tables: ${totalOrphans}`);
    console.log("  These rows reference task IDs that have no matching work_item.");
    console.log("  Possible causes: deleted tasks, test data, or unmigrated source tables.");
  }
}

// ─── Main ────────────────────────────────────────────────────────────

const SUBTABLES = [
  "task_comments",
  "task_checklists",
  "task_attachments",
  "task_activity_log",
  "task_watchers",
  "task_deliverables",
];

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║ Prompt 7: Repoint Task Sub-tables                ║");
  console.log("╚══════════════════════════════════════════════════╝");

  // Prerequisite check
  if (!(await tableExists("task_migration_map"))) {
    console.error("ERROR: task_migration_map does not exist. Run Prompt 6 migration first.");
    process.exit(1);
  }

  const results: Record<string, { total: number; resolved: number; orphans: number }> = {};

  for (const table of SUBTABLES) {
    results[table] = await backfillSubtable(table);
  }

  await generateOrphanReport(SUBTABLES);

  // Summary
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║ Summary                                          ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  let anyOrphans = false;
  for (const [table, r] of Object.entries(results)) {
    const pct = r.total > 0 ? ((r.resolved / r.total) * 100).toFixed(1) : "N/A";
    const status = r.orphans === 0 ? "✓" : "⚠";
    console.log(`  ${status} ${table}: ${r.resolved}/${r.total} (${pct}%)`);
    if (r.orphans > 0) anyOrphans = true;
  }

  // Note about work_item_assignments and work_item_dependencies
  console.log("\n  ℹ work_item_assignments: already references work_items (no changes needed)");
  console.log("  ℹ work_item_dependencies: already references work_items (no changes needed)");

  if (anyOrphans) {
    console.log("\n  ⚠ Some orphans remain — see orphan report above.");
  } else {
    console.log("\n  All sub-tables fully resolved.");
  }

  console.log("\nDone.");
}

main().catch(console.error);
