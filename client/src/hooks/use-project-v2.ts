/**
 * V2 Project Detail hooks
 *
 * Single consolidated query for project detail,
 * plus lazy-load hooks for each tab domain.
 */

import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  ProjectDetailResponse,
  ProjectFinanceResponse,
  ProjectPlanResponse,
  ProjectQualityResponse,
  ProjectEngineeringResponse,
  FinanceSummaryV2,
  PlanSummary,
  QualitySummary,
  TeamMember,
} from "@shared/api-types/project-v2";

// Re-export sub-types so consumers don't need a separate import
export type { FinanceSummaryV2, PlanSummary, QualitySummary, TeamMember };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await apiRequest("GET", url);
  return res.json();
}

/** Primary consolidated project query — replaces 10+ individual queries */
export function useProjectDetail(projectId: number | undefined) {
  return useQuery<ProjectDetailResponse>({
    queryKey: ["v2-project-detail", projectId],
    queryFn: () => fetchJson<ProjectDetailResponse>(`/api/v2/projects/${projectId}`),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

/** Lazy-load finance data when commercial tab is active */
export function useProjectFinance(projectId: number | undefined, enabled: boolean) {
  return useQuery<ProjectFinanceResponse>({
    queryKey: ["v2-project-finance", projectId],
    queryFn: () => fetchJson<ProjectFinanceResponse>(`/api/v2/projects/${projectId}/finance`),
    enabled: !!projectId && enabled,
    staleTime: 30_000,
  });
}

/** Lazy-load plan data when delivery tab is active */
export function useProjectPlan(projectId: number | undefined, enabled: boolean, workstreamFilter?: string) {
  const url = workstreamFilter
    ? `/api/v2/projects/${projectId}/plan?workstream=${encodeURIComponent(workstreamFilter)}`
    : `/api/v2/projects/${projectId}/plan`;
  return useQuery<ProjectPlanResponse>({
    queryKey: ["v2-project-plan", projectId, workstreamFilter],
    queryFn: () => fetchJson<ProjectPlanResponse>(url),
    enabled: !!projectId && enabled,
    staleTime: 30_000,
  });
}

/** Lazy-load quality data when quality tab is active */
export function useProjectQuality(projectId: number | undefined, enabled: boolean) {
  return useQuery<ProjectQualityResponse>({
    queryKey: ["v2-project-quality", projectId],
    queryFn: () => fetchJson<ProjectQualityResponse>(`/api/v2/projects/${projectId}/quality`),
    enabled: !!projectId && enabled,
    staleTime: 30_000,
  });
}

/** Lazy-load engineering data when engineering tab is active */
export function useProjectEngineering(projectId: number | undefined, enabled: boolean) {
  return useQuery<ProjectEngineeringResponse>({
    queryKey: ["v2-project-engineering", projectId],
    queryFn: () => fetchJson<ProjectEngineeringResponse>(`/api/v2/projects/${projectId}/engineering`),
    enabled: !!projectId && enabled,
    staleTime: 30_000,
  });
}

export function invalidateProjectV2Queries(queryClient: QueryClient, projectId: number | null | undefined, projectName?: string | null) {
  if (!projectId) return;
  queryClient.invalidateQueries({ queryKey: ["v2-project-detail", projectId] });
  queryClient.invalidateQueries({ queryKey: ["v2-project-finance", projectId] });
  queryClient.invalidateQueries({ queryKey: ["v2-project-plan", projectId] });
  queryClient.invalidateQueries({ queryKey: ["v2-project-quality", projectId] });
  queryClient.invalidateQueries({ queryKey: ["v2-project-engineering", projectId] });
  queryClient.invalidateQueries({ queryKey: ["project-header-kpis", projectId] });
  queryClient.invalidateQueries({ queryKey: ["health-summary"] });
  if (projectName) {
    queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] });
    queryClient.invalidateQueries({ queryKey: ["project-plan", projectName] });
    queryClient.invalidateQueries({ queryKey: ["health-summary", projectName] });
    queryClient.invalidateQueries({ queryKey: ["program-inflows", projectName] });
    queryClient.invalidateQueries({ queryKey: ["program-expenses", projectName] });
    queryClient.invalidateQueries({ queryKey: ["revenue-tab", projectName] });
    queryClient.invalidateQueries({ queryKey: ["expenditure-breakdown", projectName, projectId] });
    queryClient.invalidateQueries({ queryKey: ["cashflow", projectName] });
  }
}
