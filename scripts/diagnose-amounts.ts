#!/usr/bin/env npx tsx
/**
 * Quick diagnostic: compare legacy vs promoted amounts through Drizzle connection.
 */
import { sql } from "drizzle-orm";
import { db, initializeDatabase } from "../server/db";

async function main() {
  await initializeDatabase();

  const queries = [
    { label: "schemas", q: "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY 1" },
    { label: "finance tables", q: "SELECT schemaname || '.' || tablename AS t FROM pg_tables WHERE schemaname = 'finance' ORDER BY 1" },
    { label: "search_path", q: "SHOW search_path" },
    { label: "legacy active cost count", q: "SELECT count(*) AS cnt FROM normalized_cost_lines WHERE effective_to IS NULL" },
    { label: "promoted cost count (all)", q: "SELECT count(*) AS cnt FROM finance.cost_lines" },
    { label: "promoted cost count (with active legacy FK)", q: "SELECT count(*) AS cnt FROM finance.cost_lines fcl WHERE fcl.legacy_normalized_cost_line_id IS NOT NULL AND EXISTS (SELECT 1 FROM normalized_cost_lines ncl WHERE ncl.id = fcl.legacy_normalized_cost_line_id AND ncl.effective_to IS NULL)" },
    { label: "legacy active cost SUM", q: "SELECT COALESCE(SUM(amount_ex_vat::numeric), 0) AS total FROM normalized_cost_lines WHERE effective_to IS NULL" },
    { label: "promoted migrated cost SUM", q: "SELECT COALESCE(SUM(fcl.amount_ex_vat), 0) AS total FROM finance.cost_lines fcl WHERE fcl.legacy_normalized_cost_line_id IS NOT NULL AND EXISTS (SELECT 1 FROM normalized_cost_lines ncl WHERE ncl.id = fcl.legacy_normalized_cost_line_id AND ncl.effective_to IS NULL)" },
    { label: "per-row amount mismatches (top 10)", q: "SELECT ncl.id, ncl.amount_ex_vat::numeric AS legacy_amt, fcl.amount_ex_vat AS promoted_amt, (ncl.amount_ex_vat::numeric - fcl.amount_ex_vat) AS diff FROM normalized_cost_lines ncl JOIN finance.cost_lines fcl ON fcl.legacy_normalized_cost_line_id = ncl.id WHERE ncl.effective_to IS NULL AND ABS(ncl.amount_ex_vat::numeric - fcl.amount_ex_vat) > 0.001 ORDER BY ABS(ncl.amount_ex_vat::numeric - fcl.amount_ex_vat) DESC LIMIT 10" },
    { label: "legacy cost amount_ex_vat column type", q: "SELECT data_type, udt_name FROM information_schema.columns WHERE table_name = 'normalized_cost_lines' AND column_name = 'amount_ex_vat'" },
    { label: "promoted cost amount_ex_vat column type", q: "SELECT data_type, udt_name FROM information_schema.columns WHERE table_schema = 'finance' AND table_name = 'cost_lines' AND column_name = 'amount_ex_vat'" },
  ];

  for (const { label, q } of queries) {
    try {
      const result = await db.execute(sql.raw(q));
      const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
      console.log(`\n--- ${label} ---`);
      if (rows.length === 0) {
        console.log("  (no rows)");
      } else if (rows.length <= 15) {
        for (const r of rows) console.log(" ", JSON.stringify(r));
      } else {
        console.log(`  ${rows.length} rows (showing first 5)`);
        for (const r of rows.slice(0, 5)) console.log(" ", JSON.stringify(r));
      }
    } catch (err: any) {
      console.log(`\n--- ${label} ---`);
      console.log(`  ERROR: ${err.message?.slice(0, 120)}`);
    }
  }

  process.exit(0);
}

main();
