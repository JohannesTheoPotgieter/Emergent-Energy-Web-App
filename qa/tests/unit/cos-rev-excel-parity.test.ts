import { describe, expect, it } from "vitest";
import { getCosEffectiveDateAndSource } from "../../../server/lib/expense-row-selector";
import {
  aggregateLinesByMonth,
  deriveFinanceLinesFromRows,
  synthesizeActualsForParents,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../../../server/repositories/finance-line-level-repository";

describe("COS/REV Excel parity", () => {
  it("uses invoice raised date for COS/REV month even when an admin date override exists", () => {
    const result = getCosEffectiveDateAndSource({
      adminDateOverride: "2026-06-30",
      expenseInvoicedDate: "2026-05-31",
    });

    expect(result).toEqual({
      date: "2026-05-31",
      source: "expenseInvoicedDate",
    });
  });

  it("does not bucket no-invoice parent lines into actual COS/REV months using forecast date", () => {
    const allocations: FinanceLineAllocationRowInput[] = [
      {
        id: 1,
        projectId: 99,
        categoryKey: "1. Panels",
        categoryName: "Panels",
        categoryNumber: "1",
        revenueAllocation: "100000",
        budgetTotal: "100000",
      },
    ];
    const parents: FinanceLineParentRowInput[] = [
      {
        id: 10,
        projectId: 99,
        categoryAllocationId: 1,
        categoryKey: "1. Panels",
        costCategory: "Panels",
        description: "forecast only",
        budgetTotal: "100000",
        forecastPaymentDate: "2026-05-31",
        paidDate: null,
        paidDateConfirmed: null,
        amountExVat: "100000",
        invoiceDate: null,
        invoiceNumber: null,
        poNumber: null,
      },
    ];

    const lines = deriveFinanceLinesFromRows(
      synthesizeActualsForParents([], parents),
      parents,
      allocations,
    );
    expect(lines[0].recognitionMonth).toBeNull();

    const aggregate = aggregateLinesByMonth(lines);
    expect(aggregate.byMonth.find((m) => m.monthKey === "2026-05")).toBeUndefined();
    expect(aggregate.unrecognised.cos).toBe(100000);
    expect(aggregate.unrecognised.revenue).toBe(100000);
  });
});
