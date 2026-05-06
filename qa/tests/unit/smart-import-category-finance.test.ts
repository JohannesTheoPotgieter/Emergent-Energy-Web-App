/**
 * Smart Import — Category Finance Tests (S05-S08)
 *
 * Verifies:
 * 1. S05: Category key preservation (numeric prefix not stripped)
 * 2. S06: J_cat extraction from budget pane "Total Revenue" column
 * 3. S07: COS realisation rule tightening (placeholder + zero amount)
 * 4. S08: NormalizationResult carries categoryAllocations
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ---------------------------------------------------------------------------
// S05: Category key preservation
// ---------------------------------------------------------------------------
describe("S05: Category key preservation", () => {
  const normalizerCode = read("server/lib/import/normalizer.ts");

  it("does NOT strip numeric prefix from category names", () => {
    // The old pattern was: rawCategory.replace(/^\d+\.?\s*/, "").trim()
    // This should NOT appear in the category assignment logic anymore.
    // The new code uses normalizeCategoryKey() which preserves the number.
    expect(normalizerCode).toContain("function normalizeCategoryKey(raw: string): string");
    expect(normalizerCode).toContain("normalizeCategoryKey(rawCategory)");
  });

  it("exports normalizeCategoryKey function", () => {
    expect(normalizerCode).toContain("export function normalizeCategoryKey");
  });

  it("normalizeCategoryKey produces correct output", async () => {
    const { normalizeCategoryKey } = await import("../../../server/lib/import/normalizer");
    expect(normalizeCategoryKey("1. Panels")).toBe("1. Panels");
    expect(normalizeCategoryKey("1.Panels")).toBe("1. Panels");
    expect(normalizeCategoryKey("1 Panels")).toBe("1. Panels");
    expect(normalizeCategoryKey("7.BESS")).toBe("7. BESS");
    expect(normalizeCategoryKey("10. Site Logistics")).toBe("10. Site Logistics");
    expect(normalizeCategoryKey("Uncategorized")).toBe("Uncategorized");
  });

  it("costLines type includes categoryKey field", () => {
    expect(normalizerCode).toContain("categoryKey: string | null;");
  });

  it("line items are pushed with categoryKey", () => {
    expect(normalizerCode).toContain("categoryKey,");
    // The old stripped category logic should not be the assignment anymore
    expect(normalizerCode).not.toContain("cleanCat = rawCategory.replace(/^\\d+\\.?\\s*/");
  });
});

// ---------------------------------------------------------------------------
// S06: J_cat extraction from budget pane
// ---------------------------------------------------------------------------
describe("S06: J_cat extraction from budget pane", () => {
  const normalizerCode = read("server/lib/import/normalizer.ts");
  const synonymsCode = read("server/lib/import/synonyms.ts");

  it("EXPENDITURE_SYNONYMS includes category_revenue_allocation", () => {
    expect(synonymsCode).toContain("category_revenue_allocation:");
    expect(synonymsCode).toContain('"total revenue"');
  });

  it("EXPENDITURE_SYNONYMS includes category_cos_total", () => {
    expect(synonymsCode).toContain("category_cos_total:");
    expect(synonymsCode).toContain('"total cos"');
  });

  it("extractCostLines detects J_cat column from budget mappings", () => {
    expect(normalizerCode).toContain('getBudgetColIndex(bm, "category_revenue_allocation")');
  });

  it("extractCostLines has positional fallback for ERROR-on-REV headers", () => {
    expect(normalizerCode).toContain("HEADER_ERROR_POSITIONAL");
    expect(normalizerCode).toContain("JCAT_POSITIONAL_FALLBACK");
  });

  it("extractCostLines generates JCAT_COLUMN_MISSING issue when column not found", () => {
    expect(normalizerCode).toContain("JCAT_COLUMN_MISSING");
  });

  it("NormalizationResult type includes categoryAllocations array", () => {
    expect(normalizerCode).toContain("categoryAllocations: Array<{");
    expect(normalizerCode).toContain("revenueAllocation: number | null;");
    expect(normalizerCode).toContain('allocationSource: "DIRECT_EXTRACTION" | "HEADER_ERROR_POSITIONAL" | "NOT_FOUND"');
  });

  it("extractCostLines returns categoryAllocations", () => {
    // PR2C added `actualLineRows` to the return tuple to support 1:N
    // orphan-actual extraction. The categoryAllocations contract is
    // unchanged — still in the return shape, just alongside one more
    // field.
    expect(normalizerCode).toContain("return { lines, counterparties: Array.from(counterpartySet), categoryAllocations, actualLineRows };");
  });

  it("normalizeData wires categoryAllocations into the output", () => {
    expect(normalizerCode).toContain("categoryAllocations = result.categoryAllocations;");
    // The return object should include categoryAllocations
    expect(normalizerCode).toContain("categoryAllocations,");
  });

  it("J_cat reconciliation check compares SUM(J_cat) against grand total", () => {
    expect(normalizerCode).toContain("JCAT_RECONCILIATION_VARIANCE");
  });

  it("does NOT use budgetCos or budgetTotal as J_cat source", () => {
    // The revenue allocation comes from its own dedicated column, not budget proxies.
    // The category allocation entry should never set revenueAllocation from budgetCos/budgetTotal.
    const allocBlock = normalizerCode.slice(
      normalizerCode.indexOf("categoryAllocations.push({"),
      normalizerCode.indexOf("categoryAllocations.push({") + 500
    );
    expect(allocBlock).toContain("revenueAllocation,");
    // Verify revenueAllocation is read from jCatCol, not budgetCosCol or budgetTotalCol
    expect(normalizerCode).toContain("if (jCatCol >= 0)");
  });
});

// ---------------------------------------------------------------------------
// S07: COS realisation rule tightening
// ---------------------------------------------------------------------------
describe("S07: COS realisation tightening", () => {
  const cosCode = read("server/lib/finance/cos-realisation.ts");
  const normalizerCode = read("server/lib/import/normalizer.ts");

  it("CosLineInput interface includes amountExVat", () => {
    expect(cosCode).toContain("amountExVat?: string | number | null;");
  });

  it("exports PLACEHOLDER_INVOICES set", () => {
    expect(cosCode).toContain("export const PLACEHOLDER_INVOICES");
    expect(cosCode).toContain('"tbc"');
    expect(cosCode).toContain('"pending"');
    expect(cosCode).toContain('"n/a"');
  });

  it("isCanonicalCosRealised rejects placeholder invoices", () => {
    expect(cosCode).toContain("PLACEHOLDER_INVOICES.has(invoiceTrimmed.toLowerCase())");
  });

  it("isCanonicalCosRealised rejects zero-amount lines", () => {
    expect(cosCode).toContain("amount === 0) return false;");
  });

  it("backward compatibility: legacy cosRealised boolean still respected", () => {
    expect(cosCode).toContain("if (input.cosRealised === true) return true;");
  });

  it("backward compatibility: amountExVat check skipped when not provided", () => {
    // When amountExVat is undefined/null, the check is skipped
    expect(cosCode).toContain("input.amountExVat !== undefined && input.amountExVat !== null");
  });

  it("getCosRealisationWarnings includes PLACEHOLDER_INVOICE", () => {
    expect(cosCode).toContain('"PLACEHOLDER_INVOICE"');
  });

  describe("isCanonicalCosRealised behavior", async () => {
    const { isCanonicalCosRealised, PLACEHOLDER_INVOICES } = await import(
      "../../../server/lib/finance/cos-realisation"
    );

    const base = {
      status: null,
      cosStatusOverride: null,
      cosRealised: null,
      expenseInvoicedDate: null,
      expenseInvoiceNumber: null,
      expensePoNumber: null,
      paymentDate: null,
      today: "2026-04-10",
    };

    it("valid invoice + non-zero amount = realised", () => {
      expect(isCanonicalCosRealised({ ...base, expenseInvoiceNumber: "INV-001", amountExVat: "1000" })).toBe(true);
    });

    it("valid invoice + zero amount = NOT realised", () => {
      expect(isCanonicalCosRealised({ ...base, expenseInvoiceNumber: "INV-001", amountExVat: "0" })).toBe(false);
    });

    it("valid invoice + amount not provided = realised (backward compat)", () => {
      expect(isCanonicalCosRealised({ ...base, expenseInvoiceNumber: "INV-001" })).toBe(true);
    });

    it.each([...PLACEHOLDER_INVOICES])("placeholder '%s' = NOT realised", (placeholder) => {
      expect(isCanonicalCosRealised({ ...base, expenseInvoiceNumber: placeholder, amountExVat: "1000" })).toBe(false);
    });

    it("admin override REALISED takes precedence over placeholder", () => {
      expect(isCanonicalCosRealised({ ...base, cosStatusOverride: "COS REALISED", expenseInvoiceNumber: "TBC" })).toBe(true);
    });

    it("admin override PLANNED takes precedence over valid invoice", () => {
      expect(isCanonicalCosRealised({ ...base, cosStatusOverride: "PLANNED", expenseInvoiceNumber: "INV-001", amountExVat: "1000" })).toBe(false);
    });

    it("legacy cosRealised=true still works for backward compat", () => {
      expect(isCanonicalCosRealised({ ...base, cosRealised: true })).toBe(true);
    });

    it("empty invoice = NOT realised", () => {
      expect(isCanonicalCosRealised({ ...base, expenseInvoiceNumber: "", amountExVat: "1000" })).toBe(false);
    });

    it("null invoice = NOT realised", () => {
      expect(isCanonicalCosRealised({ ...base, expenseInvoiceNumber: null, amountExVat: "1000" })).toBe(false);
    });
  });

  it("normalizer uses isValidInvoiceNumber for cosRealised derivation", () => {
    expect(normalizerCode).toContain("isValidInvoiceNumber(invoiceNumber) && hasAmount");
  });

  it("normalizer defines isValidInvoiceNumber with placeholder check", () => {
    expect(normalizerCode).toContain("function isValidInvoiceNumber");
    expect(normalizerCode).toContain("PLACEHOLDER_INVOICES.has(trimmed.toLowerCase())");
  });
});

// ---------------------------------------------------------------------------
// S08: Preview response carries categoryAllocations
// ---------------------------------------------------------------------------
describe("S08: NormalizationResult type + preview wiring", () => {
  const indexCode = read("server/lib/import/index.ts");

  it("SmartImportPreview includes normalization which now has categoryAllocations", () => {
    // The normalization field on SmartImportPreview is typed as NormalizationResult,
    // which now includes categoryAllocations. No change needed to index.ts itself —
    // the type flows through automatically.
    expect(indexCode).toContain("normalization: NormalizationResult");
  });

  it("NormalizationResult is re-exported from index.ts", () => {
    expect(indexCode).toContain("export { type NormalizationResult }");
  });
});
