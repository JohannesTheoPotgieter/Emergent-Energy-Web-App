/**
 * Import configuration repository — Smart Import v2.
 *
 * Owns DB access for the "remembered" import configuration that lets the
 * pipeline stop re-asking the same questions:
 *   - `template_profiles` + `mapping_rules` — learned column mappings.
 *   - `smart_import_project_bindings` — sticky filename → project bindings.
 *
 * Consumed by the reuse path (load learned mappings/binding for an incoming
 * file) and by the import-mappings management screen (list/edit/clear).
 *
 * Conventions (CLAUDE.md): all DB access for these tables goes through here.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  templateProfiles,
  mappingRules,
  smartImportProjectBindings,
  projectInfo,
  type TemplateProfile,
  type MappingRule,
  type SmartImportProjectBinding,
} from "@shared/schema";
import { deriveTemplateProfileName, normalizeImportSourceKey } from "../lib/import/source-key";

// =========================================================================
// Template profiles + mapping rules (learned column mappings)
// =========================================================================

/** All saved template profiles, newest first. */
export async function listTemplateProfiles(): Promise<TemplateProfile[]> {
  return db.select().from(templateProfiles).orderBy(desc(templateProfiles.updatedAt));
}

/** Look up a profile by its (case-sensitive) derived name. */
export async function findTemplateProfileByName(name: string): Promise<TemplateProfile | null> {
  const [row] = await db
    .select()
    .from(templateProfiles)
    .where(eq(templateProfiles.name, name))
    .limit(1);
  return row ?? null;
}

/** All learned rules for a profile. */
export async function listMappingRulesForProfile(profileId: number): Promise<MappingRule[]> {
  return db.select().from(mappingRules).where(eq(mappingRules.templateProfileId, profileId));
}

/**
 * The reuse loader. Given an incoming file, resolve its template profile by
 * the same derived name the learn side uses, and return its rules in the
 * shape `mapColumns()` expects. Returns [] when nothing has been learned yet
 * (so the caller transparently falls back to synonym/fuzzy matching).
 */
export async function getLearnedMappingsForFile(
  fileName: string,
  projectName?: string | null,
): Promise<{ section: string; sourceHeader: string; canonicalField: string; confidenceWeight: number }[]> {
  const profileName = deriveTemplateProfileName(fileName, projectName);
  const profile = await findTemplateProfileByName(profileName);
  if (!profile) return [];
  const rules = await listMappingRulesForProfile(profile.id);
  return rules.map((r) => ({
    section: r.section,
    sourceHeader: r.sourceHeader,
    canonicalField: r.canonicalField,
    confidenceWeight: r.confidenceWeight,
  }));
}

/** Update a single learned rule (management screen edit). */
export async function updateMappingRule(
  id: number,
  patch: { canonicalField?: string; confidenceWeight?: number },
): Promise<MappingRule | null> {
  const [row] = await db
    .update(mappingRules)
    .set({
      ...(patch.canonicalField !== undefined ? { canonicalField: patch.canonicalField } : {}),
      ...(patch.confidenceWeight !== undefined ? { confidenceWeight: patch.confidenceWeight } : {}),
    })
    .where(eq(mappingRules.id, id))
    .returning();
  return row ?? null;
}

/** Delete a single learned rule. */
export async function deleteMappingRule(id: number): Promise<boolean> {
  const rows = await db.delete(mappingRules).where(eq(mappingRules.id, id)).returning();
  return rows.length > 0;
}

/** Delete a profile and all its rules (management screen "clear"). */
export async function deleteTemplateProfile(id: number): Promise<boolean> {
  await db.delete(mappingRules).where(eq(mappingRules.templateProfileId, id));
  const rows = await db.delete(templateProfiles).where(eq(templateProfiles.id, id)).returning();
  return rows.length > 0;
}

// =========================================================================
// Sticky project bindings (filename → project)
// =========================================================================

export interface BindingWithProject extends SmartImportProjectBinding {
  projectName: string | null;
}

/** All bindings with their resolved project name, newest first. */
export async function listProjectBindings(): Promise<BindingWithProject[]> {
  const rows = await db
    .select({
      binding: smartImportProjectBindings,
      projectName: projectInfo.projectName,
    })
    .from(smartImportProjectBindings)
    .leftJoin(projectInfo, eq(smartImportProjectBindings.projectId, projectInfo.id))
    .orderBy(desc(smartImportProjectBindings.updatedAt));
  return rows.map(
    (r: { binding: SmartImportProjectBinding; projectName: string | null }) => ({
      ...r.binding,
      projectName: r.projectName ?? null,
    }),
  );
}

/** Active binding for an incoming file, by normalized source key. */
export async function findActiveBindingForFile(
  fileName: string,
): Promise<SmartImportProjectBinding | null> {
  const sourceKey = normalizeImportSourceKey(fileName);
  const [row] = await db
    .select()
    .from(smartImportProjectBindings)
    .where(
      and(
        eq(smartImportProjectBindings.sourceKey, sourceKey),
        eq(smartImportProjectBindings.active, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface UpsertBindingInput {
  fileName: string;
  projectId: number;
  matchType?: string;
  confidence?: number;
  confirmedByUserId?: number | null;
}

/**
 * Remember (or re-point) the project for a file's source key. Keyed by the
 * normalized source key so a re-upload of the same tracker reuses it.
 */
export async function upsertProjectBinding(
  input: UpsertBindingInput,
): Promise<SmartImportProjectBinding> {
  const sourceKey = normalizeImportSourceKey(input.fileName);
  const now = new Date();
  const [row] = await db
    .insert(smartImportProjectBindings)
    .values({
      sourceKey,
      projectId: input.projectId,
      matchType: input.matchType ?? "filename",
      confidence: input.confidence ?? 1.0,
      confirmedByUserId: input.confirmedByUserId ?? null,
      active: true,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: smartImportProjectBindings.sourceKey,
      set: {
        projectId: input.projectId,
        matchType: input.matchType ?? "filename",
        confidence: input.confidence ?? 1.0,
        confirmedByUserId: input.confirmedByUserId ?? null,
        active: true,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

/** Bump usage telemetry when a binding is actually used by a run. */
export async function recordBindingUsage(id: number): Promise<void> {
  const [existing] = await db
    .select()
    .from(smartImportProjectBindings)
    .where(eq(smartImportProjectBindings.id, id))
    .limit(1);
  if (!existing) return;
  await db
    .update(smartImportProjectBindings)
    .set({ lastUsedAt: new Date(), timesUsed: existing.timesUsed + 1 })
    .where(eq(smartImportProjectBindings.id, id));
}

/**
 * Resolve a project's canonical name by id. The scheduler needs this when a
 * sticky binding supplies the projectId — the downstream commit writes key on
 * `projectName`, so it must be the real project name, not the extracted one.
 */
export async function getProjectNameById(projectId: number): Promise<string | null> {
  const [row] = await db
    .select({ name: projectInfo.projectName })
    .from(projectInfo)
    .where(eq(projectInfo.id, projectId))
    .limit(1);
  return row?.name ?? null;
}

/** Delete a binding (management screen "forget"). */
export async function deleteProjectBinding(id: number): Promise<boolean> {
  const rows = await db
    .delete(smartImportProjectBindings)
    .where(eq(smartImportProjectBindings.id, id))
    .returning();
  return rows.length > 0;
}
