/**
 * Derived-vs-stored exposure — pure summarise/format helpers (Coega fixture).
 *
 * Proves the read-only exposure maths in server/scripts/measure-derived-vs-stored.ts
 * without a database: it folds the SAME canonical derivations the live script
 * uses (deriveFinanceLinesFromRows for REPORTED — prefers col U; and
 * computeProvenanceUpdates for DERIVED — strict § 3.3) into per (project × fiscal
 * period) buckets, and counts the lines + sums the revenue/GP that WOULD change
 * if reporting switched to the formula.
 *
 * Fixture: one project, one category (J = R1,000,000), two cost lines whose
 * actual_total (col Q) sum to the category total X = R1,000,000:
 *   - Line A (R600,000) carries a pasted col-U of R700,000 — overstated vs the
 *     R600,000 the formula derives. Reported = 700,000, derived = 600,000 →
 *     the line WOULD change by −R100,000.
 *   - Line B (R400,000) carries no col-U — reported == derived == R400,000 → no
 *     change. col U on A does NOT move X (X is summed from col Q), so B is
 *     unaffected.
 * Σ derived per category = 600,000 + 400,000 = R1,000,000 = J (col J).
 */

import { describe, expect, it } from "vitest";

import {
  computeProvenanceUpdates,
  RECON_DELTA_R1,
} from "../../../server/lib/finance/provenance";
import {
  deriveFinanceLinesFromRows,
  type FinanceLineActualsRowInput,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../../../server/repositories/finance-line-level-repository";
import {
  formatExposureCsv,
  summariseExposure,
  type ExposureLine,
} from "../../../server/scripts/measure-derived-vs-stored";

const PROJECT_ID = 999;

const allocations: FinanceLineAllocationRowInput[] = [
  {
    id: 201,
    projectId: PROJECT_ID,
    categoryKey: "1. panels",
    categoryName: "Panels",
    categoryNumber: "1",
    revenueAllocation: "1000000.00",
  },
];

const parents: FinanceLineParentRowInput[] = [
  {
    id: 1,
    projectId: PROJECT_ID,
    categoryAllocationId: 201,
    categoryKey: "1. panels",
    costCategory: "1. panels",
    description: "cost line 1",
    budgetTotal: null,
    forecastPaymentDate: null,
    paidDate: null,
    paidDateConfirmed: null,
  },
  {
    id: 2,
    projectId: PROJECT_ID,
    categoryAllocationId: 201,
    categoryKey: "1. panels",
    costCategory: "1. panels",
    description: "cost line 2",
    budgetTotal: null,
    forecastPaymentDate: null,
    paidDate: null,
    paidDateConfirmed: null,
  },
];

// Line A: col Q = 600,000, pasted col U = 700,000 (overstated).
// Line B: col Q = 400,000, no col U.
const actuals: FinanceLineActualsRowInput[] = [
  {
    id: 11,
    costLineId: 1,
    projectId: PROJECT_ID,
    actualTotal: "600000.00",
    poNumber: null,
    invoiceNumber: "INV-A",
    invoiceDate: "2026-01-15",
    invoiceDateFontColor: "black",
    invoiceDateConfirmed: true,
    financePaymentDate: null,
    description: "actual A",
    qty: null,
    rate: null,
    revenueRecognitionAmount: "700000.00",
  },
  {
    id: 12,
    costLineId: 2,
    projectId: PROJECT_ID,
    actualTotal: "400000.00",
    poNumber: null,
    invoiceNumber: "INV-B",
    invoiceDate: "2026-02-15",
    invoiceDateFontColor: "black",
    invoiceDateConfirmed: true,
    financePaymentDate: null,
    description: "actual B",
    qty: null,
    rate: null,
    // no revenueRecognitionAmount (col U) — reported falls through to derived.
  },
];

/** Build the pure ExposureLine[] exactly as the script's main() does, but with a
 *  fixed two-period fiscal calendar instead of a DB lookup. */
function buildExposureLines(): ExposureLine[] {
  const reported = deriveFinanceLinesFromRows(actuals, parents, allocations);
  const reportedById = new Map(reported.map((l) => [l.lineId, l]));
  const derived = computeProvenanceUpdates(actuals, parents, allocations);
  const derivedById = new Map(derived.map((u) => [u.id, Number(u.revenueDerived)]));

  // Map invoice month → a labelled period so the breakdown splits A (Jan) from
  // B (Feb), exercising the per-period bucketing.
  const periodFor = (month: string | null): { label: string; sortKey: string } => {
    if (month === "2026-01") return { label: "FY26 · Jan", sortKey: "2026-01-01" };
    if (month === "2026-02") return { label: "FY26 · Feb", sortKey: "2026-02-01" };
    return { label: "(unrecognised)", sortKey: "9999-99" };
  };

  const lines: ExposureLine[] = [];
  for (const a of actuals) {
    const r = reportedById.get(a.id)!;
    const fp = periodFor(r.recognitionMonth);
    lines.push({
      projectId: a.projectId,
      fiscalPeriod: fp.label,
      fiscalSortKey: fp.sortKey,
      reportedRevenue: r.perLineRevenue,
      derivedRevenue: derivedById.get(a.id) ?? 0,
      cost: r.actualTotal,
    });
  }
  return lines;
}

describe("Derived-vs-stored exposure — Coega fixture", () => {
  it("Σ derived per category equals category J within R1", () => {
    const derived = computeProvenanceUpdates(actuals, parents, allocations);
    const sum = derived.reduce((s, u) => s + Number(u.revenueDerived), 0);
    expect(Math.abs(sum - 1_000_000)).toBeLessThanOrEqual(RECON_DELTA_R1);
  });

  it("buckets revenue/GP exposure by project × fiscal period", () => {
    const { buckets, totals } = summariseExposure(buildExposureLines());

    // Two periods, sorted Jan before Feb.
    expect(buckets.map((b) => b.fiscalPeriod)).toEqual(["FY26 · Jan", "FY26 · Feb"]);

    const jan = buckets[0];
    expect(jan.linesTotal).toBe(1);
    expect(jan.linesChanged).toBe(1); // |600k − 700k| > R1
    expect(jan.revenueReported).toBeCloseTo(700_000, 2);
    expect(jan.revenueDerived).toBeCloseTo(600_000, 2);
    expect(jan.gpReported).toBeCloseTo(100_000, 2); // 700k − 600k cost
    expect(jan.gpDerived).toBeCloseTo(0, 2); // 600k − 600k cost

    const feb = buckets[1];
    expect(feb.linesTotal).toBe(1);
    expect(feb.linesChanged).toBe(0); // no col U → reported == derived
    expect(feb.revenueReported).toBeCloseTo(400_000, 2);
    expect(feb.revenueDerived).toBeCloseTo(400_000, 2);

    // Totals: one materially-changed line; the formula would move revenue AND GP
    // down by R100,000 (COS unchanged, so ΔGP ≡ Δrevenue).
    expect(totals.linesTotal).toBe(2);
    expect(totals.linesChanged).toBe(1);
    expect(totals.revenueReported).toBeCloseTo(1_100_000, 2);
    expect(totals.revenueDerived).toBeCloseTo(1_000_000, 2);
    expect(totals.revenueDerived - totals.revenueReported).toBeCloseTo(-100_000, 2);
    expect(totals.gpDerived - totals.gpReported).toBeCloseTo(-100_000, 2);
  });

  it("formats a CSV with a header, per-bucket rows and a TOTAL row", () => {
    const { buckets, totals } = summariseExposure(buildExposureLines());
    const csv = formatExposureCsv(buckets, totals, new Map([[PROJECT_ID, "Coega"]]));
    const rows = csv.trim().split("\n");

    expect(rows[0]).toBe(
      "project_id,project_name,fiscal_period,lines_total,lines_changed," +
        "revenue_reported,revenue_derived,revenue_delta,gp_reported,gp_derived,gp_delta",
    );
    expect(rows).toHaveLength(1 + buckets.length + 1); // header + 2 buckets + TOTAL
    // TOTAL row carries the portfolio shift: −100,000 revenue and GP.
    const total = rows[rows.length - 1].split(",");
    expect(total[0]).toBe("TOTAL");
    expect(total[4]).toBe("1"); // lines_changed
    expect(total[7]).toBe("-100000.00"); // revenue_delta
    expect(total[10]).toBe("-100000.00"); // gp_delta
  });
});
