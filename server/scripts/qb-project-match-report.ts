/**
 * QB↔tracker per-project match-rate report (G2 auto-matcher).
 *
 * Deterministic demonstration of the matcher over a SEEDED dataset — no DB and
 * no QuickBooks tenant required, so it runs anywhere (the engine itself is the
 * pure server/lib/finance/qb-project-matcher). Against a provisioned DB + QB
 * realm the same numbers come from `refreshQbProjectMatches` /
 * `getQbProjectAttribution` (server/services/qb-project-match-service.ts).
 *
 *   npm run report:qb-project-match
 */
import {
  matchQbDocsToTrackerLines,
  computeProjectAttribution,
  computeUnattributed,
  tallyMatches,
  DEFAULT_MATCH_TOLERANCE,
  round2,
  type MatchStream,
  type QbDocInput,
  type TrackerLineInput,
  type QbProjectMatch,
} from "../lib/finance/qb-project-matcher";

const PROJECT_NAMES: Record<number, string> = { 100: "Mondi", 200: "Karan Beef", 300: "Shoprite DC" };

// ── Seeded tracker lines (project trackers — the source of project identity) ──
const REV_TRACKER: TrackerLineInput[] = [
  { trackerLineId: 1, projectId: 100, invoiceNumber: "INV-100", amountExVat: 1000 },
  { trackerLineId: 2, projectId: 100, invoiceNumber: "INV-101", amountExVat: 500 },
  { trackerLineId: 3, projectId: 100, invoiceNumber: "INV-102", amountExVat: 300 }, // no QB → uncovered
  { trackerLineId: 4, projectId: 200, invoiceNumber: "INV-007", amountExVat: 4200 }, // QB sends "7"
  { trackerLineId: 5, projectId: 300, invoiceNumber: "INV-300", amountExVat: 800 },
  { trackerLineId: 6, projectId: 100, invoiceNumber: "INV-055", amountExVat: 50 }, // dup across projects
  { trackerLineId: 7, projectId: 300, invoiceNumber: "INV-055", amountExVat: 50 }, // → ambiguous
];
const COS_TRACKER: TrackerLineInput[] = [
  { trackerLineId: 11, projectId: 100, invoiceNumber: "BILL-100", amountExVat: 700 },
  { trackerLineId: 12, projectId: 200, invoiceNumber: "BILL-200", amountExVat: 1500 },
  { trackerLineId: 13, projectId: 200, invoiceNumber: "BILL-201", amountExVat: 250 }, // QB R50 out → unmatched
];

// ── Seeded QuickBooks documents (no reliable project tag of their own) ──
const REV_QB: QbDocInput[] = [
  { qbDocId: "inv-a", docNumber: "INV-100", amountExVat: 1000, date: "2026-01-10" },
  { qbDocId: "inv-b", docNumber: "INV-101", amountExVat: 500, date: "2026-01-12" },
  { qbDocId: "inv-c", docNumber: "7", amountExVat: 4200, date: "2026-01-15" }, // prefix/zeros vs INV-007
  { qbDocId: "inv-d", docNumber: "INV-300", amountExVat: 800, date: "2026-01-18" },
  { qbDocId: "inv-e", docNumber: "INV-055", amountExVat: 50, date: "2026-01-20" }, // ambiguous
  { qbDocId: "inv-f", docNumber: "INV-900", amountExVat: 999, date: "2026-01-22" }, // unmatched
];
const COS_QB: QbDocInput[] = [
  { qbDocId: "bill-a", docNumber: "BILL-100", amountExVat: 700, date: "2026-01-09" },
  { qbDocId: "bill-b", docNumber: "BILL-200", amountExVat: 1500, date: "2026-01-11" },
  { qbDocId: "bill-c", docNumber: "BILL-201", amountExVat: 300, date: "2026-01-13" }, // R50 out → unmatched
  { qbDocId: "bill-d", docNumber: "BILL-NONE", amountExVat: 640, date: "2026-01-14" }, // unmatched
];

const tolerance = DEFAULT_MATCH_TOLERANCE;
const pct = (num: number, den: number): string => (den === 0 ? "—" : `${round2((num / den) * 100).toFixed(1)}%`);
const zar = (n: number): string => `R${n.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;

function streamReport(stream: MatchStream, qb: QbDocInput[], tracker: TrackerLineInput[]): QbProjectMatch[] {
  const matches = matchQbDocsToTrackerLines(stream, qb, tracker, { tolerance });
  const counts = tallyMatches(matches);
  const qbTotal = round2(qb.reduce((s, d) => s + d.amountExVat, 0));
  const matchedQb = round2(
    matches.filter((m) => m.matchType === "matched").reduce((s, m) => s + m.qbExVatAmount, 0),
  );
  console.log(`\n■ ${stream}  (QB docs: ${counts.total})`);
  console.log(
    `  matched ${counts.matched}  ·  ambiguous ${counts.ambiguous}  ·  unmatched ${counts.unmatched}`,
  );
  console.log(`  QB value matched: ${zar(matchedQb)} of ${zar(qbTotal)}  →  match rate ${pct(matchedQb, qbTotal)}`);
  return matches;
}

function projectTable(stream: MatchStream, matches: QbProjectMatch[], tracker: TrackerLineInput[]): void {
  const attr = computeProjectAttribution(stream, matches, tracker);
  console.log(`\n  per-project ${stream} attribution (coverage = matched ÷ invoiced tracker value):`);
  console.log(
    "    project           qb attr      tracker matched   invoiced     coverage   variance   label",
  );
  for (const a of attr) {
    const name = (PROJECT_NAMES[a.projectId] ?? `#${a.projectId}`).padEnd(16);
    const label = a.complete ? "complete" : "matched portion only";
    console.log(
      `    ${name}  ${zar(a.qbAttributedExVat).padStart(9)}   ${zar(a.trackerMatchedExVat).padStart(13)}   ${zar(
        a.trackerInvoicedExVat,
      ).padStart(8)}   ${a.coveragePct.toFixed(1).padStart(7)}%   ${zar(a.varianceExVat).padStart(7)}   ${label}`,
    );
  }
}

function worklist(matches: QbProjectMatch[]): void {
  const rows = matches.filter((m) => m.matchType !== "matched");
  if (rows.length === 0) return;
  for (const m of rows.sort((a, b) => b.qbExVatAmount - a.qbExVatAmount)) {
    console.log(
      `    [${m.matchType.padEnd(9)}] ${(m.docNumber ?? "(no number)").padEnd(12)} ${zar(m.qbExVatAmount).padStart(8)}  ${m.qbDate ?? ""}` +
        (m.matchType === "ambiguous" ? `  (${m.candidateCount} tracker candidates)` : ""),
    );
  }
}

console.log("════════════════════════════════════════════════════════════════════");
console.log(" QB → tracker per-project attribution — match-rate report (seeded demo)");
console.log("════════════════════════════════════════════════════════════════════");
console.log(` tolerance: ±R${tolerance} (ex-VAT both sides) · normalizer: digits_no_leading_zeros`);
console.log(" attribution source: tracker line project_id only — QB is never trusted for project");

const revMatches = streamReport("REV", REV_QB, REV_TRACKER);
projectTable("REV", revMatches, REV_TRACKER);
const cosMatches = streamReport("COS", COS_QB, COS_TRACKER);
projectTable("COS", cosMatches, COS_TRACKER);

console.log("\n■ Company UNATTRIBUTED bucket (never force-assigned to a project):");
for (const stream of ["REV", "COS"] as const) {
  const b = computeUnattributed(stream, stream === "REV" ? revMatches : cosMatches);
  console.log(
    `  ${stream}: unmatched ${zar(b.unmatchedExVat)} (${b.unmatchedCount})  ·  ambiguous ${zar(b.ambiguousExVat)} (${b.ambiguousCount})`,
  );
}

console.log("\n■ Resolve WORKLIST (unmatched + ambiguous QB docs):");
worklist(revMatches);
worklist(cosMatches);
console.log("\n✓ Per-project QB shown WITH coverage; ambiguous/unmatched surfaced, never forced.\n");
