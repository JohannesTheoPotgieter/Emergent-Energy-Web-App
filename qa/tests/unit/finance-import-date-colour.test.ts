import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCellFormatEntry } from "@shared/tracker-cell-format-keys";
import { styleForCell } from "@/lib/tracker-cell-format";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

/**
 * Every finance view must surface the IMPORTED invoice-date and payment-date
 * cell colour so a user can tell at a glance whether an invoice was released or
 * a milestone was paid.
 *
 * Root cause this guards against: the Smart Import pipeline keys cell_format by
 * the SOURCE-SHEET column label (revenue: payment_received_date /
 * planned_payment_date; cost: payment_date), while the app looks the colour up
 * by canonical field name (paidDate / expectedPaymentDate / financePaymentDate).
 * The shared resolver bridges the two so all surfaces resolve colour identically.
 */
describe("finance imported invoice/payment date colour", () => {
  describe("shared resolver: canonical name → source-sheet key", () => {
    it("resolves the revenue milestone payment-received colour (payment_received_date)", () => {
      const fmt = { payment_received_date: { fill: "#00B050" } };
      expect(resolveCellFormatEntry(fmt, "paidDate")).toEqual({ fill: "#00B050" });
    });

    it("resolves the cost-line / actual-batch payment colour (payment_date)", () => {
      const fmt = { payment_date: { font: "#FF0000" } };
      expect(resolveCellFormatEntry(fmt, "paidDate")).toEqual({ font: "#FF0000" });
      expect(resolveCellFormatEntry(fmt, "financePaymentDate")).toEqual({ font: "#FF0000" });
    });

    it("resolves the planned/expected payment-date colour (planned_payment_date)", () => {
      const fmt = { planned_payment_date: { font: "#FF0000" } };
      expect(resolveCellFormatEntry(fmt, "expectedPaymentDate")).toEqual({ font: "#FF0000" });
    });

    it("resolves invoice-date colour via plain snake/camel (invoice_date)", () => {
      const fmt = { invoice_date: { font: "#FF0000" } };
      expect(resolveCellFormatEntry(fmt, "invoiceDate")).toEqual({ font: "#FF0000" });
    });

    it("returns null when no key matches", () => {
      expect(resolveCellFormatEntry({ milestone_notes: { font: "#000" } }, "paidDate")).toBeNull();
      expect(resolveCellFormatEntry(null, "paidDate")).toBeNull();
    });
  });

  describe("client styleForCell renders the resolved colour", () => {
    it("maps fill → backgroundColor and font → color through the bridge", () => {
      expect(styleForCell({ payment_received_date: { fill: "#00B050" } }, "paidDate")).toEqual({
        backgroundColor: "#00B050",
      });
      expect(styleForCell({ payment_date: { font: "#FF0000" } }, "paidDate")).toEqual({
        color: "#FF0000",
      });
      expect(styleForCell({ planned_payment_date: { font: "#FF0000" } }, "expectedPaymentDate")).toEqual({
        color: "#FF0000",
      });
    });
  });

  describe("the finance views style the invoice/payment date cells", () => {
    it("revenue Milestone Tracker styles invoice + planned + received payment dates", () => {
      const page = read("client/src/pages/revenue-tracking.tsx");
      expect(page).toContain('styleForCell(m.cellFormat, "invoiceDate")');
      expect(page).toContain('styleForCell(m.cellFormat, "expectedPaymentDate")');
      expect(page).toContain('styleForCell(m.cellFormat, "paidDate")');
    });

    it("Expenditure Breakdown styles invoice + paid + finance payment dates", () => {
      const page = read("client/src/pages/expenditure-breakdown.tsx");
      expect(page).toContain('styleForCell(c.cellFormat, "invoiceDate")');
      expect(page).toContain('styleForCell(c.cellFormat, "paidDate")');
      expect(page).toMatch(/styleForCell\([^,]+,\s*"financePaymentDate"\)/);
    });

    it("Excel-vs-App diff resolves cell colour via the shared bridge (not a raw lookup)", () => {
      const repo = read("server/repositories/tracker-replica-repository.ts");
      expect(repo).toContain("resolveCellFormatEntry(cellFormat, f)");
      expect(repo).not.toMatch(/cellFormat as any\)\[f\]/);
    });
  });

  describe("the importer captures invoice + payment date colour at source", () => {
    const normalizer = read("server/lib/import/normalizer.ts");
    it("revenue lines capture invoice + planned + received payment columns", () => {
      expect(normalizer).toMatch(/invoice_date:\s*invoiceDateCol/);
      expect(normalizer).toMatch(/planned_payment_date:\s*plannedDateCol/);
      expect(normalizer).toMatch(/payment_received_date:\s*paidDateCol/);
    });
    it("cost lines capture invoice + payment columns", () => {
      expect(normalizer).toMatch(/invoice_date:\s*invoiceDateCol/);
      expect(normalizer).toMatch(/payment_date:\s*paidDateCol/);
    });
  });
});
