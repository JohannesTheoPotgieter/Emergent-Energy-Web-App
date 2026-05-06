import { describe, expect, it } from "vitest";
import {
  getExpenseBusinessKey,
  getOutflowAmountBreakdown,
  selectWinningExpenseRows,
} from "../../../server/lib/expense-row-selector";

describe("expense row selector", () => {
  it("dedupes duplicate active normalized rows by business key and approval-aware rank", () => {
    const rows = [
      { id: 101, _isNormalized: true, projectId: 10, _sourceRow: 5, approvedDate: "2026-01-15", updatedAt: "2026-01-16T00:00:00Z", source: "imported" },
      { id: 102, _isNormalized: true, projectId: 10, _sourceRow: 5, approvedDate: "2026-02-10", updatedAt: "2026-02-11T00:00:00Z", source: "manual" },
    ];

    const selected = selectWinningExpenseRows(rows);
    expect(selected.winners).toHaveLength(1);
    expect(selected.winners[0].id).toBe(102);
    expect(selected.diagnostics.duplicatesRemoved).toBe(1);
  });

  it("handles normalized and legacy collision for same business line with deterministic winner", () => {
    const normalized = { id: 903001, _isNormalized: true, projectId: 12, _sourceRow: 8, approvedDate: "2026-03-01", updatedAt: "2026-03-01T00:00:00Z" };
    const legacy = { id: 3001, _isNormalized: false, projectId: 12, rowNumber: 8, lineStatus: "Approved", updatedAt: "2026-03-05T00:00:00Z" };

    const selected = selectWinningExpenseRows([normalized, legacy]);
    expect(selected.winners).toHaveLength(1);
    expect(selected.winners[0].id).toBe(normalized.id);
  });

  it("latest approved manual row beats older imported row", () => {
    const imported = { id: 200, _isNormalized: true, projectId: 1, _sourceRow: 1, source: "imported", approvedDate: "2026-01-01", updatedAt: "2026-02-01T00:00:00Z" };
    const manual = { id: 201, _isNormalized: true, projectId: 1, _sourceRow: 1, source: "manual", approvedDate: "2026-02-01", updatedAt: "2026-02-01T00:00:00Z" };

    const selected = selectWinningExpenseRows([imported, manual]);
    expect(selected.winners[0].id).toBe(201);
  });

  it("latest approved imported row beats older manual row", () => {
    const imported = { id: 300, _isNormalized: true, projectId: 2, _sourceRow: 3, source: "imported", approvedDate: "2026-03-10", updatedAt: "2026-03-10T00:00:00Z" };
    const manual = { id: 301, _isNormalized: true, projectId: 2, _sourceRow: 3, source: "manual", approvedDate: "2026-01-10", updatedAt: "2026-03-11T00:00:00Z" };

    const selected = selectWinningExpenseRows([imported, manual]);
    expect(selected.winners[0].id).toBe(300);
  });

  it("negative row offsets reduce outflow (confirmed paid date = actual)", () => {
    const expense = {
      expenseActualTotal: "-1250.50",
      expensePaymentDate: "2026-03-15",
      paymentDateFontColor: "black",
    };
    const outflow = getOutflowAmountBreakdown(expense);
    expect(outflow.type).toBe("actual");
    expect(outflow.amount).toBe(-1250.5);
    expect(outflow.amountSource).toBe("expenseActualTotal");
  });

  it("project and cashflow consumers can share the same winning row", () => {
    const rows = [
      { id: 500, _isNormalized: true, projectId: 4, _sourceRow: 9, approvedDate: "2026-02-01", updatedAt: "2026-02-01T00:00:00Z", budgetTotal: "900", expenseActualTotal: "750", lineStatus: "Approved", expensePaymentDate: "2026-02-10", paymentDateFontColor: "black" },
      { id: 499, _isNormalized: false, projectId: 4, rowNumber: 9, updatedAt: "2026-02-02T00:00:00Z", budgetTotal: "800", lineStatus: "Planned" },
    ];

    const selected = selectWinningExpenseRows(rows).winners[0];
    expect(getExpenseBusinessKey(selected)).toBe("pid:4::row:9");
    const outflow = getOutflowAmountBreakdown(selected);
    expect(outflow.amount).toBe(750);
    expect(outflow.type).toBe("actual");
  });

  it("unconfirmed paid date (red font) buckets as forecast", () => {
    const expense = {
      expenseActualTotal: "1000",
      expensePaymentDate: "2026-03-15",
      paymentDateFontColor: "red",
    };
    const outflow = getOutflowAmountBreakdown(expense);
    expect(outflow.type).toBe("forecast");
    expect(outflow.amount).toBe(1000);
  });

  it("never falls back to budgetTotal — overcounting fix", () => {
    // Row with NO paid date but a large budget figure: previously this would
    // emit budgetTotal as the cashflow outflow amount, doubling the real spend.
    const expense = {
      expenseActualTotal: "500",
      budgetTotal: "9999",
    };
    const outflow = getOutflowAmountBreakdown(expense);
    expect(outflow.amount).toBe(500);
    expect(outflow.type).toBe("forecast");
    expect(outflow.amountSource).toBe("expenseActualTotal");
  });
});
