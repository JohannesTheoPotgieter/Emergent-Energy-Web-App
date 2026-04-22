// ============================================================
// CONTROLLED DOCUMENTS — React Query hooks
//
// Backs the Documents strip on project surfaces, the Approval Queue
// card on the CEO/COO home screens, and the submit/approve/reject
// dialogs.
// ============================================================

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import type {
  ControlledDocument,
  ControlledDocumentType,
} from "@shared/schema";

// ---- Shapes returned by the API ------------------------------------------

export interface ProjectDocumentSummary {
  type: ControlledDocumentType;
  approved: ControlledDocument | null;
  pendingCount: number;
  historyCount: number;
}

export interface ProjectDocumentDetail {
  type: ControlledDocumentType;
  approved: ControlledDocument | null;
  drafts: ControlledDocument[];
  submitted: ControlledDocument[];
  rejected: ControlledDocument[];
  history: ControlledDocument[];
}

export interface ApprovalQueueRow {
  approvalId: number;
  documentId: number;
  projectId: number;
  projectName: string | null;
  typeKey: string;
  typeDisplayName: string;
  fileName: string;
  submittedByUserId: number | null;
  submittedAt: string | null;
  submitComment: string | null;
  sharepointPath: string;
  requestedAt: string | null;
}

// ---- Reads ---------------------------------------------------------------

export function useDocumentTypes() {
  return useQuery<{ types: ControlledDocumentType[] }>({
    queryKey: ["/api/controlled-documents/types"],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 60_000, // types change rarely
  });
}

export function useProjectDocumentSummary(projectId: number | null) {
  return useQuery<{ projectId: number; summary: ProjectDocumentSummary[] }>({
    queryKey: [`/api/projects/${projectId}/controlled-documents`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: projectId != null && projectId > 0,
  });
}

export function useProjectDocumentDetail(projectId: number | null, typeKey: string | null) {
  return useQuery<ProjectDocumentDetail>({
    queryKey: [`/api/projects/${projectId}/controlled-documents/${typeKey}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: projectId != null && projectId > 0 && !!typeKey,
  });
}

export function useApprovalQueue() {
  return useQuery<{ userId: number; rows: ApprovalQueueRow[] }>({
    queryKey: ["/api/approvals/queue"],
    queryFn: getQueryFn({ on401: "throw" }),
    refetchInterval: 60_000, // poll every minute — fresh for the "Waiting on me" card
  });
}

// ---- Mutations -----------------------------------------------------------

export interface SubmitPayload {
  typeKey: string;
  fileName: string;
  sharepointPath: string;
  sharepointDriveId?: string;
  sharepointItemId?: string;
  fileSizeBytes?: number;
  submitComment?: string;
  approverUserIds: number[];
}

export function useSubmitDocument(projectId: number) {
  const qc = useQueryClient();
  return useMutation<
    { document: ControlledDocument; approvalIds: number[] },
    Error,
    SubmitPayload
  >({
    mutationFn: async (payload) => {
      const res = await apiRequest(
        "POST",
        `/api/projects/${projectId}/controlled-documents/submit`,
        payload,
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/controlled-documents`] });
      qc.invalidateQueries({ queryKey: ["/api/approvals/queue"] });
    },
  });
}

export function useApproveDocument() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { documentId: number; comment?: string; projectId?: number }>({
    mutationFn: async ({ documentId, comment }) => {
      const res = await apiRequest("POST", `/api/controlled-documents/${documentId}/approve`, { comment });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/approvals/queue"] });
      if (vars.projectId) {
        qc.invalidateQueries({ queryKey: [`/api/projects/${vars.projectId}/controlled-documents`] });
      }
    },
  });
}

export function useRejectDocument() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { documentId: number; reason: string; projectId?: number }>({
    mutationFn: async ({ documentId, reason }) => {
      const res = await apiRequest("POST", `/api/controlled-documents/${documentId}/reject`, { reason });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/approvals/queue"] });
      if (vars.projectId) {
        qc.invalidateQueries({ queryKey: [`/api/projects/${vars.projectId}/controlled-documents`] });
      }
    },
  });
}

export function useRecallDocument() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { documentId: number; reason: string; projectId?: number }>({
    mutationFn: async ({ documentId, reason }) => {
      const res = await apiRequest("POST", `/api/controlled-documents/${documentId}/recall`, { reason });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/approvals/queue"] });
      if (vars.projectId) {
        qc.invalidateQueries({ queryKey: [`/api/projects/${vars.projectId}/controlled-documents`] });
      }
    },
  });
}
