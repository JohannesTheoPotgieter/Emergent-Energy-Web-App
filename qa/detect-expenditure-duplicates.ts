/**
 * EXPENDITURE DUPLICATE DETECTION SCRIPT
 *
 * Run against a live database to detect actual duplicate rows.
 * Usage: npx tsx qa/detect-expenditure-duplicates.ts
 *
 * Checks:
 * 1. NCL: duplicate (project_id, source_row) among active rows
 * 2. PE: duplicate (project_id, row_number) among active rows
 * 3. Cross-table: NCL rows without matching PE row (expected for manual creates)
 * 4. Cross-table: PE rows without matching NCL row (legacy artifacts)
 * 5. Active rows with NULL project_id (invisible to dashboard queries)
 * 6. Active rows with NULL source_row (can't merge via business key)
 * 7. Multiple active rows for same idempotency_key (should be impossible)
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

interface DuplicateCheckResult {
  check: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  count: number;
  details: any[];
}

async function runChecks(): Promise<DuplicateCheckResult[]> {
  const results: DuplicateCheckResult[] = [];

  // 1. NCL: duplicate (project_id, source_row) among active rows
  try {
    const nclDupes = await db.execute(sql`
      SELECT project_id, source_row, COUNT(*) as cnt,
             array_agg(id ORDER BY id) as ids
      FROM normalized_cost_lines
      WHERE effective_to IS NULL
        AND project_id IS NOT NULL
        AND source_row IS NOT NULL
      GROUP BY project_id, source_row
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `);
    const rows = (nclDupes.rows ?? nclDupes) as any[];
    results.push({
      check: "NCL duplicate (project_id, source_row) among active rows",
      severity: rows.length > 0 ? "CRITICAL" : "INFO",
      count: rows.length,
      details: rows.map(r => ({
        projectId: r.project_id,
        sourceRow: r.source_row,
        count: r.cnt,
        ids: r.ids,
      })),
    });
  } catch (e) {
    results.push({ check: "NCL duplicate check", severity: "WARNING", count: -1, details: [{ error: String(e) }] });
  }

  // 2. PE: duplicate (project_id, row_number) among active rows
  try {
    const peDupes = await db.execute(sql`
      SELECT project_id, row_number, COUNT(*) as cnt,
             array_agg(id ORDER BY id) as ids
      FROM program_expense
      WHERE effective_to IS NULL AND deleted_at IS NULL
        AND project_id IS NOT NULL
        AND row_number IS NOT NULL
      GROUP BY project_id, row_number
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `);
    const rows = (peDupes.rows ?? peDupes) as any[];
    results.push({
      check: "PE duplicate (project_id, row_number) among active rows",
      severity: rows.length > 0 ? "CRITICAL" : "INFO",
      count: rows.length,
      details: rows.map(r => ({
        projectId: r.project_id,
        rowNumber: r.row_number,
        count: r.cnt,
        ids: r.ids,
      })),
    });
  } catch (e) {
    results.push({ check: "PE duplicate check", severity: "WARNING", count: -1, details: [{ error: String(e) }] });
  }

  // 3. NCL rows without matching PE row (expected for manual creates)
  try {
    const nclOnly = await db.execute(sql`
      SELECT COUNT(*) as cnt
      FROM normalized_cost_lines ncl
      LEFT JOIN program_expense pe ON pe.project_id = ncl.project_id
        AND pe.row_number = ncl.source_row
        AND pe.effective_to IS NULL
        AND pe.deleted_at IS NULL
      WHERE ncl.effective_to IS NULL
        AND ncl.project_id IS NOT NULL
        AND ncl.source_row IS NOT NULL
        AND pe.id IS NULL
    `);
    const count = Number(((nclOnly.rows ?? nclOnly) as any[])[0]?.cnt ?? 0);
    results.push({
      check: "NCL rows without matching PE row (expected for manual creates)",
      severity: "INFO",
      count,
      details: [{ note: "Normal — manual expenses and newer imports create NCL only" }],
    });
  } catch (e) {
    results.push({ check: "NCL-only check", severity: "WARNING", count: -1, details: [{ error: String(e) }] });
  }

  // 4. PE rows without matching NCL row (legacy artifacts)
  try {
    const peOnly = await db.execute(sql`
      SELECT COUNT(*) as cnt
      FROM program_expense pe
      LEFT JOIN normalized_cost_lines ncl ON ncl.project_id = pe.project_id
        AND ncl.source_row = pe.row_number
        AND ncl.effective_to IS NULL
      WHERE pe.effective_to IS NULL
        AND pe.deleted_at IS NULL
        AND pe.project_id IS NOT NULL
        AND pe.row_number IS NOT NULL
        AND ncl.id IS NULL
    `);
    const count = Number(((peOnly.rows ?? peOnly) as any[])[0]?.cnt ?? 0);
    results.push({
      check: "PE rows without matching NCL row (legacy artifacts)",
      severity: count > 0 ? "WARNING" : "INFO",
      count,
      details: [{ note: count > 0 ? "These are PE-only legacy rows that dashboards do not see" : "Clean — all PE rows have NCL counterparts" }],
    });
  } catch (e) {
    results.push({ check: "PE-only check", severity: "WARNING", count: -1, details: [{ error: String(e) }] });
  }

  // 5. Active NCL rows with NULL project_id
  try {
    const nullPid = await db.execute(sql`
      SELECT COUNT(*) as cnt
      FROM normalized_cost_lines
      WHERE effective_to IS NULL AND project_id IS NULL
    `);
    const count = Number(((nullPid.rows ?? nullPid) as any[])[0]?.cnt ?? 0);
    results.push({
      check: "Active NCL rows with NULL project_id (invisible to dashboard queries)",
      severity: count > 0 ? "WARNING" : "INFO",
      count,
      details: [{ note: count > 0 ? "These rows are invisible to dashboard-metrics, header-kpis, etc." : "Clean — all active rows have project_id" }],
    });
  } catch (e) {
    results.push({ check: "NULL project_id check", severity: "WARNING", count: -1, details: [{ error: String(e) }] });
  }

  // 6. Active NCL rows with NULL source_row
  try {
    const nullSr = await db.execute(sql`
      SELECT COUNT(*) as cnt
      FROM normalized_cost_lines
      WHERE effective_to IS NULL AND source_row IS NULL
    `);
    const count = Number(((nullSr.rows ?? nullSr) as any[])[0]?.cnt ?? 0);
    results.push({
      check: "Active NCL rows with NULL source_row (cant merge via business key)",
      severity: count > 0 ? "INFO" : "INFO",
      count,
      details: [{ note: "NULL source_row rows get id-based business keys — safe but unmergeable" }],
    });
  } catch (e) {
    results.push({ check: "NULL source_row check", severity: "WARNING", count: -1, details: [{ error: String(e) }] });
  }

  // 7. Multiple active rows for same idempotency_key
  try {
    const idempDupes = await db.execute(sql`
      SELECT idempotency_key, COUNT(*) as cnt
      FROM normalized_cost_lines
      WHERE effective_to IS NULL
        AND idempotency_key IS NOT NULL
      GROUP BY idempotency_key
      HAVING COUNT(*) > 1
      LIMIT 10
    `);
    const rows = (idempDupes.rows ?? idempDupes) as any[];
    results.push({
      check: "Multiple active rows for same idempotency_key (should be impossible)",
      severity: rows.length > 0 ? "CRITICAL" : "INFO",
      count: rows.length,
      details: rows.length > 0 ? rows : [{ note: "Clean — unique index is working" }],
    });
  } catch (e) {
    results.push({ check: "Idempotency key check", severity: "WARNING", count: -1, details: [{ error: String(e) }] });
  }

  return results;
}

async function main() {
  try {
    console.log("\n=== EXPENDITURE DUPLICATE DETECTION ===\n");
    const results = await runChecks();

    for (const r of results) {
      const icon = r.severity === "CRITICAL" ? "❌" : r.severity === "WARNING" ? "⚠️" : "✅";
      console.log(`${icon} [${r.severity}] ${r.check}: ${r.count}`);
      if (r.details.length > 0 && (r.severity !== "INFO" || r.count > 0)) {
        for (const d of r.details.slice(0, 5)) {
          console.log(`    ${JSON.stringify(d)}`);
        }
      }
    }

    const criticals = results.filter(r => r.severity === "CRITICAL" && r.count > 0);
    const warnings = results.filter(r => r.severity === "WARNING" && r.count > 0);

    console.log(`\n=== SUMMARY ===`);
    console.log(`  Criticals: ${criticals.length}`);
    console.log(`  Warnings:  ${warnings.length}`);
    console.log(`  Clean:     ${results.filter(r => r.count === 0).length}`);
    console.log(`=== END ===\n`);

    process.exit(criticals.length > 0 ? 1 : 0);
  } catch (err) {
    console.error("Detection failed:", err);
    process.exit(1);
  }
}

main();
