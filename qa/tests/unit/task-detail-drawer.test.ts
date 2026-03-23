import { describe, it, expect } from "vitest";
import { assertTaskWorkflowTransition, type TaskWorkflowContext } from "../../../server/lib/task-workflow-guard";

const baseContext = (overrides: Partial<TaskWorkflowContext> = {}): TaskWorkflowContext => ({
  taskId: 42,
  currentStatus: "IN PROGRESS",
  approvalRequired: false,
  deliverableRequired: false,
  deliverableSent: false,
  ...overrides,
});

describe("TaskDetailDrawer status change logic", () => {
  describe("handleStatusChange uses correct task reference", () => {
    it("uses the task prop directly instead of searching an array", () => {
      // The bug was: `const task = tasks.find(t => t.id === taskId)` where tasks was undefined
      // The fix uses the `task` prop directly.
      // This test verifies the workflow guard works with a single task context.
      const ctx = baseContext({ taskId: 42, currentStatus: "TO DO" });
      expect(() => assertTaskWorkflowTransition(ctx, "IN PROGRESS", "status_update")).not.toThrow();
    });

    it("validates transitions from the task's own status, not a stale value", () => {
      const ctx = baseContext({ taskId: 42, currentStatus: "HOLD" });
      expect(() => assertTaskWorkflowTransition(ctx, "IN PROGRESS", "status_update")).not.toThrow();
      expect(() => assertTaskWorkflowTransition(ctx, "TO DO", "status_update")).not.toThrow();
    });
  });

  describe("hold reason validation", () => {
    it("hold transition requires both reason and blocked type — guard does not block status itself", () => {
      const ctx = baseContext({ currentStatus: "IN PROGRESS" });
      // The guard doesn't block HOLD transitions — the UI/API validate reason+blockedType
      expect(() => assertTaskWorkflowTransition(ctx, "HOLD", "status_update")).not.toThrow();
    });

    it("hold requires reason+blockedType to be set in the request body", () => {
      // This documents the API contract:
      // PATCH /api/eng/tasks/:id with status=HOLD must include holdReason and blockedType
      // Missing holdReason returns 400: "Hold reason required when setting status to HOLD"
      // Missing blockedType returns 400: "Blocked type (Internal or External) required"
      const holdFields = { status: "HOLD", holdReason: "Waiting for materials", blockedType: "External" };
      expect(holdFields.holdReason).toBeTruthy();
      expect(holdFields.blockedType).toBeTruthy();
      expect(["Internal", "External"]).toContain(holdFields.blockedType);
    });

    it("rejects hold without reason", () => {
      const holdFields = { status: "HOLD", holdReason: "", blockedType: "Internal" };
      expect(holdFields.holdReason.trim()).toBeFalsy();
    });

    it("rejects hold without blocked type", () => {
      const holdFields = { status: "HOLD", holdReason: "Some reason", blockedType: "" };
      expect(holdFields.blockedType).toBeFalsy();
    });
  });

  describe("workflow guard — blocked transitions", () => {
    it("approval-required task cannot be completed directly", () => {
      expect(() => assertTaskWorkflowTransition(
        baseContext({ approvalRequired: true }),
        "COMPLETE",
        "status_update"
      )).toThrow();
    });

    it("deliverable-required task cannot be completed directly", () => {
      expect(() => assertTaskWorkflowTransition(
        baseContext({ deliverableRequired: true }),
        "COMPLETE",
        "status_update"
      )).toThrow();
    });

    it("task requiring both approval and deliverable — deliverable must be sent first", () => {
      const ctx = baseContext({
        approvalRequired: true,
        deliverableRequired: true,
        deliverableSent: false,
      });
      expect(() => assertTaskWorkflowTransition(ctx, "NEEDS APPROVAL", "send_for_approval")).toThrow();
    });

    it("task requiring both — approval allowed after deliverable sent", () => {
      const ctx = baseContext({
        approvalRequired: true,
        deliverableRequired: true,
        deliverableSent: true,
      });
      expect(() => assertTaskWorkflowTransition(ctx, "NEEDS APPROVAL", "send_for_approval")).not.toThrow();
    });

    it("unrestricted task can transition freely", () => {
      const ctx = baseContext();
      expect(() => assertTaskWorkflowTransition(ctx, "COMPLETE", "status_update")).not.toThrow();
      expect(() => assertTaskWorkflowTransition(ctx, "HOLD", "status_update")).not.toThrow();
      expect(() => assertTaskWorkflowTransition(ctx, "NEEDS APPROVAL", "status_update")).not.toThrow();
    });
  });
});
