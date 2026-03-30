// ============================================================
// GATES HOOKS — React Query hooks for the Gates workspace
// ============================================================

import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

export interface GateProjectCard {
  projectId: number;
  projectName: string;
  clientName: string | null;
  pm: string | null;
  pd: string | null;
  constructionManager: string | null;
  currentStageCode: string | null;
  gateStatus: string | null;
  gateReadinessPct: number;
  waitingOnDepartment: string | null;
  waitingOnUserId: number | null;
  nextRequiredAction: string | null;
  daysInStage: number;
  openExceptionCount: number;
  ragStatus: string | null;
  contractValue: string | null;
  executionPhase: string | null;
  archivedStatus: string;
}

export interface GatesPipelinePayload {
  projects: GateProjectCard[];
  stageCounts: Record<string, number>;
}

export function useGatesPipeline() {
  return useQuery<GatesPipelinePayload>({
    queryKey: ["/api/gates/pipeline"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}

export function useGatesBlocked() {
  return useQuery<{ projects: GateProjectCard[] }>({
    queryKey: ["/api/gates/blocked"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}

export function useGatesReady() {
  return useQuery<{ projects: GateProjectCard[] }>({
    queryKey: ["/api/gates/ready"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}

export function useGatesExceptions() {
  return useQuery<{ exceptions: any[] }>({
    queryKey: ["/api/gates/exceptions"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}

export function useGatesClientUpdates() {
  return useQuery<{ projects: any[] }>({
    queryKey: ["/api/gates/client-updates"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}

export function useGatesHandovers() {
  return useQuery<{ projects: GateProjectCard[] }>({
    queryKey: ["/api/gates/handovers"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}
