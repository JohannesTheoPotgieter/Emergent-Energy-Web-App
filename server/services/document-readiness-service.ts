/**
 * Document readiness service (D6 Phase 6).
 *
 * The soft-enforcement layer for D6. Computes how complete a project's
 * document set is — per discipline, per stage, and overall — without
 * blocking any workflow. The numbers feed:
 *   - <ProjectReadinessCard> on /projects/:id/documents
 *   - <PortfolioReadinessTile> on the home dashboards
 *   - Future stage-gate exception logic when (if) the user wants to
 *     hard-gate certain transitions
 *
 * Data flow:
 *   folder_taxonomy   →  every active row defines a "required folder"
 *   project_folders   →  is the SharePoint folder provisioned?
 *   document_approval_requirements
 *                     →  every active requirement is a "required doc"
 *   managed_documents →  does an approved file satisfy a requirement?
 *
 * v1 uses two coarse signals: folder-presence (provisioned with itemId)
 * and approved-doc-presence (any managed_document in state='approved'
 * inside the requirement's folder). file_name_pattern + stage-aware
 * filtering are deferred to a follow-up.
 *
 * Repository-only data access; no raw db.select on these tables outside
 * the helper queries below.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  folderTaxonomy,
  projectFolders,
  documentApprovalRequirements,
  managedDocuments,
  type FolderTaxonomy,
  type ProjectFolder,
  type DocumentApprovalRequirement,
  type ManagedDocument,
} from "@shared/schema/documents";
import { projectInfo, projectExecutionState } from "@shared/schema/projects";
import { SEQUENTIAL_STAGE_CODES } from "@shared/schema/stage-lifecycle";

// =========================================================================
// Public types
// =========================================================================

export interface DisciplineReadiness {
  discipline: string;
  foldersTotal: number;
  foldersProvisioned: number;
  requirementsTotal: number;
  requirementsApproved: number;
  /** 0–100 — equally weights folder provisioning and required-doc approval. */
  percentReady: number;
}

export interface RequirementReadiness {
  requirementId: number;
  taxonomyKey: string;
  displayName: string;
  status: "approved" | "in_review" | "missing" | "folder_missing";
  approvedDocumentId: number | null;
}

export interface ProjectReadiness {
  projectId: number;
  projectName: string;
  foldersTotal: number;
  foldersProvisioned: number;
  requirementsTotal: number;
  requirementsApproved: number;
  /** 0–100 — overall percent across folder + requirement signals. */
  percentReady: number;
  perDiscipline: DisciplineReadiness[];
  requirements: RequirementReadiness[];
}

export interface PortfolioReadinessRow {
  projectId: number;
  projectName: string;
  foldersTotal: number;
  foldersProvisioned: number;
  requirementsTotal: number;
  requirementsApproved: number;
  percentReady: number;
  /** True when at least one requirement maps to a folder that hasn't been provisioned yet. */
  hasFolderGap: boolean;
}

// =========================================================================
// Internal helpers
// =========================================================================

async function loadActiveTaxonomy(): Promise<FolderTaxonomy[]> {
  return db.select().from(folderTaxonomy).where(eq(folderTaxonomy.active, true));
}

async function loadActiveRequirements(): Promise<DocumentApprovalRequirement[]> {
  return db
    .select()
    .from(documentApprovalRequirements)
    .where(eq(documentApprovalRequirements.active, true));
}

async function loadProjectFolders(projectId: number): Promise<ProjectFolder[]> {
  return db.select().from(projectFolders).where(eq(projectFolders.projectId, projectId));
}

async function loadProjectFoldersForMany(projectIds: number[]): Promise<ProjectFolder[]> {
  if (projectIds.length === 0) return [];
  return db.select().from(projectFolders).where(inArray(projectFolders.projectId, projectIds));
}

async function loadProjectDocuments(projectId: number): Promise<ManagedDocument[]> {
  return db
    .select()
    .from(managedDocuments)
    .where(
      and(
        eq(managedDocuments.projectId, projectId),
        isNull(managedDocuments.deletedAt),
      ),
    );
}

async function loadProjectDocumentsForMany(projectIds: number[]): Promise<ManagedDocument[]> {
  if (projectIds.length === 0) return [];
  return db
    .select()
    .from(managedDocuments)
    .where(
      and(
        inArray(managedDocuments.projectId, projectIds),
        isNull(managedDocuments.deletedAt),
      ),
    );
}

/** Compile a regex from the requirement, ignoring invalid patterns. */
function compileFilenameMatcher(pattern: string | null | undefined): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

function classifyRequirement(
  req: DocumentApprovalRequirement,
  taxonomyByKey: Map<string, FolderTaxonomy>,
  folderByTaxonomyKey: Map<string, ProjectFolder>,
  documentsByFolderId: Map<number, ManagedDocument[]>,
): RequirementReadiness {
  const taxonomy = taxonomyByKey.get(req.taxonomyKey);
  const folder = folderByTaxonomyKey.get(req.taxonomyKey);

  if (!taxonomy) {
    return {
      requirementId: req.id,
      taxonomyKey: req.taxonomyKey,
      displayName: req.displayName,
      status: "folder_missing",
      approvedDocumentId: null,
    };
  }

  if (!folder?.itemId) {
    return {
      requirementId: req.id,
      taxonomyKey: req.taxonomyKey,
      displayName: req.displayName,
      status: "folder_missing",
      approvedDocumentId: null,
    };
  }

  // file_name_pattern narrows which docs in the folder satisfy this
  // requirement. When the pattern is missing or invalid, fall back to
  // matching every doc in the folder (the v1 behaviour).
  const matcher = compileFilenameMatcher(req.fileNamePattern);
  const docs = (documentsByFolderId.get(folder.id) ?? []).filter((d) =>
    matcher ? matcher.test(d.name) : true,
  );
  const approved = docs.find((d) => d.state === "approved");
  if (approved) {
    return {
      requirementId: req.id,
      taxonomyKey: req.taxonomyKey,
      displayName: req.displayName,
      status: "approved",
      approvedDocumentId: approved.id,
    };
  }
  const inReview = docs.find((d) => d.state === "in_review");
  if (inReview) {
    return {
      requirementId: req.id,
      taxonomyKey: req.taxonomyKey,
      displayName: req.displayName,
      status: "in_review",
      approvedDocumentId: null,
    };
  }
  return {
    requirementId: req.id,
    taxonomyKey: req.taxonomyKey,
    displayName: req.displayName,
    status: "missing",
    approvedDocumentId: null,
  };
}

/**
 * Stage-aware filter: only include requirements whose folder's stage_code
 * is at or before the project's current stage. Cross-stage folders
 * (stage_code === null) always count.
 *
 * If the project has no current stage code, all requirements are in
 * scope — we don't pretend to know the schedule.
 */
function filterRequirementsByStage(
  requirements: DocumentApprovalRequirement[],
  taxonomyByKey: Map<string, FolderTaxonomy>,
  currentStageCode: string | null,
): DocumentApprovalRequirement[] {
  if (!currentStageCode) return requirements;
  const orderIdx = (s: string | null | undefined) =>
    s == null ? -1 : SEQUENTIAL_STAGE_CODES.indexOf(s as (typeof SEQUENTIAL_STAGE_CODES)[number]);
  const currentIdx = orderIdx(currentStageCode);
  if (currentIdx < 0) return requirements;
  return requirements.filter((r) => {
    const t = taxonomyByKey.get(r.taxonomyKey);
    if (!t || !t.stageCode) return true; // cross-stage / pre-construction always in scope
    const reqIdx = orderIdx(t.stageCode);
    return reqIdx <= currentIdx;
  });
}

function indexDocumentsByFolder(docs: ManagedDocument[]): Map<number, ManagedDocument[]> {
  const out = new Map<number, ManagedDocument[]>();
  for (const d of docs) {
    if (d.parentFolderId == null) continue;
    const list = out.get(d.parentFolderId);
    if (list) list.push(d);
    else out.set(d.parentFolderId, [d]);
  }
  return out;
}

function indexFoldersByTaxonomyKey(folders: ProjectFolder[]): Map<string, ProjectFolder> {
  const out = new Map<string, ProjectFolder>();
  for (const f of folders) {
    out.set(f.taxonomyKey, f);
  }
  return out;
}

function buildDisciplineReadiness(
  taxonomy: FolderTaxonomy[],
  requirements: DocumentApprovalRequirement[],
  folderByTaxonomyKey: Map<string, ProjectFolder>,
  documentsByFolderId: Map<number, ManagedDocument[]>,
): DisciplineReadiness[] {
  const byDiscipline = new Map<
    string,
    {
      foldersTotal: number;
      foldersProvisioned: number;
      requirementsTotal: number;
      requirementsApproved: number;
    }
  >();

  function ensure(d: string) {
    let stat = byDiscipline.get(d);
    if (!stat) {
      stat = {
        foldersTotal: 0,
        foldersProvisioned: 0,
        requirementsTotal: 0,
        requirementsApproved: 0,
      };
      byDiscipline.set(d, stat);
    }
    return stat;
  }

  // Folder counts.
  for (const t of taxonomy) {
    const ds = (t.disciplines ?? []) as string[];
    if (ds.length === 0) continue; // shared/all — counted at the project level only
    const folder = folderByTaxonomyKey.get(t.internalKey);
    const provisioned = Boolean(folder?.itemId);
    for (const d of ds) {
      const stat = ensure(d);
      stat.foldersTotal += 1;
      if (provisioned) stat.foldersProvisioned += 1;
    }
  }

  // Requirement counts.
  const taxByKey = new Map(taxonomy.map((t) => [t.internalKey, t] as const));
  for (const r of requirements) {
    const t = taxByKey.get(r.taxonomyKey);
    if (!t) continue;
    const ds = (t.disciplines ?? []) as string[];
    const folder = folderByTaxonomyKey.get(t.internalKey);
    const docs = folder ? (documentsByFolderId.get(folder.id) ?? []) : [];
    const approved = docs.some((d) => d.state === "approved");
    for (const d of ds) {
      const stat = ensure(d);
      stat.requirementsTotal += 1;
      if (approved) stat.requirementsApproved += 1;
    }
  }

  const out: DisciplineReadiness[] = [];
  for (const [discipline, s] of byDiscipline.entries()) {
    out.push({
      discipline,
      foldersTotal: s.foldersTotal,
      foldersProvisioned: s.foldersProvisioned,
      requirementsTotal: s.requirementsTotal,
      requirementsApproved: s.requirementsApproved,
      percentReady: percent(s),
    });
  }
  out.sort((a, b) => a.discipline.localeCompare(b.discipline));
  return out;
}

function percent(s: {
  foldersTotal: number;
  foldersProvisioned: number;
  requirementsTotal: number;
  requirementsApproved: number;
}): number {
  // Two halves, each weighted equally. If a half has no items, it
  // contributes 100% (nothing to do, fully ready on that axis).
  const folderRatio = s.foldersTotal === 0 ? 1 : s.foldersProvisioned / s.foldersTotal;
  const reqRatio =
    s.requirementsTotal === 0 ? 1 : s.requirementsApproved / s.requirementsTotal;
  const ratio = (folderRatio + reqRatio) / 2;
  return Math.round(ratio * 100);
}

// =========================================================================
// Public API
// =========================================================================

export async function computeProjectReadiness(projectId: number): Promise<ProjectReadiness> {
  const [proj] = await db
    .select({
      projectName: projectInfo.projectName,
      currentStageCode: projectExecutionState.currentStageCode,
    })
    .from(projectInfo)
    .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
    .where(eq(projectInfo.id, projectId))
    .limit(1);
  if (!proj) throw new Error(`Project ${projectId} not found`);

  const [taxonomy, allRequirements, folders, documents] = await Promise.all([
    loadActiveTaxonomy(),
    loadActiveRequirements(),
    loadProjectFolders(projectId),
    loadProjectDocuments(projectId),
  ]);

  const taxonomyByKey = new Map(taxonomy.map((t) => [t.internalKey, t] as const));
  const folderByTaxonomyKey = indexFoldersByTaxonomyKey(folders);
  const documentsByFolderId = indexDocumentsByFolder(documents);

  // Stage-aware: drop requirements whose owning folder's stage_code is
  // ahead of the project's current stage so the readiness number reflects
  // what's actually due now.
  const requirements = filterRequirementsByStage(
    allRequirements,
    taxonomyByKey,
    proj.currentStageCode ?? null,
  );

  const requirementRows = requirements.map((r) =>
    classifyRequirement(r, taxonomyByKey, folderByTaxonomyKey, documentsByFolderId),
  );
  requirementRows.sort((a, b) => a.taxonomyKey.localeCompare(b.taxonomyKey));

  const foldersTotal = taxonomy.length;
  const foldersProvisioned = taxonomy.filter((t) => {
    const f = folderByTaxonomyKey.get(t.internalKey);
    return Boolean(f?.itemId);
  }).length;
  const requirementsTotal = requirementRows.length;
  const requirementsApproved = requirementRows.filter((r) => r.status === "approved").length;

  const overall = percent({
    foldersTotal,
    foldersProvisioned,
    requirementsTotal,
    requirementsApproved,
  });

  const perDiscipline = buildDisciplineReadiness(
    taxonomy,
    requirements,
    folderByTaxonomyKey,
    documentsByFolderId,
  );

  return {
    projectId,
    projectName: proj.projectName,
    foldersTotal,
    foldersProvisioned,
    requirementsTotal,
    requirementsApproved,
    percentReady: overall,
    perDiscipline,
    requirements: requirementRows,
  };
}

export async function computePortfolioReadiness(): Promise<PortfolioReadinessRow[]> {
  // One-shot batch: fetch every active project, all taxonomy / requirements
  // once, and all folders + documents in a single query. The math is then
  // done in memory, so the portfolio tile costs O(projects + folders + docs)
  // queries, not O(projects).
  const projects: Array<{
    id: number;
    projectName: string;
    currentStageCode: string | null;
  }> = await db
    .select({
      id: projectInfo.id,
      projectName: projectInfo.projectName,
      currentStageCode: projectExecutionState.currentStageCode,
    })
    .from(projectInfo)
    .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id));

  if (projects.length === 0) return [];

  const ids = projects.map((p) => p.id);

  const [taxonomy, requirements, folders, documents] = await Promise.all([
    loadActiveTaxonomy(),
    loadActiveRequirements(),
    loadProjectFoldersForMany(ids),
    loadProjectDocumentsForMany(ids),
  ]);

  // Per-project lookups.
  const foldersByProject = new Map<number, ProjectFolder[]>();
  for (const f of folders) {
    const list = foldersByProject.get(f.projectId);
    if (list) list.push(f);
    else foldersByProject.set(f.projectId, [f]);
  }
  const documentsByProject = new Map<number, ManagedDocument[]>();
  for (const d of documents) {
    if (d.projectId == null) continue;
    const list = documentsByProject.get(d.projectId);
    if (list) list.push(d);
    else documentsByProject.set(d.projectId, [d]);
  }

  const taxonomyByKey = new Map(taxonomy.map((t) => [t.internalKey, t] as const));
  const foldersTotal = taxonomy.length;

  const out: PortfolioReadinessRow[] = [];
  for (const p of projects) {
    const projFolders = foldersByProject.get(p.id) ?? [];
    const projDocs = documentsByProject.get(p.id) ?? [];
    const folderByTaxonomyKey = indexFoldersByTaxonomyKey(projFolders);
    const documentsByFolderId = indexDocumentsByFolder(projDocs);

    const foldersProvisioned = taxonomy.filter((t) => {
      const f = folderByTaxonomyKey.get(t.internalKey);
      return Boolean(f?.itemId);
    }).length;

    const inScope = filterRequirementsByStage(
      requirements,
      taxonomyByKey,
      p.currentStageCode,
    );
    const reqClass = inScope.map((r) =>
      classifyRequirement(r, taxonomyByKey, folderByTaxonomyKey, documentsByFolderId),
    );
    const requirementsTotal = reqClass.length;
    const requirementsApproved = reqClass.filter((r) => r.status === "approved").length;
    const hasFolderGap = reqClass.some((r) => r.status === "folder_missing");

    out.push({
      projectId: p.id,
      projectName: p.projectName,
      foldersTotal,
      foldersProvisioned,
      requirementsTotal,
      requirementsApproved,
      percentReady: percent({
        foldersTotal,
        foldersProvisioned,
        requirementsTotal,
        requirementsApproved,
      }),
      hasFolderGap,
    });
  }

  // Lowest-readiness first so the tile surfaces at-risk projects.
  out.sort((a, b) => a.percentReady - b.percentReady);
  return out;
}
