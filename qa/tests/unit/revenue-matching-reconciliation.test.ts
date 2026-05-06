import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// The "Issue A: Revenue Milestone Composite Key Matching" describe block
// was retired in the PE/PI cutover. Its assertions referenced the
// program_inflows write block in smart-import-routes.ts that carried
// inBank / paymentReceivedDate forward across re-imports via a
// composite-key map of old PI rows. That entire block was deleted in
// commit 079b451 — smart-import no longer writes program_inflows at
// all, so the carry-forward logic it tested no longer exists.
//
// Manual-edit preservation across re-imports is a Wave-3-or-later
// concern: it now needs to be implemented in the canonical NCL/NRL
// commit-executor pipeline (server/lib/import/commit-executor.ts) if
// users report losing inBank state across re-imports of the same
// project. No regressions have been reported as of the cutover date.

describe("Issue B: Expenditure Tracking Reconciliation", () => {
  const normalizer = read("server/lib/import/normalizer.ts");

  it("has reconcileExpenditureTracking function", () => {
    expect(normalizer).toContain("function reconcileExpenditureTracking(");
  });

  it("is called after costLines are extracted", () => {
    expect(normalizer).toContain("reconcileExpenditureTracking(workbook, costLines, detection, issues)");
  });

  it("only runs when costLines exist", () => {
    expect(normalizer).toContain("if (costLines.length > 0)");
  });

  it("searches for expenditure tracking sheet by name", () => {
    expect(normalizer).toContain('"expenditure tracking"');
  });

  it("skips the breakdown sheet to avoid comparing against itself", () => {
    expect(normalizer).toContain("breakdownSheetName.toLowerCase()");
    expect(normalizer).toContain("continue; // skip breakdown sheet");
  });

  it("returns gracefully if no tracking sheet found", () => {
    expect(normalizer).toContain("if (!trackingWs) return;");
  });

  it("reads category totals from tracking sheet with numbered prefix matching", () => {
    expect(normalizer).toContain("catMatch = cellVal.match(/^(\\d+)\\.\\s*(.+)/)");
  });

  it("finds grand total from tracking sheet", () => {
    expect(normalizer).toContain("trackingGrandTotal");
    expect(normalizer).toContain('"total"');
  });

  it("groups breakdown lines by category number prefix", () => {
    expect(normalizer).toContain("breakdownByCategory");
    expect(normalizer).toContain('catName.match(/^(\\d+)/)');
  });

  it("generates WARNING for variance > 1%", () => {
    expect(normalizer).toContain("variancePct > 1");
    expect(normalizer).toContain('issueType: "RECONCILIATION_VARIANCE"');
  });

  it("generates INFO for minor rounding differences", () => {
    expect(normalizer).toContain('issueType: "RECONCILIATION_ROUNDING"');
  });

  it("generates WARNING for missing categories", () => {
    expect(normalizer).toContain('issueType: "RECONCILIATION_MISSING_CATEGORY"');
  });

  it("compares grand totals", () => {
    expect(normalizer).toContain('issueType: "RECONCILIATION_GRAND_TOTAL"');
  });

  it("generates INFO for grand total rounding OK", () => {
    expect(normalizer).toContain('issueType: "RECONCILIATION_GRAND_TOTAL_OK"');
  });

  it("reconciliation is advisory only — severity is WARNING or INFO, never BLOCKER", () => {
    // Find all reconciliation issue entries
    const reconcBlock = normalizer.substring(
      normalizer.indexOf("function reconcileExpenditureTracking"),
    );
    const blockerInReconc = reconcBlock.match(/severity: "BLOCKER"/g);
    expect(blockerInReconc).toBeNull();
  });
});
