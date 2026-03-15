import { queryImportSyncState } from "../repositories/imports-governance-repository";

export interface ImportSyncStateRow {
  projectId: number;
  projectName: string | null;
  latestImportRunId: number | null;
  latestImportAt: string | null;
  pendingSourceUpdateRequests: number;
  pendingAcknowledgements: number;
  openConflicts: number;
  unresolvedConflictResolutions: number;
  syncState: "in_sync" | "stale" | "conflicted" | "awaiting_acknowledgement" | "awaiting_reimport";
}

export async function listImportSyncState(projectId?: number): Promise<ImportSyncStateRow[]> {
  const rows = await queryImportSyncState(projectId);

  return rows.map((row: any) => ({
    projectId: Number(row.project_id),
    projectName: row.project_name ? String(row.project_name) : null,
    latestImportRunId: row.latest_import_run_id ? Number(row.latest_import_run_id) : null,
    latestImportAt: row.latest_import_at ? new Date(row.latest_import_at).toISOString() : null,
    pendingSourceUpdateRequests: Number(row.pending_source_update_requests ?? 0),
    pendingAcknowledgements: Number(row.pending_acknowledgements ?? 0),
    openConflicts: Number(row.open_conflicts ?? 0),
    unresolvedConflictResolutions: Number(row.unresolved_conflict_resolutions ?? 0),
    syncState: row.sync_state,
  }));
}
