import { db } from "../db";
import { sql } from "drizzle-orm";

function isMissingCoreSchemaError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /relation.*does not exist|no such table|schema.*does not exist/i.test(msg) || (error as any)?.code === '42P01';
}

export type ComparisonStatus = "ready" | "partial" | "blocked";

export interface DomainComparisonSummary {
  domain: "projects" | "clients" | "portfolios" | "project_portfolio_assignments" | "work_item_counts" | "project_detail_master" | "work_item_summary" | "imports_governance";
  legacyCount: number;
  promotedCount: number;
  missingInPromotedCount: number;
  extraInPromotedCount: number;
  fieldMismatchCount: number;
  status: ComparisonStatus;
  mismatchCategories: string[];
  sampleMissingInPromotedIds: number[];
  sampleExtraInPromotedIds: number[];
  sampleFieldMismatchIds: number[];
  notes: string[];
}




export interface DomainRolloutReadiness {
  domain: string;
  readiness: ComparisonStatus;
  blockerCount: number;
  mismatchCount: number;
  mismatchCategories: string[];
  sampleIds: number[];
  safeReadOnlyPromotedUse: boolean;
  safeDualWritePreview: boolean;
  safeFullCutoverLater: boolean;
  blockerSummary: string;
}

export interface CutoverPostValidationRow {
  domain: string;
  cutoverState: string;
  promotedReadPrimary: boolean;
  dualWriteEnabled: boolean;
  legacyFallbackAvailable: boolean;
  rollbackFlagKey: string | null;
  readinessEvidenceSource: string | null;
  readiness: ComparisonStatus;
  blockerCount: number;
  mismatchCount: number;
  mismatchCategories: string[];
  sampleIds: number[];
  blockerSummary: string;
  updatedAt: string;
  updatedBy: string;
}

export async function getDomainRolloutReadinessReport(): Promise<DomainRolloutReadiness[]> {
  try {
    const rows = await db.execute(sql`
      SELECT domain,
             readiness,
             blocker_count,
             mismatch_count,
             mismatch_categories,
             sample_ids,
             safe_read_only_promoted_use,
             safe_dual_write_preview,
             safe_full_cutover_later,
             blocker_summary
      FROM core.v_domain_rollout_readiness
      ORDER BY domain
    `).then((r: any) => r.rows ?? r);

    return rows.map((row: any) => ({
      domain: String(row.domain),
      readiness: row.readiness as ComparisonStatus,
      blockerCount: Number(row.blocker_count ?? 0),
      mismatchCount: Number(row.mismatch_count ?? 0),
      mismatchCategories: Array.isArray(row.mismatch_categories) ? row.mismatch_categories : [],
      sampleIds: Array.isArray(row.sample_ids) ? row.sample_ids.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v)) : [],
      safeReadOnlyPromotedUse: Boolean(row.safe_read_only_promoted_use),
      safeDualWritePreview: Boolean(row.safe_dual_write_preview),
      safeFullCutoverLater: Boolean(row.safe_full_cutover_later),
      blockerSummary: String(row.blocker_summary ?? ''),
    }));
  } catch (error: any) {
    if (isMissingCoreSchemaError(error)) {
      console.warn("[promoted-read-compat] core.v_domain_rollout_readiness missing, returning empty");
      return [];
    }
    throw error;
  }
}

export async function getCutoverPostValidationReport(): Promise<CutoverPostValidationRow[]> {
  try {
    const rows = await db.execute(sql`
      SELECT domain,
             cutover_state,
             promoted_read_primary,
             dual_write_enabled,
             legacy_fallback_available,
             rollback_flag_key,
             readiness_evidence_source,
             readiness,
             blocker_count,
             mismatch_count,
             mismatch_categories,
             sample_ids,
             blocker_summary,
             updated_at,
             updated_by
      FROM core.v_cutover_post_validation
      ORDER BY domain
    `).then((r: any) => r.rows ?? r);

    return rows.map((row: any) => ({
      domain: String(row.domain),
      cutoverState: String(row.cutover_state),
      promotedReadPrimary: Boolean(row.promoted_read_primary),
      dualWriteEnabled: Boolean(row.dual_write_enabled),
      legacyFallbackAvailable: Boolean(row.legacy_fallback_available),
      rollbackFlagKey: row.rollback_flag_key ? String(row.rollback_flag_key) : null,
      readinessEvidenceSource: row.readiness_evidence_source ? String(row.readiness_evidence_source) : null,
      readiness: row.readiness as ComparisonStatus,
      blockerCount: Number(row.blocker_count ?? 0),
      mismatchCount: Number(row.mismatch_count ?? 0),
      mismatchCategories: Array.isArray(row.mismatch_categories) ? row.mismatch_categories : [],
      sampleIds: Array.isArray(row.sample_ids) ? row.sample_ids.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v)) : [],
      blockerSummary: String(row.blocker_summary ?? ""),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date(0).toISOString(),
      updatedBy: String(row.updated_by ?? "system"),
    }));
  } catch (error: any) {
    if (isMissingCoreSchemaError(error)) {
      console.warn("[promoted-read-compat] core.v_cutover_post_validation missing, returning empty");
      return [];
    }
    throw error;
  }
}

export interface ProjectDetailCompatRow {
  id: number;
  projectName: string;
  phase: string | null;
  ragStatus: string | null;
  ragComment: string | null;
  clientId: number | null;
  clientName: string | null;
  portfolioMembership: {
    portfolioId: number;
    portfolioName: string;
  }[];
  teamMembers: {
    userId: number | null;
    role: string | null;
    name: string | null;
  }[];
}

export interface WorkItemSummaryDiagnostics {
  generatedAt: string;
  totals: {
    legacyCount: number;
    promotedCount: number;
    projectMismatchCount: number;
  };
  mismatchCategories: string[];
  sampleProjectIds: number[];
  byProject: Array<{
    projectId: number;
    projectName: string | null;
    legacyCount: number;
    promotedCount: number;
    deltaCount: number;
    legacyStatusDistribution: Record<string, number>;
    promotedStatusDistribution: Record<string, number>;
    legacyOwnerDistribution: Record<string, number>;
    promotedOwnerDistribution: Record<string, number>;
    legacyWorkstreamDistribution: Record<string, number>;
    promotedWorkstreamDistribution: Record<string, number>;
    mismatchCategories: string[];
  }>;
}

export interface Phase1ADiagnosticSummary {
  domain: "project_reads" | "lifecycle_gates" | "approvals" | "finance" | "deliverables" | "party_contacts";
  status: ComparisonStatus;
  legacyCount: number;
  promotedCount: number;
  deltaCount: number;
  mismatchCategories: string[];
  notes: string[];
}

export interface Phase1AReconciliationReport {
  generatedAt: string;
  checks: Phase1ADiagnosticSummary[];
}
function blockedDomainSummary(domain: DomainComparisonSummary["domain"], note: string): DomainComparisonSummary {
  return {
    domain,
    legacyCount: 0,
    promotedCount: 0,
    missingInPromotedCount: 0,
    extraInPromotedCount: 0,
    fieldMismatchCount: 0,
    status: "blocked",
    mismatchCategories: ["core_schema_missing"],
    sampleMissingInPromotedIds: [],
    sampleExtraInPromotedIds: [],
    sampleFieldMismatchIds: [],
    notes: [note],
  };
}

function classifyStatus(summary: Pick<DomainComparisonSummary, "missingInPromotedCount" | "extraInPromotedCount" | "fieldMismatchCount">): ComparisonStatus {
  if (summary.missingInPromotedCount === 0 && summary.extraInPromotedCount === 0 && summary.fieldMismatchCount === 0) return "ready";
  if (summary.missingInPromotedCount > 0) return "blocked";
  return "partial";
}

function limitIds(ids: number[], max = 20): number[] {
  return ids.slice(0, max);
}

export async function compareCoreProjectsReadiness(): Promise<DomainComparisonSummary> {
  try {
    const [legacyRows, promotedRows] = await Promise.all([
      db.execute(sql`SELECT id, project_name, client_id, phase FROM public.project_info ORDER BY id`).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT id, project_name, client_id, phase FROM core.projects ORDER BY id`).then((r: any) => r.rows ?? r),
    ]);

    const promotedById = new Map<number, any>(promotedRows.map((row: any) => [Number(row.id), row]));
    const legacyById = new Map<number, any>(legacyRows.map((row: any) => [Number(row.id), row]));

    const missingInPromoted: number[] = [];
    const fieldMismatch: number[] = [];

    for (const row of legacyRows) {
      const id = Number(row.id);
      const promoted = promotedById.get(id);
      if (!promoted) {
        missingInPromoted.push(id);
        continue;
      }

      const projectNameMismatch = (row.project_name ?? "") !== (promoted.project_name ?? "");
      const clientMismatch = Number(row.client_id ?? 0) !== Number(promoted.client_id ?? 0);
      const phaseMismatch = (row.phase ?? "") !== (promoted.phase ?? "");
      if (projectNameMismatch || clientMismatch || phaseMismatch) fieldMismatch.push(id);
    }

    const extraInPromoted = promotedRows
      .map((row: any) => Number(row.id))
      .filter((id: number) => !legacyById.has(id));

    const mismatchCategories: string[] = [];
    if (missingInPromoted.length) mismatchCategories.push("missing_project_rows");
    if (extraInPromoted.length) mismatchCategories.push("extra_promoted_project_rows");
    if (fieldMismatch.length) mismatchCategories.push("project_master_field_mismatch");

    return {
      domain: "projects",
      legacyCount: legacyRows.length,
      promotedCount: promotedRows.length,
      missingInPromotedCount: missingInPromoted.length,
      extraInPromotedCount: extraInPromoted.length,
      fieldMismatchCount: fieldMismatch.length,
      status: classifyStatus({
        missingInPromotedCount: missingInPromoted.length,
        extraInPromotedCount: extraInPromoted.length,
        fieldMismatchCount: fieldMismatch.length,
      }),
      mismatchCategories,
      sampleMissingInPromotedIds: limitIds(missingInPromoted),
      sampleExtraInPromotedIds: limitIds(extraInPromoted),
      sampleFieldMismatchIds: limitIds(fieldMismatch),
      notes: ["Project master parity uses id-preserving mapping from public.project_info to core.projects."],
    };
  } catch (error: any) {
    if (isMissingCoreSchemaError(error)) {
      console.warn("[promoted-read-compat] core.projects missing, returning blocked status");
      return blockedDomainSummary("projects", "core.projects table does not exist");
    }
    throw error;
  }
}

export async function compareCoreClientsReadiness(): Promise<DomainComparisonSummary> {
  try {
    const [legacyRows, promotedRows] = await Promise.all([
      db.execute(sql`SELECT id, name, client_id FROM public.clients ORDER BY id`).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT id, name, client_code FROM core.clients ORDER BY id`).then((r: any) => r.rows ?? r),
    ]);

    const promotedById = new Map<number, any>(promotedRows.map((row: any) => [Number(row.id), row]));
    const legacyById = new Map<number, any>(legacyRows.map((row: any) => [Number(row.id), row]));
    const missingInPromoted: number[] = [];
    const fieldMismatch: number[] = [];

    for (const row of legacyRows) {
      const id = Number(row.id);
      const promoted = promotedById.get(id);
      if (!promoted) {
        missingInPromoted.push(id);
        continue;
      }

      const nameMismatch = (row.name ?? "") !== (promoted.name ?? "");
      const codeMismatch = (row.client_id ?? "") !== (promoted.client_code ?? "");
      if (nameMismatch || codeMismatch) fieldMismatch.push(id);
    }

    const extraInPromoted = promotedRows
      .map((row: any) => Number(row.id))
      .filter((id: number) => !legacyById.has(id));

    const mismatchCategories: string[] = [];
    if (missingInPromoted.length) mismatchCategories.push("missing_client_rows");
    if (extraInPromoted.length) mismatchCategories.push("extra_promoted_client_rows");
    if (fieldMismatch.length) mismatchCategories.push("client_field_mismatch");

    return {
      domain: "clients",
      legacyCount: legacyRows.length,
      promotedCount: promotedRows.length,
      missingInPromotedCount: missingInPromoted.length,
      extraInPromotedCount: extraInPromoted.length,
      fieldMismatchCount: fieldMismatch.length,
      status: classifyStatus({
        missingInPromotedCount: missingInPromoted.length,
        extraInPromotedCount: extraInPromoted.length,
        fieldMismatchCount: fieldMismatch.length,
      }),
      mismatchCategories,
      sampleMissingInPromotedIds: limitIds(missingInPromoted),
      sampleExtraInPromotedIds: limitIds(extraInPromoted),
      sampleFieldMismatchIds: limitIds(fieldMismatch),
      notes: ["client_id (legacy) is compared against client_code (promoted compatibility field)."],
    };
  } catch (error: any) {
    if (isMissingCoreSchemaError(error)) {
      console.warn("[promoted-read-compat] core.clients missing, returning blocked status");
      return blockedDomainSummary("clients", "core.clients table does not exist");
    }
    throw error;
  }
}

export async function compareCorePortfoliosReadiness(): Promise<DomainComparisonSummary> {
  try {
    const [legacyRows, promotedRows] = await Promise.all([
      db.execute(sql`SELECT id, name, description FROM public.portfolios ORDER BY id`).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT id, name, description FROM core.portfolios ORDER BY id`).then((r: any) => r.rows ?? r),
    ]);

    const promotedById = new Map<number, any>(promotedRows.map((row: any) => [Number(row.id), row]));
    const legacyById = new Map<number, any>(legacyRows.map((row: any) => [Number(row.id), row]));
    const missingInPromoted: number[] = [];
    const fieldMismatch: number[] = [];

    for (const row of legacyRows) {
      const id = Number(row.id);
      const promoted = promotedById.get(id);
      if (!promoted) {
        missingInPromoted.push(id);
        continue;
      }

      const nameMismatch = (row.name ?? "") !== (promoted.name ?? "");
      const descriptionMismatch = (row.description ?? "") !== (promoted.description ?? "");
      if (nameMismatch || descriptionMismatch) fieldMismatch.push(id);
    }

    const extraInPromoted = promotedRows
      .map((row: any) => Number(row.id))
      .filter((id: number) => !legacyById.has(id));

    const mismatchCategories: string[] = [];
    if (missingInPromoted.length) mismatchCategories.push("missing_portfolio_rows");
    if (extraInPromoted.length) mismatchCategories.push("extra_promoted_portfolio_rows");
    if (fieldMismatch.length) mismatchCategories.push("portfolio_field_mismatch");

    return {
      domain: "portfolios",
      legacyCount: legacyRows.length,
      promotedCount: promotedRows.length,
      missingInPromotedCount: missingInPromoted.length,
      extraInPromotedCount: extraInPromoted.length,
      fieldMismatchCount: fieldMismatch.length,
      status: classifyStatus({
        missingInPromotedCount: missingInPromoted.length,
        extraInPromotedCount: extraInPromoted.length,
        fieldMismatchCount: fieldMismatch.length,
      }),
      mismatchCategories,
      sampleMissingInPromotedIds: limitIds(missingInPromoted),
      sampleExtraInPromotedIds: limitIds(extraInPromoted),
      sampleFieldMismatchIds: limitIds(fieldMismatch),
      notes: ["Portfolio core fields are compared; ownership metadata remains legacy-served in operational routes."],
    };
  } catch (error: any) {
    if (isMissingCoreSchemaError(error)) {
      console.warn("[promoted-read-compat] core.portfolios missing, returning blocked status");
      return blockedDomainSummary("portfolios", "core.portfolios table does not exist");
    }
    throw error;
  }
}

export async function compareCoreProjectPortfolioAssignmentsReadiness(): Promise<DomainComparisonSummary> {
  try {
    const [legacyRows, promotedRows] = await Promise.all([
      db.execute(sql`SELECT project_id, portfolio_id FROM public.project_portfolio_assignments ORDER BY project_id, portfolio_id`).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT project_id, portfolio_id FROM core.project_portfolio_assignments ORDER BY project_id, portfolio_id`).then((r: any) => r.rows ?? r),
    ]);

    const toKey = (row: any) => `${Number(row.project_id)}::${Number(row.portfolio_id)}`;
    const legacyKeys = new Set<string>(legacyRows.map(toKey));
    const promotedKeys = new Set<string>(promotedRows.map(toKey));

    const missingInPromoted = legacyRows.map(toKey).filter((key: any) => !promotedKeys.has(key));
    const extraInPromoted = promotedRows.map(toKey).filter((key: any) => !legacyKeys.has(key));

    return {
      domain: "project_portfolio_assignments",
      legacyCount: legacyRows.length,
      promotedCount: promotedRows.length,
      missingInPromotedCount: missingInPromoted.length,
      extraInPromotedCount: extraInPromoted.length,
      fieldMismatchCount: 0,
      status: classifyStatus({
        missingInPromotedCount: missingInPromoted.length,
        extraInPromotedCount: extraInPromoted.length,
        fieldMismatchCount: 0,
      }),
      mismatchCategories: [
        ...(missingInPromoted.length ? ["missing_assignment_links"] : []),
        ...(extraInPromoted.length ? ["extra_promoted_assignment_links"] : []),
      ],
      sampleMissingInPromotedIds: limitIds(missingInPromoted.map((key: any) => Number(key.split("::")[0]))),
      sampleExtraInPromotedIds: limitIds(extraInPromoted.map((key: any) => Number(key.split("::")[0]))),
      sampleFieldMismatchIds: [],
      notes: ["Assignment comparison is keyed by project_id + portfolio_id pairs."],
    };
  } catch (error: any) {
    if (isMissingCoreSchemaError(error)) {
      console.warn("[promoted-read-compat] core.project_portfolio_assignments missing, returning blocked status");
      return blockedDomainSummary("project_portfolio_assignments", "core.project_portfolio_assignments table does not exist");
    }
    throw error;
  }
}

export async function compareProjectWorkItemCountsReadiness(): Promise<DomainComparisonSummary> {
  try {
    const [legacyRows, promotedRows] = await Promise.all([
      db.execute(sql`
        SELECT project_id, COUNT(*)::INTEGER AS cnt
        FROM public.work_items
        WHERE deleted_at IS NULL
        GROUP BY project_id
        ORDER BY project_id
      `).then((r: any) => r.rows ?? r),
      db.execute(sql`
        SELECT project_id, COUNT(*)::INTEGER AS cnt
        FROM core.work_items
        WHERE source_table = 'public.work_items'
        GROUP BY project_id
        ORDER BY project_id
      `).then((r: any) => r.rows ?? r),
    ]);

    const promotedByProject = new Map<number, number>(promotedRows.map((row: any) => [Number(row.project_id), Number(row.cnt)]));
    const legacyByProject = new Map<number, number>(legacyRows.map((row: any) => [Number(row.project_id), Number(row.cnt)]));

    const allProjectIds = new Set<number>([...legacyByProject.keys(), ...promotedByProject.keys()]);
    const mismatches: number[] = [];

    for (const projectId of allProjectIds) {
      if ((legacyByProject.get(projectId) ?? 0) !== (promotedByProject.get(projectId) ?? 0)) {
        mismatches.push(projectId);
      }
    }

    return {
      domain: "work_item_counts",
      legacyCount: legacyRows.reduce((sum: number, row: any) => sum + Number(row.cnt), 0),
      promotedCount: promotedRows.reduce((sum: number, row: any) => sum + Number(row.cnt), 0),
      missingInPromotedCount: legacyRows.filter((row: any) => !promotedByProject.has(Number(row.project_id))).length,
      extraInPromotedCount: promotedRows.filter((row: any) => !legacyByProject.has(Number(row.project_id))).length,
      fieldMismatchCount: mismatches.length,
      status: classifyStatus({
        missingInPromotedCount: legacyRows.filter((row: any) => !promotedByProject.has(Number(row.project_id))).length,
        extraInPromotedCount: promotedRows.filter((row: any) => !legacyByProject.has(Number(row.project_id))).length,
        fieldMismatchCount: mismatches.length,
      }),
      mismatchCategories: mismatches.length ? ["work_item_count_delta_by_project"] : [],
      sampleMissingInPromotedIds: limitIds(
        legacyRows.filter((row: any) => !promotedByProject.has(Number(row.project_id))).map((row: any) => Number(row.project_id)),
      ),
      sampleExtraInPromotedIds: limitIds(
        promotedRows.filter((row: any) => !legacyByProject.has(Number(row.project_id))).map((row: any) => Number(row.project_id)),
      ),
      sampleFieldMismatchIds: limitIds(mismatches),
      notes: ["Work-item comparison is read-only reporting only; operational write paths remain legacy."],
    };
  } catch (error: any) {
    if (isMissingCoreSchemaError(error)) {
      console.warn("[promoted-read-compat] core.work_items missing, returning blocked status");
      return blockedDomainSummary("work_item_counts", "core.work_items table does not exist");
    }
    throw error;
  }
}

export async function getCoreMasterDataReadinessReport() {
  const [projects, clients, portfolios, assignments, workItemCounts, projectDetailMaster] = await Promise.all([
    compareCoreProjectsReadiness(),
    compareCoreClientsReadiness(),
    compareCorePortfoliosReadiness(),
    compareCoreProjectPortfolioAssignmentsReadiness(),
    compareProjectWorkItemCountsReadiness(),
    compareProjectDetailMasterReadiness(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    candidates: [projects, clients, portfolios, assignments, workItemCounts, projectDetailMaster],
  };
}

export async function listClientsFromPromotedCoreCompat() {
  try {
    const rows = await db.execute(sql`
      SELECT
        id,
        name,
        client_code AS "clientId",
        created_by AS "createdBy",
        updated_by AS "updatedBy",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM core.clients
      ORDER BY name ASC
    `).then((r: any) => r.rows ?? r);

    return rows;
  } catch (error: any) {
    if (isMissingCoreSchemaError(error)) {
      console.warn("[promoted-read-compat] core.clients missing, falling back to public.clients");
      const rows = await db.execute(sql`
        SELECT
          id,
          name,
          client_id AS "clientId",
          created_by AS "createdBy",
          updated_by AS "updatedBy",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM public.clients
        ORDER BY name ASC
      `).then((r: any) => r.rows ?? r);
      return rows;
    }
    throw error;
  }
}

export async function listProjectInfoFromPromotedCoreCompat() {
  try {
    const rows = await db.execute(sql`
      SELECT
        p.id,
        p.project_name AS "projectName",
        NULL::DECIMAL AS "sizeKwp",
        NULL::TEXT AS pd,
        NULL::TEXT AS pm,
        NULL::DECIMAL AS "contractValue",
        p.phase,
        NULL::TIMESTAMP AS "phaseUpdatedAt",
        NULL::INTEGER AS "phaseUpdatedByUserId",
        NULL::TEXT AS "phaseNotes",
        NULL::TEXT AS "pdHandoverDate",
        NULL::TEXT AS "constructionStartDate",
        NULL::TEXT AS "commissioningDate",
        NULL::TEXT AS "omHandoverDate",
        NULL::TEXT AS "clientHandoverDate",
        NULL::TEXT AS "escalationLevel",
        NULL::TEXT AS "constructionStartActual",
        NULL::TEXT AS "pdHandoverActual",
        NULL::TEXT AS "commissioningActual",
        NULL::TEXT AS "clientHandoverActual",
        p.rag_status AS "ragStatus",
        p.rag_comment AS "ragComment",
        NULL::TIMESTAMP AS "ragUpdatedAt",
        NULL::INTEGER AS "ragUpdatedByUserId",
        TRUE AS "isActive",
        FALSE AS "executionEnabled",
        p.execution_gate_status AS "executionGateStatus",
        p.execution_gate_reason AS "executionGateReason",
        'NONE'::TEXT AS "signedStatus",
        NULL::TEXT AS "signedDate",
        NULL::TEXT AS "signedDocumentLink",
        NULL::TEXT AS "executionPhase",
        NULL::TEXT AS "excelTrackerLink",
        NULL::INTEGER AS "canonicalProjectId",
        p.client_id AS "clientId",
        'ACTIVE'::TEXT AS "archivedStatus",
        NULL::INTEGER AS "pmUserId",
        NULL::INTEGER AS "pdUserId",
        p.updated_at AS "updatedAt"
      FROM core.projects p
      ORDER BY p.project_name ASC
    `).then((r: any) => r.rows ?? r);

    return rows;
  } catch (error: any) {
    if (isMissingCoreSchemaError(error)) {
      console.warn("[promoted-read-compat] core.projects missing, falling back to public.project_info");
      const { storage } = await import("../storage");
      return storage.getAllProjectInfo();
    }
    throw error;
  }
}


export async function compareProjectDetailMasterReadiness(): Promise<DomainComparisonSummary> {
  try {
    const [legacyRows, promotedRows, teamRows] = await Promise.all([
      db.execute(sql`SELECT id, project_name, client_id, phase, rag_status FROM public.project_info ORDER BY id`).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT id, project_name, client_id, phase, rag_status FROM core.projects ORDER BY id`).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT DISTINCT project_name FROM public.project_team_members`).then((r: any) => r.rows ?? r),
    ]);

    const promotedById = new Map<number, any>(promotedRows.map((row: any) => [Number(row.id), row]));
    const legacyById = new Map<number, any>(legacyRows.map((row: any) => [Number(row.id), row]));

    const missingInPromoted: number[] = [];
    const fieldMismatch: number[] = [];

    for (const row of legacyRows) {
      const id = Number(row.id);
      const promoted = promotedById.get(id);
      if (!promoted) {
        missingInPromoted.push(id);
        continue;
      }

      const mismatched =
        (row.project_name ?? "") !== (promoted.project_name ?? "") ||
        Number(row.client_id ?? 0) !== Number(promoted.client_id ?? 0) ||
        (row.phase ?? "") !== (promoted.phase ?? "") ||
        (row.rag_status ?? "") !== (promoted.rag_status ?? "");

      if (mismatched) fieldMismatch.push(id);
    }

    const extraInPromoted = promotedRows
      .map((row: any) => Number(row.id))
      .filter((id: number) => !legacyById.has(id));

    const teamProjectNames = new Set(teamRows.map((row: any) => String(row.project_name ?? "").trim().toLowerCase()).filter(Boolean));
    const legacyProjectNames = new Set(legacyRows.map((row: any) => String(row.project_name ?? "").trim().toLowerCase()).filter(Boolean));
    const orphanTeamProjects = [...teamProjectNames].filter((name) => !legacyProjectNames.has(name));

    const mismatchCategories: string[] = [];
    if (missingInPromoted.length) mismatchCategories.push("missing_project_detail_rows");
    if (extraInPromoted.length) mismatchCategories.push("extra_promoted_project_detail_rows");
    if (fieldMismatch.length) mismatchCategories.push("project_detail_master_field_mismatch");
    if (orphanTeamProjects.length) mismatchCategories.push("legacy_team_membership_orphans");

    return {
      domain: "project_detail_master",
      legacyCount: legacyRows.length,
      promotedCount: promotedRows.length,
      missingInPromotedCount: missingInPromoted.length,
      extraInPromotedCount: extraInPromoted.length,
      fieldMismatchCount: fieldMismatch.length,
      status: classifyStatus({
        missingInPromotedCount: missingInPromoted.length,
        extraInPromotedCount: extraInPromoted.length,
        fieldMismatchCount: fieldMismatch.length,
      }),
      mismatchCategories,
      sampleMissingInPromotedIds: limitIds(missingInPromoted),
      sampleExtraInPromotedIds: limitIds(extraInPromoted),
      sampleFieldMismatchIds: limitIds(fieldMismatch),
      notes: [
        "Project-detail parity compares identity/client/phase/rag status between public.project_info and core.projects.",
        `Team membership summary currently sourced from legacy project_team_members; orphaned project names observed: ${orphanTeamProjects.length}.`,
      ],
    };
  } catch (error: any) {
    if (isMissingCoreSchemaError(error)) {
      console.warn("[promoted-read-compat] core.projects missing for detail comparison, returning blocked status");
      return blockedDomainSummary("project_detail_master", "core.projects table does not exist");
    }
    throw error;
  }
}

export async function listProjectDetailFromPromotedCoreCompat(): Promise<ProjectDetailCompatRow[]> {
  try {
    const rows = await db.execute(sql`
      WITH team_members AS (
        SELECT
          pi.id AS project_id,
          COALESCE(
            json_agg(
              json_build_object(
                'userId', tm.user_id,
                'role', tm.role,
                'name', COALESCE(u.name, tm.user_name)
              )
              ORDER BY tm.id
            ) FILTER (WHERE tm.id IS NOT NULL),
            '[]'::json
          ) AS team_members
        FROM public.project_info pi
        LEFT JOIN public.project_team_members tm
          ON lower(trim(tm.project_name)) = lower(trim(pi.project_name))
        LEFT JOIN public.users u
          ON u.id = tm.user_id
        GROUP BY pi.id
      ), assignment_summary AS (
        SELECT
          ppa.project_id,
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'portfolioId', p.id,
                'portfolioName', p.name
              )
            ) FILTER (WHERE p.id IS NOT NULL),
            '[]'::jsonb
          ) AS portfolio_membership
        FROM core.project_portfolio_assignments ppa
        LEFT JOIN core.portfolios p ON p.id = ppa.portfolio_id
        GROUP BY ppa.project_id
      )
      SELECT
        p.id,
        p.project_name AS "projectName",
        p.phase,
        p.rag_status AS "ragStatus",
        p.rag_comment AS "ragComment",
        p.client_id AS "clientId",
        c.name AS "clientName",
        COALESCE(a.portfolio_membership, '[]'::jsonb) AS "portfolioMembership",
        COALESCE(t.team_members, '[]'::json) AS "teamMembers"
      FROM core.projects p
      LEFT JOIN core.clients c ON c.id = p.client_id
      LEFT JOIN assignment_summary a ON a.project_id = p.id
      LEFT JOIN team_members t ON t.project_id = p.id
      ORDER BY p.project_name ASC
    `).then((r: any) => r.rows ?? r);

    return rows.map((row: any) => ({
      ...row,
      id: Number(row.id),
      clientId: row.clientId == null ? null : Number(row.clientId),
      portfolioMembership: Array.isArray(row.portfolioMembership) ? row.portfolioMembership : JSON.parse(row.portfolioMembership || '[]'),
      teamMembers: Array.isArray(row.teamMembers) ? row.teamMembers : JSON.parse(row.teamMembers || '[]'),
    }));
  } catch (error: any) {
    if (isMissingCoreSchemaError(error)) {
      console.warn("[promoted-read-compat] core schema tables missing for project detail, falling back to public.project_info");
      const { storage } = await import("../storage");
      const allInfo = await storage.getAllProjectInfo();
      return allInfo.map((row: any) => ({
        id: row.id,
        projectName: row.projectName,
        phase: row.phase ?? null,
        ragStatus: row.ragStatus ?? null,
        ragComment: row.ragComment ?? null,
        clientId: row.clientId ?? null,
        clientName: null,
        portfolioMembership: [],
        teamMembers: [],
      }));
    }
    throw error;
  }
}

export async function buildWorkItemSummaryDiagnostics(limitProjects = 200): Promise<WorkItemSummaryDiagnostics> {
  let promotedRows: any[] = [];
  const [legacyRows, projectRows] = await Promise.all([
    db.execute(sql`SELECT id, project_id, status, owner, phase FROM public.work_items WHERE deleted_at IS NULL`).then((r: any) => r.rows ?? r),
    db.execute(sql`SELECT id, project_name FROM public.project_info`).then((r: any) => r.rows ?? r),
  ]);
  try {
    promotedRows = await db.execute(sql`SELECT id, project_id, status, owner_user_id, source_domain FROM core.work_items WHERE source_table = 'public.work_items'`).then((r: any) => r.rows ?? r);
  } catch (error: any) {
    if (isMissingCoreSchemaError(error)) {
      console.warn("[promoted-read-compat] core.work_items missing, returning diagnostics with empty promoted data");
    } else {
      throw error;
    }
  }

  const projectNameMap = new Map<number, string>(projectRows.map((row: any) => [Number(row.id), row.project_name]));

  const initBucket = () => ({
    legacyCount: 0,
    promotedCount: 0,
    legacyStatusDistribution: {} as Record<string, number>,
    promotedStatusDistribution: {} as Record<string, number>,
    legacyOwnerDistribution: {} as Record<string, number>,
    promotedOwnerDistribution: {} as Record<string, number>,
    legacyWorkstreamDistribution: {} as Record<string, number>,
    promotedWorkstreamDistribution: {} as Record<string, number>,
  });

  const byProject = new Map<number, ReturnType<typeof initBucket>>();
  const ensure = (projectId: number) => {
    if (!byProject.has(projectId)) byProject.set(projectId, initBucket());
    return byProject.get(projectId)!;
  };

  for (const row of legacyRows) {
    const projectId = Number(row.project_id ?? 0);
    if (!projectId) continue;
    const bucket = ensure(projectId);
    bucket.legacyCount += 1;
    const status = String(row.status ?? "unknown");
    bucket.legacyStatusDistribution[status] = (bucket.legacyStatusDistribution[status] ?? 0) + 1;
    const owner = String(row.owner ?? "unassigned");
    bucket.legacyOwnerDistribution[owner] = (bucket.legacyOwnerDistribution[owner] ?? 0) + 1;
    const workstream = String(row.phase ?? "unspecified");
    bucket.legacyWorkstreamDistribution[workstream] = (bucket.legacyWorkstreamDistribution[workstream] ?? 0) + 1;
  }

  for (const row of promotedRows) {
    const projectId = Number(row.project_id ?? 0);
    if (!projectId) continue;
    const bucket = ensure(projectId);
    bucket.promotedCount += 1;
    const status = String(row.status ?? "unknown");
    bucket.promotedStatusDistribution[status] = (bucket.promotedStatusDistribution[status] ?? 0) + 1;
    const owner = String(row.owner_user_id ?? "unassigned");
    bucket.promotedOwnerDistribution[owner] = (bucket.promotedOwnerDistribution[owner] ?? 0) + 1;
    const workstream = String(row.source_domain ?? "unspecified");
    bucket.promotedWorkstreamDistribution[workstream] = (bucket.promotedWorkstreamDistribution[workstream] ?? 0) + 1;
  }

  const projectEntries = [...byProject.entries()].map(([projectId, bucket]) => {
    const mismatchCategories: string[] = [];
    if (bucket.legacyCount !== bucket.promotedCount) mismatchCategories.push("count_delta");
    if (JSON.stringify(bucket.legacyStatusDistribution) !== JSON.stringify(bucket.promotedStatusDistribution)) mismatchCategories.push("status_distribution_delta");
    if (JSON.stringify(bucket.legacyOwnerDistribution) !== JSON.stringify(bucket.promotedOwnerDistribution)) mismatchCategories.push("owner_distribution_delta");
    if (JSON.stringify(bucket.legacyWorkstreamDistribution) !== JSON.stringify(bucket.promotedWorkstreamDistribution)) mismatchCategories.push("workstream_distribution_delta");

    return {
      projectId,
      projectName: projectNameMap.get(projectId) ?? null,
      legacyCount: bucket.legacyCount,
      promotedCount: bucket.promotedCount,
      deltaCount: bucket.legacyCount - bucket.promotedCount,
      legacyStatusDistribution: bucket.legacyStatusDistribution,
      promotedStatusDistribution: bucket.promotedStatusDistribution,
      legacyOwnerDistribution: bucket.legacyOwnerDistribution,
      promotedOwnerDistribution: bucket.promotedOwnerDistribution,
      legacyWorkstreamDistribution: bucket.legacyWorkstreamDistribution,
      promotedWorkstreamDistribution: bucket.promotedWorkstreamDistribution,
      mismatchCategories,
    };
  }).sort((a, b) => Math.abs(b.deltaCount) - Math.abs(a.deltaCount));

  const mismatched = projectEntries.filter((entry) => entry.mismatchCategories.length > 0);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      legacyCount: legacyRows.length,
      promotedCount: promotedRows.length,
      projectMismatchCount: mismatched.length,
    },
    mismatchCategories: Array.from(new Set(mismatched.flatMap((entry) => entry.mismatchCategories))),
    sampleProjectIds: mismatched.slice(0, 20).map((entry) => entry.projectId),
    byProject: projectEntries.slice(0, limitProjects),
  };
}

export async function compareImportsGovernanceReadiness(): Promise<DomainComparisonSummary> {
  try {
    const [pendingRequestsRows, unresolvedAckRows, openConflictsRows] = await Promise.all([
      db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM imports.source_update_requests WHERE status IN ('pending', 'open')`).then((r: any) => r.rows ?? r),
      db.execute(sql`
        SELECT COUNT(*)::INTEGER AS cnt
        FROM imports.v_source_update_ack_gaps g
        WHERE CARDINALITY(g.missing_roles) > 0
      `).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM imports.data_conflicts WHERE status = 'open'`).then((r: any) => r.rows ?? r),
    ]);

    const pendingRequests = Number(pendingRequestsRows[0]?.cnt ?? 0);
    const unresolvedAcknowledgements = unresolvedAckRows.reduce((sum: number, row: any) => sum + Number(row.cnt ?? 0), 0);
    const openConflicts = Number(openConflictsRows[0]?.cnt ?? 0);

    const mismatchCategories: string[] = [];
    if (pendingRequests > 0) mismatchCategories.push('pending_source_update_requests');
    if (unresolvedAcknowledgements > 0) mismatchCategories.push('acknowledgement_gaps');
    if (openConflicts > 0) mismatchCategories.push('open_import_conflicts');

    return {
      domain: 'imports_governance',
      legacyCount: 0,
      promotedCount: pendingRequests + unresolvedAcknowledgements + openConflicts,
      missingInPromotedCount: 0,
      extraInPromotedCount: 0,
      fieldMismatchCount: pendingRequests + unresolvedAcknowledgements + openConflicts,
      status: pendingRequests === 0 && unresolvedAcknowledgements === 0 && openConflicts === 0 ? 'ready' : (openConflicts > 0 ? 'blocked' : 'partial'),
      mismatchCategories,
      sampleMissingInPromotedIds: [],
      sampleExtraInPromotedIds: [],
      sampleFieldMismatchIds: [],
      notes: [
        'Imports governance preview is non-blocking in this phase; counts are diagnostic only.',
        `Pending requests: ${pendingRequests}, unresolved ack gaps: ${unresolvedAcknowledgements}, open conflicts: ${openConflicts}.`,
      ],
    };
  } catch (error: any) {
    if (isMissingCoreSchemaError(error)) {
      console.warn("[promoted-read-compat] imports schema missing, returning blocked status");
      return blockedDomainSummary("imports_governance", "imports schema tables do not exist");
    }
    throw error;
  }
}

export async function buildPhase1AReconciliationReport(): Promise<Phase1AReconciliationReport> {
  const checks: Phase1ADiagnosticSummary[] = [];
  const projectReadiness = await compareCoreProjectsReadiness();
  checks.push({
    domain: "project_reads",
    status: projectReadiness.status,
    legacyCount: projectReadiness.legacyCount,
    promotedCount: projectReadiness.promotedCount,
    deltaCount: projectReadiness.legacyCount - projectReadiness.promotedCount,
    mismatchCategories: projectReadiness.mismatchCategories,
    notes: projectReadiness.notes,
  });

  try {
    const [legacyRows, promotedRows] = await Promise.all([
      db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM public.project_execution_state`).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM core.projects WHERE execution_gate_status IS NOT NULL`).then((r: any) => r.rows ?? r),
    ]);
    const legacyCount = Number(legacyRows[0]?.cnt ?? 0);
    const promotedCount = Number(promotedRows[0]?.cnt ?? 0);
    checks.push({
      domain: "lifecycle_gates",
      status: legacyCount === promotedCount ? "ready" : (promotedCount === 0 ? "blocked" : "partial"),
      legacyCount,
      promotedCount,
      deltaCount: legacyCount - promotedCount,
      mismatchCategories: legacyCount === promotedCount ? [] : ["execution_gate_count_delta"],
      notes: ["Lifecycle/gates check compares legacy project_execution_state with promoted core.projects execution gate columns."],
    });
  } catch (error: any) {
    checks.push({
      domain: "lifecycle_gates",
      status: "blocked",
      legacyCount: 0,
      promotedCount: 0,
      deltaCount: 0,
      mismatchCategories: ["lifecycle_gate_check_unavailable"],
      notes: [isMissingCoreSchemaError(error) ? "Required lifecycle/gate promoted schema objects are missing." : `Lifecycle/gate check failed: ${String(error?.message || "unknown_error")}`],
    });
  }

  try {
    const [legacyRows, promotedRows] = await Promise.all([
      db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM public.approvals WHERE COALESCE(deleted_at, NULL) IS NULL`).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM documentation.document_approvals`).then((r: any) => r.rows ?? r),
    ]);
    const legacyCount = Number(legacyRows[0]?.cnt ?? 0);
    const promotedCount = Number(promotedRows[0]?.cnt ?? 0);
    checks.push({
      domain: "approvals",
      status: legacyCount === promotedCount ? "ready" : "partial",
      legacyCount,
      promotedCount,
      deltaCount: legacyCount - promotedCount,
      mismatchCategories: legacyCount === promotedCount ? [] : ["approval_count_delta"],
      notes: ["Approvals diagnostics are summary-only and do not emit approval payload details."],
    });
  } catch (error: any) {
    checks.push({
      domain: "approvals",
      status: "blocked",
      legacyCount: 0,
      promotedCount: 0,
      deltaCount: 0,
      mismatchCategories: ["approvals_check_unavailable"],
      notes: [isMissingCoreSchemaError(error) ? "Required approvals promoted schema objects are missing." : `Approvals check failed: ${String(error?.message || "unknown_error")}`],
    });
  }

  try {
    const [legacyRevenueRows, legacyCostRows, promotedRevenueRows, promotedCostRows] = await Promise.all([
      db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM public.program_inflows`).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM public.program_expense`).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM finance.revenue_lines`).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM finance.cost_lines`).then((r: any) => r.rows ?? r),
    ]);
    const legacyCount = Number(legacyRevenueRows[0]?.cnt ?? 0) + Number(legacyCostRows[0]?.cnt ?? 0);
    const promotedCount = Number(promotedRevenueRows[0]?.cnt ?? 0) + Number(promotedCostRows[0]?.cnt ?? 0);
    checks.push({
      domain: "finance",
      status: legacyCount === promotedCount ? "ready" : "partial",
      legacyCount,
      promotedCount,
      deltaCount: legacyCount - promotedCount,
      mismatchCategories: legacyCount === promotedCount ? [] : ["finance_line_count_delta"],
      notes: ["Finance diagnostics summarize line-count parity only (program_* vs finance.*)."],
    });
  } catch (error: any) {
    checks.push({
      domain: "finance",
      status: "blocked",
      legacyCount: 0,
      promotedCount: 0,
      deltaCount: 0,
      mismatchCategories: ["finance_check_unavailable"],
      notes: [isMissingCoreSchemaError(error) ? "Required finance promoted schema objects are missing." : `Finance check failed: ${String(error?.message || "unknown_error")}`],
    });
  }

  try {
    const [legacyRows, promotedRows] = await Promise.all([
      db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM public.deliverables`).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM documentation.documents`).then((r: any) => r.rows ?? r),
    ]);
    const legacyCount = Number(legacyRows[0]?.cnt ?? 0);
    const promotedCount = Number(promotedRows[0]?.cnt ?? 0);
    checks.push({
      domain: "deliverables",
      status: legacyCount === promotedCount ? "ready" : "partial",
      legacyCount,
      promotedCount,
      deltaCount: legacyCount - promotedCount,
      mismatchCategories: legacyCount === promotedCount ? [] : ["deliverable_document_count_delta"],
      notes: ["Deliverables diagnostics summarize parity between public.deliverables and documentation.documents."],
    });
  } catch (error: any) {
    checks.push({
      domain: "deliverables",
      status: "blocked",
      legacyCount: 0,
      promotedCount: 0,
      deltaCount: 0,
      mismatchCategories: ["deliverables_check_unavailable"],
      notes: [isMissingCoreSchemaError(error) ? "Required deliverables promoted schema objects are missing." : `Deliverables check failed: ${String(error?.message || "unknown_error")}`],
    });
  }

  try {
    const [legacyCounterpartyRows, legacyClientContactRows, promotedFinanceCounterpartyRows, promotedClientRows] = await Promise.all([
      db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM public.counterparties`).then((r: any) => r.rows ?? r),
      db.execute(sql`
        SELECT COUNT(*)::INTEGER AS cnt
        FROM public.clients
        WHERE COALESCE(primary_contact_name, primary_contact_email, primary_contact_phone, secondary_contact_name, secondary_contact_email, secondary_contact_phone) IS NOT NULL
      `).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT COUNT(DISTINCT COALESCE(counterparty_name, ''))::INTEGER AS cnt FROM finance.cost_lines`).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM core.clients`).then((r: any) => r.rows ?? r),
    ]);
    const legacyCount = Number(legacyCounterpartyRows[0]?.cnt ?? 0) + Number(legacyClientContactRows[0]?.cnt ?? 0);
    const promotedCount = Number(promotedFinanceCounterpartyRows[0]?.cnt ?? 0) + Number(promotedClientRows[0]?.cnt ?? 0);
    checks.push({
      domain: "party_contacts",
      status: legacyCount === promotedCount ? "ready" : "partial",
      legacyCount,
      promotedCount,
      deltaCount: legacyCount - promotedCount,
      mismatchCategories: legacyCount === promotedCount ? [] : ["party_contact_count_delta"],
      notes: ["Party/contact diagnostics summarize counterparties and contact-bearing client rows without payload detail logging."],
    });
  } catch (error: any) {
    checks.push({
      domain: "party_contacts",
      status: "blocked",
      legacyCount: 0,
      promotedCount: 0,
      deltaCount: 0,
      mismatchCategories: ["party_contact_check_unavailable"],
      notes: [isMissingCoreSchemaError(error) ? "Required party/contact promoted schema objects are missing." : `Party/contact check failed: ${String(error?.message || "unknown_error")}`],
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    checks,
  };
}
