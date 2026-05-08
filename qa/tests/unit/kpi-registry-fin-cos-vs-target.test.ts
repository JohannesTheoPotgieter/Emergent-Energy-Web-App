import { describe, expect, it } from "vitest";
import { KPI_REGISTRY } from "@shared/config/kpi-registry";

// Defect 3 from the T1.x reporting trust audit: `fin_cos_vs_target` had
// `higherIsBetter: false`, so the dashboard painted high COS realisation
// as bad. Sister "vs target" KPIs (`fin_revenue_vs_target`,
// `fin_gross_margin_vs_target`) are all `higherIsBetter: true` because
// hitting/exceeding target is the goal.
describe("KPI registry — fin_cos_vs_target direction", () => {
  it("treats higher COS realisation vs target as better", () => {
    const kpi = KPI_REGISTRY.find((k) => k.kpiKey === "fin_cos_vs_target");
    expect(kpi).toBeDefined();
    expect(kpi!.higherIsBetter).toBe(true);
  });

  it("matches the direction of sibling Finance vs-target KPIs", () => {
    const cos = KPI_REGISTRY.find((k) => k.kpiKey === "fin_cos_vs_target");
    const revenue = KPI_REGISTRY.find((k) => k.kpiKey === "fin_revenue_vs_target");
    const margin = KPI_REGISTRY.find((k) => k.kpiKey === "fin_gross_margin_vs_target");
    expect(cos?.higherIsBetter).toBe(true);
    expect(revenue?.higherIsBetter).toBe(true);
    expect(margin?.higherIsBetter).toBe(true);
  });
});
