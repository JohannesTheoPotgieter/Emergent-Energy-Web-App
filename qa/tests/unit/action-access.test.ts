import { describe, expect, it } from "vitest";
import { getAvailableQuickCreateActions } from "@/lib/action-access";

describe("quick create access", () => {
  it("shows only actions allowed by entity create permissions", () => {
    const actions = getAvailableQuickCreateActions({
      canViewPath: () => false,
      canAccessEntityAction: (entity, action) =>
        action === "create" && (entity === "pd_tickets" || entity === "eng_tasks"),
    });

    expect(actions.map((action) => action.id)).toEqual([
      "pd-ticket",
      "engineering-request",
      "task",
    ]);
  });

  it("allows handover from the project-edit permission even if the handover page link is hidden", () => {
    const actions = getAvailableQuickCreateActions({
      canViewPath: () => false,
      canAccessEntityAction: (entity, action) => entity === "projects" && action === "edit",
    });

    expect(actions.map((action) => action.id)).toContain("handover");
  });

  it("shows procurement quick actions only when PM On The Go is viewable", () => {
    const actions = getAvailableQuickCreateActions({
      canViewPath: (path) => path === "/pm/on-the-go" || path === "/handover-control",
      canAccessEntityAction: () => false,
    });

    expect(actions.map((action) => action.id)).toEqual([
      "handover",
      "create-po",
      "link-invoice",
    ]);
  });
});
