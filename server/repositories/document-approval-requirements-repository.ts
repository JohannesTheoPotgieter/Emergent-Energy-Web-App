/**
 * Document approval requirements repository (D6 — Document Management v2).
 *
 * Owns all DB access for `document_approval_requirements`, the
 * admin-editable list that replaces `controlled_document_types`. Each row
 * attaches an approval rule to a folder taxonomy key, optionally narrowed
 * by file-name regex.
 *
 * Conventions (CLAUDE.md):
 * - All DB access goes through this repo. Routes must NOT call
 *   db.select() / db.insert() on `document_approval_requirements`
 *   directly.
 * - Soft-delete via `active=false`. Approval history references
 *   requirements by id and we never want to break the audit trail.
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  documentApprovalRequirements,
  insertDocumentApprovalRequirementSchema,
  type DocumentApprovalRequirement,
} from "@shared/schema/documents";
import { z } from "zod";

// =========================================================================
// Reads
// =========================================================================

/** Active rows ordered for stable list rendering. */
export async function listActiveRequirements(): Promise<DocumentApprovalRequirement[]> {
  return db
    .select()
    .from(documentApprovalRequirements)
    .where(eq(documentApprovalRequirements.active, true))
    .orderBy(asc(documentApprovalRequirements.taxonomyKey), asc(documentApprovalRequirements.sortOrder));
}

/** Every row (active or not) — for the admin editor. */
export async function listAllRequirements(): Promise<DocumentApprovalRequirement[]> {
  return db
    .select()
    .from(documentApprovalRequirements)
    .orderBy(asc(documentApprovalRequirements.taxonomyKey), asc(documentApprovalRequirements.sortOrder));
}

/** All requirements pinned to a particular taxonomy folder. */
export async function listRequirementsForTaxonomy(
  taxonomyKey: string,
): Promise<DocumentApprovalRequirement[]> {
  return db
    .select()
    .from(documentApprovalRequirements)
    .where(
      and(
        eq(documentApprovalRequirements.taxonomyKey, taxonomyKey),
        eq(documentApprovalRequirements.active, true),
      ),
    )
    .orderBy(asc(documentApprovalRequirements.sortOrder));
}

/** All requirements pinned to a particular discipline (browse-and-bind basis). */
export async function listRequirementsForDiscipline(
  discipline: string,
): Promise<DocumentApprovalRequirement[]> {
  return db
    .select()
    .from(documentApprovalRequirements)
    .where(
      and(
        eq(documentApprovalRequirements.discipline, discipline),
        eq(documentApprovalRequirements.active, true),
      ),
    )
    .orderBy(asc(documentApprovalRequirements.sortOrder));
}

export async function getRequirementById(id: number): Promise<DocumentApprovalRequirement | null> {
  const [row] = await db
    .select()
    .from(documentApprovalRequirements)
    .where(eq(documentApprovalRequirements.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Pure matcher: pick the highest-priority requirement from `candidates`
 * (already ordered by sortOrder) that applies to a file. A requirement with a
 * `subfolderPattern` only applies when it matches `relPath` (the path under
 * the bound folder; "" at the folder root). Among applicable rows a
 * `fileNamePattern` match wins; otherwise the first unconditional row (no
 * fileNamePattern) is the fallback. Bad regexes are skipped, never thrown.
 */
export function pickRequirement(
  candidates: DocumentApprovalRequirement[],
  fileName: string,
  relPath: string,
): DocumentApprovalRequirement | null {
  let unconditional: DocumentApprovalRequirement | null = null;
  for (const req of candidates) {
    if (req.subfolderPattern) {
      try {
        if (!new RegExp(req.subfolderPattern, "i").test(relPath)) continue;
      } catch {
        continue;
      }
    }
    if (req.fileNamePattern == null || req.fileNamePattern === "") {
      unconditional ??= req;
      continue;
    }
    try {
      if (new RegExp(req.fileNamePattern, "i").test(fileName)) return req;
    } catch {
      // Bad regex — skip silently. Validation at insert time should have
      // caught this; a single broken pattern must not crash the match.
    }
  }
  return unconditional;
}

/**
 * Legacy taxonomy basis: match a file against active requirements pinned to a
 * taxonomy folder. Returns the matching requirement or null (no approval).
 */
export async function findMatchingRequirement(
  taxonomyKey: string,
  fileName: string,
): Promise<DocumentApprovalRequirement | null> {
  return pickRequirement(await listRequirementsForTaxonomy(taxonomyKey), fileName, "");
}

/**
 * Browse-and-bind basis: match a file in a bound discipline folder against
 * active requirements for that discipline, narrowed by subfolder + filename.
 */
export async function findMatchingRequirementByDiscipline(
  discipline: string,
  relPath: string,
  fileName: string,
): Promise<DocumentApprovalRequirement | null> {
  return pickRequirement(await listRequirementsForDiscipline(discipline), fileName, relPath);
}

// =========================================================================
// Writes
// =========================================================================

export type CreateRequirementInput = z.infer<typeof insertDocumentApprovalRequirementSchema>;

export async function createRequirement(input: CreateRequirementInput): Promise<DocumentApprovalRequirement> {
  const parsed = insertDocumentApprovalRequirementSchema.parse(input);
  // A requirement targets exactly one basis: a legacy taxonomy folder OR a
  // browse-and-bind discipline. (Zod allows both nullish; enforce here.)
  if (!parsed.taxonomyKey && !parsed.discipline) {
    throw new Error("An approval requirement must target either a taxonomyKey or a discipline.");
  }
  const [row] = await db
    .insert(documentApprovalRequirements)
    .values(parsed)
    .returning();
  return row;
}

export const requirementUpdateSchema = insertDocumentApprovalRequirementSchema.partial();
export type RequirementUpdate = z.infer<typeof requirementUpdateSchema>;

export async function updateRequirement(
  id: number,
  patch: RequirementUpdate,
): Promise<DocumentApprovalRequirement> {
  const existing = await getRequirementById(id);
  if (!existing) throw new Error(`Approval requirement ${id} not found.`);

  const parsed = requirementUpdateSchema.parse(patch);

  const [row] = await db
    .update(documentApprovalRequirements)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(documentApprovalRequirements.id, id))
    .returning();
  return row;
}

export async function deactivateRequirement(id: number): Promise<DocumentApprovalRequirement> {
  return updateRequirement(id, { active: false });
}
