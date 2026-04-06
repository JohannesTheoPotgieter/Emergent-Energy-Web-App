import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY } from "@/config/page-registry";

describe("project management structure", () => {
  it("keeps the execution workspace routes under Project Management", () => {
    const projectsPage = PAGE_REGISTRY.find((page) => page.id === "projects");
    const handoverControlPage = PAGE_REGISTRY.find((page) => page.id === "handoverControl");
    const executionBoardPage = PAGE_REGISTRY.find((page) => page.id === "executionBoard");

    expect(projectsPage?.navGroup).toBe("PROJECT_MANAGEMENT");
    expect(handoverControlPage?.navGroup).toBe("PROJECT_MANAGEMENT");
    expect(executionBoardPage?.navGroup).toBe("PROJECT_MANAGEMENT");
  });

  it("registers the approved PM execution sub-routes", () => {
    const dashboardPage = PAGE_REGISTRY.find((page) => page.id === "pmDashboard");
    const executionDashboardPage = PAGE_REGISTRY.find((page) => page.id === "executionBoard");
    const pmOnTheGoPage = PAGE_REGISTRY.find((page) => page.id === "pmOnTheGo");

    expect(executionDashboardPage?.label).toBe("Execution Board");
    expect(dashboardPage?.label).toBe("PM Dashboard");
    expect(pmOnTheGoPage?.label).toBe("PM On-The-Go");
    expect(PAGE_REGISTRY.some((page) => page.path === "/governance/approvals")).toBe(true);
  });

  it("removes command-center from active route inventory", () => {
    expect(PAGE_REGISTRY.some((page) => page.path === "/command-center")).toBe(false);
  });
});
