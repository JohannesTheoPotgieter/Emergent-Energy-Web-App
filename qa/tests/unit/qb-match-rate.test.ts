/**
 * QB invoice-number match-rate logic (chore/qb-match-rate-measure).
 *
 * Pure tests for the measurement helper that backs
 * server/scripts/measure-qb-match-rate.ts. No DB / no QuickBooks.
 */
import { describe, expect, it } from "vitest";

import {
  NORMALIZERS,
  aggregateByNormalized,
  computeMatchRate,
  findNearMisses,
  topUnmatchedByValue,
  type InvoiceRecord,
} from "../../../server/lib/finance/qb-match-rate";

describe("normalizer variants", () => {
  it("base mirrors normalizeInvoiceNumber (alnum + lowercase)", () => {
    expect(NORMALIZERS.base("INV-123 ")).toBe("inv123");
    expect(NORMALIZERS.base("abc/007")).toBe("abc007");
    expect(NORMALIZERS.base(null)).toBe("");
  });
  it("base_no_leading_zeros only strips zeros at the string start (so it helps pure-numeric numbers, not alpha-prefixed ones)", () => {
    expect(NORMALIZERS.base_no_leading_zeros("INV-007")).toBe("inv007"); // "inv007" has no leading zero
    expect(NORMALIZERS.base_no_leading_zeros("000123")).toBe("123");
  });
  it("digits_only strips alpha supplier prefixes", () => {
    expect(NORMALIZERS.digits_only("ACME-00123")).toBe("00123");
    expect(NORMALIZERS.digits_only("INV/2025/0042")).toBe("20250042");
  });
  it("digits_no_leading_zeros strips prefix and leading zeros", () => {
    expect(NORMALIZERS.digits_no_leading_zeros("ACME-00123")).toBe("123");
  });
  it("alnum_last8 keeps the last 8 alnum chars", () => {
    expect(NORMALIZERS.alnum_last8("SUPPLIERLONGPREFIX-12345678")).toBe("12345678");
    expect(NORMALIZERS.alnum_last8("inv12")).toBe("inv12");
  });
});

describe("aggregateByNormalized", () => {
  it("sums ex-VAT per normalized number and counts blanks separately", () => {
    const recs: InvoiceRecord[] = [
      { number: "INV-1", amountExVat: 100 },
      { number: "inv1", amountExVat: 50 }, // same key as INV-1 under base
      { number: null, amountExVat: 999 }, // blank → excluded from keys
      { number: "INV-2", amountExVat: 200 },
    ];
    const { byKey, blankCount, blankValue } = aggregateByNormalized(recs, NORMALIZERS.base);
    expect(byKey.get("inv1")?.amountExVat).toBe(150);
    expect(byKey.get("inv1")?.count).toBe(2);
    expect(byKey.get("inv2")?.amountExVat).toBe(200);
    expect(blankCount).toBe(1);
    expect(blankValue).toBe(999);
  });
});

// A small synthetic stream: 2 clean matches, 1 amount-variance, 1 tracker-only,
// 1 qb-only, and 1 near-miss (supplier prefix on the QB side).
const QB: InvoiceRecord[] = [
  { number: "INV-100", amountExVat: 1000 }, // matches tracker INV100
  { number: "INV-200", amountExVat: 2000 }, // matches tracker INV-200
  { number: "INV-300", amountExVat: 3000 }, // amount variance vs tracker 3050
  { number: "QB-ONLY-1", amountExVat: 7000 }, // qb only
  { number: "ACME-00500", amountExVat: 5000 }, // near-miss: tracker has "500"
];
const TRACKER: InvoiceRecord[] = [
  { number: "INV100", amountExVat: 1000 },
  { number: "INV-200", amountExVat: 2000.4 }, // within R1
  { number: "INV-300", amountExVat: 3050 }, // amount variance
  { number: "TRK-ONLY-1", amountExVat: 4000 }, // tracker only
  { number: "500", amountExVat: 5000 }, // near-miss vs ACME-00500
];

describe("computeMatchRate (base)", () => {
  const r = computeMatchRate("COS", QB, TRACKER, "base", 1);

  it("classifies matched / amount_variance / tracker_only / qb_only", () => {
    expect(r.matchedCount).toBe(2); // INV-100, INV-200
    expect(r.amountVarianceCount).toBe(1); // INV-300
    expect(r.trackerOnlyCount).toBe(2); // TRK-ONLY-1 + "500"
    expect(r.qbOnlyCount).toBe(2); // QB-ONLY-1 + "acme00500"
  });

  it("reports the MATCH RATE by value (matched value / tracker total)", () => {
    // matched tracker value = 1000 + 2000.4 = 3000.4 ; tracker total =
    // 1000 + 2000.4 + 3050 + 4000 + 5000 = 15050.4 → 19.94%
    expect(r.trackerTotalValue).toBeCloseTo(15050.4, 2);
    expect(r.matchedTrackerValue).toBeCloseTo(3000.4, 2);
    expect(r.trackerMatchRateByValue).toBeCloseTo(19.94, 1);
    // number-match (matched + amount variance) by value adds INV-300's 3050.
    expect(r.trackerNumberMatchRateByValue).toBeCloseTo(40.2, 1);
  });

  it("captures the amount-variance delta", () => {
    const av = r.rows.find((x) => x.status === "amount_variance");
    expect(av?.delta).toBeCloseTo(50, 2); // 3050 − 3000
  });
});

describe("looser normalizer recovers the supplier-prefix near-miss", () => {
  it("digits_no_leading_zeros lifts the match rate by recovering ACME-00500 ↔ 500", () => {
    const base = computeMatchRate("COS", QB, TRACKER, "base", 1);
    const loose = computeMatchRate("COS", QB, TRACKER, "digits_no_leading_zeros", 1);
    expect(loose.matchedCount).toBeGreaterThan(base.matchedCount);
    expect(loose.matchedTrackerValue).toBeGreaterThan(base.matchedTrackerValue);
  });

  it("findNearMisses surfaces exactly the base-missed pair the looser rule would match", () => {
    const near = findNearMisses(QB, TRACKER, "base", "digits_no_leading_zeros", 1, 10);
    expect(near.length).toBe(1);
    expect(near[0].trackerRaw).toContain("500");
    expect(near[0].qbRaw).toContain("ACME-00500");
    expect(near[0].amountDelta).toBe(0);
  });
});

describe("topUnmatchedByValue", () => {
  it("returns the highest-value unmatched on each side", () => {
    const r = computeMatchRate("COS", QB, TRACKER, "base", 1);
    expect(topUnmatchedByValue(r, "tracker", 1)[0].trackerAmount).toBe(5000); // "500"
    expect(topUnmatchedByValue(r, "qb", 1)[0].qbAmount).toBe(7000); // QB-ONLY-1
  });
});
