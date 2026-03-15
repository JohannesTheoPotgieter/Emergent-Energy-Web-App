import { db } from "../db";
import { sql } from "drizzle-orm";

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
function classifyStatus(summary: Pick<DomainComparisonSummary, "missingInPromotedCount" | "extraInPromotedCount" | "fieldMismatchCount">): ComparisonStatus {
  if (summary.missingInPromotedCount === 0 && summary.extraInPromotedCount === 0 && summary.fieldMismatchCount === 0) return "ready";
  if (summary.missingInPromotedCount > 0) return "blocked";
  return "partial";
}

function limitIds(ids: number[], max = 20): number[] {
  return ids.slice(0, max);
}

export async function compareCoreProjectsReadiness(): Promise<DomainComparisonSummary> {
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
}

export async function compareCoreClientsReadiness(): Promise<DomainComparisonSummary> {
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
}

export async function compareCorePortfoliosReadiness(): Promise<DomainComparisonSummary> {
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
}

export async function compareCoreProjectPortfolioAssignmentsReadiness(): Promise<DomainComparisonSummary> {
  const [legacyRows, promotedRows] = await Promise.all([
    db.execute(sql`SELECT project_id, portfolio_id FROM public.project_portfolio_assignments ORDER BY project_id, portfolio_id`).then((r: any) => r.rows ?? r),
    db.execute(sql`SELECT project_id, portfolio_id FROM core.project_portfolio_assignments ORDER BY project_id, portfolio_id`).then((r: any) => r.rows ?? r),
  ]);

  const toKey = (row: any) => `${Number(row.project_id)}::${Number(row.portfolio_id)}`;
  const legacyKeys = new Set<string>(legacyRows.map(toKey));
  const promotedKeys = new Set<string>(promotedRows.map(toKey));

  const missingInPromoted = legacyRows.map(toKey).filter((key) => !promotedKeys.has(key));
  const extraInPromoted = promotedRows.map(toKey).filter((key) => !legacyKeys.has(key));

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
    sampleMissingInPromotedIds: limitIds(missingInPromoted.map((key) => Number(key.split("::")[0]))),
    sampleExtraInPromotedIds: limitIds(extraInPromoted.map((key) => Number(key.split("::")[0]))),
    sampleFieldMismatchIds: [],
    notes: ["Assignment comparison is keyed by project_id + portfolio_id pairs."],
  };
}

export async function compareProjectWorkItemCountsReadiness(): Promise<DomainComparisonSummary> {
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
}

export async function listProjectInfoFromPromotedCoreCompat() {
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
}


export async function compareProjectDetailMasterReadiness(): Promise<DomainComparisonSummary> {
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
}

export async function listProjectDetailFromPromotedCoreCompat(): Promise<ProjectDetailCompatRow[]> {
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
}

export async function buildWorkItemSummaryDiagnostics(limitProjects = 200): Promise<WorkItemSummaryDiagnostics> {
  const [legacyRows, promotedRows, projectRows] = await Promise.all([
    db.execute(sql`SELECT id, project_id, status, owner, phase FROM public.work_items WHERE deleted_at IS NULL`).then((r: any) => r.rows ?? r),
    db.execute(sql`SELECT id, project_id, status, owner_user_id, source_domain FROM core.work_items WHERE source_table = 'public.work_items'`).then((r: any) => r.rows ?? r),
    db.execute(sql`SELECT id, project_name FROM public.project_info`).then((r: any) => r.rows ?? r),
  ]);

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
  const [pendingRequestsRows, unresolvedAckRows, openConflictsRows] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::INTEGER AS cnt FROM imports.source_update_requests WHERE status IN ('pending', 'open')`).then((r: any) => r.rows ?? r),
    db.execute(sql`
      SELECT COUNT(*)::INTEGER AS cnt
      FROM imports.source_update_requests r
      LEFT JOIN imports.source_update_acknowledgements a
        ON a.source_update_request_id = r.id
      WHERE r.status IN ('pending', 'open')
      GROUP BY r.id
      HAVING COUNT(a.id) = 0
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
    status: pendingRequests === 0 && unresolvedAcknowledgements === 0 && openConflicts === 0 ? 'ready' : 'partial',
    mismatchCategories,
    sampleMissingInPromotedIds: [],
    sampleExtraInPromotedIds: [],
    sampleFieldMismatchIds: [],
    notes: [
      'Imports governance preview is non-blocking in this phase; counts are diagnostic only.',
      `Pending requests: ${pendingRequests}, unresolved ack gaps: ${unresolvedAcknowledgements}, open conflicts: ${openConflicts}.`,
    ],
  };
}
