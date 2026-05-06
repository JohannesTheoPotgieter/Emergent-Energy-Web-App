import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY } from "../../../client/src/config/page-registry";

/**
 * Project Management execution surfaces — verifies PM-related routes
 * exist in the page registry with the correct configuration.
 */

describe("project management execution surfaces", () => {
  it("pm/approvals route exists with correct permissionEntity", () => {
    const entry = PAGE_REGISTRY.find((p) => p.id === "pmApprovals");
    expect(entry).toBeDefined();
    expect(entry!.path).toBe("/pm/approvals");
    expect(entry!.permissionEntity).toBe("approvals");
  });

  it("pm/on-the-go route exists with correct permissionEntity", () => {
    const entry = PAGE_REGISTRY.find((p) => p.id === "pmOnTheGo");
    expect(entry).toBeDefined();
    expect(entry!.path).toBe("/pm/on-the-go");
    expect(entry!.permissionEntity).toBe("pm_on_the_go");
  });

  it("pm-dashboard route exists with correct permissionEntity", () => {
    const entry = PAGE_REGISTRY.find((p) => p.id === "pmDashboard");
    expect(entry).toBeDefined();
    expect(entry!.path).toBe("/pm-dashboard");
    expect(entry!.permissionEntity).toBe("pm_dashboard");
  });

  it("pmDeliverables is an alias redirecting to /pm/approvals", () => {
    const entry = PAGE_REGISTRY.find((p) => p.id === "pmDeliverables");
    expect(entry).toBeDefined();
    expect(entry!.type).toBe("alias");
    expect(entry!.redirectTo).toBe("/pm/approvals");
    expect(entry!.permissionEntity).toBe("deliverables");
  });
});
