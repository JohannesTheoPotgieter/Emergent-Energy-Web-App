/**
 * COS / Revenue tracker cutover — adapter shape tests.
 *
 * `mergeLineLevelCostLines` synthesizes one parent-shaped row per
 * `normalized_cost_line_actuals` child (with parent metadata spread in).
 * Used behind the LINE_LEVEL_COS_TRACKER feature flag to swap the
 * legacy COS/Revenue tracker data source from parent rows
 * (1 per BOQ row) to child actuals (1 per invoice on that BOQ row).
 *
 * The downstream bucketing logic in
 * server/departments/finance-routes.ts reads:
 *   id · amountExVat · invoiceDate · invoiceNumber ·
 *   invoiceDateFontColor · invoiceDateConfirmed · projectName ·
 *   paidDate · paidDateConfirmed · paidDateFontColor
 *
 * The adapter must:
 *   - emit one row per child, keeping parent's id (so QB link
 *     lookups continue to resolve)
 *   - override amountExVat with child.actualTotal
 *   - override invoiceDate / invoiceNumber / poNumber with child values
 *   - override paidDate with child.financePaymentDate when present
 *   - keep invoiceDateFontColor / invoiceDateConfirmed / projectName
 *     from the parent (per-actual colour signals are not stored)
 *   - emit budget-only parents (no children) as-is
 */
import { describe, expect, it } from "vitest";
import {
  mergeLineLevelCostLines,
  type ChildActualRow,
} from "../../../server/repositories/finance-expense-engine-repository";

const baseParent = {
  id: 1,
  projectName: "Mondi",
  invoiceDate: "2026-04-30",
  invoiceNumber: "INV-PARENT",
  amountExVat: "100000",
  invoiceDateFontColor: "black",
  invoiceDateConfirmed: true,
  paidDate: null,
  paidDateConfirmed: null,
  paidDateFontColor: null,
  poNumber: "PO-PARENT",
};

describe("mergeLineLevelCostLines — cutover adapter", () => {
  it("emits a parent unchanged when there are no children (budget-only line)", () => {
    const parents = [baseParent];
    const out = mergeLineLevelCostLines(parents, []);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(baseParent);
  });

  it("emits N rows for a parent with N children, parent id preserved", () => {
    const parents = [baseParent];
    const children: ChildActualRow[] = [
      { costLineId: 1, actualTotal: "60000", poNumber: "PO-1", invoiceNumber: "INV-1", invoiceDate: "2026-04-15", financePaymentDate: null },
      { costLineId: 1, actualTotal: "40000", poNumber: "PO-2", invoiceNumber: "INV-2", invoiceDate: "2026-05-15", financePaymentDate: null },
    ];
    const out = mergeLineLevelCostLines(parents, children);
    expect(out).toHaveLength(2);
    for (const r of out) expect(r.id).toBe(1);
    expect(out[0].amountExVat).toBe("60000");
    expect(out[0].invoiceDate).toBe("2026-04-15");
    expect(out[0].invoiceNumber).toBe("INV-1");
    expect(out[1].amountExVat).toBe("40000");
    expect(out[1].invoiceDate).toBe("2026-05-15");
  });

  it("preserves parent's invoiceDateFontColor / projectName on every emitted row", () => {
    const parents = [baseParent];
    const children: ChildActualRow[] = [
      { costLineId: 1, actualTotal: "60000", poNumber: null, invoiceNumber: "INV-1", invoiceDate: "2026-04-15", financePaymentDate: null },
    ];
    const out = mergeLineLevelCostLines(parents, children);
    expect(out[0].invoiceDateFontColor).toBe("black");
    expect(out[0].invoiceDateConfirmed).toBe(true);
    expect(out[0].projectName).toBe("Mondi");
  });

  it("falls back to parent values when child has nulls", () => {
    const parents = [baseParent];
    const children: ChildActualRow[] = [
      { costLineId: 1, actualTotal: null, poNumber: null, invoiceNumber: null, invoiceDate: null, financePaymentDate: null },
    ];
    const out = mergeLineLevelCostLines(parents, children);
    expect(out[0].amountExVat).toBe("100000"); // from parent
    expect(out[0].invoiceNumber).toBe("INV-PARENT"); // from parent
    expect(out[0].invoiceDate).toBe("2026-04-30"); // from parent
    expect(out[0].poNumber).toBe("PO-PARENT"); // from parent
  });

  it("overrides paidDate with child.financePaymentDate when present", () => {
    const parents = [{ ...baseParent, paidDate: "2026-04-01" }];
    const children: ChildActualRow[] = [
      { costLineId: 1, actualTotal: "60000", poNumber: null, invoiceNumber: "INV-1", invoiceDate: "2026-04-15", financePaymentDate: "2026-05-01" },
    ];
    const out = mergeLineLevelCostLines(parents, children);
    expect(out[0].paidDate).toBe("2026-05-01");
  });

  it("orphan child (no matching parent) is dropped, not crashed", () => {
    const parents = [baseParent];
    const children: ChildActualRow[] = [
      { costLineId: 1, actualTotal: "60000", poNumber: null, invoiceNumber: "INV-1", invoiceDate: "2026-04-15", financePaymentDate: null },
      { costLineId: 9999, actualTotal: "1000000", poNumber: null, invoiceNumber: "INV-X", invoiceDate: "2026-04-15", financePaymentDate: null },
    ];
    const out = mergeLineLevelCostLines(parents, children);
    expect(out).toHaveLength(1);
    expect(out[0].invoiceNumber).toBe("INV-1");
  });

  it("preserves SUM identity: Σ children.actualTotal = parent's total when single parent", () => {
    const parents = [baseParent];
    const children: ChildActualRow[] = [
      { costLineId: 1, actualTotal: "30000", poNumber: null, invoiceNumber: "INV-1", invoiceDate: "2026-04-15", financePaymentDate: null },
      { costLineId: 1, actualTotal: "70000", poNumber: null, invoiceNumber: "INV-2", invoiceDate: "2026-04-15", financePaymentDate: null },
    ];
    const out = mergeLineLevelCostLines(parents, children);
    const sum = out.reduce((s, r) => s + Number((r as { amountExVat: string }).amountExVat), 0);
    expect(sum).toBe(100000); // = parent's amountExVat
  });

  it("mixed: parent with children + parent without, both emit correctly", () => {
    const parents = [
      baseParent,
      { ...baseParent, id: 2, projectName: "Project B", invoiceNumber: "INV-PARENT-B" },
    ];
    const children: ChildActualRow[] = [
      { costLineId: 1, actualTotal: "60000", poNumber: null, invoiceNumber: "INV-1", invoiceDate: "2026-04-15", financePaymentDate: null },
    ];
    const out = mergeLineLevelCostLines(parents, children);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(1);
    expect(out[0].amountExVat).toBe("60000");
    expect(out[1].id).toBe(2);
    expect(out[1].amountExVat).toBe("100000"); // parent unchanged (no children)
  });
});
