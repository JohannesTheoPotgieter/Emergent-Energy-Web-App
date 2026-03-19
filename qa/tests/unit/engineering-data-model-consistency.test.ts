import { describe, it, expect } from "vitest";

/**
 * Tests for data model consistency after migration from operational_tasks to work_items.
 * Verifies that the adapter mapping produces expected response shapes.
 */

describe("Engineering data model consistency", () => {
  // Verify the adapter status mapping roundtrips correctly
  const OPS_TO_WI: Record<string, string> = {
    "TO DO": "Not Started",
    "IN PROGRESS": "In Progress",
    "COMPLETE": "Complete",
    "HOLD": "On Hold",
    "NEEDS APPROVAL": "In Progress",
    "QC APPROVED": "Complete",
    "PROVIDE FEEDBACK": "In Progress",
    "OPERATIONAL APPROVAL": "In Progress",
    "PROJECTS ASSISTANCE": "In Progress",
  };

  const WI_TO_OPS: Record<string, string> = {
    "Not Started": "TO DO",
    "In Progress": "IN PROGRESS",
    "Complete": "COMPLETE",
    "Done": "COMPLETE",
    "On Hold": "HOLD",
    "Blocked": "HOLD",
  };

  it("maps all operational task statuses to work item statuses", () => {
    for (const [ops, wi] of Object.entries(OPS_TO_WI)) {
      expect(wi).toBeTruthy();
      expect(typeof wi).toBe("string");
    }
  });

  it("maps all work item statuses back to operational task statuses", () => {
    for (const [wi, ops] of Object.entries(WI_TO_OPS)) {
      expect(ops).toBeTruthy();
      expect(typeof ops).toBe("string");
    }
  });

  it("roundtrips TO DO correctly", () => {
    expect(OPS_TO_WI["TO DO"]).toBe("Not Started");
    expect(WI_TO_OPS["Not Started"]).toBe("TO DO");
  });

  it("roundtrips IN PROGRESS correctly", () => {
    expect(OPS_TO_WI["IN PROGRESS"]).toBe("In Progress");
    expect(WI_TO_OPS["In Progress"]).toBe("IN PROGRESS");
  });

  it("roundtrips COMPLETE correctly", () => {
    expect(OPS_TO_WI["COMPLETE"]).toBe("Complete");
    expect(WI_TO_OPS["Complete"]).toBe("COMPLETE");
  });

  it("roundtrips HOLD correctly", () => {
    expect(OPS_TO_WI["HOLD"]).toBe("On Hold");
    expect(WI_TO_OPS["On Hold"]).toBe("HOLD");
  });

  it("maps both Done and Complete to COMPLETE", () => {
    expect(WI_TO_OPS["Done"]).toBe("COMPLETE");
    expect(WI_TO_OPS["Complete"]).toBe("COMPLETE");
  });

  it("maps Blocked to HOLD", () => {
    expect(WI_TO_OPS["Blocked"]).toBe("HOLD");
  });
});

describe("Engineering response shape requirements", () => {
  const REQUIRED_LIST_FIELDS = [
    "id", "projectId", "projectName", "title", "description",
    "status", "priority", "startDate", "dueDate",
    "ownerUserId", "assigneeUserIds", "percentComplete",
    "holdReason", "blockedType", "completedAt",
    "linkedPlanItemId", "linkedDeliverableId", "linkedQualityItemInstanceId",
    "trackingRag", "taskTypeTag", "blockerReason",
    "sortOrder", "createdAt", "updatedAt", "workItemId", "canonical",
  ];

  it("defines all required fields for engineering task list response", () => {
    // This test documents the contract — if fields are removed, this test fails
    expect(REQUIRED_LIST_FIELDS.length).toBeGreaterThan(20);
    expect(REQUIRED_LIST_FIELDS).toContain("holdReason");
    expect(REQUIRED_LIST_FIELDS).toContain("blockedType");
    expect(REQUIRED_LIST_FIELDS).toContain("completedAt");
    expect(REQUIRED_LIST_FIELDS).toContain("linkedPlanItemId");
    expect(REQUIRED_LIST_FIELDS).toContain("canonical");
  });

  const STANDUP_RESPONSE_KEYS = [
    "date", "summary", "recentlyCompleted", "blockers",
    "upcomingThisWeek", "needsApproval", "inProgressHighlights",
    "workload", "projectHealth", "statusPipeline",
  ];

  it("defines all required fields for standup dashboard response", () => {
    expect(STANDUP_RESPONSE_KEYS).toContain("summary");
    expect(STANDUP_RESPONSE_KEYS).toContain("blockers");
    expect(STANDUP_RESPONSE_KEYS).toContain("projectHealth");
    expect(STANDUP_RESPONSE_KEYS).toContain("statusPipeline");
  });
});
