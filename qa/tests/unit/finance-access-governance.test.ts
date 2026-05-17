import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTrackerPermissionEntity } from "../../../server/lib/finance-route-access";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// Quote- and whitespace-insensitive view — source files are auto-formatted
// (single quotes, multi-line call signatures); assert wiring, not layout.
function norm(s: string) {
  return s.replace(/['"]/g, '"').replace(/\s+/g, "");
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

    expect(norm(cashflowSource)).toContain(norm('usePermission("cashflow", "edit")'));
    expect(cashflowSource).not.toContain("isAdmin");
    expect(norm(revenueTrackerSource)).toContain(norm('usePermission("revenue_tracker", "edit")'));
    expect(revenueTrackerSource).not.toContain("isAdmin");
  });

  it("keeps finance routes explicitly permission-gated in both the departmental and legacy route surfaces", () => {
    const financeRoutesSource = read("server/departments/finance-routes.ts");
    const legacyRoutesSource = read("server/routes.ts");
    const cashflow2026RoutesSource = read("server/routes/register-cashflow-2026-routes.ts");

    expect(norm(financeRoutesSource)).toContain(norm('router.post("/api/cashflow-2026/opening-balance", requireAuth, requirePermission("cashflow", "edit")'));
    expect(norm(financeRoutesSource)).toContain(norm('router.get("/api/cashflow-2026", requireAuth, requirePermission("cashflow", "view")'));
    expect(norm(financeRoutesSource)).toContain(norm('router.post("/api/tracker-monthly", requireAuth, requireTrackerPermission("edit")'));
    expect(norm(financeRoutesSource)).toContain(norm('router.get("/api/tracker-monthly/:type", requireAuth, requireTrackerPermission("view")'));
    expect(norm(financeRoutesSource)).toContain(norm('router.get("/api/revenue-tracker", requireAuth, requirePermission("revenue_tracker", "view")'));

    // Cashflow-2026 routes extracted from routes.ts to register-cashflow-2026-routes.ts
    expect(norm(cashflow2026RoutesSource)).toContain(norm('app.post("/api/cashflow-2026/available-payment", requireAuth, requirePermission("cashflow", "edit")'));
    expect(norm(cashflow2026RoutesSource)).toContain(norm('app.get("/api/cashflow-2026/available-payment-history", requireAuth, requirePermission("cashflow", "view")'));
    // tracker-monthly routes consolidated into finance-routes.ts (checked above)
  });
});
