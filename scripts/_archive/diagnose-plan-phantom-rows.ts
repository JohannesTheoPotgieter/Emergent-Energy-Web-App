#!/usr/bin/env tsx
/**
 * Diagnose (and optionally remove) the phantom "Milestone summary" plan rows
 * that some trackers append below the WBS programme on the Project Plan sheet.
 *
 * Those rollup rows have NO WBS number, so Smart Import writes them to
 * `work_items` with `wbs_code = NULL` AND `outline_number = NULL` — which is
 * exactly why the Execution board renders them as `#<id>` instead of a WBS
 * code. The parser fix (exclude the bottom Milestone table) stops NEW imports
 * from creating them, and a committed re-import sweeps the old ones — BUT only
 * once the running server is on the new code. This script is the ground-truth
 * check + an immediate, deploy-independent cleanup.
 *
 * It connects directly via DATABASE_URL (no app boot), exactly like
 * db:verify-schema / repair-execution-review-table.ts.
 *
 * Usage (on the Replit shell, where DATABASE_URL is the live DB):
 *
 *   # Dry run — list the phantom rows for every project:
 *   tsx scripts/diagnose-plan-phantom-rows.ts
 *
 *   # Narrow to one project (by id or name substring):
 *   tsx scripts/diagnose-plan-phantom-rows.ts --project=34
 *   tsx scripts/diagnose-plan-phantom-rows.ts --name=lifechang
 *
 *   # Actually soft-delete them (sets deleted_at = now()):
 *   tsx scripts/diagnose-plan-phantom-rows.ts --name=lifechang --apply
 *
 * Nothing is deleted without --apply. Soft-delete only — rows are recoverable
 * by clearing deleted_at.
 */

import "dotenv/config";
import { Client } from "pg";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const APPLY = process.argv.includes("--apply");
const projectArg = arg("project");
const nameArg = arg("name");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set — run this on Replit (or export it).");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    // Build the project filter.
    const where: string[] = [
      "wi.source = 'SMART_IMPORT'",
      "wi.deleted_at IS NULL",
      "wi.wbs_code IS NULL",
      "wi.outline_number IS NULL",
    ];
    const params: unknown[] = [];
    if (projectArg) {
      params.push(Number(projectArg));
      where.push(`wi.project_id = $${params.length}`);
    }
    if (nameArg) {
      params.push(`%${nameArg.toLowerCase()}%`);
      where.push(`LOWER(pi.project_name) LIKE $${params.length}`);
    }

    const rows = (
      await client.query(
        `SELECT wi.id, wi.project_id, pi.project_name, wi.title,
                wi.start_date, wi.end_date, wi.is_milestone,
                wi.source_row, wi.source_sheet, wi.import_run_id,
                wi.row_hash, wi.created_at
           FROM work_items wi
           JOIN project_info pi ON pi.id = wi.project_id
          WHERE ${where.join(" AND ")}
          ORDER BY wi.project_id, wi.source_row NULLS LAST, wi.id`,
        params,
      )
    ).rows as Array<Record<string, unknown>>;

    // Per-project latest import run, so we can tell if the phantom rows came
    // from the most recent re-import (parser/detector still creating them) or
    // are stale leftovers from an older run (sweep should have removed them).
    const latestRun = new Map<number, number>();
    const projIds = [...new Set(rows.map((r) => Number(r.project_id)))];
    if (projIds.length > 0) {
      const lr = await client.query(
        `SELECT project_id, MAX(import_run_id) AS latest
           FROM work_items
          WHERE source = 'SMART_IMPORT' AND import_run_id IS NOT NULL
            AND project_id = ANY($1::int[])
          GROUP BY project_id`,
        [projIds],
      );
      for (const r of lr.rows) latestRun.set(Number(r.project_id), Number(r.latest));
    }

    if (rows.length === 0) {
      console.log("No phantom (no-WBS) Smart-Import plan rows found for the given filter. ✅");
      return;
    }

    let lastProj: number | null = null;
    for (const r of rows) {
      const pid = Number(r.project_id);
      if (pid !== lastProj) {
        const latest = latestRun.get(pid);
        console.log(
          `\n=== Project ${pid} — ${String(r.project_name)} (latest import run: ${latest ?? "n/a"}) ===`,
        );
        console.log("  id    | runId | row | start → end | title");
        lastProj = pid;
      }
      const fromLatest = latestRun.get(pid) != null && Number(r.import_run_id) === latestRun.get(pid);
      const flag = fromLatest ? "  <-- from latest import" : "";
      const d = (v: unknown) => (v == null ? "—" : String(v).slice(0, 10));
      console.log(
        `  ${String(r.id).padEnd(6)}| ${String(r.import_run_id ?? "—").padEnd(6)}| ${String(
          r.source_row ?? "—",
        ).padEnd(4)}| ${d(r.start_date)} → ${d(r.end_date)} | ${String(r.title)}${flag}`,
      );
    }

    console.log(`\nTotal phantom rows: ${rows.length}`);
    const anyFromLatest = rows.some(
      (r) =>
        latestRun.get(Number(r.project_id)) != null &&
        Number(r.import_run_id) === latestRun.get(Number(r.project_id)),
    );
    console.log(
      anyFromLatest
        ? "Diagnosis: some phantom rows carry the LATEST import run id → the running parser is still\n" +
            "creating them (server not on the new code yet, OR the detector didn't match this workbook's\n" +
            "Milestone-summary header). Share the workbook's Project Plan tail so the detector can be hardened."
        : "Diagnosis: phantom rows predate the latest import run → they are stale leftovers a committed\n" +
            "re-import (on the new code) should have swept. Use --apply here to clear them now.",
    );

    if (!APPLY) {
      console.log("\nDry run — nothing changed. Re-run with --apply to soft-delete the rows above.");
      return;
    }

    const ids = rows.map((r) => Number(r.id));
    const res = await client.query(
      `UPDATE work_items SET deleted_at = now()
        WHERE id = ANY($1::int[]) AND deleted_at IS NULL`,
      [ids],
    );
    console.log(`\nSoft-deleted ${res.rowCount} phantom row(s). They will drop off the board immediately.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
