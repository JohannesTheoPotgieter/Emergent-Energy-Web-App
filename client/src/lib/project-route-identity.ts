export type ProjectSummaryIdentity = {
  project_info_id: number;
  project_name: string;
};

export function findProjectByName(projects: ProjectSummaryIdentity[] | undefined, projectName: string) {
  if (!projects || !projectName) return null;
  return projects.find((p) => p.project_name === projectName) ?? null;
}

export function findProjectById(projects: ProjectSummaryIdentity[] | undefined, projectId: number | null) {
  if (!projects || !projectId) return null;
  return projects.find((p) => p.project_info_id === projectId) ?? null;
}

