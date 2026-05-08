import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// T1.x audit Surprise 3:
// `getCompanyOverviewData()` was computing Finance vs-target KPIs against
// magic-constant denominators:
//   target = totalPlannedRevenue * 0.75 (revenue / cash)
//   target = totalPlannedCost * 0.75 (COS)
// "totalPlanned" was the sum of every line item ever captured for active
// projects, regardless of when each one was scheduled — so the same
// denominator was used in September (FY start) and August (FY end).
//
// The fix replaces the magic constants with FYTD-anchored sums:
//   target = sum of revenue lines whose expectedPaymentDate ∈ [fyStart, today]
//   target = sum of cost lines whose (invoiceDate ?? forecastPaymentDate) ∈ [fyStart, today]
//
// User decision (recorded with the PR): use captured forecast dates as
// the FYTD plan anchor.
describe("company-overview FYTD-anchored Finance KPI targets (T1.x Surprise 3)", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "server/services/company-overview-service.ts"),
    "utf8",
  );

  it("removes the totalPlannedRevenue * 0.75 magic constant for fin_revenue_vs_target", () => {
    expect(source).not.toMatch(/totalPlannedRevenue\s*\*\s*0\.75/);
  });

  it("removes the totalPlannedRevenue * 0.7 magic constant for fin_cash_collected_vs_target", () => {
    expect(source).not.toMatch(/totalPlannedRevenue\s*\*\s*0\.7\b/);
  });

  it("removes the totalPlannedCost * 0.75 magic constant for fin_cos_vs_target", () => {
    expect(source).not.toMatch(/totalPlannedCost\s*\*\s*0\.75/);
  });

  it("introduces an FYTD-to-today helper anchored on fyStart and today", () => {
    expect(source).toContain("isInFytdToToday");
    expect(source).toMatch(/d\s*>=\s*fyStart\s*&&\s*d\s*<=\s*today/);
  });

  it("revenue plan uses expectedPaymentDate as the FYTD anchor", () => {
    expect(source).toContain("revenuePlannedFytd");
    expect(source).toMatch(/isInFytdToToday\(\(r as any\)\.expectedPaymentDate\)/);
  });

  it("cost plan uses invoiceDate ?? forecastPaymentDate as the FYTD anchor", () => {
    expect(source).toContain("costPlannedFytd");
    expect(source).toMatch(/\(r as any\)\.invoiceDate \|\| \(r as any\)\.forecastPaymentDate/);
  });

  it("fin_revenue_vs_target target is the FYTD-anchored revenue plan", () => {
    expect(source).toMatch(
      /fin_revenue_vs_target.*actual:\s*realisedRevenueFytd,\s*target:\s*revenuePlannedFytd/s,
    );
  });

  it("fin_cash_collected_vs_target target is the FYTD-anchored revenue plan", () => {
    expect(source).toMatch(
      /fin_cash_collected_vs_target.*actual:\s*cashReceivedFytd,\s*target:\s*revenuePlannedFytd/s,
    );
  });

  it("fin_cos_vs_target target is the FYTD-anchored cost plan", () => {
    expect(source).toMatch(
      /fin_cos_vs_target.*actual:\s*realisedCostFytd,\s*target:\s*costPlannedFytd/s,
    );
  });

  it("documents the change in source", () => {
    expect(source).toContain("FYTD-anchored targets per T1.x audit Surprise 3");
  });
});
