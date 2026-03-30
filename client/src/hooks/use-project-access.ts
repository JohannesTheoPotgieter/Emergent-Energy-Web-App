import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQueryFn, apiRequest } from "@/lib/queryClient";

export interface ProjectAccessRecord {
  id: number;
  projectId: number;
  userId: number;
  userName: string;
  userEmail: string;
  userRole: string;
  accessLevel: string;
  roleOnProject: string;
  stagesVisible: string[];
  canEdit: boolean;
  canApprove: boolean;
  grantedAt: string;
  expiresAt: string | null;
  notes: string | null;
}

export function useProjectAccess(projectId: number) {
  return useQuery<{ team: ProjectAccessRecord[] }>({
    queryKey: [`/api/projects/${projectId}/access`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: projectId > 0,
  });
}

export function useAddProjectAccess(projectId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      userId: number; accessLevel?: string; roleOnProject: string;
      stagesVisible?: string[]; canEdit?: boolean; canApprove?: boolean; notes?: string;
    }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/access`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/access`] });
    },
  });
}

export function useUpdateProjectAccess(projectId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accessId, ...data }: {
      accessId: number; accessLevel?: string; roleOnProject?: string;
      stagesVisible?: string[]; canEdit?: boolean; canApprove?: boolean;
      expiresAt?: string | null; notes?: string;
    }) => {
      const res = await apiRequest("PUT", `/api/projects/${projectId}/access/${accessId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/access`] });
    },
  });
}

export function useRemoveProjectAccess(projectId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (accessId: number) => {
      const res = await apiRequest("DELETE", `/api/projects/${projectId}/access/${accessId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/access`] });
    },
  });
}
