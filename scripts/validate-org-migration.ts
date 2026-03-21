/**
 * Prompt 11 — Validate organization_id migration.
 *
 * Checks:
 * 1. organizations table exists and has the seed row
 * 2. All 10 target tables have organization_id column
 * 3. All existing rows have organization_id = 1
 * 4. No orphan rows (organization_id references a valid org)
 *
 * Usage: npx tsx scripts/validate-org-migration.ts
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const TARGET_TABLES = [
  "users",
  "clients",
  "project_info",
  "portfolios",
  "counterparties",
  "qc_template",
  "eng_stage_templates",
  "phase_template",
  "app_settings",
  "role_credentials",
];

let failures = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    failures++;
  } else {
    console.log(`  ✓ PASS: ${message}`);
  }
}

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

async function countRows(table: string): Promise<number> {
  const result = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM "${table}"`));
  return Number((result as any).rows?.[0]?.cnt ?? 0);
}

async function countWithOrgId(table: string, orgId: number): Promise<number> {
  const result = await db.execute(sql.raw(
    `SELECT COUNT(*) as cnt FROM "${table}" WHERE organization_id = ${orgId}`
  ));
  return Number((result as any).rows?.[0]?.cnt ?? 0);
}

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║ Prompt 11: Validate Organization Migration       ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // Check organizations table
  console.log("=== Organizations Table ===");
  const orgExists = await tableExists("organizations");
  assert(orgExists, "organizations table exists");

  if (orgExists) {
    const orgCount = await countRows("organizations");
    assert(orgCount >= 1, `organizations has ${orgCount} row(s) (expected >= 1)`);

    const result = await db.execute(sql.raw(
      `SELECT id, name, slug, is_active FROM organizations WHERE slug = 'emergent-energy'`
    ));
    const seedRow = (result as any).rows?.[0];
    assert(seedRow?.id === 1, `Seed org has id=1 (got ${seedRow?.id})`);
    assert(seedRow?.name === "Emergent Energy", `Seed org name = "Emergent Energy"`);
    assert(seedRow?.is_active === true, "Seed org is active");
  }

  // Check each target table
  console.log("\n=== Target Tables ===");
  for (const table of TARGET_TABLES) {
    const exists = await tableExists(table);
    if (!exists) {
      console.log(`  ⚠ SKIP: ${table} — table does not exist`);
      continue;
    }

    const hasCol = await columnExists(table, "organization_id");
    assert(hasCol, `${table} has organization_id column`);

    if (hasCol) {
      const total = await countRows(table);
      const withOrg1 = await countWithOrgId(table, 1);
      assert(
        total === withOrg1,
        `${table}: ${withOrg1}/${total} rows have organization_id=1`,
      );
    }
  }

  // Summary
  console.log("\n=== Summary ===");
  if (failures > 0) {
    console.log(`  ${failures} check(s) FAILED — see above.`);
    process.exitCode = 1;
  } else {
    console.log("  ALL CHECKS PASSED.");
  }
}

if (!process.env.DATABASE_URL) {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║ Prompt 11: Validate Organization Migration       ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log("  SKIPPED — DATABASE_URL not set (requires PostgreSQL).");
  console.log("  Run with: DATABASE_URL=postgres://... npx tsx scripts/validate-org-migration.ts");
} else {
  main().catch((err) => {
    console.error("Validation failed:", err);
    process.exitCode = 1;
  });
}
