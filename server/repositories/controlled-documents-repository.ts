/**
 * Controlled documents repository (D3.2).
 *
 * Read-path first. Mutations (submit, approve, reject, recall) land in
 * D3.3 — they reuse the existing public.approvals table via
 * approvalType='controlled_document', so this repository only holds the
 * reads plus a small summarisation helper.
 *
 * Conventions (CLAUDE.md):
 * - All DB access for controlled-documents endpoints goes through this
 *   repo — no direct db.select() / db.insert() in routes.
 * - No raw SQL unless guarded with parameterised sql`` template.
 * - No pg-specific cast syntax (::) — keep SQLite dev fallback alive.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  controlledDocuments,
  controlledDocumentTypes,
  projectSharepointRoots,
  CONTROLLED_DOCUMENT_APPROVAL_TYPE,
  type ControlledDocument,
  type ControlledDocumentType,
  type ControlledDocumentState,
  type ProjectSharepointRoot,
} from "@shared/schema/documents";
import { approvals, type Approval } from "@shared/schema/collaboration";
import { users, type User } from "@shared/schema/users";
import { projectInfo } from "@shared/schema/projects";
import { extractCostingValues } from "../services/excel-extraction-service";

// ---- Shapes returned to route handlers -----------------------------------

/** One row in the per-project "documents summary" view. */
export interface ProjectDocumentSummary {
  type: ControlledDocumentType;
  /** Latest approved row, or null if never approved yet. */
  approved: ControlledDocument | null;
  /** Number of drafts + submitted rows awaiting action. */
  pendingCount: number;
  /** Number of historical approved rows (superseded). */
  historyCount: number;
}

/** Full per-type detail for drill-in. */
export interface ProjectDocumentDetail {
  type: ControlledDocumentType;
  approved: ControlledDocument | null;
  /** Draft rows — user has uploaded but not yet submitted. */
  drafts: ControlledDocument[];
  /** Submitted rows — awaiting approver action. */
  submitted: ControlledDocument[];
  /** Rejected rows — still in Drafts folder with a rejection reason. */
  rejected: ControlledDocument[];
  /** Superseded + recalled rows ordered newest first. */
  history: ControlledDocument[];
}

// ---- Types catalogue -----------------------------------------------------

export async function listActiveDocumentTypes(): Promise<ControlledDocumentType[]> {
  try {
    return await db
      .select()
      .from(controlledDocumentTypes)
      .where(eq(controlledDocumentTypes.active, true))
      .orderBy(asc(controlledDocumentTypes.sortOrder), asc(controlledDocumentTypes.displayName));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/42P01|42703|does not exist|no such table/i.test(msg)) {
      console.warn("[controlled-documents] types table not migrated yet — returning empty list");
      return [];
    }
    throw err;
  }
}

/** Admin view — includes inactive types so super users can reactivate. */
export async function listAllDocumentTypes(): Promise<ControlledDocumentType[]> {
  try {
    return await db
      .select()
      .from(controlledDocumentTypes)
      .orderBy(asc(controlledDocumentTypes.sortOrder), asc(controlledDocumentTypes.displayName));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/42P01|42703|does not exist|no such table/i.test(msg)) {
      console.warn("[controlled-documents] admin types: tables not migrated yet — returning empty list");
      return [];
    }
    throw err;
  }
}

export async function getDocumentType(typeKey: string): Promise<ControlledDocumentType | null> {
  try {
    const rows = await db
      .select()
      .from(controlledDocumentTypes)
      .where(eq(controlledDocumentTypes.typeKey, typeKey))
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/42P01|42703|does not exist|no such table/i.test(msg)) {
      return null;
    }
    throw err;
  }
}

// ---- Per-project reads ---------------------------------------------------

/**
 * Returns a grouped-by-type summary for the given project. The front end
 * uses this to render the Documents strip on project cards and on the
 * CEO / COO home screens.
 *
 * Excludes soft-deleted rows (deletedAt IS NULL) everywhere.
 */
export async function getProjectDocumentSummary(projectId: number): Promise<ProjectDocumentSummary[]> {
  const types = await listActiveDocumentTypes();

  // Pull all non-deleted document rows for this project in a single query.
  const rows = await db
    .select()
    .from(controlledDocuments)
    .where(and(
      eq(controlledDocuments.projectId, projectId),
      isNull(controlledDocuments.deletedAt),
    ));

  // Group rows in memory — list is small (~13 types * a few per type).
  const byType = new Map<string, ControlledDocument[]>();
  for (const row of rows) {
    const list = byType.get(row.typeKey) ?? [];
    list.push(row);
    byType.set(row.typeKey, list);
  }

  return types.map((type) => {
    const list = byType.get(type.typeKey) ?? [];
    const approved = list.find((r) => r.state === "approved") ?? null;
    const pendingCount = list.filter((r) => r.state === "draft" || r.state === "submitted").length;
    const historyCount = list.filter((r) => r.state === "superseded" || r.state === "recalled").length;
    return { type, approved, pendingCount, historyCount };
  });
}

/**
 * Full per-type detail for drill-in. Returns {} shapes with empty arrays
 * rather than nulls for the list fields, so callers can map without null
 * checks on each list.
 */
export async function getProjectDocumentDetail(
  projectId: number,
  typeKey: string,
): Promise<ProjectDocumentDetail | null> {
  const type = await getDocumentType(typeKey);
  if (!type) return null;

  const rows: ControlledDocument[] = await db
    .select()
    .from(controlledDocuments)
    .where(and(
      eq(controlledDocuments.projectId, projectId),
      eq(controlledDocuments.typeKey, typeKey),
      isNull(controlledDocuments.deletedAt),
    ))
    .orderBy(desc(controlledDocuments.updatedAt));

  const approved = rows.find((r) => r.state === "approved") ?? null;
  const drafts = rows.filter((r) => r.state === "draft");
  const submitted = rows.filter((r) => r.state === "submitted");
  const rejected = rows.filter((r) => r.state === "rejected");
  const history = rows.filter((r) => r.state === "superseded" || r.state === "recalled");

  return { type, approved, drafts, submitted, rejected, history };
}

/** Used by the CEO home to auto-extract Costing headline numbers. */
export async function getApprovedDocument(
  projectId: number,
  typeKey: string,
): Promise<ControlledDocument | null> {
  const rows = await db
    .select()
    .from(controlledDocuments)
    .where(and(
      eq(controlledDocuments.projectId, projectId),
      eq(controlledDocuments.typeKey, typeKey),
      eq(controlledDocuments.state, "approved" as ControlledDocumentState),
      isNull(controlledDocuments.deletedAt),
    ))
    .limit(1);
  return rows[0] ?? null;
}

// ---- SharePoint root config ---------------------------------------------

export async function getProjectSharepointRoot(projectId: number): Promise<ProjectSharepointRoot | null> {
  const rows = await db
    .select()
    .from(projectSharepointRoots)
    .where(eq(projectSharepointRoots.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Assert that the project has a configured SharePoint root before any
 * mutation that would need to touch real folders. Returns the root for
 * convenience; throws a semantic error the route can convert to 409.
 */
export async function requireProjectSharepointRoot(projectId: number): Promise<ProjectSharepointRoot> {
  const root = await getProjectSharepointRoot(projectId);
  if (!root) {
    throw new Error(
      `Project ${projectId} has no SharePoint root configured. ` +
      `A super user must set one in Settings before documents can be tracked.`,
    );
  }
  return root;
}

// ---- Counters for home screens ------------------------------------------

/** Total pending submissions awaiting ANY approver — used on the COO home tile. */
export async function countPendingSubmissionsAcrossPortfolio(): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(controlledDocuments)
    .where(and(
      eq(controlledDocuments.state, "submitted" as ControlledDocumentState),
      isNull(controlledDocuments.deletedAt),
    ));
  return Number(result[0]?.count ?? 0);
}

// =========================================================================
// Mutations (D3.3)
//
// All flows operate on the existing public.approvals table (no new
// approvals machinery) — the only new state lives in controlled_documents.
// Transactions guarantee that:
//   - submission creates exactly one doc row + N approval rows atomically
//   - promotion supersedes the previous approved row in the same tx
//   - rejection marks the doc rejected AND all pending approvals rejected
// =========================================================================

/** Super-users can always be picked as approvers, regardless of role match. */
const SUPER_APPROVER_ROLES = new Set(["COO_ADMIN", "CEO_ADMIN"]);

/**
 * Validates that a picked approver user is eligible for the requested role
 * slot on this document type. Throws an Error the route converts to 403.
 */
function assertApproverEligible(
  user: Pick<User, "id" | "role" | "name" | "email">,
  requiredRole: string,
): void {
  if (user.role === requiredRole) return;
  if (SUPER_APPROVER_ROLES.has(user.role)) return; // super-user override allowed
  throw new Error(
    `User ${user.email} (${user.role}) cannot approve as ${requiredRole}. ` +
    `Assign a user who holds ${requiredRole} or a super-user (COO/CEO).`,
  );
}

export interface SubmissionInput {
  projectId: number;
  typeKey: string;
  fileName: string;
  sharepointPath: string;
  sharepointDriveId?: string | null;
  sharepointItemId?: string | null;
  fileSizeBytes?: number | null;
  submitComment?: string | null;
  /**
   * Positional approver list — length must match defaultApproverRoles on
   * the type. approverUserIds[i] must hold defaultApproverRoles[i] (or be
   * a super-user).
   */
  approverUserIds: number[];
  submittedByUserId: number;
}

export interface SubmissionResult {
  document: ControlledDocument;
  approvalIds: number[];
}

/**
 * Create a new controlled_documents row in state='submitted' plus one
 * approvals row per picked approver. All atomic.
 */
export async function createSubmission(input: SubmissionInput): Promise<SubmissionResult> {
  const type = await getDocumentType(input.typeKey);
  if (!type) throw new Error(`Unknown document type: ${input.typeKey}`);

  const requiredRoles = type.defaultApproverRoles ?? [];
  if (requiredRoles.length === 0) {
    throw new Error(`Document type '${type.typeKey}' has no approver roles configured.`);
  }
  if (input.approverUserIds.length !== requiredRoles.length) {
    throw new Error(
      `This document type requires ${requiredRoles.length} approver(s) — received ${input.approverUserIds.length}.`,
    );
  }

  // Load and validate each picked approver.
  type ApproverRow = { id: number; role: string; name: string; email: string };
  const approverUsers: ApproverRow[] = await db
    .select({ id: users.id, role: users.role, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, input.approverUserIds));
  if (approverUsers.length !== input.approverUserIds.length) {
    throw new Error("One or more approver users not found.");
  }
  const userById = new Map<number, ApproverRow>(approverUsers.map((u) => [u.id, u]));
  for (let i = 0; i < input.approverUserIds.length; i++) {
    const user = userById.get(input.approverUserIds[i]);
    if (!user) throw new Error(`Approver user ${input.approverUserIds[i]} not found.`);
    assertApproverEligible(user, requiredRoles[i]);
  }

  // db is typed `any` project-wide (dual-mode sqlite/pg). Annotate tx to
  // keep strict mode happy without importing driver-specific types.
  return db.transaction(async (tx: typeof db) => {
    const [doc] = await tx
      .insert(controlledDocuments)
      .values({
        projectId: input.projectId,
        typeKey: input.typeKey,
        state: "submitted",
        sharepointPath: input.sharepointPath,
        sharepointDriveId: input.sharepointDriveId ?? null,
        sharepointItemId: input.sharepointItemId ?? null,
        fileName: input.fileName,
        fileSizeBytes: input.fileSizeBytes ?? null,
        versionNumber: 0,
        submittedByUserId: input.submittedByUserId,
        submittedAt: new Date(),
        submitComment: input.submitComment ?? null,
      })
      .returning();

    const approvalRows = await Promise.all(
      input.approverUserIds.map((approverId) =>
        tx
          .insert(approvals)
          .values({
            type: CONTROLLED_DOCUMENT_APPROVAL_TYPE,
            approvalType: CONTROLLED_DOCUMENT_APPROVAL_TYPE,
            relatedEntityType: CONTROLLED_DOCUMENT_APPROVAL_TYPE,
            relatedEntityId: doc.id,
            title: `${type.displayName}: ${input.fileName}`,
            description: input.submitComment ?? null,
            status: "pending",
            requestedBy: input.submittedByUserId,
            assignedApprover: approverId,
            projectId: input.projectId,
          })
          .returning({ id: approvals.id }),
      ),
    );

    return {
      document: doc,
      approvalIds: approvalRows.map((r) => r[0].id),
    };
  });
}

export interface ApprovalDecisionInput {
  documentId: number;
  userId: number;
  comment?: string | null;
}

export interface ApprovalDecisionResult {
  document: ControlledDocument;
  /** Remaining pending approvals for this doc after the decision. */
  pendingRemaining: number;
  /** True when this decision promoted the doc to approved. */
  promoted: boolean;
  /** ID of the previously approved doc that got superseded (if any). */
  supersededDocumentId: number | null;
}

/**
 * Record an approval decision. If all required approvals are in (respecting
 * requiresAllApprovers), promote the doc: mark it approved, mark any prior
 * approved row superseded, bump versionNumber.
 */
export async function recordApproval(input: ApprovalDecisionInput): Promise<ApprovalDecisionResult> {
  return db.transaction(async (tx: typeof db) => {
    const [doc] = await tx
      .select()
      .from(controlledDocuments)
      .where(and(
        eq(controlledDocuments.id, input.documentId),
        isNull(controlledDocuments.deletedAt),
      ))
      .limit(1);
    if (!doc) throw new Error(`Document ${input.documentId} not found.`);
    if (doc.state !== "submitted") {
      throw new Error(`Document is in state '${doc.state}', only 'submitted' docs can be approved.`);
    }

    // Find this user's pending approval row.
    const [myApproval] = await tx
      .select()
      .from(approvals)
      .where(and(
        eq(approvals.relatedEntityType, CONTROLLED_DOCUMENT_APPROVAL_TYPE),
        eq(approvals.relatedEntityId, doc.id),
        eq(approvals.assignedApprover, input.userId),
        eq(approvals.status, "pending"),
        isNull(approvals.deletedAt),
      ))
      .limit(1);
    if (!myApproval) {
      throw new Error("You are not an assigned approver for this document.");
    }

    // Record the decision.
    await tx
      .update(approvals)
      .set({
        status: "approved",
        decidedBy: input.userId,
        decidedAt: new Date(),
        decisionNote: input.comment ?? null,
      })
      .where(eq(approvals.id, myApproval.id));

    // Count remaining pending approvals for this doc.
    const pendingRows = await tx
      .select({ id: approvals.id })
      .from(approvals)
      .where(and(
        eq(approvals.relatedEntityType, CONTROLLED_DOCUMENT_APPROVAL_TYPE),
        eq(approvals.relatedEntityId, doc.id),
        eq(approvals.status, "pending"),
        isNull(approvals.deletedAt),
      ));
    const pendingRemaining = pendingRows.length;

    const type = await getDocumentType(doc.typeKey);
    if (!type) throw new Error(`Document type disappeared mid-decision: ${doc.typeKey}`);

    const thresholdMet = type.requiresAllApprovers ? pendingRemaining === 0 : true;

    if (!thresholdMet) {
      const [updated] = await tx
        .select()
        .from(controlledDocuments)
        .where(eq(controlledDocuments.id, doc.id))
        .limit(1);
      return {
        document: updated,
        pendingRemaining,
        promoted: false,
        supersededDocumentId: null,
      };
    }

    // Supersede any existing approved doc for (project, type).
    const [currentApproved] = await tx
      .select()
      .from(controlledDocuments)
      .where(and(
        eq(controlledDocuments.projectId, doc.projectId),
        eq(controlledDocuments.typeKey, doc.typeKey),
        eq(controlledDocuments.state, "approved" as ControlledDocumentState),
        isNull(controlledDocuments.deletedAt),
      ))
      .limit(1);

    let supersededDocumentId: number | null = null;
    let nextVersion = 1;
    if (currentApproved) {
      await tx
        .update(controlledDocuments)
        .set({
          state: "superseded",
          supersededByDocumentId: doc.id,
          updatedAt: new Date(),
        })
        .where(eq(controlledDocuments.id, currentApproved.id));
      supersededDocumentId = currentApproved.id;
      nextVersion = (currentApproved.versionNumber ?? 0) + 1;
    }

    // Promote.
    let [promotedDoc] = await tx
      .update(controlledDocuments)
      .set({
        state: "approved",
        versionNumber: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(controlledDocuments.id, doc.id))
      .returning();

    // D3.6 — auto-extract Excel headline values when the type has an
    // extractSpec configured. Non-fatal: failures log + leave
    // extractedValues null, so the approval still succeeds.
    if (type.extractSpec && Object.keys(type.extractSpec.cells ?? {}).length > 0) {
      try {
        const extracted = await extractCostingValues({
          driveId: promotedDoc.sharepointDriveId,
          itemId: promotedDoc.sharepointItemId,
          spec: type.extractSpec,
        });
        if (extracted) {
          const [updated] = await tx
            .update(controlledDocuments)
            .set({
              extractedValues: { ...extracted.values, marginPct: extracted.marginPct ?? null },
              extractedAt: new Date(extracted.extractedAt),
              extractedError: null,
            })
            .where(eq(controlledDocuments.id, promotedDoc.id))
            .returning();
          promotedDoc = updated;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[controlled-documents] extract after approve failed for doc ${promotedDoc.id}:`, msg);
        await tx
          .update(controlledDocuments)
          .set({ extractedError: msg, updatedAt: new Date() })
          .where(eq(controlledDocuments.id, promotedDoc.id));
      }
    }

    return {
      document: promotedDoc,
      pendingRemaining: 0,
      promoted: true,
      supersededDocumentId,
    };
  });
}

export interface RejectionInput {
  documentId: number;
  userId: number;
  reason: string;
}

export async function recordRejection(input: RejectionInput): Promise<ControlledDocument> {
  if (!input.reason || input.reason.trim().length === 0) {
    throw new Error("Rejection reason is required.");
  }
  return db.transaction(async (tx: typeof db) => {
    const [doc] = await tx
      .select()
      .from(controlledDocuments)
      .where(and(
        eq(controlledDocuments.id, input.documentId),
        isNull(controlledDocuments.deletedAt),
      ))
      .limit(1);
    if (!doc) throw new Error(`Document ${input.documentId} not found.`);
    if (doc.state !== "submitted") {
      throw new Error(`Document is in state '${doc.state}', only 'submitted' docs can be rejected.`);
    }

    // Confirm this user is an assigned approver.
    const [myApproval] = await tx
      .select()
      .from(approvals)
      .where(and(
        eq(approvals.relatedEntityType, CONTROLLED_DOCUMENT_APPROVAL_TYPE),
        eq(approvals.relatedEntityId, doc.id),
        eq(approvals.assignedApprover, input.userId),
        eq(approvals.status, "pending"),
        isNull(approvals.deletedAt),
      ))
      .limit(1);
    if (!myApproval) {
      throw new Error("You are not an assigned approver for this document.");
    }

    const now = new Date();
    // Reject all pending approvals with the same reason so the audit trail
    // shows the full picture. Rejection is final across approvers.
    await tx
      .update(approvals)
      .set({
        status: "rejected",
        decidedBy: input.userId,
        decidedAt: now,
        decisionNote: input.reason,
      })
      .where(and(
        eq(approvals.relatedEntityType, CONTROLLED_DOCUMENT_APPROVAL_TYPE),
        eq(approvals.relatedEntityId, doc.id),
        eq(approvals.status, "pending"),
      ));

    const [rejected] = await tx
      .update(controlledDocuments)
      .set({
        state: "rejected",
        updatedAt: now,
      })
      .where(eq(controlledDocuments.id, doc.id))
      .returning();
    return rejected;
  });
}

export interface RecallInput {
  documentId: number;
  userId: number;
  userRole: string;
  reason: string;
}

/**
 * Recall an approved document. Soft-rule policy:
 *   - The user who decidedBy on one of the approvals can recall at any time.
 *   - Super-users (COO_ADMIN / CEO_ADMIN) can recall anyone's approval.
 *   - The approval rows are preserved (audit); the controlled_documents row
 *     moves to state='recalled' with recallReason captured.
 */
export async function recordRecall(input: RecallInput): Promise<ControlledDocument> {
  if (!input.reason || input.reason.trim().length === 0) {
    throw new Error("Recall reason is required.");
  }
  return db.transaction(async (tx: typeof db) => {
    const [doc] = await tx
      .select()
      .from(controlledDocuments)
      .where(and(
        eq(controlledDocuments.id, input.documentId),
        isNull(controlledDocuments.deletedAt),
      ))
      .limit(1);
    if (!doc) throw new Error(`Document ${input.documentId} not found.`);
    if (doc.state !== "approved") {
      throw new Error(`Only approved documents can be recalled — current state: '${doc.state}'.`);
    }

    const isSuperUser = SUPER_APPROVER_ROLES.has(input.userRole);
    if (!isSuperUser) {
      // Must have been one of the deciders on this doc.
      const [wasDecider] = await tx
        .select({ id: approvals.id })
        .from(approvals)
        .where(and(
          eq(approvals.relatedEntityType, CONTROLLED_DOCUMENT_APPROVAL_TYPE),
          eq(approvals.relatedEntityId, doc.id),
          eq(approvals.decidedBy, input.userId),
          eq(approvals.status, "approved"),
        ))
        .limit(1);
      if (!wasDecider) {
        throw new Error("Only the original approver or a super-user can recall an approval.");
      }
    }

    const [recalled] = await tx
      .update(controlledDocuments)
      .set({
        state: "recalled",
        recalledByUserId: input.userId,
        recalledAt: new Date(),
        recallReason: input.reason,
        updatedAt: new Date(),
      })
      .where(eq(controlledDocuments.id, doc.id))
      .returning();
    return recalled;
  });
}

// =========================================================================
// Approval queue — "waiting on me"
// =========================================================================

export interface ApprovalQueueRow {
  approvalId: number;
  documentId: number;
  projectId: number;
  projectName: string | null;
  typeKey: string;
  typeDisplayName: string;
  fileName: string;
  submittedByUserId: number | null;
  submittedAt: Date | null;
  submitComment: string | null;
  sharepointPath: string;
  requestedAt: Date | null;
}

/**
 * Returns all pending controlled-document approvals assigned to a user,
 * joined with enough context to render the COO/CEO "Waiting on me" card
 * without further fetches.
 *
 * Graceful fallback: if the controlled_documents tables haven't been
 * created yet (migrations 0012 not applied), return an empty list
 * rather than throwing — dashboards render cleanly with a zero count.
 */
export async function getApprovalQueueForUser(userId: number): Promise<ApprovalQueueRow[]> {
  try {
    return await queryApprovalQueueForUser(userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Postgres error codes 42P01 (undefined_table) / 42703 (undefined_column)
    if (/42P01|42703|does not exist|no such table/i.test(msg)) {
      console.warn("[controlled-documents] approval queue: tables not migrated yet — returning empty list");
      return [];
    }
    throw err;
  }
}

async function queryApprovalQueueForUser(userId: number): Promise<ApprovalQueueRow[]> {
  const rows = await db
    .select({
      approvalId: approvals.id,
      requestedAt: approvals.requestedAt,
      documentId: controlledDocuments.id,
      projectId: controlledDocuments.projectId,
      projectName: projectInfo.projectName,
      typeKey: controlledDocuments.typeKey,
      typeDisplayName: controlledDocumentTypes.displayName,
      fileName: controlledDocuments.fileName,
      submittedByUserId: controlledDocuments.submittedByUserId,
      submittedAt: controlledDocuments.submittedAt,
      submitComment: controlledDocuments.submitComment,
      sharepointPath: controlledDocuments.sharepointPath,
    })
    .from(approvals)
    .innerJoin(
      controlledDocuments,
      eq(approvals.relatedEntityId, controlledDocuments.id),
    )
    .innerJoin(
      controlledDocumentTypes,
      eq(controlledDocuments.typeKey, controlledDocumentTypes.typeKey),
    )
    .leftJoin(projectInfo, eq(controlledDocuments.projectId, projectInfo.id))
    .where(and(
      eq(approvals.relatedEntityType, CONTROLLED_DOCUMENT_APPROVAL_TYPE),
      eq(approvals.assignedApprover, userId),
      eq(approvals.status, "pending"),
      isNull(approvals.deletedAt),
      isNull(controlledDocuments.deletedAt),
    ))
    .orderBy(asc(approvals.requestedAt));
  return rows;
}

// =========================================================================
// Document-type taxonomy CRUD (D5.2 — super-user editor)
// =========================================================================

export interface DocumentTypeCreate {
  typeKey: string;
  displayName: string;
  description?: string | null;
  folderSubPath: string;
  defaultApproverRoles: string[];
  requiresAllApprovers: boolean;
  extractSpec?: { sheetName?: string; cells?: Record<string, string> } | null;
  sortOrder?: number;
}

export interface DocumentTypeUpdate {
  displayName?: string;
  description?: string | null;
  folderSubPath?: string;
  defaultApproverRoles?: string[];
  requiresAllApprovers?: boolean;
  extractSpec?: { sheetName?: string; cells?: Record<string, string> } | null;
  active?: boolean;
  sortOrder?: number;
}

export async function createDocumentType(input: DocumentTypeCreate): Promise<ControlledDocumentType> {
  // Guard: typeKey must not already exist.
  const existing = await getDocumentType(input.typeKey);
  if (existing) throw new Error(`Document type '${input.typeKey}' already exists.`);
  if (!/^[a-z0-9_]+$/.test(input.typeKey)) {
    throw new Error("typeKey must be lowercase letters, numbers, and underscores only.");
  }
  if (!input.defaultApproverRoles?.length) {
    throw new Error("At least one default approver role is required.");
  }
  const [row] = await db
    .insert(controlledDocumentTypes)
    .values({
      typeKey: input.typeKey,
      displayName: input.displayName,
      description: input.description ?? null,
      folderSubPath: input.folderSubPath,
      defaultApproverRoles: input.defaultApproverRoles,
      requiresAllApprovers: input.requiresAllApprovers,
      extractSpec: input.extractSpec ?? null,
      sortOrder: input.sortOrder ?? 999,
      active: true,
    })
    .returning();
  return row;
}

export async function updateDocumentType(
  typeKey: string,
  patch: DocumentTypeUpdate,
): Promise<ControlledDocumentType> {
  const existing = await getDocumentType(typeKey);
  if (!existing) throw new Error(`Document type '${typeKey}' not found.`);
  if (patch.defaultApproverRoles && patch.defaultApproverRoles.length === 0) {
    throw new Error("defaultApproverRoles must not be empty.");
  }

  const setClause: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.displayName !== undefined) setClause.displayName = patch.displayName;
  if (patch.description !== undefined) setClause.description = patch.description;
  if (patch.folderSubPath !== undefined) setClause.folderSubPath = patch.folderSubPath;
  if (patch.defaultApproverRoles !== undefined) setClause.defaultApproverRoles = patch.defaultApproverRoles;
  if (patch.requiresAllApprovers !== undefined) setClause.requiresAllApprovers = patch.requiresAllApprovers;
  if (patch.extractSpec !== undefined) setClause.extractSpec = patch.extractSpec;
  if (patch.active !== undefined) setClause.active = patch.active;
  if (patch.sortOrder !== undefined) setClause.sortOrder = patch.sortOrder;

  const [row] = await db
    .update(controlledDocumentTypes)
    .set(setClause)
    .where(eq(controlledDocumentTypes.typeKey, typeKey))
    .returning();
  return row;
}

/**
 * Soft-delete a document type by setting active=false. We never hard-delete
 * because existing controlled_documents rows still reference the typeKey
 * (FK) and historical approvals depend on the display name for audit.
 *
 * A deactivated type:
 *   - hides from new-submission dropdowns
 *   - keeps all existing documents visible in history
 *   - can be reactivated via PATCH active=true
 */
export async function deactivateDocumentType(typeKey: string): Promise<ControlledDocumentType> {
  return updateDocumentType(typeKey, { active: false });
}

// =========================================================================
// Per-project SharePoint root CRUD (D5.3)
// =========================================================================

export interface UpsertProjectSharepointRootInput {
  projectId: number;
  rootPath: string;
  driveId?: string | null;
  rootItemId?: string | null;
  userId: number;
}

/**
 * Upsert a project's SharePoint root. Metadata only — real Graph
 * folder-tree creation happens in D3.5 when a super-user clicks
 * "Apply folder template" and we wire drives.items.children create.
 */
export async function upsertProjectSharepointRoot(
  input: UpsertProjectSharepointRootInput,
): Promise<ProjectSharepointRoot> {
  const existing = await getProjectSharepointRoot(input.projectId);
  if (existing) {
    const [row] = await db
      .update(projectSharepointRoots)
      .set({
        rootPath: input.rootPath,
        driveId: input.driveId ?? existing.driveId,
        rootItemId: input.rootItemId ?? existing.rootItemId,
        configuredByUserId: input.userId,
        updatedAt: new Date(),
      })
      .where(eq(projectSharepointRoots.projectId, input.projectId))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(projectSharepointRoots)
    .values({
      projectId: input.projectId,
      rootPath: input.rootPath,
      driveId: input.driveId ?? null,
      rootItemId: input.rootItemId ?? null,
      configuredByUserId: input.userId,
    })
    .returning();
  return row;
}
