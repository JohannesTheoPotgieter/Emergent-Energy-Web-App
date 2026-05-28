/**
 * TF-20 (audit V3) — Contract test for the material finance-edit gate.
 *
 * Pins the public surface of finance-material-edit-gate.ts + the
 * wiring into the cost-line / revenue-line PATCH handlers + the new
 * pending_approvals kinds. Numeric correctness against a fixture DB
 * is queued behind DF-21.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyMaterialEdit,
} from "../../../server/services/finance-material-edit-gate";
import {
  PENDING_APPROVAL_KINDS,
} from "../../../shared/schema/pending-approvals";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("TF-20 — material finance-edit gate", () => {
  it("exposes the documented kind enums via PENDING_APPROVAL_KINDS", () => {
    expect(PENDING_APPROVAL_KINDS).toContain("cost_line_material_edit");
    expect(PENDING_APPROVAL_KINDS).toContain("revenue_line_material_edit");
  });

  it("classifies cost-line patches as material when they touch paid_date / invoice_date / amount_ex_vat / po_number", () => {
    expect(classifyMaterialEdit("cost_line", { paidDate: "2026-05-01" }).materialFields).toEqual(["paidDate"]);
    expect(classifyMaterialEdit("cost_line", { invoiceDate: "2026-05-01" }).materialFields).toEqual(["invoiceDate"]);
    expect(classifyMaterialEdit("cost_line", { amountExVat: "100.00" }).materialFields).toEqual(["amountExVat"]);
    expect(classifyMaterialEdit("cost_line", { poNumber: "PO-123" }).materialFields).toEqual(["poNumber"]);
  });

  it("classifies revenue-line patches as material when they touch paid_date / invoice_date / amount_ex_vat / expected_payment_date", () => {
    expect(classifyMaterialEdit("revenue_line", { expectedPaymentDate: "2026-05-01" }).materialFields).toEqual(["expectedPaymentDate"]);
    expect(classifyMaterialEdit("revenue_line", { description: "x" }).materialFields).toEqual([]);
    expect(classifyMaterialEdit("revenue_line", { description: "x" }).cosmeticFields).toEqual(["description"]);
  });

  it("ignores updatedAt as a meaningful field", () => {
    const r = classifyMaterialEdit("cost_line", { updatedAt: new Date(), description: "x" });
    expect(r.materialFields).toEqual([]);
    expect(r.cosmeticFields).toEqual(["description"]);
  });

  it("is wired into the cost-line + revenue-line PATCH routes", () => {
    const src = read("server/routes/finance-legacy-extracted-routes.ts");
    expect(src).toContain("applyMaterialEditGate");
    expect(src).toContain('domain: "cost_line"');
    expect(src).toContain('domain: "revenue_line"');
    expect(src).toContain('status: "pending_approval"');
    expect(src).toContain('return res.status(202).json');
  });

  it("threshold is configurable via FINANCE_MATERIAL_EDIT_THRESHOLD_ZAR", () => {
    const src = read("server/services/finance-material-edit-gate.ts");
    expect(src).toContain("FINANCE_MATERIAL_EDIT_THRESHOLD_ZAR");
    expect(src).toContain("DEFAULT_THRESHOLD_ZAR");
  });
});
