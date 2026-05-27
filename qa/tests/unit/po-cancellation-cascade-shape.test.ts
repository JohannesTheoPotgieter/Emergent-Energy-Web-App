/**
 * TF-24 (audit V3) — Contract test for the PO cancellation cascade.
 *
 * Pins the surface of `po-cancellation-cascade.ts` and the wiring in
 * `po-routes.ts` so a future refactor cannot silently leave a cancelled
 * PO with downstream cost lines still claiming an active link.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as cascade from "../../../server/services/po-cancellation-cascade";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("TF-24 — PO cancellation cascade", () => {
  it("exports the cascade function", () => {
    expect(typeof cascade.cascadePoCancellationToCostLines).toBe("function");
  });

  it("preserves already-paid lines and severs unpaid ones", () => {
    const src = read("server/services/po-cancellation-cascade.ts");
    // Preservation: if paidDate is set OR status='paid', the line is left alone.
    expect(src).toContain("line.paidDate");
    expect(src).toContain('line.status === "paid"');
    expect(src).toContain("preservedIds.push");
    // Severance: po_number is cleared and the description gets a stamp.
    expect(src).toContain("poNumber: null");
    expect(src).toContain("[PO ${po.poRef} cancelled");
  });

  it("is wired into the PATCH /api/po/:poId/status flow", () => {
    const routes = read("server/po-routes.ts");
    expect(routes).toContain('from "./services/po-cancellation-cascade"');
    expect(routes).toContain("cascadePoCancellationToCostLines(poIdNum");
    // The cascade only fires when transitioning to cancelled.
    expect(routes).toContain('if (status === "cancelled")');
    // Cascade summary lands in the audit_events row and the response.
    expect(routes).toContain("cascadeSummary");
  });

  it("uses snapshot-table effectiveTo guard when searching candidate cost lines", () => {
    const src = read("server/services/po-cancellation-cascade.ts");
    expect(src).toContain("isNull(normalizedCostLines.effectiveTo)");
    expect(src).toContain("isNull(normalizedCostLines.deletedAt)");
  });
});
