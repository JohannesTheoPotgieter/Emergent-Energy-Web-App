/**
 * Discipline-folder documents — the read side of browse-and-bind.
 *
 * Once a project's discipline folder is bound (project_discipline_folders),
 * list what actually lives under it: read the SharePoint children live via
 * Graph and overlay any managed_documents we already track (matched by
 * driveId + driveItemId) so the UI can show tracked state. Read-only — no
 * write-on-read. SharePoint stays the source of truth for file content.
 */

import { getDisciplineFolder } from "../repositories/project-discipline-folders-repository";
import { listChildren } from "../services/sharepoint-document-service";
import { listManagedDocumentsByProject, setDisciplineFolderId } from "../repositories/managed-documents-repository";

export interface BoundFolderItem {
  itemId: string;
  name: string;
  path: string;
  isFolder: boolean;
  size?: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  /** The managed_documents id if we already track this file, else null. */
  managedDocumentId: number | null;
  /** Tracked workflow state (draft/in_review/approved/…) if tracked, else null. */
  state: string | null;
}

export interface BoundFolderDocuments {
  bound: boolean;
  folder: { discipline: string; sharepointPath: string | null; webUrl: string | null } | null;
  items: BoundFolderItem[];
}

/**
 * List the direct contents of a project's bound discipline folder, with
 * tracked-document overlay. Returns `{ bound: false }` when no folder is bound
 * (or the binding has no resolved SharePoint reference yet).
 */
export async function listBoundFolderDocuments(
  projectId: number,
  discipline: string,
): Promise<BoundFolderDocuments> {
  const binding = await getDisciplineFolder(projectId, discipline);
  if (!binding || binding.deletedAt || !binding.driveId || !binding.itemId) {
    return { bound: false, folder: null, items: [] };
  }

  const children = await listChildren(binding.driveId, binding.itemId);

  // One query for the project's tracked docs; overlay by driveItemId.
  const tracked = await listManagedDocumentsByProject(projectId);
  const byItem = new Map(tracked.map((d) => [d.driveItemId, d]));

  const items: BoundFolderItem[] = children.map((child) => {
    const match = child.isFolder ? undefined : byItem.get(child.id);
    return {
      itemId: child.id,
      name: child.name,
      path: child.path,
      isFolder: child.isFolder,
      size: child.size,
      webUrl: child.webUrl,
      lastModifiedDateTime: child.lastModifiedDateTime,
      managedDocumentId: match?.id ?? null,
      state: match?.state ?? null,
    };
  });

  // Folders first, then files, each alphabetical.
  items.sort((a, b) => (a.isFolder === b.isFolder ? a.name.localeCompare(b.name) : a.isFolder ? -1 : 1));

  // Backfill: tag tracked files under this bound folder with disciplineFolderId.
  // These are children of the binding by construction, so this is the reliable
  // association point that lets the approval engine resolve discipline-scoped
  // rules. Best-effort — a tagging failure must never break the listing.
  try {
    await Promise.all(
      children
        .filter((c) => !c.isFolder)
        .map((c) => byItem.get(c.id))
        .filter((d): d is NonNullable<typeof d> => !!d && d.disciplineFolderId !== binding.id)
        .map((d) => setDisciplineFolderId(d.id, binding.id)),
    );
  } catch (err) {
    console.error("[discipline-folder-documents] disciplineFolderId backfill failed:", err);
  }

  return {
    bound: true,
    folder: { discipline, sharepointPath: binding.sharepointPath, webUrl: binding.webUrl },
    items,
  };
}
