/**
 * Fallback helpers for Project Info reads.
 *
 * During schema migration, some columns or tables may not yet exist.
 * These helpers detect safe-to-fallback errors and provide a
 * legacy-compatible read path with hardcoded defaults.
 *
 * Used by:
 *   - ProjectInfoReadRepository.getAll()
 *   - DatabaseStorage.getProjectInfo()
 *   - DatabaseStorage.getProjectInfoById()
 *   - DatabaseStorage.getAllProjects()
 */

import { eq, desc, sql } from "drizzle-orm";
import { projectInfo, projectExecutionState, type ProjectInfo } from "@shared/schema";
import { db, getDbMode } from "../db";

/**
 * Inspect a query error and decide whether it is safe to fall back
 * to the legacy-compatible read path.
 *
 * Returns true only for missing-table or missing-column errors
 * that match the known migration column allowlist.
 */
export function shouldUseLegacyProjectInfoReadFallback(error: unknown): boolean {
  const mode = getDbMode();
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code = (error as any)?.code;

  const missingColumnNames = [
    "phase_updated_at",
    "phase_updated_by_user_id",
    "phase_notes",
    "execution_phase",
    "client_id",
    "archived_status",
    "pm_user_id",
    "pd_user_id",
    "cp_signed",
    "cp_signed_date",
    "cp_signed_by_user_id",
    "cp_evidence_type",
    "cp_evidence_ref",
    "pm_task_pack_created",
    "eng_post_cp_task_pack_created",
    "site_id",
    "opportunity_id",
    "delivery_model",
    "project_code",
    "site_establishment_date",
    "site_establishment_actual",
    "financial_review_status",
    "financial_review_id",
    "waiting_on_department",
  ];

  if (mode === "sqlite") {
    if (message.includes("no such table")) return true;
    return message.includes("no such column")
      && missingColumnNames.some((col) => message.includes(col));
  }

  // PostgreSQL: error code 42P01 = undefined_table
  if (code === "42P01") return true;
  // PostgreSQL: error code 42703 = undefined_column
  if (code === "42703") {
    return missingColumnNames.some((col) => message.includes(col));
  }

  return false;
}

/**
 * Legacy-compatible Project Info reader with 3-tier degradation.
 *
 * Tier 1: LEFT JOIN project_execution_state for phase
 * Tier 2: Raw SQL with information_schema column check
 * Tier 3: project_info only, phase = null
 *
 * All tiers inject hardcoded defaults for missing fields.
 */
export async function listLegacyCompatibleProjectInfo(
  dbInstance: typeof db,
  filters?: {
    projectName?: string;
    id?: number;
  },
): Promise<ProjectInfo[]> {
  let rows: any[];
  try {
    const baseQuery = dbInstance.select({
      id: projectInfo.id,
      projectName: projectInfo.projectName,
      sizeKwp: projectInfo.sizeKwp,
      pd: projectInfo.pd,
      pm: projectInfo.pm,
      contractValue: projectInfo.contractValue,
      phase: projectExecutionState.phase,
      updatedAt: projectInfo.updatedAt,
    }).from(projectInfo)
      .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id));

    rows = filters?.projectName
      ? await baseQuery.where(eq(projectInfo.projectName, filters.projectName))
      : filters?.id != null
        ? await baseQuery.where(eq(projectInfo.id, filters.id))
        : await baseQuery.orderBy(desc(projectInfo.updatedAt));
  } catch (joinErr: any) {
    // project_execution_state table may not exist — try reading phase from project_info directly
    console.warn("[storage] project_execution_state join failed, falling back to project_info:", joinErr.message);
    try {
      // project_info may still have a phase column from legacy schema
      const fallbackRows = await dbInstance.execute(
        sql`SELECT id, project_name, size_kwp, pd, pm, contract_value, updated_at,
                   CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_info' AND column_name='phase')
                        THEN (SELECT phase FROM project_info pi2 WHERE pi2.id = project_info.id)
                        ELSE NULL END as phase
            FROM project_info
            ORDER BY updated_at DESC`
      );
      rows = (fallbackRows.rows as any[]).map(r => ({
        id: r.id,
        projectName: r.project_name,
        sizeKwp: r.size_kwp,
        pd: r.pd,
        pm: r.pm,
        contractValue: r.contract_value,
        phase: r.phase,
        updatedAt: r.updated_at,
      }));
      if (filters?.projectName) {
        rows = rows.filter(r => r.projectName === filters.projectName);
      } else if (filters?.id != null) {
        rows = rows.filter(r => r.id === filters.id);
      }
    } catch {
      // Last resort: no phase data available
      const simpleQuery = dbInstance.select({
        id: projectInfo.id,
        projectName: projectInfo.projectName,
        sizeKwp: projectInfo.sizeKwp,
        pd: projectInfo.pd,
        pm: projectInfo.pm,
        contractValue: projectInfo.contractValue,
        updatedAt: projectInfo.updatedAt,
      }).from(projectInfo);

      const simpleRows = filters?.projectName
        ? await simpleQuery.where(eq(projectInfo.projectName, filters.projectName))
        : filters?.id != null
          ? await simpleQuery.where(eq(projectInfo.id, filters.id))
          : await simpleQuery.orderBy(desc(projectInfo.updatedAt));
      rows = simpleRows.map((r: any) => ({ ...r, phase: null }));
    }
  }

  return rows.map((row) => ({
    ...row,
    phaseUpdatedAt: null,
    phaseUpdatedByUserId: null,
    phaseNotes: null,
    pdHandoverDate: null,
    constructionStartDate: null,
    commissioningDate: null,
    omHandoverDate: null,
    clientHandoverDate: null,
    escalationLevel: null,
    constructionStartActual: null,
    pdHandoverActual: null,
    commissioningActual: null,
    clientHandoverActual: null,
    ragStatus: null,
    ragComment: null,
    ragUpdatedAt: null,
    ragUpdatedByUserId: null,
    isActive: true,
    executionEnabled: false,
    executionGateStatus: "NOT_ELIGIBLE",
    executionGateReason: null,
    signedStatus: "NONE",
    signedDate: null,
    signedDocumentLink: null,
    executionPhase: null,
    excelTrackerLink: null,
    canonicalProjectId: row.id,
    clientId: null,
    archivedStatus: "ACTIVE",
    pmUserId: null,
    pdUserId: null,
    cpSigned: false,
    cpSignedDate: null,
    cpSignedByUserId: null,
    cpEvidenceType: null,
    cpEvidenceRef: null,
    pmTaskPackCreated: false,
    engPostCpTaskPackCreated: false,
  })) as ProjectInfo[];
}
