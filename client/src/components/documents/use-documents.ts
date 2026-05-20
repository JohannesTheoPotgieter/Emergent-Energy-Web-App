/** Hooks for the /documents browser (TanStack Query). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { parseApiError } from "@/lib/api-error";
import type {
  CompanyRootSummary,
  DocumentComment,
  DocumentRevision,
  GraphItem,
  ManagedDocument,
  ProjectRootSummary,
  DocumentLock,
  DocumentRootScope,
} from "./types";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await apiRequest("GET", url);
  return res.json() as Promise<T>;
}

export function useDocumentRoots() {
  return useQuery({
    queryKey: ["documents", "roots"],
    queryFn: () =>
      fetchJson<{ company: CompanyRootSummary[]; project: ProjectRootSummary[] }>(
        "/api/documents/roots",
      ),
  });
}

export function useDocumentChildren(
  scope: DocumentRootScope | null,
  rootId: number | null,
  parentItemId: string | null,
) {
  return useQuery({
    queryKey: ["documents", scope, rootId, "children", parentItemId ?? "__root__"],
    enabled: !!scope && !!rootId,
    queryFn: () => {
      const qs = parentItemId ? `?parentItemId=${encodeURIComponent(parentItemId)}` : "";
      return fetchJson<{ items: GraphItem[] }>(
        `/api/documents/${scope}/${rootId}/children${qs}`,
      );
    },
  });
}

export function useDocumentDetail(
  scope: DocumentRootScope | null,
  rootId: number | null,
  itemId: string | null,
) {
  return useQuery({
    queryKey: ["documents", scope, rootId, "item", itemId],
    enabled: !!scope && !!rootId && !!itemId,
    queryFn: () =>
      fetchJson<{
        item: GraphItem;
        managedDocument: ManagedDocument | null;
        lock: DocumentLock | null;
      }>(`/api/documents/${scope}/${rootId}/item/${encodeURIComponent(itemId ?? "")}`),
  });
}

export function useDocumentRevisions(documentId: number | null) {
  return useQuery({
    queryKey: ["documents", "doc", documentId, "revisions"],
    enabled: !!documentId,
    queryFn: () =>
      fetchJson<{ revisions: DocumentRevision[] }>(
        `/api/documents/${documentId}/revisions`,
      ),
  });
}

export function useDocumentComments(documentId: number | null) {
  return useQuery({
    queryKey: ["documents", "doc", documentId, "comments"],
    enabled: !!documentId,
    queryFn: () =>
      fetchJson<{ comments: DocumentComment[] }>(
        `/api/documents/${documentId}/comments`,
      ),
  });
}

interface UploadInput {
  scope: DocumentRootScope;
  rootId: number;
  parentItemId: string | null;
  file: File;
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadInput) => {
      const form = new FormData();
      form.append("file", input.file);
      if (input.parentItemId) form.append("parentItemId", input.parentItemId);
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      // Double-submit CSRF token (mirror of apiRequest); multer uploads
      // bypass the JSON helper so we wire this in by hand.
      const csrfToken = document.cookie
        .split("; ")
        .find((c) => c.startsWith("csrf-token="))
        ?.split("=")[1];
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
      const res = await fetch(
        `/api/documents/${input.scope}/${input.rootId}/upload`,
        { method: "POST", body: form, credentials: "include", headers },
      );
      if (!res.ok) {
        let body: unknown = {};
        try {
          body = await res.json();
        } catch {
          body = { message: res.statusText };
        }
        throw parseApiError(res, body);
      }
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["documents", vars.scope, vars.rootId, "children"] });
    },
  });
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      scope: DocumentRootScope;
      rootId: number;
      parentItemId: string | null;
      name: string;
    }) => {
      const res = await apiRequest("POST", `/api/documents/${input.scope}/${input.rootId}/folder`, {
        parentItemId: input.parentItemId,
        name: input.name,
      });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["documents", vars.scope, vars.rootId, "children"] });
    },
  });
}

export function useRenameItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      scope: DocumentRootScope;
      rootId: number;
      itemId: string;
      name: string;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/documents/${input.scope}/${input.rootId}/item/${encodeURIComponent(input.itemId)}`,
        { name: input.name },
      );
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["documents", vars.scope, vars.rootId, "children"] });
      qc.invalidateQueries({ queryKey: ["documents", vars.scope, vars.rootId, "item", vars.itemId] });
    },
  });
}

export function useCheckout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: number) => {
      await apiRequest("POST", `/api/documents/${documentId}/checkout`);
    },
    onSuccess: (_d, documentId) => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["documents", "doc", documentId] });
    },
  });
}

export function useCheckin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { documentId: number; comment?: string }) => {
      const res = await apiRequest("POST", `/api/documents/${input.documentId}/checkin`, {
        comment: input.comment,
      });
      return res.json();
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["documents", "doc", vars.documentId] });
    },
  });
}

export function useDiscardCheckout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: number) => {
      await apiRequest("POST", `/api/documents/${documentId}/checkin/discard`);
    },
    onSuccess: (_d, documentId) => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["documents", "doc", documentId] });
    },
  });
}

export function useCreateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { documentId: number; body: string; revisionId?: number | null }) => {
      const res = await apiRequest("POST", `/api/documents/${input.documentId}/comments`, {
        body: input.body,
        revisionId: input.revisionId ?? null,
      });
      return res.json();
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["documents", "doc", vars.documentId, "comments"] });
    },
  });
}
