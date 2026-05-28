import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY, LEGACY_REDIRECTS, ROLE_LANDING_PAGE } from "@/config/page-registry";
import { ROUTE_COMPONENT_KEYS } from "@/config/route-components";
import { buildVisibleTopSections, ROLE_VISIBLE_SECTIONS } from "@/config/app-navigation";

const ADMIN_ROLES = ["CEO_ADMIN", "COO_ADMIN"] as const;

describe("navigation safety cleanup", () => {
  it("maintains routeComponentKey parity with ROUTE_COMPONENTS", () => {
    const keys = PAGE_REGISTRY
      .filter((page) => page.type !== "alias" && page.routeComponentKey)
      .map((page) => page.routeComponentKey as string);

    const missing = keys.filter((key) => !ROUTE_COMPONENT_KEYS.has(key));
    expect(missing).toEqual([]);
  });

  it("keeps legacy admin redirects canonical", () => {
    const byPath = new Map(LEGACY_REDIRECTS.map((r) => [r.path, r.redirectTo]));
    expect(byPath.get("/admin/control-center")).toBe("/settings");
    expect(byPath.get("/admin-settings")).toBe("/admin/settings");
  });

  it("routes CEO/COO to the canonical landing page (PR-B redesign: /now)", () => {
    // The original assertion locked the landing page to /execution-board
    // before PR-B. The redesign series (#962-#966) moved the COO/CEO
    // landing to /now — a single-screen "what needs attention?" surface
    // that replaces the 5-tab dashboard. /execution-board remains
    // reachable for one transition cycle but is no longer the landing.
    // The spirit of the original test — "don't dump executives into a
    // dense dashboard" — is preserved: /now is the simplification.
    expect(ROLE_LANDING_PAGE.CEO_ADMIN).toBe("/now");
    expect(ROLE_LANDING_PAGE.COO_ADMIN).toBe("/now");
  });

  it("hides Admin top section for non-admin roles", () => {
    for (const role of Object.keys(ROLE_VISIBLE_SECTIONS)) {
      if (ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number])) continue;

      const visible = buildVisibleTopSections({ companyRole: role, canViewPath: () => true });
      expect(visible.some((section) => section.key === "ADMIN"), `${role} should not see ADMIN`).toBe(false);
    }
  });
});
