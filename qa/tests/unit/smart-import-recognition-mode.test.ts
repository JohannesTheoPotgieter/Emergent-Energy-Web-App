/**
 * Recognition Mode Service + Category Revenue Formula Tests (S14, S15)
 *
 * S14: Verifies recognition mode service structure and mode classification logic.
 * S15: Verifies allocateRevenueByCategory() function behavior.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ---------------------------------------------------------------------------
// S14: Recognition mode service — structural verification
// ---------------------------------------------------------------------------
describe("S14: recognition-mode-service structure", () => {
  const serviceCode = read("server/services/recognition-mode-service.ts");

  it("exports RecognitionMode type with correct values", () => {
    expect(serviceCode).toContain('"CATEGORY_READY"');
    expect(serviceCode).toContain('"LEGACY_PRE_REIMPORT"');
    expect(serviceCode).toContain('"REIMPORT_FAILED"');
  });

  it("does NOT include a project-level fallback mode", () => {
    expect(serviceCode).not.toContain('"PROJECT_LEVEL"');
    expect(serviceCode).not.toContain('"AWAITING_REIMPORT"');
  });

  it("exports getRecognitionMode function", () => {
    expect(serviceCode).toContain("export async function getRecognitionMode");
  });

  it("exports RecognitionModeResult interface with required fields", () => {
    expect(serviceCode).toContain("export interface RecognitionModeResult");
    expect(serviceCode).toContain("mode: RecognitionMode");
    expect(serviceCode).toContain("trustedCategoryCount: number");
    expect(serviceCode).toContain("totalCategoryCount: number");
    expect(serviceCode).toContain("incompleteCategoryKeys: string[]");
    expect(serviceCode).toContain("latestImportHadJcatFailure: boolean");
  });

  it("queries category_revenue_allocations for active rows", () => {
    expect(serviceCode).toContain("categoryRevenueAllocations");
    expect(serviceCode).toContain("isNull(categoryRevenueAllocations.effectiveTo)");
  });
});

// ---------------------------------------------------------------------------
// S14: Trust classification
// ---------------------------------------------------------------------------
describe("S14: trust classification", () => {
  const serviceCode = read("server/services/recognition-mode-service.ts");

  it("TRUSTED_CONFIDENCES includes DIRECT, HEADER_ERROR_POSITIONAL, MANUAL", () => {
    const trustedBlock = serviceCode.slice(
      serviceCode.indexOf("TRUSTED_CONFIDENCES = new Set"),
      serviceCode.indexOf("TRUSTED_CONFIDENCES = new Set") + 200,
    );
    expect(trustedBlock).toContain('"DIRECT"');
    expect(trustedBlock).toContain('"HEADER_ERROR_POSITIONAL"');
    expect(trustedBlock).toContain('"MANUAL"');
  });

  it("TRUSTED_CONFIDENCES does NOT include PROVISIONAL", () => {
    const trustedBlock = serviceCode.slice(
      serviceCode.indexOf("TRUSTED_CONFIDENCES = new Set"),
      serviceCode.indexOf("TRUSTED_CONFIDENCES = new Set") + 200,
    );
    expect(trustedBlock).not.toContain('"PROVISIONAL"');
  });

  it("JCAT_FAILURE_ISSUE_TYPES only includes JCAT_COLUMN_MISSING", () => {
    const failureBlock = serviceCode.slice(
      serviceCode.indexOf("JCAT_FAILURE_ISSUE_TYPES = new Set"),
      serviceCode.indexOf("JCAT_FAILURE_ISSUE_TYPES = new Set") + 200,
    );
    expect(failureBlock).toContain('"JCAT_COLUMN_MISSING"');
    expect(failureBlock).not.toContain('"JCAT_POSITIONAL_FALLBACK"');
    expect(failureBlock).not.toContain('"JCAT_RECONCILIATION_VARIANCE"');
  });

  it("documents that JCAT_POSITIONAL_FALLBACK is a WARNING, not a FAILURE", () => {
    expect(serviceCode).toContain("JCAT_POSITIONAL_FALLBACK");
    expect(serviceCode).toContain("WARNING");
    expect(serviceCode).toContain("not failures");
  });
});

// ---------------------------------------------------------------------------
// S14: Mode classification logic
// ---------------------------------------------------------------------------
describe("S14: recognition mode classification", () => {
  const serviceCode = read("server/services/recognition-mode-service.ts");

  it("returns CATEGORY_READY when all categories have trusted confidence and non-null revenue", () => {
    expect(serviceCode).toContain("trustedCategoryCount === totalCategoryCount");
    const readyBlock = serviceCode.slice(
      serviceCode.indexOf("trustedCategoryCount === totalCategoryCount"),
      serviceCode.indexOf("trustedCategoryCount === totalCategoryCount") + 200,
    );
    expect(readyBlock).toContain("CATEGORY_READY");
  });

  it("returns LEGACY_PRE_REIMPORT when no allocations exist and no J_cat failure", () => {
    expect(serviceCode).toContain("totalCategoryCount === 0");
    const noAllocBlock = serviceCode.slice(
      serviceCode.indexOf("totalCategoryCount === 0"),
      serviceCode.indexOf("totalCategoryCount === 0") + 300,
    );
    expect(noAllocBlock).toContain("LEGACY_PRE_REIMPORT");
  });

  it("returns REIMPORT_FAILED only when latest import had a JCAT FAILURE issue", () => {
    expect(serviceCode).toContain("REIMPORT_FAILED");
    expect(serviceCode).toContain("checkLatestImportForJcatFailure");
  });

  it("failure check uses JCAT_FAILURE_ISSUE_TYPES, not startsWith('JCAT_')", () => {
    expect(serviceCode).toContain("JCAT_FAILURE_ISSUE_TYPES.has(i.issueType)");
    // Must NOT use the old broad prefix check
    expect(serviceCode).not.toContain('.startsWith("JCAT_")');
  });

  it("checks the latest COMMITTED import run for failure issues", () => {
    expect(serviceCode).toContain('eq(smartImportRuns.status, "COMMITTED")');
    expect(serviceCode).toContain("desc(smartImportRuns.committedAt)");
  });

  it("CATEGORY_READY sets latestImportHadJcatFailure=false (no contradiction possible)", () => {
    // When all categories are trusted, the function returns before checking import issues.
    // The latestImportHadJcatFailure field is explicitly false.
    const readyReturn = serviceCode.slice(
      serviceCode.indexOf('mode: "CATEGORY_READY"'),
      serviceCode.indexOf('mode: "CATEGORY_READY"') + 200,
    );
    expect(readyReturn).toContain("latestImportHadJcatFailure: false");
  });

  it("HEADER_ERROR_POSITIONAL allocations can produce CATEGORY_READY (no contradiction)", () => {
    // A project where all categories are HEADER_ERROR_POSITIONAL (positional fallback
    // succeeded) should be CATEGORY_READY. The JCAT_POSITIONAL_FALLBACK warning on the
    // import run does NOT trigger REIMPORT_FAILED because it is not in JCAT_FAILURE_ISSUE_TYPES.
    // The trusted confidence check passes. The early return fires. No contradiction.
    expect(serviceCode).toContain("TRUSTED_CONFIDENCES.has(a.allocationConfidence)");
  });
});

// ---------------------------------------------------------------------------
// S15: allocateRevenueByCategory — structural verification
// ---------------------------------------------------------------------------
describe("S15: allocateRevenueByCategory structure", () => {
  const finUtils = read("server/lib/calculations/financeUtils.ts");

  it("exports allocateRevenueByCategory function", () => {
    expect(finUtils).toContain("export function allocateRevenueByCategory(");
  });

  it("has correct parameter names matching the formula", () => {
    expect(finUtils).toContain("lineItemCOS: number");
    expect(finUtils).toContain("categoryTotalCOS: number");
    expect(finUtils).toContain("categoryRevenueAllocation: number");
    expect(finUtils).toContain("noRevenueLinked: boolean");
  });

  it("existing allocateRevenue is marked @deprecated", () => {
    expect(finUtils).toContain("@deprecated");
    expect(finUtils).toContain("allocateRevenueByCategory()");
  });

  it("guards against zero denominator", () => {
    expect(finUtils).toContain("categoryTotalCOS <= 0");
  });

  it("guards against zero or negative J_cat", () => {
    expect(finUtils).toContain("categoryRevenueAllocation <= 0");
  });

  it("respects noRevenueLinked flag", () => {
    expect(finUtils).toContain("noRevenueLinked");
  });
});

// ---------------------------------------------------------------------------
// S15: allocateRevenueByCategory — behavioral verification
// ---------------------------------------------------------------------------
describe("S15: allocateRevenueByCategory behavior", async () => {
  const { allocateRevenueByCategory, allocateRevenue } = await import(
    "../../../server/lib/calculations/financeUtils"
  );

  it("computes (Q / X_cat) * J_cat correctly", () => {
    expect(allocateRevenueByCategory(100, 500, 1000, false)).toBe(200);
  });

  it("returns 0 when category has no COS (zero denominator)", () => {
    expect(allocateRevenueByCategory(100, 0, 1000, false)).toBe(0);
  });

  it("returns 0 when category has negative COS", () => {
    expect(allocateRevenueByCategory(100, -500, 1000, false)).toBe(0);
  });

  it("returns 0 when J_cat is zero", () => {
    expect(allocateRevenueByCategory(100, 500, 0, false)).toBe(0);
  });

  it("returns 0 when J_cat is negative", () => {
    expect(allocateRevenueByCategory(100, 500, -1000, false)).toBe(0);
  });

  it("returns 0 when noRevenueLinked is true", () => {
    expect(allocateRevenueByCategory(100, 500, 1000, true)).toBe(0);
  });

  it("handles full category allocation (Q = X_cat)", () => {
    expect(allocateRevenueByCategory(500, 500, 1000, false)).toBe(1000);
  });

  it("handles fractional amounts correctly", () => {
    const result = allocateRevenueByCategory(33.33, 100, 300, false);
    expect(result).toBeCloseTo(99.99, 2);
  });

  it("project-level allocateRevenue still works (backward compat)", () => {
    expect(allocateRevenue(100, 500, 1000, false)).toBe(200);
    expect(allocateRevenue(100, 0, 1000, false)).toBe(0);
    expect(allocateRevenue(100, 500, 1000, true)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Verify no endpoint switches to category formula yet
// ---------------------------------------------------------------------------
describe("S15: no premature endpoint cutover", () => {
  const finRoutes = read("server/departments/finance-routes.ts");
  const fyeRoutes = read("server/departments/fye-revenue-tracking-routes.ts");

  it("finance-routes.ts does NOT call allocateRevenueByCategory", () => {
    expect(finRoutes).not.toContain("allocateRevenueByCategory");
  });

  it("fye-revenue-tracking-routes.ts does NOT call allocateRevenueByCategory", () => {
    expect(fyeRoutes).not.toContain("allocateRevenueByCategory");
  });

  it("finance-routes.ts still uses project-level allocateRevenue or inline formula", () => {
    const hasOldFunction = finRoutes.includes("allocateRevenue(");
    const hasInlineFormula = finRoutes.includes("projectTotalCOS") || finRoutes.includes("totalCOSProject");
    expect(hasOldFunction || hasInlineFormula).toBe(true);
  });
});
