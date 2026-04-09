import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY } from "@/config/page-registry";

describe("project management structure", () => {
  it("registers PM dashboard with the correct permission entity", () => {
    const pmDashboard = PAGE_REGISTRY.find((page) => page.id === "pmDashboard");

    expect(pmDashboard).toBeDefined();
    expect(pmDashboard!.permissionEntity).toBe("pm_dashboard");
    expect(pmDashboard!.routeComponentKey).toBe("PMDashboard");
  });

  it("registers PM On-The-Go with the correct permission entity", () => {
    const pmOnTheGo = PAGE_REGISTRY.find((page) => page.id === "pmOnTheGo");

    expect(pmOnTheGo).toBeDefined();
    expect(pmOnTheGo!.path).toBe("/pm/on-the-go");
    expect(pmOnTheGo!.permissionEntity).toBe("pm_on_the_go");
    expect(pmOnTheGo!.routeComponentKey).toBe("PMOnTheGoHome");
  });

  it("groups PM routes under PROJECT_MANAGEMENT nav group", () => {
    const pmDashboard = PAGE_REGISTRY.find((page) => page.id === "pmDashboard");
    const pmOnTheGo = PAGE_REGISTRY.find((page) => page.id === "pmOnTheGo");
    const projects = PAGE_REGISTRY.find((page) => page.id === "projects");

    expect(pmDashboard!.navGroup).toBe("PROJECT_MANAGEMENT");
    expect(pmOnTheGo!.navGroup).toBe("PROJECT_MANAGEMENT");
    expect(projects!.navGroup).toBe("PROJECT_MANAGEMENT");
  });
});
