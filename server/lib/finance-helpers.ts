/**
 * Finance Helpers — shared utility functions for finance route handlers.
 *
 * Extracted from server/routes.ts to create a clean seam for
 * finance route extraction.
 */

import { isCosRealised } from "./calculations/financeUtils";
import { isDateConfirmedCheck } from "./cashflow-helpers";

/**
 * Unified realisation check for period reporting.
 *
 * Uses the canonical invoice-only rule (via isCosRealised) and restricts
 * to current or past months for period bucketing.
 *
 * CHANGED: Committed-from-prior-month no longer silently promotes to realised.
 * Per business rules, "committed from prior month must NOT silently become
 * realised unless it matches the invoice rule." If the line has an invoice,
 * isCosRealised() will return true regardless of committed/prior status.
 */
export function isEffectivelyRealisedLocal(exp: any, monthKey: string | null, currentMonthKey: string): boolean {
  if (!isCosRealised(exp)) return false;
  // Realised lines are effective for current and past months only
  return monthKey ? monthKey <= currentMonthKey : true;
}

export function isCashflowConfirmedCheck(exp: any): boolean {
  const hasInvoice = !!(exp.expenseInvoiceNumber && String(exp.expenseInvoiceNumber).trim());
  const hasPayDate = !!(exp.expensePaymentDate && String(exp.expensePaymentDate).trim());
  if (!hasInvoice || !hasPayDate) return false;
  const payDateConfirmed = isDateConfirmedCheck(exp.paymentDateConfirmed, exp.paymentDateFontColor);
  return payDateConfirmed;
}
