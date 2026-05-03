/**
 * Document workflow service.
 *
 * Thin orchestration layer that combines the Graph service with the DB
 * repositories so route handlers stay small. Focused on Phase 1–3 flows:
 * track-new-upload, record checkin/checkout, and owner transfer.
 *
 * Approvals are NOT handled here — when approvals integration lands in
 * a later phase we delegate to the existing `approvals` engine.
 */

import { ApiError, notFound } from "../lib/api-error";
import { createNotification } from "./notification-service";
import * as locks from "../repositories/document-locks-repository";
import * as docs from "../repositories/managed-documents-repository";
import * as revisions from "../repositories/document-revisions-repository";
import * as activity from "../repositories/document-activity-repository";
import type {
  DocumentRootScope,
  ManagedDocument,
  DocumentRevision,
} from "@shared/schema/documents";

// ------------------------------------------------------------------
// Upload / revision flow
// ------------------------------------------------------------------

export interface CompleteUploadInput {
  rootScope: DocumentRootScope;
  projectId: number | null;
  companyRootId: number | null;
  driveId: string;
  driveItemId: string;
  name: string;
  path: string;
  sizeBytes: number | null;
  sharepointVersionId?: string | null;
  notes?: string | null;
  userId: number;
  actorRole: string | null;
  /**
   * D6: SharePoint parent item id. When the upload lands inside a
   * provisioned project_folders row, the workflow links the resulting
   * managed_document via parentFolderId so the readiness rollup picks it
   * up. Optional — uploads to untracked paths simply skip the link.
   */
  parentDriveItemId?: string | null;
}

export interface CompleteUploadResult {
  document: ManagedDocument;
  revision: DocumentRevision;
}

/**
 * Called after a new file is uploaded (simple PUT or chunked session) to
 * create / update the managed_documents row and insert a revision.
 */
export async function completeUpload(
  input: CompleteUploadInput,
): Promise<CompleteUploadResult> {
  // D6: link the managed document to its taxonomy folder when the upload
  // landed inside a provisioned project_folders row. Failures are
  // swallowed — the upload is still valid even if the lookup hiccups.
  let parentFolderId: number | null = null;
  if (input.parentDriveItemId) {
    const match = await docs
      .findProjectFolderByDriveItem(input.driveId, input.parentDriveItemId)
      .catch(() => null);
    parentFolderId = match?.id ?? null;
  }

  const document = await docs.upsertManagedDocumentFromGraph({
    rootScope: input.rootScope,
    projectId: input.projectId,
    companyRootId: input.companyRootId,
    driveId: input.driveId,
    driveItemId: input.driveItemId,
    name: input.name,
    path: input.path,
    createdByUserId: input.userId,
    parentFolderId,
  });

  const revision = await revisions.appendRevision({
    documentId: document.id,
    sharepointVersionId: input.sharepointVersionId ?? null,
    sizeBytes: input.sizeBytes ?? null,
    uploadedByUserId: input.userId,
    notes: input.notes ?? null,
  });

  await docs.setCurrentRevision(document.id, revision.id);

  await activity.recordActivity({
    userId: input.userId,
    actorRole: input.actorRole,
    rootScope: input.rootScope,
    projectId: input.projectId,
    companyRootId: input.companyRootId,
    documentId: document.id,
    revisionId: revision.id,
    driveId: input.driveId,
    itemId: input.driveItemId,
    itemPath: input.path,
    itemName: input.name,
    action: "upload",
    sizeBytes: input.sizeBytes,
  });

  // Notify document owner if this is a follow-up revision (≥2) and
  // someone other than the owner uploaded.
  if (revision.revisionNumber > 1 && document.ownerUserId && document.ownerUserId !== input.userId) {
    await createNotification({
      recipientUserId: document.ownerUserId,
      eventType: "document.revision.uploaded",
      title: `New revision of "${document.name}"`,
      body: `A new revision of "${document.name}" was uploaded.`,
      relatedEntityType: "managed_document",
      relatedEntityId: document.id,
    });
  }

  return { document, revision };
}

// ------------------------------------------------------------------
// Check-in / check-out
// ------------------------------------------------------------------

export async function recordCheckout(
  documentId: number,
  userId: number,
): Promise<void> {
  await locks.acquireLock(documentId, userId, "app");
  const document = await docs.getManagedDocumentById(documentId);
  if (!document) throw notFound("Document");
  await activity.recordActivity({
    userId,
    actorRole: null,
    rootScope: document.rootScope,
    projectId: document.projectId ?? null,
    companyRootId: document.companyRootId ?? null,
    documentId,
    driveId: document.driveId,
    itemId: document.driveItemId,
    itemPath: document.path,
    itemName: document.name,
    action: "checkout",
  });
}

export async function recordCheckin(
  documentId: number,
  userId: number,
  comment: string | null,
  newRevision: { sizeBytes: number | null; sharepointVersionId: string | null } | null,
): Promise<DocumentRevision | null> {
  const document = await docs.getManagedDocumentById(documentId);
  if (!document) throw notFound("Document");

  let revision: DocumentRevision | null = null;
  if (newRevision) {
    revision = await revisions.appendRevision({
      documentId,
      sharepointVersionId: newRevision.sharepointVersionId,
      sizeBytes: newRevision.sizeBytes,
      uploadedByUserId: userId,
      notes: comment,
    });
    await docs.setCurrentRevision(documentId, revision.id);
  }

  await locks.releaseLock(documentId);

  await activity.recordActivity({
    userId,
    actorRole: null,
    rootScope: document.rootScope,
    projectId: document.projectId ?? null,
    companyRootId: document.companyRootId ?? null,
    documentId,
    revisionId: revision?.id ?? null,
    driveId: document.driveId,
    itemId: document.driveItemId,
    itemPath: document.path,
    itemName: document.name,
    action: "checkin",
    sizeBytes: revision?.sizeBytes ?? null,
    metadata: comment ? { comment } : null,
  });

  return revision;
}

export async function recordDiscardCheckout(
  documentId: number,
  userId: number,
): Promise<void> {
  const document = await docs.getManagedDocumentById(documentId);
  if (!document) throw notFound("Document");
  await locks.releaseLock(documentId);
  await activity.recordActivity({
    userId,
    actorRole: null,
    rootScope: document.rootScope,
    projectId: document.projectId ?? null,
    companyRootId: document.companyRootId ?? null,
    documentId,
    driveId: document.driveId,
    itemId: document.driveItemId,
    itemPath: document.path,
    itemName: document.name,
    action: "discard_checkout",
  });
}

// ------------------------------------------------------------------
// Ownership transfer
// ------------------------------------------------------------------

export async function changeOwner(
  documentId: number,
  newOwnerUserId: number,
  actorUserId: number,
): Promise<ManagedDocument> {
  const document = await docs.getManagedDocumentById(documentId);
  if (!document) throw notFound("Document");
  const updated = await docs.setOwner(documentId, newOwnerUserId);
  await activity.recordActivity({
    userId: actorUserId,
    actorRole: null,
    rootScope: document.rootScope,
    projectId: document.projectId ?? null,
    companyRootId: document.companyRootId ?? null,
    documentId,
    driveId: document.driveId,
    itemId: document.driveItemId,
    itemPath: document.path,
    itemName: document.name,
    action: "rename", // no dedicated "owner_change" action in this build
    metadata: { kind: "owner_change", from: document.ownerUserId, to: newOwnerUserId },
  });
  if (newOwnerUserId !== actorUserId) {
    await createNotification({
      recipientUserId: newOwnerUserId,
      eventType: "document.ownership.transferred",
      title: `You are now the owner of "${document.name}"`,
      relatedEntityType: "managed_document",
      relatedEntityId: document.id,
    });
  }
  return updated;
}

/**
 * Throws ApiError 423 when the document is locked by another user. Wraps
 * the repository-layer `LOCKED` sentinel in a proper API error.
 */
export async function assertUnlockedForUser(
  documentId: number,
  userId: number,
): Promise<void> {
  try {
    await locks.assertUnlockedFor(documentId, userId);
  } catch (err) {
    if (err instanceof Error && err.message === "LOCKED") {
      const existing = await locks.getLock(documentId);
      throw new ApiError(
        423,
        "LOCKED",
        "This document is checked out by another user.",
        existing?.lockedByUserId ? { lockedBy: String(existing.lockedByUserId) } : undefined,
      );
    }
    throw err;
  }
}
