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
    expect(serviceCode).toContain("directCategoryCount: number");
    expect(serviceCode).toContain("totalCategoryCount: number");
    expect(serviceCode).toContain("incompleteCategoryKeys: string[]");
    expect(serviceCode).toContain("latestImportHadJcatIssues: boolean");
  });

  it("queries category_revenue_allocations for active rows", () => {
    expect(serviceCode).toContain("categoryRevenueAllocations");
    expect(serviceCode).toContain("isNull(categoryRevenueAllocations.effectiveTo)");
  });

  it("treats DIRECT, HEADER_ERROR_POSITIONAL, and MANUAL as trusted", () => {
    expect(serviceCode).toContain('"DIRECT"');
    expect(serviceCode).toContain('"HEADER_ERROR_POSITIONAL"');
    expect(serviceCode).toContain('"MANUAL"');
    expect(serviceCode).toContain("TRUSTED_CONFIDENCES");
  });

  it("PROVISIONAL is NOT treated as trusted", () => {
    // PROVISIONAL should not be in the trusted set
    const trustedLine = serviceCode.slice(
      serviceCode.indexOf("TRUSTED_CONFIDENCES"),
      serviceCode.indexOf("TRUSTED_CONFIDENCES") + 200,
    );
    expect(trustedLine).not.toContain('"PROVISIONAL"');
  });
});

// ---------------------------------------------------------------------------
// S14: Mode classification logic
// ---------------------------------------------------------------------------
describe("S14: recognition mode classification", () => {
  const serviceCode = read("server/services/recognition-mode-service.ts");

  it("returns CATEGORY_READY when all categories have trusted confidence and non-null revenue", () => {
    expect(serviceCode).toContain("directCategoryCount === totalCategoryCount");
    // After this check passes, mode should be CATEGORY_READY
    const readyBlock = serviceCode.slice(
      serviceCode.indexOf("directCategoryCount === totalCategoryCount"),
      serviceCode.indexOf("directCategoryCount === totalCategoryCount") + 200,
    );
    expect(readyBlock).toContain("CATEGORY_READY");
  });

  it("returns LEGACY_PRE_REIMPORT when no allocations exist and no J_cat issues", () => {
    expect(serviceCode).toContain("totalCategoryCount === 0");
    const noAllocBlock = serviceCode.slice(
      serviceCode.indexOf("totalCategoryCount === 0"),
      serviceCode.indexOf("totalCategoryCount === 0") + 300,
    );
    expect(noAllocBlock).toContain("LEGACY_PRE_REIMPORT");
  });

  it("returns REIMPORT_FAILED when latest import had J_cat issues", () => {
    expect(serviceCode).toContain("REIMPORT_FAILED");
    expect(serviceCode).toContain("checkLatestImportForJcatIssues");
  });

  it("detects J_cat issues by checking for JCAT_ prefixed issue types", () => {
    expect(serviceCode).toContain('.startsWith("JCAT_")');
  });

  it("checks the latest COMMITTED import run for issues", () => {
    expect(serviceCode).toContain('eq(smartImportRuns.status, "COMMITTED")');
    expect(serviceCode).toContain("desc(smartImportRuns.committedAt)");
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
    // Q=100, X_cat=500, J_cat=1000 → (100/500)*1000 = 200
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
    // When a category has only one line, Q = X_cat, so result = J_cat
    expect(allocateRevenueByCategory(500, 500, 1000, false)).toBe(1000);
  });

  it("handles fractional amounts correctly", () => {
    // Q=33.33, X_cat=100, J_cat=300 → (33.33/100)*300 = 99.99
    const result = allocateRevenueByCategory(33.33, 100, 300, false);
    expect(result).toBeCloseTo(99.99, 2);
  });

  it("project-level allocateRevenue still works (backward compat)", () => {
    // Same formula shape but project-level parameters
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
    // At least one of these should still exist
    const hasOldFunction = finRoutes.includes("allocateRevenue(");
    const hasInlineFormula = finRoutes.includes("projectTotalCOS") || finRoutes.includes("totalCOSProject");
    expect(hasOldFunction || hasInlineFormula).toBe(true);
  });
});
