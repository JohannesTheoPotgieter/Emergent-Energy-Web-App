export interface CosLineInput {
  status: string | null;
  cosStatusOverride: string | null;
  cosRealised: boolean | null;
  expenseInvoiceNumber: string | null;
  expenseInvoicedDate: string | null;
  expensePoNumber: string | null;
  paymentDate: string | null;
  today: string;
}

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
 *   2. Invoice number is the ONLY hard check.
 *      If a supplier invoice is captured under actuals, COS is realised.
 *   3. PO is NOT the gate for realisation.
 *   4. Invoice without PO is a red flag but does NOT block realisation.
 *   5. Status labels alone do NOT determine realisation.
 *   6. "Committed from prior month" does NOT silently become realised
 *      unless it has an invoice (rule 2 handles that case already).
 *   7. cosRealised boolean flag is respected as backward-compatible signal
 *      for legacy rows that were correctly marked during import.
 *
 * The `today` parameter is accepted for interface stability but is no longer
 * used in the core check — the invoice-only rule does not depend on date
 * comparison. Month bucketing for period reporting is a separate concern
 * handled by getCosEffectiveDateAndSource().
 */
export function isCanonicalCosRealised(input: CosLineInput): boolean {
  // 1. Admin override takes absolute precedence
  const override = (input.cosStatusOverride ?? "").toUpperCase().trim();
  if (OVERRIDE_REALISED.has(override)) return true;
  if (OVERRIDE_NOT_REALISED.has(override)) return false;

  // 2. Invoice number is the ONLY hard check for COS realisation.
  //    If a supplier invoice is captured, the cost is realised.
  //    Status labels (INVOICED, PAID, etc.) do NOT independently gate this.
  const hasInvoice = !!(input.expenseInvoiceNumber && input.expenseInvoiceNumber.trim());
  if (hasInvoice) return true;

  // 3. Legacy cosRealised boolean — backward-compatible signal for rows
  //    that were marked during import. Respected but should be migrated
  //    to invoice-based tracking over time.
  if (input.cosRealised === true) return true;

  // 4. Not realised — no invoice, no override, no legacy flag
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

  if (hasInvoice && !hasPo) {
    warnings.push("INVOICE_WITHOUT_PO");
  }
  if (hasInvoice && !hasInvoiceDate) {
    warnings.push("INVOICE_WITHOUT_DATE");
  }

  return warnings;
}
