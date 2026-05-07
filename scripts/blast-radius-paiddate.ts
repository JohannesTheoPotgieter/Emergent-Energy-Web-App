/**
 * Blast-radius diagnostic — § 3.7 paidDate fallback bug (PR #841 / commit 465f325).
 *
 * Pre-fix, normalizer.ts could set `paidDateConfirmed = true` by falling back to
 * `forecastPaymentDate`'s cell colour when the actual `paidDate` was blank. The
 * fix removes the fallback. This script identifies rows in `normalized_cost_lines`
 * that the post-fix logic would not flag confirmed but the stored value is `true`
 * — i.e. fallout from imports under the buggy fallback.
 *
 * READ-ONLY. No DB writes. No migrations.
 *
 * Default mode (SQL replay using persisted cell_format jsonb):
 *   tsx scripts/blast-radius-paiddate.ts
 *
 * Validate mode (spot-check persisted cellFormat against a local workbook):
 *   tsx scripts/blast-radius-paiddate.ts --validate <project_id> <path/to/workbook.xlsx>
 *
 * Output: docs/active/wave-0/blast-radius-paiddate-{YYYY-MM-DD}.md
 */

import pg from "pg";
import fs from "fs/promises";
import path from "path";
import ExcelJS from "exceljs";

const { Pool } = pg;

type CellFormatField = { font?: string; fill?: string; bold?: boolean };
type CellFormat = Record<string, CellFormatField | undefined> | null;

interface SuspectRow {
  id: number;
  project_id: number;
  project_code: string | null;
  project_name: string;
  paid_date: string | null;
  paid_date_font_color: string | null;
  paid_date_confirmed: boolean | null;
  cashflow_confirmed: boolean | null;
  forecast_payment_date: string | null;
  amount_ex_vat: string | null;
  source_sheet: string | null;
  source_row: number | null;
  cell_format: CellFormat;
  invoice_number: string | null;
  po_number: string | null;
}

interface ValidateRow {
  id: number;
  source_sheet: string | null;
  source_row: number | null;
  paid_date_font_color: string | null;
  cell_format: CellFormat;
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required.");
  return url;
}

// Mirrors classifyColorHex in server/lib/import/normalizer.ts:553 — r<40 g<40 b<40 = black.
function isBlackHex(hex: string | null | undefined): boolean {
  if (!hex) return false;
  let cleaned = hex.replace(/^#/, "");
  if (cleaned.length === 8) cleaned = cleaned.slice(2); // strip alpha (ARGB → RGB)
  if (!/^[0-9a-f]{6}$/i.test(cleaned)) return false;
  const v = parseInt(cleaned, 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return r < 40 && g < 40 && b < 40;
}

function bugFingerprint(r: SuspectRow): "buggy_fallback" | "other_anomaly" {
  return isBlackHex(r.cell_format?.forecast_payment_date?.font) ? "buggy_fallback" : "other_anomaly";
}

function fmtRand(n: number): string {
  return `R ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function sumCashflowInflated(rs: SuspectRow[]): number {
  return rs.reduce((acc, r) => {
    if (!r.cashflow_confirmed) return acc;
    const v = r.amount_ex_vat == null ? 0 : Number(r.amount_ex_vat);
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
}

async function runSqlReplay(pool: pg.Pool): Promise<void> {
  console.log("READ ONLY — no DB writes.");
  console.log("Running blast-radius diagnostic for § 3.7 paidDate fallback bug...");

  const sql = `
    SELECT
      ncl.id,
      ncl.project_id,
      pi.project_code,
      ncl.project_name,
      ncl.paid_date,
      ncl.paid_date_font_color,
      ncl.paid_date_confirmed,
      ncl.cashflow_confirmed,
      ncl.forecast_payment_date,
      ncl.amount_ex_vat,
      ncl.source_sheet,
      ncl.source_row,
      ncl.cell_format,
      ncl.invoice_number,
      ncl.po_number
    FROM normalized_cost_lines ncl
    LEFT JOIN project_info pi ON pi.id = ncl.project_id
    WHERE ncl.effective_to IS NULL
      AND ncl.deleted_at IS NULL
      AND ncl.paid_date_confirmed = true
      AND (
        ncl.paid_date IS NULL
        OR ncl.paid_date_font_color IS DISTINCT FROM 'black'
      )
    ORDER BY ncl.project_id, ncl.id;
  `;
  const { rows } = await pool.query<SuspectRow>(sql);

  const strict: SuspectRow[] = [];
  const loose: SuspectRow[] = [];
  for (const r of rows) {
    if (r.paid_date == null) strict.push(r);
    else loose.push(r);
  }

  const byProject = new Map<number, SuspectRow[]>();
  for (const r of rows) {
    const arr = byProject.get(r.project_id) ?? [];
    arr.push(r);
    byProject.set(r.project_id, arr);
  }

  const today = new Date().toISOString().slice(0, 10);
  const total = rows.length;
  const totalCashflowConfirmed = rows.filter(r => r.cashflow_confirmed).length;
  const inflated = sumCashflowInflated(rows);
  const projectsAffected = byProject.size;
  const strictBuggy = strict.filter(r => bugFingerprint(r) === "buggy_fallback").length;
  const looseBuggy = loose.filter(r => bugFingerprint(r) === "buggy_fallback").length;

  const md: string[] = [];
  md.push(`# Blast Radius — § 3.7 paidDate fallback bug`);
  md.push(``);
  md.push(`**Generated:** ${new Date().toISOString()}`);
  md.push(`**Source:** \`scripts/blast-radius-paiddate.ts\` (read-only SQL replay)`);
  md.push(`**Bug context:** Pre-PR #841 (commit 465f325), \`paidDateConfirmed\` could fall back to \`forecastPaymentDate\` colour when \`paidDate\` was blank. Post-fix, no fallback. This report identifies rows in \`normalized_cost_lines\` where the post-fix logic would not produce \`paid_date_confirmed = true\` but the stored value is \`true\` — i.e. fallout from imports under the buggy fallback.`);
  md.push(``);
  md.push(`> **READ ONLY** — this script writes no DB rows.`);
  md.push(``);
  md.push(`## Aggregate impact`);
  md.push(``);
  md.push(`| Metric | Value |`);
  md.push(`|---|---|`);
  md.push(`| Total suspect rows | ${total} |`);
  md.push(`| Strict suspects (paid_date NULL) | ${strict.length} (${strictBuggy} match bug fingerprint) |`);
  md.push(`| Loose suspects (paid_date present, colour ≠ black) | ${loose.length} (${looseBuggy} match bug fingerprint) |`);
  md.push(`| Suspect rows with cashflow_confirmed = true | ${totalCashflowConfirmed} |`);
  md.push(`| **Inflated cashflow total (sum of amount_ex_vat where cashflow_confirmed)** | **${fmtRand(inflated)}** |`);
  md.push(`| Projects affected | ${projectsAffected} |`);
  md.push(``);
  md.push(`### Bug fingerprint`);
  md.push(``);
  md.push(`A row "matches the bug fingerprint" iff its persisted \`cell_format.forecast_payment_date.font\` is BLACK (r<40, g<40, b<40 — same threshold as \`normalizer.ts:559\`). These are rows the buggy fallback would have flipped to confirmed. Rows without the fingerprint are anomalies of a different cause (manual edits, legacy imports, etc.) and should be triaged separately.`);
  md.push(``);
  md.push(`### Remediation guidance per IMPLEMENTATION_PLAN_V3.md § 1.4`);
  md.push(``);
  md.push(`Use the **strict suspects** count to pick the option:`);
  md.push(``);
  md.push(`| Strict suspects | Recommended option |`);
  md.push(`|---|---|`);
  md.push(`| < 50 rows | Option 1 — fix-forward only |`);
  md.push(`| 50 – 500 rows | Option 2 — targeted backfill via additive temporal pattern |`);
  md.push(`| 500+ rows | Option 3 — force re-import of all active projects |`);
  md.push(``);
  md.push(`## Per-project breakdown`);
  md.push(``);
  md.push(`| Project ID | Code | Name | Suspect rows | Inflated R |`);
  md.push(`|---|---|---|---|---|`);
  const projectRows = [...byProject.entries()]
    .map(([pid, rs]) => ({
      pid,
      code: rs[0]?.project_code ?? "",
      name: rs[0]?.project_name ?? "",
      count: rs.length,
      inflated: sumCashflowInflated(rs),
    }))
    .sort((a, b) => b.inflated - a.inflated);
  for (const p of projectRows) {
    md.push(`| ${p.pid} | ${p.code} | ${p.name} | ${p.count} | ${p.inflated.toFixed(2)} |`);
  }
  md.push(``);
  md.push(`## Strict suspects (paid_date IS NULL)`);
  md.push(``);
  md.push(`| id | project_id | paid_date_font_color | cashflow_confirmed | forecast_payment_date | forecast_font (cellFormat) | bug_fingerprint | amount_ex_vat | source_sheet | source_row |`);
  md.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of strict) {
    const fc = r.cell_format?.forecast_payment_date?.font ?? "";
    md.push(
      `| ${r.id} | ${r.project_id} | ${r.paid_date_font_color ?? ""} | ${r.cashflow_confirmed ?? ""} | ${r.forecast_payment_date ?? ""} | ${fc} | ${bugFingerprint(r)} | ${r.amount_ex_vat ?? ""} | ${r.source_sheet ?? ""} | ${r.source_row ?? ""} |`,
    );
  }
  md.push(``);
  md.push(`## Loose suspects (paid_date present, colour ≠ black)`);
  md.push(``);
  md.push(`| id | project_id | paid_date | paid_date_font_color | cashflow_confirmed | forecast_payment_date | forecast_font (cellFormat) | bug_fingerprint | amount_ex_vat | source_sheet | source_row |`);
  md.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of loose) {
    const fc = r.cell_format?.forecast_payment_date?.font ?? "";
    md.push(
      `| ${r.id} | ${r.project_id} | ${r.paid_date ?? ""} | ${r.paid_date_font_color ?? ""} | ${r.cashflow_confirmed ?? ""} | ${r.forecast_payment_date ?? ""} | ${fc} | ${bugFingerprint(r)} | ${r.amount_ex_vat ?? ""} | ${r.source_sheet ?? ""} | ${r.source_row ?? ""} |`,
    );
  }
  md.push(``);

  const outDir = path.resolve("docs/active/wave-0");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `blast-radius-paiddate-${today}.md`);
  await fs.writeFile(outPath, md.join("\n"), "utf8");

  console.log("");
  console.log(`Written: ${outPath}`);
  console.log("");
  console.log("Summary:");
  console.log(`  Total suspect rows:        ${total}`);
  console.log(`  Strict (paid_date NULL):   ${strict.length}  (${strictBuggy} match bug fingerprint)`);
  console.log(`  Loose  (colour ≠ black):   ${loose.length}  (${looseBuggy} match bug fingerprint)`);
  console.log(`  Inflated cashflow:         ${fmtRand(inflated)}`);
  console.log(`  Projects affected:         ${projectsAffected}`);
  console.log("");
  console.log("Next step: see IMPLEMENTATION_PLAN_V3.md § 1.4 to pick remediation Option 1/2/3.");
}

function findColumnByHeader(ws: ExcelJS.Worksheet, candidates: string[]): number {
  const cands = candidates.map(c => c.toLowerCase().replace(/\s+/g, " ").trim());
  for (let r = 1; r <= 10; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= row.cellCount; c++) {
      const v = row.getCell(c).value;
      const s = (typeof v === "string" ? v : (v == null ? "" : String(v))).toLowerCase().replace(/\s+/g, " ").trim();
      if (cands.includes(s)) return c - 1;
    }
  }
  return -1;
}

function extractFontHexLite(cell: ExcelJS.Cell): string | null {
  const argb = cell.font?.color?.argb;
  if (typeof argb !== "string") return null;
  const rgb = argb.length === 8 ? argb.slice(2) : argb;
  return `#${rgb.toUpperCase()}`;
}

async function runValidate(pool: pg.Pool, projectId: number, workbookPath: string): Promise<void> {
  console.log(`READ ONLY — no DB writes.`);
  console.log(`Validating SQL replay against local workbook for project ${projectId}: ${workbookPath}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(workbookPath);

  const { rows: dbRows } = await pool.query<ValidateRow>(
    `
    SELECT id, source_sheet, source_row, paid_date_font_color, cell_format
    FROM normalized_cost_lines
    WHERE effective_to IS NULL
      AND deleted_at IS NULL
      AND project_id = $1
      AND paid_date_confirmed = true
      AND (paid_date IS NULL OR paid_date_font_color IS DISTINCT FROM 'black')
    ORDER BY source_sheet, source_row
    `,
    [projectId],
  );

  console.log(`Found ${dbRows.length} suspect rows in DB for this project.`);

  let matches = 0;
  let mismatches = 0;
  for (const r of dbRows) {
    if (!r.source_sheet || r.source_row == null) continue;
    const ws = wb.getWorksheet(r.source_sheet);
    if (!ws) {
      console.log(`  row ${r.id}: sheet '${r.source_sheet}' not found in workbook`);
      mismatches++;
      continue;
    }

    const paymentDateCol = findColumnByHeader(ws, ["payment date", "paid date", "actual paid", "paid", "date paid"]);
    if (paymentDateCol < 0) {
      console.log(`  row ${r.id}: payment_date column not found in sheet '${r.source_sheet}'`);
      continue;
    }
    const cell = ws.getRow(r.source_row).getCell(paymentDateCol + 1);
    const fontHex = extractFontHexLite(cell);
    const dbCellFormatHex = r.cell_format?.payment_date?.font ?? null;

    const ok = (fontHex && dbCellFormatHex && fontHex.toUpperCase() === dbCellFormatHex.toUpperCase())
      || (!fontHex && !dbCellFormatHex);
    if (ok) {
      matches++;
    } else {
      mismatches++;
      console.log(
        `  row ${r.id}: workbook font=${fontHex ?? "—"} vs DB cell_format.payment_date.font=${dbCellFormatHex ?? "—"} (top-level paid_date_font_color=${r.paid_date_font_color ?? "—"})`,
      );
    }
  }

  console.log("");
  console.log(`Validate summary: ${matches} matches, ${mismatches} mismatches across ${dbRows.length} rows.`);
  if (dbRows.length > 0 && mismatches === 0) {
    console.log("✅ Persisted cellFormat matches workbook for all checked rows. SQL replay is reliable for this project.");
  } else if (mismatches > 0) {
    console.log("⚠️ Mismatches found — investigate whether the workbook was edited after import, or persisted cellFormat is stale.");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pool = new Pool({ connectionString: requireDatabaseUrl() });
  try {
    if (args[0] === "--validate") {
      const projectId = parseInt(args[1] ?? "", 10);
      const workbookPath = args[2];
      if (!projectId || !workbookPath) {
        console.error("Usage: tsx scripts/blast-radius-paiddate.ts --validate <project_id> <path/to/workbook.xlsx>");
        process.exit(1);
      }
      await runValidate(pool, projectId, workbookPath);
    } else {
      await runSqlReplay(pool);
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
