import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// Defect 2 from the T1.x reporting trust audit:
// `getCompanyOverviewData()` was using a single `dateRef` fallback chain
// (paidDate → inBankDate → expectedPaymentDate → invoiceDate for revenue;
// paidDate → invoiceDate → approvedDate for costs) for both the FYTD
// recognition window AND the FYTD cash window. Per AGENT_GUARDRAILS § 3.4
// the cash window must use the receipt date (paidDate / inBankDate) ONLY,
// with no fallback to invoice or expected dates.
//
// This test pins the structural invariant by source-asserting the new
// shape: separate `recognitionDate` and `cashDate` variables, and a
// paidDate-only guard for cash-paid increments.
describe("company-overview cash FY-window separation (T1.x defect 2)", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "server/services/company-overview-service.ts"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  it("separates recognition vs cash FY-window variables", () => {
    expect(source).toContain("recognitionDate");
    expect(source).toContain("cashDate");
  });

  it("revenue cash window uses paidDate / inBankDate ONLY (no expected/invoice fallback)", () => {
    // Locate the revenue cashDate definition and assert the fallback chain
    // is only paidDate → inBankDate.
    const cashDateMatch = source.match(
      /const cashDate =\s*\(row as any\)\.paidDate \|\| \(row as any\)\.inBankDate;/,
    );
    expect(cashDateMatch).not.toBeNull();
  });

  it("cost cash window is gated by paidDate ONLY (no fallback chain)", () => {
    // The `cashPaidFytd` increment must live inside an `if (paidDate && isInFy(paidDate))`
    // block — never inside a block that uses a fallback dateRef.
    expect(source).toMatch(
      /if\s*\(\s*paidDate\s*&&\s*isInFy\(paidDate\)\s*\)\s*\{\s*cashPaidFytd\s*\+=\s*amount;/,
    );
  });

  it("recognition window keeps the original fallback chain (revenue side)", () => {
    // Recognition is a different question and is allowed to fall back to
    // invoice/expected dates. Pin this so a future cleanup doesn't
    // accidentally collapse them back into one variable.
    expect(source).toContain(
      "(row as any).paidDate ||\n      (row as any).inBankDate ||\n      (row as any).expectedPaymentDate ||\n      (row as any).invoiceDate",
    );
  });

  it("recognition window keeps the original fallback chain (cost side)", () => {
    expect(source).toContain(
      "(row as any).paidDate || (row as any).invoiceDate || (row as any).approvedDate",
    );
  });

  it("documents the § 3.4 cash-window rule in source", () => {
    expect(source).toContain("paidDate ONLY per § 3.4");
  });

  it("removes the legacy single `dateRef` fallback that conflated cash and recognition", () => {
    // The old code computed one `dateRef` per row that drove both windows.
    // After the fix there should be no `const dateRef = ...paidDate || ...invoiceDate...`
    // pattern in the FY aggregation block.
    expect(source).not.toMatch(/const dateRef =[^\n]*paidDate \|\| [^\n]*invoiceDate/);
  });
});
