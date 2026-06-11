/**
 * Drill-down invariant proof — against the 5 golden trackers.
 *
 * Acceptance criterion #3: at every level of the REV/COS/GP drill,
 * `sum(children) === parent` within R1, and each leaf invoice ties to the
 * golden line value. This test feeds the independent golden fixture
 * (`qa/fixtures/golden-trackers-5.json`, built by a standalone exceljs reader
 * that imports NO app finance code) through the SAME pure aggregator the
 * route uses (`buildRevCosGpTree`) and asserts:
 *
 *   1. `findSumViolations(tree) === []` for all 5 projects (children sum to
 *      parent within R1 at FY → month → project → category → invoice).
 *   2. Every invoice leaf's COS / revenue / GP equals the golden line value.
 *   3. The FY-root realised split ties to the fixture's realised totals.
 *   4. Each golden line's revenue equals the canonical (Q/X)×J — proving the
 *      leaf values are the canonical formula output, not a re-implementation.
 *
 * Pure / in-memory — no database, so it runs under `npm run test`. (The
 * DB-backed `verify:finance` / `verify:golden` gates run against Postgres /
 * prod-RO per S7/S9.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildRevCosGpTree,
  findSumViolations,
  type DrillBucket,
  type DrillLineInput,
  type DrillNode,
} from "../../../server/lib/finance/finance-drilldown";

const R1 = 1;
const near = (a: number, b: number, tol = R1): boolean => Math.abs(a - b) <= tol;

interface GoldenLine {
  row: number;
  categoryNumber: number | string | null;
  categoryName: string | null;
  description: string | null;
  actualTotal: number;
  invoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  invoiceMonth: string | null;
  invoiceDateFontColor: string | null;
  categoryTotalActualTotal: number;
  categoryRevenueAllocation: number;
  perLineRevenue: number;
  perLineGp: number;
  bucket: string;
}

interface GoldenProject {
  projectId: number;
  projectName: string;
  fyStart: string;
  fyEnd: string;
  expenditureBreakdown: {
    totals: { realisedRev: number; realisedCos: number; realisedGp: number };
    lines: GoldenLine[];
  };
}

interface GoldenFixture {
  params: { fyStart: string; fyEnd: string; asAt: string };
  projects: GoldenProject[];
}

const fixture: GoldenFixture = JSON.parse(
  readFileSync(join(process.cwd(), "qa/fixtures/golden-trackers-5.json"), "utf8"),
);

const inWindow = (iso: string | null, start: string, end: string): boolean =>
  !!iso && iso >= start && iso <= end;

/** Map a fixture bucket label onto the drill bucket. Only "realised" is
 * special (BLACK/confirmed); everything else is forecast for the split. */
const toDrillBucket = (b: string): DrillBucket =>
  b === "realised" ? "realised" : b === "planned" ? "planned" : "committed";

/** Build the drill leaves for a project from its in-window golden lines.
 * Leaf COS/revenue/GP come straight from the golden line (the leaf is the
 * canonical per-line value — the drill never recomputes it). */
function leavesFor(p: GoldenProject): { leaves: DrillLineInput[]; byId: Map<number, GoldenLine> } {
  const leaves: DrillLineInput[] = [];
  const byId = new Map<number, GoldenLine>();
  p.expenditureBreakdown.lines.forEach((l, i) => {
    if (!inWindow(l.invoiceRaisedDate, p.fyStart, p.fyEnd)) return;
    const lineId = i + 1;
    byId.set(lineId, l);
    const catNo = l.categoryNumber == null ? null : Number(l.categoryNumber);
    leaves.push({
      lineId,
      parentLineId: l.row,
      projectId: p.projectId,
      categoryAllocationId: catNo != null && Number.isFinite(catNo) ? catNo : null,
      categoryKey: l.categoryName ?? (catNo != null ? String(catNo) : null),
      categoryName: l.categoryName,
      categoryNumber: catNo != null ? String(catNo) : null,
      descriptionOfWork: l.description,
      actualTotal: l.actualTotal,
      perLineRevenue: l.perLineRevenue,
      perLineGp: l.perLineGp,
      invoiceNumber: l.invoiceNumber,
      invoiceRaisedDate: l.invoiceRaisedDate,
      poNumber: null,
      recognitionMonth: l.invoiceMonth,
      bucket: toDrillBucket(l.bucket),
    });
  });
  return { leaves, byId };
}

function collectLeaves(node: DrillNode, out: DrillNode[] = []): DrillNode[] {
  if (node.level === "invoice") {
    out.push(node);
    return out;
  }
  for (const c of node.children ?? []) collectLeaves(c, out);
  return out;
}

describe("finance drill-down — golden invariant (5 trackers)", () => {
  it("fixture loaded with the expected 5 golden projects", () => {
    expect(fixture.projects.length).toBe(5);
  });

  for (const p of fixture.projects) {
    describe(`${p.projectName} (#${p.projectId})`, () => {
      const { leaves, byId } = leavesFor(p);
      const tree = buildRevCosGpTree(leaves, {
        fyLabel: "FY (golden)",
        projectLabels: new Map([[p.projectId, p.projectName]]),
        includeInvoices: true,
      });

      it("children sum to parent within R1 at every level", () => {
        const violations = findSumViolations(tree, R1);
        expect(violations, JSON.stringify(violations.slice(0, 5), null, 2)).toEqual([]);
      });

      it("FY root totals equal the sum of all in-window leaves", () => {
        const sumCos = leaves.reduce((a, l) => a + l.actualTotal, 0);
        const sumRev = leaves.reduce((a, l) => a + l.perLineRevenue, 0);
        const sumGp = leaves.reduce((a, l) => a + l.perLineGp, 0);
        expect(near(tree.cos, sumCos)).toBe(true);
        expect(near(tree.revenue, sumRev)).toBe(true);
        expect(near(tree.gp, sumGp)).toBe(true);
      });

      it("every invoice leaf ties to its golden line value", () => {
        const treeLeaves = collectLeaves(tree);
        expect(treeLeaves.length).toBe(leaves.length);
        for (const leaf of treeLeaves) {
          const gold = byId.get(leaf.lineId ?? -1);
          expect(gold, `leaf ${leaf.lineId} has a golden line`).toBeDefined();
          if (!gold) continue;
          expect(near(leaf.cos, gold.actualTotal), `COS leaf ${leaf.lineId}`).toBe(true);
          expect(near(leaf.revenue, gold.perLineRevenue), `REV leaf ${leaf.lineId}`).toBe(true);
          expect(near(leaf.gp, gold.perLineGp), `GP leaf ${leaf.lineId}`).toBe(true);
        }
      });

      it("realised split ties to the golden realised totals", () => {
        const t = p.expenditureBreakdown.totals;
        // Σ over the golden realised lines (the realised set is a subset of
        // the in-window lines, so summing realised leaves reproduces it).
        const realised = leaves.filter((l) => l.bucket === "realised");
        const rCos = realised.reduce((a, l) => a + l.actualTotal, 0);
        const rRev = realised.reduce((a, l) => a + l.perLineRevenue, 0);
        const rGp = realised.reduce((a, l) => a + l.perLineGp, 0);

        // (i) the aggregator's realised split equals Σ realised leaves
        expect(near(tree.realised.cos, rCos)).toBe(true);
        expect(near(tree.realised.revenue, rRev)).toBe(true);
        expect(near(tree.realised.gp, rGp)).toBe(true);

        // (ii) and that ties to the independent golden totals (tie-to-golden)
        expect(near(tree.realised.cos, t.realisedCos)).toBe(true);
        expect(near(tree.realised.revenue, t.realisedRev)).toBe(true);
        expect(near(tree.realised.gp, t.realisedGp)).toBe(true);
      });

      it("each golden line's revenue equals the canonical (Q/X)×J", () => {
        // Proves the leaf values the drill surfaces ARE the § 3.3 formula
        // output, not a parallel calculation. Uses the fixture's own X (col X)
        // and J (col J), so it is independent of any re-summing.
        for (const [, gold] of byId) {
          const X = gold.categoryTotalActualTotal;
          const J = gold.categoryRevenueAllocation;
          if (!X || X === 0) {
            expect(near(gold.perLineRevenue, 0)).toBe(true);
            continue;
          }
          const expected = (gold.actualTotal / X) * J;
          expect(near(gold.perLineRevenue, expected), `line row ${gold.row}`).toBe(true);
        }
      });
    });
  }
});
