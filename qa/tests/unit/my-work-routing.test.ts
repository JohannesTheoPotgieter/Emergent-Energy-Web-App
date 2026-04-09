import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY } from "@/config/page-registry";

describe("my-work routing consolidation", () => {
  it("registers the /my-work route with a route component", () => {
    const myWorkPage = PAGE_REGISTRY.find((page) => page.path === "/my-work");

    expect(myWorkPage).toBeDefined();
    expect(myWorkPage!.routeComponentKey).toBe("MyWorkHomePage");
    expect(myWorkPage!.permissionEntity).toBe("home");
  });

  it("registers my-work sub-routes with proper component keys", () => {
    const tasks = PAGE_REGISTRY.find((page) => page.path === "/my-work/tasks");
    const calendar = PAGE_REGISTRY.find((page) => page.path === "/my-work/calendar");

    expect(tasks).toBeDefined();
    expect(tasks!.routeComponentKey).toBeTruthy();
    expect(calendar).toBeDefined();
    expect(calendar!.routeComponentKey).toBeTruthy();
  });
});
