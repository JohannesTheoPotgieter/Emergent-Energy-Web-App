// ============================================================
// COLLABORATION WORKFLOW HOOKS — React Query hooks for
//   Acceptances, Commitments, Evidence, Queries, Client Updates
// ============================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import type {
  StageAcceptance,
  AcceptanceReservation,
  ClientCommitment,
  EvidenceRequest,
  ProjectQuery,
  ClientUpdate,
} from "@shared/schema";

// ── Invalidation helper ────────────────────────────────────

function useInvalidateProject(projectId: number | undefined) {
  const qc = useQueryClient();
  return (keys: string[]) => {
    if (!projectId) return;
    keys.forEach(key => qc.invalidateQueries({ queryKey: [key] }));
  };
}

// ── Acceptances ────────────────────────────────────────────

export function useAcceptances(projectId: number | undefined, stageCode?: string) {
  const url = stageCode
    ? `/api/projects/${projectId}/acceptances?stageCode=${stageCode}`
    : `/api/projects/${projectId}/acceptances`;
  return useQuery<{ acceptances: StageAcceptance[] }>({
    queryKey: [url],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId,
  });
}

export function useCreateAcceptance(projectId: number | undefined) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: async (params: {
      stageCode: string;
      outcome: string;
      rejectionReason?: string;
      adminOverride?: boolean;
      adminOverrideReason?: string;
      reservations?: { description: string; ownerUserId?: number; deadline?: string }[];
    }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/acceptances`, params);
      return res.json();
    },
    onSuccess: () => invalidate([
      `/api/projects/${projectId}/acceptances`,
      `/api/projects/${projectId}/acceptance-reservations`,
      `/api/projects/${projectId}/stages`,
    ]),
  });
}

// ── Acceptance Reservations ────────────────────────────────

export function useAcceptanceReservations(projectId: number | undefined, stageCode?: string) {
  const url = stageCode
    ? `/api/projects/${projectId}/acceptance-reservations?stageCode=${stageCode}`
    : `/api/projects/${projectId}/acceptance-reservations`;
  return useQuery<{ reservations: AcceptanceReservation[] }>({
    queryKey: [url],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId,
  });
}

export function useUpdateReservation(projectId: number | undefined) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: async (params: { id: number; status: string; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/acceptance-reservations/${params.id}`, {
        status: params.status,
        notes: params.notes,
      });
      return res.json();
    },
    onSuccess: () => invalidate([`/api/projects/${projectId}/acceptance-reservations`]),
  });
}

// ── Client Commitments ─────────────────────────────────────

export function useClientCommitments(projectId: number | undefined) {
  return useQuery<{ commitments: ClientCommitment[] }>({
    queryKey: [`/api/projects/${projectId}/client-commitments`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId,
  });
}

export function useCreateClientCommitment(projectId: number | undefined) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: async (params: {
      stageCodeCreated: string;
      commitmentText: string;
      deliveryStageCode?: string;
      notes?: string;
    }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/client-commitments`, params);
      return res.json();
    },
    onSuccess: () => invalidate([`/api/projects/${projectId}/client-commitments`]),
  });
}

export function useUpdateClientCommitment(projectId: number | undefined) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: async (params: { id: number; status?: string; deliveredDate?: string; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/client-commitments/${params.id}`, params);
      return res.json();
    },
    onSuccess: () => invalidate([`/api/projects/${projectId}/client-commitments`]),
  });
}

// ── Evidence Requests ──────────────────────────────────────

export function useEvidenceRequests(projectId: number | undefined, stageCode?: string) {
  const url = stageCode
    ? `/api/projects/${projectId}/evidence-requests?stageCode=${stageCode}`
    : `/api/projects/${projectId}/evidence-requests`;
  return useQuery<{ requests: EvidenceRequest[] }>({
    queryKey: [url],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId,
  });
}

export function useCreateEvidenceRequest(projectId: number | undefined) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: async (params: {
      stageCode: string;
      requestedFromDepartment: string;
      requestedFromUserId?: number;
      description: string;
      dueDate?: string;
    }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/evidence-requests`, params);
      return res.json();
    },
    onSuccess: () => invalidate([
      `/api/projects/${projectId}/evidence-requests`,
      `/api/projects/${projectId}/stage-dependencies`,
    ]),
  });
}

export function useFulfillEvidenceRequest(projectId: number | undefined) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: async (params: { id: number; evidenceUrl: string }) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/evidence-requests/${params.id}/fulfill`, {
        evidenceUrl: params.evidenceUrl,
      });
      return res.json();
    },
    onSuccess: () => invalidate([
      `/api/projects/${projectId}/evidence-requests`,
      `/api/projects/${projectId}/stage-dependencies`,
    ]),
  });
}

// ── Project Queries ────────────────────────────────────────

export function useProjectQueries(projectId: number | undefined, stageCode?: string) {
  const url = stageCode
    ? `/api/projects/${projectId}/queries?stageCode=${stageCode}`
    : `/api/projects/${projectId}/queries`;
  return useQuery<{ queries: ProjectQuery[] }>({
    queryKey: [url],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId,
  });
}

export function useCreateQuery(projectId: number | undefined) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: async (params: {
      stageCode: string;
      queryType: string;
      raisedByDepartment?: string;
      subject: string;
      description?: string;
      priority?: string;
      assignedToUserId?: number;
    }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/queries`, params);
      return res.json();
    },
    onSuccess: () => invalidate([`/api/projects/${projectId}/queries`]),
  });
}

export function useRespondToQuery(projectId: number | undefined) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: async (params: { id: number; responseText: string; newStatus?: string }) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/queries/${params.id}/respond`, params);
      return res.json();
    },
    onSuccess: () => invalidate([`/api/projects/${projectId}/queries`]),
  });
}

export function useUpdateQueryStatus(projectId: number | undefined) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: async (params: { id: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/queries/${params.id}/status`, params);
      return res.json();
    },
    onSuccess: () => invalidate([`/api/projects/${projectId}/queries`]),
  });
}

// ── Client Updates ─────────────────────────────────────────

export function useClientUpdates(projectId: number | undefined) {
  return useQuery<{ updates: ClientUpdate[] }>({
    queryKey: [`/api/projects/${projectId}/client-updates`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId,
  });
}

export function useCreateClientUpdate(projectId: number | undefined) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: async (params?: {
      progressSummaryText?: string;
      completedThisPeriodText?: string;
      next7DaysText?: string;
      blockersText?: string;
      clientActionsRequiredText?: string;
      reviewerUserId?: number;
    }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/client-updates`, params || {});
      return res.json();
    },
    onSuccess: () => invalidate([`/api/projects/${projectId}/client-updates`]),
  });
}

export function useUpdateClientUpdate(projectId: number | undefined) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: async (params: {
      id: number;
      clientUpdateStatus?: string;
      progressSummaryText?: string;
      completedThisPeriodText?: string;
      next7DaysText?: string;
      blockersText?: string;
      clientActionsRequiredText?: string;
      reviewerUserId?: number;
    }) => {
      const { id, ...body } = params;
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/client-updates/${id}`, body);
      return res.json();
    },
    onSuccess: () => invalidate([`/api/projects/${projectId}/client-updates`]),
  });
}

export function useGenerateClientUpdateDraft(projectId: number | undefined) {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/client-updates/generate-draft`);
      return res.json();
    },
  });
}

// ── Gates (cross-project) ──────────────────────────────────

export function useGatesQueries() {
  return useQuery<{ queries: ProjectQuery[] }>({
    queryKey: ["/api/gates/queries"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}

export function useGatesCommitments() {
  return useQuery<{ commitments: ClientCommitment[] }>({
    queryKey: ["/api/gates/commitments"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}
