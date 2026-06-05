/**
 * Shared derivation of the stable "source identity" of an import file.
 *
 * Two consumers depend on this being IDENTICAL on the write and read sides:
 *
 *  - Learned column mappings: `template_profiles.name` is derived from the
 *    upload filename when a user corrects a mapping (smart-import-routes.ts).
 *    The reuse path must derive the same name to find those rules again.
 *  - Sticky project bindings: `smart_import_project_bindings.source_key`
 *    remembers which project a given tracker maps to.
 *
 * Keeping the transform here (instead of inline on both sides) is the whole
 * point — if these drift, learned mappings silently stop being reused.
 */

/** Strip the volatile bits of an upload filename: leading "123_" prefix and extension. */
function stripVolatile(fileName: string): string {
  return fileName
    .replace(/^\d+_/, "") // leading numeric upload prefix (e.g. "1780651_")
    .replace(/\.(xlsx|xlsm|xls)$/i, ""); // workbook extension
}

/**
 * The template-profile NAME for a file. Must match the learn-side logic in
 * `smart-import-routes.ts` exactly (case preserved — profile lookup is
 * case-sensitive). `projectName` is the same fallback the learn side uses.
 */
export function deriveTemplateProfileName(fileName: string, projectName?: string | null): string {
  const filePattern = stripVolatile(fileName).replace(/_/g, " ").trim();
  return filePattern || projectName || "Default Template";
}

/**
 * The canonical, case-insensitive key for a sticky project binding. Defined
 * here (this is the only consumer), so it can be a touch more aggressive than
 * the profile name without affecting mapping reuse.
 */
export function normalizeImportSourceKey(fileName: string): string {
  return stripVolatile(fileName)
    .replace(/[_\s]+/g, " ")
    .trim()
    .toLowerCase();
}
