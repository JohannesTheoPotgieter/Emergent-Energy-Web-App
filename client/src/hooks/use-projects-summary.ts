/**
 * Prompt 15 — Direct projects summary query
 *
 * Replaces ProgramProvider's projectsSummary context
 * with a direct useQuery call.
 */

import { useQuery } from "@tanstack/react-query";
import { overviewApi, type ProjectSummary } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export function useProjectsSummary() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const { data: projectsSummary, isLoading } = useQuery<ProjectSummary[]>({
    queryKey: ["projects-summary"],
    queryFn: overviewApi.getProjectsSummary,
    enabled: isAuthenticated && !authLoading,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return {
    projectsSummary: projectsSummary ?? null,
    isLoading,
  };
}
