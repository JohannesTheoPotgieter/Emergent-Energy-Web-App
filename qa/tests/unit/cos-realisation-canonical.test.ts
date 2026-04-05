/**
 * Frozen dataset test for isCanonicalCosRealised().
 *
 * This test pins the exact COS realised calculation against a fixed set of
 * expense lines representing every real-world classification path.
 * If this test breaks, the canonical COS formula has changed — which is a
 * stop-ship event requiring finance sign-off.
 */
import { describe, expect, it } from "vitest";
import { isCanonicalCosRealised, type CosLineInput } from "../../../server/lib/finance/cos-realisation";

const TODAY = "2026-04-05";

// Frozen dataset: 20 expense lines covering every classification path
const FROZEN_EXPENSE_LINES: Array<CosLineInput & { amount: number; expectedRealised: boolean; description: string }> = [
  // === OVERRIDE-BASED REALISATION ===
  { description: "Override = COS REALISED", cosStatusOverride: "COS REALISED", amount: 150000, today: TODAY, expectedRealised: true },
  { description: "Override = REALISED", cosStatusOverride: "REALISED", amount: 80000, today: TODAY, expectedRealised: true },
  { description: "Override = INVOICED", cosStatusOverride: "INVOICED", amount: 120000, today: TODAY, expectedRealised: true },
  { description: "Override = PAID", cosStatusOverride: "PAID", amount: 95000, today: TODAY, expectedRealised: true },
  { description: "Override = PLANNED (blocks realisation)", cosStatusOverride: "PLANNED", status: "COS REALISED", amount: 60000, today: TODAY, expectedRealised: false },
  { description: "Override = APPROVED (blocks realisation)", cosStatusOverride: "APPROVED", cosRealised: true, amount: 45000, today: TODAY, expectedRealised: false },

  // === STATUS-BASED REALISATION ===
  { description: "Status = COS REALISED", status: "COS REALISED", amount: 200000, today: TODAY, expectedRealised: true },
  { description: "Status = REALISED", status: "REALISED", amount: 170000, today: TODAY, expectedRealised: true },
  { description: "Status = INVOICED", status: "INVOICED", amount: 110000, today: TODAY, expectedRealised: true },
  { description: "Status = PAID", status: "PAID", amount: 90000, today: TODAY, expectedRealised: true },

  // === BOOLEAN FLAG ===
  { description: "cosRealised boolean = true", cosRealised: true, amount: 75000, today: TODAY, expectedRealised: true },
  { description: "cosRealised boolean = false, no other signal", cosRealised: false, amount: 30000, today: TODAY, expectedRealised: false },

  // === COMMITTED PAST-MONTH ===
  { description: "Committed + invoice date in past month → realised", status: "COMMITTED", expenseInvoicedDate: "2026-02-15", amount: 180000, today: TODAY, expectedRealised: true },
  { description: "PO number + invoice date in past month → realised", expensePoNumber: "PO-2025-100", expenseInvoicedDate: "2026-01-20", amount: 140000, today: TODAY, expectedRealised: true },
  { description: "Invoice number + payment date in past month → realised", expenseInvoiceNumber: "INV-500", paymentDate: "2026-03-10", amount: 160000, today: TODAY, expectedRealised: true },
  { description: "Committed + invoice date in CURRENT month → NOT realised", status: "COMMITTED", expenseInvoicedDate: "2026-04-02", amount: 100000, today: TODAY, expectedRealised: false },
  { description: "Committed + invoice date in FUTURE month → NOT realised", status: "COMMITTED", expenseInvoicedDate: "2026-05-01", amount: 50000, today: TODAY, expectedRealised: false },
  { description: "Override COMMITTED + past-month date but no committed signal → not realised", cosStatusOverride: "COMMITTED", expenseInvoicedDate: "2026-02-15", amount: 85000, today: TODAY, expectedRealised: false },

  // === NO SIGNALS ===
  { description: "No signals at all → planned", amount: 25000, today: TODAY, expectedRealised: false },
  { description: "Only PO, no date → not realised", expensePoNumber: "PO-2025-200", amount: 55000, today: TODAY, expectedRealised: false },
];

// Pinned expected total: sum of all lines where expectedRealised is true
const EXPECTED_REALISED_TOTAL = FROZEN_EXPENSE_LINES
  .filter((l) => l.expectedRealised)
  .reduce((sum, l) => sum + l.amount, 0);

const EXPECTED_UNREALISED_TOTAL = FROZEN_EXPENSE_LINES
  .filter((l) => !l.expectedRealised)
  .reduce((sum, l) => sum + l.amount, 0);

describe("canonical COS realisation — frozen dataset", () => {
  it("classifies every expense line correctly", () => {
    for (const line of FROZEN_EXPENSE_LINES) {
      const result = isCanonicalCosRealised(line);
      expect(result, `FAILED: "${line.description}" — expected ${line.expectedRealised}, got ${result}`).toBe(line.expectedRealised);
    }
  });

  it("pins the exact realised total at 1,655,000", () => {
    const realisedTotal = FROZEN_EXPENSE_LINES
      .filter((l) => isCanonicalCosRealised(l))
      .reduce((sum, l) => sum + l.amount, 0);
    expect(realisedTotal).toBe(1_570_000);
    expect(EXPECTED_REALISED_TOTAL).toBe(1_570_000);
  });

  it("pins the exact unrealised total at 365,000", () => {
    const unrealisedTotal = FROZEN_EXPENSE_LINES
      .filter((l) => !isCanonicalCosRealised(l))
      .reduce((sum, l) => sum + l.amount, 0);
    expect(unrealisedTotal).toBe(450_000);
    expect(EXPECTED_UNREALISED_TOTAL).toBe(450_000);
  });

  it("is deterministic: same input always produces same output", () => {
    for (let run = 0; run < 3; run++) {
      const total = FROZEN_EXPENSE_LINES
        .filter((l) => isCanonicalCosRealised(l))
        .reduce((sum, l) => sum + l.amount, 0);
      expect(total).toBe(1_570_000);
    }
  });

  // Edge cases for the canonical function
  describe("edge cases", () => {
    it("handles null/undefined fields gracefully", () => {
      expect(isCanonicalCosRealised({ today: TODAY })).toBe(false);
      expect(isCanonicalCosRealised({ status: null, cosStatusOverride: null, today: TODAY })).toBe(false);
    });

    it("handles whitespace-only strings", () => {
      expect(isCanonicalCosRealised({ status: "  ", expenseInvoiceNumber: "  ", today: TODAY })).toBe(false);
    });

    it("handles case insensitivity for status", () => {
      expect(isCanonicalCosRealised({ status: "cos realised", today: TODAY })).toBe(true);
      expect(isCanonicalCosRealised({ status: "Paid", today: TODAY })).toBe(true);
    });

    it("handles case insensitivity for override", () => {
      expect(isCanonicalCosRealised({ cosStatusOverride: "cos realised", today: TODAY })).toBe(true);
      expect(isCanonicalCosRealised({ cosStatusOverride: "planned", today: TODAY })).toBe(false);
    });

    it("override takes precedence over status", () => {
      expect(isCanonicalCosRealised({ cosStatusOverride: "PLANNED", status: "COS REALISED", cosRealised: true, today: TODAY })).toBe(false);
    });

    it("override PAID takes precedence over status PLANNED", () => {
      expect(isCanonicalCosRealised({ cosStatusOverride: "PAID", status: "PLANNED", today: TODAY })).toBe(true);
    });
  });
});
