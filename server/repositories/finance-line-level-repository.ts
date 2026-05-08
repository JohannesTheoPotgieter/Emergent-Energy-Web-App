/**
 * Line-level finance read API — single source of truth for per-line revenue,
 * COS, and GP. Implements the canonical formula in AGENT_GUARDRAILS § 3.3:
 *
 *     perLineRevenue = (line.actualTotal / category.totalActualTotal)
 *                      × category.revenueAllocation
 *
 * Scope is one project at a time. Cross-project pooling is forbidden by
 * § 3.3.1 — call getProjectFinanceLines once per project and sum.
 *
 * Recognition date for both revenue and COS bucketing is
 * `normalized_cost_line_actuals.invoice_date` (Excel column T — Invoice
 * Raised Date). NOT forecastPaymentDate, NOT paidDate.
 *
 * Line grain is one row per `normalized_cost_line_actuals` row (a single
 * Excel BOQ row that was settled across N invoices yields N API rows).
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  categoryRevenueAllocations,
  normalizedCostLineActuals,
  normalizedCostLines,
} from "@shared/schema";
import { db } from "../db";

export type FinanceLineBucket = "planned" | "committed" | "unrealised" | "realised";

export interface FinanceLine {
  /** Identity of the actuals child row (`normalized_cost_line_actuals.id`). */
  lineId: number;
  /** Identity of the costed parent row (`normalized_cost_lines.id`). */
  parentLineId: number;
  projectId: number;

  /** Category linkage. Null when the parent has no `category_allocation_id`. */
  categoryAllocationId: number | null;
  categoryKey: string | null;
  categoryName: string | null;
  categoryNumber: string | null;

  /** Workbook-level metadata for drilldown display. */
  productService: string | null;
  descriptionOfWork: string | null;
  qty: string | null;
  rateUnit: string | null;

  /** Planned side (left half of Expenditure Breakdown). */
  budgetTotal: string | null;
  forecastPaymentDate: string | null;

  /** Actual side (right half). */
  actualTotal: number;
  poNumber: string | null;
  invoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  paidDate: string | null;
  paidDateConfirmed: boolean | null;

  /** Category aggregates (X and J in the Excel formula). */
  categoryTotalActualTotal: number;
  categoryRevenueAllocation: number | null;

  /** Read-derived per-line values (§ 3.3). */
  perLineRevenue: number;
  perLineGp: number;
  perLineGpPct: number | null;

  /** Bucket classification (matches existing FY card / recon grid taxonomy). */
  bucket: FinanceLineBucket;

  /** YYYY-MM month key derived from invoiceRaisedDate; null when no T date. */
  recognitionMonth: string | null;

  /** Human-readable warning when this line could not be revenue-derived. */
  derivationWarning: string | null;
}

export interface GetProjectFinanceLinesOptions {
  /** Inclusive ISO date (YYYY-MM-DD) — filters on invoiceRaisedDate. */
  fyStart?: string;
  /** Inclusive ISO date (YYYY-MM-DD) — filters on invoiceRaisedDate. */
  fyEnd?: string;
}

const toNum = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const monthKey = (iso: string | null): string | null =>
  iso && iso.length >= 7 ? iso.slice(0, 7) : null;

const isoDate = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return null;
    return trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed;
  }
  return null;
};

const inWindow = (iso: string | null, fyStart?: string, fyEnd?: string): boolean => {
  if (!fyStart && !fyEnd) return true;
  if (!iso) return false;
  if (fyStart && iso < fyStart) return false;
  if (fyEnd && iso > fyEnd) return false;
  return true;
};

/**
 * Bucket classification — matches the existing taxonomy used by Revenue /
 * COS / GP recon grids:
 *
 *   planned      — no PO yet (the line is still budget-only)
 *   committed    — PO captured but no invoice yet
 *   unrealised   — invoice captured but paid-date not BLACK-confirmed
 *   realised     — paid-date BLACK-confirmed (cash has moved)
 *
 * Realisation here is the *cash* signal on column W per § 3.7. The COS
 * realisation predicate (§ 3.2 — invoice + invoice-date BLACK) is a
 * separate concern owned by `isCanonicalCosRealised` and is consumed by
 * higher layers when they need that distinction.
 */
const classifyBucket = (
  poNumber: string | null,
  invoiceNumber: string | null,
  paidDateConfirmed: boolean | null,
): FinanceLineBucket => {
  if (paidDateConfirmed === true) return "realised";
  if (invoiceNumber && invoiceNumber.trim()) return "unrealised";
  if (poNumber && poNumber.trim()) return "committed";
  return "planned";
};

export class FinanceLineLevelRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  /**
   * Read every actuals row for a project, joined to its costed parent and
   * category allocation, with per-line revenue/GP derived in memory.
   *
   * Snapshot guard (§ 3.1) is applied to all three tables. The category
   * total `X` is computed from THIS project's live actuals only — never
   * pooled across projects (§ 3.3.1).
   *
   * Performance: three batched queries, then a single in-memory pass. No
   * N+1 per-line lookups. Single-project read budget < 500ms even for
   * Mondi-scale projects (~500 lines).
   */
  async getProjectFinanceLines(
    projectId: number,
    opts: GetProjectFinanceLinesOptions = {},
  ): Promise<FinanceLine[]> {
    const lines = await this.getPortfolioFinanceLines([projectId], opts);
    return lines;
  }

  /**
   * Multi-project read. Each project's category totals are computed
   * independently (§ 3.3.1). Used by the portfolio aggregator in PR 4.
   */
  async getPortfolioFinanceLines(
    projectIds: number[],
    opts: GetProjectFinanceLinesOptions = {},
  ): Promise<FinanceLine[]> {
    if (projectIds.length === 0) return [];

    const dbi = this.dbInstance;
    const projectsClause = inArray(normalizedCostLineActuals.projectId, projectIds);

    // Three batched queries.
    const [actualsRows, parentRows, allocationRows] = await Promise.all([
      dbi
        .select({
          id: normalizedCostLineActuals.id,
          costLineId: normalizedCostLineActuals.costLineId,
          projectId: normalizedCostLineActuals.projectId,
          actualTotal: normalizedCostLineActuals.actualTotal,
          poNumber: normalizedCostLineActuals.poNumber,
          invoiceNumber: normalizedCostLineActuals.invoiceNumber,
          invoiceDate: normalizedCostLineActuals.invoiceDate,
          financePaymentDate: normalizedCostLineActuals.financePaymentDate,
          description: normalizedCostLineActuals.description,
          qty: normalizedCostLineActuals.qty,
          rate: normalizedCostLineActuals.rate,
        })
        .from(normalizedCostLineActuals)
        .where(
          and(
            projectsClause,
            isNull(normalizedCostLineActuals.effectiveTo),
            isNull(normalizedCostLineActuals.deletedAt),
          ),
        ),
      dbi
        .select({
          id: normalizedCostLines.id,
          projectId: normalizedCostLines.projectId,
          categoryAllocationId: normalizedCostLines.categoryAllocationId,
          categoryKey: normalizedCostLines.categoryKey,
          costCategory: normalizedCostLines.costCategory,
          description: normalizedCostLines.description,
          budgetTotal: normalizedCostLines.budgetTotal,
          forecastPaymentDate: normalizedCostLines.forecastPaymentDate,
          paidDate: normalizedCostLines.paidDate,
          paidDateConfirmed: normalizedCostLines.paidDateConfirmed,
        })
        .from(normalizedCostLines)
        .where(
          and(
            inArray(normalizedCostLines.projectId, projectIds),
            isNull(normalizedCostLines.effectiveTo),
            isNull(normalizedCostLines.deletedAt),
          ),
        ),
      dbi
        .select({
          id: categoryRevenueAllocations.id,
          projectId: categoryRevenueAllocations.projectId,
          categoryKey: categoryRevenueAllocations.categoryKey,
          categoryName: categoryRevenueAllocations.categoryName,
          categoryNumber: categoryRevenueAllocations.categoryNumber,
          revenueAllocation: categoryRevenueAllocations.revenueAllocation,
        })
        .from(categoryRevenueAllocations)
        .where(
          and(
            inArray(categoryRevenueAllocations.projectId, projectIds),
            isNull(categoryRevenueAllocations.effectiveTo),
          ),
        ),
    ]);

    return deriveFinanceLinesFromRows(actualsRows, parentRows, allocationRows, opts);
  }

  /**
   * Reads the persisted `revenue_recognition_amount` column on the
   * actuals child for one project, aggregated to a single project total.
   * Used by the dual-write parity diagnostic to compare against the
   * canonical line-level revenue sum (§ 3.3 formula).
   *
   * Snapshot guard applied. The optional fyStart/fyEnd window filters on
   * the same `invoice_date` (col T) the line-level path uses, so the
   * two totals are directly comparable.
   */
  async getPersistedRevenueRecognitionTotals(
    projectId: number,
    opts: GetProjectFinanceLinesOptions = {},
  ): Promise<{
    revenue: number;
    cos: number;
    rowCount: number;
    nonNullRevenueRowCount: number;
  }> {
    const rows = await this.dbInstance
      .select({
        invoiceDate: normalizedCostLineActuals.invoiceDate,
        revenueRecognitionAmount: normalizedCostLineActuals.revenueRecognitionAmount,
        actualTotal: normalizedCostLineActuals.actualTotal,
      })
      .from(normalizedCostLineActuals)
      .where(
        and(
          eq(normalizedCostLineActuals.projectId, projectId),
          isNull(normalizedCostLineActuals.effectiveTo),
          isNull(normalizedCostLineActuals.deletedAt),
        ),
      );

    let revenue = 0;
    let cos = 0;
    let rowCount = 0;
    let nonNullRevenueRowCount = 0;
    for (const r of rows) {
      const iso = r.invoiceDate ? String(r.invoiceDate).slice(0, 10) : null;
      if (opts.fyStart && (!iso || iso < opts.fyStart)) continue;
      if (opts.fyEnd && (!iso || iso > opts.fyEnd)) continue;

      rowCount += 1;
      if (r.revenueRecognitionAmount != null) {
        const v = Number(r.revenueRecognitionAmount);
        if (Number.isFinite(v)) {
          revenue += v;
          nonNullRevenueRowCount += 1;
        }
      }
      if (r.actualTotal != null) {
        const v = Number(r.actualTotal);
        if (Number.isFinite(v)) cos += v;
      }
    }
    return { revenue, cos, rowCount, nonNullRevenueRowCount };
  }
}

/** Row shapes accepted by the pure derivation helper. Match the projections
 * in `getPortfolioFinanceLines` exactly. Exported for tests and future
 * callers that want to feed in-memory data (e.g. fixture-driven recon). */
export interface FinanceLineActualsRowInput {
  id: number;
  costLineId: number;
  projectId: number;
  actualTotal: string | number | null;
  poNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | Date | null;
  financePaymentDate: string | Date | null;
  description: string | null;
  qty: string | null;
  rate: string | null;
}

export interface FinanceLineParentRowInput {
  id: number;
  projectId: number;
  categoryAllocationId: number | null;
  categoryKey: string | null;
  costCategory: string | null;
  description: string | null;
  budgetTotal: string | null;
  forecastPaymentDate: string | Date | null;
  paidDate: string | Date | null;
  paidDateConfirmed: boolean | null;
}

export interface FinanceLineAllocationRowInput {
  id: number;
  projectId: number;
  categoryKey: string;
  categoryName: string;
  categoryNumber: string;
  revenueAllocation: string | number | null;
}

/**
 * Pure in-memory derivation — single source of truth for the § 3.3 math.
 * Exported so tests and fixture-driven callers can exercise the formula
 * without a database. The repository methods are thin wrappers that fetch
 * the three input arrays and call this.
 */
export function deriveFinanceLinesFromRows(
  actualsRows: readonly FinanceLineActualsRowInput[],
  parentRows: readonly FinanceLineParentRowInput[],
  allocationRows: readonly FinanceLineAllocationRowInput[],
  opts: GetProjectFinanceLinesOptions = {},
): FinanceLine[] {
  const parentById = new Map<number, FinanceLineParentRowInput>();
  for (const p of parentRows) parentById.set(p.id, p);

  const allocationById = new Map<number, FinanceLineAllocationRowInput>();
  for (const a of allocationRows) allocationById.set(a.id, a);

  // X — SUM(actualTotal) per (projectId, categoryAllocationId), scoped to
  // each project independently (§ 3.3.1 — never pooled across projects).
  const categoryTotalsKey = (projectId: number, allocationId: number) =>
    `${projectId}:${allocationId}`;
  const categoryTotalActuals = new Map<string, number>();
  for (const a of actualsRows) {
    const parent = parentById.get(a.costLineId);
    if (!parent) continue;
    const allocId = parent.categoryAllocationId;
    if (allocId == null) continue;
    const k = categoryTotalsKey(a.projectId, allocId);
    categoryTotalActuals.set(k, (categoryTotalActuals.get(k) ?? 0) + toNum(a.actualTotal));
  }

  const lines: FinanceLine[] = [];
  for (const a of actualsRows) {
    const parent = parentById.get(a.costLineId);
    const invoiceRaisedDate = isoDate(a.invoiceDate);
    if (!inWindow(invoiceRaisedDate, opts.fyStart, opts.fyEnd)) continue;

    const actualTotal = toNum(a.actualTotal);
    const allocId = parent?.categoryAllocationId ?? null;
    const allocation = allocId != null ? allocationById.get(allocId) ?? null : null;
    const categoryTotalActualTotal = allocId != null
      ? categoryTotalActuals.get(categoryTotalsKey(a.projectId, allocId)) ?? 0
      : 0;
    const categoryRevenueAllocation = allocation
      ? toNum(allocation.revenueAllocation)
      : null;

    let perLineRevenue = 0;
    let warning: string | null = null;
    if (parent == null) {
      warning = "orphan_actuals_row_no_parent";
    } else if (allocId == null) {
      warning = "missing_category_allocation_linkage";
    } else if (categoryRevenueAllocation == null || categoryRevenueAllocation === 0) {
      warning = "category_revenue_allocation_missing";
    } else if (categoryTotalActualTotal === 0) {
      warning = "category_total_actual_zero";
    } else {
      perLineRevenue = (actualTotal / categoryTotalActualTotal) * categoryRevenueAllocation;
    }

    const perLineGp = perLineRevenue - actualTotal;
    const perLineGpPct = perLineRevenue !== 0 ? perLineGp / perLineRevenue : null;
    const paidDateConfirmed = parent?.paidDateConfirmed ?? null;

    lines.push({
      lineId: a.id,
      parentLineId: a.costLineId,
      projectId: a.projectId,
      categoryAllocationId: allocId,
      categoryKey: parent?.categoryKey ?? null,
      categoryName: allocation?.categoryName ?? parent?.costCategory ?? null,
      categoryNumber: allocation?.categoryNumber ?? null,
      productService: parent?.costCategory ?? null,
      descriptionOfWork: a.description ?? parent?.description ?? null,
      qty: a.qty ?? null,
      rateUnit: a.rate ?? null,
      budgetTotal: parent?.budgetTotal ?? null,
      forecastPaymentDate: isoDate(parent?.forecastPaymentDate ?? null),
      actualTotal,
      poNumber: a.poNumber ?? null,
      invoiceNumber: a.invoiceNumber ?? null,
      invoiceRaisedDate,
      paidDate: isoDate(parent?.paidDate ?? a.financePaymentDate ?? null),
      paidDateConfirmed,
      categoryTotalActualTotal,
      categoryRevenueAllocation,
      perLineRevenue,
      perLineGp,
      perLineGpPct,
      bucket: classifyBucket(a.poNumber ?? null, a.invoiceNumber ?? null, paidDateConfirmed),
      recognitionMonth: monthKey(invoiceRaisedDate),
      derivationWarning: warning,
    });
  }

  return lines;
}

/**
 * Convenience aggregator — sum lines into a monthly recon shape keyed by
 * `recognitionMonth`. Used by Revenue, COS, and GP grids. Lines whose
 * recognitionMonth is null (no T date) are bucketed into the
 * `unrecognised` slot.
 */
export interface MonthlyReconRow {
  monthKey: string;
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  count: number;
}

export function aggregateLinesByMonth(lines: FinanceLine[]): {
  byMonth: MonthlyReconRow[];
  unrecognised: MonthlyReconRow;
  total: MonthlyReconRow;
} {
  const buckets = new Map<string, MonthlyReconRow>();
  const ensure = (key: string): MonthlyReconRow => {
    let row = buckets.get(key);
    if (!row) {
      row = { monthKey: key, cos: 0, revenue: 0, gp: 0, gpPct: null, count: 0 };
      buckets.set(key, row);
    }
    return row;
  };

  let totalCos = 0;
  let totalRevenue = 0;
  let totalGp = 0;
  let totalCount = 0;
  let unrecCos = 0;
  let unrecRevenue = 0;
  let unrecGp = 0;
  let unrecCount = 0;

  for (const line of lines) {
    if (line.recognitionMonth) {
      const row = ensure(line.recognitionMonth);
      row.cos += line.actualTotal;
      row.revenue += line.perLineRevenue;
      row.gp += line.perLineGp;
      row.count += 1;
    } else {
      unrecCos += line.actualTotal;
      unrecRevenue += line.perLineRevenue;
      unrecGp += line.perLineGp;
      unrecCount += 1;
    }
    totalCos += line.actualTotal;
    totalRevenue += line.perLineRevenue;
    totalGp += line.perLineGp;
    totalCount += 1;
  }

  const finalize = (row: MonthlyReconRow): MonthlyReconRow => ({
    ...row,
    gpPct: row.revenue !== 0 ? row.gp / row.revenue : null,
  });

  const byMonth = Array.from(buckets.values())
    .map(finalize)
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  return {
    byMonth,
    unrecognised: finalize({
      monthKey: "unrecognised",
      cos: unrecCos,
      revenue: unrecRevenue,
      gp: unrecGp,
      gpPct: null,
      count: unrecCount,
    }),
    total: finalize({
      monthKey: "total",
      cos: totalCos,
      revenue: totalRevenue,
      gp: totalGp,
      gpPct: null,
      count: totalCount,
    }),
  };
}
