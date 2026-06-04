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
import { classifyFyeState } from "./fye-tracking/fye-state";
import { getCosEffectiveDateAndSource } from "../expense-row-selector";
import {
  extractMonthKey,
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
 * Realised classification is now the single FYE rule (`classifyFyeState`):
 * a line is realised iff it carries a real (non-placeholder) invoice AND the
 * invoice date is BLACK / confirmed. Consolidated 2026-06 so every tracker
 * surface — the Revenue / COS / GP tabs and these drilldown drawers — shares
 * ONE realised rule and reconciles to the trackers. (The older
 * `isCanonicalCosRealised` path is no longer used by any tracker tab; it
 * remains the gate for non-tracker surfaces such as cashflow.) The
 * current-month clamp below is kept so future months never count as realised.
 */

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
  // SAST "today" anchor for classifyFyeState. It only affects the no-invoice
  // Planned/Unrealised split, so it does not change the realised flag we read.
  const today = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const exp of expenses) {
    if (exp.rowType !== "item") continue;
    const amount = parseExpenseAmount(exp);
    if (amount === 0) continue;

    const { date: cosDate } = getCosEffectiveDateAndSource(exp);
    const monthKey = extractMonthKey(cosDate);
    if (!monthKey) continue;

    const revenueAmount = recognitionAmountFor(exp);
    const r = exp as CostLineForRecognition & {
      expenseInvoiceNumber?: string | null;
      invoiceDateFontColor?: string | null;
      invoiceDateConfirmed?: boolean | null;
      expenseInvoicedDate?: string | null;
    };
    const cosRealised =
      classifyFyeState(
        {
          invoiceNumber: r.expenseInvoiceNumber ?? null,
          invoiceDateFontColor: r.invoiceDateFontColor ?? null,
          invoiceDateConfirmed: r.invoiceDateConfirmed ?? null,
          invoiceRaisedDate: r.expenseInvoicedDate ?? null,
        },
        today,
      ) === "realised" && monthKey <= options.currentMonthKey;
    const projectName = (exp.projectName || "").replace(/_Tracker$/i, "");

    out.push({ exp, amount, monthKey, revenueAmount, cosRealised, projectName });
  }
  return out;
}
