/**
 * DisciplineProjectDocuments — the body of the Engineering / Quality document
 * pages.
 *
 * It resolves the project picker options for this discipline's scope and owns
 * the selected project, then hands both to the three-pane DisciplineWorkspace.
 * The project selector itself now lives INSIDE the workspace's left rail (Drive-
 * like), so this component is just the option source + selection state.
 *
 * Engineering and Quality are different discipline filters over the same
 * provisioned folder tree; the only difference here is `projectScope`.
 */

import { useMemo, useState } from "react";
import { useEngineeringProjectOptions } from "@/hooks/use-engineering-project-options";
import { useProjectsSummary } from "@/hooks/use-projects-summary";
import { DisciplineWorkspace } from "@/components/documents/DisciplineWorkspace";

/**
 * `projectScope` controls which projects the picker offers:
 *  - "active-window" — Engineering: alphabetical, live delivery work only
 *    (Financial Close → not Done) via the shared Engineering options hook.
 *  - "all" (default) — every project, alphabetical. Used by Quality, which
 *    may need docs for any stage (e.g. Done-stage compliance/handover), so
 *    the active-window rule is intentionally NOT applied there.
 */
export function DisciplineProjectDocuments({
  discipline,
  projectScope = "all",
}: {
  discipline: string;
  projectScope?: "active-window" | "all";
}) {
  const activeWindow = useEngineeringProjectOptions();
  const summary = useProjectsSummary();

  const { options: projectOptions, isLoading } = useMemo(() => {
    if (projectScope === "active-window") {
      return { options: activeWindow.options, isLoading: activeWindow.isLoading };
    }
    const options = (summary.projectsSummary ?? [])
      .filter((p) => p.project_info_id != null)
      .map((p) => ({ id: p.project_info_id as number, name: p.project_name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { options, isLoading: summary.isLoading };
  }, [
    projectScope,
    activeWindow.options,
    activeWindow.isLoading,
    summary.projectsSummary,
    summary.isLoading,
  ]);

  const [projectId, setProjectId] = useState<number | null>(null);

  return (
    <DisciplineWorkspace
      discipline={discipline}
      projectScope={projectScope}
      projectOptions={projectOptions}
      projectsLoading={isLoading}
      projectId={projectId}
      onProjectChange={setProjectId}
    />
  );
}
