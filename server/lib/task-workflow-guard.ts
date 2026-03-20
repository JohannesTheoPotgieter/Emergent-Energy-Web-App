import { and, eq } from "drizzle-orm";
import { hasDeliverableRequirementFlag } from "@shared/task-deliverable-requirement";
import { db } from "../db";
import { workItems, taskDeliverables } from "@shared/schema";

export type TaskWorkflowMutationSource = "status_update" | "bulk_status_update" | "send_for_approval" | "send_deliverable" | "approval_action";

const COMPLETE_STATUSES = new Set(["COMPLETE", "DONE", "CLOSED"]);
const APPROVAL_STATUSES = new Set(["NEEDS APPROVAL", "QC APPROVED", "PROVIDE FEEDBACK", "OPERATIONAL APPROVAL"]);

const DELIVERABLE_REQUIRED_MESSAGE = "This task requires a deliverable. Use Send Deliverable.";
const APPROVAL_REQUIRED_MESSAGE = "This task requires approval. Use Send for Approval.";
const DELIVERABLE_BEFORE_APPROVAL_MESSAGE = "Approval cannot start until deliverable is sent.";
const COMPLETE_BLOCKED_MESSAGE = "Complete is blocked until deliverable is sent.";

export type TaskWorkflowContext = {
  taskId: number;
  currentStatus: string;
  approvalRequired: boolean;
  deliverableRequired: boolean;
  deliverableSent: boolean;
};

export class TaskWorkflowGuardError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 409) {
    super(message);
    this.statusCode = statusCode;
    this.name = "TaskWorkflowGuardError";
  }
}

export async function buildTaskWorkflowContext(taskId: number, fallbackCurrentStatus?: string): Promise<TaskWorkflowContext> {
  const [task] = await db.select({
    id: workItems.id,
    status: workItems.status,
    approvalRequired: workItems.approvalRequired,
    linkedDeliverableId: workItems.linkedDeliverableId,
    taskTypeTag: workItems.taskTypeTag,
  }).from(workItems).where(eq(workItems.id, taskId));

  const [deliverable] = await db.select({ id: taskDeliverables.id })
    .from(taskDeliverables)
    .where(eq(taskDeliverables.taskId, taskId))
    .limit(1);

  const deliverableRequired = hasDeliverableRequirementFlag(task || {});

  return {
    taskId,
    currentStatus: task?.status || fallbackCurrentStatus || "TO DO",
    approvalRequired: !!task?.approvalRequired,
    deliverableRequired,
    deliverableSent: !!deliverable,
  };
}

export function assertTaskWorkflowTransition(
  context: TaskWorkflowContext,
  requestedStatus: string,
  source: TaskWorkflowMutationSource,
): void {
  const next = String(requestedStatus || "").toUpperCase();
  const current = String(context.currentStatus || "").toUpperCase();
  const movingToComplete = COMPLETE_STATUSES.has(next);
  const movingToApproval = APPROVAL_STATUSES.has(next);
  const currentlyInApprovalFlow = APPROVAL_STATUSES.has(current);

  if (source === "send_for_approval") {
    if (context.deliverableRequired && !context.deliverableSent) {
      throw new TaskWorkflowGuardError(DELIVERABLE_BEFORE_APPROVAL_MESSAGE);
    }
    return;
  }

  if (source === "send_deliverable") {
    return;
  }

  if (context.deliverableRequired && movingToComplete) {
    throw new TaskWorkflowGuardError(source === "status_update" || source === "bulk_status_update" ? DELIVERABLE_REQUIRED_MESSAGE : COMPLETE_BLOCKED_MESSAGE);
  }

  if (context.approvalRequired && movingToApproval && !currentlyInApprovalFlow) {
    if (context.deliverableRequired && !context.deliverableSent) {
      throw new TaskWorkflowGuardError(DELIVERABLE_BEFORE_APPROVAL_MESSAGE);
    }
    throw new TaskWorkflowGuardError(APPROVAL_REQUIRED_MESSAGE);
  }

  if (context.approvalRequired && movingToComplete && !currentlyInApprovalFlow && source !== "approval_action") {
    throw new TaskWorkflowGuardError(APPROVAL_REQUIRED_MESSAGE);
  }
}
