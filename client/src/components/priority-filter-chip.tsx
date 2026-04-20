import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";

/**
 * Drop-in filter for department dashboards (engineering / quality / HSE / PD).
 * Lets a department head filter their project list to projects that roll up
 * under a chosen strategic priority.
 *
 * Usage:
 *   const [projectIds, setProjectIds] = useState<number[] | null>(null);
 *   <PriorityFilterChip onProjectIdsChange={setProjectIds} />
 *   // then in your board:
 *   const filteredProjects = projectIds
 *     ? allProjects.filter(p => projectIds.includes(p.id))
 *     : allProjects;
 *
 * `onProjectIdsChange(null)` = no priority filter (show all).
 * `onProjectIdsChange([])`  = priority selected but it has zero linked
 *                             projects (board should show empty state).
 */
export function PriorityFilterChip({
  scope = "company",
  department,
  onProjectIdsChange,
}: {
  scope?: "company" | "department" | "role";
  department?: string;
  onProjectIdsChange: (projectIds: number[] | null) => void;
}) {
  const [selectedPriorityId, setSelectedPriorityId] = useState<string>("");

  // Load a lightweight priority list for the current tab.
  const { data: priorities = [] } = useQuery<{ id: number; title: string; effectiveHealth?: string }[]>({
    queryKey: ["/api/priorities/filter-chip", scope, department],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const qs = new URLSearchParams({ scope });
      if (department) qs.set("department", department);
      const res = await fetch(`/api/priorities?${qs.toString()}`, { credentials: "include", headers });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const options: SearchableSelectOption[] = useMemo(() => priorities.map((p) => ({
    value: String(p.id),
    label: p.title,
  })), [priorities]);

  const onSelect = async (value: string) => {
    setSelectedPriorityId(value);
    if (!value) {
      onProjectIdsChange(null);
      return;
    }
    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`/api/priorities/${value}/project-ids`, { credentials: "include", headers });
    if (!res.ok) {
      onProjectIdsChange([]);
      return;
    }
    const data = await res.json();
    onProjectIdsChange(data.rolledUpProjectIds ?? []);
  };

  const clear = () => {
    setSelectedPriorityId("");
    onProjectIdsChange(null);
  };

  return (
    <div className="flex items-center gap-2">
      <Flag className="w-3.5 h-3.5 text-muted-foreground" />
      <div className="min-w-[220px]">
        <SearchableSelect
          options={options}
          value={selectedPriorityId}
          onValueChange={onSelect}
          placeholder="Filter by priority..."
          searchPlaceholder="Search priorities..."
          data-testid="priority-filter-chip"
        />
      </div>
      {selectedPriorityId && (
        <Button variant="ghost" size="sm" className="text-xs h-7" onClick={clear}>
          <X className="w-3 h-3 mr-1" /> Clear
        </Button>
      )}
    </div>
  );
}
