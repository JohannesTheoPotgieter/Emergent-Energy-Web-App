/**
 * R1 "move period" recognition-override + R6 re-import regression.
 *
 * Proves, at the canonical § 3.3 derivation (the single read path), that:
 *   1. a recognition-date override on the parent line wins over the imported
 *      invoice date for the recognition MONTH (the line moves), while
 *   2. the per-line revenue / GP FORMULA is unchanged (move ≠ recalculation),
 *   3. a re-import that refreshes the imported invoice_date does NOT pull the
 *      line back to the old month — the override still wins (R6: the old value
 *      cannot be silently resurrected), and
 *   4. clearing the override returns the line to its imported month.
 */
import { describe, it, expect } from "vitest";
import {
  deriveFinanceLinesFromRows,
  type FinanceLineActualsRowInput,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../../../server/repositories/finance-line-level-repository";

const PROJECT = 101;
const ALLOC = 1;

const allocations: FinanceLineAllocationRowInput[] = [
  {
    id: ALLOC,
    projectId: PROJECT,
    categoryKey: "1. Panels",
    categoryName: "Panels",
    categoryNumber: "1",
    revenueAllocation: "50000",
  },
];

/** Build the one-line fixture with a given imported invoice date and an
 *  optional recognition-date override on the parent. */
function deriveOne(opts: {
  importedInvoiceDate: string;
  recognitionDateOverride?: string | null;
}) {
  const parents: FinanceLineParentRowInput[] = [
    {
      id: 1,
      projectId: PROJECT,
      categoryAllocationId: ALLOC,
      categoryKey: "1. Panels",
      costCategory: "Panels",
      description: "1.1 Panel supply",
      budgetTotal: "8000",
      forecastPaymentDate: null,
      paidDate: null,
      paidDateConfirmed: null,
      recognitionDateOverride: opts.recognitionDateOverride ?? null,
    },
  ];
  const actuals: FinanceLineActualsRowInput[] = [
    {
      id: 1,
      costLineId: 1,
      projectId: PROJECT,
      actualTotal: "8000",
      poNumber: "PO-1",
      invoiceNumber: "INV-1",
      invoiceDate: opts.importedInvoiceDate,
      financePaymentDate: null,
      description: "1.1 Panel supply",
      qty: "10",
      rate: "800",
    },
  ];
  const [linha] = deriveFinanceLinesFromRows(actuals, parents, allocations);
  return linha;
}

describe("§ 3.3 recognition-date override (R1 move period)", () => {
  it("buckets on the imported invoice date when there is no override", () => {
    const line = deriveOne({ importedInvoiceDate: "2026-01-20" });
    expect(line.recognitionMonth).toBe("2026-01");
    expect(line.recognitionDateOverride).toBeNull();
  });

  it("moves the recognition month to the override, leaving the formula untouched", () => {
    const baseline = deriveOne({ importedInvoiceDate: "2026-01-20" });
    const moved = deriveOne({
      importedInvoiceDate: "2026-01-20",
      recognitionDateOverride: "2026-03-01",
    });

    // Moved to March...
    expect(moved.recognitionMonth).toBe("2026-03");
    expect(moved.recognitionDateOverride).toBe("2026-03-01");
    expect(moved.invoiceRaisedDate).toBe("2026-03-01");

    // ...but the revenue / GP numbers are identical (no recalculation).
    expect(moved.perLineRevenue).toBe(baseline.perLineRevenue);
    expect(moved.perLineGp).toBe(baseline.perLineGp);
    expect(moved.actualTotal).toBe(baseline.actualTotal);
    expect(baseline.perLineRevenue).toBe(50000); // (8000/8000)*50000
  });
});

describe("R6 — re-import cannot resurrect the old month", () => {
  it("keeps the moved month after a re-import refreshes the imported invoice date", () => {
    // Line was moved to March; a later import re-stamps the imported invoice
    // date (still January, possibly a different day). The override must win.
    const afterReimport = deriveOne({
      importedInvoiceDate: "2026-01-25", // import refreshed Jan 20 -> Jan 25
      recognitionDateOverride: "2026-03-01",
    });
    expect(afterReimport.recognitionMonth).toBe("2026-03");
    expect(afterReimport.recognitionDateOverride).toBe("2026-03-01");
  });

  it("returns to the imported month only when the override is explicitly cleared", () => {
    const cleared = deriveOne({
      importedInvoiceDate: "2026-01-25",
      recognitionDateOverride: null,
    });
    expect(cleared.recognitionMonth).toBe("2026-01");
    expect(cleared.recognitionDateOverride).toBeNull();
  });
});
