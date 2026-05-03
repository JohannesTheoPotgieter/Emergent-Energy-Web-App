/**
 * D6 Phase 6 — readiness hooks.
 *
 * Backed by /api/projects/:id/readiness and
 * /api/portfolio/document-readiness. Read-only — no mutations.
 */

import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

// =========================================================================
// Types — kept in lockstep with the server-side service.
// =========================================================================

export interface DisciplineReadiness {
  discipline: string;
  foldersTotal: number;
  foldersProvisioned: number;
  requirementsTotal: number;
  requirementsApproved: number;
  percentReady: number;
}

export interface RequirementReadiness {
  requirementId: number;
  taxonomyKey: string;
  displayName: string;
  status: "approved" | "in_review" | "missing" | "folder_missing";
  approvedDocumentId: number | null;
}

export interface ProjectReadiness {
  projectId: number;
  projectName: string;
  foldersTotal: number;
  foldersProvisioned: number;
  requirementsTotal: number;
  requirementsApproved: number;
  percentReady: number;
  perDiscipline: DisciplineReadiness[];
  requirements: RequirementReadiness[];
}

export interface PortfolioReadinessRow {
  projectId: number;
  projectName: string;
  foldersTotal: number;
  foldersProvisioned: number;
  requirementsTotal: number;
  requirementsApproved: number;
  percentReady: number;
  hasFolderGap: boolean;
}

interface PortfolioResponse {
  rows: PortfolioReadinessRow[];
}

// =========================================================================
// Hooks
// =========================================================================

export function useProjectReadiness(projectId: number | null) {
  return useQuery<ProjectReadiness>({
    queryKey: projectId
      ? [`/api/projects/${projectId}/readiness`]
      : ["/api/projects/0/readiness"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: typeof projectId === "number" && projectId > 0,
    staleTime: 30_000,
  });
}

export function usePortfolioReadiness(enabled = true) {
  return useQuery<PortfolioResponse>({
    queryKey: ["/api/portfolio/document-readiness"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled,
    staleTime: 60_000,
  });
}
