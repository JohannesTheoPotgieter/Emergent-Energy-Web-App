import { describe, it, expect } from "vitest";
import { assertTaskWorkflowTransition, type TaskWorkflowContext } from "../../../server/lib/task-workflow-guard";

const baseContext = (overrides: Partial<TaskWorkflowContext> = {}): TaskWorkflowContext => ({
  taskId: 1,
  currentStatus: "IN PROGRESS",
  approvalRequired: false,
  deliverableRequired: false,
  deliverableSent: false,
  ...overrides,
});

describe("task workflow guard", () => {
  it("blocks approval-required task from direct complete via status patch", () => {
    expect(() => assertTaskWorkflowTransition(baseContext({ approvalRequired: true }), "COMPLETE", "status_update"))
      .toThrow("This task requires approval. Use Send for Approval.");
  });

  it("blocks approval-required task from direct move into approval state via status patch", () => {
    expect(() => assertTaskWorkflowTransition(baseContext({ approvalRequired: true }), "NEEDS APPROVAL", "status_update"))
      .toThrow("This task requires approval. Use Send for Approval.");
  });

  it("blocks deliverable-required task from direct complete via status patch", () => {
    expect(() => assertTaskWorkflowTransition(baseContext({ deliverableRequired: true }), "COMPLETE", "status_update"))
      .toThrow("This task requires a deliverable. Use Send Deliverable.");
  });

  it("blocks task requiring both from direct approval and completion", () => {
    const both = baseContext({ approvalRequired: true, deliverableRequired: true, deliverableSent: false });
    expect(() => assertTaskWorkflowTransition(both, "NEEDS APPROVAL", "status_update"))
      .toThrow("Approval cannot start until deliverable is sent.");
    expect(() => assertTaskWorkflowTransition(both, "COMPLETE", "status_update"))
      .toThrow("This task requires a deliverable. Use Send Deliverable.");
  });

  it("allows Send Deliverable action", () => {
    expect(() => assertTaskWorkflowTransition(baseContext({ deliverableRequired: true }), "IN PROGRESS", "send_deliverable"))
      .not.toThrow();
  });

  it("allows Send for Approval after deliverable is sent", () => {
    expect(() => assertTaskWorkflowTransition(baseContext({ approvalRequired: true, deliverableRequired: true, deliverableSent: true }), "NEEDS APPROVAL", "send_for_approval"))
      .not.toThrow();
  });

  it("allows unrestricted task transitions", () => {
    expect(() => assertTaskWorkflowTransition(baseContext(), "COMPLETE", "status_update")).not.toThrow();
  });

  it("bulk route path also blocks invalid transitions", () => {
    expect(() => assertTaskWorkflowTransition(baseContext({ approvalRequired: true }), "COMPLETE", "bulk_status_update"))
      .toThrow("This task requires approval. Use Send for Approval.");
  });
});
