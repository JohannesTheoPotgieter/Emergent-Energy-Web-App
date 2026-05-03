import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { SearchableSelectOption } from "@/components/ui/searchable-select";

interface RawUser { id: number; name: string; role: string | null }
interface RawProject {
  id?: number;
  project_info_id?: number;
  projectName?: string;
  project_name?: string;
  name?: string;
}

/**
 * Shared React-Query hooks for the priority dialogs. Centralises auth
 * handling (via apiRequest) and dedupes the "load users / load projects"
 * boilerplate that used to live inline on every dialog.
 */
export function useUserOptions(enabled: boolean): SearchableSelectOption[] {
  const { data: users = [] } = useQuery<RawUser[]>({
    queryKey: ["/api/users-list-for-priority"],
    queryFn: async () => {
      // Canonical assignable-people directory. Server route lives at
      // `/api/users/assignable` (server/ms-sync-routes.ts) and returns
      // `[{ id, name, username, role, email }]` for internal users.
      try {
        const res = await apiRequest("GET", "/api/users/assignable");
        const data = await res.json();
        const rows = Array.isArray(data) ? data : data.users || data.data || [];
        return rows
          .map((u: RawUser) => ({ id: u.id, name: u.name, role: u.role ?? null }))
          .filter((u: RawUser) => u.id && u.name)
          .sort((a: RawUser, b: RawUser) => a.name.localeCompare(b.name));
      } catch {
        return [];
      }
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
  return useMemo(
    () => users.map((u) => ({ value: String(u.id), label: u.name })),
    [users],
  );
}

export interface ProjectPickerOption { value: number; label: string }

export function useProjectOptions(enabled: boolean): ProjectPickerOption[] {
  const { data: projects = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/priorities-project-picker"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/projects-summary");
        const data = await res.json();
        const rows: RawProject[] = Array.isArray(data) ? data : data.projects || data.data?.rows || [];
        if (rows.length > 0) {
          return rows.map((p) => ({
            id: (p.id ?? p.project_info_id) as number,
            name: p.projectName || p.project_name || p.name || `Project ${p.id ?? p.project_info_id}`,
          }));
        }
      } catch {
        // fall through
      }
      try {
        const res = await apiRequest("GET", "/api/v2/projects?pageSize=500");
        const data = await res.json();
        return ((data.data?.rows || []) as RawProject[]).map((p) => ({
          id: p.id as number,
          name: p.projectName || p.project_name || p.name || `Project ${p.id}`,
        }));
      } catch {
        return [];
      }
    },
    enabled,
  });
  return useMemo(() => projects.map((p) => ({ value: p.id, label: p.name })), [projects]);
}
