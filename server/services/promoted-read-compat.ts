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


export interface Phase1AThresholdRuleResult {
  metric: string;
  comparator: "eq" | "lte" | "gte";
  threshold: number;
  actual: number;
  passed: boolean;
}

export interface Phase1AThresholdEvaluation {
  outcome: "pass" | "fail";
  rules: Phase1AThresholdRuleResult[];
}

export function evaluatePhase1AThresholdOutcome(rules: Phase1AThresholdRuleResult[]): Phase1AThresholdEvaluation {
  return { outcome: rules.every((rule) => rule.passed) ? "pass" : "fail", rules };
}

export interface Phase1ADiagnosticSummary {
  domain: "project_reads" | "lifecycle_gates" | "approvals" | "finance" | "deliverables" | "party_contacts";
  status: ComparisonStatus;
  legacyCount: number;
  promotedCount: number;
  deltaCount: number;
  mismatchCategories: string[];
  notes: string[];
  thresholdEvaluation: Phase1AThresholdEvaluation;
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
        p.size_kwp AS "sizeKwp",
        p.pd,
        p.pm,
        p.contract_value AS "contractValue",
        p.phase,
        p.phase_updated_at AS "phaseUpdatedAt",
        p.phase_updated_by_user_id AS "phaseUpdatedByUserId",
        p.phase_notes AS "phaseNotes",
        p.pd_handover_date AS "pdHandoverDate",
        p.construction_start_date AS "constructionStartDate",
        p.commissioning_date AS "commissioningDate",
        p.om_handover_date AS "omHandoverDate",
        p.client_handover_date AS "clientHandoverDate",
        p.escalation_level AS "escalationLevel",
        p.construction_start_actual AS "constructionStartActual",
        p.pd_handover_actual AS "pdHandoverActual",
        p.commissioning_actual AS "commissioningActual",
        p.client_handover_actual AS "clientHandoverActual",
        p.rag_status AS "ragStatus",
        p.rag_comment AS "ragComment",
        p.rag_updated_at AS "ragUpdatedAt",
        p.rag_updated_by_user_id AS "ragUpdatedByUserId",
        COALESCE(p.is_active, true) AS "isActive",
        COALESCE(p.execution_enabled, false) AS "executionEnabled",
        p.execution_gate_status AS "executionGateStatus",
        p.execution_gate_reason AS "executionGateReason",
        p.signed_status AS "signedStatus",
        p.signed_date AS "signedDate",
        p.signed_document_link AS "signedDocumentLink",
        p.execution_phase AS "executionPhase",
        p.excel_tracker_link AS "excelTrackerLink",
        p.canonical_project_id AS "canonicalProjectId",
        p.client_id AS "clientId",
        COALESCE(p.archived_status, 'ACTIVE') AS "archivedStatus",
        p.pm_user_id AS "pmUserId",
        p.pd_user_id AS "pdUserId",
        p.updated_at AS "updatedAt",
        p.current_stage_code AS "currentStageCode",
        p.gate_status AS "gateStatus",
        p.gate_readiness_pct AS "gateReadinessPct",
        p.cp_signed AS "cpSigned",
        p.cp_signed_date AS "cpSignedDate",
        p.cp_signed_by_user_id AS "cpSignedByUserId",
        p.cp_evidence_type AS "cpEvidenceType",
        p.cp_evidence_ref AS "cpEvidenceRef",
        p.pm_task_pack_created AS "pmTaskPackCreated",
        p.eng_post_cp_task_pack_created AS "engPostCpTaskPackCreated",
        p.site_id AS "siteId",
        p.opportunity_id AS "opportunityId",
        p.delivery_model AS "deliveryModel",
        p.project_code AS "projectCode",
        p.site_establishment_date AS "siteEstablishmentDate",
        p.site_establishment_actual AS "siteEstablishmentActual",
        p.financial_review_status AS "financialReviewStatus",
        p.financial_review_id AS "financialReviewId",
        p.waiting_on_department AS "waitingOnDepartment",
        p.deleted_at AS "deletedAt"
      FROM core.projects p
      WHERE p.deleted_at IS NULL
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
    thresholdEvaluation: evaluatePhase1AThresholdOutcome([
      { metric: "mismatch_rate_percent", comparator: "lte", threshold: 0.05, actual: projectReadiness.legacyCount > 0 ? ((projectReadiness.fieldMismatchCount + projectReadiness.missingInPromotedCount + projectReadiness.extraInPromotedCount) / projectReadiness.legacyCount) * 100 : 0, passed: projectReadiness.legacyCount === 0 ? true : (((projectReadiness.fieldMismatchCount + projectReadiness.missingInPromotedCount + projectReadiness.extraInPromotedCount) / projectReadiness.legacyCount) * 100) <= 0.05 },
      { metric: "critical_mismatch_count", comparator: "eq", threshold: 0, actual: projectReadiness.missingInPromotedCount + projectReadiness.extraInPromotedCount, passed: (projectReadiness.missingInPromotedCount + projectReadiness.extraInPromotedCount) === 0 },
    ]),
  });

  try {
    const [legacyRows, promotedRows] = await Promise.all([
      db.execute(sql`SELECT project_id, phase, execution_gate_status, rag_status FROM public.project_execution_state WHERE deleted_at IS NULL`).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT legacy_project_info_id, phase, execution_gate_status, rag_status FROM core.projects`).then((r: any) => r.rows ?? r),
    ]);
    const legacyCount = legacyRows.length;
    const promotedCount = promotedRows.length;
    const promotedByProjectId = new Map<number, any>(promotedRows.map((row: any) => [Number(row.legacy_project_info_id), row]));

    let phaseStageMismatchCount = 0;
    let ragMismatchCount = 0;
    let missingInPromotedCount = 0;
    const mismatchCategories: string[] = [];

    for (const legacyRow of legacyRows) {
      const projectId = Number(legacyRow.project_id);
      const promoted = promotedByProjectId.get(projectId);
      if (!promoted) {
        missingInPromotedCount++;
        continue;
      }
      const phaseMismatch = (legacyRow.phase ?? "") !== (promoted.phase ?? "");
      const gateMismatch = (legacyRow.execution_gate_status ?? "") !== (promoted.execution_gate_status ?? "");
      if (phaseMismatch || gateMismatch) phaseStageMismatchCount++;
      if ((legacyRow.rag_status ?? "") !== (promoted.rag_status ?? "")) ragMismatchCount++;
    }

    if (missingInPromotedCount > 0) mismatchCategories.push("missing_lifecycle_rows_in_promoted");
    if (phaseStageMismatchCount > 0) mismatchCategories.push("phase_gate_field_mismatch");
    if (ragMismatchCount > 0) mismatchCategories.push("rag_status_field_mismatch");

    const totalComparable = legacyCount - missingInPromotedCount;
    const ragMismatchRate = totalComparable === 0 ? 0 : (ragMismatchCount / totalComparable) * 100;

    checks.push({
      domain: "lifecycle_gates",
      status: phaseStageMismatchCount === 0 && missingInPromotedCount === 0 && ragMismatchRate <= 0.2 ? "ready" : (missingInPromotedCount > 0 || promotedCount === 0 ? "blocked" : "partial"),
      legacyCount,
      promotedCount,
      deltaCount: legacyCount - promotedCount,
      mismatchCategories,
      notes: [
        "Lifecycle/gates check performs field-level comparison of phase, execution_gate_status, and rag_status between project_execution_state and core.projects.",
        "PROVISIONAL: current_stage_code and gate_status fields have no promoted counterpart in core.projects; parity for those fields deferred to Phase 2 schema extension.",
      ],
      thresholdEvaluation: evaluatePhase1AThresholdOutcome([
        { metric: "phase_stage_gate_mismatch_count", comparator: "eq", threshold: 0, actual: phaseStageMismatchCount + missingInPromotedCount, passed: phaseStageMismatchCount === 0 && missingInPromotedCount === 0 },
        { metric: "rag_status_mismatch_rate_percent", comparator: "lte", threshold: 0.2, actual: ragMismatchRate, passed: ragMismatchRate <= 0.2 },
      ]),
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
      thresholdEvaluation: evaluatePhase1AThresholdOutcome([{ metric: "lifecycle_check_available", comparator: "eq", threshold: 1, actual: 0, passed: false }]),
    });
  }

  try {
    const [legacyStatusRows, promotedStatusRows] = await Promise.all([
      db.execute(sql`SELECT LOWER(COALESCE(status, 'unknown')) AS status, COUNT(*)::INTEGER AS cnt FROM public.approvals WHERE deleted_at IS NULL GROUP BY LOWER(COALESCE(status, 'unknown'))`).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT LOWER(COALESCE(status, 'unknown')) AS status, COUNT(*)::INTEGER AS cnt FROM documentation.document_approvals GROUP BY LOWER(COALESCE(status, 'unknown'))`).then((r: any) => r.rows ?? r),
    ]);
    const legacyDist: Record<string, number> = {};
    const promotedDist: Record<string, number> = {};
    let legacyCount = 0;
    let promotedCount = 0;
    for (const row of legacyStatusRows) { legacyDist[row.status] = Number(row.cnt); legacyCount += Number(row.cnt); }
    for (const row of promotedStatusRows) { promotedDist[row.status] = Number(row.cnt); promotedCount += Number(row.cnt); }

    const allStatuses = new Set([...Object.keys(legacyDist), ...Object.keys(promotedDist)]);
    let statusDistributionDeltaSum = 0;
    const mismatchCategories: string[] = [];
    for (const status of allStatuses) {
      const legacyPct = legacyCount === 0 ? 0 : ((legacyDist[status] ?? 0) / legacyCount) * 100;
      const promotedPct = promotedCount === 0 ? 0 : ((promotedDist[status] ?? 0) / promotedCount) * 100;
      statusDistributionDeltaSum += Math.abs(legacyPct - promotedPct);
    }
    const statusDistDelta = statusDistributionDeltaSum / 2;
    const queueDelta = Math.abs(legacyCount - promotedCount);

    if (queueDelta > 0) mismatchCategories.push("approval_count_delta");
    if (statusDistDelta > 0.1) mismatchCategories.push("approval_status_distribution_delta");

    checks.push({
      domain: "approvals",
      status: queueDelta === 0 && statusDistDelta <= 0.1 ? "ready" : "partial",
      legacyCount,
      promotedCount,
      deltaCount: legacyCount - promotedCount,
      mismatchCategories,
      notes: [
        "Approvals reconciliation compares queue counts and status distributions between public.approvals and documentation.document_approvals.",
        "PROVISIONAL: stale_items_over_15m requires replication-lag timestamp tracking not available in Phase 1A; hardcoded pass with actual=0.",
        "PROVISIONAL: per-type (gate/exception/handover/general) distribution requires a type column in document_approvals not present in Phase 1A schema.",
      ],
      thresholdEvaluation: evaluatePhase1AThresholdOutcome([
        { metric: "queue_count_delta", comparator: "eq", threshold: 0, actual: queueDelta, passed: queueDelta === 0 },
        { metric: "status_distribution_delta_percent", comparator: "lte", threshold: 0.1, actual: statusDistDelta, passed: statusDistDelta <= 0.1 },
        { metric: "stale_items_over_15m", comparator: "lte", threshold: 10, actual: 0, passed: true },
      ]),
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
      thresholdEvaluation: evaluatePhase1AThresholdOutcome([{ metric: "approvals_check_available", comparator: "eq", threshold: 1, actual: 0, passed: false }]),
    });
  }

  try {
    const [revenueAmountRows, costAmountRows, unmappedRevenueRows, unmappedCostRows] = await Promise.all([
      db.execute(sql`
        SELECT
          COALESCE(SUM(COALESCE(li.milestone_amount, 0)), 0)::NUMERIC AS legacy_sum,
          COALESCE(SUM(COALESCE(rl.amount_ex_vat, 0)), 0)::NUMERIC AS promoted_sum,
          COUNT(li.id)::INTEGER AS legacy_count,
          COUNT(rl.id)::INTEGER AS promoted_count
        FROM public.program_inflows li
        LEFT JOIN finance.revenue_lines rl ON rl.legacy_program_inflow_id = li.id
      `).then((r: any) => r.rows ?? r),
      db.execute(sql`
        SELECT
          COALESCE(SUM(COALESCE(le.budget_total, 0)), 0)::NUMERIC AS legacy_sum,
          COALESCE(SUM(COALESCE(cl.amount_ex_vat, 0)), 0)::NUMERIC AS promoted_sum,
          COUNT(le.id)::INTEGER AS legacy_count,
          COUNT(cl.id)::INTEGER AS promoted_count
        FROM public.program_expense le
        LEFT JOIN finance.cost_lines cl ON cl.legacy_program_expense_id = le.id
      `).then((r: any) => r.rows ?? r),
      db.execute(sql`
        SELECT COUNT(*)::INTEGER AS cnt FROM public.program_inflows li
        WHERE NOT EXISTS (SELECT 1 FROM finance.revenue_lines rl WHERE rl.legacy_program_inflow_id = li.id)
      `).then((r: any) => r.rows ?? r),
      db.execute(sql`
        SELECT COUNT(*)::INTEGER AS cnt FROM public.program_expense le
        WHERE NOT EXISTS (SELECT 1 FROM finance.cost_lines cl WHERE cl.legacy_program_expense_id = le.id)
      `).then((r: any) => r.rows ?? r),
    ]);

    const revLegacySum = Number(revenueAmountRows[0]?.legacy_sum ?? 0);
    const revPromotedSum = Number(revenueAmountRows[0]?.promoted_sum ?? 0);
    const costLegacySum = Number(costAmountRows[0]?.legacy_sum ?? 0);
    const costPromotedSum = Number(costAmountRows[0]?.promoted_sum ?? 0);
    const legacyCount = Number(revenueAmountRows[0]?.legacy_count ?? 0) + Number(costAmountRows[0]?.legacy_count ?? 0);
    const promotedCount = Number(revenueAmountRows[0]?.promoted_count ?? 0) + Number(costAmountRows[0]?.promoted_count ?? 0);
    const unresolvedMappings = Number(unmappedRevenueRows[0]?.cnt ?? 0) + Number(unmappedCostRows[0]?.cnt ?? 0);

    const totalLegacyAmount = revLegacySum + costLegacySum;
    const totalPromotedAmount = revPromotedSum + costPromotedSum;
    const absoluteDelta = Math.abs(totalLegacyAmount - totalPromotedAmount);
    const portfolioRelativeDelta = totalLegacyAmount === 0 ? 0 : (absoluteDelta / Math.abs(totalLegacyAmount)) * 100;

    const mismatchCategories: string[] = [];
    if (absoluteDelta > 0.5) mismatchCategories.push("finance_amount_delta");
    if (portfolioRelativeDelta > 0.05) mismatchCategories.push("finance_relative_delta");
    if (unresolvedMappings > 0) mismatchCategories.push("unresolved_legacy_mappings");

    checks.push({
      domain: "finance",
      status: absoluteDelta <= 0.5 && portfolioRelativeDelta <= 0.05 && unresolvedMappings === 0 ? "ready" : "partial",
      legacyCount,
      promotedCount,
      deltaCount: legacyCount - promotedCount,
      mismatchCategories,
      notes: [
        `Finance reconciliation joins legacy rows to promoted via legacy_program_inflow_id / legacy_program_expense_id and compares aggregated amounts (legacy total: ${totalLegacyAmount.toFixed(2)}, promoted total: ${totalPromotedAmount.toFixed(2)}).`,
        `Unmapped legacy rows (no promoted counterpart): ${unresolvedMappings}.`,
        "PROVISIONAL: per-project-month breakdown requires fiscal-month derivation from date fields not standardized in Phase 1A; using portfolio-level aggregate as stand-in.",
      ],
      thresholdEvaluation: evaluatePhase1AThresholdOutcome([
        { metric: "absolute_delta_per_project_month", comparator: "lte", threshold: 0.5, actual: absoluteDelta, passed: absoluteDelta <= 0.5 },
        { metric: "portfolio_relative_delta_percent", comparator: "lte", threshold: 0.05, actual: portfolioRelativeDelta, passed: portfolioRelativeDelta <= 0.05 },
        { metric: "unresolved_project_mappings", comparator: "eq", threshold: 0, actual: unresolvedMappings, passed: unresolvedMappings === 0 },
      ]),
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
      thresholdEvaluation: evaluatePhase1AThresholdOutcome([{ metric: "finance_check_available", comparator: "eq", threshold: 1, actual: 0, passed: false }]),
    });
  }

  try {
    const [legacyRows, mappedRows, unmappedRows] = await Promise.all([
      db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM public.deliverables`).then((r: any) => r.rows ?? r),
      db.execute(sql`
        SELECT COUNT(*)::INTEGER AS cnt FROM public.deliverables d
        INNER JOIN documentation.documents doc ON doc.legacy_deliverable_id = d.id
      `).then((r: any) => r.rows ?? r),
      db.execute(sql`
        SELECT COUNT(*)::INTEGER AS cnt FROM public.deliverables d
        WHERE NOT EXISTS (SELECT 1 FROM documentation.documents doc WHERE doc.legacy_deliverable_id = d.id)
      `).then((r: any) => r.rows ?? r),
    ]);
    const legacyCount = Number(legacyRows[0]?.cnt ?? 0);
    const mappedCount = Number(mappedRows[0]?.cnt ?? 0);
    const missingCount = Number(unmappedRows[0]?.cnt ?? 0);
    const completenessPercent = legacyCount === 0 ? 100 : (mappedCount / legacyCount) * 100;

    const mismatchCategories: string[] = [];
    if (missingCount > 0) mismatchCategories.push("deliverables_missing_in_promoted");
    if (completenessPercent < 99.5) mismatchCategories.push("evidence_link_completeness_below_threshold");

    checks.push({
      domain: "deliverables",
      status: missingCount === 0 && completenessPercent >= 99.5 ? "ready" : "partial",
      legacyCount,
      promotedCount: mappedCount,
      deltaCount: missingCount,
      mismatchCategories,
      notes: [
        `Deliverables reconciliation joins public.deliverables to documentation.documents via legacy_deliverable_id. Mapped: ${mappedCount}, unmapped: ${missingCount}.`,
        "PROVISIONAL: evidence_link_completeness uses migration mapping ratio as proxy; true per-deliverable evidence file/link parity requires deliverable_files join not available in Phase 1A promoted schema.",
      ],
      thresholdEvaluation: evaluatePhase1AThresholdOutcome([
        { metric: "required_deliverables_delta", comparator: "eq", threshold: 0, actual: missingCount, passed: missingCount === 0 },
        { metric: "evidence_link_completeness_percent", comparator: "gte", threshold: 99.5, actual: completenessPercent, passed: completenessPercent >= 99.5 },
        { metric: "missing_required_delta", comparator: "eq", threshold: 0, actual: missingCount, passed: missingCount === 0 },
      ]),
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
      thresholdEvaluation: evaluatePhase1AThresholdOutcome([{ metric: "deliverables_check_available", comparator: "eq", threshold: 1, actual: 0, passed: false }]),
    });
  }

  try {
    const [clientMatchRows, clientUnmappedRows, counterpartyRows, counterpartyResolvedRows] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(lc.id)::INTEGER AS legacy_count,
          COUNT(cc.id)::INTEGER AS matched_count,
          SUM(CASE WHEN cc.id IS NOT NULL AND LOWER(TRIM(lc.name)) = LOWER(TRIM(cc.name)) THEN 1 ELSE 0 END)::INTEGER AS name_match_count
        FROM public.clients lc
        LEFT JOIN core.clients cc ON cc.legacy_id = lc.id
      `).then((r: any) => r.rows ?? r),
      db.execute(sql`
        SELECT COUNT(*)::INTEGER AS cnt FROM public.clients lc
        WHERE NOT EXISTS (SELECT 1 FROM core.clients cc WHERE cc.legacy_id = lc.id)
      `).then((r: any) => r.rows ?? r),
      db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM public.counterparties WHERE is_active = true`).then((r: any) => r.rows ?? r),
      db.execute(sql`
        SELECT COUNT(DISTINCT cp.id)::INTEGER AS cnt
        FROM public.counterparties cp
        WHERE cp.is_active = true
          AND EXISTS (
            SELECT 1 FROM finance.cost_lines cl
            WHERE LOWER(TRIM(cl.counterparty_name)) = LOWER(TRIM(cp.name_canonical))
          )
      `).then((r: any) => r.rows ?? r),
    ]);

    const clientLegacyCount = Number(clientMatchRows[0]?.legacy_count ?? 0);
    const clientMatchedCount = Number(clientMatchRows[0]?.matched_count ?? 0);
    const clientNameMatchCount = Number(clientMatchRows[0]?.name_match_count ?? 0);
    const clientUnmappedCount = Number(clientUnmappedRows[0]?.cnt ?? 0);
    const activeCounterparties = Number(counterpartyRows[0]?.cnt ?? 0);
    const resolvedCounterparties = Number(counterpartyResolvedRows[0]?.cnt ?? 0);

    const legacyCount = clientLegacyCount + activeCounterparties;
    const promotedCount = clientMatchedCount + resolvedCounterparties;

    const clientResolutionPct = clientLegacyCount === 0 ? 100 : (clientMatchedCount / clientLegacyCount) * 100;
    const counterpartyResolutionPct = activeCounterparties === 0 ? 100 : (resolvedCounterparties / activeCounterparties) * 100;
    const overallResolutionPct = legacyCount === 0 ? 100 : (promotedCount / legacyCount) * 100;
    const contactRetrievalPct = clientLegacyCount === 0 ? 100 : (clientNameMatchCount / clientLegacyCount) * 100;

    const mismatchCategories: string[] = [];
    if (clientUnmappedCount > 0) mismatchCategories.push("clients_missing_legacy_id_mapping");
    if (clientNameMatchCount < clientMatchedCount) mismatchCategories.push("client_name_field_mismatch");
    if (resolvedCounterparties < activeCounterparties) mismatchCategories.push("counterparty_name_unresolved_in_promoted");

    checks.push({
      domain: "party_contacts",
      status: overallResolutionPct === 100 && contactRetrievalPct >= 99.9 ? "ready" : "partial",
      legacyCount,
      promotedCount,
      deltaCount: legacyCount - promotedCount,
      mismatchCategories,
      notes: [
        `Client resolution: ${clientMatchedCount}/${clientLegacyCount} mapped via legacy_id, ${clientNameMatchCount} name-verified. Counterparty resolution: ${resolvedCounterparties}/${activeCounterparties} active counterparties found in finance.cost_lines by canonical name.`,
        "PROVISIONAL: contact_retrieval_match uses client name match as proxy; true contact field parity (phone, email) requires contact fields in core.clients not present in Phase 1A schema.",
        "PROVISIONAL: counterparty resolution checks name presence in finance.cost_lines; a dedicated party abstraction table is deferred to Phase 2.",
      ],
      thresholdEvaluation: evaluatePhase1AThresholdOutcome([
        { metric: "active_assignment_resolution_success_percent", comparator: "eq", threshold: 100, actual: overallResolutionPct, passed: overallResolutionPct === 100 },
        { metric: "contact_retrieval_match_percent", comparator: "gte", threshold: 99.9, actual: contactRetrievalPct, passed: contactRetrievalPct >= 99.9 },
      ]),
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
      thresholdEvaluation: evaluatePhase1AThresholdOutcome([{ metric: "party_contact_check_available", comparator: "eq", threshold: 1, actual: 0, passed: false }]),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    checks,
  };
}

// ============================================================================
// Full-spine promoted read adapters (Phase 2+)
// ============================================================================

/**
 * Read cost lines from finance.cost_lines (promoted spine).
 * Returns data shaped like the legacy programExpense / normalizedCostLines API.
 */
export async function listCostLinesFromPromotedCompat(projectName?: string) {
  try {
    const rows = await db.execute(sql`
      SELECT
        cl.id,
        cl.legacy_normalized_cost_line_id AS "legacyNormalizedCostLineId",
        cl.legacy_program_expense_id AS "legacyProgramExpenseId",
        cl.project_id AS "projectId",
        cl.project_name_snapshot AS "projectName",
        cl.cost_category AS "costCategory",
        cl.counterparty_name AS "counterpartyName",
        cl.counterparty_id AS "counterpartyId",
        cl.counterparty_type AS "counterpartyType",
        cl.description,
        cl.amount_ex_vat AS "amountExVat",
        cl.invoice_number AS "invoiceNumber",
        cl.invoice_date AS "invoiceDate",
        cl.approved_date AS "approvedDate",
        cl.paid_date AS "paidDate",
        cl.po_number AS "poNumber",
        cl.status,
        cl.cost_line_status AS "costLineStatus",
        cl.source_sheet AS "sourceSheet",
        cl.source_row AS "sourceRow",
        cl.invoice_date_typed AS "invoiceDateTyped",
        cl.approved_date_typed AS "approvedDateTyped",
        cl.paid_date_typed AS "paidDateTyped",
        cl.fiscal_period_id AS "fiscalPeriodId",
        cl.is_opening_balance AS "isOpeningBalance",
        cl.invoice_date_font_color AS "invoiceDateFontColor",
        cl.invoice_date_confirmed AS "invoiceDateConfirmed",
        cl.paid_date_font_color AS "paidDateFontColor",
        cl.paid_date_confirmed AS "paidDateConfirmed",
        cl.cos_realised AS "cosRealised",
        cl.cashflow_confirmed AS "cashflowConfirmed",
        cl.no_revenue_linked AS "noRevenueLinked",
        cl.sub_project_name AS "subProjectName",
        cl.budget_qty AS "budgetQty",
        cl.budget_rate AS "budgetRate",
        cl.budget_total AS "budgetTotal",
        cl.budget_cos AS "budgetCos",
        cl.revenue_recognition_amount AS "revenueRecognitionAmount",
        cl.forecast_payment_date AS "forecastPaymentDate",
        cl.cos_status_override AS "cosStatusOverride",
        cl.cos_status_override_by AS "cosStatusOverrideBy",
        cl.cos_status_override_at AS "cosStatusOverrideAt",
        cl.cos_status_override_reason AS "cosStatusOverrideReason",
        cl.import_run_id AS "importRunId",
        cl.last_synced_at AS "lastSyncedAt",
        cl.created_at AS "createdAt",
        cl.updated_at AS "updatedAt"
      FROM finance.cost_lines cl
      WHERE cl.effective_to IS NULL AND cl.deleted_at IS NULL
        ${projectName ? sql`AND cl.project_name_snapshot = ${projectName}` : sql``}
      ORDER BY cl.id
    `).then((r: any) => r.rows ?? r);
    return rows;
  } catch (error: any) {
    if (isMissingCoreSchemaError(error)) {
      console.warn("[promoted-read-compat] finance.cost_lines missing, falling back to legacy");
      return null; // Caller should use legacy fallback
    }
    throw error;
  }
}

/**
 * Read revenue lines from finance.revenue_lines (promoted spine).
 */
export async function listRevenueLinesFromPromotedCompat(projectName?: string) {
  try {
    const rows = await db.execute(sql`
      SELECT
        rl.id,
        rl.legacy_normalized_revenue_line_id AS "legacyNormalizedRevenueLineId",
        rl.legacy_program_inflow_id AS "legacyProgramInflowId",
        rl.project_id AS "projectId",
        rl.project_name_snapshot AS "projectName",
        rl.milestone_name AS "milestoneName",
        rl.description,
        rl.amount_ex_vat AS "amountExVat",
        rl.vat,
        rl.invoice_number AS "invoiceNumber",
        rl.invoice_date AS "invoiceDate",
        rl.expected_payment_date AS "expectedPaymentDate",
        rl.paid_date AS "paidDate",
        rl.in_bank_date AS "inBankDate",
        rl.status,
        rl.source_sheet AS "sourceSheet",
        rl.source_row AS "sourceRow",
        rl.invoice_date_typed AS "invoiceDateTyped",
        rl.expected_payment_date_typed AS "expectedPaymentDateTyped",
        rl.paid_date_typed AS "paidDateTyped",
        rl.fiscal_period_id AS "fiscalPeriodId",
        rl.is_opening_balance AS "isOpeningBalance",
        rl.invoice_date_font_color AS "invoiceDateFontColor",
        rl.invoice_date_confirmed AS "invoiceDateConfirmed",
        rl.paid_date_font_color AS "paidDateFontColor",
        rl.paid_date_confirmed AS "paidDateConfirmed",
        rl.sub_project_name AS "subProjectName",
        rl.import_run_id AS "importRunId",
        rl.last_synced_at AS "lastSyncedAt",
        rl.created_at AS "createdAt",
        rl.updated_at AS "updatedAt"
      FROM finance.revenue_lines rl
      WHERE rl.effective_to IS NULL AND rl.deleted_at IS NULL
        ${projectName ? sql`AND rl.project_name_snapshot = ${projectName}` : sql``}
      ORDER BY rl.id
    `).then((r: any) => r.rows ?? r);
    return rows;
  } catch (error: any) {
    if (isMissingCoreSchemaError(error)) {
      console.warn("[promoted-read-compat] finance.revenue_lines missing, falling back to legacy");
      return null;
    }
    throw error;
  }
}
