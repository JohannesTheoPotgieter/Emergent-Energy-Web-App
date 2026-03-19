import { describe, expect, it } from "vitest";
import { findPaneGapColumn } from "../../../server/lib/import/detector";

describe("Expenditure Breakdown dual-pane splitting", () => {
  describe("findPaneGapColumn", () => {
    // Mondi tracker: B4-J4 (budget), K4 empty, L4-W4 (actual)
    it("detects gap column for Mondi tracker layout", () => {
      // Cols:  0(A)  1(B)              2(C)              3(D)                   4(E)  5(F)       6(G)           7(H)                       8(I)        9(J)            10(K) 11(L) 12(M)             13(N)                  14(O) 15(P)      16(Q)          17(R)       18(S)             19(T)                  20(U)                            21(V)   22(W)
      const row = [
        null,   "No.", "Product/Service", "Description of Work", "QTY", "Rate/Unit", "Budget Total", "FINANCE PAYMENT DATE", "Total COS", "ERROR on REV",
        null, // K — gap
        "No.", "Product/Service", "Description of Work", "QTY", "Rate/Unit", "Actual Total", "PO NUMBER", "INVOICE NUMBER", "INVOICE RAISED DATE", "REVENUE RECOGNITION AMOUNT", "CHECK", "FINANCE PAYMENT DATE",
      ];
      const gap = findPaneGapColumn(row);
      expect(gap).toBe(10); // column K (0-indexed)
    });

    // Coega / De Drift tracker
    it("detects gap column for Coega/De Drift tracker layout", () => {
      const row = [
        null, "No.", "Product/Service", "Description of Work", "QTY", "Rate/Unit", "Budget Total", "FORECASTED PAYMENT DATE", "Total COS", "Total Revenue",
        null, // K — gap
        "No.", "Product/Service", "Description of Work", "QTY", "Rate/Unit", "Actual Total", "PO NUMBER", "INVOICE NUMBER", "INVOICE RAISED DATE", "FINANCE PAYMENT DATE",
      ];
      const gap = findPaneGapColumn(row);
      expect(gap).toBe(10);
    });

    // FY2026 Adhoc tracker
    it("detects gap column for FY2026 Adhoc tracker layout", () => {
      const row = [
        null, "No.", "Product/Service", "Description of Work", "QTY", "Rate/Unit", "Budget Total", "FINANCE PAYMENT DATE", "Total COS", "ERROR on REV",
        null, // K — gap
        "No.", "Product/Service", "Description of Work", "QTY", "Rate/Unit", "Actual Total", "PO NUMBER", "INVOICE NUMBER", "INVOICE RAISED DATE", "REVENUE RECOGNITION AMOUNT", "CHECK", "FINANCE PAYMENT DATE",
      ];
      const gap = findPaneGapColumn(row);
      expect(gap).toBe(10);
    });

    // De Drift variant (identical structure to Coega)
    it("detects gap column for De Drift tracker layout", () => {
      const row = [
        null, "No.", "Product/Service", "Description of Work", "QTY", "Rate/Unit", "Budget Total", "FORECASTED PAYMENT DATE", "Total COS", "Total Revenue",
        null, // K — gap
        "No.", "Product/Service", "Description of Work", "QTY", "Rate/Unit", "Actual Total", "PO NUMBER", "INVOICE NUMBER", "INVOICE RAISED DATE", "FINANCE PAYMENT DATE",
      ];
      const gap = findPaneGapColumn(row);
      expect(gap).toBe(10);
    });

    it("returns -1 when no gap column exists (single-table fallback)", () => {
      const row = ["No.", "Product/Service", "Description", "QTY", "Rate/Unit", "Total", "PO NUMBER"];
      const gap = findPaneGapColumn(row);
      expect(gap).toBe(-1);
    });

    it("returns -1 for all-empty row", () => {
      const row = [null, null, null, null];
      const gap = findPaneGapColumn(row);
      expect(gap).toBe(-1);
    });

    it("ignores leading empty column (col A) — does not treat it as a gap", () => {
      // Col A is empty but there are no populated columns before it, so it's not a gap
      const row = [
        null, "No.", "Product/Service", "Description", "QTY", "Rate/Unit", "Budget Total",
        null, // gap at index 7
        "No.", "Product/Service", "Description", "QTY", "Rate/Unit", "Actual Total",
      ];
      const gap = findPaneGapColumn(row);
      expect(gap).toBe(7);
    });

    it("handles multiple empty columns — picks the first valid gap", () => {
      const row = [
        null, "A", "B", "C",
        null, null, // two empty columns at index 4-5
        "D", "E", "F",
      ];
      const gap = findPaneGapColumn(row);
      // First gap at index 4 has 3 populated before and 3 after
      expect(gap).toBe(4);
    });
  });
});
