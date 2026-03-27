/**
 * PD Restore — Companion rollback script for pd-reset-import.ts
 *
 * Restores PD data from a backup JSON file created by pd-reset-import.ts.
 *
 * Usage:
 *   npx tsx scripts/pd-restore.ts backups/pd-backup-2026-03-23T10-00-00.json
 *   npx tsx scripts/pd-restore.ts backups/pd-backup-2026-03-23T10-00-00.json --dry-run
 *
 * Prerequisites:
 *   - DATABASE_URL must be set in environment
 *   - A valid backup JSON file from pd-reset-import.ts
 */

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as fs from "fs";

const DRY_RUN = process.argv.includes("--dry-run");
const backupPath = process.argv.find((a) => a.endsWith(".json"));

function esc(v: any): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return String(v);
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function main() {
  if (!backupPath) {
    console.error("Usage: npx tsx scripts/pd-restore.ts <backup-file.json> [--dry-run]");
    process.exit(1);
  }

  if (!fs.existsSync(backupPath)) {
    console.error(`ERROR: Backup file not found: ${backupPath}`);
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL not set");
    process.exit(1);
  }

  const backup = JSON.parse(fs.readFileSync(backupPath, "utf-8"));

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  PD Restore from Backup${DRY_RUN ? "  [DRY RUN]" : ""}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Backup file: ${backupPath}`);
  console.log(`  Exported at: ${backup.exportedAt}`);
  console.log(`  PD tickets:  ${backup.pdTickets?.length ?? 0}`);
  console.log(`  Work items:  ${backup.linkedWorkItems?.length ?? 0}\n`);

  if (!backup.pdTickets?.length) {
    console.log("  No PD tickets in backup. Nothing to restore.");
    return;
  }

  if (DRY_RUN) {
    console.log("  [DRY RUN] Would restore the following tickets:");
    for (const t of backup.pdTickets) {
      console.log(`    - ${t.project_site_name} (ID: ${t.id})`);
    }
    console.log(`\n  [DRY RUN] No changes made.\n`);
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  await db.transaction(async (tx) => {
    // Clear current PD data first
    await tx.execute(sql`DELETE FROM work_items WHERE pd_ticket_id IS NOT NULL`);
    await tx.execute(sql`DELETE FROM pd_tickets`);
    console.log("  Cleared current PD data.");

    // Restore PD tickets
    for (const t of backup.pdTickets) {
      const cols = Object.keys(t).filter((k) => t[k] !== undefined);
      const colNames = cols.map((c) => `"${c}"`).join(", ");
      const valParams = cols.map((c) => {
        const v = t[c];
        return typeof v === "object" && v !== null ? sql`${JSON.stringify(v)}::jsonb` : sql`${v}`;
      });
      await tx.execute(sql`INSERT INTO pd_tickets (${sql.raw(colNames)}) VALUES (${sql.join(valParams, sql`, `)})`);
    }
    console.log(`  Restored ${backup.pdTickets.length} pd_tickets.`);

    // Restore work items
    if (backup.linkedWorkItems?.length) {
      for (const w of backup.linkedWorkItems) {
        const cols = Object.keys(w).filter((k) => w[k] !== undefined);
        const colNames = cols.map((c) => `"${c}"`).join(", ");
        const valParams = cols.map((c) => {
          const v = w[c];
          return typeof v === "object" && v !== null ? sql`${JSON.stringify(v)}::jsonb` : sql`${v}`;
        });
        await tx.execute(sql`INSERT INTO work_items (${sql.raw(colNames)}) VALUES (${sql.join(valParams, sql`, `)})`);
      }
      console.log(`  Restored ${backup.linkedWorkItems.length} work_items.`);
    }
  });

  // Verify
  const count = Number((await db.execute(sql`SELECT count(*) as cnt FROM pd_tickets`)).rows[0]?.cnt ?? 0);
  console.log(`\n  Verification: ${count} pd_tickets in database.`);

  console.log(`\n${"=".repeat(60)}`);
  console.log("  RESTORE COMPLETE");
  console.log(`${"=".repeat(60)}\n`);

  await pool.end();
}

main().catch((err) => {
  console.error("\nRESTORE FAILED:", err.message);
  console.error("Transaction rolled back — no changes were made.");
  process.exit(1);
});
