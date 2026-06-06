/**
 * COS line-review period-lock date matrix (R1).
 *
 * Pure classification of which effective dates a line-review action must
 * period-lock guard, mirroring the QB cascade's `cascadeAffectedDates`. Kept
 * pure (no DB, no clock) so the matrix is unit-pinned and can't silently
 * regress: a recognition MOVE must be guarded on BOTH the source month (where
 * the line sits today) and the target month (where it would land); a remove on
 * the line's current recognition month.
 *
 * The recognition date is `recognitionDateOverride ?? invoiceDate` (§ 3.3).
 */
export type CosLineReviewAction =
  | "move_period"
  | "set_invoice_date"
  | "clear_override"
  | "remove";

export interface CosLineRecognitionSnapshot {
  /** Imported invoice-raised date (col T). */
  invoiceDate: string | null;
  /** Human-corrected recognition date, when the line has been moved. */
  recognitionDateOverride: string | null;
}

/**
 * @param newOverride the recognition-date override being written by the action
 *   (move / set). Ignored for "remove"; for "clear_override" the target is the
 *   imported invoice date — where the line lands once the override is gone.
 * @returns the de-duplicated, non-null effective dates to pass to the period
 *   lock guard.
 */
export function cosLineReviewAffectedDates(
  action: CosLineReviewAction,
  snapshot: CosLineRecognitionSnapshot,
  newOverride: string | null,
): string[] {
  const source = snapshot.recognitionDateOverride ?? snapshot.invoiceDate ?? null;

  if (action === "remove") {
    return dedupe([source]);
  }

  const target =
    action === "clear_override"
      ? snapshot.invoiceDate ?? null
      : newOverride ?? snapshot.invoiceDate ?? null;

  return dedupe([source, target]);
}

function dedupe(dates: Array<string | null>): string[] {
  const out: string[] = [];
  for (const d of dates) {
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}
