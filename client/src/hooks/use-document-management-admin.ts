/**
 * D6 admin hooks — folder taxonomy + approval requirements.
 *
 * Backed by /api/admin/folder-taxonomy and
 * /api/admin/document-approval-requirements (see
 * server/routes/document-management-admin.routes.ts).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import type {
  FolderTaxonomy,
  DocumentApprovalRequirement,
  FolderLifecycleMode,
} from "@shared/schema";

const TAXONOMY_KEY = ["/api/admin/folder-taxonomy"] as const;
const REQUIREMENTS_KEY = ["/api/admin/document-approval-requirements"] as const;

// =========================================================================
// Folder taxonomy
// =========================================================================

interface TaxonomyResponse {
  taxonomy: FolderTaxonomy[];
}

export function useFolderTaxonomy(enabled = true) {
  return useQuery<TaxonomyResponse>({
    queryKey: TAXONOMY_KEY,
    queryFn: getQueryFn({ on401: "throw" }),
    enabled,
  });
}

export interface CreateTaxonomyPayload {
  internalKey: string;
  displayName: string;
  parentKey?: string | null;
  lifecycleMode: FolderLifecycleMode;
  stageCode?: string | null;
  disciplines: string[];
  description?: string | null;
  sortOrder?: number;
  active?: boolean;
}

export function useCreateTaxonomyRow() {
  const qc = useQueryClient();
  return useMutation<{ row: FolderTaxonomy }, Error, CreateTaxonomyPayload>({
    mutationFn: async (payload) => {
      const res = await apiRequest("POST", "/api/admin/folder-taxonomy", payload);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAXONOMY_KEY });
      qc.invalidateQueries({ queryKey: ["/api/folder-taxonomy"] });
    },
  });
}

export type UpdateTaxonomyPayload = Partial<CreateTaxonomyPayload>;

export function useUpdateTaxonomyRow() {
  const qc = useQueryClient();
  return useMutation<
    { row: FolderTaxonomy },
    Error,
    { internalKey: string; patch: UpdateTaxonomyPayload }
  >({
    mutationFn: async ({ internalKey, patch }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/folder-taxonomy/${encodeURIComponent(internalKey)}`,
        patch,
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAXONOMY_KEY });
      qc.invalidateQueries({ queryKey: ["/api/folder-taxonomy"] });
    },
  });
}

export function useDeactivateTaxonomyRow() {
  const qc = useQueryClient();
  return useMutation<{ row: FolderTaxonomy }, Error, string>({
    mutationFn: async (internalKey) => {
      const res = await apiRequest(
        "DELETE",
        `/api/admin/folder-taxonomy/${encodeURIComponent(internalKey)}`,
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAXONOMY_KEY });
      qc.invalidateQueries({ queryKey: ["/api/folder-taxonomy"] });
    },
  });
}

// =========================================================================
// Approval requirements
// =========================================================================

interface RequirementsResponse {
  requirements: DocumentApprovalRequirement[];
}

export function useApprovalRequirements(enabled = true) {
  return useQuery<RequirementsResponse>({
    queryKey: REQUIREMENTS_KEY,
    queryFn: getQueryFn({ on401: "throw" }),
    enabled,
  });
}

export interface CreateRequirementPayload {
  taxonomyKey: string;
  fileNamePattern?: string | null;
  displayName: string;
  description?: string | null;
  approverRoles: string[];
  requiresAllApprovers?: boolean;
  extractSpec?: { sheetName?: string; cells?: Record<string, string> } | null;
  sortOrder?: number;
  active?: boolean;
}

export function useCreateRequirement() {
  const qc = useQueryClient();
  return useMutation<{ row: DocumentApprovalRequirement }, Error, CreateRequirementPayload>({
    mutationFn: async (payload) => {
      const res = await apiRequest("POST", "/api/admin/document-approval-requirements", payload);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: REQUIREMENTS_KEY });
      qc.invalidateQueries({ queryKey: ["/api/document-approval-requirements"] });
    },
  });
}

export type UpdateRequirementPayload = Partial<CreateRequirementPayload>;

export function useUpdateRequirement() {
  const qc = useQueryClient();
  return useMutation<
    { row: DocumentApprovalRequirement },
    Error,
    { id: number; patch: UpdateRequirementPayload }
  >({
    mutationFn: async ({ id, patch }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/document-approval-requirements/${id}`,
        patch,
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: REQUIREMENTS_KEY });
      qc.invalidateQueries({ queryKey: ["/api/document-approval-requirements"] });
    },
  });
}

export function useDeactivateRequirement() {
  const qc = useQueryClient();
  return useMutation<{ row: DocumentApprovalRequirement }, Error, number>({
    mutationFn: async (id) => {
      const res = await apiRequest("DELETE", `/api/admin/document-approval-requirements/${id}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: REQUIREMENTS_KEY });
      qc.invalidateQueries({ queryKey: ["/api/document-approval-requirements"] });
    },
  });
}
