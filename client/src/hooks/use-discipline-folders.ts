/**
 * Discipline-folder binding hooks (browse-and-bind document setup).
 *
 * Thin client over the Phase 1 endpoints:
 *   GET    /api/projects/:projectId/discipline-folders
 *   PUT    /api/projects/:projectId/discipline-folders
 *   DELETE /api/projects/:projectId/discipline-folders/:discipline
 *
 * Mutations use useApiMutation so success/error feedback is guaranteed
 * (EE-QA-021).
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { apiRequest } from "@/lib/queryClient";
import type { ProjectDisciplineFolder } from "@shared/schema";

function listKey(projectId: number | null) {
  return [`/api/projects/${projectId ?? 0}/discipline-folders`] as const;
}

/** Active discipline-folder bindings for a project. */
export function useDisciplineFolders(projectId: number | null) {
  return useQuery<{ folders: ProjectDisciplineFolder[] }>({
    queryKey: listKey(projectId),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projects/${projectId}/discipline-folders`);
      return res.json();
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

export interface BindDisciplineFolderInput {
  projectId: number;
  discipline: string;
  driveId: string;
  itemId: string;
  sharepointPath?: string | null;
  webUrl?: string | null;
}

/** Bind (or re-bind) a SharePoint folder to a project's discipline. */
export function useBindDisciplineFolder() {
  const qc = useQueryClient();
  return useApiMutation<{ folder: ProjectDisciplineFolder }, Error, BindDisciplineFolderInput>({
    mutationFn: async (input) => {
      const res = await apiRequest("PUT", `/api/projects/${input.projectId}/discipline-folders`, {
        discipline: input.discipline,
        driveId: input.driveId,
        itemId: input.itemId,
        sharepointPath: input.sharepointPath ?? null,
        webUrl: input.webUrl ?? null,
      });
      return res.json();
    },
    successToast: (_data, vars) => `${vars.discipline} folder bound`,
    errorToast: "Couldn’t bind folder",
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: listKey(vars.projectId) });
    },
  });
}

/** Soft-unbind a project's discipline folder. */
export function useUnbindDisciplineFolder() {
  const qc = useQueryClient();
  return useApiMutation<{ ok: boolean }, Error, { projectId: number; discipline: string }>({
    mutationFn: async ({ projectId, discipline }) => {
      const res = await apiRequest(
        "DELETE",
        `/api/projects/${projectId}/discipline-folders/${encodeURIComponent(discipline)}`,
      );
      return res.json();
    },
    successToast: (_data, vars) => `${vars.discipline} folder unbound`,
    errorToast: "Couldn’t unbind folder",
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: listKey(vars.projectId) });
    },
  });
}
