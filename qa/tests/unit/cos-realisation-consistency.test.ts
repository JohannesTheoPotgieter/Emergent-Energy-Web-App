/**
 * COS Realisation Consistency Tests
 *
 * Validates that:
 * 1. The canonical isCanonicalCosRealised() function works correctly for all inputs
 * 2. finance-policy.ts re-exports isCosRealised as the single entry point
 * 3. The policy module is importable and structurally sound
 */

import { describe, expect, it } from "vitest";
import {
  isCanonicalCosRealised,
  type CosLineInput,
} from "../../../server/lib/finance/cos-realisation";
import {
  isCosRealised,
  isCanonicalCosRealised as policyReExport,
} from "../../../server/policies/finance-policy";

// ---------------------------------------------------------------------------
// Helper: default CosLineInput with all fields null/empty
// ---------------------------------------------------------------------------

function makeLine(overrides: Partial<CosLineInput> = {}): CosLineInput {
  return {
    status: null,
    cosStatusOverride: null,
    cosRealised: null,
    expenseInvoiceNumber: null,
    expenseInvoicedDate: null,
    expensePoNumber: null,
    paymentDate: null,
    today: "2026-04-07",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A. CANONICAL FUNCTION — unit tests for isCanonicalCosRealised
// ---------------------------------------------------------------------------

describe("isCanonicalCosRealised — status-based realisation", () => {
  it("returns false for PLANNED status", () => {
    expect(isCanonicalCosRealised(makeLine({ status: "PLANNED" }))).toBe(false);
  });

  it("returns true for COS REALISED status", () => {
    expect(isCanonicalCosRealised(makeLine({ status: "COS REALISED" }))).toBe(true);
  });

  it("returns true for REALISED status", () => {
    expect(isCanonicalCosRealised(makeLine({ status: "REALISED" }))).toBe(true);
  });

  it("returns true for INVOICED status", () => {
    expect(isCanonicalCosRealised(makeLine({ status: "INVOICED" }))).toBe(true);
  });

  it("returns true for PAID status", () => {
    expect(isCanonicalCosRealised(makeLine({ status: "PAID" }))).toBe(true);
  });

  it("returns false for COMMITTED status without invoice date", () => {
    expect(isCanonicalCosRealised(makeLine({ status: "COMMITTED" }))).toBe(false);
  });

  it("returns false for null/empty status", () => {
    expect(isCanonicalCosRealised(makeLine({ status: null }))).toBe(false);
    expect(isCanonicalCosRealised(makeLine({ status: "" }))).toBe(false);
  });
});

describe("isCanonicalCosRealised — cosStatusOverride", () => {
  it("override COS REALISED forces true regardless of status", () => {
    expect(isCanonicalCosRealised(makeLine({
      status: "PLANNED",
      cosStatusOverride: "COS REALISED",
    }))).toBe(true);
  });

  it("override REALISED forces true regardless of status", () => {
    expect(isCanonicalCosRealised(makeLine({
      status: "PLANNED",
      cosStatusOverride: "REALISED",
    }))).toBe(true);
  });

  it("override PLANNED forces false even when status is INVOICED", () => {
    expect(isCanonicalCosRealised(makeLine({
      status: "INVOICED",
      cosStatusOverride: "PLANNED",
    }))).toBe(false);
  });

  it("override COMMITTED forces false even when status is PAID", () => {
    expect(isCanonicalCosRealised(makeLine({
      status: "PAID",
      cosStatusOverride: "COMMITTED",
    }))).toBe(false);
  });

  it("override takes precedence over cosRealised boolean flag", () => {
    expect(isCanonicalCosRealised(makeLine({
      cosRealised: true,
      cosStatusOverride: "PLANNED",
    }))).toBe(false);
  });

  it("null or empty override is ignored", () => {
    expect(isCanonicalCosRealised(makeLine({
      status: "INVOICED",
      cosStatusOverride: null,
    }))).toBe(true);
    expect(isCanonicalCosRealised(makeLine({
      status: "INVOICED",
      cosStatusOverride: "",
    }))).toBe(true);
  });
});

describe("isCanonicalCosRealised — cosRealised boolean flag", () => {
  it("cosRealised true causes realisation when status is not otherwise realised", () => {
    expect(isCanonicalCosRealised(makeLine({ cosRealised: true }))).toBe(true);
  });

  it("cosRealised false does not force realisation", () => {
    expect(isCanonicalCosRealised(makeLine({ cosRealised: false }))).toBe(false);
  });

  it("cosRealised null does not force realisation", () => {
    expect(isCanonicalCosRealised(makeLine({ cosRealised: null }))).toBe(false);
  });
});

describe("isCanonicalCosRealised — COMMITTED with past-month invoice", () => {
  it("committed with past-month invoice IS realised", () => {
    expect(isCanonicalCosRealised(makeLine({
      status: "COMMITTED",
      expenseInvoicedDate: "2026-03-15",
      today: "2026-04-07",
    }))).toBe(true);
  });

  it("committed with same-month invoice is NOT realised", () => {
    expect(isCanonicalCosRealised(makeLine({
      status: "COMMITTED",
      expenseInvoicedDate: "2026-04-01",
      today: "2026-04-07",
    }))).toBe(false);
  });

  it("committed with future-month invoice is NOT realised", () => {
    expect(isCanonicalCosRealised(makeLine({
      status: "COMMITTED",
      expenseInvoicedDate: "2026-05-01",
      today: "2026-04-07",
    }))).toBe(false);
  });

  it("committed with no invoice date is NOT realised", () => {
    expect(isCanonicalCosRealised(makeLine({
      status: "COMMITTED",
      expenseInvoicedDate: null,
      today: "2026-04-07",
    }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B. TODAY PARAMETER — month-level comparison, day-of-month does not matter
// ---------------------------------------------------------------------------

describe("today parameter — day-of-month is irrelevant (month-level comparison)", () => {
  const committed = (today: string) => makeLine({
    status: "COMMITTED",
    expenseInvoiceNumber: "INV-001",
    expenseInvoicedDate: "2026-03-15",
    expensePoNumber: "PO-001",
    today,
  });

  it("any day in April 2026 treats March invoice as past-month (realised)", () => {
    for (const day of ["01", "07", "15", "28", "30"]) {
      expect(isCanonicalCosRealised(committed(`2026-04-${day}`))).toBe(true);
    }
  });

  it("any day in March 2026 treats March invoice as same-month (not realised)", () => {
    for (const day of ["01", "07", "15", "28", "31"]) {
      expect(isCanonicalCosRealised(committed(`2026-03-${day}`))).toBe(false);
    }
  });

  it("actual date and month-end produce the same result", () => {
    const withActual = isCanonicalCosRealised(committed("2026-04-07"));
    const withMonthEnd = isCanonicalCosRealised(committed("2026-04-28"));
    expect(withActual).toBe(withMonthEnd);
  });
});

// ---------------------------------------------------------------------------
// C. FINANCE POLICY — isCosRealised wrapper and re-exports
// ---------------------------------------------------------------------------

describe("finance-policy.ts — isCosRealised wrapper", () => {
  it("isCosRealised is exported and is a function", () => {
    expect(typeof isCosRealised).toBe("function");
  });

  it("isCanonicalCosRealised is re-exported from finance-policy", () => {
    expect(typeof policyReExport).toBe("function");
    expect(policyReExport).toBe(isCanonicalCosRealised);
  });

  it("isCosRealised returns the same result as isCanonicalCosRealised", () => {
    const cases: Array<{ line: Parameters<typeof isCosRealised>[0]; today: string; expected: boolean }> = [
      {
        line: { status: "PLANNED", cosStatusOverride: null, expenseInvoicedDate: null },
        today: "2026-04-07",
        expected: false,
      },
      {
        line: { status: "COS REALISED", cosStatusOverride: null, expenseInvoicedDate: null },
        today: "2026-04-07",
        expected: true,
      },
      {
        line: { status: "INVOICED", cosStatusOverride: null, expenseInvoicedDate: null },
        today: "2026-04-07",
        expected: true,
      },
      {
        line: { status: "COMMITTED", cosStatusOverride: null, expenseInvoicedDate: "2026-03-10" },
        today: "2026-04-07",
        expected: true,
      },
      {
        line: { status: "COMMITTED", cosStatusOverride: null, expenseInvoicedDate: "2026-04-01" },
        today: "2026-04-07",
        expected: false,
      },
      {
        line: { status: "INVOICED", cosStatusOverride: "PLANNED", expenseInvoicedDate: null },
        today: "2026-04-07",
        expected: false,
      },
      {
        line: { status: "PLANNED", cosStatusOverride: "COS REALISED", expenseInvoicedDate: null },
        today: "2026-04-07",
        expected: true,
      },
      {
        line: { status: null, cosStatusOverride: null, cosRealised: true, expenseInvoicedDate: null },
        today: "2026-04-07",
        expected: true,
      },
    ];

    for (const { line, today, expected } of cases) {
      const policyResult = isCosRealised(line, today);
      const canonicalResult = isCanonicalCosRealised({
        status: line.status,
        cosStatusOverride: line.cosStatusOverride,
        cosRealised: ("cosRealised" in line ? line.cosRealised : null) ?? null,
        expenseInvoiceNumber: ("expenseInvoiceNumber" in line ? line.expenseInvoiceNumber : null) ?? null,
        expenseInvoicedDate: line.expenseInvoicedDate,
        expensePoNumber: ("expensePoNumber" in line ? line.expensePoNumber : null) ?? null,
        paymentDate: ("paymentDate" in line ? line.paymentDate : null) ?? null,
        today,
      });
      expect(policyResult).toBe(canonicalResult);
      expect(policyResult).toBe(expected);
    }
  });

  it("isCosRealised accepts minimal line shape (optional fields omitted)", () => {
    // The wrapper makes most fields optional — verify it does not throw
    const result = isCosRealised(
      { status: "PAID", cosStatusOverride: null, expenseInvoicedDate: null },
      "2026-04-07",
    );
    expect(result).toBe(true);
  });
});

describe("finance-policy.ts — module structure", () => {
  it("exports the required policy functions", async () => {
    const policy = await import("../../../server/policies/finance-policy");
    expect(policy).toHaveProperty("isCosRealised");
    expect(policy).toHaveProperty("isCanonicalCosRealised");
    expect(policy).toHaveProperty("requireProjectId");
    expect(policy).toHaveProperty("blockProgramExpenseWrite");
    expect(policy).toHaveProperty("requireTransaction");
    expect(policy).toHaveProperty("hasFinanceModelChanges");
    expect(policy).toHaveProperty("FINANCE_MODEL_PATHS");
  });
});
