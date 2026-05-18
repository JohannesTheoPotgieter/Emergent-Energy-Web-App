import { type Project, type ProjectInfo } from "@shared/schema";

/**
 * The mapper reads a few execution-state fields (phase, handover dates) that
 * live on `project_execution_state`, not the `project_info` schema type.
 * Depending on the read path the caller may pass a plain `ProjectInfo` row
 * (these extra fields absent → defaults apply) or a row already joined with
 * execution-state columns. Model that precisely instead of widening to `any`.
 */
type LegacyProjectSource = ProjectInfo & {
  phase?: string | null;
  executionPhase?: string | null;
  constructionStartDate?: string | null;
  pdHandoverDate?: string | null;
  clientHandoverDate?: string | null;
  omHandoverDate?: string | null;
};

/**
 * Maps a project_info row to the legacy Project shape.
 * Pure transform — no DB access.
 *
 * Shared by LegacyProjectReadRepository and (temporarily) the dead
 * legacy write methods in storage.ts until they are removed.
 */
export function mapProjectInfoToLegacyProject(project: LegacyProjectSource): Project {
  const code = `PI-${String(project.id).padStart(5, "0")}`;
  return {
    id: project.id,
    name: project.projectName,
    code,
    manager: project.pm || project.pd || "Unassigned",
    site: "N/A",
    status: project.phase || "Planning",
    stage: project.executionPhase || project.phase || "Development",
    startDate: project.constructionStartDate || project.pdHandoverDate || "",
    completionDate: project.clientHandoverDate || project.omHandoverDate || "",
    budget: project.contractValue || "0",
    sourceFile: "project_info",
    lastUpdated: project.updatedAt,
  };
}
