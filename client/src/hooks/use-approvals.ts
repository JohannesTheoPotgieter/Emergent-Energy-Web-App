import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQueryFn, apiRequest } from "@/lib/queryClient";

export interface ApprovalItem {
  approval_type: string;
  item_id: number;
  project_name: string;
  stage_code: string;
  requested_by: string | null;
  date_requested: string;
  priority: string;
  age_days: number;
  summary: string;
}

export function useUnifiedApprovals(typeFilter?: string) {
  const queryParam = typeFilter ? `?type=${typeFilter}` : "";
  return useQuery<{ approvals: ApprovalItem[] }>({
    queryKey: [`/api/approvals${queryParam}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });
}

export function useApprovalAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ type, id, action, comment, delegateToUserId }: {
      type: string; id: number; action: string; comment?: string; delegateToUserId?: number;
    }) => {
      const res = await apiRequest("PATCH", `/api/approvals/${type}/${id}/action`, { action, comment, delegateToUserId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
    },
  });
}
