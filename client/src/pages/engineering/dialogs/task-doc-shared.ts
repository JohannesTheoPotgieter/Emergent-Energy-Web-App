/**
 * Shared shapes + helpers for the Engineering Task Manager's document-gated
 * status flow (Task ↔ Document Manager — "the document follows the task").
 *
 * These power the four required prompts wired into the centralized status gate
 * (`requestStatusChange`) on EngineeringTaskManagerPage:
 *   1. Link a document (browse the project's discipline folders → link).
 *   2. → In Progress  : check out a linked doc.
 *   3. → Needs Approval: check the checked-out file back in, submit for QC.
 *   4. → Complete      : check in any open file + confirm final.
 *
 * Reuse-only: the browse surface is the discipline folder browser
 * (use-documents.ts `{ kind: "discipline" }` target), checkout/check-in are the
 * doc-manager hooks, and approval is use-managed-document-approvals.ts.
 */

import { apiRequest } from "@/lib/queryClient";
import type { ManagedDocState } from "@/components/documents/document-display";

/** The Engineering discipline whose bound folder backs every Engineering task. */
export const ENGINEERING_DISCIPLINE = "ENGINEERING";

/** Statuses the document gate intercepts. All others proceed unprompted. */
export const GATED_STATUSES = new Set(["in_progress", "needs_approval", "complete"]);

/** A document link row as returned by GET /api/engineering/tasks/:id/documents. */
export interface TaskDocLink {
  id: number;
  managedDocumentId: number | null;
  projectDocumentLinkId: number | null;
  linkRole: string;
  createdAt: string;
}

/** Managed-document link-candidate (GET …/document-candidates). */
export interface TaskDocCandidate {
  id: number;
  name: string;
  path: string;
}

/** Item-detail response from the discipline-folder browser (file → tracked). */
export interface DisciplineItemDetail {
  item: { id: string; name: string; path: string; isFolder: boolean };
  managedDocument: {
    id: number;
    name: string;
    state: ManagedDocState;
    currentRevisionId: number | null;
  } | null;
  lock: { lockedByUserId: number; lockedAt: string } | null;
}

function disciplineBase(projectId: number, discipline: string): string {
  return `/api/projects/${projectId}/discipline-folders/${encodeURIComponent(discipline)}`;
}

/**
 * Resolve (and, server-side, ensure-track) a managed document for a browsed
 * file. The discipline item-detail endpoint upserts a managed_documents row for
 * an untracked file, returning its `managedDocument.id` — exactly what
 * `POST …/tasks/:id/documents { managedDocumentId }` needs.
 */
export async function fetchDisciplineItemDetail(
  projectId: number,
  discipline: string,
  itemId: string,
): Promise<DisciplineItemDetail> {
  const res = await apiRequest(
    "GET",
    `${disciplineBase(projectId, discipline)}/item/${encodeURIComponent(itemId)}`,
  );
  return res.json() as Promise<DisciplineItemDetail>;
}
