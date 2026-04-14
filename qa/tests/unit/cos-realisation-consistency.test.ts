/**
 * COS Realisation Consistency Tests
 *
 * Validates the canonical business rules:
 *   1. Admin override takes absolute precedence
 *   2. Invoice number is the ONLY hard check — if a supplier invoice is captured, COS is realised
 *   3. PO is NOT the gate for realisation
 *   4. Invoice without PO is a red flag but does NOT block realisation
 *   5. Status labels alone do NOT determine realisation
 *   6. "Committed from prior month" does NOT silently become realised without an invoice
 *   7. cosRealised boolean flag is respected as backward-compatible signal
 *   8. getCosRealisationWarnings() flags risk conditions
 *
 * Also validates:
 *   - finance-policy.ts re-exports isCosRealised as the single entry point
 *   - The policy module is importable and structurally sound
 */

import { describe, expect, it } from "vitest";
import {
  isCanonicalCosRealised,
  getCosRealisationWarnings,
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
// A. CANONICAL FUNCTION — invoice-only hard rule
// ---------------------------------------------------------------------------

describe("isCanonicalCosRealised — invoice is the ONLY hard check", () => {
  it("returns true when invoice number is present", () => {
    expect(isCanonicalCosRealised(makeLine({ expenseInvoiceNumber: "INV-001" }))).toBe(true);
  });

  it("returns true when invoice number is present (no PO)", () => {
    expect(isCanonicalCosRealised(makeLine({
      expenseInvoiceNumber: "INV-001",
      expensePoNumber: null,
    }))).toBe(true);
  });

  it("returns true when invoice number + PO are both present", () => {
    expect(isCanonicalCosRealised(makeLine({
      expenseInvoiceNumber: "INV-001",
      expensePoNumber: "PO-001",
    }))).toBe(true);
  });

  it("returns true when invoice number present but no invoice date", () => {
    expect(isCanonicalCosRealised(makeLine({
      expenseInvoiceNumber: "INV-001",
      expenseInvoicedDate: null,
    }))).toBe(true);
  });

  it("returns false when no invoice number, even with PO", () => {
    expect(isCanonicalCosRealised(makeLine({
      expensePoNumber: "PO-001",
    }))).toBe(false);
  });

  it("returns false for empty/whitespace invoice number", () => {
    expect(isCanonicalCosRealised(makeLine({ expenseInvoiceNumber: "" }))).toBe(false);
    expect(isCanonicalCosRealised(makeLine({ expenseInvoiceNumber: "  " }))).toBe(false);
  });

  it("returns false when all fields are null", () => {
    expect(isCanonicalCosRealised(makeLine())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B. STATUS LABELS DO NOT DETERMINE REALISATION
// ---------------------------------------------------------------------------

describe("isCanonicalCosRealised — status labels do NOT determine realisation", () => {
  it("status INVOICED without invoice number does NOT realise", () => {
    expect(isCanonicalCosRealised(makeLine({ status: "INVOICED" }))).toBe(false);
  });

  it("status PAID without invoice number does NOT realise", () => {
    expect(isCanonicalCosRealised(makeLine({ status: "PAID" }))).toBe(false);
  });

  it("status COS REALISED without invoice number does NOT realise", () => {
    expect(isCanonicalCosRealised(makeLine({ status: "COS REALISED" }))).toBe(false);
  });

  it("status REALISED without invoice number does NOT realise", () => {
    expect(isCanonicalCosRealised(makeLine({ status: "REALISED" }))).toBe(false);
  });

  it("status PLANNED without invoice number does NOT realise", () => {
    expect(isCanonicalCosRealised(makeLine({ status: "PLANNED" }))).toBe(false);
  });

  it("status COMMITTED without invoice number does NOT realise", () => {
    expect(isCanonicalCosRealised(makeLine({ status: "COMMITTED" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C. COMMITTED FROM PRIOR MONTH — does NOT silently promote
// ---------------------------------------------------------------------------

describe("isCanonicalCosRealised — committed from prior month", () => {
  it("committed with past-month invoice date but NO invoice number is NOT realised", () => {
    expect(isCanonicalCosRealised(makeLine({
      status: "COMMITTED",
      expenseInvoicedDate: "2026-03-15",
      today: "2026-04-07",
    }))).toBe(false);
  });

  it("committed with past-month invoice date AND invoice number IS realised (via invoice rule)", () => {
    expect(isCanonicalCosRealised(makeLine({
      status: "COMMITTED",
      expenseInvoiceNumber: "INV-001",
      expenseInvoicedDate: "2026-03-15",
      today: "2026-04-07",
    }))).toBe(true);
  });

  it("committed with same-month invoice date AND invoice number IS realised (via invoice rule)", () => {
    expect(isCanonicalCosRealised(makeLine({
      status: "COMMITTED",
      expenseInvoiceNumber: "INV-001",
      expenseInvoicedDate: "2026-04-01",
      today: "2026-04-07",
    }))).toBe(true);
  });

  it("committed with no invoice is NOT realised regardless of month", () => {
    expect(isCanonicalCosRealised(makeLine({
      status: "COMMITTED",
      expenseInvoicedDate: null,
      today: "2026-04-07",
    }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D. ADMIN OVERRIDE — takes absolute precedence
// ---------------------------------------------------------------------------

describe("isCanonicalCosRealised — cosStatusOverride", () => {
  it("override COS REALISED forces true regardless of invoice", () => {
    expect(isCanonicalCosRealised(makeLine({
      cosStatusOverride: "COS REALISED",
      expenseInvoiceNumber: null,
    }))).toBe(true);
  });

  it("override REALISED forces true regardless of invoice", () => {
    expect(isCanonicalCosRealised(makeLine({
      cosStatusOverride: "REALISED",
    }))).toBe(true);
  });

  it("override PLANNED forces false even when invoice is present", () => {
    expect(isCanonicalCosRealised(makeLine({
      expenseInvoiceNumber: "INV-001",
      cosStatusOverride: "PLANNED",
    }))).toBe(false);
  });

  it("override COMMITTED forces false even when invoice is present", () => {
    expect(isCanonicalCosRealised(makeLine({
      expenseInvoiceNumber: "INV-001",
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
      expenseInvoiceNumber: "INV-001",
      cosStatusOverride: null,
    }))).toBe(true);
    expect(isCanonicalCosRealised(makeLine({
      expenseInvoiceNumber: "INV-001",
      cosStatusOverride: "",
    }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E. LEGACY cosRealised BOOLEAN — backward-compatible signal
// ---------------------------------------------------------------------------

describe("isCanonicalCosRealised — cosRealised boolean flag", () => {
  it("cosRealised true causes realisation (backward compat)", () => {
    expect(isCanonicalCosRealised(makeLine({ cosRealised: true }))).toBe(true);
  });

  it("cosRealised false does not force realisation", () => {
    expect(isCanonicalCosRealised(makeLine({ cosRealised: false }))).toBe(false);
  });

  it("cosRealised null does not force realisation", () => {
    expect(isCanonicalCosRealised(makeLine({ cosRealised: null }))).toBe(false);
  });

  it("cosRealised true is overridden by PLANNED override", () => {
    expect(isCanonicalCosRealised(makeLine({
      cosRealised: true,
      cosStatusOverride: "PLANNED",
    }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F. DIAGNOSTIC WARNINGS
// ---------------------------------------------------------------------------

describe("getCosRealisationWarnings — flags risk conditions", () => {
  it("returns INVOICE_WITHOUT_PO when invoice present but no PO", () => {
    const warnings = getCosRealisationWarnings(makeLine({
      expenseInvoiceNumber: "INV-001",
      expensePoNumber: null,
    }));
    expect(warnings).toContain("INVOICE_WITHOUT_PO");
  });

  it("returns INVOICE_WITHOUT_DATE when invoice present but no date", () => {
    const warnings = getCosRealisationWarnings(makeLine({
      expenseInvoiceNumber: "INV-001",
      expenseInvoicedDate: null,
    }));
    expect(warnings).toContain("INVOICE_WITHOUT_DATE");
  });

  it("returns empty array when all invoice data is complete", () => {
    const warnings = getCosRealisationWarnings(makeLine({
      expenseInvoiceNumber: "INV-001",
      expenseInvoicedDate: "2026-03-15",
      expensePoNumber: "PO-001",
    }));
    expect(warnings).toEqual([]);
  });

  it("returns empty array for non-realised lines", () => {
    const warnings = getCosRealisationWarnings(makeLine());
    expect(warnings).toEqual([]);
  });

  it("returns both warnings when invoice has no PO and no date", () => {
    const warnings = getCosRealisationWarnings(makeLine({
      expenseInvoiceNumber: "INV-001",
      expensePoNumber: null,
      expenseInvoicedDate: null,
    }));
    expect(warnings).toContain("INVOICE_WITHOUT_PO");
    expect(warnings).toContain("INVOICE_WITHOUT_DATE");
    expect(warnings).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// G. FINANCE POLICY — isCosRealised wrapper and re-exports
// ---------------------------------------------------------------------------

describe("finance-policy.ts — isCosRealised wrapper", () => {
  it("isCosRealised is exported and is a function", () => {
    expect(typeof isCosRealised).toBe("function");
  });

  it("isCanonicalCosRealised is re-exported from finance-policy", () => {
    expect(typeof policyReExport).toBe("function");
    expect(policyReExport).toBe(isCanonicalCosRealised);
  });

  it("isCosRealised returns the same result as isCanonicalCosRealised for all key scenarios", () => {
    const cases: Array<{ line: Parameters<typeof isCosRealised>[0]; today: string; expected: boolean }> = [
      {
        line: { status: "PLANNED", cosStatusOverride: null, expenseInvoicedDate: null },
        today: "2026-04-07",
        expected: false,
      },
      {
        line: { status: null, cosStatusOverride: null, expenseInvoicedDate: null, expenseInvoiceNumber: "INV-001" },
        today: "2026-04-07",
        expected: true,
      },
      {
        line: { status: "INVOICED", cosStatusOverride: null, expenseInvoicedDate: null },
        today: "2026-04-07",
        expected: false, // status alone does NOT realise
      },
      {
        line: { status: "PAID", cosStatusOverride: null, expenseInvoicedDate: null },
        today: "2026-04-07",
        expected: false, // status alone does NOT realise
      },
      {
        line: { status: "COMMITTED", cosStatusOverride: null, expenseInvoicedDate: "2026-03-10" },
        today: "2026-04-07",
        expected: false, // committed from prior without invoice number does NOT realise
      },
      {
        line: { status: "COMMITTED", cosStatusOverride: null, expenseInvoicedDate: "2026-03-10", expenseInvoiceNumber: "INV-002" },
        today: "2026-04-07",
        expected: true, // has invoice number → realised
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
        expected: true, // backward-compat boolean
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
    // PAID status alone no longer realises — needs invoice
    const result = isCosRealised(
      { status: "PAID", cosStatusOverride: null, expenseInvoicedDate: null },
      "2026-04-07",
    );
    expect(result).toBe(false);

    // With invoice → realised
    const resultWithInvoice = isCosRealised(
      { status: "PAID", cosStatusOverride: null, expenseInvoicedDate: null, expenseInvoiceNumber: "INV-001" },
      "2026-04-07",
    );
    expect(resultWithInvoice).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H. MODULE STRUCTURE
// ---------------------------------------------------------------------------

describe("finance-policy.ts — module structure", () => {
  it("exports the required policy functions", async () => {
    const policy = await import("../../../server/policies/finance-policy");
    expect(policy).toHaveProperty("isCosRealised");
    expect(policy).toHaveProperty("isCanonicalCosRealised");
    expect(policy).toHaveProperty("requireProjectId");
    expect(policy).toHaveProperty("requireTransaction");
    expect(policy).toHaveProperty("hasFinanceModelChanges");
    expect(policy).toHaveProperty("FINANCE_MODEL_PATHS");
  });
});

// ---------------------------------------------------------------------------
// I. FOUR CONCEPT SEPARATION — cash vs realised must never be blended
// ---------------------------------------------------------------------------

describe("Four concept separation — cash received/paid vs COS/revenue realised", () => {
  it("a line with invoice but no payment is COS-realised but NOT cash-paid", () => {
    const line = makeLine({
      expenseInvoiceNumber: "INV-001",
      expenseInvoicedDate: "2026-03-15",
      paymentDate: null,
    });
    expect(isCanonicalCosRealised(line)).toBe(true);
    // Cash paid would check paymentDate — which is null
    expect(line.paymentDate).toBeNull();
  });

  it("a line with payment but no invoice is cash-paid but NOT COS-realised", () => {
    const line = makeLine({
      expenseInvoiceNumber: null,
      paymentDate: "2026-03-20",
    });
    expect(isCanonicalCosRealised(line)).toBe(false);
    // Cash paid would check paymentDate — which exists
    expect(line.paymentDate).not.toBeNull();
  });

  it("a line with both invoice and payment is both COS-realised AND cash-paid", () => {
    const line = makeLine({
      expenseInvoiceNumber: "INV-001",
      expenseInvoicedDate: "2026-03-15",
      paymentDate: "2026-03-20",
    });
    expect(isCanonicalCosRealised(line)).toBe(true);
    expect(line.paymentDate).not.toBeNull();
  });

  it("a line with neither invoice nor payment is neither realised nor paid", () => {
    const line = makeLine();
    expect(isCanonicalCosRealised(line)).toBe(false);
    expect(line.paymentDate).toBeNull();
  });
});
