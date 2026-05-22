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
    const legacyRoutesSource = read("server/routes.ts");
    const cashflow2026RoutesSource = read("server/routes/register-cashflow-2026-routes.ts");

    expect(financeRoutesSource).toMatch(/router\.post\(\s*['"]\/api\/cashflow-2026\/opening-balance['"][\s\S]*?requirePermission\(\s*['"]cashflow['"]\s*,\s*['"]edit['"]\s*\)/);
    expect(financeRoutesSource).toMatch(/router\.get\(\s*['"]\/api\/cashflow-2026['"][\s\S]*?requirePermission\(\s*['"]cashflow['"]\s*,\s*['"]view['"]\s*\)/);
    expect(financeRoutesSource).toMatch(/router\.post\(\s*['"]\/api\/tracker-monthly['"][\s\S]*?requireTrackerPermission\(\s*['"]edit['"]\s*\)/);
    expect(financeRoutesSource).toMatch(/router\.get\(\s*['"]\/api\/tracker-monthly\/:type['"][\s\S]*?requireTrackerPermission\(\s*['"]view['"]\s*\)/);
    expect(financeRoutesSource).toMatch(/router\.get\(\s*['"]\/api\/revenue-tracker['"][\s\S]*?requirePermission\(\s*['"]revenue_tracker['"]\s*,\s*['"]view['"]\s*\)/);

    // Cashflow-2026 routes extracted from routes.ts to register-cashflow-2026-routes.ts
    expect(cashflow2026RoutesSource).toMatch(/app\.post\(\s*['"]\/api\/cashflow-2026\/available-payment['"][\s\S]*?requirePermission\(\s*['"]cashflow['"]\s*,\s*['"]edit['"]\s*\)/);
    expect(cashflow2026RoutesSource).toMatch(/app\.get\(\s*['"]\/api\/cashflow-2026\/available-payment-history['"][\s\S]*?requirePermission\(\s*['"]cashflow['"]\s*,\s*['"]view['"]\s*\)/);
    // tracker-monthly routes consolidated into finance-routes.ts (checked above)
  });
});
