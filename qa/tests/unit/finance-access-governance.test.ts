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

    expect(cashflowSource).toContain('usePermission("cashflow", "edit")');
    expect(cashflowSource).not.toContain("isAdmin");
    expect(revenueTrackerSource).toContain('usePermission("revenue_tracker", "edit")');
    expect(revenueTrackerSource).not.toContain("isAdmin");
  });

  it("keeps finance routes explicitly permission-gated in both the departmental and legacy route surfaces", () => {
    const financeRoutesSource = read("server/departments/finance-routes.ts");
    const legacyRoutesSource = read("server/routes.ts");

    expect(financeRoutesSource).toContain('router.post("/api/cashflow-2026/opening-balance", requireAuth, requirePermission("cashflow", "edit")');
    expect(financeRoutesSource).toContain('router.get("/api/cashflow-2026", requireAuth, requirePermission("cashflow", "view")');
    expect(financeRoutesSource).toContain('router.post("/api/tracker-monthly", requireAuth, requireTrackerPermission("edit")');
    expect(financeRoutesSource).toContain('router.get("/api/tracker-monthly/:type", requireAuth, requireTrackerPermission("view")');
    expect(financeRoutesSource).toContain('router.get("/api/revenue-tracker", requireAuth, requirePermission("revenue_tracker", "view")');

    expect(legacyRoutesSource).toContain('app.post("/api/cashflow-2026/available-payment", requireAuth, requirePermission("cashflow", "edit")');
    expect(legacyRoutesSource).toContain('app.get("/api/cashflow-2026/available-payment-history", requireAuth, requirePermission("cashflow", "view")');
    expect(legacyRoutesSource).toContain('app.post("/api/tracker-monthly", requireAuth, requireTrackerPermission("edit")');
    expect(legacyRoutesSource).toContain('app.get("/api/tracker-monthly/:type", requireAuth, requireTrackerPermission("view")');
  });
});
