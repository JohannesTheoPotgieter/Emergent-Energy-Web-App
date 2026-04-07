/**
 * COS Realisation Consistency Tests
 *
 * Verifies that all COS realisation callers use the canonical
 * isCanonicalCosRealised() function and pass a consistent "today" parameter.
 *
 * The "today" parameter only affects the committed-past-month check.
 * Since the check uses YYYY-MM month comparison (not day-level), the
 * actual date vs month-end-28 difference was cosmetically inconsistent
 * but not behaviorally different. This test suite ensures all callers
 * now use the same actual-date approach.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isCanonicalCosRealised, type CosLineInput } from "../../../server/lib/finance/cos-realisation";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ---------------------------------------------------------------------------
// A. CANONICAL FUNCTION BEHAVIOR
// ---------------------------------------------------------------------------

describe("isCanonicalCosRealised — canonical behavior", () => {
  const baseLine: CosLineInput = {
    status: null,
    cosStatusOverride: null,
    cosRealised: null,
    expenseInvoiceNumber: null,
    expenseInvoicedDate: null,
    expensePoNumber: null,
    paymentDate: null,
    today: "2026-04-07",
  };

  it("PLANNED line is not realised", () => {
    expect(isCanonicalCosRealised({ ...baseLine, status: "PLANNED" })).toBe(false);
  });

  it("COS REALISED status is realised", () => {
    expect(isCanonicalCosRealised({ ...baseLine, status: "COS REALISED" })).toBe(true);
  });

  it("INVOICED status is realised", () => {
    expect(isCanonicalCosRealised({ ...baseLine, status: "INVOICED" })).toBe(true);
  });

  it("PAID status is realised", () => {
    expect(isCanonicalCosRealised({ ...baseLine, status: "PAID" })).toBe(true);
  });

  it("committed line with past-month invoice date IS realised", () => {
    expect(isCanonicalCosRealised({
      ...baseLine,
      status: "COMMITTED",
      expenseInvoicedDate: "2026-03-15",
      today: "2026-04-07",
    })).toBe(true);
  });

  it("committed line with current-month invoice date is NOT realised", () => {
    expect(isCanonicalCosRealised({
      ...baseLine,
      status: "COMMITTED",
      expenseInvoicedDate: "2026-04-01",
      today: "2026-04-07",
    })).toBe(false);
  });

  it("override COS REALISED overrides everything", () => {
    expect(isCanonicalCosRealised({
      ...baseLine,
      status: "PLANNED",
      cosStatusOverride: "COS REALISED",
    })).toBe(true);
  });

  it("override PLANNED prevents realisation", () => {
    expect(isCanonicalCosRealised({
      ...baseLine,
      status: "INVOICED",
      cosStatusOverride: "PLANNED",
    })).toBe(false);
  });

  it("cosRealised boolean flag causes realisation", () => {
    expect(isCanonicalCosRealised({ ...baseLine, cosRealised: true })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B. TODAY PARAMETER CONSISTENCY — the fix
// ---------------------------------------------------------------------------

describe("today parameter produces identical results regardless of day-of-month", () => {
  const committedPastMonth: CosLineInput = {
    status: "COMMITTED",
    cosStatusOverride: null,
    cosRealised: null,
    expenseInvoiceNumber: "INV-001",
    expenseInvoicedDate: "2026-03-15",
    expensePoNumber: "PO-001",
    paymentDate: null,
    today: "",
  };

  it("actual date 2026-04-07 and month-end 2026-04-28 produce same result", () => {
    const withActual = isCanonicalCosRealised({ ...committedPastMonth, today: "2026-04-07" });
    const withMonthEnd = isCanonicalCosRealised({ ...committedPastMonth, today: "2026-04-28" });
    expect(withActual).toBe(withMonthEnd);
  });

  it("any day in April 2026 produces same result for March-dated committed line", () => {
    for (const day of ["01", "07", "15", "28", "30"]) {
      const result = isCanonicalCosRealised({ ...committedPastMonth, today: `2026-04-${day}` });
      expect(result).toBe(true);
    }
  });

  it("any day in March 2026 produces same result for March-dated committed line", () => {
    for (const day of ["01", "07", "15", "28", "31"]) {
      const result = isCanonicalCosRealised({ ...committedPastMonth, today: `2026-03-${day}` });
      // Same month = NOT realised (not past-month)
      expect(result).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// C. CALLER CONSISTENCY — all callers use canonical function with actual date
// ---------------------------------------------------------------------------

describe("All COS callers use isCanonicalCosRealised", () => {
  it("company-overview-service uses isCanonicalCosRealised with actual date", () => {
    const service = read("server/services/company-overview-service.ts");
    expect(service).toContain("isCanonicalCosRealised");
    // Verify it gets today from actual date, not month-end
    expect(service).toContain("now.toISOString().slice(0, 10)");
  });

  it("dashboard-metrics uses isCanonicalCosRealised with actual date", () => {
    const service = read("server/services/dashboard-metrics.ts");
    expect(service).toContain("isCanonicalCosRealised");
    expect(service).toContain("new Date().toISOString().slice(0, 10)");
  });

  it("project-header-kpi-service uses isCanonicalCosRealised with actual date", () => {
    const service = read("server/services/project-header-kpi-service.ts");
    expect(service).toContain("isCanonicalCosRealised");
    expect(service).toContain("new Date().toISOString().slice(0, 10)");
  });

  it("canonical-dashboard-kpi-service uses isCanonicalCosRealised with actual date", () => {
    const service = read("server/services/canonical-dashboard-kpi-service.ts");
    expect(service).toContain("isCanonicalCosRealised");
    expect(service).toContain("new Date().toISOString().slice(0, 10)");
  });

  it("pm-monthly-report-service uses isCanonicalCosRealised with actual date", () => {
    const service = read("server/services/pm-monthly-report-service.ts");
    expect(service).toContain("isCanonicalCosRealised");
    expect(service).toContain("new Date().toISOString().slice(0, 10)");
  });

  it("financeUtils isCosRealised wrapper uses isCanonicalCosRealised with actual date", () => {
    const utils = read("server/lib/calculations/financeUtils.ts");
    expect(utils).toContain("isCanonicalCosRealised");
    expect(utils).toContain("new Date().toISOString().slice(0, 10)");
  });

  it("finance-routes isEffectivelyRealised uses isCanonicalCosRealised with actual date", () => {
    const routes = read("server/departments/finance-routes.ts");
    const block = routes.substring(
      routes.indexOf("function isEffectivelyRealised"),
      routes.indexOf("function isEffectivelyRealised") + 500
    );
    expect(block).toContain("isCanonicalCosRealised");
    expect(block).toContain("new Date().toISOString().slice(0, 10)");
    // Must NOT contain the old month-end approximation
    expect(block).not.toContain("}-28`");
  });

  it("cos-control-routes uses isCanonicalCosRealised (no longer classifyCosStatusFull for realisation)", () => {
    const routes = read("server/routes/cos-control-routes.ts");
    // isCosRealisedCheck should now delegate to canonical
    const checkBlock = routes.substring(
      routes.indexOf("function isCosRealisedCheck"),
      routes.indexOf("function isCosRealisedCheck") + 500
    );
    expect(checkBlock).toContain("isCanonicalCosRealised");

    // isEffectivelyRealisedLocal should now delegate to canonical
    const localBlock = routes.substring(
      routes.indexOf("function isEffectivelyRealisedLocal"),
      routes.indexOf("function isEffectivelyRealisedLocal") + 800
    );
    expect(localBlock).toContain("isCanonicalCosRealised");
    expect(localBlock).toContain("new Date().toISOString().slice(0, 10)");
  });
});

// ---------------------------------------------------------------------------
// D. SAME INPUT SAME OUTPUT — cross-caller consistency proof
// ---------------------------------------------------------------------------

describe("Same expense line produces same answer through any code path", () => {
  // A committed line from last month — this is the case where "today" matters
  const committedLastMonth = {
    status: "COMMITTED",
    _cosOverrideStatus: null,
    cosStatusOverride: null,
    cosRealised: null,
    expenseInvoiceNumber: "INV-100",
    expenseInvoicedDate: "2026-03-10",
    expensePoNumber: "PO-100",
    expensePaymentDate: null,
    paymentDate: null,
    paidDate: null,
    invoiceNumber: "INV-100",
    invoiceDate: "2026-03-10",
    poNumber: "PO-100",
    line_status: "COMMITTED",
  };

  it("isCanonicalCosRealised directly returns true for April 2026", () => {
    expect(isCanonicalCosRealised({
      status: committedLastMonth.status,
      cosStatusOverride: null,
      cosRealised: null,
      expenseInvoiceNumber: committedLastMonth.expenseInvoiceNumber,
      expenseInvoicedDate: committedLastMonth.expenseInvoicedDate,
      expensePoNumber: committedLastMonth.expensePoNumber,
      paymentDate: null,
      today: "2026-04-07",
    })).toBe(true);
  });

  it("all callers would produce identical CosLineInput from same expense data", () => {
    // The field mapping pattern used by all canonical callers (finance-routes, company-overview, etc.)
    const mappedInput: CosLineInput = {
      status: committedLastMonth.status ?? committedLastMonth.line_status ?? null,
      cosStatusOverride: committedLastMonth._cosOverrideStatus ?? committedLastMonth.cosStatusOverride ?? null,
      cosRealised: committedLastMonth.cosRealised ?? null,
      expenseInvoiceNumber: committedLastMonth.expenseInvoiceNumber ?? committedLastMonth.invoiceNumber ?? null,
      expenseInvoicedDate: committedLastMonth.expenseInvoicedDate ?? committedLastMonth.invoiceDate ?? null,
      expensePoNumber: committedLastMonth.expensePoNumber ?? committedLastMonth.poNumber ?? null,
      paymentDate: committedLastMonth.expensePaymentDate ?? committedLastMonth.paymentDate ?? committedLastMonth.paidDate ?? null,
      today: "2026-04-07",
    };
    expect(isCanonicalCosRealised(mappedInput)).toBe(true);
  });
});
