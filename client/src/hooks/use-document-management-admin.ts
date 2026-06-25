/**
 * D6 admin hooks — approval requirements + company SharePoint roots.
 *
 * Backed by /api/admin/document-approval-requirements and
 * /api/admin/company-sharepoint-roots (see
 * server/routes/document-management-admin.routes.ts).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import type { DocumentApprovalRequirement } from "@shared/schema";

const REQUIREMENTS_KEY = ["/api/admin/document-approval-requirements"] as const;

const PUBLIC_REQUIREMENTS_KEY = ["/api/document-approval-requirements"] as const;

// =========================================================================
// Public reads — any authenticated user with documents:view
// =========================================================================

interface PublicRequirementsResponse {
  requirements: DocumentApprovalRequirement[];
}

export function usePublicApprovalRequirements(enabled = true) {
  return useQuery<PublicRequirementsResponse>({
    queryKey: PUBLIC_REQUIREMENTS_KEY,
    queryFn: getQueryFn({ on401: "throw" }),
    enabled,
    staleTime: 60_000,
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
  /** Legacy basis. Provide this OR `discipline`. */
  taxonomyKey?: string | null;
  /** Browse-and-bind basis: a LIFECYCLE_DEPARTMENTS code. Provide this OR `taxonomyKey`. */
  discipline?: string | null;
  /** Optional regex on the path under the bound folder (discipline basis). */
  subfolderPattern?: string | null;
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

// =========================================================================
// Company SharePoint roots (Phase 3.1)
// =========================================================================

export interface CompanySharepointRoot {
  id: number;
  kind: string;
  displayName: string;
  driveId: string | null;
  rootItemId: string | null;
  rootPath: string;
  sortOrder: number;
  active: boolean;
}

interface CompanyRootsResponse {
  roots: CompanySharepointRoot[];
}

const COMPANY_ROOTS_KEY = ["/api/admin/company-sharepoint-roots"] as const;

export function useCompanySharepointRoots(enabled = true) {
  return useQuery<CompanyRootsResponse>({
    queryKey: COMPANY_ROOTS_KEY,
    queryFn: getQueryFn({ on401: "throw" }),
    enabled,
  });
}

export interface UpsertCompanyRootPayload {
  kind: string;
  displayName: string;
  driveId?: string | null;
  rootItemId?: string | null;
  rootPath: string;
  sortOrder?: number;
  active?: boolean;
}

export interface CompanyRootTestResult {
  ok: boolean;
  failureCategory?: "missing_token" | "401" | "403" | "404" | "malformed_config" | "graph_outage";
  message?: string;
  nextAction?: string;
  rootPath?: string | null;
  rootName?: string;
  driveReachable?: boolean;
  rootReachable?: boolean;
  childrenReachable?: boolean;
  childCount?: number;
  firstFiveChildren?: Array<{
    id: string;
    name: string;
    isFolder: boolean;
  }>;
}

export interface TestCompanyRootPayload {
  kind: string;
  driveId?: string | null;
  rootItemId?: string | null;
  rootPath?: string | null;
}

export function useUpsertCompanyRoot() {
  const qc = useQueryClient();
  return useMutation<{ row: CompanySharepointRoot }, Error, UpsertCompanyRootPayload>({
    mutationFn: async ({ kind, ...rest }) => {
      const res = await apiRequest(
        "PUT",
        `/api/admin/company-sharepoint-roots/${encodeURIComponent(kind)}`,
        rest,
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: COMPANY_ROOTS_KEY });
    },
  });
}

export function useTestCompanyRoot() {
  return useMutation<CompanyRootTestResult, Error, TestCompanyRootPayload>({
    mutationFn: async ({ kind, ...payload }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/company-sharepoint-roots/${encodeURIComponent(kind)}/test`,
        payload,
      );
      return res.json();
    },
  });
}

// =========================================================================
// SharePoint picker — browse sites -> libraries -> folders so admins can
// choose the Active Projects root without pasting a raw Graph drive id.
// =========================================================================

export interface SharepointSite {
  id: string;
  displayName: string;
  webUrl: string;
}

export function useSharepointSites(enabled = true) {
  return useQuery<{ sites: SharepointSite[] }>({
    queryKey: ["/api/admin/sharepoint/sites"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled,
    staleTime: 60_000,
  });
}

export interface SharepointDrive {
  id: string;
  name: string;
  webUrl?: string;
  driveType?: string;
}

export function useSharepointSiteDrives(siteId: string | null) {
  return useQuery<{ drives: SharepointDrive[] }>({
    queryKey: [`/api/admin/sharepoint/sites/${encodeURIComponent(siteId ?? "")}/drives`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: Boolean(siteId),
  });
}

export interface SharepointFolder {
  id: string;
  name: string;
  path?: string;
  webUrl?: string;
}

export function useSharepointDriveFolders(driveId: string | null, parentItemId: string | null) {
  const base = `/api/admin/sharepoint/drives/${encodeURIComponent(driveId ?? "")}/folders`;
  const url = parentItemId ? `${base}?parentItemId=${encodeURIComponent(parentItemId)}` : base;
  return useQuery<{ folders: SharepointFolder[] }>({
    queryKey: [url],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: Boolean(driveId),
  });
}
