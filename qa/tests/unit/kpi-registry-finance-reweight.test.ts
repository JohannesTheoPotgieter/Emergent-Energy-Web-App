import { describe, expect, it } from "vitest";
import { KPI_REGISTRY } from "@shared/config/kpi-registry";

// T1.x audit Surprise 2 (Option B re-weight, signed off in session triage):
// the Finance KPI weights were rebalanced to break the correlation between
// COS-derived metrics. Three KPIs (revenue, COS, GM) all draw on
// realisedRevenueFytd / realisedCostFytd / their ratio — so a single bad
// import previously moved 65/100 of Finance score together. The
// independent signals (cash collected, overdue debtors) carried only
// 35/100, despite cash being the most important finance signal.
//
// New balance:
//   • COS-derived (revenue + COS + GM) = 15 + 15 + 15 = 45
//   • Independent (cash + debtors)     = 30 + 25      = 55
const FIN_KPI_KEYS = [
  "fin_revenue_vs_target",
  "fin_cash_collected_vs_target",
  "fin_cos_vs_target",
  "fin_gross_margin_vs_target",
  "fin_overdue_debtors",
] as const;

describe("KPI registry — Finance re-weight (T1.x Surprise 2 Option B)", () => {
  const finKpis = KPI_REGISTRY.filter((k) => k.department === "Finance");

  it("Finance has exactly five KPIs", () => {
    expect(finKpis).toHaveLength(5);
    for (const key of FIN_KPI_KEYS) {
      expect(finKpis.some((k) => k.kpiKey === key)).toBe(true);
    }
  });

  it("Finance weights still sum to 100", () => {
    const total = finKpis.reduce((sum, k) => sum + k.weight, 0);
    expect(total).toBe(100);
  });

  it("fin_revenue_vs_target weight is 15 (was 25)", () => {
    expect(finKpis.find((k) => k.kpiKey === "fin_revenue_vs_target")!.weight).toBe(15);
  });

  it("fin_cash_collected_vs_target weight is 30 (was 20)", () => {
    expect(finKpis.find((k) => k.kpiKey === "fin_cash_collected_vs_target")!.weight).toBe(30);
  });

  it("fin_cos_vs_target weight is 15 (was 20)", () => {
    expect(finKpis.find((k) => k.kpiKey === "fin_cos_vs_target")!.weight).toBe(15);
  });

  it("fin_gross_margin_vs_target weight is 15 (was 20)", () => {
    expect(finKpis.find((k) => k.kpiKey === "fin_gross_margin_vs_target")!.weight).toBe(15);
  });

  it("fin_overdue_debtors weight is 25 (was 15)", () => {
    expect(finKpis.find((k) => k.kpiKey === "fin_overdue_debtors")!.weight).toBe(25);
  });

  it("COS-derived KPIs (revenue + COS + GM) total 45 of 100", () => {
    const cosDerived =
      finKpis.find((k) => k.kpiKey === "fin_revenue_vs_target")!.weight +
      finKpis.find((k) => k.kpiKey === "fin_cos_vs_target")!.weight +
      finKpis.find((k) => k.kpiKey === "fin_gross_margin_vs_target")!.weight;
    expect(cosDerived).toBe(45);
  });

  it("Independent signals (cash + debtors) total 55 of 100", () => {
    const independent =
      finKpis.find((k) => k.kpiKey === "fin_cash_collected_vs_target")!.weight +
      finKpis.find((k) => k.kpiKey === "fin_overdue_debtors")!.weight;
    expect(independent).toBe(55);
  });
});
