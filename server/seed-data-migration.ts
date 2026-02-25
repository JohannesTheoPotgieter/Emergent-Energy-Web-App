import { db } from "./db";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);
const SEED_DIR = path.join(__dirname_esm, "data-seed");
const DONE_FLAG = path.join(SEED_DIR, ".migrated");

const TABLE_ORDER = [
  "project_info",
  "program_expense",
  "program_inflows",
  "project_plan",
  "normalized_cost_lines",
  "normalized_revenue_lines",
  "normalized_plan_tasks",
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function escVal(v: any): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "string" && ISO_DATE.test(v)) return `'${v}'`;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return String(v);
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function getDbColumns(tableName: string): Promise<Set<string>> {
  const result = await db.execute(
    sql.raw(`SELECT column_name FROM information_schema.columns WHERE table_name = '${tableName}'`)
  );
  return new Set((result.rows as any[]).map((r: any) => r.column_name));
}

export async function runDataSeedMigration() {
  if (!fs.existsSync(SEED_DIR)) {
    console.log("[DataSeed] No data-seed directory found, skipping");
    return;
  }
  if (fs.existsSync(DONE_FLAG)) {
    console.log("[DataSeed] Already migrated, skipping");
    return;
  }

  const existing = await db.execute(sql.raw("SELECT COUNT(*) as cnt FROM project_info"));
  const count = parseInt((existing.rows as any[])[0]?.cnt ?? "0", 10);
  if (count > 0) {
    console.log(`[DataSeed] project_info already has ${count} rows, marking as done`);
    fs.writeFileSync(DONE_FLAG, new Date().toISOString());
    return;
  }

  console.log("[DataSeed] Starting one-time data migration...");
  const results: Record<string, number> = {};
  const skipped: Record<string, string[]> = {};

  await db.transaction(async (tx) => {
    await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);

    const truncateTables = [
      "normalized_plan_tasks", "normalized_revenue_lines", "normalized_cost_lines",
      "normalized_execution_phases", "smart_import_runs",
      "project_plan", "program_inflows", "program_expense", "project_info",
    ];
    await tx.execute(sql.raw(`TRUNCATE TABLE ${truncateTables.join(", ")} CASCADE`));

    for (const tableName of TABLE_ORDER) {
      const filePath = path.join(SEED_DIR, `${tableName}.json`);
      if (!fs.existsSync(filePath)) {
        console.log(`[DataSeed] No file for ${tableName}, skipping`);
        continue;
      }

      const rows: any[] = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (rows.length === 0) {
        console.log(`[DataSeed] ${tableName}: 0 rows, skipping`);
        continue;
      }

      const dbCols = await getDbColumns(tableName);
      const jsonKeys = Object.keys(rows[0]);
      const validPairs: { jsonKey: string; dbCol: string }[] = [];
      const skippedCols: string[] = [];

      for (const jk of jsonKeys) {
        if (dbCols.has(jk)) {
          validPairs.push({ jsonKey: jk, dbCol: jk });
        } else {
          skippedCols.push(jk);
        }
      }
      if (skippedCols.length > 0) skipped[tableName] = skippedCols;

      const colList = validPairs.map((p) => `"${p.dbCol}"`).join(", ");
      const batchSize = 50;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const valueSets = batch.map((row) => {
          const vals = validPairs.map((p) => escVal(row[p.jsonKey]));
          return `(${vals.join(", ")})`;
        });
        await tx.execute(sql.raw(`INSERT INTO ${tableName} (${colList}) VALUES ${valueSets.join(", ")}`));
      }

      results[tableName] = rows.length;
      console.log(`[DataSeed] ${tableName}: ${rows.length} rows inserted`);
    }

    for (const t of TABLE_ORDER) {
      try {
        await tx.execute(
          sql.raw(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`)
        );
      } catch (_) {}
    }
  });

  fs.writeFileSync(DONE_FLAG, new Date().toISOString());
  console.log("[DataSeed] Migration complete:", results);
  if (Object.keys(skipped).length > 0) {
    console.log("[DataSeed] Skipped columns:", skipped);
  }
}
