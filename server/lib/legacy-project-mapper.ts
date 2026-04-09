import { type Project } from "@shared/schema";

/**
 * Maps a project_info row to the legacy Project shape.
 * Pure transform — no DB access.
 *
 * Shared by LegacyProjectReadRepository and (temporarily) the dead
 * legacy write methods in storage.ts until they are removed.
 */
export function mapProjectInfoToLegacyProject(project: any): Project {
  const code = `PI-${String(project.id).padStart(5, "0")}`;
  return {
    id: project.id,
    name: project.projectName,
    code,
    manager: project.pm || project.pd || "Unassigned",
    site: "N/A",
    status: (project.phase || "Planning") as any,
    stage: (project.executionPhase || project.phase || "Development") as any,
    startDate: project.constructionStartDate || project.pdHandoverDate || "",
    completionDate: project.clientHandoverDate || project.omHandoverDate || "",
    budget: project.contractValue || "0",
    sourceFile: "project_info",
    lastUpdated: project.updatedAt,
  };
}
