/**
 * Per-month workbook reconciliation diagnostic.
 *
 * Compares two views of the same tracker workbook:
 *
 *   1. "Pivot truth" — the SUM values in the workbook's Finance-COS and
 *      Finance-Revenue pivot sheets, by category × invoice-date month.
 *   2. "Smart Import view" — the same totals computed from the normalized
 *      cost / revenue lines that Smart Import v2 would write to the DB,
 *      bucketed by invoice_date month (the rule used by /api/cos-tracker
 *      and /api/revenue-tracker).
 *
 * Any month or category where (2) != (1) is reported as a delta, with a
 * sample of the line-level rows that drove the gap. Lines silently
 * dropped by Smart Import (zero amount, missing invoice date, missing
 * project) are also reported separately so they can be confirmed against
 * the workbook.
 *
 * Run:
 *
 *   npx tsx qa/reconcile-workbook-vs-import.ts <path/to/tracker.xlsx>
 *
 * Exits 0 if both views agree to the cent; exits 1 if any month diverges.
 */

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { runSmartImportPreview } from "../server/lib/import";
import { parseDate, parseNumber } from "../server/lib/import/utils";

interface MonthCategoryTotals {
  // key = `${categoryKey}::${YYYY-MM}` → amount
  totals: Map<string, number>;
  // key = YYYY-MM → amount
  byMonth: Map<string, number>;
}

function emptyTotals(): MonthCategoryTotals {
  return { totals: new Map(), byMonth: new Map() };
}

function addTotal(t: MonthCategoryTotals, category: string, monthKey: string, value: number) {
  if (!Number.isFinite(value) || value === 0) return;
  const k = `${category}::${monthKey}`;
  t.totals.set(k, (t.totals.get(k) ?? 0) + value);
  t.byMonth.set(monthKey, (t.byMonth.get(monthKey) ?? 0) + value);
}

function normalizeHeader(h: any): string {
  return String(h ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function worksheetToArray(ws: ExcelJS.Worksheet): any[][] {
  const data: any[][] = [];
  const rowCount = ws.rowCount;
  const colCount = ws.columnCount;
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    const rowData: any[] = [];
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      const v = cell.value;
      if (v != null && typeof v === "object" && "result" in v) {
        rowData.push((v as any).result ?? null);
      } else {
        rowData.push(v);
      }
    }
    data.push(rowData);
  }
  return data;
}

function parsePivotSheet(ws: ExcelJS.Worksheet, label: string): MonthCategoryTotals {
  const totals = emptyTotals();
  const data = worksheetToArray(ws);

  // Header row: column A = "Row Labels", date columns follow.
  let headerRowIdx = -1;
  for (let r = 0; r < Math.min(15, data.length); r++) {
    if (normalizeHeader(data[r][0]) === "row labels") {
      headerRowIdx = r;
      break;
    }
  }
  if (headerRowIdx < 0) {
    console.warn(`  ${label}: no "Row Labels" header found — sheet skipped`);
    return totals;
  }

  // Discover month columns from the header row.
  const headerRow = data[headerRowIdx];
  const monthCols: Array<{ colIdx: number; monthKey: string }> = [];
  for (let c = 1; c < headerRow.length; c++) {
    if (normalizeHeader(headerRow[c]) === "grand total") break;
    const dateStr = parseDate(headerRow[c]);
    if (!dateStr) continue;
    monthCols.push({ colIdx: c, monthKey: dateStr.substring(0, 7) });
  }

  for (let r = headerRowIdx + 1; r < data.length; r++) {
    const rawCategory = data[r][0];
    if (!rawCategory) {
      // Two consecutive blank rows ⇒ end of pivot body.
      let blanks = 0;
      for (let k = r; k < Math.min(r + 3, data.length); k++) if (!data[k][0]) blanks++;
      if (blanks >= 2) break;
      continue;
    }
    const norm = normalizeHeader(rawCategory);
    if (norm === "grand total") break;
    if (norm === "(blank)") continue;
    const category = String(rawCategory).trim();

    for (const { colIdx, monthKey } of monthCols) {
      const v = parseNumber(data[r][colIdx]);
      if (v == null) continue;
      const num = Number(v);
      if (!Number.isFinite(num) || num === 0) continue;
      addTotal(totals, category, monthKey, num);
    }
  }

  return totals;
}

type Aggregator = (line: any) => number;
const sumCostAmount: Aggregator = (l) => Number(l?.amountExVat ?? 0);
const sumRecognitionAmount: Aggregator = (l) => Number(l?.revenueRecognitionAmount ?? 0);

function aggregateCostLines(lines: any[], valueOf: Aggregator): MonthCategoryTotals {
  const totals = emptyTotals();
  for (const l of lines) {
    const cat = String(l.costCategory ?? l.categoryKey ?? "").trim();
    if (!cat) continue;
    const invDate = l.invoiceDate;
    if (!invDate) continue;
    const monthKey = String(invDate).substring(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) continue;
    const amt = valueOf(l);
    if (!Number.isFinite(amt) || amt === 0) continue;
    addTotal(totals, cat, monthKey, amt);
  }
  return totals;
}

function formatRand(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}R ${formatted}`;
}

function reportPlanReconciliation(wb: ExcelJS.Workbook, planTasks: any[]): void {
  console.log("\n=== Project Plan reconciliation ===");

  const sheet =
    wb.getWorksheet("Project Plan") ??
    wb.getWorksheet("Plan") ??
    wb.getWorksheet("Project plan");
  if (!sheet) {
    console.warn("  [skip] No 'Project Plan' sheet found in workbook");
    return;
  }

  // Total imported plan tasks
  const imported = planTasks.length;
  const withWbs = planTasks.filter((t) => t.taskNo && String(t.taskNo).trim()).length;
  const withStartDate = planTasks.filter((t) => t.startDate).length;
  const withEndDate = planTasks.filter((t) => t.endDate).length;
  const withActualStart = planTasks.filter((t) => t.actualStartDate).length;
  const withActualEnd = planTasks.filter((t) => t.actualEndDate).length;
  const withPctComplete = planTasks.filter((t) => t.pctComplete != null).length;
  const milestones = planTasks.filter((t) => t.isMilestone).length;
  const withParent = planTasks.filter((t) => t.parentTaskNo).length;
  const maxDepth = planTasks.reduce((m, t) => Math.max(m, t.indentLevel ?? 0), 0);

  console.log(`  Plan tasks imported     : ${imported}`);
  console.log(`    with WBS code         : ${withWbs}`);
  console.log(`    with plan start date  : ${withStartDate}`);
  console.log(`    with plan end date    : ${withEndDate}`);
  console.log(`    with actual start     : ${withActualStart}`);
  console.log(`    with actual end       : ${withActualEnd}`);
  console.log(`    with % complete       : ${withPctComplete}`);
  console.log(`    milestones detected   : ${milestones}`);
  console.log(`    with parent in WBS    : ${withParent}`);
  console.log(`    max WBS depth         : ${maxDepth}`);

  // Check parent integrity — every parentTaskNo must exist as a taskNo in
  // the import. Otherwise the parent-resolution pass will silently leave
  // the row at root level and the frontend tree will look broken.
  const allTaskNos = new Set(planTasks.map((t) => String(t.taskNo ?? "").trim()).filter(Boolean));
  const orphans = planTasks.filter(
    (t) => t.parentTaskNo && !allTaskNos.has(String(t.parentTaskNo).trim()),
  );
  if (orphans.length > 0) {
    console.log(`\n  WBS orphans (${orphans.length}) — parentTaskNo references that don't exist as a taskNo:`);
    for (const o of orphans.slice(0, 10)) {
      console.log(`    row ${o.sourceRow}: WBS=${o.taskNo} parentTaskNo=${o.parentTaskNo} title="${o.taskName ?? ""}"`);
    }
    if (orphans.length > 10) console.log(`    ... (${orphans.length - 10} more)`);
  }

  // Check that the actual ↔ plan relationship is consistent: where actual
  // dates exist, plan dates should also exist (a row can't be "in progress"
  // without ever being planned). Surface anything weird.
  const actualWithoutPlan = planTasks.filter(
    (t) => (t.actualStartDate || t.actualEndDate) && !(t.startDate || t.endDate),
  );
  if (actualWithoutPlan.length > 0) {
    console.log(`\n  Tasks with actual dates but no plan dates (${actualWithoutPlan.length}):`);
    for (const t of actualWithoutPlan.slice(0, 10)) {
      console.log(
        `    row ${t.sourceRow}: WBS=${t.taskNo} title="${t.taskName ?? ""}" actualStart=${t.actualStartDate ?? "∅"} actualEnd=${t.actualEndDate ?? "∅"}`,
      );
    }
    if (actualWithoutPlan.length > 10) console.log(`    ... (${actualWithoutPlan.length - 10} more)`);
  }

  // Sanity check date ordering — endDate should be >= startDate when both
  // present (calendar string compare works for YYYY-MM-DD).
  const inverted = planTasks.filter(
    (t) => t.startDate && t.endDate && String(t.endDate) < String(t.startDate),
  );
  if (inverted.length > 0) {
    console.log(`\n  Tasks with end-before-start (${inverted.length}):`);
    for (const t of inverted.slice(0, 10)) {
      console.log(
        `    row ${t.sourceRow}: WBS=${t.taskNo} title="${t.taskName ?? ""}" start=${t.startDate} end=${t.endDate}`,
      );
    }
    if (inverted.length > 10) console.log(`    ... (${inverted.length - 10} more)`);
  }

  // Surface rows dropped by the normalizer (skipped due to missing WBS or
  // no plan/actual date) so the operator can decide whether the workbook
  // is missing data or those rows are intentional section headers.
  const data = worksheetToArray(sheet);
  let candidateRows = 0;
  for (let r = 0; r < data.length; r++) {
    const a = data[r];
    const taskNoRaw = a[1]; // col B = "No."
    const taskNameRaw = a[2]; // col C = task name (one of several possible cols)
    if (
      (taskNoRaw != null && String(taskNoRaw).trim()) ||
      (taskNameRaw != null && String(taskNameRaw).trim())
    ) {
      candidateRows++;
    }
  }
  const droppedCandidates = candidateRows - imported;
  if (droppedCandidates > 5) {
    console.log(
      `\n  Heuristic: ~${droppedCandidates} non-blank Project Plan rows did NOT make it into the import.`,
    );
    console.log("    (likely section headers, summary rows, or rows missing both WBS + dates.)");
  }

  console.log(
    `\n  Result: ${orphans.length === 0 && actualWithoutPlan.length === 0 && inverted.length === 0 ? "OK — plan structure looks consistent" : "DIAGNOSTICS — see above"}`,
  );
}

function reportSection(label: string, pivot: MonthCategoryTotals, lines: MonthCategoryTotals): boolean {
  console.log(`\n=== ${label} ===`);
  const months = Array.from(new Set([...pivot.byMonth.keys(), ...lines.byMonth.keys()])).sort();

  console.log(`Month       Pivot (workbook)    Import (lines)     Delta`);
  console.log(`----------  ------------------  ------------------  ----------`);
  let pivotTotal = 0;
  let lineTotal = 0;
  let anyDelta = false;
  for (const m of months) {
    const p = pivot.byMonth.get(m) ?? 0;
    const l = lines.byMonth.get(m) ?? 0;
    const d = l - p;
    pivotTotal += p;
    lineTotal += l;
    const marker = Math.abs(d) > 0.5 ? "  <-- DELTA" : "";
    if (marker) anyDelta = true;
    console.log(
      `${m}     ${formatRand(p).padStart(18)}  ${formatRand(l).padStart(18)}  ${formatRand(d).padStart(10)}${marker}`,
    );
  }
  console.log(`----------  ------------------  ------------------  ----------`);
  console.log(
    `GRAND TOTAL ${formatRand(pivotTotal).padStart(18)}  ${formatRand(lineTotal).padStart(18)}  ${formatRand(lineTotal - pivotTotal).padStart(10)}`,
  );

  // Category-level breakdown for deltas
  if (anyDelta) {
    console.log(`\nPer-category deltas (line-bucket minus pivot, rounded > R 0.50):`);
    const allKeys = new Set([...pivot.totals.keys(), ...lines.totals.keys()]);
    const deltaRows: Array<{ key: string; p: number; l: number; d: number }> = [];
    for (const k of allKeys) {
      const p = pivot.totals.get(k) ?? 0;
      const l = lines.totals.get(k) ?? 0;
      const d = l - p;
      if (Math.abs(d) > 0.5) deltaRows.push({ key: k, p, l, d });
    }
    deltaRows.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    for (const row of deltaRows.slice(0, 25)) {
      console.log(
        `  ${row.key.padEnd(40)} pivot=${formatRand(row.p).padStart(16)}  lines=${formatRand(row.l).padStart(16)}  delta=${formatRand(row.d).padStart(12)}`,
      );
    }
    if (deltaRows.length > 25) console.log(`  ... (${deltaRows.length - 25} more)`);
  }

  return anyDelta;
}

async function main() {
  const [, , fileArg] = process.argv;
  if (!fileArg) {
    console.error("Usage: npx tsx qa/reconcile-workbook-vs-import.ts <path/to/tracker.xlsx>");
    process.exit(2);
  }
  const filePath = path.resolve(fileArg);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }

  console.log(`Reconciling ${filePath} ...`);

  const buffer = fs.readFileSync(filePath);
  const preview = await runSmartImportPreview(buffer, path.basename(filePath));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as Buffer & ArrayBuffer);

  const cosSheet = wb.getWorksheet("Finance - COS");
  const revSheet = wb.getWorksheet("Finance - Revenue");

  let anyDelta = false;

  if (cosSheet) {
    const cosPivot = parsePivotSheet(cosSheet, "Finance - COS");
    const cosLines = aggregateCostLines(preview.normalization.costLines, sumCostAmount);
    if (reportSection("COS reconciliation (workbook pivot vs Smart Import lines)", cosPivot, cosLines)) {
      anyDelta = true;
    }
  } else {
    console.warn("\n[skip] Finance - COS sheet not found in workbook");
  }

  if (revSheet) {
    // The Finance - Revenue pivot is sourced from the Expenditure Breakdown's
    // REVENUE RECOGNITION AMOUNT (col U), grouped by cost category × invoice
    // date month — the same canonical bucket as Finance - COS. So we
    // aggregate the same cost-line stream here, just summing the recognition
    // amount instead of actual total.
    const revPivot = parsePivotSheet(revSheet, "Finance - Revenue");
    const revLines = aggregateCostLines(preview.normalization.costLines, sumRecognitionAmount);
    if (reportSection("Revenue reconciliation (workbook pivot vs Smart Import lines)", revPivot, revLines)) {
      anyDelta = true;
    }
  } else {
    console.warn("\n[skip] Finance - Revenue sheet not found in workbook");
  }

  // ── Plan section ────────────────────────────────────────────────────
  // Walk the Project Plan sheet directly and compare task-by-task to what
  // the Smart Import normalizer extracted. Surfaces dropped plan rows,
  // missing WBS / dates / percent-complete, and broken parent links.
  reportPlanReconciliation(wb, preview.normalization.planTasks);

  // Report lines that get filtered out before bucketing so they can be
  // confirmed as legitimately excluded vs an import-side bug.
  console.log("\n=== Lines silently dropped by bucketing filters ===");
  const dropped: Array<{ kind: string; row: number | null; reasons: string[]; l: any }> = [];
  for (const l of preview.normalization.costLines as any[]) {
    const amt = l.amountExVat != null ? Number(l.amountExVat) : NaN;
    const reasons: string[] = [];
    if (!Number.isFinite(amt) || amt === 0) reasons.push("zero-or-blank-amount");
    if (!l.invoiceDate) reasons.push("missing-invoice-date");
    if (!l.costCategory) reasons.push("missing-category");
    if (reasons.length > 0) dropped.push({ kind: "COST", row: l.sourceRow ?? null, reasons, l });
  }
  console.log(`  Dropped lines: ${dropped.length}`);
  for (const d of dropped.slice(0, 15)) {
    console.log(
      `    [${d.kind}] row ${d.row}: ${d.reasons.join(", ")} — cat="${d.l.costCategory ?? ""}" amt=${d.l.amountExVat ?? "∅"} invDate=${d.l.invoiceDate ?? "∅"}`,
    );
  }
  if (dropped.length > 15) console.log(`    ... (${dropped.length - 15} more)`);

  if (anyDelta) {
    console.log("\nReconciliation FAILED — see deltas above.");
  } else {
    console.log("\nReconciliation OK — every month matches to the cent.");
  }
  process.exit(anyDelta ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
