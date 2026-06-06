/**
 * Finance provenance / reconciliation — canonical compute + persist helpers.
 *
 * Purpose (additive only — NO calculation change, NO change to which value is
 * REPORTED): keep `revenue_derived` / `revenue_stored` / `recon_delta` current
 * on `normalized_cost_line_actuals` on every import/recompute, so the drift
 * between the pasted workbook value (Excel col U) and the owner-canonical
 * formula (AGENT_GUARDRAILS § 3.3) is always measurable.
 *
 *   revenue_derived  — STRICT § 3.3 (Q/X)×J: (actual_total /
 *                      category.totalActualTotal) × category.revenueAllocation,
 *                      computed via the SINGLE source of truth
 *                      `deriveFinanceLinesFromRows`. col U is nulled on the
 *                      inputs so the derivation never short-circuits to the
 *                      persisted value — that is the whole point of the
 *                      cross-check. The category total X is summed over actuals
 *                      rows only (no parent synthesis), exactly as § 3.3 defines.
 *   revenue_stored   — the pasted col-U value (`revenue_recognition_amount`).
 *   recon_delta      — revenue_stored − revenue_derived (null when no stored).
 *   recon_exceeds    — |recon_delta| > R1 — flags the line for the
 *                      reconciliation board (P2.2). Null until first computed.
 *
 * `revenue_derived` is the owner-canonical figure; `revenue_stored` is the
 * cross-check. This module does NOT change which value any read path REPORTS —
 * the reported figure stays whatever `finance-line-level-repository.ts`
 * produces (today: prefer persisted col U). The columns here are diagnostics
 * the reconciliation board and the exposure report read; the FY card / recon
 * grid / page totals never consume them.
 *
 * `recognition_method` / `colour_source` are importer-owned provenance (set at
 * insert by `writeActualLineRows`). The on-recompute refresh does NOT touch
 * them — only the one-off historical backfill writes them (see
 * `includeMethodColumns`).
 */

import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  categoryRevenueAllocations,
  normalizedCostLineActuals,
  normalizedCostLines,
} from "@shared/schema/finance";
import { db } from "../../db";
import {
  deriveFinanceLinesFromRows,
  type FinanceLineActualsRowInput,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../../repositories/finance-line-level-repository";

/**
 * |recon_delta| strictly greater than this (Rand) flags a line for the
 * reconciliation board. R1 = R1.00 — the same tolerance the § 3.3.2 persisted
 * ↔ derived parity audit uses.
 */
export const RECON_DELTA_R1 = 1;

/** A drizzle database handle OR a transaction handle — both expose the
 *  query-builder surface these helpers use. Mirrors the repository's
 *  `dbInstance?: typeof db` convention. */
export type DbOrTx = typeof db;

export interface ProvenanceUpdate {
  id: number;
  revenueDerived: string;
  revenueStored: string | null;
  reconDelta: string | null;
  /** |recon_delta| > R1. False when there is a stored value within R1; false
   *  when there is no stored value to compare (nothing to reconcile). */
  reconExceeds: boolean;
  recognitionMethod: string | null;
  colourSource: string | null;
}

/**
 * Pure computation — given the three live row arrays for a scope, produce the
 * provenance update payload for every actuals row. Reuses the canonical § 3.3
 * derivation; no formula is re-implemented here.
 */
export function computeProvenanceUpdates(
  actualsRows: FinanceLineActualsRowInput[],
  parentRows: FinanceLineParentRowInput[],
  allocationRows: FinanceLineAllocationRowInput[],
): ProvenanceUpdate[] {
  // Null col U on copies so deriveFinanceLinesFromRows always computes the
  // (Q/X)×J value rather than preferring the persisted col-U figure. No parent
  // synthesis — § 3.3 sums X over actuals rows only.
  const actualsForDerivation: FinanceLineActualsRowInput[] = actualsRows.map((r) => ({
    ...r,
    revenueRecognitionAmount: null,
  }));
  const parentsForDerivation: FinanceLineParentRowInput[] = parentRows.map((p) => ({
    ...p,
    revenueRecognitionAmount: null,
  }));

  const lines = deriveFinanceLinesFromRows(
    actualsForDerivation,
    parentsForDerivation,
    allocationRows,
  );
  const derivedById = new Map<number, number>();
  for (const line of lines) derivedById.set(line.lineId, line.perLineRevenue);

  const updates: ProvenanceUpdate[] = [];
  for (const a of actualsRows) {
    const derived = derivedById.get(a.id) ?? 0;

    const storedRaw = a.revenueRecognitionAmount;
    const parsedStored =
      storedRaw == null || storedRaw === "" ? null : Number(storedRaw);
    const storedNum =
      parsedStored != null && Number.isFinite(parsedStored) ? parsedStored : null;

    const revenueDerived = derived.toFixed(2);
    const revenueStored = storedNum != null ? String(storedRaw) : null;
    const reconDeltaNum = storedNum != null ? storedNum - derived : null;
    const reconDelta = reconDeltaNum != null ? reconDeltaNum.toFixed(2) : null;
    const reconExceeds = reconDeltaNum != null && Math.abs(reconDeltaNum) > RECON_DELTA_R1;

    const hasInvoice = !!(a.invoiceNumber && String(a.invoiceNumber).trim());
    const hasPaymentDate = !!a.financePaymentDate;
    const recognitionMethod = hasInvoice
      ? "true_invoice"
      : hasPaymentDate
        ? "payment_derived"
        : null;

    const colour = a.invoiceDateFontColor;
    const colourRead = colour != null && String(colour).trim() !== "";
    const colourSource = colourRead ? "read" : hasInvoice ? "defaulted" : null;

    updates.push({
      id: a.id,
      revenueDerived,
      revenueStored,
      reconDelta,
      reconExceeds,
      recognitionMethod,
      colourSource,
    });
  }
  return updates;
}

/**
 * Load the three live, snapshot-guarded input arrays for a provenance compute.
 * `projectIds === null` loads every project (the one-off backfill); a non-empty
 * array scopes to those projects (the per-import recompute passes `[projectId]`).
 *
 * Snapshot guard (§ 3.1) applied to all three tables; `deleted_at IS NULL`
 * matches the canonical read path in finance-line-level-repository.ts.
 */
export async function loadProvenanceInputs(
  dbi: DbOrTx,
  projectIds: number[] | null,
): Promise<{
  actualsRows: FinanceLineActualsRowInput[];
  parentRows: FinanceLineParentRowInput[];
  allocationRows: FinanceLineAllocationRowInput[];
}> {
  // An empty scope means "no projects" — return nothing rather than load all.
  if (projectIds != null && projectIds.length === 0) {
    return { actualsRows: [], parentRows: [], allocationRows: [] };
  }

  const actualsConds = [
    isNull(normalizedCostLineActuals.effectiveTo),
    isNull(normalizedCostLineActuals.deletedAt),
  ];
  if (projectIds != null) {
    actualsConds.push(inArray(normalizedCostLineActuals.projectId, projectIds));
  }
  const actualsRows = (await dbi
    .select({
      id: normalizedCostLineActuals.id,
      costLineId: normalizedCostLineActuals.costLineId,
      projectId: normalizedCostLineActuals.projectId,
      actualTotal: normalizedCostLineActuals.actualTotal,
      poNumber: normalizedCostLineActuals.poNumber,
      invoiceNumber: normalizedCostLineActuals.invoiceNumber,
      invoiceDate: normalizedCostLineActuals.invoiceDate,
      invoiceDateFontColor: normalizedCostLineActuals.invoiceDateFontColor,
      invoiceDateConfirmed: normalizedCostLineActuals.invoiceDateConfirmed,
      financePaymentDate: normalizedCostLineActuals.financePaymentDate,
      description: normalizedCostLineActuals.description,
      qty: normalizedCostLineActuals.qty,
      rate: normalizedCostLineActuals.rate,
      revenueRecognitionAmount: normalizedCostLineActuals.revenueRecognitionAmount,
    })
    .from(normalizedCostLineActuals)
    .where(and(...actualsConds))) as FinanceLineActualsRowInput[];

  const parentConds = [
    isNull(normalizedCostLines.effectiveTo),
    isNull(normalizedCostLines.deletedAt),
  ];
  if (projectIds != null) {
    parentConds.push(inArray(normalizedCostLines.projectId, projectIds));
  }
  const parentRows = (await dbi
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
    .where(and(...parentConds))) as FinanceLineParentRowInput[];

  const allocationConds = [isNull(categoryRevenueAllocations.effectiveTo)];
  if (projectIds != null) {
    allocationConds.push(inArray(categoryRevenueAllocations.projectId, projectIds));
  }
  const allocationRows = (await dbi
    .select({
      id: categoryRevenueAllocations.id,
      projectId: categoryRevenueAllocations.projectId,
      categoryKey: categoryRevenueAllocations.categoryKey,
      categoryName: categoryRevenueAllocations.categoryName,
      categoryNumber: categoryRevenueAllocations.categoryNumber,
      revenueAllocation: categoryRevenueAllocations.revenueAllocation,
      budgetTotal: categoryRevenueAllocations.budgetTotal,
    })
    .from(categoryRevenueAllocations)
    .where(and(...allocationConds))) as FinanceLineAllocationRowInput[];

  return { actualsRows, parentRows, allocationRows };
}

export interface WriteProvenanceOptions {
  /**
   * When true, ALSO writes the importer-owned `recognition_method` /
   * `colour_source` columns (the one-off historical backfill needs this).
   * The per-import recompute leaves them false so the importer's
   * authoritative `colour_source` is never overwritten.
   */
  includeMethodColumns?: boolean;
  /** Rows per batched write. */
  chunkSize?: number;
}

/**
 * Persist the provenance updates, snapshot-guarded. Each UPDATE is keyed by the
 * row's PK AND `effective_to IS NULL`, so only the live row is touched and
 * temporal history is preserved. Writes the reconciliation columns
 * (`revenue_derived` / `revenue_stored` / `recon_delta` / `recon_exceeds`)
 * always; the method columns only when `includeMethodColumns` is set.
 */
export async function writeProvenanceUpdates(
  dbi: DbOrTx,
  updates: ProvenanceUpdate[],
  opts: WriteProvenanceOptions = {},
): Promise<number> {
  const includeMethodColumns = opts.includeMethodColumns ?? false;
  const chunk = opts.chunkSize ?? 100;
  let written = 0;
  for (let i = 0; i < updates.length; i += chunk) {
    const slice = updates.slice(i, i + chunk);
    await Promise.all(
      slice.map((u) => {
        const set: Record<string, unknown> = {
          revenueDerived: u.revenueDerived,
          revenueStored: u.revenueStored,
          reconDelta: u.reconDelta,
          reconExceeds: u.reconExceeds,
        };
        if (includeMethodColumns) {
          set.recognitionMethod = u.recognitionMethod;
          set.colourSource = u.colourSource;
        }
        return dbi
          .update(normalizedCostLineActuals)
          .set(set)
          .where(
            and(
              eq(normalizedCostLineActuals.id, u.id),
              isNull(normalizedCostLineActuals.effectiveTo),
            ),
          );
      }),
    );
    written += slice.length;
  }
  return written;
}

export interface ProvenanceRefreshSummary {
  scanned: number;
  withStored: number;
  flagged: number;
  maxAbsDelta: number;
  sumDerived: number;
  written: number;
}

/**
 * Load → compute → persist the reconciliation columns for a project scope.
 * This is the on-recompute hook: the smart-import commit calls it (within its
 * transaction) after the cost lines, actuals, and category allocations are
 * written + relinked, so `revenue_derived` / `revenue_stored` / `recon_delta` /
 * `recon_exceeds` reflect the final committed state of the import.
 *
 * Does NOT write `recognition_method` / `colour_source` (importer-owned) and
 * does NOT change which value any read path reports.
 */
export async function refreshProvenanceForProjects(
  dbi: DbOrTx,
  projectIds: number[] | null,
): Promise<ProvenanceRefreshSummary> {
  const { actualsRows, parentRows, allocationRows } = await loadProvenanceInputs(
    dbi,
    projectIds,
  );

  if (actualsRows.length === 0) {
    return { scanned: 0, withStored: 0, flagged: 0, maxAbsDelta: 0, sumDerived: 0, written: 0 };
  }

  const updates = computeProvenanceUpdates(actualsRows, parentRows, allocationRows);

  let withStored = 0;
  let flagged = 0;
  let maxAbsDelta = 0;
  let sumDerived = 0;
  for (const u of updates) {
    sumDerived += Number(u.revenueDerived);
    if (u.revenueStored != null) withStored += 1;
    if (u.reconExceeds) flagged += 1;
    if (u.reconDelta != null) {
      maxAbsDelta = Math.max(maxAbsDelta, Math.abs(Number(u.reconDelta)));
    }
  }

  const written = await writeProvenanceUpdates(dbi, updates);
  return { scanned: updates.length, withStored, flagged, maxAbsDelta, sumDerived, written };
}
