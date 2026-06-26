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
import { listChildren, getItem, type GraphItem } from "../services/sharepoint-document-service";
import {
  listManagedDocumentsByProject,
  setDisciplineFolderId,
  getManagedDocumentByDriveItem,
  upsertManagedDocumentFromGraph,
} from "../repositories/managed-documents-repository";
import { getLock } from "../repositories/document-locks-repository";
import { notFound } from "../lib/api-error";
import type { ManagedDocument, ProjectDisciplineFolder } from "@shared/schema/documents";

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

// ---------------------------------------------------------------------------
// Workspace browsing (drill-in + item detail)
//
// These power the full discipline document workspace. Unlike
// `listBoundFolderDocuments` (which returns the UI-overlay `BoundFolderItem`
// shape for the bound folder's direct children only), the workspace endpoints
// browse INTO subfolders and return the raw Graph `GraphItem` shape so the
// generic /documents browser components (FileListTable, DocumentDetailDrawer)
// work unchanged against a discipline target.
// ---------------------------------------------------------------------------

/** A bound discipline folder with a resolved, usable SharePoint reference. */
export interface ResolvedBoundFolder {
  binding: ProjectDisciplineFolder;
  driveId: string;
  rootItemId: string;
}

/**
 * Resolve the bound discipline folder for a project, asserting it points at a
 * usable SharePoint reference. Throws 404 when nothing is bound (or the
 * binding was soft-unbound / never resolved a drive item).
 */
export async function resolveBoundFolder(
  projectId: number,
  discipline: string,
): Promise<ResolvedBoundFolder> {
  const binding = await getDisciplineFolder(projectId, discipline);
  if (!binding || binding.deletedAt || !binding.driveId || !binding.itemId) {
    throw notFound("Discipline folder binding");
  }
  return { binding, driveId: binding.driveId, rootItemId: binding.itemId };
}

/**
 * List the children of `parentItemId` (defaulting to the bound folder root)
 * under a project's bound discipline folder. Returns raw Graph items so the
 * shape matches the generic company-scope `children` response.
 *
 * Side-effect: overlays/backfills the `disciplineFolderId` tag on any tracked
 * managed_documents that live directly under the bound folder root, mirroring
 * `listBoundFolderDocuments` so the approval engine can resolve discipline
 * rules. Best-effort — a tagging failure must never break the listing.
 */
export async function listBoundFolderChildren(
  resolved: ResolvedBoundFolder,
  parentItemId: string | null,
): Promise<GraphItem[]> {
  const effectiveParent = parentItemId && parentItemId.length > 0 ? parentItemId : resolved.rootItemId;
  const children = await listChildren(resolved.driveId, effectiveParent);

  // Backfill disciplineFolderId only for tracked files at the bound root,
  // mirroring listBoundFolderDocuments (the reliable association point).
  if (effectiveParent === resolved.rootItemId) {
    try {
      const tracked = await listManagedDocumentsByProject(resolved.binding.projectId);
      const byItem = new Map(tracked.map((d) => [d.driveItemId, d]));
      await Promise.all(
        children
          .filter((c) => !c.isFolder)
          .map((c) => byItem.get(c.id))
          .filter((d): d is NonNullable<typeof d> => !!d && d.disciplineFolderId !== resolved.binding.id)
          .map((d) => setDisciplineFolderId(d.id, resolved.binding.id)),
      );
    } catch (err) {
      console.error("[discipline-folder-documents] disciplineFolderId backfill failed:", err);
    }
  }

  return children;
}

export interface BoundFolderItemDetail {
  item: GraphItem;
  managedDocument: ManagedDocument | null;
  lock: { lockedByUserId: number; lockedAt: Date } | null;
}

/**
 * Fetch a single item under a project's bound discipline folder with its
 * tracked-document + lock overlay. Mirrors the company-scope item handler:
 * for a file we ensure a managed_documents tracking row exists (so revisions /
 * comments / checkout / request-approval can attach), tagging it with the
 * bound discipline folder id. Folders are returned untracked.
 */
export async function getBoundFolderItem(
  resolved: ResolvedBoundFolder,
  itemId: string,
  userId: number,
): Promise<BoundFolderItemDetail> {
  const item = await getItem(resolved.driveId, itemId);
  if (!item) throw notFound("Item");

  if (item.isFolder) {
    return { item, managedDocument: null, lock: null };
  }

  // Ensure a tracking row exists for this file (project scope), tagged with the
  // bound discipline folder so the approval engine resolves the discipline ACL.
  let tracked = await getManagedDocumentByDriveItem(resolved.driveId, itemId);
  if (!tracked) {
    tracked = await upsertManagedDocumentFromGraph({
      rootScope: "project",
      projectId: resolved.binding.projectId,
      companyRootId: null,
      driveId: resolved.driveId,
      driveItemId: item.id,
      name: item.name,
      path: item.path,
      createdByUserId: userId,
    });
  }
  if (tracked && tracked.disciplineFolderId !== resolved.binding.id) {
    try {
      await setDisciplineFolderId(tracked.id, resolved.binding.id);
      tracked = { ...tracked, disciplineFolderId: resolved.binding.id };
    } catch (err) {
      console.error("[discipline-folder-documents] disciplineFolderId tag-on-detail failed:", err);
    }
  }

  const lock = tracked ? await getLock(tracked.id) : null;
  return {
    item,
    managedDocument: tracked ?? null,
    lock: lock ? { lockedByUserId: lock.lockedByUserId, lockedAt: lock.lockedAt } : null,
  };
}
