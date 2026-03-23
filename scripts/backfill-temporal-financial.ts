/**
 * Prompt 9 — Backfill temporal columns on financial tables.
 *
 * Sets effective_from = created_at (or captured_at for project_revenue_summary)
 * and effective_to = NULL (all rows are current).
 *
 * Also links snapshot_run_id = import_run_id where available.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const TABLES_WITH_CREATED_AT_AND_IMPORT_RUN = [
  "program_expense",
  "program_inflows",
  "normalized_cost_lines",
  "normalized_revenue_lines",
];

const TABLES_WITH_CREATED_AT_ONLY = [
  "cashflow_points",
  "finance_revenue_monthly",
  "finance_cos_monthly",
];

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

async function count(table: string): Promise<number> {
  const result = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM "${table}"`));
  return Number((result as any).rows?.[0]?.cnt ?? 0);
}

async function backfillTable(table: string, timestampCol: string, hasImportRunId: boolean): Promise<void> {
  if (!(await tableExists(table))) {
    console.log(`  ${table}: table does not exist, skipping`);
    return;
  }
  if (!(await columnExists(table, "effective_from"))) {
    console.log(`  ${table}: effective_from column missing — run migration first`);
    return;
  }

  const total = await count(table);

  // Set effective_from = created_at/captured_at for rows where it's still the DEFAULT
  // (We detect un-backfilled rows by checking if effective_from equals the default NOW() —
  //  but since we can't distinguish, we use a safe approach: only update if created_at is older)
  const updated = await db.execute(sql.raw(`
    UPDATE "${table}"
    SET effective_from = COALESCE(${timestampCol}, effective_from)
    WHERE ${timestampCol} IS NOT NULL
      AND ${timestampCol} < effective_from
  `));
  const updatedCount = (updated as any).rowCount ?? 0;

  // Link snapshot_run_id from import_run_id where available
  if (hasImportRunId) {
    const snapshotLinked = await db.execute(sql.raw(`
      UPDATE "${table}"
      SET snapshot_run_id = import_run_id
      WHERE import_run_id IS NOT NULL AND snapshot_run_id IS NULL
    `));
    const linkedCount = (snapshotLinked as any).rowCount ?? 0;
    console.log(`  ${table}: ${total} rows, ${updatedCount} effective_from backfilled, ${linkedCount} snapshot_run_id linked`);
  } else {
    console.log(`  ${table}: ${total} rows, ${updatedCount} effective_from backfilled`);
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║ Prompt 9: Backfill Temporal Financial Columns    ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // Tables with created_at + import_run_id
  for (const table of TABLES_WITH_CREATED_AT_AND_IMPORT_RUN) {
    await backfillTable(table, "created_at", true);
  }

  // Tables with created_at only
  for (const table of TABLES_WITH_CREATED_AT_ONLY) {
    await backfillTable(table, "created_at", false);
  }

  // project_revenue_summary uses captured_at
  await backfillTable("project_revenue_summary", "captured_at", false);

  // Summary
  console.log("\n=== Summary ===");
  const allTables = [
    ...TABLES_WITH_CREATED_AT_AND_IMPORT_RUN,
    ...TABLES_WITH_CREATED_AT_ONLY,
    "project_revenue_summary",
  ];
  for (const table of allTables) {
    if (!(await tableExists(table))) continue;
    const total = await count(table);
    const withEffective = await db.execute(sql.raw(
      `SELECT COUNT(*) as cnt FROM "${table}" WHERE effective_to IS NULL`
    ));
    const current = Number((withEffective as any).rows?.[0]?.cnt ?? 0);
    console.log(`  ${table}: ${current}/${total} current (effective_to IS NULL)`);
  }

  console.log("\nDone.");
}

main().catch(console.error);
