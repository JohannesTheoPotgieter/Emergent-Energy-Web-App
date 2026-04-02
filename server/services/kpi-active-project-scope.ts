import { sql } from "drizzle-orm";
import { db } from "../db";

function hasTrackerLink(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Canonical active KPI scope:
 * Active = Excel tracker linked.
 */
export async function getTrackerLinkedActiveProjects(): Promise<Array<{ id: number; projectName: string }>> {
  const result = await db.execute(sql`
    SELECT id, project_name, excel_tracker_link
    FROM project_info
    WHERE deleted_at IS NULL
      AND COALESCE(archived_status, 'ACTIVE') <> 'ARCHIVED'
  `);
  const rows = (result.rows ?? []) as Array<{ id: number; project_name: string; excel_tracker_link: string | null }>;

  return rows
    .filter((row) => hasTrackerLink(row.excel_tracker_link))
    .map((row) => ({ id: Number(row.id), projectName: row.project_name }));
}

export async function getTrackerLinkedActiveProjectIdSet(): Promise<Set<number>> {
  const rows = await getTrackerLinkedActiveProjects();
  return new Set(rows.map((row) => row.id));
}
