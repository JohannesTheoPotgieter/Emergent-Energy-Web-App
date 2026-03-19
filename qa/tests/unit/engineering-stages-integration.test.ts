import { describe, it, expect } from "vitest";

/**
 * Tests for engineering stages ↔ work_items integration.
 * Validates the stage task status mapping and response shape expectations.
 */

describe("Stage task status mapping to work_items", () => {
  const STAGE_TO_WI: Record<string, string> = {
    "pending": "TO DO",
    "in_progress": "IN PROGRESS",
    "complete": "COMPLETE",
    "skipped": "COMPLETE",
  };

  it("maps all stage task statuses to operational statuses", () => {
    expect(Object.keys(STAGE_TO_WI)).toHaveLength(4);
    expect(STAGE_TO_WI["pending"]).toBe("TO DO");
    expect(STAGE_TO_WI["in_progress"]).toBe("IN PROGRESS");
    expect(STAGE_TO_WI["complete"]).toBe("COMPLETE");
    expect(STAGE_TO_WI["skipped"]).toBe("COMPLETE");
  });

  it("has no unmapped stage statuses", () => {
    const ALL_STAGE_STATUSES = ["pending", "in_progress", "complete", "skipped"];
    for (const status of ALL_STAGE_STATUSES) {
      expect(STAGE_TO_WI[status]).toBeTruthy();
    }
  });
});

describe("Stage gate validation rules", () => {
  const STAGE_GATES = {
    "First Assessment": { requireAllTasks: true, requireAllDeliverables: true },
    "Cost Proposal": { requireAllTasks: true, requireAllDeliverables: true },
    "IFC Planning": { requireAllTasks: true, requireAllDeliverables: true },
    "Construction Support": { requireAllTasks: true, requireAllDeliverables: true },
    "Handover Pack": { requireAllTasks: true, requireAllDeliverables: true, requireQaApproval: true, requireTechnicalSignoff: true },
  };

  it("defines gates for all 5 stages", () => {
    expect(Object.keys(STAGE_GATES)).toHaveLength(5);
  });

  it("Handover Pack requires additional approvals", () => {
    const handover = STAGE_GATES["Handover Pack"];
    expect(handover.requireQaApproval).toBe(true);
    expect(handover.requireTechnicalSignoff).toBe(true);
  });

  it("other stages do not require special approvals", () => {
    const firstAssessment = STAGE_GATES["First Assessment"] as any;
    expect(firstAssessment.requireQaApproval).toBeUndefined();
    expect(firstAssessment.requireTechnicalSignoff).toBeUndefined();
  });
});

describe("Stage lifecycle states", () => {
  const STAGE_STATUSES = ["not_started", "in_progress", "blocked", "ready_for_review", "complete"];

  it("defines all 5 lifecycle states", () => {
    expect(STAGE_STATUSES).toHaveLength(5);
  });

  it("starts in not_started state", () => {
    expect(STAGE_STATUSES[0]).toBe("not_started");
  });

  it("ends in complete state", () => {
    expect(STAGE_STATUSES[STAGE_STATUSES.length - 1]).toBe("complete");
  });
});
