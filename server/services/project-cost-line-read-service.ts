import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { normalizedCostLines, projectInfo } from "@shared/schema";
import { adaptCostToExpense } from "../lib/data-merge";
import { applyOverridesOverlay } from "../lib/manual-overrides";
import { EXPENDITURE_TRACKED_FIELDS } from "@shared/excel-vs-app/contract";

/**
 * Optional per-call flag for the canonical readers. Operational tabs
 * pass `applyOverrides: true` so manual overrides display on top of
 * the live column. Reporting and replica callers omit it (default
 * off) so they keep reading raw Excel-truth.
 */
export interface CostLineReadOpts {
  applyOverrides?: boolean;
}

export type CostLineageType = "IMPORTED" | "MANUAL_IDEMPOTENT" | "MANUAL_FALLBACK";

export interface CanonicalCostLineRow {
  id: number;
  projectId: number;
  projectName: string;
  sourceSheet: string | null;
  sourceRow: number | null;
  canonicalLineKey: string;
  lineageType: CostLineageType;
  isCurrent: true;
  importRunId: number;
  effectiveFrom: Date | null;
  idempotencyKey: string | null;
  // Legacy-compatible expense contract fields are spread in from adaptCostToExpense.
  [key: string]: any;
}

export interface RawCostLineRow {
  id: number;
  projectId: number;
  projectName?: string | null;
  sourceSheet?: string | null;
  sourceRow?: number | null;
  importRunId?: number | null;
  effectiveFrom?: Date | string | null;
  idempotencyKey?: string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
  source?: string | null;
  [key: string]: unknown;
}

export function toCanonicalKey(row: RawCostLineRow): { key: string; lineageType: CostLineageType } {
  const projectId = Number(row.projectId);
  const sourceSheet = row.sourceSheet ? String(row.sourceSheet) : null;
  const sourceRow = row.sourceRow != null ? Number(row.sourceRow) : null;
  const idempotencyKey = row.idempotencyKey ? String(row.idempotencyKey) : null;

  if (sourceRow != null) {
    return {
      key: `${projectId}|${sourceSheet || "unknown-sheet"}|${sourceRow}`,
      lineageType: "IMPORTED",
    };
  }

  if (idempotencyKey) {
    return {
      key: `${projectId}|manual|${idempotencyKey}`,
      lineageType: "MANUAL_IDEMPOTENT",
    };
  }

  return {
    key: `${projectId}|manual|id:${row.id}`,
    lineageType: "MANUAL_FALLBACK",
  };
}

export function toCanonicalUiRow(row: RawCostLineRow, resolvedProjectName: string): CanonicalCostLineRow {
  const identity = toCanonicalKey(row);
  const legacyExpense = adaptCostToExpense(row as any, resolvedProjectName);
  return {
    ...legacyExpense,
    id: Number(row.id),
    projectId: Number(row.projectId),
    projectName: resolvedProjectName,
    sourceSheet: row.sourceSheet || null,
    sourceRow: row.sourceRow ?? null,
    canonicalLineKey: identity.key,
    lineageType: identity.lineageType,
    isCurrent: true,
    importRunId: Number(row.importRunId),
    effectiveFrom: row.effectiveFrom ?? null,
    idempotencyKey: row.idempotencyKey ?? null,
  };
}

function rowRecencyScore(row: RawCostLineRow): number {
  const updatedAt = row.updatedAt ? new Date(String(row.updatedAt)).getTime() : 0;
  const effectiveFrom = row.effectiveFrom ? new Date(String(row.effectiveFrom)).getTime() : 0;
  const createdAt = row.createdAt ? new Date(String(row.createdAt)).getTime() : 0;
  return Math.max(updatedAt, effectiveFrom, createdAt, Number(row.id) || 0);
}

export function dedupeCurrentLineage(rows: RawCostLineRow[]): RawCostLineRow[] {
  const byKey = new Map<string, RawCostLineRow>();
  for (const row of rows) {
    const { key } = toCanonicalKey(row);
    const existing = byKey.get(key);
    if (!existing || rowRecencyScore(row) > rowRecencyScore(existing)) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}

async function projectNameMapById(): Promise<Map<number, string>> {
  const rows = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo);
  return new Map(rows.map((r: { id: number; projectName: string }) => [r.id, r.projectName]));
}

function normalizeProjectLookupName(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/_tracker$/i, "")
    .replace(/[\s_]+/g, "");
}

export async function resolveProjectIdByName(projectNameInput: string): Promise<number | null> {
  const projectName = decodeURIComponent(String(projectNameInput || "")).trim();
  if (!projectName) return null;

  const [exact] = await db.select({ id: projectInfo.id }).from(projectInfo).where(eq(projectInfo.projectName, projectName)).limit(1);
  if (exact?.id) return exact.id;

  const normalizedTarget = normalizeProjectLookupName(projectName);
  const all = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo);
  for (const p of all) {
    if (normalizeProjectLookupName(p.projectName) === normalizedTarget) return p.id;
  }
  return null;
}

export async function getCanonicalProjectCostLines(
  projectId: number,
  opts?: CostLineReadOpts,
): Promise<CanonicalCostLineRow[]> {
  const [projectMap, rows] = await Promise.all([
    projectNameMapById(),
    db.select().from(normalizedCostLines).where(and(eq(normalizedCostLines.projectId, projectId), and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt)))),
  ]);
  const dedupedRows = dedupeCurrentLineage(rows as RawCostLineRow[]);
  // Optional overlay: applies manual_overrides[field].value on top of
  // the live column for tracked fields. Operational-tab consumers
  // pass `applyOverrides: true`; reporting / replica readers leave it
  // off and see raw Excel-truth.
  const overlaidRows = opts?.applyOverrides
    ? (applyOverridesOverlay(dedupedRows as any[], EXPENDITURE_TRACKED_FIELDS) as RawCostLineRow[])
    : dedupedRows;
  const resolvedName = projectMap.get(projectId) || (overlaidRows[0]?.projectName ?? "");
  return overlaidRows.map((r) => toCanonicalUiRow(r, resolvedName));
}

export async function getCanonicalAllCurrentCostLines(opts?: CostLineReadOpts): Promise<CanonicalCostLineRow[]> {
  const [projectMap, rows] = await Promise.all([
    projectNameMapById(),
    db.select().from(normalizedCostLines).where(and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt))),
  ]);
  const dedupedRows = dedupeCurrentLineage(rows as RawCostLineRow[]);
  const overlaidRows = opts?.applyOverrides
    ? (applyOverridesOverlay(dedupedRows as any[], EXPENDITURE_TRACKED_FIELDS) as RawCostLineRow[])
    : dedupedRows;
  return overlaidRows.map((r) => toCanonicalUiRow(r, projectMap.get(r.projectId) || r.projectName || ""));
}

export async function getCanonicalProjectCostLinesByName(
  projectName: string,
  opts?: CostLineReadOpts,
): Promise<{ projectId: number | null; rows: CanonicalCostLineRow[] }> {
  const projectId = await resolveProjectIdByName(projectName);
  if (!projectId) return { projectId: null, rows: [] };
  const rows = await getCanonicalProjectCostLines(projectId, opts);
  return { projectId, rows };
}

/**
 * Finance PR 3 (Tier 3): batched cousin of
 * `getCanonicalProjectCostLinesByName`. Resolves every requested project
 * name to its id in a single pass (one query for exact matches, one
 * full-table scan for the fuzzy fallback), then fetches all matching
 * `normalized_cost_lines` in a single `inArray` query. Used by the
 * legacy `/api/expenditure/overrides` handler which previously did
 * 2 round-trips per project name in a loop.
 *
 * Returned map is keyed by the caller-supplied project name; missing
 * resolutions yield `{ projectId: null, rows: [] }`.
 */
export async function getCanonicalCostLinesByNames(
  projectNames: string[],
  opts?: CostLineReadOpts,
): Promise<Map<string, { projectId: number | null; rows: CanonicalCostLineRow[] }>> {
  const result = new Map<string, { projectId: number | null; rows: CanonicalCostLineRow[] }>();
  const uniqueNames = Array.from(new Set(projectNames.filter((n): n is string => typeof n === "string" && n.length > 0)));
  for (const n of uniqueNames) result.set(n, { projectId: null, rows: [] });
  if (uniqueNames.length === 0) return result;

  // Finance PR 3 audit follow-up: mirror the decode + trim normalisation
  // `resolveProjectIdByName` does, so URL-encoded or whitespace-padded
  // inputs resolve identically through the batched path.
  const inputToLookup = new Map<string, string>();
  for (const inputName of uniqueNames) {
    const lookup = decodeURIComponent(inputName).trim();
    inputToLookup.set(inputName, lookup);
  }
  const lookupNames = Array.from(new Set(Array.from(inputToLookup.values()).filter((n) => n.length > 0)));

  // 1. Exact-match pass: one query for all normalised lookup names.
  const exactMatches = lookupNames.length > 0
    ? await db.select({ id: projectInfo.id, projectName: projectInfo.projectName })
        .from(projectInfo)
        .where(inArray(projectInfo.projectName, lookupNames))
    : [];
  const exactByLookup = new Map<string, number>();
  for (const row of exactMatches) exactByLookup.set(row.projectName, row.id);

  // 2. Fuzzy fallback: one full scan for any lookups that didn't match exactly.
  const unresolved = lookupNames.filter((n) => !exactByLookup.has(n));
  if (unresolved.length > 0) {
    const allProjects = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo);
    const projectsByKey = new Map<string, number>();
    for (const p of allProjects) projectsByKey.set(normalizeProjectLookupName(p.projectName), p.id);
    for (const name of unresolved) {
      const key = normalizeProjectLookupName(name);
      const id = projectsByKey.get(key);
      if (id != null) exactByLookup.set(name, id);
    }
  }

  // 3. Single fetch for all matching cost lines.
  const inputToProjectId = new Map<string, number>();
  for (const name of uniqueNames) {
    const lookup = inputToLookup.get(name);
    if (!lookup) continue;
    const id = exactByLookup.get(lookup);
    if (id != null) inputToProjectId.set(name, id);
  }
  const allProjectIds = Array.from(new Set(inputToProjectId.values()));
  if (allProjectIds.length === 0) return result;

  const [projectMap, rawRows] = await Promise.all([
    projectNameMapById(),
    db.select().from(normalizedCostLines).where(and(
      inArray(normalizedCostLines.projectId, allProjectIds),
      isNull(normalizedCostLines.effectiveTo),
      isNull(normalizedCostLines.deletedAt),
    )),
  ]);

  // 4. Dedupe + optional overlay per project, then group back to input names.
  const rowsByProjectId = new Map<number, RawCostLineRow[]>();
  for (const row of rawRows as RawCostLineRow[]) {
    const list = rowsByProjectId.get(row.projectId) ?? [];
    list.push(row);
    rowsByProjectId.set(row.projectId, list);
  }
  for (const [inputName, pid] of inputToProjectId.entries()) {
    const rows = rowsByProjectId.get(pid) ?? [];
    const deduped = dedupeCurrentLineage(rows);
    const overlaid = opts?.applyOverrides
      ? (applyOverridesOverlay(deduped as any[], EXPENDITURE_TRACKED_FIELDS) as RawCostLineRow[])
      : deduped;
    const resolvedName = projectMap.get(pid) || (overlaid[0]?.projectName ?? "");
    result.set(inputName, {
      projectId: pid,
      rows: overlaid.map((r) => toCanonicalUiRow(r, resolvedName)),
    });
  }
  return result;
}

export async function getCanonicalCostLineDiagnostics(projectId?: number) {
  const rows = projectId
    ? await getCanonicalProjectCostLines(projectId)
    : await getCanonicalAllCurrentCostLines();

  const byCanonicalKey = new Map<string, CanonicalCostLineRow[]>();
  for (const row of rows) {
    const bucket = byCanonicalKey.get(row.canonicalLineKey) || [];
    bucket.push(row);
    byCanonicalKey.set(row.canonicalLineKey, bucket);
  }

  const duplicates = Array.from(byCanonicalKey.entries())
    .filter(([, bucket]) => bucket.length > 1)
    .map(([canonicalLineKey, bucket]) => ({
      canonicalLineKey,
      count: bucket.length,
      projectId: bucket[0].projectId,
      ids: bucket.map((b) => b.id),
      importRunIds: bucket.map((b) => b.importRunId),
      lineageTypes: Array.from(new Set(bucket.map((b) => b.lineageType))),
    }))
    .sort((a, b) => b.count - a.count);

  const lineageSummary = rows.reduce((acc: Record<string, number>, row: CanonicalCostLineRow) => {
    acc[row.lineageType] = (acc[row.lineageType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    totalRows: rows.length,
    duplicateCanonicalGroups: duplicates.length,
    duplicateRows: duplicates.reduce((sum, d) => sum + d.count, 0),
    lineageSummary,
    duplicates,
  };
}

export async function getCostLineRiskDiagnostics(projectId?: number, sampleSize = 5) {
  const [activeNormalizedRows, projects] = await Promise.all([
    projectId
      ? db.select().from(normalizedCostLines).where(and(eq(normalizedCostLines.projectId, projectId), and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt))))
      : db.select().from(normalizedCostLines).where(and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt))),
    db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo),
  ]);

  const normalizedRows = activeNormalizedRows as RawCostLineRow[];
  const projectNameById = new Map<number, string>(projects.map((p: { id: number; projectName: string }) => [p.id, p.projectName]));

  const dupBuckets = new Map<string, RawCostLineRow[]>();
  for (const row of normalizedRows) {
    const { key } = toCanonicalKey(row);
    const bucket = dupBuckets.get(key) || [];
    bucket.push(row);
    dupBuckets.set(key, bucket);
  }

  const duplicateGroups = Array.from(dupBuckets.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([canonicalLineKey, rows]) => ({
      canonicalLineKey,
      projectId: Number(rows[0].projectId),
      projectName: projectNameById.get(Number(rows[0].projectId)) || rows[0].projectName || null,
      count: rows.length,
      rowIds: rows.map((r) => Number(r.id)),
      importRunIds: rows.map((r) => Number(r.importRunId || 0)),
      sourceRows: rows.map((r) => r.sourceRow ?? null),
      sourceSheets: rows.map((r) => r.sourceSheet ?? null),
    }))
    .sort((a, b) => b.count - a.count);

  const nullSourceImportedRows = normalizedRows
    .filter((r) => String(r.source || "").toLowerCase() === "imported")
    .filter((r) => r.sourceSheet == null || r.sourceRow == null)
    .map((r) => ({
      id: Number(r.id),
      projectId: Number(r.projectId),
      projectName: projectNameById.get(Number(r.projectId)) || r.projectName || null,
      sourceSheet: r.sourceSheet ?? null,
      sourceRow: r.sourceRow ?? null,
      importRunId: Number(r.importRunId || 0),
      updatedAt: r.updatedAt ?? null,
    }));

  // Data-quality flag: invoice number captured but amount is R0. Per the
  // COO business rule, "you don't invoice for R0" — these rows are
  // either an import oversight (amount column blank) or a deliberate
  // suppression that should be cleared. They're excluded from the
  // Realised pile by `isCosRealised` (the wrapper now forwards the
  // amount to the canonical zero-amount gate), so the diagnostic is
  // the only place they surface.
  const zeroAmountInvoicedRows = normalizedRows
    .filter((r) => {
      const invoice = String(r.expenseInvoiceNumber ?? "").trim();
      if (!invoice) return false;
      const amountRaw = r.expenseActualTotal ?? r.amountExVat;
      if (amountRaw == null || amountRaw === "") return false;
      const amount = typeof amountRaw === "number" ? amountRaw : parseFloat(String(amountRaw));
      return Number.isFinite(amount) && amount === 0;
    })
    .map((r) => ({
      id: Number(r.id),
      projectId: Number(r.projectId),
      projectName: projectNameById.get(Number(r.projectId)) || r.projectName || null,
      invoiceNumber: r.expenseInvoiceNumber ?? null,
      invoiceDate: r.expenseInvoicedDate ?? null,
      expenseCategory: r.expenseCategory ?? null,
      expenseLineItem: r.expenseLineItem ?? null,
      supplierName: r.supplierName ?? null,
      sourceSheet: r.sourceSheet ?? null,
      sourceRow: r.sourceRow ?? null,
      updatedAt: r.updatedAt ?? null,
    }));

  const driftGroups = Array.from(
    normalizedRows.reduce((acc, row) => {
      const pid = Number(row.projectId);
      const names = acc.get(pid) || new Set<string>();
      const normalizedName = String(row.projectName || "").trim();
      if (normalizedName) names.add(normalizedName);
      acc.set(pid, names);
      return acc;
    }, new Map<number, Set<string>>()).entries(),
  )
    .map(([pid, names]) => {
      const canonicalName = projectNameById.get(pid) || null;
      const variants = Array.from(names.values()).filter((name) => name !== canonicalName);
      return {
        projectId: pid,
        canonicalProjectName: canonicalName,
        variantNames: variants,
        variantCount: variants.length,
      };
    })
    .filter((group) => group.variantCount > 0)
    .sort((a, b) => b.variantCount - a.variantCount);

  return {
    generatedAt: new Date().toISOString(),
    scope: projectId ?? null,
    duplicateActiveLineageGroups: {
      count: duplicateGroups.length,
      sample: duplicateGroups.slice(0, sampleSize),
    },
    nullSourceImportedRows: {
      count: nullSourceImportedRows.length,
      sample: nullSourceImportedRows.slice(0, sampleSize),
    },
    projectNameDriftGroups: {
      count: driftGroups.length,
      sample: driftGroups.slice(0, sampleSize),
    },
    zeroAmountInvoicedRows: {
      count: zeroAmountInvoicedRows.length,
      sample: zeroAmountInvoicedRows.slice(0, sampleSize),
    },
    // normalizedVsProgramExpenseActiveOverlap was removed when program_expense
    // was retired in the PE/PI cutover. The diagnostic is no longer meaningful.
  };
}
