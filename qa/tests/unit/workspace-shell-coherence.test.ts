import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY } from "@/config/page-registry";

describe("workspace shell coherence", () => {
  it("registers key workspace pages with sidebar visibility", () => {
    // Aligned to the COO-spec nav (2026-05-11): six top-level tabs only. The
    // Clients page (Project Development surface) is no longer in the default
    // sidebar — it is hidden behind Functionality Control. Any page kept here
    // must be one of the canonical six-tab destinations.
    const sidebarPageIds = ["myWork", "projects", "cashflow", "engineering", "quality"];

    for (const id of sidebarPageIds) {
      const page = PAGE_REGISTRY.find((p) => p.id === id);
      expect(page, `${id} must exist in PAGE_REGISTRY`).toBeDefined();
      expect(page!.showInSidebar, `${id} must be visible in sidebar`).toBe(true);
    }
  });

  it("assigns permission entities to key workspace pages", () => {
    const expectedEntities: Record<string, string> = {
      clients: "pd_clients",
      myWork: "home",
      projects: "projects",
      cashflow: "cashflow",
    };

    for (const [id, entity] of Object.entries(expectedEntities)) {
      const page = PAGE_REGISTRY.find((p) => p.id === id);
      expect(page, `${id} must exist`).toBeDefined();
      expect(page!.permissionEntity, `${id} permission entity`).toBe(entity);
    }
  });

  it("assigns route component keys to key workspace pages", () => {
    const pageIds = ["clients", "myWork", "projects", "cashflow"];

    for (const id of pageIds) {
      const page = PAGE_REGISTRY.find((p) => p.id === id);
      expect(page, `${id} must exist`).toBeDefined();
      expect(page!.routeComponentKey, `${id} must have a routeComponentKey`).toBeTruthy();
    }
  });
});
