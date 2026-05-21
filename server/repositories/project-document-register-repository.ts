import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  managedDocuments,
  projectDocumentLinks,
  type ManagedDocument,
  type ProjectDocumentLink,
} from "@shared/schema/documents";
import type {
  ProjectDocumentDomain,
  ProjectDocumentReviewStatus,
  ProjectDocumentStatus,
  ProjectDocumentSyncConfidence,
} from "@shared/project-document-register";

type InsertProjectDocumentLink = typeof projectDocumentLinks.$inferInsert;

export interface ProjectDocumentRegisterRow {
  link: ProjectDocumentLink;
  managedDocument: ManagedDocument | null;
}

export interface LinkProjectDocumentInput {
  projectId: number;
  managedDocumentId: number | null;
  domain: ProjectDocumentDomain;
  documentType: string;
  discipline?: string | null;
  revision?: string | null;
  ownerUserId?: number | null;
  dueDate?: string | null;
  preparedByUserId?: number | null;
  sharepointDriveId: string;
  sharepointItemId: string;
  sharepointWebUrl: string | null;
  sharepointFolderPath: string | null;
  fileName: string;
  lastSyncedAt?: Date | null;
  syncConfidence?: ProjectDocumentSyncConfidence;
  createdByUserId: number;
}

export interface UpdateProjectDocumentInput {
  documentType?: string;
  discipline?: string | null;
  revision?: string | null;
  status?: ProjectDocumentStatus;
  reviewStatus?: ProjectDocumentReviewStatus;
  currentRevision?: boolean;
  superseded?: boolean;
  ownerUserId?: number | null;
  dueDate?: string | null;
  reviewedByUserId?: number | null;
  approvedByUserId?: number | null;
  approvedAt?: Date | null;
  requiresPrengSignoff?: boolean;
  prengSignedOffByUserId?: number | null;
  prengSignedOffAt?: Date | null;
  closeOutEvidenceRequired?: boolean;
  closeOutEvidenceLinked?: boolean;
  syncConfidence?: ProjectDocumentSyncConfidence;
  notes?: string | null;
  updatedByUserId: number;
}

function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /42P01|42703|does not exist|no such table/i.test(msg);
}

export async function listProjectDocumentRegisterRows(
  projectId: number,
  domain: ProjectDocumentDomain,
): Promise<ProjectDocumentRegisterRow[]> {
  try {
    const rows = await db
      .select({
        link: projectDocumentLinks,
        managedDocument: managedDocuments,
      })
      .from(projectDocumentLinks)
      .leftJoin(managedDocuments, eq(projectDocumentLinks.managedDocumentId, managedDocuments.id))
      .where(
        and(
          eq(projectDocumentLinks.projectId, projectId),
          eq(projectDocumentLinks.domain, domain),
          isNull(projectDocumentLinks.deletedAt),
        ),
      )
      .orderBy(desc(projectDocumentLinks.updatedAt));

    return rows.map((row: any) => ({
      link: row.link,
      managedDocument: row.managedDocument ?? null,
    }));
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

export async function getProjectDocumentLink(
  projectId: number,
  linkId: number,
): Promise<ProjectDocumentLink | null> {
  try {
    const [row] = await db
      .select()
      .from(projectDocumentLinks)
      .where(
        and(
          eq(projectDocumentLinks.id, linkId),
          eq(projectDocumentLinks.projectId, projectId),
          isNull(projectDocumentLinks.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

export async function upsertLinkedProjectDocument(
  input: LinkProjectDocumentInput,
): Promise<ProjectDocumentLink> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(projectDocumentLinks)
    .where(
      and(
        eq(projectDocumentLinks.projectId, input.projectId),
        eq(projectDocumentLinks.domain, input.domain),
        eq(projectDocumentLinks.sharepointDriveId, input.sharepointDriveId),
        eq(projectDocumentLinks.sharepointItemId, input.sharepointItemId),
        isNull(projectDocumentLinks.deletedAt),
      ),
    )
    .limit(1);

  const values = {
    managedDocumentId: input.managedDocumentId,
    documentType: input.documentType,
    discipline: input.discipline ?? null,
    revision: input.revision ?? null,
    ownerUserId: input.ownerUserId ?? null,
    dueDate: input.dueDate ?? null,
    preparedByUserId: input.preparedByUserId ?? input.createdByUserId,
    sharepointDriveId: input.sharepointDriveId,
    sharepointItemId: input.sharepointItemId,
    sharepointWebUrl: input.sharepointWebUrl,
    sharepointFolderPath: input.sharepointFolderPath,
    fileName: input.fileName,
    lastSyncedAt: input.lastSyncedAt ?? now,
    syncConfidence: input.syncConfidence ?? "high",
    updatedByUserId: input.createdByUserId,
    updatedAt: now,
  } satisfies Partial<InsertProjectDocumentLink>;

  if (existing) {
    const [updated] = await db
      .update(projectDocumentLinks)
      .set(values)
      .where(eq(projectDocumentLinks.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(projectDocumentLinks)
    .values({
      projectId: input.projectId,
      domain: input.domain,
      status: "draft",
      reviewStatus: "draft",
      currentRevision: true,
      superseded: false,
      closeOutEvidenceRequired: false,
      closeOutEvidenceLinked: false,
      createdByUserId: input.createdByUserId,
      ...values,
    } satisfies InsertProjectDocumentLink)
    .returning();
  return created;
}

export async function updateProjectDocumentLink(
  projectId: number,
  linkId: number,
  input: UpdateProjectDocumentInput,
): Promise<ProjectDocumentLink | null> {
  const values: Partial<InsertProjectDocumentLink> = {
    updatedByUserId: input.updatedByUserId,
    updatedAt: new Date(),
  };

  if (input.documentType !== undefined) values.documentType = input.documentType;
  if (input.discipline !== undefined) values.discipline = input.discipline;
  if (input.revision !== undefined) values.revision = input.revision;
  if (input.status !== undefined) values.status = input.status;
  if (input.reviewStatus !== undefined) values.reviewStatus = input.reviewStatus;
  if (input.currentRevision !== undefined) values.currentRevision = input.currentRevision;
  if (input.superseded !== undefined) values.superseded = input.superseded;
  if (input.ownerUserId !== undefined) values.ownerUserId = input.ownerUserId;
  if (input.dueDate !== undefined) values.dueDate = input.dueDate;
  if (input.reviewedByUserId !== undefined) values.reviewedByUserId = input.reviewedByUserId;
  if (input.approvedByUserId !== undefined) values.approvedByUserId = input.approvedByUserId;
  if (input.approvedAt !== undefined) values.approvedAt = input.approvedAt;
  if (input.requiresPrengSignoff !== undefined) values.requiresPrengSignoff = input.requiresPrengSignoff;
  if (input.prengSignedOffByUserId !== undefined) values.prengSignedOffByUserId = input.prengSignedOffByUserId;
  if (input.prengSignedOffAt !== undefined) values.prengSignedOffAt = input.prengSignedOffAt;
  if (input.closeOutEvidenceRequired !== undefined) values.closeOutEvidenceRequired = input.closeOutEvidenceRequired;
  if (input.closeOutEvidenceLinked !== undefined) values.closeOutEvidenceLinked = input.closeOutEvidenceLinked;
  if (input.syncConfidence !== undefined) {
    values.syncConfidence = input.syncConfidence;
    values.lastSyncedAt = new Date();
  }
  if (input.notes !== undefined) values.notes = input.notes;

  try {
    const [updated] = await db
      .update(projectDocumentLinks)
      .set(values)
      .where(
        and(
          eq(projectDocumentLinks.id, linkId),
          eq(projectDocumentLinks.projectId, projectId),
          isNull(projectDocumentLinks.deletedAt),
        ),
      )
      .returning();
    return updated ?? null;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}
