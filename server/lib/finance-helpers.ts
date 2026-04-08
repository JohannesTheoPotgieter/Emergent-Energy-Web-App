/**
 * Finance Helpers — shared utility functions for finance route handlers.
 *
 * Extracted from server/routes.ts to create a clean seam for
 * finance route extraction.
 */

import { classifyCosStatusFull } from "./calculations/financeUtils";
import { isDateConfirmedCheck } from "./cashflow-helpers";

/** Unified realisation check: past-month committed costs are treated as realised. */
export function isEffectivelyRealisedLocal(exp: any, monthKey: string | null, currentMonthKey: string): boolean {
  const cosStatus = classifyCosStatusFull(exp);
  if (cosStatus === 'COS Realised' && (monthKey ? monthKey <= currentMonthKey : true)) return true;
  if (cosStatus === 'Committed' && monthKey != null && monthKey < currentMonthKey) return true;
  return false;
}

export function isCashflowConfirmedCheck(exp: any): boolean {
  const hasInvoice = !!(exp.expenseInvoiceNumber && String(exp.expenseInvoiceNumber).trim());
  const hasPayDate = !!(exp.expensePaymentDate && String(exp.expensePaymentDate).trim());
  if (!hasInvoice || !hasPayDate) return false;
  const payDateConfirmed = isDateConfirmedCheck(exp.paymentDateConfirmed, exp.paymentDateFontColor);
  return payDateConfirmed;
}
