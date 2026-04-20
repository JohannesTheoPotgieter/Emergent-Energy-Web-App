import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";

interface ProjectOption {
  id: number;
  projectName: string;
}

interface RawProject {
  id?: number;
  project_info_id?: number;
  projectName?: string;
  project_name?: string;
  name?: string;
}

/**
 * Multi-select dialog body for attaching projects to a priority.
 * Lives on the priority detail page and on the "Link projects" CTA from
 * the empty financial-summary card. Standalone so the admin settings
 * "Priorities" surface can reuse it later.
 */
export function ProjectLinker({
  priorityId,
  existingProjectIds,
  onDone,
}: {
  priorityId: number;
  existingProjectIds: number[];
  onDone: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const queryClient = useQueryClient();

  const { data: allProjects = [] } = useQuery<ProjectOption[]>({
    queryKey: ["/api/v2/projects", "linker"],
    queryFn: async () => {
      // Primary source: projects-summary endpoint (widely used across app + role aware).
      try {
        const summaryRes = await apiRequest("GET", "/api/projects-summary");
        const summaryData = await summaryRes.json();
        const summaryRows: RawProject[] = Array.isArray(summaryData)
          ? summaryData
          : summaryData?.projects || summaryData?.data?.rows || [];
        if (summaryRows.length > 0) {
          return summaryRows.map((p) => ({
            id: (p.id ?? p.project_info_id) as number,
            projectName:
              p.projectName || p.project_name || p.name || `Project ${p.id ?? p.project_info_id}`,
          }));
        }
      } catch {
        // Fall through to v2 endpoint.
      }

      try {
        const res = await apiRequest("GET", "/api/v2/projects?pageSize=500");
        const data = await res.json();
        return ((data.data?.rows || []) as RawProject[]).map((p) => ({
          id: p.id as number,
          projectName: p.projectName || p.project_name || p.name || `Project ${p.id}`,
        }));
      } catch {
        return [];
      }
    },
  });

  const available = useMemo(() => {
    const existingSet = new Set(existingProjectIds);
    const needle = search.trim().toLowerCase();
    return allProjects
      .filter((p) => !existingSet.has(p.id))
      .filter((p) => !needle || p.projectName?.toLowerCase().includes(needle));
  }, [allProjects, existingProjectIds, search]);

  const linkMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/priorities/${priorityId}/projects`, { project_ids: selected });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}/activity`] });
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
      onDone();
    },
  });

  const toggle = (id: number, on: boolean) =>
    setSelected((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
          aria-label="Search projects"
        />
      </div>
      <div className="max-h-60 overflow-y-auto space-y-1">
        {available.map((p) => (
          <label
            key={p.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
          >
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={(e) => toggle(p.id, e.target.checked)}
              className="rounded"
              aria-label={`Select ${p.projectName}`}
            />
            <span>{p.projectName}</span>
          </label>
        ))}
        {available.length === 0 && (
          <p className="text-sm text-muted-foreground py-2 text-center">No available projects</p>
        )}
      </div>
      <Button
        size="sm"
        disabled={selected.length === 0 || linkMutation.isPending}
        onClick={() => linkMutation.mutate()}
      >
        Link {selected.length} project{selected.length !== 1 ? "s" : ""}
      </Button>
    </div>
  );
}
