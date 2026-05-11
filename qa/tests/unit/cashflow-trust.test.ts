import { describe, it, expect } from "vitest";
import { computeDateShiftDays, isQbDivergent, isRowStale } from "./cashflow-trust-helpers";
import { effectiveAllocatedAmountExVat } from "@shared/config/qb-allocations";

// ---------------------------------------------------------------------------
// Pure helpers tested here (no DOM, no server, no DB).
// ---------------------------------------------------------------------------

describe("isRowStale", () => {
  it("flags a row whose lastImportedAt is >7 days old", () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(isRowStale(old)).toBe(true);
  });

  it("does not flag a row imported <7 days ago", () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(isRowStale(recent)).toBe(false);
  });

  it("returns true for null / missing lastImportedAt", () => {
    expect(isRowStale(null)).toBe(true);
    expect(isRowStale(undefined)).toBe(true);
  });

  it("returns true for the string 'unknown'", () => {
    expect(isRowStale("unknown")).toBe(true);
    expect(isRowStale("Unknown")).toBe(true);
  });
});

describe("computeDateShiftDays", () => {
  it("returns positive days when date moved later", () => {
    expect(computeDateShiftDays("2026-04-01", "2026-04-22")).toBe(21);
  });

  it("returns negative days when date moved earlier", () => {
    expect(computeDateShiftDays("2026-04-22", "2026-04-01")).toBe(-21);
  });

  it("returns null when either value is missing", () => {
    expect(computeDateShiftDays(null, "2026-04-01")).toBeNull();
    expect(computeDateShiftDays("2026-04-01", null)).toBeNull();
  });

  it("returns null for non-date strings", () => {
    expect(computeDateShiftDays("not-a-date", "2026-04-01")).toBeNull();
  });
});

describe("isQbDivergent", () => {
  it("flags Mondi: app R5.7M vs QB R3.5M", () => {
    expect(isQbDivergent(5_700_000, 3_500_000)).toBe(true);
  });

  it("flags 261 Bree: app R73K vs QB R30K", () => {
    expect(isQbDivergent(73_000, 30_000)).toBe(true);
  });

  it("does not flag divergence within R100", () => {
    expect(isQbDivergent(10_000, 10_050)).toBe(false);
  });

  it("returns false when QB amount is null (no match)", () => {
    expect(isQbDivergent(10_000, null)).toBe(false);
  });

  it("suppresses divergence when taxUncertain is true", () => {
    // Mondi-sized gap but QB VAT info is absent — badge should NOT fire.
    expect(isQbDivergent(5_700_000, 3_500_000, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bidirectional divergence — App→QB uses allocatedAmountExVat, QB→App uses
// the full bill/invoice total. effectiveAllocatedAmountExVat handles both
// the post-Task-#142 (explicit allocated slice) and legacy (qbAmount = 100%)
// link shapes.
// ---------------------------------------------------------------------------

describe("qbDivergence — bidirectional linking", () => {
  it("App→QB explicit link: diverges against allocated slice, not QB bill total", () => {
    // Mondi R700k + 261 Bree R300k both linked to the same QB bill of R1M.
    // Each link has allocatedAmountExVat = their slice.
    const mondiLink = { allocatedAmountExVat: "700000", qbAmount: "1000000" };
    const breeLink  = { allocatedAmountExVat: "300000", qbAmount: "1000000" };

    // Mondi app amount matches its allocated slice → no divergence.
    expect(isQbDivergent(700_000, effectiveAllocatedAmountExVat(mondiLink))).toBe(false);
    // 261 Bree app amount matches its slice → no divergence.
    expect(isQbDivergent(300_000, effectiveAllocatedAmountExVat(breeLink))).toBe(false);
    // If we had mistakenly compared against the full QB total (R1M) instead,
    // both would wrongly show divergence:
    expect(isQbDivergent(700_000, 1_000_000)).toBe(true);
  });

  it("App→QB explicit link: flags genuine divergence on the allocated slice", () => {
    // App says R800k but the approved allocation was R700k → real problem.
    const link = { allocatedAmountExVat: "700000", qbAmount: "1000000" };
    expect(isQbDivergent(800_000, effectiveAllocatedAmountExVat(link))).toBe(true);
  });

  it("QB→App heuristic match: compares against full QB total (1:1 assumed)", () => {
    // No explicit link — heuristic picked up the QB invoice.
    // App R73k vs QB total R73k → no divergence.
    expect(isQbDivergent(73_000, 73_000)).toBe(false);
    // App R73k vs QB total R30k → divergence.
    expect(isQbDivergent(73_000, 30_000)).toBe(true);
  });

  it("legacy link (pre-Task-#142): effectiveAllocatedAmountExVat falls back to qbAmount", () => {
    // Pre-#142 rows have allocatedAmountExVat = 0 but qbAmount carries the value.
    const legacyLink = { allocatedAmountExVat: "0", qbAmount: "500000" };
    expect(effectiveAllocatedAmountExVat(legacyLink)).toBe(500_000);
    expect(isQbDivergent(500_000, effectiveAllocatedAmountExVat(legacyLink))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// paymentTermsMissing logic — tests the rule that drives the "No terms" badge.
// Rule: a row fires when computedState is Committed or Invoiced AND there is
// no forecastPaymentDate. Supplier lookup (counterpartyId) is irrelevant —
// the payment terms formula lives in Excel.
// ---------------------------------------------------------------------------

function paymentTermsMissing(row: { computedState: string; forecastPaymentDate: string | null }): boolean {
  return (row.computedState === "Committed" || row.computedState === "Invoiced") && !row.forecastPaymentDate;
}

describe("paymentTermsMissing", () => {
  it("fires for Mondi Committed row with no forecast date", () => {
    expect(paymentTermsMissing({ computedState: "Committed", forecastPaymentDate: null })).toBe(true);
  });

  it("fires for 261 Bree Invoiced row with no forecast date", () => {
    expect(paymentTermsMissing({ computedState: "Invoiced", forecastPaymentDate: null })).toBe(true);
  });

  it("does not fire when forecast date is present", () => {
    expect(paymentTermsMissing({ computedState: "Committed", forecastPaymentDate: "2026-06-15" })).toBe(false);
    expect(paymentTermsMissing({ computedState: "Invoiced", forecastPaymentDate: "2026-07-01" })).toBe(false);
  });

  it("does not fire for Planned rows (no PO / invoice yet)", () => {
    expect(paymentTermsMissing({ computedState: "Planned", forecastPaymentDate: null })).toBe(false);
  });

  it("does not fire for Paid rows even without forecast date", () => {
    expect(paymentTermsMissing({ computedState: "Paid", forecastPaymentDate: null })).toBe(false);
  });
});
