import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

export interface PerformanceV1Data {
  stageDuration: Array<{ stage_code: string; project_count: number; avg_days: number; min_days: number; max_days: number }>;
  projectCompletion: { total: number; completed: number; on_time: number; late: number };
  stageDistribution: Array<{ stage_code: string; count: number }>;
  commissioning: { done: number; planned_by_now: number; total: number };
  reviews: { completed: number; due: number; total: number };
  repeatIssues: {
    metering_problems: number; sseg_delays: number; scope_drift: number;
    quality_defects: number; installer_issues: number;
  };
}

export function usePerformanceV1() {
  return useQuery<PerformanceV1Data>({
    queryKey: ["/api/performance/v1"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}

export function useGateReports() {
  return useQuery<{ blockedGates: any[]; exceptionAgeing: any[] }>({
    queryKey: ["/api/reports/gate-reports"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}

export function useOperationalReports() {
  return useQuery<{ commissioningQueue: any[]; handoverQueue: any[]; weeklyCompliance: any[] }>({
    queryKey: ["/api/reports/operational"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}

export function useQualityComplianceReports() {
  return useQuery<{ qualityBlockers: any[]; complianceBlockers: any[] }>({
    queryKey: ["/api/reports/quality-compliance"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}
