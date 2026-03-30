// ============================================================
// STAGE DATA HOOKS — React Query hooks for stage-specific data + charter
// ============================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import type { ProjectStageData, ProjectCharter } from "@shared/schema";

// ── Stage Data (JSONB) ─────────────────────────────────────

export function useStageData(projectId: number | undefined, stageCode: string | undefined) {
  return useQuery<{ stageData: ProjectStageData | null; data: Record<string, any> }>({
    queryKey: [`/api/projects/${projectId}/stage-data/${stageCode}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId && !!stageCode,
  });
}

export function useSaveStageData(projectId: number | undefined, stageCode: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("PUT", `/api/projects/${projectId}/stage-data/${stageCode}`, { data });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/stage-data/${stageCode}`] });
    },
  });
}

// ── Project Charter ────────────────────────────────────────

export function useProjectCharter(projectId: number | undefined) {
  return useQuery<{ charter: ProjectCharter | null }>({
    queryKey: [`/api/projects/${projectId}/charter`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId,
  });
}

export function useSaveCharter(projectId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (charterData: Partial<ProjectCharter>) => {
      const res = await apiRequest("PUT", `/api/projects/${projectId}/charter`, charterData);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/charter`] });
    },
  });
}

export function useUpdateCharterStatus(projectId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (status: string) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/charter/status`, { status });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/charter`] });
    },
  });
}
