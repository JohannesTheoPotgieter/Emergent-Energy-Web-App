/**
 * Engineering project-picker options.
 *
 * Single source for every project dropdown in the Engineering section: wraps
 * the canonical `useProjectsSummary()` and returns `{ id, name }[]` that is
 *   1. filtered to the active execution window — Financial Close onward
 *      (+ Hold), excluding Done and pre-Financial-Close projects, and
 *   2. sorted alphabetically by name.
 *
 * Keeps the "alphabetical + only live delivery work" rule in one place so the
 * Home, Task Manager, and Document Manager pickers stay consistent.
 */

import { useMemo } from "react";
import { useProjectsSummary } from "@/hooks/use-projects-summary";
import { isInActiveExecutionWindow } from "@shared/phases";

export interface EngineeringProjectOption {
  id: number;
  name: string;
}

export function useEngineeringProjectOptions() {
  const { projectsSummary, isLoading } = useProjectsSummary();

  const options = useMemo<EngineeringProjectOption[]>(() => {
    return (projectsSummary ?? [])
      .filter((p) => p.project_info_id != null && isInActiveExecutionWindow(p.phase))
      .map((p) => ({ id: p.project_info_id as number, name: p.project_name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projectsSummary]);

  return { options, isLoading };
}
