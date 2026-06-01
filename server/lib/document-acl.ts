/**
 * Shared app-level ACL anchoring for project-scope managed documents.
 *
 * Stage 3 of the project_sharepoint_roots → project_folders migration: the
 * project-scope `assertDocumentAcl` checks in document-management.routes.ts and
 * document-comments.routes.ts used to resolve a project's SharePoint root (the
 * deprecated project_sharepoint_roots table) purely to strip the root drive
 * path off a document's path and isolate the top-level folder segment that
 * `resolveFolderAcl` keys off. This module re-derives that anchor from the
 * canonical project_folders surface instead, so the deprecated repository can
 * be deleted.
 *
 * NOTE: server/routes/document-files.routes.ts (Stage 1) carries a parallel
 * inline `folderAclAnchor` for its folder-keyed endpoints. The canonical
 * implementation lives here; that one can adopt this in a later cleanup.
 */

import type { ProjectFolder } from "@shared/schema/documents";
import { listFoldersForProject } from "../repositories/project-folders-repository";
import { getTaxonomyByKey } from "../repositories/folder-taxonomy-repository";

/**
 * The ACL anchor for a provisioned folder = its TOP-LEVEL taxonomy display
 * name (e.g. "Engineering", "Contracts"). `resolveFolderAcl` matches on the
 * first path segment, so the whole subtree under a top-level folder shares a
 * single ACL — mirroring how the retired root-keyed browser behaved.
 */
export async function folderAclAnchor(folder: ProjectFolder): Promise<string> {
  let entry = await getTaxonomyByKey(folder.taxonomyKey);
  // Walk up to the top-level taxonomy folder (guard against cycles).
  let guard = 0;
  while (entry?.parentKey && guard < 16) {
    entry = await getTaxonomyByKey(entry.parentKey);
    guard += 1;
  }
  return entry?.displayName ?? folder.taxonomyKey.split("/")[0];
}

function normalizePath(p: string | null | undefined): string {
  return (p ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
}

/**
 * Resolves the project-scope ACL anchor (a top-level folder display name) for a
 * tracked managed document, keyed on project_folders — no dependency on the
 * deprecated project_sharepoint_roots table.
 *
 * Resolution order:
 *   1. `parentFolderId` — the canonical taxonomy linkage set when the file
 *      lives inside a provisioned folder → that folder's top-level anchor.
 *   2. Fallback — the longest provisioned-folder `sharepointPath` that is a
 *      prefix of the document path (covers untracked manual subfolders sitting
 *      under a known top-level folder).
 *   3. No match → "" → `resolveFolderAcl` returns READ_ONLY_FALLBACK (everyone
 *      reads, only super-users write): fail safe, never widens access.
 */
export async function resolveProjectDocAnchor(doc: {
  projectId: number;
  parentFolderId: number | null;
  path: string;
}): Promise<string> {
  const folders = await listFoldersForProject(doc.projectId);

  // 1. Canonical taxonomy linkage.
  if (doc.parentFolderId != null) {
    const folder = folders.find((f) => f.id === doc.parentFolderId);
    if (folder) return folderAclAnchor(folder);
  }

  // 2. Longest provisioned-folder path that prefixes the document path.
  const docPath = normalizePath(doc.path);
  let best: ProjectFolder | null = null;
  let bestLen = -1;
  for (const folder of folders) {
    const base = normalizePath(folder.sharepointPath);
    if (!base) continue;
    if (docPath === base || docPath.startsWith(`${base}/`)) {
      if (base.length > bestLen) {
        best = folder;
        bestLen = base.length;
      }
    }
  }
  if (best) return folderAclAnchor(best);

  // 3. Fallback: the document path's first segment. Mirrors the retired
  //    root-keyed behaviour — in mock/dev the project root item sits at "", so
  //    the first path segment was the ACL anchor, keeping e.g. a "Contracts"
  //    doc on the restricted contracts ACL even with no provisioned folder.
  //    Real-taxonomy production paths (e.g. "Projects/.../03_Engineering/…")
  //    fall through to READ_ONLY_FALLBACK in resolveFolderAcl exactly as before.
  return docPath.split("/")[0] ?? "";
}
