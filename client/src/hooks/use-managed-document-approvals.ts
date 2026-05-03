/**
 * D6 Phase 5 — managed-document approvals hooks.
 *
 * Backed by /api/managed-document-approvals/* and
 * /api/managed-documents/:id/{request-approval,approvals}.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";

const QUEUE_KEY = ["/api/managed-document-approvals/queue"] as const;

// =========================================================================
// Types — kept in lockstep with the service shapes.
// =========================================================================

export interface ApprovalRow {
  id: number;
  type: string;
  title: string;
  description: string | null;
  status: "pending" | "approved" | "rejected";
  requestedBy: number;
  requestedAt: string;
  decidedBy: number | null;
  decidedAt: string | null;
  decisionNote: string | null;
  relatedEntityType: string | null;
  relatedEntityId: number | null;
  assignedApprover: number | null;
  approvalType: string | null;
  projectId: number;
}

export interface ApprovalQueueRow {
  approval: ApprovalRow;
  document: {
    id: number;
    name: string;
    path: string;
    projectId: number | null;
  } | null;
  requestedBy: { id: number; name: string; email: string } | null;
}

interface QueueResponse {
  userId: number;
  rows: ApprovalQueueRow[];
}

// =========================================================================
// Reads
// =========================================================================

export function useManagedDocumentApprovalQueue(enabled = true) {
  return useQuery<QueueResponse>({
    queryKey: QUEUE_KEY,
    queryFn: getQueryFn({ on401: "throw" }),
    enabled,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

interface DocumentApprovalsResponse {
  documentId: number;
  approvals: ApprovalRow[];
}

export function useApprovalsForDocument(documentId: number | null) {
  return useQuery<DocumentApprovalsResponse>({
    queryKey: documentId
      ? [`/api/managed-documents/${documentId}/approvals`]
      : ["/api/managed-documents/0/approvals"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: typeof documentId === "number" && documentId > 0,
  });
}

// =========================================================================
// Writes
// =========================================================================

export interface RequestApprovalPayload {
  managedDocumentId: number;
  approverUserIds: number[];
  comment?: string;
}

export function useRequestManagedDocApproval() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, RequestApprovalPayload>({
    mutationFn: async ({ managedDocumentId, approverUserIds, comment }) => {
      const res = await apiRequest(
        "POST",
        `/api/managed-documents/${managedDocumentId}/request-approval`,
        { approverUserIds, comment },
      );
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: QUEUE_KEY });
      qc.invalidateQueries({
        queryKey: [`/api/managed-documents/${vars.managedDocumentId}/approvals`],
      });
    },
  });
}

export function useApproveManagedDoc() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { approvalId: number; comment?: string }>({
    mutationFn: async ({ approvalId, comment }) => {
      const res = await apiRequest(
        "POST",
        `/api/managed-document-approvals/${approvalId}/approve`,
        { comment },
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUEUE_KEY });
    },
  });
}

export function useRejectManagedDoc() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { approvalId: number; reason: string }>({
    mutationFn: async ({ approvalId, reason }) => {
      const res = await apiRequest(
        "POST",
        `/api/managed-document-approvals/${approvalId}/reject`,
        { reason },
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUEUE_KEY });
    },
  });
}
