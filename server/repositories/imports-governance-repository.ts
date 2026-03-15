import { db } from "../db";
import { sql } from "drizzle-orm";

export interface ImportSyncStateRepositoryRow {
  project_id: number;
  project_name: string | null;
  latest_import_run_id: number | null;
  latest_import_at: Date | null;
  pending_source_update_requests: number;
  pending_acknowledgements: number;
  open_conflicts: number;
  unresolved_conflict_resolutions: number;
  sync_state: "in_sync" | "stale" | "conflicted" | "awaiting_acknowledgement" | "awaiting_reimport";
}

export async function queryImportSyncState(projectId?: number): Promise<ImportSyncStateRepositoryRow[]> {
  const projectFilter = projectId ? sql`WHERE p.id = ${projectId}` : sql``;
  const rows = await db.execute(sql`
    WITH project_base AS (
      SELECT p.id AS project_id, p.project_name
      FROM project_info p
      ${projectFilter}
    ),
    latest_import AS (
      SELECT sr.project_id,
             MAX(sr.completed_at) AS latest_import_at,
             MAX(sr.id) AS latest_import_run_id
      FROM imports.smart_import_runs sr
      GROUP BY sr.project_id
    ),
    source_updates AS (
      SELECT sur.project_id,
             COUNT(*) FILTER (WHERE sur.status IN ('pending', 'awaiting_acknowledgement'))::int AS pending_source_update_requests
      FROM imports.source_update_requests sur
      GROUP BY sur.project_id
    ),
    ack_gaps AS (
      SELECT sur.project_id,
             COUNT(*)::int AS pending_acknowledgements
      FROM imports.source_update_requests sur
      LEFT JOIN imports.source_update_acknowledgements sua
        ON sua.source_update_request_id = sur.id
       AND sua.acknowledgement_status IN ('acknowledged', 'completed')
      WHERE sur.status IN ('pending', 'awaiting_acknowledgement')
        AND sua.id IS NULL
      GROUP BY sur.project_id
    ),
    conflicts AS (
      SELECT dc.project_id,
             COUNT(*) FILTER (WHERE dc.status IN ('open', 'pending'))::int AS open_conflicts
      FROM imports.data_conflicts dc
      GROUP BY dc.project_id
    ),
    unresolved_resolutions AS (
      SELECT dc.project_id,
             COUNT(*) FILTER (WHERE cr.id IS NULL)::int AS unresolved_conflict_resolutions
      FROM imports.data_conflicts dc
      LEFT JOIN imports.conflict_resolutions cr ON cr.conflict_id = dc.id
      WHERE dc.status IN ('open', 'pending')
      GROUP BY dc.project_id
    )
    SELECT
      pb.project_id,
      pb.project_name,
      li.latest_import_run_id,
      li.latest_import_at,
      COALESCE(su.pending_source_update_requests, 0) AS pending_source_update_requests,
      COALESCE(ag.pending_acknowledgements, 0) AS pending_acknowledgements,
      COALESCE(c.open_conflicts, 0) AS open_conflicts,
      COALESCE(ur.unresolved_conflict_resolutions, 0) AS unresolved_conflict_resolutions,
      CASE
        WHEN COALESCE(c.open_conflicts, 0) > 0 THEN 'conflicted'
        WHEN COALESCE(ag.pending_acknowledgements, 0) > 0 THEN 'awaiting_acknowledgement'
        WHEN COALESCE(su.pending_source_update_requests, 0) > 0 THEN 'awaiting_reimport'
        WHEN li.latest_import_at IS NULL THEN 'stale'
        ELSE 'in_sync'
      END AS sync_state
    FROM project_base pb
    LEFT JOIN latest_import li ON li.project_id = pb.project_id
    LEFT JOIN source_updates su ON su.project_id = pb.project_id
    LEFT JOIN ack_gaps ag ON ag.project_id = pb.project_id
    LEFT JOIN conflicts c ON c.project_id = pb.project_id
    LEFT JOIN unresolved_resolutions ur ON ur.project_id = pb.project_id
    ORDER BY pb.project_name
  `).then((r: any) => r.rows ?? r);

  return rows as ImportSyncStateRepositoryRow[];
}
