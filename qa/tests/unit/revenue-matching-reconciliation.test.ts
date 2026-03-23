import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Issue A: Revenue Milestone Composite Key Matching", () => {
  const routes = read("server/smart-import-routes.ts");

  it("selects milestoneName and milestoneAmount from old inflows", () => {
    expect(routes).toContain("milestoneName: programInflows.milestoneName");
    expect(routes).toContain("milestoneAmount: programInflows.milestoneAmount");
  });

  it("builds composite key map from old inflows", () => {
    expect(routes).toContain("oldCompositeMap");
    expect(routes).toContain("${r.milestoneName}::${r.milestoneAmount");
  });

  it("still maintains row-based fallback map", () => {
    expect(routes).toContain("oldRowMap");
  });

  it("tries composite match first before row match", () => {
    // The composite key check should come before the row check
    const compositeIdx = routes.indexOf("oldCompositeMap.has(compositeKey)");
    const rowIdx = routes.indexOf("oldRowMap.has(r.sourceRow)");
    expect(compositeIdx).toBeGreaterThan(0);
    expect(rowIdx).toBeGreaterThan(compositeIdx);
  });

  it("uses undefined sentinel to distinguish no-match from null inBank", () => {
    expect(routes).toContain("let prevInBank: number | null | undefined = undefined");
    expect(routes).toContain("if (prevInBank === undefined && oldRowMap.has(r.sourceRow))");
  });

  it("logs when a milestone moves rows", () => {
    expect(routes).toContain("moved from row");
    expect(routes).toContain("Status preserved");
  });

  it("preserves inBank from composite match even if row differs", () => {
    // The composite match block extracts inBank regardless of row alignment
    const compositeBlock = routes.substring(
      routes.indexOf("oldCompositeMap.has(compositeKey)"),
      routes.indexOf("// Fall back to row number match")
    );
    expect(compositeBlock).toContain("prevInBank = match.inBank");
  });
});

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
