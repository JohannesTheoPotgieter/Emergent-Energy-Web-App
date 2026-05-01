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

export async function getRequirementById(id: number): Promise<DocumentApprovalRequirement | null> {
  const [row] = await db
    .select()
    .from(documentApprovalRequirements)
    .where(eq(documentApprovalRequirements.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Match a file against active requirements for a folder. Returns the
 * highest-priority requirement (lowest sortOrder) whose `fileNamePattern`
 * matches the file name, or the unconditional requirement (null pattern)
 * if no pattern matches. Returns null if nothing applies — caller treats
 * the file as not requiring approval.
 */
export async function findMatchingRequirement(
  taxonomyKey: string,
  fileName: string,
): Promise<DocumentApprovalRequirement | null> {
  const candidates = await listRequirementsForTaxonomy(taxonomyKey);
  let unconditional: DocumentApprovalRequirement | null = null;
  for (const req of candidates) {
    if (req.fileNamePattern == null || req.fileNamePattern === "") {
      unconditional ??= req;
      continue;
    }
    try {
      const re = new RegExp(req.fileNamePattern, "i");
      if (re.test(fileName)) return req;
    } catch {
      // Bad regex — skip silently. Validation at insert time should have
      // caught this; if it didn't, we don't want a single broken pattern
      // to crash the whole match.
    }
  }
  return unconditional;
}

// =========================================================================
// Writes
// =========================================================================

export type CreateRequirementInput = z.infer<typeof insertDocumentApprovalRequirementSchema>;

export async function createRequirement(input: CreateRequirementInput): Promise<DocumentApprovalRequirement> {
  const parsed = insertDocumentApprovalRequirementSchema.parse(input);
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
