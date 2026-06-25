/**
 * Shared app-level ACL anchoring for project-scope managed documents.
 *
 * The project-scope `assertDocumentAcl` checks in document-management.routes.ts
 * and document-comments.routes.ts strip a document down to the top-level folder
 * segment that `resolveFolderAcl` (document-folder-rbac.ts) keys off.
 *
 * PHASE 5 DECOMMISSION: the old anchoring chain (project_sharepoint_roots →
 * project_folders → folder_taxonomy, resolved via `parentFolderId`) was removed
 * with those tables. The anchor is now derived from the document's bound
 * discipline folder (`project_discipline_folders`, via `disciplineFolderId`),
 * falling back to the document path's first segment. Unknown anchors resolve to
 * READ_ONLY_FALLBACK in `resolveFolderAcl` — fail safe, never widens access.
 */

import { getDisciplineFolderById } from "../repositories/project-discipline-folders-repository";

/**
 * Maps a browse-and-bind discipline code (LIFECYCLE_DEPARTMENTS) to the
 * top-level DOCUMENT_FOLDER_ACL prefix (document-folder-rbac.ts) that governs
 * its documents.
 *
 * SECURITY NOTE (Phase 5): this mapping mirrors the intent of the retired
 * taxonomy-folder ACL — each discipline is placed on the existing folder ACL
 * whose write-set already included that discipline's manager role. Disciplines
 * with no clear home are intentionally omitted so they fall through to
 * READ_ONLY_FALLBACK (everyone reads, only super-users write). Confirm/adjust
 * the mapping with operations before relying on it for production writes.
 */
const DISCIPLINE_ACL_PREFIX: Record<string, string> = {
  ENGINEERING: "engineering",
  CONSTRUCTION: "engineering",
  QUALITY: "internal docs",
  HSE: "photos",
  FINANCE: "contracts",
  PROCUREMENT: "contracts",
  COMPLIANCE: "contracts",
  PD: "client docs",
  KAM: "client docs",
  PM: "internal docs",
  OM: "internal docs",
  EXCO: "internal docs",
};

function normalizePath(p: string | null | undefined): string {
  return (p ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
}

/**
 * Resolves the project-scope ACL anchor (a top-level folder prefix) for a
 * tracked managed document, keyed on its bound discipline folder.
 *
 * Resolution order:
 *   1. `disciplineFolderId` — the file is tagged with a bound discipline
 *      folder → map the binding's discipline to its ACL prefix.
 *   2. Fallback — the document path's first segment (mirrors the retired
 *      root-keyed behaviour; unknown segments fail safe to READ_ONLY_FALLBACK
 *      in `resolveFolderAcl`).
 */
export async function resolveProjectDocAnchor(doc: {
  projectId: number;
  disciplineFolderId: number | null;
  path: string;
}): Promise<string> {
  // 1. Browse-and-bind discipline linkage. Resolve by id (not the active-only
  //    list) so a soft-unbound folder still anchors the files that live in it.
  if (doc.disciplineFolderId != null) {
    const binding = await getDisciplineFolderById(doc.disciplineFolderId);
    if (binding?.discipline) {
      const prefix = DISCIPLINE_ACL_PREFIX[binding.discipline];
      if (prefix) return prefix;
    }
  }

  // 2. Fallback: the document path's first segment.
  return normalizePath(doc.path).split("/")[0] ?? "";
}
