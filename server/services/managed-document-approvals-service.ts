/**
 * Managed-document approvals service (D6 Phase 5).
 *
 * Bridges the new `managed_documents` model into the existing `approvals`
 * engine (shared/schema/collaboration.ts). Replaces the legacy
 * controlled-documents submit/approve/reject/recall flow.
 *
 * Approval rows are written to the canonical `approvals` table with:
 *   approvalType        = MANAGED_DOCUMENT_APPROVAL_TYPE   ('managed_document')
 *   relatedEntityType   = MANAGED_DOCUMENT_APPROVAL_TYPE
 *   relatedEntityId     = managed_documents.id
 *
 * One row per approver. When the file's matching
 * `document_approval_requirement.requires_all_approvers` is true, every
 * row must reach status='approved' before the document moves to
 * state='approved'. When false, any single approval finalises it.
 *
 * Rejection always moves the document back to state='draft' (the rest of
 * the rows are cancelled). Cancellation is implemented as decisionNote
 * ('Cancelled by reject from <user>') so the audit trail keeps the full
 * round-trip.
 *
 * Goes through repositories where they exist; raw approvals queries are
 * kept here because there is no `approvals-repository.ts` today (the
 * legacy controlled-documents repo embeds approvals access — that's the
 * code we're retiring).
 */

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { approvals, type Approval } from "@shared/schema/collaboration";
import {
  managedDocuments,
  projectFolders,
  MANAGED_DOCUMENT_APPROVAL_TYPE,
  type ManagedDocument,
  type DocumentApprovalRequirement,
} from "@shared/schema/documents";
import { users, type User } from "@shared/schema/users";
import { getManagedDocumentById } from "../repositories/managed-documents-repository";
import { findMatchingRequirement } from "../repositories/document-approval-requirements-repository";
import { createNotification, notifyUsers } from "./notification-service";
import logger from "../lib/logger";

// =========================================================================
// Types returned to route handlers
// =========================================================================

export interface RequestApprovalInput {
  managedDocumentId: number;
  requestedByUserId: number;
  /** Approver user ids picked at submit time. Must be at least one. */
  approverUserIds: number[];
  /** Optional submitter comment, stored on every approvals row. */
  comment?: string;
}

export interface RequestApprovalResult {
  document: ManagedDocument;
  requirement: DocumentApprovalRequirement | null;
  approvals: Approval[];
}

export interface RecordApprovalInput {
  approvalId: number;
  userId: number;
  comment?: string;
}

export interface RecordApprovalResult {
  approval: Approval;
  document: ManagedDocument | null;
  /** True when this approval is the one that finalised the document. */
  documentFinalised: boolean;
}

export interface RecordRejectionInput {
  approvalId: number;
  userId: number;
  reason: string;
}

export interface RecordRejectionResult {
  approval: Approval;
  document: ManagedDocument | null;
  cancelledSiblings: number;
}

export interface QueueRow {
  approval: Approval;
  document: ManagedDocument | null;
  requestedBy: Pick<User, "id" | "name" | "email"> | null;
}

export interface ApproverCandidate {
  id: number;
  name: string;
  role: string;
}

export interface ApproverCandidatesResult {
  candidates: ApproverCandidate[];
  requiredRoles: string[] | null;
}

// =========================================================================
// Reads
// =========================================================================

/** Pending managed-document approvals assigned to the supplied user. */
export async function getApprovalQueueForUser(userId: number): Promise<QueueRow[]> {
  type Row = {
    approval: Approval;
    document: ManagedDocument | null;
    requestedBy: User | null;
  };
  const rows: Row[] = await db
    .select({
      approval: approvals,
      document: managedDocuments,
      requestedBy: users,
    })
    .from(approvals)
    .leftJoin(managedDocuments, eq(managedDocuments.id, approvals.relatedEntityId))
    .leftJoin(users, eq(users.id, approvals.requestedBy))
    .where(
      and(
        eq(approvals.assignedApprover, userId),
        eq(approvals.approvalType, MANAGED_DOCUMENT_APPROVAL_TYPE),
        eq(approvals.status, "pending"),
        isNull(approvals.deletedAt),
      ),
    )
    .orderBy(asc(approvals.requestedAt));

  return rows.map((r) => ({
    approval: r.approval,
    document: r.document ?? null,
    requestedBy: r.requestedBy
      ? { id: r.requestedBy.id, name: r.requestedBy.name, email: r.requestedBy.email }
      : null,
  }));
}

/** Every approval row attached to a managed document, newest first. */
export async function listApprovalsForDocument(documentId: number): Promise<Approval[]> {
  return db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.approvalType, MANAGED_DOCUMENT_APPROVAL_TYPE),
        eq(approvals.relatedEntityId, documentId),
        isNull(approvals.deletedAt),
      ),
    )
    .orderBy(desc(approvals.requestedAt));
}

// =========================================================================
// Writes
// =========================================================================

async function loadRequirementForDocument(
  doc: ManagedDocument,
): Promise<DocumentApprovalRequirement | null> {
  if (!doc.parentFolderId) return null;
  // Resolve the taxonomy key via project_folders -> folder_taxonomy.
  const [join] = await db
    .select({
      taxonomyKey: projectFolders.taxonomyKey,
    })
    .from(projectFolders)
    .where(eq(projectFolders.id, doc.parentFolderId))
    .limit(1);
  if (!join) return null;
  return findMatchingRequirement(join.taxonomyKey, doc.name);
}

/**
 * Submit a managed document for approval. Creates one approvals row per
 * approver, all in status='pending'. Moves the document to
 * state='in_review'. Idempotent guard: if there are already non-resolved
 * (pending) approvals for this document, the call rejects rather than
 * silently piling on duplicates.
 */
export async function requestApproval(input: RequestApprovalInput): Promise<RequestApprovalResult> {
  const { managedDocumentId, requestedByUserId, approverUserIds, comment } = input;

  if (!Array.isArray(approverUserIds) || approverUserIds.length === 0) {
    throw new Error("At least one approver is required.");
  }
  // Defensive: drop accidental duplicates without losing order.
  const dedup = Array.from(new Set(approverUserIds));

  const doc = await getManagedDocumentById(managedDocumentId);
  if (!doc) throw new Error(`Managed document ${managedDocumentId} not found.`);
  if (doc.projectId == null) {
    throw new Error(
      `Managed document ${managedDocumentId} has no projectId — approvals require a project context.`,
    );
  }

  const existing = await listApprovalsForDocument(managedDocumentId);
  if (existing.some((a) => a.status === "pending")) {
    throw new Error(
      "A pending approval round already exists for this document. Resolve or cancel it before submitting again.",
    );
  }

  const requirement = await loadRequirementForDocument(doc);

  // Reject if any nominated approver does not hold a role allowed by the requirement.
  if (requirement?.approverRoles && requirement.approverRoles.length > 0) {
    const allowedRoles = new Set(requirement.approverRoles);
    const approverRecords: Array<{ id: number; role: string }> = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(inArray(users.id, dedup));
    const approverMap = new Map<number, string>(
      approverRecords.map((r) => [r.id, r.role] as [number, string]),
    );
    const invalid = dedup.filter((id) => {
      const role = approverMap.get(id);
      return !role || !allowedRoles.has(role);
    });
    if (invalid.length > 0) {
      throw new Error(
        `Approver(s) with ID [${invalid.join(", ")}] do not hold a required role (${requirement.approverRoles.join(", ")}).`,
      );
    }
  }

  const insertRows = dedup.map((approverUserId) => ({
    type: MANAGED_DOCUMENT_APPROVAL_TYPE,
    title: requirement?.displayName ?? `Approve ${doc.name}`,
    description: comment ?? null,
    status: "pending" as const,
    requestedBy: requestedByUserId,
    relatedEntityType: MANAGED_DOCUMENT_APPROVAL_TYPE,
    relatedEntityId: managedDocumentId,
    assignedApprover: approverUserId,
    projectId: doc.projectId as number,
    approvalType: MANAGED_DOCUMENT_APPROVAL_TYPE,
  }));

  const inserted = await db.insert(approvals).values(insertRows).returning();

  const [updatedDoc] = await db
    .update(managedDocuments)
    .set({ state: "in_review", updatedAt: new Date() })
    .where(eq(managedDocuments.id, managedDocumentId))
    .returning();

  // Fan out notifications to every approver. Best-effort — failures are
  // logged but don't roll back the approval round.
  notifyUsers(dedup, {
    eventType: "managed_document.approval_requested",
    title: `Approval requested: ${doc.name}`,
    body: comment ? `“${comment}”` : `Submitted by user #${requestedByUserId}`,
    projectId: doc.projectId as number,
    relatedEntityType: MANAGED_DOCUMENT_APPROVAL_TYPE,
    relatedEntityId: managedDocumentId,
  }).catch((err) => {
    logger.error("[managed-doc-approvals] notify approvers failed:", err);
  });

  return {
    document: updatedDoc ?? doc,
    requirement,
    approvals: inserted,
  };
}

/**
 * An assigned approver records 'approved' on their row.
 *
 * If the document's requirement requires_all_approvers=true, the document
 * is finalised only when every assigned approver has signed off. When
 * requires_all_approvers=false, the first approval finalises the
 * document and remaining sibling rows are cancelled.
 */
export async function recordApproval(input: RecordApprovalInput): Promise<RecordApprovalResult> {
  const { approvalId, userId, comment } = input;

  const [target] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, approvalId), isNull(approvals.deletedAt)))
    .limit(1);
  if (!target) throw new Error(`Approval ${approvalId} not found.`);
  if (target.approvalType !== MANAGED_DOCUMENT_APPROVAL_TYPE) {
    throw new Error("This approval is not a managed-document approval.");
  }
  if (target.assignedApprover !== userId) {
    throw new Error("Only the assigned approver can act on this approval.");
  }
  if (target.status !== "pending") {
    throw new Error(`Approval is already ${target.status}.`);
  }

  const [decided] = await db
    .update(approvals)
    .set({
      status: "approved",
      decidedBy: userId,
      decidedAt: new Date(),
      decisionNote: comment ?? null,
    })
    .where(eq(approvals.id, approvalId))
    .returning();

  const documentId = target.relatedEntityId;
  if (typeof documentId !== "number") {
    return { approval: decided, document: null, documentFinalised: false };
  }

  const doc = await getManagedDocumentById(documentId);
  if (!doc) {
    return { approval: decided, document: null, documentFinalised: false };
  }

  const requirement = await loadRequirementForDocument(doc);
  const requiresAll = requirement?.requiresAllApprovers ?? false;

  const siblings = await listApprovalsForDocument(documentId);
  let finalised = false;

  if (requiresAll) {
    const allApproved = siblings.every((s) => s.status === "approved");
    if (allApproved) {
      const [updated] = await db
        .update(managedDocuments)
        .set({ state: "approved", updatedAt: new Date() })
        .where(eq(managedDocuments.id, documentId))
        .returning();
      finalised = true;
      // Tell the submitter the document is fully approved.
      if (target.requestedBy) {
        createNotification({
          recipientUserId: target.requestedBy,
          eventType: "managed_document.approved",
          title: `Approved: ${doc.name}`,
          body: comment ? `“${comment}”` : "All approvers signed off.",
          projectId: doc.projectId as number,
          relatedEntityType: MANAGED_DOCUMENT_APPROVAL_TYPE,
          relatedEntityId: documentId,
        }).catch((err) =>
          logger.error("[managed-doc-approvals] notify submitter (approved) failed:", err),
        );
      }
      return { approval: decided, document: updated ?? doc, documentFinalised: true };
    }
  } else {
    // Any-of-many — first approval wins. Cancel pending siblings.
    const pendingSiblings = siblings.filter(
      (s) => s.id !== decided.id && s.status === "pending",
    );
    if (pendingSiblings.length > 0) {
      await db
        .update(approvals)
        .set({
          status: "rejected",
          decidedBy: userId,
          decidedAt: new Date(),
          decisionNote: `Cancelled — sibling approval ${decided.id} resolved first.`,
        })
        .where(
          inArray(
            approvals.id,
            pendingSiblings.map((s) => s.id),
          ),
        );
    }
    const [updated] = await db
      .update(managedDocuments)
      .set({ state: "approved", updatedAt: new Date() })
      .where(eq(managedDocuments.id, documentId))
      .returning();
    finalised = true;
    // Any-of-many — first approval wins. Notify the submitter.
    if (target.requestedBy) {
      createNotification({
        recipientUserId: target.requestedBy,
        eventType: "managed_document.approved",
        title: `Approved: ${doc.name}`,
        body: comment ? `“${comment}”` : "Document approved.",
        projectId: doc.projectId as number,
        relatedEntityType: MANAGED_DOCUMENT_APPROVAL_TYPE,
        relatedEntityId: documentId,
      }).catch((err) =>
        logger.error("[managed-doc-approvals] notify submitter (approved) failed:", err),
      );
    }
    return { approval: decided, document: updated ?? doc, documentFinalised: true };
  }

  return { approval: decided, document: doc, documentFinalised: finalised };
}

/**
 * An assigned approver records 'rejected'. The document is moved back to
 * state='draft'. All pending sibling approvals are cancelled.
 */
export async function recordRejection(input: RecordRejectionInput): Promise<RecordRejectionResult> {
  const { approvalId, userId, reason } = input;

  if (!reason || !reason.trim()) {
    throw new Error("Rejection reason is required.");
  }

  const [target] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, approvalId), isNull(approvals.deletedAt)))
    .limit(1);
  if (!target) throw new Error(`Approval ${approvalId} not found.`);
  if (target.approvalType !== MANAGED_DOCUMENT_APPROVAL_TYPE) {
    throw new Error("This approval is not a managed-document approval.");
  }
  if (target.assignedApprover !== userId) {
    throw new Error("Only the assigned approver can act on this approval.");
  }
  if (target.status !== "pending") {
    throw new Error(`Approval is already ${target.status}.`);
  }

  const [decided] = await db
    .update(approvals)
    .set({
      status: "rejected",
      decidedBy: userId,
      decidedAt: new Date(),
      decisionNote: reason,
    })
    .where(eq(approvals.id, approvalId))
    .returning();

  const documentId = target.relatedEntityId;
  let cancelledSiblings = 0;
  let document: ManagedDocument | null = null;

  if (typeof documentId === "number") {
    document = await getManagedDocumentById(documentId);
    const siblings = await listApprovalsForDocument(documentId);
    const pendingSiblings = siblings.filter(
      (s) => s.id !== decided.id && s.status === "pending",
    );
    if (pendingSiblings.length > 0) {
      const cancelled = await db
        .update(approvals)
        .set({
          status: "rejected",
          decidedBy: userId,
          decidedAt: new Date(),
          decisionNote: `Cancelled — sibling approval ${decided.id} rejected.`,
        })
        .where(
          inArray(
            approvals.id,
            pendingSiblings.map((s) => s.id),
          ),
        )
        .returning();
      cancelledSiblings = cancelled.length;
    }
    const [updated] = await db
      .update(managedDocuments)
      .set({ state: "draft", updatedAt: new Date() })
      .where(eq(managedDocuments.id, documentId))
      .returning();
    document = updated ?? document;
    // Notify the submitter so they know the doc bounced and why.
    if (document?.projectId != null && target.requestedBy) {
      createNotification({
        recipientUserId: target.requestedBy,
        eventType: "managed_document.rejected",
        title: `Rejected: ${document.name}`,
        body: reason,
        projectId: document.projectId,
        relatedEntityType: MANAGED_DOCUMENT_APPROVAL_TYPE,
        relatedEntityId: documentId,
      }).catch((err) =>
        logger.error("[managed-doc-approvals] notify submitter (rejected) failed:", err),
      );
    }
  }

  return { approval: decided, document, cancelledSiblings };
}

/**
 * Returns the list of users eligible to approve a given managed document,
 * filtered to those who hold a role in the matching approval requirement
 * (if one is configured). Falls back to all active, non-deleted users when
 * no requirement or no approverRoles are set.
 */
export async function getApproverCandidatesForDocument(
  documentId: number,
): Promise<ApproverCandidatesResult> {
  const doc = await getManagedDocumentById(documentId);
  if (!doc) throw new Error(`Document ${documentId} not found`);
  const requirement = await loadRequirementForDocument(doc);

  const requiredRoles =
    requirement?.approverRoles && requirement.approverRoles.length > 0
      ? requirement.approverRoles
      : null;

  const rows: ApproverCandidate[] = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(
      requiredRoles
        ? and(isNull(users.deletedAt), eq(users.isActive, true), inArray(users.role, requiredRoles))
        : and(isNull(users.deletedAt), eq(users.isActive, true)),
    );

  return {
    candidates: rows.sort((a, b) => a.name.localeCompare(b.name)),
    requiredRoles,
  };
}
