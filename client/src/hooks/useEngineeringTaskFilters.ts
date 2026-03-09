import { useMemo } from "react";
import type { Task } from "@/components/tasks/types";

interface Args {
  tasks: Task[];
  statusFilter: string;
  priorityFilter: string;
  assigneeFilter: string;
  projectFilter: string;
  searchTerm: string;
}

export function useEngineeringTaskFilters({
  tasks,
  statusFilter,
  priorityFilter,
  assigneeFilter,
  projectFilter,
  searchTerm,
}: Args) {
  const filtered = useMemo(
    () =>
      tasks.filter((t) => {
        if (statusFilter !== "all" && t.status !== statusFilter) return false;
        if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
        if (assigneeFilter !== "all" && !(t.assignees || []).includes(assigneeFilter)) return false;
        if (projectFilter !== "all" && (t.projectName || "") !== projectFilter) return false;
        if (searchTerm) {
          const term = searchTerm.toLowerCase();
          return t.title.toLowerCase().includes(term) || (t.projectName || "").toLowerCase().includes(term);
        }
        return true;
      }),
    [assigneeFilter, priorityFilter, projectFilter, searchTerm, statusFilter, tasks],
  );

  return {
    filtered,
    overdueTasks: filtered.filter((t) => t.dueDate && t.status !== "COMPLETE" && new Date(t.dueDate) < new Date()),
    needsApprovalTasks: filtered.filter((t) => t.status === "NEEDS APPROVAL"),
    holdTasks: filtered.filter((t) => t.status === "HOLD"),
  };
}
