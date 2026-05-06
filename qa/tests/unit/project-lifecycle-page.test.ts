import { describe, expect, it } from "vitest";
import ProjectLifecyclePage from "@/pages/project-lifecycle";
import { PAGE_REGISTRY, findPageByPath } from "@/config/page-registry";

describe("project lifecycle page wiring", () => {
  it("exports the Project Lifecycle page component", () => {
    expect(ProjectLifecyclePage).toBeTypeOf("function");
  });

  it("registers the approved Project Lifecycle routes without changing existing paths", () => {
    expect(findPageByPath("/project-lifecycle")?.id).toBe("projectLifecycle");
    expect(findPageByPath("/project-lifecycle/stage-gates")?.id).toBe("projectLifecycleStageGates");
    expect(findPageByPath("/project-lifecycle/latest-updates")?.id).toBe("projectLifecycleLatestUpdates");
    expect(findPageByPath("/project-lifecycle/client-overview")?.id).toBe("projectLifecycleClientOverview");
    expect(findPageByPath("/projects")?.id).toBe("projects");
    expect(findPageByPath("/lifecycle-board")?.id).toBe("lifecycle");
    expect(findPageByPath("/clients")?.id).toBe("clients");
  });

  it("maps the new workspace routes to the shared Project Lifecycle page component", () => {
    const workspaceRoutes = PAGE_REGISTRY.filter((page) => page.path.startsWith("/project-lifecycle"));
    expect(workspaceRoutes.map((page) => page.routeComponentKey)).toEqual([
      "ProjectLifecyclePage",
      "ProjectLifecyclePage",
      "ProjectLifecyclePage",
      "ProjectLifecyclePage",
    ]);
  });
});
