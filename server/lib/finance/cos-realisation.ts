export interface CosLineInput {
  status: string | null;
  cosStatusOverride: string | null;
  cosRealised: boolean | null;
  expenseInvoiceNumber: string | null;
  expenseInvoicedDate: string | null;
  expensePoNumber: string | null;
  paymentDate: string | null;
  today: string;
  /** Actual cost amount. When provided, zero-amount lines are not considered realised. */
  amountExVat?: string | number | null;
  /**
   * Invoice-date confirmation signal from the source sheet.
   *   - 'black' = finance has confirmed the invoice date (realised gate satisfied)
   *   - 'red'   = invoice date captured but not yet confirmed (NOT realised)
   * When the column is missing entirely, callers may also pass
   * invoiceDateConfirmed instead. If neither field is supplied the function
   * falls back to the legacy invoice-only behaviour for backward compatibility.
   */
  invoiceDateFontColor?: string | null;
  /** Boolean equivalent of black-font confirmation. */
  invoiceDateConfirmed?: boolean | null;
  /** Allocation-aware QB evidence total assigned to this line (ex-VAT). */
  lineAssignedQbExVat?: number | null;
  /** Optional precomputed line amount (ex-VAT). Falls back to amountExVat. */
  lineAmountExVat?: number | null;
}

/**
 * Placeholder invoice values that do not indicate a captured supplier invoice.
 * Used both here (runtime check) and in the normalizer (import-time derivation).
 */
export const PLACEHOLDER_INVOICES = new Set([
  "tbc", "tba", "pending", "n/a", "to follow", "to be confirmed",
  "000", "0", "na", "none", "-", "tbd",
]);

/**
 * Admin override sets for manual COS status control.
 * These are the ONLY values that can force realisation or block it via override.
 */
export const OVERRIDE_REALISED = new Set(["COS REALISED", "REALISED"]);
export const OVERRIDE_NOT_REALISED = new Set(["PLANNED", "COMMITTED", "INVOICED", "APPROVED", "PAID"]);

/**
 * Canonical COS Realisation Check — SINGLE SOURCE OF TRUTH
 *
 * Business rules (do not reinterpret):
 *   1. Admin override takes absolute precedence.
 *   2. Invoice number must be a valid (non-placeholder) supplier invoice.
 *   3. Invoice date must be CONFIRMED. Confirmation comes from one of:
 *        - invoiceDateFontColor === 'black' (finance team's manual signal),
 *        - invoiceDateConfirmed === true.
 *      Red font means the date is captured but not yet confirmed → NOT
 *      realised. This is the gate that prevents the COS Tracker / Revenue
 *      Tracker / dashboards from over-counting unconfirmed lines.
 *   4. PO is NOT the gate for realisation.
 *   5. Invoice without PO is a red flag but does NOT block realisation.
 *   6. Status labels alone do NOT determine realisation.
 *   7. "Committed from prior month" does NOT silently become realised
 *      unless it has an invoice + black-font date.
 *   8. cosRealised boolean flag is respected as backward-compatible signal
 *      for legacy rows that were correctly marked during import.
 *
 * Backward compat: if the caller does NOT supply ANY confirmation signal
 * (invoiceDateFontColor === undefined AND invoiceDateConfirmed === undefined)
 * the function falls back to the legacy invoice-only behaviour. Once a
 * caller starts providing either field the strict gate engages. New callers
 * should always pass the confirmation fields.
 *
 * The `today` parameter is accepted for interface stability but is no longer
 * used in the core check — the rule does not depend on date comparison.
 * Month bucketing for period reporting is a separate concern handled by
 * getCosEffectiveDateAndSource().
 */
export function isCanonicalCosRealised(input: CosLineInput): boolean {
  // 1. Admin override takes absolute precedence.
  const override = (input.cosStatusOverride ?? "").toUpperCase().trim();
  if (OVERRIDE_REALISED.has(override)) return true;
  if (OVERRIDE_NOT_REALISED.has(override)) return false;

  // 2. QB evidence is truth. When a QB bill has been captured (and allocated
  //    to this line) the line is realised regardless of Excel font-colour
  //    ambiguity. Excel font-colour remains the fallback when QB is silent.
  const qbEvidence =
    typeof input.lineAssignedQbExVat === "number" && Number.isFinite(input.lineAssignedQbExVat)
      ? input.lineAssignedQbExVat
      : 0;
  if (qbEvidence > 0) return true;

  // 3. Invoice number check — must be a valid (non-placeholder) supplier invoice.
  //    Status labels (INVOICED, PAID, etc.) do NOT independently gate this.
  const invoiceTrimmed = (input.expenseInvoiceNumber ?? "").trim();
  const hasInvoice = !!invoiceTrimmed;
  const isPlaceholder = hasInvoice && PLACEHOLDER_INVOICES.has(invoiceTrimmed.toLowerCase());

  if (hasInvoice && !isPlaceholder) {
    // 3a. Zero-amount lines are not realised (no actual cost = nothing to realise).
    if (input.amountExVat !== undefined && input.amountExVat !== null) {
      const amount = typeof input.amountExVat === "number" ? input.amountExVat : parseFloat(String(input.amountExVat));
      if (!isNaN(amount) && amount === 0) return false;
    }

    // 3b. Invoice-date-confirmed gate. Black font OR confirmed=true.
    //     If neither field is supplied the caller is on the legacy contract
    //     and we fall through to the old "invoice alone = realised" rule.
    const fontColorProvided = input.invoiceDateFontColor !== undefined;
    const confirmedProvided = input.invoiceDateConfirmed !== undefined;
    if (fontColorProvided || confirmedProvided) {
      const blackFont = String(input.invoiceDateFontColor ?? "").toLowerCase() === "black";
      const confirmedFlag = input.invoiceDateConfirmed === true;
      return blackFont || confirmedFlag;
    }

    return true;
  }

  // 4. Legacy cosRealised boolean — backward-compatible signal for rows
  //    that were marked during import. Respected but should be migrated
  //    to invoice-based tracking over time.
  if (input.cosRealised === true) return true;

  return false;
}

/**
 * Diagnostic: flags risk conditions on a COS line.
 * Call after isCanonicalCosRealised() returns true to surface data-quality warnings.
 *
 * Possible warnings:
 *   - INVOICE_WITHOUT_PO: Invoice captured but no PO on file (red flag per business rules)
 *   - INVOICE_WITHOUT_DATE: Invoice number present but no invoice date — realised for
 *     totals but cannot be month-bucketed (the open edge case)
 */
export function getCosRealisationWarnings(input: CosLineInput): string[] {
  const warnings: string[] = [];
  if (!isCanonicalCosRealised(input)) return warnings;

  const hasInvoice = !!(input.expenseInvoiceNumber && input.expenseInvoiceNumber.trim());
  const hasInvoiceDate = !!(input.expenseInvoicedDate && input.expenseInvoicedDate.trim());
  const hasPo = !!(input.expensePoNumber && input.expensePoNumber.trim());

  const invoiceTrimmedW = (input.expenseInvoiceNumber ?? "").trim();
  const isPlaceholderW = !!invoiceTrimmedW && PLACEHOLDER_INVOICES.has(invoiceTrimmedW.toLowerCase());

  const qbEvidence =
    typeof input.lineAssignedQbExVat === "number" && Number.isFinite(input.lineAssignedQbExVat)
      ? input.lineAssignedQbExVat
      : 0;

  if (isPlaceholderW) {
    warnings.push("PLACEHOLDER_INVOICE");
  }
  if (hasInvoice && !hasPo) {
    warnings.push("INVOICE_WITHOUT_PO");
  }
  if (hasInvoice && !hasInvoiceDate) {
    warnings.push("INVOICE_WITHOUT_DATE");
  }

  // H7: flag lines that are realised via Excel font-colour only (no QB
  // evidence). These are lower-confidence realisations per policy:
  // "QB if captured is truth; red is still used in Excel as a fallback."
  const fontOnly =
    qbEvidence <= 0 &&
    hasInvoice &&
    !isPlaceholderW &&
    (String(input.invoiceDateFontColor ?? "").toLowerCase() === "black" ||
      input.invoiceDateConfirmed === true);
  if (fontOnly) {
    warnings.push("REALISED_BY_FONT_COLOR_ONLY");
  }

  return warnings;
}
