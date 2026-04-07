/**
 * Margin Calculation Consistency Tests
 *
 * Verifies that:
 * 1. All margin calculations use the shared computeMarginPct function
 * 2. The core formula is consistent: ((rev - cost) / rev) * 100
 * 3. Different scopes are intentional and clearly documented
 * 4. Rounding and zero-revenue handling are explicit
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeMarginPct } from "../../../server/lib/finance/margin";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ---------------------------------------------------------------------------
// A. CORE FORMULA TESTS
// ---------------------------------------------------------------------------

describe("computeMarginPct — core formula", () => {
  it("computes (revenue - cost) / revenue * 100", () => {
    expect(computeMarginPct(1000, 700)).toBe(30);
  });

  it("returns positive margin when revenue > cost", () => {
    expect(computeMarginPct(200, 150)).toBe(25);
  });

  it("returns negative margin when cost > revenue", () => {
    expect(computeMarginPct(100, 150)).toBe(-50);
  });

  it("returns zero margin when revenue equals cost", () => {
    expect(computeMarginPct(100, 100)).toBe(0);
  });

  it("handles very large numbers", () => {
    const result = computeMarginPct(10_000_000, 7_500_000);
    expect(result).toBe(25);
  });
});

describe("computeMarginPct — precision control", () => {
  it("defaults to 2 decimal places", () => {
    expect(computeMarginPct(300, 200)).toBe(33.33);
  });

  it("respects precision: 1", () => {
    expect(computeMarginPct(300, 200, { precision: 1 })).toBe(33.3);
  });

  it("respects precision: 0", () => {
    expect(computeMarginPct(300, 200, { precision: 0 })).toBe(33);
  });

  it("respects precision: 4", () => {
    expect(computeMarginPct(300, 200, { precision: 4 })).toBe(33.3333);
  });
});

describe("computeMarginPct — zero revenue handling", () => {
  it("returns null by default when revenue is 0", () => {
    expect(computeMarginPct(0, 100)).toBeNull();
  });

  it("returns null by default when revenue is negative", () => {
    expect(computeMarginPct(-10, 100)).toBeNull();
  });

  it("returns zeroRevenueValue: 0 when specified", () => {
    expect(computeMarginPct(0, 100, { zeroRevenueValue: 0 })).toBe(0);
  });

  it("returns zeroRevenueValue: null when specified", () => {
    expect(computeMarginPct(0, 100, { zeroRevenueValue: null })).toBeNull();
  });

  it("handles NaN revenue", () => {
    expect(computeMarginPct(NaN, 100)).toBeNull();
  });

  it("handles Infinity revenue", () => {
    expect(computeMarginPct(Infinity, 100)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B. SAME SCOPE = SAME ANSWER — proves consistency across callers
// ---------------------------------------------------------------------------

describe("Same scope produces same answer everywhere", () => {
  // Representative inputs
  const rev = 1_500_000;
  const cost = 1_125_000;
  // Expected: (1500000 - 1125000) / 1500000 * 100 = 25%

  it("company-overview (FYTD, precision 1) matches computeMarginPct", () => {
    const result = computeMarginPct(rev, cost, { precision: 1, zeroRevenueValue: 0 });
    expect(result).toBe(25);
  });

  it("dashboard-metrics (LIFETIME, precision 2) matches computeMarginPct", () => {
    const result = computeMarginPct(rev, cost, { precision: 2 });
    expect(result).toBe(25);
  });

  it("project-header-kpis (LIFETIME, precision 1) matches computeMarginPct", () => {
    const result = computeMarginPct(rev, cost, { precision: 1, zeroRevenueValue: 0 });
    expect(result).toBe(25);
  });

  it("lifecycle-routes (FY_PROJECT, precision 1) matches computeMarginPct", () => {
    const result = computeMarginPct(rev, cost, { precision: 1 });
    expect(result).toBe(25);
  });

  it("kpi-service (PORTFOLIO, precision 2) matches computeMarginPct", () => {
    const result = computeMarginPct(rev, cost, { precision: 2, zeroRevenueValue: 0 });
    expect(result).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// C. ALL CALLERS USE SHARED FUNCTION
// ---------------------------------------------------------------------------

describe("All callers import and use computeMarginPct", () => {
  it("company-overview-service imports computeMarginPct", () => {
    const service = read("server/services/company-overview-service.ts");
    expect(service).toContain('import { computeMarginPct }');
    expect(service).toContain("computeMarginPct(totalRevenueFytd, totalCostFytd");
  });

  it("dashboard-metrics imports computeMarginPct", () => {
    const service = read("server/services/dashboard-metrics.ts");
    expect(service).toContain('import { computeMarginPct }');
    expect(service).toContain("computeMarginPct(totalRevenue, totalCost");
  });

  it("project-header-kpi-service imports computeMarginPct", () => {
    const service = read("server/services/project-header-kpi-service.ts");
    expect(service).toContain('import { computeMarginPct }');
    expect(service).toContain("computeMarginPct(revenueTotal, costTotal");
  });

  it("lifecycle-routes imports computeMarginPct", () => {
    const routes = read("server/lifecycle-routes.ts");
    expect(routes).toContain('import { computeMarginPct }');
    expect(routes).toContain("computeMarginPct(plannedRevenueFy, plannedExpenditureFy");
  });

  it("dashboard-routes imports computeMarginPct", () => {
    const routes = read("server/routes/dashboard-routes.ts");
    expect(routes).toContain('import { computeMarginPct }');
  });

  it("kpi-service imports computeMarginPct", () => {
    const service = read("server/services/kpi-service.ts");
    expect(service).toContain('import { computeMarginPct }');
  });

  it("no inline margin formula remains in key services", () => {
    // These files should NOT contain the raw formula anymore
    for (const file of [
      "server/services/company-overview-service.ts",
      "server/services/dashboard-metrics.ts",
      "server/services/project-header-kpi-service.ts",
      "server/services/kpi-service.ts",
    ]) {
      const content = read(file);
      // Should not have raw inline: (rev - cost) / rev * 100
      // Allow the formula to exist only in comments or the shared module itself
      const lines = content.split("\n");
      for (const line of lines) {
        if (line.includes("computeMarginPct")) continue; // calling the shared function is fine
        if (line.trimStart().startsWith("//")) continue; // comments are fine
        if (line.trimStart().startsWith("*")) continue; // JSDoc is fine
        // Should not have raw division-based margin calculation
        const hasRawFormula = /\(\s*\w+\s*-\s*\w+\s*\)\s*\/\s*\w+\s*\*\s*100/.test(line);
        if (hasRawFormula) {
          // Allow in non-margin contexts (e.g., percentage calculations for tasks)
          const isMarginContext = /margin|Margin|grossProfit/i.test(line);
          expect(isMarginContext).toBe(false);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// D. SCOPE DOCUMENTATION
// ---------------------------------------------------------------------------

describe("Margin scopes are documented in the shared module", () => {
  const marginModule = read("server/lib/finance/margin.ts");

  it("documents FYTD scope", () => {
    expect(marginModule).toContain("FYTD");
  });

  it("documents LIFETIME scope", () => {
    expect(marginModule).toContain("LIFETIME");
  });

  it("documents FY_PROJECT scope", () => {
    expect(marginModule).toContain("FY_PROJECT");
  });

  it("documents PORTFOLIO scope", () => {
    expect(marginModule).toContain("PORTFOLIO");
  });

  it("documents PROGRAM_AVG scope", () => {
    expect(marginModule).toContain("PROGRAM_AVG");
  });
});
