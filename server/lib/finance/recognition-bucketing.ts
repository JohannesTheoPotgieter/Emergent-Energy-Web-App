/**
 * Recognition-bucketing helper for monthly revenue / COS / GP rollups.
 *
 * Consolidates the per-line iteration that every monthly tracker handler
 * was rebuilding inline:
 *   - skip non-`item` rows
 *   - parse `expenseActualTotal` → cost amount
 *   - derive COS month key from `getCosEffectiveDateAndSource`
 *   - call `recognitionAmountFor(exp)` for the per-line POC revenue
 *   - call `isEffectivelyRealised(exp, monthKey, currentMonthKey)` for the
 *     realised classification
 *   - strip `_Tracker` suffix from `projectName`
 *
 * Routes recognition reads through one canonical path per § 3.3.2 of
 * `docs/AGENT_GUARDRAILS.md`: no handler should compute the per-line POC
 * revenue inline. Callers reduce the returned stream into whichever
 * shape they need (by-month total, by-project sub-map, single-month
 * item list).
 *
 * This is a PURE in-memory helper — it does not query the DB. The
 * `expenses` array is supplied by the route after its existing
 * `getCanonical*` repository call.
 */

import {
  recognitionAmountFor,
  type CostLineForRecognition,
} from "./revenue-recognition";
import { isPastMonthAutoRealised } from "./cos-realisation";
import { getCosEffectiveDateAndSource } from "../expense-row-selector";
import {
  extractMonthKey,
  isCosRealised,
  parseExpenseAmount,
} from "../calculations/financeUtils";

/** One line, bucketed for monthly rollups. */
export interface RecognitionBucketedLine<T extends CostLineForRecognition = CostLineForRecognition> {
  /** Original row, passed through so callers can read row-specific extras. */
  exp: T;
  /** Cost amount (parsed `expenseActualTotal`). Always non-zero. */
  amount: number;
  /** YYYY-MM month key derived from `getCosEffectiveDateAndSource`. */
  monthKey: string;
  /** Per-line POC revenue. Reads `recognitionAmountFor(exp)`. */
  revenueAmount: number;
  /** True when the underlying COS line is effectively realised. */
  cosRealised: boolean;
  /** Project name with `_Tracker` suffix stripped (may be empty string). */
  projectName: string;
}

export interface BucketCostLinesOptions {
  /** Current YYYY-MM month key (UTC) — passed through to `isEffectivelyRealised`. */
  currentMonthKey: string;
}

/**
 * Local-shadow `isEffectivelyRealised`. Audit follow-up: must NOT swap to
 * the canonical `isEffectivelyRealised` from `cos-realisation.ts`. The
 * canonical applies a zero-amount gate on `input.amountExVat` (cos-
 * realisation.ts:99-102) that would silently flip zero-amount invoiced
 * lines from realised → unrealised. The 6 monthly-rollup handlers feed
 * `adaptCostToExpense`-shaped rows where `amountExVat` is renamed to
 * `expenseActualTotal` and the top-level `amountExVat` is dropped, so
 * the gate currently no-ops by accident — but relying on that accident
 * is brittle. The financeUtils `isCosRealised` wrapper deliberately
 * does NOT forward `amountExVat`, so it preserves the documented
 * "invoice alone = realised even at zero amount" behaviour that the 6
 * handlers expected before this refactor.
 */
function isEffectivelyRealisedLocal(exp: CostLineForRecognition, monthKey: string | null, currentMonthKey: string): boolean {
  if (isPastMonthAutoRealised(exp as any, monthKey, currentMonthKey)) return true;
  if (!isCosRealised(exp as any)) return false;
  return monthKey ? monthKey <= currentMonthKey : true;
}

/**
 * Iterate `expenses` once and emit a normalised stream of bucketed lines.
 * Lines that fail any of the standard filters (non-item, zero amount,
 * missing COS date) are silently dropped — callers can rely on the
 * output set containing only valid recognition-eligible rows.
 */
export function bucketCostLinesForRecognition<T extends CostLineForRecognition & {
  expenseActualTotal?: string | number | null;
  rowType?: string | null;
  projectName?: string | null;
}>(
  expenses: T[],
  options: BucketCostLinesOptions,
): RecognitionBucketedLine<T>[] {
  const out: RecognitionBucketedLine<T>[] = [];
  for (const exp of expenses) {
    if (exp.rowType !== "item") continue;
    const amount = parseExpenseAmount(exp);
    if (amount === 0) continue;

    const { date: cosDate } = getCosEffectiveDateAndSource(exp);
    const monthKey = extractMonthKey(cosDate);
    if (!monthKey) continue;

    const revenueAmount = recognitionAmountFor(exp);
    const cosRealised = isEffectivelyRealisedLocal(exp, monthKey, options.currentMonthKey);
    const projectName = (exp.projectName || "").replace(/_Tracker$/i, "");

    out.push({ exp, amount, monthKey, revenueAmount, cosRealised, projectName });
  }
  return out;
}
