import { db } from "../db";
import { sql } from "drizzle-orm";

export type ComparisonStatus = "ready" | "partial" | "blocked";

export interface DomainComparisonSummary {
  domain: "projects" | "clients" | "portfolios" | "project_portfolio_assignments" | "work_item_counts";
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
  const [projects, clients, portfolios, assignments, workItemCounts] = await Promise.all([
    compareCoreProjectsReadiness(),
    compareCoreClientsReadiness(),
    compareCorePortfoliosReadiness(),
    compareCoreProjectPortfolioAssignmentsReadiness(),
    compareProjectWorkItemCountsReadiness(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    candidates: [projects, clients, portfolios, assignments, workItemCounts],
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
