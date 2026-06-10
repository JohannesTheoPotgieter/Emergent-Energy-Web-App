/**
 * Build the independent golden line-item fixture the finance audits referenced
 * but never created: qa/fixtures/golden-trackers-5.json.
 *
 * Source of truth = the 5 downloaded trackers (08–09 June 2026, the same vintage
 * as the 08/06 dashboard oracle), read by the STANDALONE reader in
 * parse-tracker.ts. This script imports NO app importer or finance-derivation
 * code — only the standalone parser — so the fixture is a genuine oracle.
 *
 * Run:  npm run build:golden   (or: tsx qa/golden-oracle/build-fixture.ts)
 * Writes: qa/fixtures/golden-trackers-5.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseTracker, parseRevenueTracking, type ParseOpts } from "./parse-tracker";

const ROOT = process.cwd();
const CACHE = join(ROOT, "qa/golden-oracle/.cache");
const OUT = join(ROOT, "qa/fixtures/golden-trackers-5.json");

export const OPTS: ParseOpts = { asAt: "2026-06-08", fyStart: "2025-09-01", fyEnd: "2026-08-31" };

/** 08/06 dashboard oracle — realised REV / COS / GP per project. */
export const ORACLE: Record<number, { rev: number; cos: number; gp: number }> = {
  19: { rev: 50222621.62, cos: 46258307.86, gp: 3964313.76 },
  8: { rev: 13730976.65, cos: 10492741.49, gp: 3238235.16 },
  27: { rev: 10447228.82, cos: 7626862.68, gp: 2820366.13 },
  7: { rev: 5542316.91, cos: 4553804.89, gp: 988512.02 },
  39: { rev: 4499896.88, cos: 3734959.55, gp: 764937.33 },
};

/** Reconciliation tolerance (rands). */
export const R1 = 1;

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function buildFixture() {
  const manifest = JSON.parse(readFileSync(join(CACHE, "manifest.json"), "utf8"));
  const projects: any[] = [];

  for (const f of manifest.files) {
    const file = join(CACHE, f.savedAs);
    const eb = await parseTracker(
      file,
      { projectId: f.projectId, projectName: f.projectName, fileName: f.fileName },
      OPTS,
    );
    const rt = await parseRevenueTracking(file, OPTS);
    const o = ORACLE[f.projectId];
    if (!o) {
      throw new Error(
        `No ORACLE entry for project ${f.projectId} (${f.projectName}). ` +
          `Add its 08/06 realised REV/COS/GP to ORACLE before building the fixture.`,
      );
    }

    const cosDelta = round(eb.totals.realisedCos - o.cos);
    const revDelta = round(eb.totals.realisedRev - o.rev);
    const gpDelta = round(eb.totals.realisedGp - o.gp);

    projects.push({
      projectId: f.projectId,
      projectName: f.projectName,
      fileName: f.fileName,
      sheet: eb.sheet,
      asAt: eb.asAt,
      fyStart: eb.fyStart,
      fyEnd: eb.fyEnd,
      // Canonical independent reading from Expenditure Breakdown (Q/X)×J.
      expenditureBreakdown: {
        totals: {
          realisedRev: round(eb.totals.realisedRev),
          realisedCos: round(eb.totals.realisedCos),
          realisedGp: round(eb.totals.realisedGp),
          lineCount: eb.totals.lineCount,
          realisedCount: eb.totals.realisedCount,
        },
        categories: eb.categories.map((c) => ({
          number: c.number,
          name: c.name,
          X: round(c.X),
          J: c.J == null ? null : round(c.J),
          sheetX: c.sheetX == null ? null : round(c.sheetX),
          xMatchesSheet: c.sheetX == null ? null : Math.abs(c.X - c.sheetX) <= R1,
        })),
        monthly: Object.fromEntries(
          Object.entries(eb.monthly)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([m, v]) => [m, { rev: round(v.rev), cos: round(v.cos), gp: round(v.gp) }]),
        ),
        lines: eb.lines.map((l) => ({
          row: l.row,
          categoryNumber: l.categoryNumber,
          categoryName: l.categoryName,
          description: l.description,
          actualTotal: round(l.actualTotal),
          invoiceNumber: l.invoiceNumber,
          invoiceRaisedDate: l.invoiceRaisedDate,
          invoiceMonth: l.invoiceMonth,
          invoiceDateFontColor: l.invoiceDateFontColor,
          categoryTotalActualTotal: round(l.categoryTotalActualTotal),
          categoryRevenueAllocation: l.categoryRevenueAllocation == null ? null : round(l.categoryRevenueAllocation),
          perLineRevenue: round(l.perLineRevenue),
          perLineGp: round(l.perLineGp),
          bucket: l.bucket,
        })),
      },
      // Cross-surface: Revenue Tracking client-invoice milestones (secondary
      // independent check on revenue — see notes[] for why it is not canonical).
      revenueTracking: rt
        ? {
            sheet: rt.sheet,
            realisedRevenue: round(rt.realisedRevenue),
            realisedCount: rt.realisedCount,
            contractRevenue: round(rt.contractRevenue),
            monthly: Object.fromEntries(
              Object.entries(rt.monthly)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([m, v]) => [m, round(v)]),
            ),
            milestones: rt.milestones.map((m) => ({
              row: m.row,
              no: m.no,
              milestone: m.milestone,
              pct: m.pct,
              value: round(m.value),
              invoiceNumber: m.invoiceNumber,
              invoiceRaisedDate: m.invoiceRaisedDate,
              invoiceMonth: m.invoiceMonth,
              invoiceDateFontColor: m.invoiceDateFontColor,
              bucket: m.bucket,
            })),
          }
        : null,
      oracle: o,
      reconciliation: {
        cos: { golden: round(eb.totals.realisedCos), oracle: o.cos, delta: cosDelta, tie: Math.abs(cosDelta) <= R1 },
        rev: { golden: round(eb.totals.realisedRev), oracle: o.rev, delta: revDelta, tie: Math.abs(revDelta) <= R1 },
        gp: { golden: round(eb.totals.realisedGp), oracle: o.gp, delta: gpDelta, tie: Math.abs(gpDelta) <= R1 },
        revenueTrackingDelta: rt ? round(rt.realisedRevenue - o.rev) : null,
      },
    });
  }

  const fixture = {
    $schema: "golden-trackers-5/v1",
    description:
      "Independent line-item golden fixture for the 5 audit trackers. Built by a " +
      "standalone exceljs reader (qa/golden-oracle/parse-tracker.ts) that reimplements " +
      "the tracker maths and imports NO app importer or finance-derivation code. " +
      "READ-ONLY: no prod data was changed to produce this.",
    generatedAt: new Date().toISOString(),
    params: OPTS,
    reconciliationTolerance: R1,
    source: {
      driveId: manifest.driveId,
      downloadedAt: manifest.downloadedAt,
      files: manifest.files.map((f: any) => ({
        projectId: f.projectId,
        projectName: f.projectName,
        fileName: f.fileName,
        bytes: f.bytes,
        etag: f.etag,
      })),
    },
    trackerMaths: {
      X: "Σ Q (Actual Total, col Q) over every actual line in the category",
      J: "category revenue allocation (Expenditure Breakdown COSTED pane col J)",
      perLineRevenue: "(Q / X) × J",
      realised:
        "invoice present (non-placeholder) ∧ invoice-date font colour ≠ red ∧ Q ≠ 0 " +
        "∧ invoice-date in FY window ∧ invoice-month ≤ as-at month",
      realisedCos: "Σ Q over realised lines",
      realisedRev: "Σ perLineRevenue over realised lines",
      gp: "realisedRev − realisedCos",
    },
    residuals: [
      "COS reconciles strongly: De Drift ties to R1 (Δ≈0); Mondi and Seshego within ~1%; " +
        "Coega (+~448k) and Unitrans (+~60k) carry larger residuals (Coega's Expenditure " +
        "Breakdown has duplicate/VO blocks worth a deeper line audit).",
      "REV does NOT tie exactly from any single raw tracker surface, and this is a real " +
        "audit finding rather than a parser bug. The 08/06 oracle's realised revenue is a " +
        "prod-derived blend that cannot be reconstructed from the workbook alone because: " +
        "(a) the app's category_revenue_allocations (col J) is EMPTY for some projects " +
        "(e.g. De Drift — every category revenue_allocation is NULL in prod, even on the " +
        "08/06 snapshot), so its dashboard revenue is sourced elsewhere; and (b) the prod " +
        "realised set is promoted by QuickBooks evidence and admin overrides that the raw " +
        "invoice-date font colour cannot see.",
      "Two independent REV surfaces are therefore recorded per project: the canonical " +
        "Expenditure Breakdown (Q/X)×J figure (expenditureBreakdown.totals.realisedRev) and " +
        "the Revenue Tracking client-invoice milestone figure (revenueTracking.realisedRevenue). " +
        "Neither ties the oracle universally; the closer surface differs by project " +
        "(Revenue Tracking is within ~0.2% for Seshego and ~1% for Unitrans/Mondi; " +
        "(Q/X)×J is closer for De Drift).",
      "Per-project oracle deltas are recorded in each project's reconciliation{} block; " +
        "verify:golden re-checks the fixture against live prod (read-only) and names every " +
        "per-line and per-project mismatch + orphan in qa/reports/golden-vs-prod.csv.",
    ],
    projects,
  };

  mkdirSync(join(ROOT, "qa/fixtures"), { recursive: true });
  writeFileSync(OUT, JSON.stringify(fixture, null, 2) + "\n");
  return { fixture, outPath: OUT };
}

// Execute when run directly.
buildFixture()
  .then(({ fixture, outPath }) => {
    console.log(`✓ wrote ${outPath}`);
    for (const p of fixture.projects) {
      const r = p.reconciliation;
      console.log(
        `  ${p.projectName.padEnd(22)} ` +
          `COS Δ=${String(r.cos.delta).padStart(12)} ${r.cos.tie ? "TIE" : "   "}  ` +
          `REV Δ=${String(r.rev.delta).padStart(12)}  ` +
          `RT Δ=${String(r.revenueTrackingDelta).padStart(12)}`,
      );
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
