import { and, eq, inArray } from "drizzle-orm";
import { hasDeliverableRequirementFlag } from "@shared/task-deliverable-requirement";
import { requiresDocumentLink, DONE_GATE_OUTPUT_LINK_ROLE } from "@shared/engineering/delivery-task-catalog";
import { normalizeStatus } from "@shared/utils/status-normalization";
import { db } from "../db";
import { workItems, taskDeliverables, workItemDocumentLinks } from "@shared/schema";

export type TaskWorkflowMutationSource = "status_update" | "bulk_status_update" | "send_for_approval" | "send_deliverable" | "approval_action";

// Canonical lowercase_underscore status keys (post migration 20260413), matched
// via `normalizeStatus` so legacy space/upper forms ("NEEDS APPROVAL") and the
// canonical form ("needs_approval") both compare correctly. This mirrors the
// client guard (`client/src/lib/task-workflow-guard.ts`) exactly — previously
// these were UPPER+space literals that NEVER matched the normalized statuses,
// silently disabling the approval gate.
const COMPLETE_STATUSES = new Set(["complete", "done", "closed"]);
const APPROVAL_STATUSES = new Set(["needs_approval", "qc_approved", "provide_feedback", "operational_approval"]);

const DELIVERABLE_REQUIRED_MESSAGE = "This task requires a deliverable. Use Send Deliverable.";
const APPROVAL_REQUIRED_MESSAGE = "This task requires approval. Use Send for Approval.";
const DELIVERABLE_BEFORE_APPROVAL_MESSAGE = "Approval cannot start until deliverable is sent.";
const COMPLETE_BLOCKED_MESSAGE = "Complete is blocked until deliverable is sent.";
const DOCUMENT_LINK_REQUIRED_MESSAGE = "This task can't be marked done until a document is linked.";

export type TaskWorkflowContext = {
  taskId: number;
  currentStatus: string;
  approvalRequired: boolean;
  deliverableRequired: boolean;
  deliverableSent: boolean;
  /**
   * Engineering Done-gate (Phase 2): when the task's type produces a document
   * (catalog `requiresDocumentLink`), it cannot move to Done without a linked
   * document. Optional so non-engineering callers/tests are unaffected
   * (undefined → no requirement).
   */
  documentLinkRequired?: boolean;
  documentLinked?: boolean;
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
    .where(eq(taskDeliverables.workItemId, taskId))
    .limit(1);

  // Only an 'output' link satisfies the Done-gate — an 'evidence'/'reference'
  // link must NOT unblock Done (Batch 1: the linkRole filter was missing).
  const [documentLink] = await db.select({ id: workItemDocumentLinks.id })
    .from(workItemDocumentLinks)
    .where(and(
      eq(workItemDocumentLinks.workItemId, taskId),
      eq(workItemDocumentLinks.linkRole, DONE_GATE_OUTPUT_LINK_ROLE),
    ))
    .limit(1);

  const deliverableRequired = hasDeliverableRequirementFlag(task || {});

  return {
    taskId,
    currentStatus: task?.status || fallbackCurrentStatus || "TO DO",
    approvalRequired: !!task?.approvalRequired,
    deliverableRequired,
    deliverableSent: !!deliverable,
    documentLinkRequired: requiresDocumentLink(task?.taskTypeTag),
    documentLinked: !!documentLink,
  };
}

/**
 * Engineering PR 3 (Tier 3) — batched variant of `buildTaskWorkflowContext`
 * for bulk operations. Two queries total (workItems + taskDeliverables)
 * regardless of taskIds count, vs. the N×2 the per-id helper does.
 * Used by `POST /api/eng/tasks/bulk-update`.
 */
export async function buildTaskWorkflowContextsForIds(taskIds: number[]): Promise<Map<number, TaskWorkflowContext>> {
  const result = new Map<number, TaskWorkflowContext>();
  if (taskIds.length === 0) return result;

  const tasks = await db.select({
    id: workItems.id,
    status: workItems.status,
    approvalRequired: workItems.approvalRequired,
    linkedDeliverableId: workItems.linkedDeliverableId,
    taskTypeTag: workItems.taskTypeTag,
  }).from(workItems).where(inArray(workItems.id, taskIds));

  const deliverables = await db.select({ workItemId: taskDeliverables.workItemId })
    .from(taskDeliverables)
    .where(inArray(taskDeliverables.workItemId, taskIds));

  // Only 'output' links count toward the Done-gate (mirrors the single-task path).
  const documentLinks = await db.select({ workItemId: workItemDocumentLinks.workItemId })
    .from(workItemDocumentLinks)
    .where(and(
      inArray(workItemDocumentLinks.workItemId, taskIds),
      eq(workItemDocumentLinks.linkRole, DONE_GATE_OUTPUT_LINK_ROLE),
    ));

  const hasDeliverable = new Set<number>(deliverables.map((d: { workItemId: number }) => d.workItemId));
  const hasDocumentLink = new Set<number>(documentLinks.map((d: { workItemId: number }) => d.workItemId));

  for (const task of tasks) {
    result.set(task.id, {
      taskId: task.id,
      currentStatus: task.status || "TO DO",
      approvalRequired: !!task.approvalRequired,
      deliverableRequired: hasDeliverableRequirementFlag(task),
      deliverableSent: hasDeliverable.has(task.id),
      documentLinkRequired: requiresDocumentLink(task.taskTypeTag),
      documentLinked: hasDocumentLink.has(task.id),
    });
  }

  return result;
}

export function assertTaskWorkflowTransition(
  context: TaskWorkflowContext,
  requestedStatus: string,
  source: TaskWorkflowMutationSource,
): void {
  const next = normalizeStatus(requestedStatus);
  const current = normalizeStatus(context.currentStatus);
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

  // Engineering Done-gate: a document-output task cannot reach Done without a
  // linked document. Single chokepoint for "no Done without a linked document".
  if (context.documentLinkRequired && movingToComplete && !context.documentLinked) {
    throw new TaskWorkflowGuardError(DOCUMENT_LINK_REQUIRED_MESSAGE);
  }

  // The "use Send for Approval" gate blocks a MANUAL status flip straight into
  // an approval state. `approval_action` is the approval system itself acting
  // (e.g. a QC/operational sign-off recording its decision), so it is exempt —
  // just as it is exempt from the complete gate below.
  if (context.approvalRequired && movingToApproval && !currentlyInApprovalFlow && source !== "approval_action") {
    if (context.deliverableRequired && !context.deliverableSent) {
      throw new TaskWorkflowGuardError(DELIVERABLE_BEFORE_APPROVAL_MESSAGE);
    }
    throw new TaskWorkflowGuardError(APPROVAL_REQUIRED_MESSAGE);
  }

  if (context.approvalRequired && movingToComplete && !currentlyInApprovalFlow && source !== "approval_action") {
    throw new TaskWorkflowGuardError(APPROVAL_REQUIRED_MESSAGE);
  }
}
