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

export type FinanceLineBucket = "planned" | "committed" | "realised";

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

  /**
   * Per-line BUDGET / PLANNED values, computed analogously to the
   * actual values but using the planned cost (col G — `budget_total`)
   * and the category planned total (col I —
   * `category_revenue_allocations.budget_total`):
   *
   *   plannedRevenue = (line.budgetTotal / category.budgetTotal)
   *                    × category.revenueAllocation
   *   plannedGp      = plannedRevenue − line.budgetTotal
   *
   * Used by the GP page to surface the FY budget / plan even when
   * actuals haven't been imported yet, mirroring how the COS / Revenue
   * trackers can show planned numbers without realised ones.
   */
  plannedActualTotal: number;
  plannedRevenue: number;
  plannedGp: number;
  plannedGpPct: number | null;

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
 * Normalise a category key for fallback matching.
 *
 * The Smart Import normaliser produces keys like "1. Panels" via
 * `normalizeCategoryKey`; both `category_revenue_allocations.category_key`
 * and `normalized_cost_lines.category_key` should agree. We still
 * defensively trim and lower-case here so a casing or whitespace drift
 * in legacy data doesn't break the fallback.
 */
const normalizeKey = (raw: string): string => raw.trim().toLowerCase();

/**
 * Bucket classification — matches the COS / Revenue tracker taxonomy
 * (canonical COS realisation per § 3.2: invoice captured + invoice-date
 * BLACK-confirmed, with past-month auto-promote for closed months).
 *
 *   planned    — no invoice yet
 *   committed  — invoice captured but unconfirmed (RED) and current/future month
 *   realised   — invoice captured + (BLACK-confirmed OR past-month with invoice)
 *
 * The fourth `unrealised` bucket from earlier iterations is folded back
 * into `committed` to align with how the COS tab classifies lines.
 * Realised numbers now match the COS / REV tabs exactly.
 */
const classifyBucket = (
  invoiceNumber: string | null,
  invoiceDateFontColor: string | null,
  invoiceDateConfirmed: boolean | null,
  recognitionMonth: string | null,
  currentMonthKey: string,
): FinanceLineBucket => {
  const hasInvoice = !!(invoiceNumber && invoiceNumber.trim());
  if (!hasInvoice) return "planned";

  // Past-month auto-promote: a closed month with an invoice IS the
  // confirmation, matching the COS tracker's currentMonthKey logic.
  const isPastMonth = recognitionMonth != null && recognitionMonth < currentMonthKey;
  const confirmed =
    invoiceDateFontColor?.toLowerCase() === "black" ||
    invoiceDateConfirmed === true ||
    isPastMonth;

  return confirmed ? "realised" : "committed";
};

// Anchor to SAST (UTC+2 year-round, no DST). Server is UTC but the
// operator's calendar is South African — using getUTCMonth here while
// the client uses local-tz getMonth caused the "current month" boundary
// to drift by ~2h every month-end, so a line invoiced at 23:30 SAST on
// the last day of the month was classified realised by the server but
// the client still painted the same month as live.
const SAST_OFFSET_MS = 120 * 60 * 1000;
const todayMonthKey = (): string => {
  const d = new Date(Date.now() + SAST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
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
          revenueRecognitionAmount: normalizedCostLineActuals.revenueRecognitionAmount,
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
          // Extra fields for parent-only synthesis when a parent has no
          // actuals child yet (e.g., budget-only lines, or lines whose
          // actuals weren't imported into the child table).
          amountExVat: normalizedCostLines.amountExVat,
          invoiceDate: normalizedCostLines.invoiceDate,
          invoiceNumber: normalizedCostLines.invoiceNumber,
          poNumber: normalizedCostLines.poNumber,
          // Realisation signal (col T cell colour) — aligns the
          // realised bucket with the COS tracker's classification.
          invoiceDateFontColor: normalizedCostLines.invoiceDateFontColor,
          invoiceDateConfirmed: normalizedCostLines.invoiceDateConfirmed,
          // Persisted Smart Import col U — preferred over derived
          // (Q/X)*J so the GP page matches the Revenue tracker.
          revenueRecognitionAmount: normalizedCostLines.revenueRecognitionAmount,
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
          // Excel col I — SUM of G across the category, used as the
          // denominator on the planned-side formula.
          budgetTotal: categoryRevenueAllocations.budgetTotal,
        })
        .from(categoryRevenueAllocations)
        .where(
          and(
            inArray(categoryRevenueAllocations.projectId, projectIds),
            isNull(categoryRevenueAllocations.effectiveTo),
          ),
        ),
    ]);

    const synthesizedActuals = synthesizeActualsForParents(actualsRows, parentRows);
    return deriveFinanceLinesFromRows(synthesizedActuals, parentRows, allocationRows, opts);
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
  /** Persisted Smart Import col U on this actuals row. When non-null,
   * preferred over the derived (Q/X)*J value so the GP page reconciles
   * to the Revenue tracker (which reads this column directly). */
  revenueRecognitionAmount?: string | number | null;
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
  // Fields populated by the repository's parent-row projection so the
  // method can synthesize "lines" for parents that have no actuals
  // child yet. Optional on the interface because pure-helper unit
  // tests that don't exercise the synthesis path don't need to set
  // them.
  amountExVat?: string | number | null;
  invoiceDate?: string | Date | null;
  invoiceNumber?: string | null;
  poNumber?: string | null;
  // Realisation signal (col T cell colour, BLACK = confirmed) per § 3.2.
  // Used by the bucket classifier to align with the COS tracker.
  invoiceDateFontColor?: string | null;
  invoiceDateConfirmed?: boolean | null;
  /** Persisted Smart Import col U on the parent (text). Falls through
   * to synthesized actuals rows so parent-only lines get the same
   * revenue-recognition number the Revenue tracker would show. */
  revenueRecognitionAmount?: string | null;
}

export interface FinanceLineAllocationRowInput {
  id: number;
  projectId: number;
  categoryKey: string;
  categoryName: string;
  categoryNumber: string;
  revenueAllocation: string | number | null;
  /**
   * Category planned cost total (Excel col I on the category header
   * row — `SUM(G6:G19)` for that category). Used as the denominator
   * for the planned-side `(G/I)*J` formula. Optional because legacy
   * allocations may not have it populated; in that case planned
   * values fall back to zero.
   */
  budgetTotal?: string | number | null;
}

/**
 * Synthesize a fake `actuals child` row for every parent that has no
 * real child, using parent-level fields. The repository wraps this
 * call before invoking `deriveFinanceLinesFromRows` so the GP page
 * surfaces budget-only and not-yet-imported-actuals data instead of
 * silently rendering nothing.
 *
 * Parents that DO have children are not synthesized — their real
 * child rows already represent the cost. No double-counting.
 *
 * Mirrors the parent-fallback in `mergeLineLevelCostLines` used by
 * the COS / Revenue tracker cutover so all three surfaces show the
 * same numbers.
 *
 * Synthesized rows use a negative `id` derived from the parent id so
 * they don't collide with real `normalized_cost_line_actuals.id`
 * values (those are positive `serial`).
 */
export function synthesizeActualsForParents(
  actualsRows: readonly FinanceLineActualsRowInput[],
  parentRows: readonly FinanceLineParentRowInput[],
): FinanceLineActualsRowInput[] {
  const parentsWithChildren = new Set<number>();
  for (const a of actualsRows) parentsWithChildren.add(a.costLineId);

  const out: FinanceLineActualsRowInput[] = [...actualsRows];
  for (const parent of parentRows) {
    if (parentsWithChildren.has(parent.id)) continue;
    out.push({
      id: -parent.id,
      costLineId: parent.id,
      projectId: parent.projectId,
      actualTotal: parent.amountExVat ?? null,
      poNumber: parent.poNumber ?? null,
      invoiceNumber: parent.invoiceNumber ?? null,
      invoiceDate: (parent.invoiceDate as string | Date | null) ?? null,
      financePaymentDate: (parent.paidDate as string | Date | null) ?? null,
      description: parent.description ?? null,
      qty: null,
      rate: null,
      revenueRecognitionAmount: parent.revenueRecognitionAmount ?? null,
    });
  }
  return out;
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
  // Anchor for past-month auto-promote in `classifyBucket`. Closed
  // months with an invoice are treated as realised, matching the COS
  // tracker's `currentMonthKey` logic.
  const currentMonthKey = todayMonthKey();
  const parentById = new Map<number, FinanceLineParentRowInput>();
  for (const p of parentRows) parentById.set(p.id, p);

  const allocationById = new Map<number, FinanceLineAllocationRowInput>();
  for (const a of allocationRows) allocationById.set(a.id, a);

  // Fallback resolution by (projectId, categoryKey) against active
  // allocations. Each Smart Import re-import soft-closes existing
  // allocations (§ 3.1) and inserts new ones with new IDs; if S10
  // doesn't fully relink the parent's `categoryAllocationId` FK, the
  // FK ends up pointing to a soft-closed (now-historical) row that
  // the snapshot guard correctly excludes from `allocationById`. The
  // category key is stable across re-imports though, so we can recover
  // by looking up the active allocation for the same project + key.
  // Without this fallback, GP silently shows zero for every line on
  // every re-import.
  const allocationByProjectKey = new Map<string, FinanceLineAllocationRowInput>();
  for (const a of allocationRows) {
    const k = a.categoryKey ? `${a.projectId}::${normalizeKey(a.categoryKey)}` : null;
    if (k) allocationByProjectKey.set(k, a);
  }

  // Resolve each parent to an active allocation: prefer the FK when it
  // points to a live row, fall back to (projectId, categoryKey).
  const parentResolvedAllocId = new Map<number, number | null>();
  for (const parent of parentRows) {
    let allocId: number | null = null;
    if (parent.categoryAllocationId != null && allocationById.has(parent.categoryAllocationId)) {
      allocId = parent.categoryAllocationId;
    } else if (parent.categoryKey) {
      const fallback = allocationByProjectKey.get(
        `${parent.projectId}::${normalizeKey(parent.categoryKey)}`,
      );
      if (fallback) allocId = fallback.id;
    }
    parentResolvedAllocId.set(parent.id, allocId);
  }

  // X — SUM(actualTotal) per (projectId, resolved allocationId), scoped
  // to each project independently (§ 3.3.1 — never pooled across
  // projects). Uses the resolved allocation so a stale FK doesn't fan
  // a category into multiple buckets.
  const categoryTotalsKey = (projectId: number, allocationId: number) =>
    `${projectId}:${allocationId}`;
  const categoryTotalActuals = new Map<string, number>();
  for (const a of actualsRows) {
    const parent = parentById.get(a.costLineId);
    if (!parent) continue;
    const allocId = parentResolvedAllocId.get(parent.id);
    if (allocId == null) continue;
    const k = categoryTotalsKey(a.projectId, allocId);
    categoryTotalActuals.set(k, (categoryTotalActuals.get(k) ?? 0) + toNum(a.actualTotal));
  }

  // Planned-side denominator — SUM(budgetTotal) per (projectId,
  // resolved allocationId) computed from parent rows. We prefer this
  // sum-from-lines value over `category_revenue_allocations.budgetTotal`
  // (col I) when it's available because Smart Import doesn't always
  // populate I; whereas col G (per-line budgetTotal) is always
  // populated for budgeted lines.
  const categoryTotalBudget = new Map<string, number>();
  for (const parent of parentRows) {
    const allocId = parentResolvedAllocId.get(parent.id);
    if (allocId == null) continue;
    const k = categoryTotalsKey(parent.projectId, allocId);
    categoryTotalBudget.set(k, (categoryTotalBudget.get(k) ?? 0) + toNum(parent.budgetTotal));
  }

  const lines: FinanceLine[] = [];
  for (const a of actualsRows) {
    const parent = parentById.get(a.costLineId);
    const invoiceRaisedDate = isoDate(a.invoiceDate);
    // Recognition date: Excel parity requires invoice date only
    // (Expenditure Breakdown col T). Forecast/payment dates are cashflow
    // planning inputs and must not move actual COS/REV recognition.
    const recognitionDate = invoiceRaisedDate;
    if (!inWindow(recognitionDate, opts.fyStart, opts.fyEnd)) continue;

    const actualTotal = toNum(a.actualTotal);
    const allocId = parent ? parentResolvedAllocId.get(parent.id) ?? null : null;
    const allocation = allocId != null ? allocationById.get(allocId) ?? null : null;
    const categoryTotalActualTotal = allocId != null
      ? categoryTotalActuals.get(categoryTotalsKey(a.projectId, allocId)) ?? 0
      : 0;
    const categoryRevenueAllocation = allocation
      ? toNum(allocation.revenueAllocation)
      : null;

    // Persisted Smart Import value (col U). Smart Import writes this
    // per-actual-row at import time using the canonical category-scoped
    // (Q/X)*J formula (§ 3.3). When present, prefer it over re-deriving
    // — that's the same source the Revenue tracker reads from, so the
    // numbers reconcile exactly.
    const persistedRevenue = toNum(a.revenueRecognitionAmount);

    let perLineRevenue = 0;
    let warning: string | null = null;
    if (persistedRevenue > 0) {
      perLineRevenue = persistedRevenue;
    } else if (parent == null) {
      warning = "orphan_actuals_row_no_parent";
    } else if (allocId == null) {
      // Distinguish "parent has nothing to lookup with" from "parent had a
      // key/FK but no matching active allocation exists". The first is a
      // data-quality issue at import time; the second is what the page
      // banner surfaces as "missing column J".
      const hasFk = parent.categoryAllocationId != null;
      const hasKey = !!(parent.categoryKey && parent.categoryKey.trim());
      warning =
        hasFk || hasKey
          ? "category_revenue_allocation_missing"
          : "missing_category_allocation_linkage";
    } else if (categoryRevenueAllocation == null || categoryRevenueAllocation === 0) {
      warning = "category_revenue_allocation_missing";
    } else if (categoryTotalActualTotal === 0) {
      warning = "category_total_actual_zero";
    } else if (categoryTotalActualTotal < 0) {
      // DF-6 (audit V2): a negative category total (credits > costs) would
      // invert the sign of the § 3.3 per-line formula and yield revenue that
      // is wrong in sign and magnitude. Flag and short-circuit to 0 instead
      // of silently producing -250000 on a 100000 cost line because the
      // category net is -20000. Rare but plausible at end-of-project after
      // refunds.
      warning = "category_total_actual_negative";
    } else {
      perLineRevenue = (actualTotal / categoryTotalActualTotal) * categoryRevenueAllocation;
    }

    const perLineGp = perLineRevenue - actualTotal;
    const perLineGpPct = perLineRevenue !== 0 ? perLineGp / perLineRevenue : null;
    const paidDateConfirmed = parent?.paidDateConfirmed ?? null;

    // Planned-side derivation — same shape as the actual formula but
    // using line.budgetTotal (col G) and category.budgetTotal-from-G
    // as the denominator. Falls back to allocation.budgetTotal (col I)
    // when the parent-summed value is zero. When neither is available,
    // plannedRevenue/Gp resolve to zero — same edge-case philosophy as
    // the actual formula in § 3.3.
    const plannedActualTotal = toNum(parent?.budgetTotal);
    let plannedRevenue = 0;
    if (allocation && categoryRevenueAllocation && categoryRevenueAllocation > 0) {
      const summedBudget = allocId != null
        ? categoryTotalBudget.get(categoryTotalsKey(a.projectId, allocId)) ?? 0
        : 0;
      const allocationBudget = toNum(allocation.budgetTotal);
      const denominator = summedBudget > 0 ? summedBudget : allocationBudget;
      if (denominator > 0) {
        plannedRevenue = (plannedActualTotal / denominator) * categoryRevenueAllocation;
      }
    }
    const plannedGp = plannedRevenue - plannedActualTotal;
    const plannedGpPct = plannedRevenue !== 0 ? plannedGp / plannedRevenue : null;

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
      plannedActualTotal,
      plannedRevenue,
      plannedGp,
      plannedGpPct,
      bucket: classifyBucket(
        a.invoiceNumber ?? null,
        parent?.invoiceDateFontColor ?? null,
        parent?.invoiceDateConfirmed ?? null,
        monthKey(recognitionDate),
        currentMonthKey,
      ),
      // Use invoice-date recognition only. No-invoice lines remain
      // unrecognised for actual COS/REV month rollups.
      recognitionMonth: monthKey(recognitionDate),
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
  /** Actual sums (existing fields — kept for back-compat). */
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  count: number;
  /**
   * Planned / Budget sums computed from `line.budgetTotal` (col G) +
   * `(G/I)*J`. These let the page show a forecast even when no actuals
   * exist yet.
   */
  plannedCos: number;
  plannedRevenue: number;
  plannedGp: number;
  plannedGpPct: number | null;
  /**
   * Realised-only sums (lines where `bucket === "realised"`). These
   * give the FY card "realised" tile its number.
   */
  realisedCos: number;
  realisedRevenue: number;
  realisedGp: number;
  realisedGpPct: number | null;
}

export interface BucketRollup {
  bucket: FinanceLineBucket;
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  count: number;
}

const emptyMonth = (key: string): MonthlyReconRow => ({
  monthKey: key,
  cos: 0,
  revenue: 0,
  gp: 0,
  gpPct: null,
  count: 0,
  plannedCos: 0,
  plannedRevenue: 0,
  plannedGp: 0,
  plannedGpPct: null,
  realisedCos: 0,
  realisedRevenue: 0,
  realisedGp: 0,
  realisedGpPct: null,
});

// Round to 2dp at finalisation. Per-line `+=` accumulators accumulate
// FP drift (each `Number(decimalString)` carries full FP precision);
// for large projects (hundreds of lines, R 200M+ totals) the drift
// reaches the cent level and downstream `Math.abs(a-b) <= 0.01`
// tolerance checks falsely fail. Bucketed at the finalisation step so
// intermediate per-line maths stay precise but the surfaced row is
// stable.
const r2 = (n: number): number => Number(n.toFixed(2));
const finalizeMonth = (row: MonthlyReconRow): MonthlyReconRow => {
  const rounded: MonthlyReconRow = {
    ...row,
    cos: r2(row.cos),
    revenue: r2(row.revenue),
    gp: r2(row.gp),
    plannedCos: r2(row.plannedCos),
    plannedRevenue: r2(row.plannedRevenue),
    plannedGp: r2(row.plannedGp),
    realisedCos: r2(row.realisedCos),
    realisedRevenue: r2(row.realisedRevenue),
    realisedGp: r2(row.realisedGp),
    gpPct: row.revenue !== 0 ? row.gp / row.revenue : null,
    plannedGpPct: row.plannedRevenue !== 0 ? row.plannedGp / row.plannedRevenue : null,
    realisedGpPct: row.realisedRevenue !== 0 ? row.realisedGp / row.realisedRevenue : null,
  };
  return rounded;
};

export function aggregateLinesByMonth(lines: FinanceLine[]): {
  byMonth: MonthlyReconRow[];
  unrecognised: MonthlyReconRow;
  total: MonthlyReconRow;
  byBucket: BucketRollup[];
} {
  const buckets = new Map<string, MonthlyReconRow>();
  const ensure = (key: string): MonthlyReconRow => {
    let row = buckets.get(key);
    if (!row) {
      row = emptyMonth(key);
      buckets.set(key, row);
    }
    return row;
  };

  const total = emptyMonth("total");
  const unrecognised = emptyMonth("unrecognised");
  const bucketRollup = new Map<FinanceLineBucket, BucketRollup>();
  const ensureBucket = (b: FinanceLineBucket): BucketRollup => {
    let row = bucketRollup.get(b);
    if (!row) {
      row = { bucket: b, cos: 0, revenue: 0, gp: 0, gpPct: null, count: 0 };
      bucketRollup.set(b, row);
    }
    return row;
  };

  for (const line of lines) {
    const target = line.recognitionMonth ? ensure(line.recognitionMonth) : unrecognised;

    target.cos += line.actualTotal;
    target.revenue += line.perLineRevenue;
    target.gp += line.perLineGp;
    target.count += 1;
    target.plannedCos += line.plannedActualTotal;
    target.plannedRevenue += line.plannedRevenue;
    target.plannedGp += line.plannedGp;
    if (line.bucket === "realised") {
      target.realisedCos += line.actualTotal;
      target.realisedRevenue += line.perLineRevenue;
      target.realisedGp += line.perLineGp;
    }

    total.cos += line.actualTotal;
    total.revenue += line.perLineRevenue;
    total.gp += line.perLineGp;
    total.count += 1;
    total.plannedCos += line.plannedActualTotal;
    total.plannedRevenue += line.plannedRevenue;
    total.plannedGp += line.plannedGp;
    if (line.bucket === "realised") {
      total.realisedCos += line.actualTotal;
      total.realisedRevenue += line.perLineRevenue;
      total.realisedGp += line.perLineGp;
    }

    const br = ensureBucket(line.bucket);
    br.cos += line.actualTotal;
    br.revenue += line.perLineRevenue;
    br.gp += line.perLineGp;
    br.count += 1;
  }

  const byMonth = Array.from(buckets.values())
    .map(finalizeMonth)
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  const byBucket: BucketRollup[] = Array.from(bucketRollup.values()).map((b) => ({
    ...b,
    gpPct: b.revenue !== 0 ? b.gp / b.revenue : null,
  }));

  return {
    byMonth,
    unrecognised: finalizeMonth(unrecognised),
    total: finalizeMonth(total),
    byBucket,
  };
}
