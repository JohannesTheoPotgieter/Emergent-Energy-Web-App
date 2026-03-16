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
    const approvalsPage = PAGE_REGISTRY.find((page) => page.id === "pmApprovals");
    const deliverablesPage = PAGE_REGISTRY.find((page) => page.id === "pmDeliverables");
    const dashboardPage = PAGE_REGISTRY.find((page) => page.id === "pmDashboard");

    expect(dashboardPage?.label).toBe("Execution Overview");
    expect(approvalsPage?.path).toBe("/pm/approvals");
    expect(deliverablesPage?.path).toBe("/pm/deliverables");
  });

  it("keeps the removed command-center route as a redirect instead of a live workspace", () => {
    const commandCenterPage = PAGE_REGISTRY.find((page) => page.id === "commandCenter");

    expect(commandCenterPage?.redirectTo).toBe("/my-work");
    expect(commandCenterPage?.routeComponentKey).toBeUndefined();
  });
});
