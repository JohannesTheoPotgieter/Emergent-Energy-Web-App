/**
 * verify-migration-parity.ts
 *
 * Compares legacy vs canonical table contents after migration to confirm parity.
 * Run with: npx tsx scripts/verify-migration-parity.ts
 *
 * Checks:
 * 1. Row counts match (legacy rows all appear in canonical)
 * 2. No duplicates under conflict targets
 * 3. Field values match (spot-check sample records)
 * 4. Status normalization is correct (lowercase → uppercase)
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

interface ParityResult {
  table: string;
  legacyCount: number;
  canonicalCount: number;
  migratedCount: number;
  duplicateCount: number;
  sampleMismatches: string[];
  pass: boolean;
}

async function verifyCommitmentsParity(): Promise<ParityResult> {
  const result: ParityResult = {
    table: "client_commitments → project_client_commitments",
    legacyCount: 0,
    canonicalCount: 0,
    migratedCount: 0,
    duplicateCount: 0,
    sampleMismatches: [],
    pass: true,
  };

  // Check if legacy table exists
  const legacyExists = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'client_commitments'
    ) AS exists
  `);
  if (!legacyExists.rows[0]?.exists) {
    console.log("  ⚠ Legacy table client_commitments does not exist — skipping");
    return result;
  }

  // Row counts
  const [legacyCount] = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM client_commitments`);
  const [canonicalCount] = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM project_client_commitments`);
  const [migratedCount] = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM project_client_commitments WHERE migrated_from_legacy = true
  `);

  result.legacyCount = (legacyCount as any).cnt;
  result.canonicalCount = (canonicalCount as any).cnt;
  result.migratedCount = (migratedCount as any).cnt;

  if (result.migratedCount < result.legacyCount) {
    result.sampleMismatches.push(
      `Only ${result.migratedCount} of ${result.legacyCount} legacy rows were migrated (possible conflicts)`
    );
    result.pass = false;
  }

  // Duplicate check
  const dupes = await db.execute(sql`
    SELECT project_id, commitment_text, committed_date, COUNT(*) AS cnt
    FROM project_client_commitments
    GROUP BY project_id, commitment_text, committed_date
    HAVING COUNT(*) > 1
  `);
  result.duplicateCount = dupes.rows.length;
  if (result.duplicateCount > 0) {
    result.sampleMismatches.push(`${result.duplicateCount} duplicate commitment groups found`);
    result.pass = false;
  }

  // Sample comparison: check status normalization
  const badStatus = await db.execute(sql`
    SELECT id, status FROM project_client_commitments
    WHERE migrated_from_legacy = true AND status != UPPER(status)
    LIMIT 5
  `);
  if (badStatus.rows.length > 0) {
    result.sampleMismatches.push(
      `${badStatus.rows.length} migrated rows have non-uppercase status values`
    );
    result.pass = false;
  }

  return result;
}

async function verifyUpdatesParity(): Promise<ParityResult> {
  const result: ParityResult = {
    table: "client_updates → project_client_updates",
    legacyCount: 0,
    canonicalCount: 0,
    migratedCount: 0,
    duplicateCount: 0,
    sampleMismatches: [],
    pass: true,
  };

  // Check if legacy table exists
  const legacyExists = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'client_updates'
    ) AS exists
  `);
  if (!legacyExists.rows[0]?.exists) {
    console.log("  ⚠ Legacy table client_updates does not exist — skipping");
    return result;
  }

  // Row counts
  const [legacyCount] = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM client_updates`);
  const [canonicalCount] = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM project_client_updates`);
  const [migratedCount] = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM project_client_updates WHERE migrated_from_legacy = true
  `);

  result.legacyCount = (legacyCount as any).cnt;
  result.canonicalCount = (canonicalCount as any).cnt;
  result.migratedCount = (migratedCount as any).cnt;

  if (result.migratedCount < result.legacyCount) {
    result.sampleMismatches.push(
      `Only ${result.migratedCount} of ${result.legacyCount} legacy rows were migrated (possible conflicts on project_id+update_number)`
    );
    result.pass = false;
  }

  // Duplicate check on unique constraint
  const dupes = await db.execute(sql`
    SELECT project_id, update_number, COUNT(*) AS cnt
    FROM project_client_updates
    GROUP BY project_id, update_number
    HAVING COUNT(*) > 1
  `);
  result.duplicateCount = dupes.rows.length;
  if (result.duplicateCount > 0) {
    result.sampleMismatches.push(`${result.duplicateCount} duplicate update groups found`);
    result.pass = false;
  }

  // Sample comparison: check status normalization
  const badStatus = await db.execute(sql`
    SELECT id, status FROM project_client_updates
    WHERE migrated_from_legacy = true AND status != UPPER(status)
    LIMIT 5
  `);
  if (badStatus.rows.length > 0) {
    result.sampleMismatches.push(
      `${badStatus.rows.length} migrated rows have non-uppercase status values`
    );
    result.pass = false;
  }

  // Check field mapping: sent_by_user_id should match client_update_sent_by
  const sentByMismatch = await db.execute(sql`
    SELECT cu.id AS legacy_id, cu.client_update_sent_by, pcu.sent_by_user_id
    FROM client_updates cu
    JOIN project_client_updates pcu
      ON pcu.project_id = cu.project_id AND pcu.update_number = cu.update_number
    WHERE pcu.migrated_from_legacy = true
      AND COALESCE(cu.client_update_sent_by, -1) != COALESCE(pcu.sent_by_user_id, -1)
    LIMIT 5
  `);
  if (sentByMismatch.rows.length > 0) {
    result.sampleMismatches.push(
      `${sentByMismatch.rows.length} rows have sent_by_user_id mismatch`
    );
    result.pass = false;
  }

  return result;
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Migration Parity Verification");
  console.log("═══════════════════════════════════════════════════\n");

  const commitments = await verifyCommitmentsParity();
  const updates = await verifyUpdatesParity();

  for (const r of [commitments, updates]) {
    const icon = r.pass ? "✅" : "❌";
    console.log(`${icon} ${r.table}`);
    console.log(`   Legacy rows:     ${r.legacyCount}`);
    console.log(`   Canonical rows:  ${r.canonicalCount}`);
    console.log(`   Migrated rows:   ${r.migratedCount}`);
    console.log(`   Duplicates:      ${r.duplicateCount}`);
    if (r.sampleMismatches.length > 0) {
      console.log(`   Issues:`);
      for (const m of r.sampleMismatches) {
        console.log(`     ⚠ ${m}`);
      }
    }
    console.log();
  }

  const allPass = commitments.pass && updates.pass;
  console.log(allPass ? "✅ ALL CHECKS PASSED" : "❌ SOME CHECKS FAILED");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
