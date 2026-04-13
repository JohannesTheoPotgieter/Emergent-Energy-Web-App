/**
 * B8: Universal approval creation service.
 *
 * Provides a single entry point for creating approvals of any type.
 * All approval flows (handover, budget, VO, procurement, gate, etc.)
 * should use this service instead of inserting directly into the approvals table.
 */
import { db } from "../db";
import { approvals } from "@shared/schema/collaboration";

export type ApprovalType = "handover" | "budget" | "vo" | "procurement" | "gate" | "handover_pack" | "exception" | "po_approval" | "payment_release";
export type ApprovalUrgency = "critical" | "high" | "normal" | "low";

export interface CreateApprovalParams {
  approvalType: ApprovalType;
  type: string;                     // Legacy 'type' field for backward compat (e.g., "engineering", "quality", "general")
  title: string;
  description?: string;
  projectId: number;
  requestedByUserId: number;
  assignedApproverUserId?: number | null;
  relatedEntityType?: string;       // 'project', 'change_request', 'procurement_item', 'budget_baseline', 'deliverable', 'handover_pack'
  relatedEntityId?: number;
  urgency?: ApprovalUrgency;
  evidenceLinks?: string[];
  dueDate?: Date;
  approvalCategory?: string;
}

export async function createApproval(params: CreateApprovalParams) {
  const [row] = await db.insert(approvals).values({
    type: params.type,
    title: params.title,
    description: params.description ?? null,
    status: "pending",
    requestedBy: params.requestedByUserId,
    projectId: params.projectId,
    assignedApprover: params.assignedApproverUserId ?? null,
    relatedEntityType: params.relatedEntityType ?? null,
    relatedEntityId: params.relatedEntityId ?? null,
    dueDate: params.dueDate ?? null,
    approvalCategory: params.approvalCategory ?? null,
    // B8 universal fields
    approvalType: params.approvalType,
    urgency: params.urgency ?? "normal",
    evidenceLinks: params.evidenceLinks ? JSON.stringify(params.evidenceLinks) : null,
  }).returning();

  return row;
}

/**
 * Create a budget baseline approval.
 * Called when a user locks a budget baseline.
 */
export async function createBudgetApproval(params: {
  projectId: number;
  baselineId: number;
  requestedByUserId: number;
  approverUserId: number | null;
  title: string;
}) {
  return createApproval({
    approvalType: "budget",
    type: "general",
    title: params.title,
    projectId: params.projectId,
    requestedByUserId: params.requestedByUserId,
    assignedApproverUserId: params.approverUserId,
    relatedEntityType: "budget_baseline",
    relatedEntityId: params.baselineId,
    urgency: "high",
  });
}

/**
 * Create a VO/change request approval.
 * Called when a VO exceeds a threshold.
 */
export async function createVoApproval(params: {
  projectId: number;
  changeRequestId: number;
  requestedByUserId: number;
  approverUserId: number | null;
  title: string;
  revenueImpact?: number;
}) {
  return createApproval({
    approvalType: "vo",
    type: "general",
    title: params.title,
    description: params.revenueImpact ? `Revenue impact: R${params.revenueImpact.toLocaleString()}` : undefined,
    projectId: params.projectId,
    requestedByUserId: params.requestedByUserId,
    assignedApproverUserId: params.approverUserId,
    relatedEntityType: "change_request",
    relatedEntityId: params.changeRequestId,
    urgency: "high",
  });
}

/**
 * Create a handover pack approval.
 * Called when a handover pack is submitted for review.
 */
export async function createHandoverPackApproval(params: {
  projectId: number;
  handoverPackId: number;
  packType: string;
  requestedByUserId: number;
  approverUserId: number | null;
}) {
  return createApproval({
    approvalType: "handover_pack",
    type: "general",
    title: `${params.packType.replace(/_/g, " ")} handover pack submitted for review`,
    projectId: params.projectId,
    requestedByUserId: params.requestedByUserId,
    assignedApproverUserId: params.approverUserId,
    relatedEntityType: "handover_pack",
    relatedEntityId: params.handoverPackId,
    urgency: "normal",
  });
}

/**
 * Create a stage gate approval.
 * Called when a project attempts to progress through a lifecycle gate.
 */
export async function createGateApproval(params: {
  projectId: number;
  gateName: string;
  requestedByUserId: number;
  approverUserId: number | null;
}) {
  return createApproval({
    approvalType: "gate",
    type: "general",
    title: `Gate approval required: ${params.gateName}`,
    projectId: params.projectId,
    requestedByUserId: params.requestedByUserId,
    assignedApproverUserId: params.approverUserId,
    relatedEntityType: "project",
    relatedEntityId: params.projectId,
    urgency: "high",
  });
}

/**
 * Create a PO approval.
 * Called when a PM submits a Purchase Order for multi-reviewer approval.
 */
export async function createPoApproval(params: {
  projectId: number;
  purchaseOrderId: number;
  requestedByUserId: number;
  title: string;
  total: number;
}) {
  return createApproval({
    approvalType: "po_approval",
    type: "general",
    title: params.title,
    description: `PO total: R${params.total.toLocaleString()}`,
    projectId: params.projectId,
    requestedByUserId: params.requestedByUserId,
    relatedEntityType: "purchase_order",
    relatedEntityId: params.purchaseOrderId,
    urgency: params.total > 100000 ? "high" : "normal",
  });
}

/**
 * Create a payment release approval.
 * Called when a payment batch is submitted for ManCo approval.
 */
export async function createPaymentReleaseApproval(params: {
  projectId: number;
  paymentBatchId: number;
  requestedByUserId: number;
  totalAmount: number;
  batchNumber: string;
}) {
  return createApproval({
    approvalType: "payment_release",
    type: "general",
    title: `Payment batch ${params.batchNumber} — R${params.totalAmount.toLocaleString()} requires ManCo release`,
    projectId: params.projectId,
    requestedByUserId: params.requestedByUserId,
    relatedEntityType: "payment_batch",
    relatedEntityId: params.paymentBatchId,
    urgency: "critical",
  });
}
