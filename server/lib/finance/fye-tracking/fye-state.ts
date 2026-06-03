/**
 * FYE Tracking — per-line recognition STATE (4-way).
 *
 * The FYE workbook partitions every FY line into one of four states by the
 * invoice number and the colour of the INVOICE RAISED DATE cell (§ 3.2 / § 3.7
 * — BLACK = confirmed, RED = pending/forecast):
 *
 *   invoice_no present + BLACK date                -> Realised
 *   invoice_no present + RED date                  -> Committed
 *   no invoice_no + RED + invoice_date in future   -> Planned
 *   no invoice_no (otherwise)                       -> Unrealised
 *
 * Budget (the "everything planned in FY26" figure) is the sum over ALL four
 * states; Actual is the Realised state only. The four states therefore
 * partition Budget exactly — a property the reconciliation test asserts.
 *
 * This is a *presentation grouping* over the canonical per-line revenue/COS
 * produced by `finance-line-level-repository` (the single § 3.3 read path). It
 * does not change any revenue/COS formula. The Realised state is defined to
 * coincide with that repository's `bucket === "realised"` so "Actual =
 * Realised" reconciles to the existing finance trackers to the cent.
 */

export type FyeState = "realised" | "committed" | "planned" | "unrealised";

export const FYE_STATES: readonly FyeState[] = ["realised", "committed", "planned", "unrealised"];

/** Placeholder invoice tokens that do not count as a captured invoice.
 * Mirrors PLACEHOLDER_INVOICES in cos-realisation.ts (kept local to avoid a
 * cross-import for a tiny set; both must stay in sync). */
const PLACEHOLDER_INVOICES = new Set([
  "tbc", "tba", "pending", "n/a", "to follow", "to be confirmed",
  "000", "0", "na", "none", "-", "tbd",
]);

export interface FyeStateInput {
  /** Supplier invoice number on the line (Excel "INVOICE NUMBER"). */
  invoiceNumber: string | null | undefined;
  /** Resolved colour of the INVOICE RAISED DATE cell ("black" | "red" | hex). */
  invoiceDateFontColor?: string | null;
  /** Boolean equivalent of black-font confirmation (true = BLACK/confirmed). */
  invoiceDateConfirmed?: boolean | null;
  /** ISO (YYYY-MM-DD) invoice raised date — drives the future-dated test. */
  invoiceRaisedDate?: string | null;
}

function hasRealInvoice(invoiceNumber: string | null | undefined): boolean {
  const trimmed = String(invoiceNumber ?? "").trim();
  if (!trimmed) return false;
  return !PLACEHOLDER_INVOICES.has(trimmed.toLowerCase());
}

/**
 * BLACK/confirmed signal. Defined identically to `classifyBucket` in
 * finance-line-level-repository so the Realised state == the repo's realised
 * bucket. A line is confirmed when the font is explicitly black OR the
 * confirmed flag is true. (No-signal lines are NOT auto-confirmed here — they
 * fall to Committed when they carry an invoice, matching the repo.)
 */
function isConfirmedBlack(input: FyeStateInput): boolean {
  return (
    String(input.invoiceDateFontColor ?? "").toLowerCase() === "black" ||
    input.invoiceDateConfirmed === true
  );
}

/** RED signal: font explicitly red, or the confirmed flag is explicitly false. */
function isRed(input: FyeStateInput): boolean {
  return (
    String(input.invoiceDateFontColor ?? "").toLowerCase() === "red" ||
    input.invoiceDateConfirmed === false
  );
}

/**
 * Classify a single FY line into its recognition state.
 *
 * @param today ISO (YYYY-MM-DD) "today" anchor for the future-dated Planned
 *        test. Pass the SAST-anchored today so the boundary matches the rest
 *        of the finance stack.
 */
export function classifyFyeState(input: FyeStateInput, today: string): FyeState {
  if (hasRealInvoice(input.invoiceNumber)) {
    return isConfirmedBlack(input) ? "realised" : "committed";
  }
  // No invoice number.
  const raised = (input.invoiceRaisedDate ?? "").slice(0, 10);
  if (isRed(input) && raised && raised > today) {
    return "planned";
  }
  return "unrealised";
}
