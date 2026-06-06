#!/usr/bin/env tsx
/**
 * measure-colour-default.ts — READ-ONLY exposure analysis. Writes NO data and
 * changes NO behaviour. Quantifies how much realised COS currently depends on
 * an *unreadable* invoice-date cell colour that the importer defaulted to black.
 *
 * Background: COS realises (§3.2 / cos-realisation.ts) when an invoice is
 * captured AND the invoice-date colour is BLACK/confirmed. The importer's
 * getCellFontColor (server/lib/import/normalizer.ts) DEFAULTS to black whenever
 * the font colour can't be resolved (no font, no colour, unresolvable hex,
 * extraction error). Those defaults leave `cell_format.invoice_date.font`
 * ABSENT (extractCellFormat only records a font when a colour resolves), whereas
 * a genuinely-read black records an explicit `#RRGGBB`. That is the signal used
 * to re-derive "defaulted" for historical rows.
 *
 * For each LIVE actuals row (effective_to IS NULL):
 *   - colour is "defaulted" when colour_source='defaulted' (P0.5a), or — for
 *     historical rows where colour_source IS NULL — when the row reads
 *     confirmed-black yet carries no explicit invoice_date font in cell_format.
 *   - "affected" = currently realised AND colour defaulted AND realisation FLIPS
 *     to not-realised when the defaulted black is inverted to red (i.e. the black
 *     default is load-bearing). Flipping re-runs the canonical gate, so lines
 *     held realised by an admin override are correctly excluded.
 *
 * Output: count of affected lines + SUM of COS that would flip realised→not, by
 * project and by locked vs open month (cos_period_locks). Prints a summary table
 * and writes qa/reports/colour-default-exposure.csv.
 *
 * CAVEAT (upper bound): QuickBooks evidence (lineAssignedQbExVat) also realises a
 * line independent of colour, but per-line QB allocation requires the expense
 * engine and is NOT netted here. Colour is the fallback only "when QB is silent",
 * so most colour-dependent lines are QB-silent — but treat the figure as an
 * upper bound pending QB netting.
 *
 * Usage: tsx server/scripts/measure-colour-default.ts [--dry-run]
 *   --dry-run prints the summary but does not write the CSV.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { and, inArray, isNull } from "drizzle-orm";

import { db, initializeDatabase } from "../db";
import {
  cosPeriodLocks,
  normalizedCostLineActuals,
  normalizedCostLines,
  projectInfo,
} from "@shared/schema";
import { isCanonicalCosRealised, type CosLineInput } from "../lib/finance/cos-realisation";

type CellFormatMap = Record<string, { font?: string; fill?: string; bold?: boolean } | undefined>;

interface ActualsRow {
  id: number;
  costLineId: number;
  projectId: number;
  actualTotal: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  poNumber: string | null;
  financePaymentDate: string | null;
  invoiceDateFontColor: string | null;
  invoiceDateConfirmed: boolean | null;
  colourSource: string | null;
  cellFormat: unknown;
}
interface ParentRow {
  id: number;
  cosStatusOverride: string | null;
  cosRealised: boolean | null;
  status: string | null;
  poNumber: string | null;
  invoiceDateFontColor: string | null;
  invoiceDateConfirmed: boolean | null;
  cellFormat: unknown;
}

const monthKeyOf = (iso: string | null): string | null =>
  iso && String(iso).length >= 7 ? String(iso).slice(0, 7) : null;

/** The effective invoice-date colour signal for an actuals row: its own value,
 *  falling back to the parent for legacy rows imported before per-child colour. */
function effectiveColour(row: ActualsRow, parent: ParentRow | undefined): {
  fontColor: string | null;
  confirmed: boolean | null;
  cellFormat: CellFormatMap | null;
} {
  const childHasColour = row.invoiceDateFontColor != null || row.invoiceDateConfirmed != null;
  if (childHasColour || !parent) {
    return {
      fontColor: row.invoiceDateFontColor ?? null,
      confirmed: row.invoiceDateConfirmed ?? null,
      cellFormat: (row.cellFormat ?? null) as CellFormatMap | null,
    };
  }
  return {
    fontColor: parent.invoiceDateFontColor ?? null,
    confirmed: parent.invoiceDateConfirmed ?? null,
    cellFormat: (parent.cellFormat ?? null) as CellFormatMap | null,
  };
}

/** True when the black confirmation came from the importer's default branch
 *  (colour unreadable), not from an explicitly-read colour. */
function isDefaultedBlack(
  colourSource: string | null,
  colour: { fontColor: string | null; confirmed: boolean | null; cellFormat: CellFormatMap | null },
): boolean {
  if (colourSource === "defaulted") return true; // authoritative (P0.5a)
  if (colourSource === "read") return false;
  // Historical (colour_source IS NULL) → re-derive via the importer fallback.
  const confirmedBlack =
    colour.confirmed === true || String(colour.fontColor ?? "").toLowerCase() === "black";
  if (!confirmedBlack) return false;
  // Explicit invoice_date font present ⇒ a colour resolved ⇒ READ. Absent ⇒ the
  // importer hit a default-to-black branch ⇒ DEFAULTED.
  const explicitFont = colour.cellFormat?.invoice_date?.font;
  return explicitFont == null;
}

function buildInput(
  row: ActualsRow,
  parent: ParentRow | undefined,
  colour: { fontColor: string | null; confirmed: boolean | null },
  today: string,
): CosLineInput {
  return {
    status: parent?.status ?? null,
    cosStatusOverride: parent?.cosStatusOverride ?? null,
    cosRealised: parent?.cosRealised ?? null,
    expenseInvoiceNumber: row.invoiceNumber ?? null,
    expenseInvoicedDate: row.invoiceDate ? String(row.invoiceDate).slice(0, 10) : null,
    expensePoNumber: row.poNumber ?? parent?.poNumber ?? null,
    paymentDate: row.financePaymentDate ? String(row.financePaymentDate).slice(0, 10) : null,
    today,
    amountExVat: row.actualTotal ?? null,
    invoiceDateFontColor: colour.fontColor,
    invoiceDateConfirmed: colour.confirmed,
    lineAssignedQbExVat: null, // not netted — see CAVEAT in the header
  };
}

interface Bucket {
  projectId: number;
  locked: boolean;
  lines: number;
  cos: number;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Measure colour-default exposure — READ ONLY${dryRun ? " · DRY RUN (no CSV)" : ""}\n`);

  await initializeDatabase();

  // Active period locks (locked months). Soft-delete: unlocked_at IS NULL = active.
  const lockRows = (await db
    .select({ periodMonth: cosPeriodLocks.periodMonth })
    .from(cosPeriodLocks)
    .where(isNull(cosPeriodLocks.unlockedAt))) as Array<{ periodMonth: string | null }>;
  const lockedMonths = new Set(
    lockRows.map((r) => monthKeyOf(r.periodMonth)).filter((m): m is string => m != null),
  );

  // Live actuals (snapshot-guarded).
  const actuals = (await db
    .select({
      id: normalizedCostLineActuals.id,
      costLineId: normalizedCostLineActuals.costLineId,
      projectId: normalizedCostLineActuals.projectId,
      actualTotal: normalizedCostLineActuals.actualTotal,
      invoiceNumber: normalizedCostLineActuals.invoiceNumber,
      invoiceDate: normalizedCostLineActuals.invoiceDate,
      poNumber: normalizedCostLineActuals.poNumber,
      financePaymentDate: normalizedCostLineActuals.financePaymentDate,
      invoiceDateFontColor: normalizedCostLineActuals.invoiceDateFontColor,
      invoiceDateConfirmed: normalizedCostLineActuals.invoiceDateConfirmed,
      colourSource: normalizedCostLineActuals.colourSource,
      cellFormat: normalizedCostLineActuals.cellFormat,
    })
    .from(normalizedCostLineActuals)
    .where(and(isNull(normalizedCostLineActuals.effectiveTo), isNull(normalizedCostLineActuals.deletedAt)))) as ActualsRow[];

  // Live parents (for admin override / status).
  const parentIds = [...new Set(actuals.map((a) => a.costLineId))];
  const parents =
    parentIds.length === 0
      ? []
      : ((await db
          .select({
            id: normalizedCostLines.id,
            cosStatusOverride: normalizedCostLines.cosStatusOverride,
            cosRealised: normalizedCostLines.cosRealised,
            status: normalizedCostLines.status,
            poNumber: normalizedCostLines.poNumber,
            invoiceDateFontColor: normalizedCostLines.invoiceDateFontColor,
            invoiceDateConfirmed: normalizedCostLines.invoiceDateConfirmed,
            cellFormat: normalizedCostLines.cellFormat,
          })
          .from(normalizedCostLines)
          .where(and(inArray(normalizedCostLines.id, parentIds), isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt)))) as ParentRow[]);
  const parentById = new Map(parents.map((p) => [p.id, p]));

  // Project names.
  const projectIds = [...new Set(actuals.map((a) => a.projectId))];
  const projRows =
    projectIds.length === 0
      ? []
      : ((await db
          .select({ id: projectInfo.id, projectName: projectInfo.projectName })
          .from(projectInfo)
          .where(inArray(projectInfo.id, projectIds))) as Array<{ id: number; projectName: string | null }>);
  const projectName = new Map(projRows.map((p) => [p.id, p.projectName ?? `project ${p.id}`]));

  const today = new Date().toISOString().slice(0, 10);

  let totalLines = 0;
  let defaultedAuthoritative = 0;
  let defaultedRederived = 0;
  let realisedDefaulted = 0;
  const buckets = new Map<string, Bucket>();

  for (const row of actuals) {
    totalLines += 1;
    const parent = parentById.get(row.costLineId);
    const colour = effectiveColour(row, parent);

    const defaulted = isDefaultedBlack(row.colourSource, colour);
    if (defaulted) {
      if (row.colourSource === "defaulted") defaultedAuthoritative += 1;
      else defaultedRederived += 1;
    }

    const input = buildInput(row, parent, colour, today);
    const realisedNow = isCanonicalCosRealised(input);
    if (!realisedNow || !defaulted) continue;
    realisedDefaulted += 1;

    // Invert the defaulted black → red (and its derived confirmed flag) and re-test.
    const realisedInverted = isCanonicalCosRealised({
      ...input,
      invoiceDateFontColor: "red",
      invoiceDateConfirmed: false,
    });
    if (realisedInverted) continue; // realisation independent of the colour default

    const month = monthKeyOf(row.invoiceDate);
    const locked = month != null && lockedMonths.has(month);
    const cos = row.actualTotal == null ? 0 : Number(row.actualTotal);
    const key = `${row.projectId}:${locked ? "locked" : "open"}`;
    const b = buckets.get(key) ?? { projectId: row.projectId, locked, lines: 0, cos: 0 };
    b.lines += 1;
    b.cos += Number.isFinite(cos) ? cos : 0;
    buckets.set(key, b);
  }

  const rows = [...buckets.values()].sort(
    (a, b) => b.cos - a.cos || a.projectId - b.projectId,
  );
  const affectedLines = rows.reduce((s, r) => s + r.lines, 0);
  const affectedCos = rows.reduce((s, r) => s + r.cos, 0);
  const lockedCos = rows.filter((r) => r.locked).reduce((s, r) => s + r.cos, 0);
  const openCos = affectedCos - lockedCos;

  // ---- Summary table ----
  console.log("Colour-default exposure (read-only)");
  console.log("───────────────────────────────────");
  console.log(`Live actuals lines scanned        : ${totalLines}`);
  console.log(`Defaulted black (colour_source)   : ${defaultedAuthoritative}`);
  console.log(`Defaulted black (re-derived/null) : ${defaultedRederived}`);
  console.log(`Realised AND defaulted            : ${realisedDefaulted}`);
  console.log(`AFFECTED (flip realised→not)      : ${affectedLines} lines`);
  console.log(`COS exposed (would flip)          : R ${affectedCos.toFixed(2)}`);
  console.log(`  · locked months                 : R ${lockedCos.toFixed(2)}`);
  console.log(`  · open months                   : R ${openCos.toFixed(2)}\n`);
  console.log("By project × lock state:");
  console.log("project_id  lock_state  lines  cos_exposed  project");
  for (const r of rows) {
    console.log(
      `${String(r.projectId).padStart(10)}  ${(r.locked ? "locked" : "open").padEnd(10)}  ${String(r.lines).padStart(5)}  ${r.cos.toFixed(2).padStart(11)}  ${projectName.get(r.projectId) ?? ""}`,
    );
  }

  if (dryRun) {
    console.log("\nDry run — CSV not written.");
    return;
  }

  // ---- CSV ----
  const reportDir = path.join(process.cwd(), "qa", "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const csvPath = path.join(reportDir, "colour-default-exposure.csv");
  const esc = (v: string | number): string => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = ["project_id,project_name,lock_state,affected_lines,cos_exposed"];
  for (const r of rows) {
    lines.push(
      [r.projectId, esc(projectName.get(r.projectId) ?? ""), r.locked ? "locked" : "open", r.lines, r.cos.toFixed(2)].join(","),
    );
  }
  lines.push(["TOTAL", "", "all", affectedLines, affectedCos.toFixed(2)].join(","));
  fs.writeFileSync(csvPath, lines.join("\n") + "\n", "utf8");
  console.log(`\nWrote ${csvPath}`);
}

const isDirectRun =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
