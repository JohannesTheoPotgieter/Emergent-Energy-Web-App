import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { styleForCell } from "../../../client/src/lib/tracker-cell-format";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

/**
 * The revenue Milestone Tracker must surface the IMPORTED payment-date cell
 * colour so a user can tell, at a glance, whether a milestone has been paid.
 *
 * Root cause this guards against: the Smart Import pipeline keys a revenue
 * line's cell_format by the SOURCE-SHEET column label (planned_payment_date /
 * payment_received_date), but the page historically looked the colour up by the
 * canonical field name (expectedPaymentDate / paidDate). styleForCell only
 * normalises camel/snake of ONE name, so the canonical lookup never matched the
 * importer's key and the colour was silently dropped.
 */
describe("revenue payment-date imported colour", () => {
  // The importer's cell_format shape for a paid + planned milestone row.
  const importedCellFormat = {
    invoice_date: { font: "#000000" },
    planned_payment_date: { font: "#FF0000" }, // red = unconfirmed planned date
    payment_received_date: { fill: "#00B050" }, // green fill = paid
  };

  it("canonical-name lookup alone misses the importer's payment-date keys (the bug)", () => {
    // paidDate → tries paidDate / paid_date — never payment_received_date.
    expect(styleForCell(importedCellFormat, "paidDate")).toEqual({});
    // expectedPaymentDate → tries expectedPaymentDate / expected_payment_date.
    expect(styleForCell(importedCellFormat, "expectedPaymentDate")).toEqual({});
  });

  it("the importer's column-label keys DO resolve when looked up directly", () => {
    expect(styleForCell(importedCellFormat, "payment_received_date")).toEqual({
      backgroundColor: "#00B050",
    });
    expect(styleForCell(importedCellFormat, "planned_payment_date")).toEqual({
      color: "#FF0000",
    });
  });

  it("revenue-tracking page looks payment dates up by BOTH canonical and importer keys", () => {
    const page = read("client/src/pages/revenue-tracking.tsx");
    // Planned Payment Date cell tries canonical + importer column-label key.
    expect(page).toMatch(
      /styleForCellAny\(\s*m\.cellFormat\s*,\s*"expectedPaymentDate"\s*,\s*"planned_payment_date"\s*\)/,
    );
    // Payment Received Date cell tries canonical + importer column-label key.
    expect(page).toMatch(
      /styleForCellAny\(\s*m\.cellFormat\s*,\s*"paidDate"\s*,\s*"payment_received_date"\s*\)/,
    );
  });

  it("the importer captures colour for the planned + received payment-date columns", () => {
    const normalizer = read("server/lib/import/normalizer.ts");
    // buildRowCellFormat for revenue lines includes both payment-date columns.
    expect(normalizer).toMatch(/planned_payment_date:\s*plannedDateCol/);
    expect(normalizer).toMatch(/payment_received_date:\s*paidDateCol/);
  });
});
