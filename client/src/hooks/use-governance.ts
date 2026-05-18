import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQueryFn, apiRequest } from "@/lib/queryClient";

export function useQualityGovernance() {
  return useQuery<{
    commissioningReviews: unknown[];
    openSnags: unknown[];
    qualityChecklist: unknown[];
  }>({
    queryKey: ["/api/governance/quality"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}

export function useComplianceGovernance() {
  return useQuery<{
    ssegByProject: unknown[];
    authoritySubmissions: unknown[];
    meteringPending: unknown[];
  }>({
    queryKey: ["/api/governance/compliance"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}

export function useQualityAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action, assignToUserId }: { id: number; action: string; assignToUserId?: number }) => {
      const res = await apiRequest("PATCH", `/api/governance/quality/${id}/action`, { action, assignToUserId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/governance/quality"] });
    },
  });
}

export function useComplianceAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action, status }: { id: number; action: string; status?: string }) => {
      const res = await apiRequest("PATCH", `/api/governance/compliance/${id}/action`, { action, status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/governance/compliance"] });
    },
  });
}
