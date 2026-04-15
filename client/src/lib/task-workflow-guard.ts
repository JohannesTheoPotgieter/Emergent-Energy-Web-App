import { hasDeliverableRequirementFlag } from "@shared/task-deliverable-requirement";
import { canonicalizeTaskStatus } from "@/lib/task-status-compat";

// Canonical lowercase_underscore status keys (post migration 20260413).
const COMPLETE_STATUSES = new Set(["complete"]);
const APPROVAL_STATUSES = new Set([
  "needs_approval",
  "qc_approved",
  "provide_feedback",
  "operational_approval",
]);

export type WorkflowTaskLike = {
  status?: string | null;
  approvalRequired?: boolean | null;
  linkedDeliverableId?: number | null;
  taskTypeTag?: string | null;
  tags?: string[] | null;
  hasSentDeliverable?: boolean;
};

export function getTaskWorkflowBlockReason(task: WorkflowTaskLike, requestedStatus: string): string | null {
  const next = canonicalizeTaskStatus(requestedStatus);
  const current = canonicalizeTaskStatus(task.status || "");
  const movingToComplete = COMPLETE_STATUSES.has(next);
  const movingToApproval = APPROVAL_STATUSES.has(next);
  const currentlyInApprovalFlow = APPROVAL_STATUSES.has(current);
  const deliverableRequired = hasDeliverableRequirementFlag(task);
  const deliverableSent = !!task.hasSentDeliverable;

  if (deliverableRequired && movingToComplete) {
    return "This task requires a deliverable. Use Send Deliverable.";
  }

  if (task.approvalRequired && movingToApproval && !currentlyInApprovalFlow) {
    if (deliverableRequired && !deliverableSent) {
      return "Approval cannot start until deliverable is sent.";
    }
    return "This task requires approval. Use Send for Approval.";
  }

  if (task.approvalRequired && movingToComplete && !currentlyInApprovalFlow) {
    return "This task requires approval. Use Send for Approval.";
  }

  return null;
}
