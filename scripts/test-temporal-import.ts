/**
 * Prompt 10 — Test script for temporal import pipeline.
 *
 * Simulates a two-round import to verify:
 * 1. First import: rows inserted with effective_from, effective_to = NULL
 * 2. Second import: old rows get effective_to set, new rows have effective_to = NULL
 * 3. getFinancialStateAt(projectId, beforeSecondImport) → returns first-import data
 * 4. getFinancialStateAt(projectId, afterSecondImport) → returns second-import data
 *
 * Uses normalized_cost_lines as the test table (most complex pipeline).
 *
 * Usage: npx tsx scripts/test-temporal-import.ts
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { getFinancialStateAt, getCurrentFinancialState } from "../server/services/financial-temporal";

const TEST_PROJECT_NAME = "__temporal_test_project__";
const TEST_PROJECT_ID = 999999;

async function cleanup() {
  // Hard delete all test rows (even soft-closed ones)
  await db.execute(sql.raw(`DELETE FROM "normalized_cost_lines" WHERE project_name = '${TEST_PROJECT_NAME}'`));
  await db.execute(sql.raw(`DELETE FROM "normalized_revenue_lines" WHERE project_name = '${TEST_PROJECT_NAME}'`));
  await db.execute(sql.raw(`DELETE FROM "program_expense" WHERE project_name = '${TEST_PROJECT_NAME}'`));
  await db.execute(sql.raw(`DELETE FROM "program_inflows" WHERE project_name = '${TEST_PROJECT_NAME}'`));
}

async function insertTestRows(
  tableName: string,
  descriptions: string[],
  snapshotRunId: number,
  effectiveFrom: Date,
) {
  for (const desc of descriptions) {
    await db.execute(sql.raw(`
      INSERT INTO "${tableName}" (project_id, project_name, description, amount_ex_vat, source_sheet, source_row, import_run_id, effective_from, effective_to, snapshot_run_id)
      VALUES (${TEST_PROJECT_ID}, '${TEST_PROJECT_NAME}', '${desc}', '100.00', 'test', 1, ${snapshotRunId}, '${effectiveFrom.toISOString()}'::timestamp, NULL, ${snapshotRunId})
    `));
  }
}

async function softCloseRows(tableName: string, effectiveTo: Date) {
  await db.execute(sql.raw(`
    UPDATE "${tableName}"
    SET effective_to = '${effectiveTo.toISOString()}'::timestamp
    WHERE project_id = ${TEST_PROJECT_ID}
      AND effective_to IS NULL
  `));
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ PASS: ${message}`);
  }
}

async function runTest() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║ Prompt 10: Temporal Import Pipeline Test         ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  await cleanup();

  // ── Round 1: Initial import ──────────────────────────────
  const t0 = new Date("2026-01-01T00:00:00Z");
  const t1 = new Date("2026-01-15T00:00:00Z"); // "yesterday" — between imports
  const t2 = new Date("2026-02-01T00:00:00Z"); // second import time
  const t3 = new Date("2026-03-01T00:00:00Z"); // "now" — after second import

  console.log("=== Round 1: Initial import at", t0.toISOString(), "===");
  await insertTestRows("normalized_cost_lines", ["Item A v1", "Item B v1", "Item C v1"], 1001, t0);

  // Verify: 3 rows, all with effective_to = NULL
  const round1Current = await getCurrentFinancialState(TEST_PROJECT_ID, "normalized_cost_lines");
  assert(round1Current.length === 3, `Round 1: 3 current rows (got ${round1Current.length})`);
  assert(round1Current.every((r: any) => r.effective_to === null), "Round 1: all rows have effective_to = NULL");
  assert(round1Current.every((r: any) => r.snapshot_run_id === 1001), "Round 1: all rows have snapshot_run_id = 1001");

  // ── Round 2: Re-import (simulates soft-close + new insert) ──
  console.log("\n=== Round 2: Re-import at", t2.toISOString(), "===");
  // Step 2a: Soft-close old rows
  await softCloseRows("normalized_cost_lines", t2);

  // Step 2b: Insert new versions
  await insertTestRows("normalized_cost_lines", ["Item A v2", "Item B v2", "Item D v2"], 1002, t2);

  // Verify: old rows have effective_to set
  const allRows = (await db.execute(sql.raw(`
    SELECT * FROM "normalized_cost_lines" WHERE project_id = ${TEST_PROJECT_ID} ORDER BY id ASC
  `)) as any).rows || [];
  const closedRows = allRows.filter((r: any) => r.effective_to !== null);
  const openRows = allRows.filter((r: any) => r.effective_to === null);

  console.log(`\n=== Verification ===`);
  console.log(`  Total rows: ${allRows.length} (${closedRows.length} closed, ${openRows.length} open)`);

  assert(allRows.length === 6, `Total rows = 6 (3 old + 3 new), got ${allRows.length}`);
  assert(closedRows.length === 3, `3 rows closed (effective_to set), got ${closedRows.length}`);
  assert(openRows.length === 3, `3 rows open (effective_to NULL), got ${openRows.length}`);

  // ── Point-in-time queries ──────────────────────────────
  console.log("\n=== Point-in-time queries ===");

  // Query at t1 (between imports) should return Round 1 data
  const stateAtT1 = await getFinancialStateAt(TEST_PROJECT_ID, t1, "normalized_cost_lines");
  assert(stateAtT1.length === 3, `State at t1 (between imports): 3 rows (got ${stateAtT1.length})`);
  const t1Descriptions = stateAtT1.map((r: any) => r.description).sort();
  assert(
    t1Descriptions.includes("Item A v1") && t1Descriptions.includes("Item B v1"),
    `State at t1 contains v1 data: ${JSON.stringify(t1Descriptions)}`,
  );

  // Query at t3 (after second import) should return Round 2 data
  const stateAtT3 = await getFinancialStateAt(TEST_PROJECT_ID, t3, "normalized_cost_lines");
  assert(stateAtT3.length === 3, `State at t3 (after reimport): 3 rows (got ${stateAtT3.length})`);
  const t3Descriptions = stateAtT3.map((r: any) => r.description).sort();
  assert(
    t3Descriptions.includes("Item A v2") && t3Descriptions.includes("Item D v2"),
    `State at t3 contains v2 data: ${JSON.stringify(t3Descriptions)}`,
  );

  // getCurrentFinancialState should return same as stateAtT3
  const currentState = await getCurrentFinancialState(TEST_PROJECT_ID, "normalized_cost_lines");
  assert(currentState.length === 3, `Current state: 3 rows (got ${currentState.length})`);
  assert(
    currentState.every((r: any) => r.snapshot_run_id === 1002),
    `Current state: all rows from snapshot 1002`,
  );

  // Query at t0 - 1day (before any import) should return 0 rows
  const stateBeforeAll = await getFinancialStateAt(
    TEST_PROJECT_ID,
    new Date("2025-12-31T00:00:00Z"),
    "normalized_cost_lines",
  );
  assert(stateBeforeAll.length === 0, `State before any import: 0 rows (got ${stateBeforeAll.length})`);

  // ── Cleanup ──
  console.log("\n=== Cleanup ===");
  await cleanup();
  console.log("  Test rows removed.");

  console.log("\n=== Summary ===");
  if (process.exitCode === 1) {
    console.log("  SOME TESTS FAILED — see above.");
  } else {
    console.log("  ALL TESTS PASSED.");
  }
}

// Guard: requires PostgreSQL (temporal columns not available in SQLite)
if (!process.env.DATABASE_URL) {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║ Prompt 10: Temporal Import Pipeline Test         ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log("  SKIPPED — DATABASE_URL not set (requires PostgreSQL).");
  console.log("  Run with: DATABASE_URL=postgres://... npx tsx scripts/test-temporal-import.ts");
  process.exit(0);
} else {
  runTest().catch((err) => {
    console.error("Test failed with error:", err);
    process.exitCode = 1;
  });
}
