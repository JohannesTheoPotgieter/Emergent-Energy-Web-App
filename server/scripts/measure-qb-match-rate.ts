#!/usr/bin/env tsx
/**
 * measure-qb-match-rate — READ-ONLY viability probe for invoice-number matching.
 *
 * Pulls QuickBooks Bills + Invoices for a window (default last 6 months) and the
 * live tracker cost / revenue lines, normalises invoice numbers on BOTH sides
 * with the existing `base` rule plus stricter/looser variants, aggregates to
 * invoice (doc) grain, and reports — per stream (COS, REV) — matched /
 * amount-variance / tracker-only / qb-only by COUNT and VALUE, the MATCH RATE BY
 * VALUE, the 20 highest-value unmatched each side, and a near-miss sample.
 *
 * SELECT-only against the tracker tables; QuickBooks reads via the existing
 * getBills/getInvoices (which page + serve mock fixtures when QB creds are
 * absent and NODE_ENV !== production). Writes qa/reports/qb-match-rate.csv.
 * Changes NO app behaviour, NO schema, NO QuickBooks state.
 *
 *   Run (prod data): DATABASE_URL=… (QB connected) tsx server/scripts/measure-qb-match-rate.ts [monthsBack]
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

import { getBills, getInvoices } from "../services/quickbooks-service";
import {
  billRawToSummary,
  invoiceRawToSummary,
} from "../services/quickbooks-reconciliation-service";
import {
  NORMALIZER_ORDER,
  computeMatchRate,
  topUnmatchedByValue,
  findNearMisses,
  type InvoiceRecord,
  type MatchRateResult,
  type Stream,
} from "../lib/finance/qb-match-rate";
import {
  matchWithReasons,
  DEFAULT_INVOICE_NORM_CONFIG,
  HARDENED_INVOICE_NORM_CONFIG,
  UNMATCHED_REASONS,
  type MatchWithReasonsResult,
} from "../lib/finance/invoice-normalization";

const TOLERANCE = 1; // R1 — same tie tolerance the recon surfaces use.
const REPORT_PATH = path.join(process.cwd(), "qa", "reports", "qb-match-rate.csv");

function windowFromArgs(): { start: string; end: string; monthsBack: number } {
  const monthsBack = Math.max(1, Number.parseInt(process.argv[2] ?? "", 10) || 6);
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - monthsBack);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end), monthsBack };
}

async function loadTrackerRecords(
  client: Client,
  table: "normalized_cost_lines" | "normalized_revenue_lines",
  start: string,
  end: string,
): Promise<InvoiceRecord[]> {
  const res = await client.query<{ invoice_number: string | null; amount_ex_vat: string | null }>(
    `SELECT invoice_number, amount_ex_vat
       FROM ${table}
      WHERE effective_to IS NULL AND deleted_at IS NULL
        AND invoice_date >= $1 AND invoice_date <= $2`,
    [start, end],
  );
  return res.rows.map((r) => ({
    number: r.invoice_number,
    amountExVat: r.amount_ex_vat == null ? 0 : Number(r.amount_ex_vat) || 0,
  }));
}

function qbBillRecords(resp: unknown): InvoiceRecord[] {
  const bills: unknown[] = (resp as { QueryResponse?: { Bill?: unknown[] } })?.QueryResponse?.Bill ?? [];
  return bills.map((b) => {
    const s = billRawToSummary(b);
    return { number: s.docNumber, amountExVat: s.qbAmountExVat ?? s.totalAmount ?? 0 };
  });
}

function qbInvoiceRecords(resp: unknown): InvoiceRecord[] {
  const invoices: unknown[] = (resp as { QueryResponse?: { Invoice?: unknown[] } })?.QueryResponse?.Invoice ?? [];
  return invoices.map((i) => {
    const s = invoiceRawToSummary(i);
    return { number: s.docNumber, amountExVat: s.totalAmount ?? 0 };
  });
}

const money = (n: number): string => `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const csvCell = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function printStream(stream: Stream, results: MatchRateResult[]): void {
  console.log("");
  console.log(`━━ ${stream} — invoice-number match rate by normalizer ━━`);
  const base = results[0];
  console.log(
    `   QB invoices: ${base.qbInvoiceCount} (${money(base.qbTotalValue)}, blank#: ${base.qbBlankNumberCount}) · ` +
      `tracker invoices: ${base.trackerInvoiceCount} (${money(base.trackerTotalValue)}, blank#: ${base.trackerBlankNumberCount})`,
  );
  console.log("   normalizer                matched  amtVar  trkOnly  qbOnly   MATCH%val  num%val");
  for (const r of results) {
    console.log(
      `   ${r.normalizer.padEnd(24)} ${String(r.matchedCount).padStart(6)} ${String(r.amountVarianceCount).padStart(7)} ` +
        `${String(r.trackerOnlyCount).padStart(8)} ${String(r.qbOnlyCount).padStart(7)} ` +
        `${(r.trackerMatchRateByValue + "%").padStart(10)} ${(r.trackerNumberMatchRateByValue + "%").padStart(8)}`,
    );
  }

  console.log(`   Top unmatched TRACKER (${stream}), by value:`);
  for (const u of topUnmatchedByValue(base, "tracker", 20)) {
    console.log(`     ${money(u.trackerAmount ?? 0).padStart(12)}  ${u.trackerRaw.join("|")}`);
  }
  console.log(`   Top unmatched QB (${stream}), by value:`);
  for (const u of topUnmatchedByValue(base, "qb", 20)) {
    console.log(`     ${money(u.qbAmount ?? 0).padStart(12)}  ${u.qbRaw.join("|")}`);
  }
}

function printResiduals(
  side: "tracker" | "qb",
  before: MatchWithReasonsResult,
  after: MatchWithReasonsResult,
): void {
  const b = side === "tracker" ? before.trackerResiduals : before.qbResiduals;
  const a = side === "tracker" ? after.trackerResiduals : after.qbResiduals;
  const parts = UNMATCHED_REASONS.filter((r) => b[r].count > 0 || a[r].count > 0).map(
    (r) => `${r}: ${b[r].count}→${a[r].count} (${money(b[r].value)}→${money(a[r].value)})`,
  );
  if (parts.length > 0) console.log(`       ${side} residuals — ${parts.join("  ·  ")}`);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[measure-qb-match-rate] DATABASE_URL is not set (tracker lines required).");
    process.exit(2);
  }
  const { start, end, monthsBack } = windowFromArgs();
  console.log(`QB invoice-number match-rate probe — window ${start} … ${end} (${monthsBack} months). READ-ONLY.`);

  // QuickBooks side (best-effort — exit cleanly if QB is unreachable).
  let qbCos: InvoiceRecord[] = [];
  let qbRev: InvoiceRecord[] = [];
  try {
    const [bills, invoices] = await Promise.all([getBills(start, end), getInvoices(start, end)]);
    qbCos = qbBillRecords(bills);
    qbRev = qbInvoiceRecords(invoices);
  } catch (err) {
    console.error(
      "[measure-qb-match-rate] QuickBooks unavailable — connect QuickBooks and retry:",
      err instanceof Error ? err.message : String(err),
    );
    process.exit(2);
  }

  // Tracker side (SELECT-only).
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15_000, statement_timeout: 120_000 });
  await client.connect();
  let trCos: InvoiceRecord[] = [];
  let trRev: InvoiceRecord[] = [];
  try {
    trCos = await loadTrackerRecords(client, "normalized_cost_lines", start, end);
    trRev = await loadTrackerRecords(client, "normalized_revenue_lines", start, end);
  } finally {
    await client.end();
  }

  const cosResults = NORMALIZER_ORDER.map((n) => computeMatchRate("COS", qbCos, trCos, n, TOLERANCE));
  const revResults = NORMALIZER_ORDER.map((n) => computeMatchRate("REV", qbRev, trRev, n, TOLERANCE));

  printStream("COS", cosResults);
  printStream("REV", revResults);

  // Near-miss samples (base missed, looser would match within R1).
  for (const [stream, qb, tr] of [["COS", qbCos, trCos], ["REV", qbRev, trRev]] as const) {
    const near = findNearMisses(qb, tr, "base", "digits_no_leading_zeros", TOLERANCE, 10);
    if (near.length === 0) continue;
    console.log(`\n   Near-misses (${stream}) — base missed, digits_no_leading_zeros would match:`);
    for (const nm of near) {
      console.log(`     ${money(nm.trackerAmount).padStart(12)}  tracker=${nm.trackerRaw.join("|")}  qb=${nm.qbRaw.join("|")}  Δ${nm.amountDelta}`);
    }
  }

  // G7 — configurable canonicaliser: match rate BEFORE (live default key) vs
  // AFTER (hardened candidate key), with residual-unmatched reasons so the
  // coverage gap is explainable. READ-ONLY measurement — does not change the
  // live engine key (that needs the real-example catalogue + owner sign-off).
  for (const [stream, qb, tr] of [["COS", qbCos, trCos], ["REV", qbRev, trRev]] as const) {
    const before = matchWithReasons(qb, tr, DEFAULT_INVOICE_NORM_CONFIG, TOLERANCE);
    const after = matchWithReasons(qb, tr, HARDENED_INVOICE_NORM_CONFIG, TOLERANCE);
    console.log(`\n   Normalisation before/after (${stream}) — tracker match rate by value:`);
    console.log(
      `     before (default key): ${before.matchRateByValue}%   after (hardened key): ${after.matchRateByValue}%   ` +
        `Δ ${(after.matchRateByValue - before.matchRateByValue).toFixed(2)}pp`,
    );
    printResiduals("tracker", before, after);
    printResiduals("qb", before, after);
  }

  writeCsv(start, end, [...cosResults, ...revResults], cosResults[0], revResults[0]);
  console.log(`\nWrote ${path.relative(process.cwd(), REPORT_PATH)}.`);

  const headline = `COS ${cosResults[0].trackerMatchRateByValue}% · REV ${revResults[0].trackerMatchRateByValue}% (base, by tracker value)`;
  console.log(`HEADLINE match rate: ${headline}`);
  process.exit(0);
}

function writeCsv(
  start: string,
  end: string,
  summaries: MatchRateResult[],
  cosBase: MatchRateResult,
  revBase: MatchRateResult,
): void {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  const lines: string[] = [];
  lines.push(`# QB invoice-number match rate — window ${start}..${end} — generated ${new Date().toISOString()} — READ-ONLY`);
  lines.push("# SUMMARY (match rate BY VALUE is the headline)");
  lines.push(
    [
      "stream", "normalizer", "qb_invoices", "tracker_invoices", "matched", "amount_variance",
      "tracker_only", "qb_only", "tracker_total_value", "matched_tracker_value",
      "tracker_match_rate_by_value_pct", "tracker_number_match_rate_by_value_pct",
      "qb_total_value", "matched_qb_value", "qb_match_rate_by_value_pct", "amount_variance_abs_delta",
    ].join(","),
  );
  for (const r of summaries) {
    lines.push(
      [
        r.stream, r.normalizer, r.qbInvoiceCount, r.trackerInvoiceCount, r.matchedCount, r.amountVarianceCount,
        r.trackerOnlyCount, r.qbOnlyCount, r.trackerTotalValue, r.matchedTrackerValue,
        r.trackerMatchRateByValue, r.trackerNumberMatchRateByValue,
        r.qbTotalValue, r.matchedQbValue, r.qbMatchRateByValue, r.amountVarianceAbsDelta,
      ].map(csvCell).join(","),
    );
  }
  lines.push("");
  lines.push("# DETAIL — base normalizer, one row per normalized invoice number");
  lines.push(["section", "stream", "normalized_key", "status", "qb_amount_ex_vat", "tracker_amount_ex_vat", "delta", "qb_raw_numbers", "tracker_raw_numbers"].join(","));
  for (const base of [cosBase, revBase]) {
    const rows = [...base.rows].sort((a, b) => (b.trackerAmount ?? b.qbAmount ?? 0) - (a.trackerAmount ?? a.qbAmount ?? 0));
    for (const row of rows) {
      lines.push(
        [
          "DETAIL", base.stream, row.key, row.status,
          row.qbAmount ?? "", row.trackerAmount ?? "", row.delta ?? "",
          row.qbRaw.join("|"), row.trackerRaw.join("|"),
        ].map(csvCell).join(","),
      );
    }
  }
  fs.writeFileSync(REPORT_PATH, lines.join("\n") + "\n", "utf-8");
}

main().catch((err) => {
  console.error("[measure-qb-match-rate] FAILED:", err instanceof Error ? err.message : err);
  process.exit(2);
});
