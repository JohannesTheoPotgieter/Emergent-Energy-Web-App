import { describe, expect, it } from "vitest";
import { LEGACY_REDIRECTS, PAGE_REGISTRY } from "@/config/page-registry";
import { DISPLAY_TOP_NAV } from "@/config/app-navigation";

describe("route proof contract", () => {
  it("keeps the test:route-proof script pointed at a real registry smoke test", () => {
    expect(PAGE_REGISTRY.length).toBeGreaterThan(50);
  });

  it("has canonical redirects for known stale bookmarks", () => {
    expect(LEGACY_REDIRECTS).toEqual(
      expect.arrayContaining([
        { path: "/reports", redirectTo: "/reports/center" },
      ]),
    );
  });

  it("surfaces Settings through the top-level Settings landing page", () => {
    expect(DISPLAY_TOP_NAV.find((item) => item.label === "Settings")?.path).toBe("/settings");
  });
});
