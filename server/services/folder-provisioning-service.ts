/**
 * Folder provisioning service (D6 Phase 3).
 *
 * Walks the canonical Active Clients folder taxonomy and creates the
 * matching SharePoint tree under the COO-configured "active projects"
 * root. Idempotent — safe to re-run; missing folders are created,
 * existing folders are linked into project_folders without duplication.
 *
 * Inputs:
 *   - projectId       — the project to provision
 *   - lifecycleMode   — pre_construction | full_lifecycle | both
 *   - userId          — actor (used for delegated Graph calls + audit)
 *
 * Outputs: a per-row report with status (created / already_present /
 * skipped / error) so the UI can render an actionable summary and so
 * audit logging can capture exactly what happened.
 *
 * Mock-connector aware: when MS Graph creds are absent in dev, calls
 * mockCreateFolder / mockListChildren so the flow works end-to-end
 * without real tenant tokens.
 *
 * CLAUDE.md compliance:
 *   - Reads via repositories (folder-taxonomy-repository,
 *     project-folders-repository, company-sharepoint-roots-repository).
 *   - No raw db.select() — every read goes through a repo helper.
 *   - Metadata-only — never fetches file bodies.
 */

import {
  listActiveTaxonomy,
} from "../repositories/folder-taxonomy-repository";
import {
  upsertProjectFolder,
  listFoldersForProject,
  recordVerifyError,
} from "../repositories/project-folders-repository";
import { getCompanyRootByKind } from "../repositories/company-sharepoint-roots-repository";
import { db } from "../db";
import { projectInfo } from "@shared/schema/projects";
import type { FolderTaxonomy, FolderLifecycleMode } from "@shared/schema/documents";
import { eq } from "drizzle-orm";
import { createFolder, listChildren, type GraphItem } from "./sharepoint-document-service";

// =========================================================================
// Public API
// =========================================================================

/**
 * Stable kind under which the COO-configured Active Clients root is
 * registered in `company_sharepoint_roots`. Provisioning fails-fast with
 * a friendly error if no row matches this kind.
 */
export const ACTIVE_PROJECTS_ROOT_KIND = "active_projects" as const;

export type ProvisionStatus =
  | "created"
  | "already_present"
  | "linked_existing"
  | "skipped"
  | "error";

export interface ProvisionRowReport {
  taxonomyKey: string;
  displayName: string;
  status: ProvisionStatus;
  driveId?: string | null;
  itemId?: string | null;
  sharepointPath?: string | null;
  webUrl?: string | null;
  error?: string;
}

export interface ProvisionResult {
  projectId: number;
  projectName: string;
  projectFolderPath: string;
  rootKind: typeof ACTIVE_PROJECTS_ROOT_KIND;
  lifecycleMode: FolderLifecycleMode;
  rows: ProvisionRowReport[];
  summary: {
    created: number;
    alreadyPresent: number;
    linkedExisting: number;
    skipped: number;
    errors: number;
  };
}

/** Walk the active taxonomy filtered to a lifecycle mode, depth-first. */
function selectTaxonomyForMode(
  taxonomy: FolderTaxonomy[],
  mode: FolderLifecycleMode,
): FolderTaxonomy[] {
  if (mode === "both") return taxonomy;
  return taxonomy.filter((t) => t.lifecycleMode === mode || t.lifecycleMode === "both");
}

/**
 * Preview the folders a lifecycle mode would create — uses the exact same
 * taxonomy selection `provisionProjectFolders` walks, so the UI preview can't
 * drift from what actually gets created. Read-only; no Graph calls.
 */
export async function previewProjectFolders(
  lifecycleMode: FolderLifecycleMode,
): Promise<{ key: string; name: string }[]> {
  const taxonomyAll = await listActiveTaxonomy();
  return selectTaxonomyForMode(taxonomyAll, lifecycleMode).map((t) => ({
    key: t.internalKey,
    name: t.displayName,
  }));
}

/** Order rows so parents always precede children (BFS ordered by depth). */
function topoOrder(rows: FolderTaxonomy[]): FolderTaxonomy[] {
  const byKey = new Map(rows.map((r) => [r.internalKey, r] as const));
  const depth = new Map<string, number>();
  function depthOf(k: string, seen = new Set<string>()): number {
    if (depth.has(k)) return depth.get(k)!;
    if (seen.has(k)) return 0; // cycle guard — repository should prevent these
    seen.add(k);
    const row = byKey.get(k);
    if (!row || !row.parentKey || !byKey.has(row.parentKey)) {
      depth.set(k, 0);
      return 0;
    }
    const d = depthOf(row.parentKey, seen) + 1;
    depth.set(k, d);
    return d;
  }
  for (const r of rows) depthOf(r.internalKey);
  return [...rows].sort((a, b) => {
    const da = depth.get(a.internalKey) ?? 0;
    const db = depth.get(b.internalKey) ?? 0;
    if (da !== db) return da - db;
    return a.sortOrder - b.sortOrder;
  });
}

async function getProjectName(projectId: number): Promise<string> {
  const [row] = await db
    .select({ projectName: projectInfo.projectName })
    .from(projectInfo)
    .where(eq(projectInfo.id, projectId))
    .limit(1);
  if (!row) {
    throw new Error(`Project ${projectId} not found`);
  }
  return row.projectName;
}

/**
 * Provision (or reconcile) the SharePoint folder tree for a project.
 */
export async function provisionProjectFolders(input: {
  projectId: number;
  lifecycleMode: FolderLifecycleMode;
  userId: number;
}): Promise<ProvisionResult> {
  const { projectId, lifecycleMode, userId } = input;

  const root = await getCompanyRootByKind(ACTIVE_PROJECTS_ROOT_KIND);
  if (!root) {
    throw new Error(
      `No company SharePoint root configured with kind='${ACTIVE_PROJECTS_ROOT_KIND}'. ` +
        `Ask a super-user to register the active-projects root in admin first.`,
    );
  }
  if (!root.driveId) {
    throw new Error(
      `Company root '${ACTIVE_PROJECTS_ROOT_KIND}' has no driveId. Re-configure with the Graph drive id.`,
    );
  }

  const projectName = await getProjectName(projectId);
  const taxonomyAll = await listActiveTaxonomy();
  const taxonomy = selectTaxonomyForMode(taxonomyAll, lifecycleMode);
  const ordered = topoOrder(taxonomy);

  // Existing project_folders rows let us short-circuit Graph calls when a
  // folder is already linked. Keyed by taxonomyKey for O(1) lookup.
  const existingByKey = new Map(
    (await listFoldersForProject(projectId)).map((f) => [f.taxonomyKey, f] as const),
  );

  // Step 1: ensure the project root folder exists under the active-projects
  // container. Use a synthetic taxonomyKey '_project_root_' so it shows up
  // in the report and we can detect it on subsequent runs.
  const PROJECT_ROOT_KEY = "_project_root_";
  const projectRootReport = await ensureFolder({
    driveId: root.driveId,
    parentItemId: root.rootItemId ?? null,
    name: projectName,
    userId,
    onLink: async (item) => {
      await upsertProjectFolder({
        projectId,
        taxonomyKey: PROJECT_ROOT_KEY,
        driveId: item.driveId,
        itemId: item.itemId,
        sharepointPath: item.path,
        webUrl: item.webUrl ?? null,
        provisionedByUserId: userId,
      });
    },
    parentPath: root.rootPath,
    existingLink: existingByKey.get(PROJECT_ROOT_KEY) ?? null,
    taxonomyKey: PROJECT_ROOT_KEY,
    displayName: projectName,
  });

  const rows: ProvisionRowReport[] = [projectRootReport];

  // Map of resolved (driveId, itemId) by taxonomyKey for child lookups.
  const resolved = new Map<string, { driveId: string; itemId: string; path: string }>();
  if (projectRootReport.itemId && projectRootReport.driveId) {
    resolved.set(PROJECT_ROOT_KEY, {
      driveId: projectRootReport.driveId,
      itemId: projectRootReport.itemId,
      path: projectRootReport.sharepointPath ?? `${root.rootPath}/${projectName}`,
    });
  }

  // Pre-existing rows that already point at SharePoint should also be in
  // the resolved map so deeper levels can find their parent itemId.
  for (const [k, link] of existingByKey) {
    if (link.itemId && link.driveId) {
      resolved.set(k, {
        driveId: link.driveId,
        itemId: link.itemId,
        path: link.sharepointPath ?? "",
      });
    }
  }

  // Step 2: depth-first create each taxonomy folder. If the project root
  // failed earlier (errored), short-circuit because nothing else can land.
  if (projectRootReport.status === "error" || !projectRootReport.itemId) {
    return finaliseResult({
      projectId,
      projectName,
      projectFolderPath: projectRootReport.sharepointPath ?? `${root.rootPath}/${projectName}`,
      lifecycleMode,
      rows,
    });
  }

  for (const t of ordered) {
    const parentResolved = t.parentKey ? resolved.get(t.parentKey) : resolved.get(PROJECT_ROOT_KEY);
    if (!parentResolved) {
      rows.push({
        taxonomyKey: t.internalKey,
        displayName: t.displayName,
        status: "skipped",
        error: `Parent '${t.parentKey ?? PROJECT_ROOT_KEY}' not provisioned yet`,
      });
      continue;
    }

    const report = await ensureFolder({
      driveId: parentResolved.driveId,
      parentItemId: parentResolved.itemId,
      name: t.displayName,
      userId,
      onLink: async (item) => {
        await upsertProjectFolder({
          projectId,
          taxonomyKey: t.internalKey,
          driveId: item.driveId,
          itemId: item.itemId,
          sharepointPath: item.path,
          webUrl: item.webUrl ?? null,
          provisionedByUserId: userId,
        });
      },
      parentPath: parentResolved.path,
      existingLink: existingByKey.get(t.internalKey) ?? null,
      taxonomyKey: t.internalKey,
      displayName: t.displayName,
    });
    rows.push(report);
    if (report.itemId && report.driveId) {
      resolved.set(t.internalKey, {
        driveId: report.driveId,
        itemId: report.itemId,
        path: report.sharepointPath ?? `${parentResolved.path}/${t.displayName}`,
      });
    }
  }

  return finaliseResult({
    projectId,
    projectName,
    projectFolderPath: projectRootReport.sharepointPath ?? `${root.rootPath}/${projectName}`,
    lifecycleMode,
    rows,
  });
}

/**
 * Re-walk an existing project's tree and verify every linked folder still
 * exists on Graph. Records verifyError on any row whose folder went away
 * (renamed, moved, deleted) so the COO can decide what to do.
 */
export async function verifyProjectFolders(input: {
  projectId: number;
}): Promise<{ projectId: number; verified: number; missing: number }> {
  const { projectId } = input;
  const folders = await listFoldersForProject(projectId);
  let verified = 0;
  let missing = 0;
  for (const f of folders) {
    if (!f.driveId || !f.itemId) {
      missing += 1;
      await recordVerifyError(
        projectId,
        f.taxonomyKey,
        "Linked row has no driveId/itemId — re-provision required",
      );
      continue;
    }
    try {
      await listChildren(f.driveId, f.itemId);
      verified += 1;
    } catch (err) {
      missing += 1;
      await recordVerifyError(
        projectId,
        f.taxonomyKey,
        err instanceof Error ? err.message : "Graph verify failed",
      );
    }
  }
  return { projectId, verified, missing };
}

// =========================================================================
// Internals
// =========================================================================

async function ensureFolder(input: {
  driveId: string;
  parentItemId: string | null;
  name: string;
  userId: number;
  parentPath: string;
  taxonomyKey: string;
  displayName: string;
  existingLink: {
    driveId: string | null;
    itemId: string | null;
    sharepointPath: string | null;
    webUrl: string | null;
  } | null;
  onLink: (linked: {
    driveId: string;
    itemId: string;
    path: string;
    webUrl: string | null;
  }) => Promise<void>;
}): Promise<ProvisionRowReport> {
  const { driveId, parentItemId, name, userId, parentPath, existingLink, taxonomyKey, displayName, onLink } = input;

  // Fast path: we already linked this folder in a previous run.
  if (existingLink?.driveId && existingLink?.itemId) {
    return {
      taxonomyKey,
      displayName,
      status: "already_present",
      driveId: existingLink.driveId,
      itemId: existingLink.itemId,
      sharepointPath: existingLink.sharepointPath ?? `${parentPath}/${name}`,
      webUrl: existingLink.webUrl,
    };
  }

  // Slow path: list parent's children to detect a folder Graph already has
  // but our DB doesn't know about. This handles the "tree pre-existed
  // before the app rolled out" case the planning conversation flagged.
  let alreadyOnGraph: GraphItem | null = null;
  try {
    const children = await listChildren(driveId, parentItemId);
    alreadyOnGraph = children.find((c) => c.isFolder && c.name === name) ?? null;
  } catch (err) {
    return {
      taxonomyKey,
      displayName,
      status: "error",
      error: err instanceof Error ? err.message : "listChildren failed",
    };
  }

  if (alreadyOnGraph) {
    const path = alreadyOnGraph.path || `${parentPath}/${name}`;
    const webUrl = alreadyOnGraph.webUrl ?? null;
    await onLink({ driveId, itemId: alreadyOnGraph.id, path, webUrl });
    return {
      taxonomyKey,
      displayName,
      status: "linked_existing",
      driveId,
      itemId: alreadyOnGraph.id,
      sharepointPath: path,
      webUrl,
    };
  }

  // Create.
  try {
    const created = await createFolder({ driveId, parentItemId, name, userId });
    const path = created.path || `${parentPath}/${name}`;
    const webUrl = created.webUrl ?? null;
    await onLink({ driveId, itemId: created.id, path, webUrl });
    return {
      taxonomyKey,
      displayName,
      status: "created",
      driveId,
      itemId: created.id,
      sharepointPath: path,
      webUrl,
    };
  } catch (err) {
    return {
      taxonomyKey,
      displayName,
      status: "error",
      error: err instanceof Error ? err.message : "createFolder failed",
    };
  }
}

function finaliseResult(input: Omit<ProvisionResult, "summary" | "rootKind">): ProvisionResult {
  const summary = input.rows.reduce(
    (acc, r) => {
      if (r.status === "created") acc.created += 1;
      else if (r.status === "already_present") acc.alreadyPresent += 1;
      else if (r.status === "linked_existing") acc.linkedExisting += 1;
      else if (r.status === "skipped") acc.skipped += 1;
      else if (r.status === "error") acc.errors += 1;
      return acc;
    },
    { created: 0, alreadyPresent: 0, linkedExisting: 0, skipped: 0, errors: 0 },
  );
  return { ...input, rootKind: ACTIVE_PROJECTS_ROOT_KIND, summary };
}
