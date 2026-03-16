import { hasDeliverableRequirementFlag } from "@shared/task-deliverable-requirement";

const COMPLETE_STATUSES = new Set(["COMPLETE", "DONE", "CLOSED"]);
const APPROVAL_STATUSES = new Set(["NEEDS APPROVAL", "QC APPROVED", "PROVIDE FEEDBACK", "OPERATIONAL APPROVAL"]);

export type WorkflowTaskLike = {
  status?: string | null;
  approvalRequired?: boolean | null;
  linkedDeliverableId?: number | null;
  taskTypeTag?: string | null;
  tags?: string[] | null;
  hasSentDeliverable?: boolean;
};

export function getTaskWorkflowBlockReason(task: WorkflowTaskLike, requestedStatus: string): string | null {
  const next = String(requestedStatus || "").toUpperCase();
  const current = String(task.status || "").toUpperCase();
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
