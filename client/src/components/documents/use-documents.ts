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
} from "./types";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await apiRequest("GET", url);
  return res.json() as Promise<T>;
}

/**
 * A browse target identifies which live-file surface a /documents operation
 * runs against:
 *  - "company": a company-wide SharePoint root (company_sharepoint_roots),
 *    served by the /api/documents/company/:rootId/* endpoints.
 *  - "folder": a provisioned project folder (project_folders), served by the
 *    canonical /api/projects/:projectId/folders/:folderId/* endpoints.
 *
 * Project browsing is folder-keyed: there is no single "project root" — each
 * provisioned folder is its own browse anchor. This is the client cutover off
 * the deprecated project_sharepoint_roots table.
 */
export type BrowseTarget =
  | { kind: "company"; rootId: number }
  | { kind: "folder"; projectId: number; folderId: number };

function targetBase(t: BrowseTarget): string {
  return t.kind === "company"
    ? `/api/documents/company/${t.rootId}`
    : `/api/projects/${t.projectId}/folders/${t.folderId}`;
}

function targetKey(t: BrowseTarget): Array<string | number> {
  return t.kind === "company"
    ? ["documents", "company", t.rootId]
    : ["documents", "folder", t.projectId, t.folderId];
}

/** Authenticated download URL for an item under a browse target. */
export function documentDownloadUrl(target: BrowseTarget, itemId: string): string {
  return `${targetBase(target)}/item/${encodeURIComponent(itemId)}/download`;
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
  target: BrowseTarget | null,
  parentItemId: string | null,
) {
  return useQuery({
    queryKey: [
      ...(target ? targetKey(target) : ["documents", "idle"]),
      "children",
      parentItemId ?? "__root__",
    ],
    enabled: !!target,
    queryFn: () => {
      if (!target) throw new Error("browse target required");
      const qs = parentItemId ? `?parentItemId=${encodeURIComponent(parentItemId)}` : "";
      return fetchJson<{ items: GraphItem[] }>(`${targetBase(target)}/children${qs}`);
    },
  });
}

export function useDocumentDetail(
  target: BrowseTarget | null,
  itemId: string | null,
) {
  return useQuery({
    queryKey: [
      ...(target ? targetKey(target) : ["documents", "idle"]),
      "item",
      itemId,
    ],
    enabled: !!target && !!itemId,
    queryFn: () => {
      if (!target || !itemId) throw new Error("browse target and itemId required");
      return fetchJson<{
        item: GraphItem;
        managedDocument: ManagedDocument | null;
        lock: DocumentLock | null;
      }>(`${targetBase(target)}/item/${encodeURIComponent(itemId)}`);
    },
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
  target: BrowseTarget;
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
      const res = await fetch(`${targetBase(input.target)}/upload`, {
        method: "POST",
        body: form,
        credentials: "include",
        headers,
      });
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
      qc.invalidateQueries({ queryKey: [...targetKey(vars.target), "children"] });
    },
  });
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      target: BrowseTarget;
      parentItemId: string | null;
      name: string;
    }) => {
      // Company roots create subfolders via /folder; project folders via
      // /subfolder (the canonical folder-keyed verb).
      const suffix = input.target.kind === "company" ? "folder" : "subfolder";
      const res = await apiRequest("POST", `${targetBase(input.target)}/${suffix}`, {
        parentItemId: input.parentItemId,
        name: input.name,
      });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [...targetKey(vars.target), "children"] });
    },
  });
}

export function useRenameItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      target: BrowseTarget;
      itemId: string;
      name: string;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `${targetBase(input.target)}/item/${encodeURIComponent(input.itemId)}`,
        { name: input.name },
      );
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [...targetKey(vars.target), "children"] });
      qc.invalidateQueries({ queryKey: [...targetKey(vars.target), "item", vars.itemId] });
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
