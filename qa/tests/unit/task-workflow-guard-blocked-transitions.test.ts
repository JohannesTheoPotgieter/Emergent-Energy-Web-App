import { describe, expect, it } from "vitest";
import { getTaskWorkflowBlockReason } from "@/lib/task-workflow-guard";

describe("getTaskWorkflowBlockReason blocked transitions", () => {
  it("blocks approval flow when required deliverable is not sent", () => {
    const reason = getTaskWorkflowBlockReason({ taskTypeTag: "deliverable_required", approvalRequired: true, hasSentDeliverable: false, status: "in_progress" }, "needs_approval");
    expect(reason).toBe("Approval cannot start until deliverable is sent.");
  });
});
