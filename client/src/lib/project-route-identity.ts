export type ProjectSummaryIdentity = {
  project_info_id: number;
  project_name: string;
};

export function findProjectByName<T extends ProjectSummaryIdentity>(projects: T[] | undefined, projectName: string): T | null {
  if (!projects || !projectName) return null;
  return projects.find((p) => p.project_name === projectName) ?? null;
}

export function findProjectById<T extends ProjectSummaryIdentity>(projects: T[] | undefined, projectId: number | null): T | null {
  if (!projects || !projectId) return null;
  return projects.find((p) => p.project_info_id === projectId) ?? null;
}
