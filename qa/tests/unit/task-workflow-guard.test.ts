import { describe, it, expect } from "vitest";
import { assertTaskWorkflowTransition, type TaskWorkflowContext } from "../../../server/lib/task-workflow-guard";
import { DELIVERABLE_REQUIRED_TAG } from "@shared/task-deliverable-requirement";

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

  it("treats explicit deliverable-required tags as part of the same workflow rule", () => {
    expect(DELIVERABLE_REQUIRED_TAG).toBe("DELIVERABLE_REQUIRED");
    expect(() => assertTaskWorkflowTransition(baseContext({ deliverableRequired: true }), "COMPLETE", "bulk_status_update"))
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

  // ── C1 regression: the gate must match the CANONICAL lowercase_underscore
  //    statuses, not just the legacy UPPER+space forms. Before the fix the
  //    server sets held "NEEDS APPROVAL" etc. while callers pass "needs_approval",
  //    so `.has()` never matched and the approval gate was silently dead. ──────
  it("blocks approval-required task moving into canonical 'needs_approval' via status patch", () => {
    expect(() => assertTaskWorkflowTransition(baseContext({ approvalRequired: true }), "needs_approval", "status_update"))
      .toThrow("This task requires approval. Use Send for Approval.");
  });

  it("blocks approval-required task from canonical 'complete' via status patch", () => {
    expect(() => assertTaskWorkflowTransition(baseContext({ approvalRequired: true, currentStatus: "in_progress" }), "complete", "status_update"))
      .toThrow("This task requires approval. Use Send for Approval.");
  });

  it("blocks deliverable-required task from canonical 'complete' via status patch", () => {
    expect(() => assertTaskWorkflowTransition(baseContext({ deliverableRequired: true }), "complete", "status_update"))
      .toThrow("This task requires a deliverable. Use Send Deliverable.");
  });

  it("recognises a canonical approval status as 'already in the approval flow' (allows completion)", () => {
    // currentStatus is the canonical 'operational_approval'; before the casing
    // fix `currentlyInApprovalFlow` was always false, so this WOULD have thrown.
    expect(() => assertTaskWorkflowTransition(
      baseContext({ approvalRequired: true, currentStatus: "operational_approval" }),
      "complete",
      "status_update",
    )).not.toThrow();
  });

  it("lets an approval action move a task into an approval state (sign-off path)", () => {
    // recordSignOff records qc_approved / provide_feedback via 'approval_action';
    // the "use Send for Approval" gate must not block the approval system itself.
    expect(() => assertTaskWorkflowTransition(
      baseContext({ approvalRequired: true, currentStatus: "in_progress" }),
      "qc_approved",
      "approval_action",
    )).not.toThrow();
    expect(() => assertTaskWorkflowTransition(
      baseContext({ approvalRequired: true, currentStatus: "in_progress" }),
      "provide_feedback",
      "approval_action",
    )).not.toThrow();
  });
});
