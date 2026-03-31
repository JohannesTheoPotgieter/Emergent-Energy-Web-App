// ============================================================
// STAGE LIFECYCLE HOOKS — React Query hooks for gate-driven lifecycle
// ============================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import type {
  ProjectStageInstance,
  ProjectStageRequirement,
  ProjectStageException,
  ProjectStageDependency,
  ProjectStageDecision,
  ProjectStageEvidence,
  StageDefinition,
  StageChecklistTemplate,
} from "@shared/schema";

// ── Types ───────────────────────────────────────────────────

export interface StageDashboardPayload {
  stages: (ProjectStageInstance & { daysInStage: number })[];
  currentStage: (ProjectStageInstance & { daysInStage: number }) | null;
  requirements: ProjectStageRequirement[];
  openExceptionCount: number;
  openDependencyCount: number;
  statusSentence: string;
}

export interface StageDetailPayload {
  stage: ProjectStageInstance;
  requirements: ProjectStageRequirement[];
  evidence: ProjectStageEvidence[];
  exceptions: ProjectStageException[];
  dependencies: ProjectStageDependency[];
}

// ── Query Hooks ─────────────────────────────────────────────

export function useProjectStages(projectId: number | undefined) {
  return useQuery<StageDashboardPayload>({
    queryKey: [`/api/projects/${projectId}/stages`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId,
  });
}

export function useStageDetail(projectId: number | undefined, stageCode: string | undefined) {
  return useQuery<StageDetailPayload>({
    queryKey: [`/api/projects/${projectId}/stages/${stageCode}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId && !!stageCode,
  });
}

export function useStageRequirements(projectId: number | undefined, stageCode: string | undefined) {
  return useQuery<{ requirements: ProjectStageRequirement[] }>({
    queryKey: [`/api/projects/${projectId}/stages/${stageCode}/requirements`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId && !!stageCode,
  });
}

export function useStageExceptions(projectId: number | undefined, stageCode?: string) {
  const url = stageCode
    ? `/api/projects/${projectId}/stage-exceptions?stageCode=${stageCode}`
    : `/api/projects/${projectId}/stage-exceptions`;
  return useQuery<{ exceptions: ProjectStageException[] }>({
    queryKey: [url],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId,
  });
}

export function useStageDependencies(projectId: number | undefined, stageCode?: string) {
  const url = stageCode
    ? `/api/projects/${projectId}/stage-dependencies?stageCode=${stageCode}`
    : `/api/projects/${projectId}/stage-dependencies`;
  return useQuery<{ dependencies: ProjectStageDependency[] }>({
    queryKey: [url],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId,
  });
}

export function useStageDecisions(projectId: number | undefined) {
  return useQuery<{ decisions: ProjectStageDecision[] }>({
    queryKey: [`/api/projects/${projectId}/stage-decisions`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId,
  });
}

export function useStageDefinitions() {
  return useQuery<{ definitions: StageDefinition[] }>({
    queryKey: ["/api/admin/stage-definitions"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}

export function useStageChecklistTemplates(stageCode?: string) {
  const url = stageCode
    ? `/api/admin/stage-checklist-templates?stageCode=${stageCode}`
    : "/api/admin/stage-checklist-templates";
  return useQuery<{ templates: StageChecklistTemplate[] }>({
    queryKey: [url],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}

// ── Mutation Hooks ──────────────────────────────────────────

function useInvalidateStages(projectId: number | undefined) {
  const qc = useQueryClient();
  return () => {
    if (projectId) {
      qc.invalidateQueries({ predicate: (q) => {
        const key = q.queryKey[0];
        return typeof key === "string" && key.startsWith(`/api/projects/${projectId}/stages`);
      }});
    }
  };
}

export function useInitializeStages(projectId: number | undefined) {
  const invalidate = useInvalidateStages(projectId);
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/stages/initialize`);
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useTransitionStage(projectId: number | undefined) {
  const invalidate = useInvalidateStages(projectId);
  return useMutation({
    mutationFn: async (params: { stageCode: string; newStatus: string; reason?: string; isOverride?: boolean }) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/stages/${params.stageCode}/status`, {
        newStatus: params.newStatus,
        reason: params.reason,
        isOverride: params.isOverride,
      });
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useAdvanceToStage(projectId: number | undefined) {
  const invalidate = useInvalidateStages(projectId);
  return useMutation({
    mutationFn: async (params: { targetStageCode: string; reason?: string }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/stages/advance-to/${params.targetStageCode}`, {
        reason: params.reason,
      });
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useHydrateChecklist(projectId: number | undefined) {
  const invalidate = useInvalidateStages(projectId);
  return useMutation({
    mutationFn: async (stageCode: string) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/stages/${stageCode}/requirements/hydrate`);
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useUpdateRequirement(projectId: number | undefined) {
  const invalidate = useInvalidateStages(projectId);
  return useMutation({
    mutationFn: async (params: { requirementId: number; status: string; evidenceUrl?: string; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/requirements/${params.requirementId}`, {
        status: params.status,
        evidenceUrl: params.evidenceUrl,
        notes: params.notes,
      });
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useCreateException(projectId: number | undefined) {
  const invalidate = useInvalidateStages(projectId);
  return useMutation({
    mutationFn: async (params: {
      stageCode: string;
      requirementCode?: string;
      reasonText: string;
      riskLevel: string;
      mitigationText?: string;
      closeoutDueDate?: string;
      downstreamBlockingStage?: string;
    }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/stage-exceptions`, params);
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useApproveException(projectId: number | undefined) {
  const invalidate = useInvalidateStages(projectId);
  return useMutation({
    mutationFn: async (params: { exceptionId: number; conditions?: string }) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/stage-exceptions/${params.exceptionId}/approve`, {
        conditions: params.conditions,
      });
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useRejectException(projectId: number | undefined) {
  const invalidate = useInvalidateStages(projectId);
  return useMutation({
    mutationFn: async (params: { exceptionId: number; reason: string }) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/stage-exceptions/${params.exceptionId}/reject`, {
        reason: params.reason,
      });
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useCreateDependency(projectId: number | undefined) {
  const invalidate = useInvalidateStages(projectId);
  return useMutation({
    mutationFn: async (params: {
      stageCode: string;
      fromDepartment: string;
      fromUserId?: number;
      toDepartment: string;
      toUserId?: number;
      description: string;
      dueDate?: string;
    }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/stage-dependencies`, params);
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useResolveDependency(projectId: number | undefined) {
  const invalidate = useInvalidateStages(projectId);
  return useMutation({
    mutationFn: async (depId: number) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/stage-dependencies/${depId}/resolve`);
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useEscalateDependency(projectId: number | undefined) {
  const invalidate = useInvalidateStages(projectId);
  return useMutation({
    mutationFn: async (params: { depId: number; reason?: string }) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/stage-dependencies/${params.depId}/escalate`, {
        reason: params.reason,
      });
      return res.json();
    },
    onSuccess: invalidate,
  });
}
