/**
 * Document readiness service (D6 Phase 6 — rebased onto browse-and-bind).
 *
 * The soft-enforcement layer for D6. Computes how complete a project's
 * document set is — per discipline and overall — without blocking any
 * workflow. The numbers feed:
 *   - <ProjectReadinessCard> on /projects/:id/documents
 *   - <PortfolioReadinessTile> on the home dashboards
 *
 * PHASE 5 DECOMMISSION: the legacy taxonomy basis (folder_taxonomy +
 * project_folders + parent_folder_id) was removed. Readiness is now computed
 * on the browse-and-bind basis:
 *   document_approval_requirements (discipline != null)
 *                       →  every active discipline requirement is a "required doc"
 *   project_discipline_folders
 *                       →  is the discipline's folder bound? ("provisioned")
 *   managed_documents (discipline_folder_id)
 *                       →  does an approved file under the bound folder satisfy it?
 *
 * The "folders" axis now counts disciplines that HAVE a requirement (the
 * disciplines that need a bound folder) vs. those that are actually bound.
 *
 * Repository-style data access; the helper queries below are the only place
 * these tables are read inside this service.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  projectDisciplineFolders,
  documentApprovalRequirements,
  managedDocuments,
  type ProjectDisciplineFolder,
  type DocumentApprovalRequirement,
  type ManagedDocument,
} from "@shared/schema/documents";
import { projectInfo } from "@shared/schema/projects";

// =========================================================================
// Public types (JSON shape kept in lockstep with use-document-readiness.ts)
// =========================================================================

export interface DisciplineReadiness {
  discipline: string;
  foldersTotal: number;
  foldersProvisioned: number;
  requirementsTotal: number;
  requirementsApproved: number;
  /** 0–100 — equally weights folder binding and required-doc approval. */
  percentReady: number;
}

export interface RequirementReadiness {
  requirementId: number;
  /** The discipline code this requirement targets (kept under the legacy
   * field name so the readiness UI contract is unchanged). */
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
  /** True when at least one requirement maps to a discipline that isn't bound yet. */
  hasFolderGap: boolean;
}

// =========================================================================
// Internal helpers
// =========================================================================

/** A requirement on the browse-and-bind basis (discipline guaranteed present). */
type DisciplineRequirement = DocumentApprovalRequirement & { discipline: string };

async function loadActiveDisciplineRequirements(): Promise<DisciplineRequirement[]> {
  const rows = await db
    .select()
    .from(documentApprovalRequirements)
    .where(eq(documentApprovalRequirements.active, true));
  // Only discipline-based requirements drive readiness; dormant taxonomy-only
  // rows (legacy) have a null discipline and are ignored.
  return rows.filter(
    (r: DocumentApprovalRequirement): r is DisciplineRequirement => r.discipline != null,
  );
}

async function loadDisciplineFolders(projectId: number): Promise<ProjectDisciplineFolder[]> {
  return db
    .select()
    .from(projectDisciplineFolders)
    .where(
      and(
        eq(projectDisciplineFolders.projectId, projectId),
        isNull(projectDisciplineFolders.deletedAt),
      ),
    );
}

async function loadDisciplineFoldersForMany(
  projectIds: number[],
): Promise<ProjectDisciplineFolder[]> {
  if (projectIds.length === 0) return [];
  return db
    .select()
    .from(projectDisciplineFolders)
    .where(
      and(
        inArray(projectDisciplineFolders.projectId, projectIds),
        isNull(projectDisciplineFolders.deletedAt),
      ),
    );
}

async function loadProjectDocuments(projectId: number): Promise<ManagedDocument[]> {
  return db
    .select()
    .from(managedDocuments)
    .where(
      and(eq(managedDocuments.projectId, projectId), isNull(managedDocuments.deletedAt)),
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

/** The directory part of `docPath` under its bound folder `folderPath` ("" at the root). */
function relativePathUnder(docPath: string, folderPath: string | null): string {
  if (!folderPath) return "";
  const idx = docPath.indexOf(folderPath);
  if (idx < 0) return "";
  const tail = docPath.slice(idx + folderPath.length).replace(/^\/+/, "");
  const lastSlash = tail.lastIndexOf("/");
  return lastSlash >= 0 ? tail.slice(0, lastSlash) : "";
}

/** True when `doc` satisfies `req`'s subfolder + filename narrowing. Bad regexes never throw. */
function docMatchesRequirement(
  req: DisciplineRequirement,
  doc: ManagedDocument,
  folderPath: string | null,
): boolean {
  if (req.subfolderPattern) {
    try {
      if (!new RegExp(req.subfolderPattern, "i").test(relativePathUnder(doc.path, folderPath))) {
        return false;
      }
    } catch {
      return false;
    }
  }
  if (req.fileNamePattern) {
    try {
      return new RegExp(req.fileNamePattern, "i").test(doc.name);
    } catch {
      return false;
    }
  }
  return true;
}

function indexDocumentsByDisciplineFolder(
  docs: ManagedDocument[],
): Map<number, ManagedDocument[]> {
  const out = new Map<number, ManagedDocument[]>();
  for (const d of docs) {
    if (d.disciplineFolderId == null) continue;
    const list = out.get(d.disciplineFolderId);
    if (list) list.push(d);
    else out.set(d.disciplineFolderId, [d]);
  }
  return out;
}

function indexBindingsByDiscipline(
  folders: ProjectDisciplineFolder[],
): Map<string, ProjectDisciplineFolder> {
  const out = new Map<string, ProjectDisciplineFolder>();
  for (const f of folders) out.set(f.discipline, f);
  return out;
}

function classifyRequirement(
  req: DisciplineRequirement,
  bindingByDiscipline: Map<string, ProjectDisciplineFolder>,
  documentsByFolderId: Map<number, ManagedDocument[]>,
): RequirementReadiness {
  const binding = bindingByDiscipline.get(req.discipline);
  if (!binding || !binding.itemId) {
    return {
      requirementId: req.id,
      taxonomyKey: req.discipline,
      displayName: req.displayName,
      status: "folder_missing",
      approvedDocumentId: null,
    };
  }

  const docs = (documentsByFolderId.get(binding.id) ?? []).filter((d) =>
    docMatchesRequirement(req, d, binding.sharepointPath),
  );
  const approved = docs.find((d) => d.state === "approved");
  if (approved) {
    return {
      requirementId: req.id,
      taxonomyKey: req.discipline,
      displayName: req.displayName,
      status: "approved",
      approvedDocumentId: approved.id,
    };
  }
  const inReview = docs.find((d) => d.state === "in_review");
  return {
    requirementId: req.id,
    taxonomyKey: req.discipline,
    displayName: req.displayName,
    status: inReview ? "in_review" : "missing",
    approvedDocumentId: null,
  };
}

function buildDisciplineReadiness(
  requirements: DisciplineRequirement[],
  bindingByDiscipline: Map<string, ProjectDisciplineFolder>,
  documentsByFolderId: Map<number, ManagedDocument[]>,
): DisciplineReadiness[] {
  const byDiscipline = new Map<
    string,
    { requirementsTotal: number; requirementsApproved: number }
  >();

  for (const req of requirements) {
    let stat = byDiscipline.get(req.discipline);
    if (!stat) {
      stat = { requirementsTotal: 0, requirementsApproved: 0 };
      byDiscipline.set(req.discipline, stat);
    }
    stat.requirementsTotal += 1;
    const cls = classifyRequirement(req, bindingByDiscipline, documentsByFolderId);
    if (cls.status === "approved") stat.requirementsApproved += 1;
  }

  const out: DisciplineReadiness[] = [];
  for (const [discipline, s] of byDiscipline.entries()) {
    const binding = bindingByDiscipline.get(discipline);
    const provisioned = Boolean(binding?.itemId);
    out.push({
      discipline,
      foldersTotal: 1,
      foldersProvisioned: provisioned ? 1 : 0,
      requirementsTotal: s.requirementsTotal,
      requirementsApproved: s.requirementsApproved,
      percentReady: percent({
        foldersTotal: 1,
        foldersProvisioned: provisioned ? 1 : 0,
        requirementsTotal: s.requirementsTotal,
        requirementsApproved: s.requirementsApproved,
      }),
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
  const reqRatio = s.requirementsTotal === 0 ? 1 : s.requirementsApproved / s.requirementsTotal;
  const ratio = (folderRatio + reqRatio) / 2;
  return Math.round(ratio * 100);
}

/** Project-level folder axis: in-scope disciplines (those with a requirement) vs. bound. */
function folderAxis(
  requirements: DisciplineRequirement[],
  bindingByDiscipline: Map<string, ProjectDisciplineFolder>,
): { foldersTotal: number; foldersProvisioned: number } {
  const inScope = new Set(requirements.map((r) => r.discipline));
  let provisioned = 0;
  for (const d of inScope) {
    if (bindingByDiscipline.get(d)?.itemId) provisioned += 1;
  }
  return { foldersTotal: inScope.size, foldersProvisioned: provisioned };
}

// =========================================================================
// Public API
// =========================================================================

export async function computeProjectReadiness(projectId: number): Promise<ProjectReadiness> {
  const [proj] = await db
    .select({ projectName: projectInfo.projectName })
    .from(projectInfo)
    .where(eq(projectInfo.id, projectId))
    .limit(1);
  if (!proj) throw new Error(`Project ${projectId} not found`);

  const [requirements, folders, documents] = await Promise.all([
    loadActiveDisciplineRequirements(),
    loadDisciplineFolders(projectId),
    loadProjectDocuments(projectId),
  ]);

  const bindingByDiscipline = indexBindingsByDiscipline(folders);
  const documentsByFolderId = indexDocumentsByDisciplineFolder(documents);

  const requirementRows = requirements.map((r) =>
    classifyRequirement(r, bindingByDiscipline, documentsByFolderId),
  );
  requirementRows.sort(
    (a, b) => a.taxonomyKey.localeCompare(b.taxonomyKey) || a.displayName.localeCompare(b.displayName),
  );

  const { foldersTotal, foldersProvisioned } = folderAxis(requirements, bindingByDiscipline);
  const requirementsTotal = requirementRows.length;
  const requirementsApproved = requirementRows.filter((r) => r.status === "approved").length;

  const overall = percent({
    foldersTotal,
    foldersProvisioned,
    requirementsTotal,
    requirementsApproved,
  });

  const perDiscipline = buildDisciplineReadiness(
    requirements,
    bindingByDiscipline,
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
  // One-shot batch: every active project, all discipline requirements once,
  // and all bindings + documents in a single query each. The math is done in
  // memory, so the tile costs O(projects + folders + docs) queries.
  const projects: Array<{ id: number; projectName: string }> = await db
    .select({ id: projectInfo.id, projectName: projectInfo.projectName })
    .from(projectInfo);

  if (projects.length === 0) return [];

  const ids = projects.map((p) => p.id);

  const [requirements, folders, documents] = await Promise.all([
    loadActiveDisciplineRequirements(),
    loadDisciplineFoldersForMany(ids),
    loadProjectDocumentsForMany(ids),
  ]);

  const foldersByProject = new Map<number, ProjectDisciplineFolder[]>();
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

  const out: PortfolioReadinessRow[] = [];
  for (const p of projects) {
    const projFolders = foldersByProject.get(p.id) ?? [];
    const projDocs = documentsByProject.get(p.id) ?? [];
    const bindingByDiscipline = indexBindingsByDiscipline(projFolders);
    const documentsByFolderId = indexDocumentsByDisciplineFolder(projDocs);

    const reqClass = requirements.map((r) =>
      classifyRequirement(r, bindingByDiscipline, documentsByFolderId),
    );
    const { foldersTotal, foldersProvisioned } = folderAxis(requirements, bindingByDiscipline);
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
