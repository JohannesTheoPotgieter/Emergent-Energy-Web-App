/**
 * Response shapes for the native Engineering task-management features that live
 * on the `/api/engineering/tasks/*` spine. Mirrors the API contract — these are
 * the only places the spine task-detail sections couple to the wire format.
 */

export interface SpineSubtask {
  id: number;
  title: string;
  status: string;
  ownerUserId: number | null;
  ownerName: string | null;
  endDate: string | null;
}

export interface SpineSubtasksResponse {
  subtasks: SpineSubtask[];
}

export interface SpineChecklistItem {
  id: number;
  content: string;
  isDone: boolean;
  sortOrder: number;
}

export interface SpineChecklist {
  id: number;
  title: string;
  sortOrder: number;
  items: SpineChecklistItem[];
}

export interface SpineChecklistsResponse {
  checklists: SpineChecklist[];
}

export interface SpineCommentMention {
  userId: number;
  name: string;
}

export interface SpineComment {
  id: number;
  body: string;
  authorId: number | null;
  authorName: string | null;
  createdAt: string;
  mentions: SpineCommentMention[];
}

export interface SpineCommentsResponse {
  comments: SpineComment[];
}

export type SpineAssigneeRole = "OWNER" | "ASSIGNEE" | "REVIEWER" | "VIEWER";

export interface SpineAssignee {
  userId: number;
  name: string;
  role: SpineAssigneeRole;
}

export interface SpineAssigneesResponse {
  assignees: SpineAssignee[];
}

export type SpineDependencyKind = "task" | "plan";

export interface SpineDependency {
  depId: number;
  taskId: number;
  title: string;
  status: string;
  kind: SpineDependencyKind;
}

export interface SpineDependenciesResponse {
  blockedBy: SpineDependency[];
  blocks: SpineDependency[];
}

export interface SpineDependencyCandidate {
  id: number;
  title: string;
  kind: SpineDependencyKind;
  status: string;
}

export interface SpineDependencyCandidatesResponse {
  candidates: SpineDependencyCandidate[];
}

export type SpineSignOffKind = "qc" | "operational";
export type SpineSignOffDecision = "approved" | "rejected";

export interface SpineSignOff {
  id: number;
  kind: SpineSignOffKind;
  decision: SpineSignOffDecision;
  decidedByName: string | null;
  decidedAt: string | null;
  note: string | null;
}

export interface SpineSignOffsResponse {
  signOffs: SpineSignOff[];
}
