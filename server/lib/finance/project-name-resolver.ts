/**
 * Canonical finance project-name resolution.
 *
 * Finance display names MUST be resolved from `project_info` by `project_id`
 * only. Finance / summary / rollup tables carry a denormalised `project_name`
 * dual (normalized_cost_lines, normalized_revenue_lines, project_revenue_summary,
 * finance_*_monthly, cashflow_points, …) that goes stale on rename — e.g.
 * project_info.id=19 is "Mondi" while a line stamped at import still reads
 * "Hungry Lion Citrusdal". No finance surface may DISPLAY that denormalised
 * name; it resolves the name from project_info via the project_id.
 *
 * `resolveProjectName` is deliberately STRICT: it never falls back to a
 * denormalised name (that fallback is exactly the stale-name bug). When
 * project_info has no live row for an id it returns a neutral placeholder.
 */
import { isNull } from "drizzle-orm";
import { projectInfo } from "@shared/schema/projects";
import { db } from "../../db";

export type ProjectNameMap = ReadonlyMap<number, string>;

/**
 * Map of `project_info.id` → current canonical `project_name`, for every
 * non-deleted project. `dbi` lets callers run inside an existing transaction.
 */
export async function loadProjectNameMap(dbi: typeof db = db): Promise<Map<number, string>> {
  const rows = (await dbi
    .select({ id: projectInfo.id, projectName: projectInfo.projectName })
    .from(projectInfo)
    .where(isNull(projectInfo.deletedAt))) as Array<{ id: number; projectName: string | null }>;

  const map = new Map<number, string>();
  for (const r of rows) {
    if (r.projectName != null && r.projectName !== "") map.set(Number(r.id), r.projectName);
  }
  return map;
}

/**
 * Resolve a finance row's display name STRICTLY from project_info. Never falls
 * back to a denormalised `project_name`. Returns a neutral placeholder when the
 * id has no live project_info row, so a missing project reads as such rather
 * than silently surfacing a stale name.
 */
export function resolveProjectName(
  projectId: number | null | undefined,
  nameMap: ProjectNameMap,
): string {
  if (projectId == null || !Number.isFinite(Number(projectId))) return "Unknown project";
  return nameMap.get(Number(projectId)) ?? `Project #${projectId}`;
}
