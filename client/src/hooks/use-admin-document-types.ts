import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import type { ControlledDocumentType } from "@shared/schema";

interface TypesResponse {
  types: ControlledDocumentType[];
}

export function useAllDocumentTypes(enabled = true) {
  return useQuery<TypesResponse>({
    queryKey: ["/api/admin/controlled-document-types"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled,
  });
}

export interface CreateDocumentTypePayload {
  typeKey: string;
  displayName: string;
  description?: string | null;
  folderSubPath: string;
  defaultApproverRoles: string[];
  requiresAllApprovers: boolean;
  extractSpec?: { sheetName?: string; cells?: Record<string, string> } | null;
  sortOrder?: number;
}

export function useCreateDocumentType() {
  const qc = useQueryClient();
  return useMutation<{ type: ControlledDocumentType }, Error, CreateDocumentTypePayload>({
    mutationFn: async (payload) => {
      const res = await apiRequest("POST", "/api/admin/controlled-document-types", payload);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/controlled-document-types"] });
      qc.invalidateQueries({ queryKey: ["/api/controlled-documents/types"] });
    },
  });
}

export type UpdateDocumentTypePayload = Partial<CreateDocumentTypePayload> & { active?: boolean };

export function useUpdateDocumentType() {
  const qc = useQueryClient();
  return useMutation<
    { type: ControlledDocumentType },
    Error,
    { typeKey: string; patch: UpdateDocumentTypePayload }
  >({
    mutationFn: async ({ typeKey, patch }) => {
      const res = await apiRequest("PATCH", `/api/admin/controlled-document-types/${typeKey}`, patch);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/controlled-document-types"] });
      qc.invalidateQueries({ queryKey: ["/api/controlled-documents/types"] });
    },
  });
}

export function useDeactivateDocumentType() {
  const qc = useQueryClient();
  return useMutation<{ type: ControlledDocumentType }, Error, { typeKey: string }>({
    mutationFn: async ({ typeKey }) => {
      const res = await apiRequest("DELETE", `/api/admin/controlled-document-types/${typeKey}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/controlled-document-types"] });
      qc.invalidateQueries({ queryKey: ["/api/controlled-documents/types"] });
    },
  });
}
