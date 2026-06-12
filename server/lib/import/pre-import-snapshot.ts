/**
 * Pre-import snapshot — per-project, both tracker sheets.
 *
 * Before a Smart Import commit overwrites a project's finance ledgers, we
 * capture the set of ACTIVE (`effective_to IS NULL`) row ids across both
 * tracker sheets — the Expenditure Breakdown ledger (cost lines + their
 * actuals) and the Revenue Tracking ledger (milestone lines). A one-click
 * revert then re-opens exactly that pre-import active set, so rolling back a
 * committed import restores the project to its prior state instead of leaving
 * the changed lines soft-closed with no active version.
 *
 * The ids are stored on `smart_import_runs.pre_import_snapshot` alongside the
 * work_items snapshot:
 *   { workItems: [...], financeLineIds: { costLines, revenueLines, costLineActuals } }
 *
 * Re-opening is safe under the partial UNIQUE index on
 * (key, row_hash) WHERE effective_to IS NULL AND deleted_at IS NULL because the
 * revert soft-closes this run's inserts FIRST, so at most one active row per
 * hash exists at any point.
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  normalizedCostLines,
  normalizedRevenueLines,
  normalizedCostLineActuals,
} from "@shared/schema";

export interface FinanceLineIdSnapshot {
  costLines: number[];
  revenueLines: number[];
  costLineActuals: number[];
}

export interface PreImportSnapshot {
  workItems: unknown[];
  financeLineIds: FinanceLineIdSnapshot;
}

/** Capture the active finance-line ids for a project, inside the commit tx. */
export async function captureFinanceLineIds(
  tx: {
    select: (...args: unknown[]) => any;
  },
  projectId: number,
): Promise<FinanceLineIdSnapshot> {
  const [costLines, revenueLines, costLineActuals] = await Promise.all([
    tx
      .select({ id: normalizedCostLines.id })
      .from(normalizedCostLines)
      .where(and(eq(normalizedCostLines.projectId, projectId), isNull(normalizedCostLines.effectiveTo))),
    tx
      .select({ id: normalizedRevenueLines.id })
      .from(normalizedRevenueLines)
      .where(and(eq(normalizedRevenueLines.projectId, projectId), isNull(normalizedRevenueLines.effectiveTo))),
    tx
      .select({ id: normalizedCostLineActuals.id })
      .from(normalizedCostLineActuals)
      .where(and(eq(normalizedCostLineActuals.projectId, projectId), isNull(normalizedCostLineActuals.effectiveTo))),
  ]);
  return {
    costLines: (costLines as Array<{ id: number }>).map((r) => r.id),
    revenueLines: (revenueLines as Array<{ id: number }>).map((r) => r.id),
    costLineActuals: (costLineActuals as Array<{ id: number }>).map((r) => r.id),
  };
}

/**
 * Read the finance-line ids from a stored pre-import snapshot, tolerating the
 * legacy shape (a bare work_items array, captured before this field existed).
 */
export function readFinanceLineIds(snapshot: unknown): FinanceLineIdSnapshot | null {
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== "object") return null;
  const fids = (snapshot as { financeLineIds?: unknown }).financeLineIds;
  if (!fids || typeof fids !== "object") return null;
  const f = fids as Partial<FinanceLineIdSnapshot>;
  return {
    costLines: Array.isArray(f.costLines) ? f.costLines : [],
    revenueLines: Array.isArray(f.revenueLines) ? f.revenueLines : [],
    costLineActuals: Array.isArray(f.costLineActuals) ? f.costLineActuals : [],
  };
}
