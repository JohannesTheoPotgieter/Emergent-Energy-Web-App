/**
 * D6 Phase 7 — folder-scoped file list.
 *
 * Backed by GET /api/projects/:projectId/folders/:folderId/files. Returns
 * each managed_document with its full approval audit list so the FolderFiles
 * component can show status badges + actions without a per-file follow-up
 * round trip.
 */

import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { ApprovalRow } from "@/hooks/use-managed-document-approvals";

export interface ManagedDocumentRow {
  id: number;
  rootScope: string;
  projectId: number | null;
  parentFolderId: number | null;
  driveId: string;
  driveItemId: string;
  name: string;
  path: string;
  state: "draft" | "in_review" | "approved" | "superseded" | "archived";
  ownerUserId: number | null;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface FolderFile {
  document: ManagedDocumentRow;
  approvals: ApprovalRow[];
}

interface FolderFilesResponse {
  projectId: number;
  folderId: number;
  taxonomyKey: string;
  files: FolderFile[];
}

export function useFolderFiles(
  projectId: number | null,
  folderId: number | null,
  enabled = true,
) {
  return useQuery<FolderFilesResponse>({
    queryKey:
      projectId && folderId
        ? [`/api/projects/${projectId}/folders/${folderId}/files`]
        : ["/api/projects/0/folders/0/files"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled:
      enabled &&
      typeof projectId === "number" &&
      projectId > 0 &&
      typeof folderId === "number" &&
      folderId > 0,
    staleTime: 15_000,
  });
}
