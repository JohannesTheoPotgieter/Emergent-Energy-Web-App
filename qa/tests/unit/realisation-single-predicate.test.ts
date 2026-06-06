/**
 * refactor/single-realisation-predicate — there is exactly ONE realisation
 * predicate (`isCanonicalCosRealised`, server/lib/finance/cos-realisation.ts),
 * and every COS surface now routes through it.
 *
 * This test pins the cross-screen guarantee the consolidation buys: for the same
 * lines, the realised COS computed via the FY-card / recon-grid path
 * (`deriveFinanceLinesFromRows` → `classifyBucket`) is identical to the COS-page
 * verdict (`isCanonicalCosRealised`, the same predicate its wrappers call).
 *
 * It also QUANTIFIES the value change the owner authorised: the categories whose
 * realised verdict moved when `classifyBucket` stopped using the simpler
 * invoice+colour gate.
 */

import { describe, expect, it } from "vitest";

import {
  deriveFinanceLinesFromRows,
  type FinanceLineActualsRowInput,
  type FinanceLineParentRowInput,
} from "../../../server/repositories/finance-line-level-repository";
import { isCanonicalCosRealised } from "../../../server/lib/finance/cos-realisation";

interface TestLine {
  id: number;
  actualTotal: number;
  invoiceNumber: string | null;
  invoiceDateFontColor: string | null;
  invoiceDateConfirmed: boolean | null;
  invoiceDate: string | null;
  cosStatusOverride: string | null;
  cosRealised: boolean | null;
  expectedBucket: "realised" | "committed" | "planned";
  /** What the OLD invoice+colour gate (pre-consolidation) would have said. */
  legacyBucket: "realised" | "committed" | "planned";
}

// Far-past / far-future invoice dates keep every case independent of the
// run-time clock (the future-month guard fires deterministically for 2099).
const LINES: TestLine[] = [
  { id: 1, actualTotal: 100, invoiceNumber: "INV-1", invoiceDateFontColor: "black", invoiceDateConfirmed: null, invoiceDate: "2020-03-15", cosStatusOverride: null, cosRealised: null, expectedBucket: "realised", legacyBucket: "realised" },
  { id: 2, actualTotal: 200, invoiceNumber: "INV-2", invoiceDateFontColor: "red", invoiceDateConfirmed: false, invoiceDate: "2020-03-15", cosStatusOverride: null, cosRealised: null, expectedBucket: "committed", legacyBucket: "committed" },
  { id: 3, actualTotal: 300, invoiceNumber: null, invoiceDateFontColor: null, invoiceDateConfirmed: null, invoiceDate: null, cosStatusOverride: null, cosRealised: null, expectedBucket: "planned", legacyBucket: "planned" },
  // Divergent categories the consolidation fixes:
  { id: 4, actualTotal: 400, invoiceNumber: null, invoiceDateFontColor: null, invoiceDateConfirmed: null, invoiceDate: null, cosStatusOverride: "COS REALISED", cosRealised: null, expectedBucket: "realised", legacyBucket: "planned" },
  { id: 5, actualTotal: 500, invoiceNumber: "INV-5", invoiceDateFontColor: "black", invoiceDateConfirmed: null, invoiceDate: "2020-03-15", cosStatusOverride: "COMMITTED", cosRealised: null, expectedBucket: "committed", legacyBucket: "realised" },
  { id: 6, actualTotal: 600, invoiceNumber: "TBC", invoiceDateFontColor: "black", invoiceDateConfirmed: null, invoiceDate: "2020-03-15", cosStatusOverride: null, cosRealised: null, expectedBucket: "committed", legacyBucket: "realised" },
  { id: 7, actualTotal: 700, invoiceNumber: null, invoiceDateFontColor: null, invoiceDateConfirmed: null, invoiceDate: null, cosStatusOverride: null, cosRealised: true, expectedBucket: "realised", legacyBucket: "planned" },
  { id: 8, actualTotal: 800, invoiceNumber: "INV-8", invoiceDateFontColor: "black", invoiceDateConfirmed: null, invoiceDate: "2099-12-31", cosStatusOverride: null, cosRealised: null, expectedBucket: "committed", legacyBucket: "realised" },
];

function toActual(l: TestLine): FinanceLineActualsRowInput {
  return {
    id: l.id,
    costLineId: l.id,
    projectId: 1,
    actualTotal: String(l.actualTotal),
    poNumber: null,
    invoiceNumber: l.invoiceNumber,
    invoiceDate: l.invoiceDate,
    invoiceDateFontColor: l.invoiceDateFontColor,
    invoiceDateConfirmed: l.invoiceDateConfirmed,
    financePaymentDate: null,
    description: null,
    qty: null,
    rate: null,
  };
}

function toParent(l: TestLine): FinanceLineParentRowInput {
  return {
    id: l.id,
    projectId: 1,
    categoryAllocationId: null,
    categoryKey: null,
    costCategory: null,
    description: null,
    budgetTotal: null,
    forecastPaymentDate: null,
    paidDate: null,
    paidDateConfirmed: null,
    amountExVat: String(l.actualTotal),
    invoiceDate: l.invoiceDate,
    invoiceNumber: l.invoiceNumber,
    poNumber: null,
    invoiceDateFontColor: l.invoiceDateFontColor,
    invoiceDateConfirmed: l.invoiceDateConfirmed,
    cosStatusOverride: l.cosStatusOverride,
    cosRealised: l.cosRealised,
  };
}

// Mirrors exactly what the COS-page wrappers (isCosRealisedCheck /
// isEffectivelyRealisedLocal in cos-control-routes.ts) pass the predicate.
function cosPageRealised(l: TestLine): boolean {
  return isCanonicalCosRealised({
    status: null,
    cosStatusOverride: l.cosStatusOverride,
    cosRealised: l.cosRealised,
    expenseInvoiceNumber: l.invoiceNumber,
    expenseInvoicedDate: l.invoiceDate,
    expensePoNumber: null,
    paymentDate: null,
    today: new Date().toISOString().slice(0, 10),
    invoiceDateFontColor: l.invoiceDateFontColor,
    invoiceDateConfirmed: l.invoiceDateConfirmed,
  });
}

describe("single realisation predicate — FY card / recon grid / COS page agree", () => {
  const lines = deriveFinanceLinesFromRows(LINES.map(toActual), LINES.map(toParent), []);
  const byId = new Map(lines.map((ln) => [ln.lineId, ln]));

  it("derives one line per input with the expected bucket", () => {
    expect(lines.length).toBe(LINES.length);
    for (const l of LINES) {
      expect(byId.get(l.id)?.bucket, `line ${l.id}`).toBe(l.expectedBucket);
    }
  });

  it("realised COS via the FY-card/recon-grid path == COS-page verdict, line-for-line", () => {
    for (const l of LINES) {
      const fyCardRealised = byId.get(l.id)?.bucket === "realised";
      expect(fyCardRealised, `line ${l.id}`).toBe(cosPageRealised(l));
    }
  });

  it("total realised COS is identical across the FY card and the COS page", () => {
    const fyCardRealisedTotal = lines
      .filter((ln) => ln.bucket === "realised")
      .reduce((s, ln) => s + Number(ln.actualTotal ?? 0), 0);
    const cosPageRealisedTotal = LINES.filter(cosPageRealised).reduce((s, l) => s + l.actualTotal, 0);

    expect(fyCardRealisedTotal).toBe(cosPageRealisedTotal);
    expect(fyCardRealisedTotal).toBe(100 + 400 + 700); // lines 1 (black), 4 (override), 7 (legacy)
  });
});

describe("quantified delta — categories whose realised verdict moved", () => {
  it("documents exactly which lines the consolidation changes vs the old invoice+colour gate", () => {
    const moved = LINES.filter((l) => l.expectedBucket !== l.legacyBucket).map((l) => l.id).sort();
    // 4: override-realised w/o invoice  planned → realised
    // 5: override-not-realised + black  realised → committed
    // 6: placeholder invoice + black    realised → committed
    // 7: legacy cosRealised flag        planned → realised
    // 8: black invoice in a future month realised → committed
    expect(moved).toEqual([4, 5, 6, 7, 8]);

    // Net realised-COS movement on this fixture: +400 +700 (gained) −500 −600 −800 (lost).
    const gained = LINES.filter((l) => l.expectedBucket === "realised" && l.legacyBucket !== "realised").reduce((s, l) => s + l.actualTotal, 0);
    const lost = LINES.filter((l) => l.legacyBucket === "realised" && l.expectedBucket !== "realised").reduce((s, l) => s + l.actualTotal, 0);
    expect(gained).toBe(1100);
    expect(lost).toBe(1900);
  });
});
