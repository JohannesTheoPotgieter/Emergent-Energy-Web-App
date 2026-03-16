import { describe, expect, it } from "vitest";
import {
  PLATFORM_AUTHORITATIVE_SOURCES,
  PLATFORM_DEPARTMENT_IDS,
  createDepartmentWorkspaceContracts,
  listPlatformContractReferences,
  normalizeLifecycleStage,
  normalizePlatformPriority,
  normalizePlatformStatus,
  normalizeWorkflowActionState,
} from "../../../shared/platform-contracts";

describe("platform contracts", () => {
  it("normalizes lifecycle stages from internal codes and text labels", () => {
    expect(normalizeLifecycleStage("P4_CONSTRUCTION_INSTALLATION")).toMatchObject({
      lifecycleStage: "Construction",
      phaseLabel: "Construction",
    });

    expect(normalizeLifecycleStage("planning & design")).toMatchObject({
      lifecycleStage: "Planning",
      phaseLabel: "Planning",
    });
  });

  it("normalizes shared status and priority conventions", () => {
    expect(normalizePlatformStatus("Needs Approval")).toBe("review");
    expect(normalizePlatformStatus("on hold")).toBe("blocked");
    expect(normalizePlatformPriority("urgent")).toBe("CRITICAL");
    expect(normalizePlatformPriority("med")).toBe("NORMAL");
  });

  it("normalizes approval and deliverable workflow states", () => {
    expect(normalizeWorkflowActionState("approval", "approved")).toBe("approved");
    expect(normalizeWorkflowActionState("approval", "pending")).toBe("pending");
    expect(normalizeWorkflowActionState("deliverable", "NEEDS APPROVAL")).toBe("in_review");
    expect(normalizeWorkflowActionState("deliverable", "COMPLETE")).toBe("complete");
  });

  it("builds department workspaces from one shared contract", () => {
    const workspaces = createDepartmentWorkspaceContracts(77, "Construction");
    expect(workspaces).toHaveLength(PLATFORM_DEPARTMENT_IDS.length);
    expect(workspaces.find((workspace) => workspace.departmentId === "engineering")).toMatchObject({
      projectId: 77,
      lifecycleStage: "Construction",
    });
    expect(workspaces.every((workspace) => workspace.readEntities.length > 0)).toBe(true);
  });

  it("publishes authoritative source references for the platform spine", () => {
    const references = listPlatformContractReferences();
    expect(references.lifecyclePhases.length).toBeGreaterThan(5);
    expect(references.taskStatuses).toContain("IN PROGRESS");
    expect(PLATFORM_AUTHORITATIVE_SOURCES.projectSpine.table).toBe("project_info");
    expect(PLATFORM_AUTHORITATIVE_SOURCES.latestUpdate.table).toBe("project_editable_fields");
    expect(PLATFORM_AUTHORITATIVE_SOURCES.assignees.table).toBe("work_item_assignments");
  });
});
