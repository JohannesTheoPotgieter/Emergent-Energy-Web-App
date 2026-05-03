/** Shared UI-facing shapes for the /documents browser. */

export type DocumentRootScope = "project" | "company";

export interface RootSummary {
  id: number;
  rootPath: string;
  hasDrive: boolean;
}

export interface ProjectRootSummary extends RootSummary {
  projectId: number;
  name: string;
  projectCode: string | null;
}

export interface CompanyRootSummary extends RootSummary {
  kind: string;
  displayName: string;
}

export interface GraphItem {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
  size?: number;
  lastModifiedDateTime?: string;
  lastModifiedBy?: { displayName?: string; email?: string };
  webUrl?: string;
  eTag?: string;
  checkedOutBy?: { displayName?: string; email?: string } | null;
}

export interface ManagedDocument {
  id: number;
  name: string;
  path: string;
  ownerUserId: number | null;
  currentRevisionId: number | null;
  state: "draft" | "in_review" | "approved" | "superseded" | "archived";
}

export interface DocumentRevision {
  id: number;
  revisionNumber: number;
  sharepointVersionId: string | null;
  sizeBytes: number | null;
  uploadedByUserId: number | null;
  uploadedAt: string;
  notes: string | null;
  isCurrent: boolean;
  isControlled: boolean;
}

export interface DocumentComment {
  id: number;
  documentId: number;
  revisionId: number | null;
  parentCommentId: number | null;
  authorUserId: number;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface DocumentLock {
  lockedByUserId: number;
  lockedAt: string;
}
