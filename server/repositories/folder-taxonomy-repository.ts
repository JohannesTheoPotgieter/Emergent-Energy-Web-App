/**
 * Folder taxonomy repository (D6 — Document Management v2).
 *
 * Owns all DB access for `folder_taxonomy`, the admin-editable canonical
 * tree mirroring SharePoint's Active Clients structure (Pattern A:
 * pre_construction; Pattern B: full_lifecycle).
 *
 * Conventions (CLAUDE.md):
 * - All DB access for the folder taxonomy goes through this repo. Routes
 *   must NOT call db.select() / db.insert() directly on `folder_taxonomy`.
 * - No raw SQL except parameterised sql`` template; no pg-specific cast
 *   syntax (`::`) so the SQLite dev fallback keeps working.
 * - Soft-delete via `active=false`. We never hard-delete because rows in
 *   `project_folders` and `document_approval_requirements` reference
 *   `folder_taxonomy.internal_key` and a hard delete would cascade.
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  folderTaxonomy,
  insertFolderTaxonomySchema,
  type FolderTaxonomy,
  type FolderLifecycleMode,
} from "@shared/schema/documents";
import { z } from "zod";

// =========================================================================
// Reads
// =========================================================================

/** All active rows, ordered by parent grouping then sortOrder. */
export async function listActiveTaxonomy(): Promise<FolderTaxonomy[]> {
  return db
    .select()
    .from(folderTaxonomy)
    .where(eq(folderTaxonomy.active, true))
    .orderBy(asc(folderTaxonomy.parentKey), asc(folderTaxonomy.sortOrder), asc(folderTaxonomy.internalKey));
}

/** Active rows for a specific lifecycle mode. Includes 'both'-marked rows. */
export async function listTaxonomyForLifecycle(mode: FolderLifecycleMode): Promise<FolderTaxonomy[]> {
  const rows = await listActiveTaxonomy();
  return rows.filter((r) => r.lifecycleMode === mode || r.lifecycleMode === "both");
}

/** Every row, active or not — for the admin editor. */
export async function listAllTaxonomy(): Promise<FolderTaxonomy[]> {
  return db
    .select()
    .from(folderTaxonomy)
    .orderBy(asc(folderTaxonomy.parentKey), asc(folderTaxonomy.sortOrder), asc(folderTaxonomy.internalKey));
}

/** Lookup by stable internal key. */
export async function getTaxonomyByKey(internalKey: string): Promise<FolderTaxonomy | null> {
  const [row] = await db
    .select()
    .from(folderTaxonomy)
    .where(eq(folderTaxonomy.internalKey, internalKey))
    .limit(1);
  return row ?? null;
}

/** Direct children of a given parent. Pass null for top-level rows. */
export async function listChildrenByParent(parentKey: string | null): Promise<FolderTaxonomy[]> {
  const rows = await listActiveTaxonomy();
  return rows.filter((r) => r.parentKey === parentKey);
}

// =========================================================================
// Writes
// =========================================================================

export type CreateTaxonomyInput = z.infer<typeof insertFolderTaxonomySchema>;

export async function createTaxonomyRow(input: CreateTaxonomyInput): Promise<FolderTaxonomy> {
  const parsed = insertFolderTaxonomySchema.parse(input);
  const existing = await getTaxonomyByKey(parsed.internalKey);
  if (existing) {
    throw new Error(`Taxonomy key '${parsed.internalKey}' already exists.`);
  }
  if (parsed.parentKey) {
    const parent = await getTaxonomyByKey(parsed.parentKey);
    if (!parent) {
      throw new Error(`Parent key '${parsed.parentKey}' does not exist.`);
    }
  }
  const [row] = await db
    .insert(folderTaxonomy)
    .values(parsed)
    .returning();
  return row;
}

export const taxonomyUpdateSchema = insertFolderTaxonomySchema.partial();
export type TaxonomyUpdate = z.infer<typeof taxonomyUpdateSchema>;

export async function updateTaxonomyRow(
  internalKey: string,
  patch: TaxonomyUpdate,
): Promise<FolderTaxonomy> {
  const existing = await getTaxonomyByKey(internalKey);
  if (!existing) throw new Error(`Taxonomy key '${internalKey}' not found.`);

  const parsed = taxonomyUpdateSchema.parse(patch);

  // Guard against breaking the tree: a row cannot become its own parent.
  if (parsed.parentKey === internalKey) {
    throw new Error("A taxonomy row cannot be its own parent.");
  }
  if (parsed.parentKey) {
    const parent = await getTaxonomyByKey(parsed.parentKey);
    if (!parent) throw new Error(`Parent key '${parsed.parentKey}' does not exist.`);
  }

  const [row] = await db
    .update(folderTaxonomy)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(folderTaxonomy.internalKey, internalKey))
    .returning();
  return row;
}

/** Soft-delete by flipping `active` to false. */
export async function deactivateTaxonomyRow(internalKey: string): Promise<FolderTaxonomy> {
  return updateTaxonomyRow(internalKey, { active: false });
}
