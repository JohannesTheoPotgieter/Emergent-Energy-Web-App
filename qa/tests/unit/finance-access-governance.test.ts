import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTrackerPermissionEntity } from "../../../server/lib/finance-route-access";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("finance access governance", () => {
  it("maps tracker types onto explicit finance permission entities", () => {
    expect(getTrackerPermissionEntity("REV")).toBe("revenue_tracker");
    expect(getTrackerPermissionEntity("rev")).toBe("revenue_tracker");
    expect(getTrackerPermissionEntity("COS")).toBe("cos");
    expect(getTrackerPermissionEntity("other")).toBeNull();
  });

  it("binds finance UI editing affordances to entity permissions instead of admin role shortcuts", () => {
    const cashflowSource = read("client/src/pages/cashflow.tsx");
    const revenueTrackerSource = read("client/src/pages/revenue-tracker.tsx");

    expect(cashflowSource).toMatch(/usePermission\(\s*['"]cashflow['"]\s*,\s*['"]edit['"]\s*\)/);
    expect(cashflowSource).not.toContain("isAdmin");
    expect(revenueTrackerSource).toMatch(/usePermission\(\s*['"]revenue_tracker['"]\s*,\s*['"]edit['"]\s*\)/);
    expect(revenueTrackerSource).not.toContain("isAdmin");
  });

  it("keeps finance routes explicitly permission-gated in both the departmental and legacy route surfaces", () => {
    const financeRoutesSource = read("server/departments/finance-routes.ts");

    expect(financeRoutesSource).toMatch(/router\.post\(\s*['"]\/api\/weekly-cashflow\/opening-balance['"][\s\S]*?requirePermission\(\s*['"]cashflow['"]\s*,\s*['"]edit['"]\s*\)/);
    expect(financeRoutesSource).toMatch(/router\.get\(\s*['"]\/api\/weekly-cashflow['"][\s\S]*?requirePermission\(\s*['"]cashflow['"]\s*,\s*['"]view['"]\s*\)/);
    expect(financeRoutesSource).toMatch(/router\.post\(\s*['"]\/api\/tracker-monthly['"][\s\S]*?requireTrackerPermission\(\s*['"]edit['"]\s*\)/);
    expect(financeRoutesSource).toMatch(/router\.get\(\s*['"]\/api\/tracker-monthly\/:type['"][\s\S]*?requireTrackerPermission\(\s*['"]view['"]\s*\)/);
    expect(financeRoutesSource).toMatch(/router\.get\(\s*['"]\/api\/revenue-tracker['"][\s\S]*?requirePermission\(\s*['"]revenue_tracker['"]\s*,\s*['"]view['"]\s*\)/);
    // tracker-monthly routes consolidated into finance-routes.ts (checked above)
  });
});
