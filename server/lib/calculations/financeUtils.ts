/**
 * Shared finance utility functions used across Revenue, COS, and GP tracker endpoints.
 *
 * These were extracted from finance-routes.ts to eliminate duplicated logic and ensure
 * consistency across all financial tracker calculations.
 *
 * IMPORTANT: Do not change these formulas without verifying the impact on ALL three
 * tracker endpoints (revenue-tracker, cos-tracker, gp-tracker) and the month-detail views.
 */

import { classifyCosStatus } from './stateClassifier';

// ─── Static fallback COS budget (FY2025-2026) ───
// Used when no manual budget override has been entered for a month.
// Single source of truth — previously duplicated in COS tracker and GP tracker.
export const STATIC_COS_BUDGET_FY26: Record<string, number> = {
  '2025-09': 8083466.99,
  '2025-10': 16346971.77,
  '2025-11': 20803804.86,
  '2025-12': 12381055.48,
  '2026-01': 12395435.22,
  '2026-02': 20724666.08,
  '2026-03': 30199956.69,
  '2026-04': 21137178.14,
  '2026-05': 31405517.81,
  '2026-06': 41720854.07,
  '2026-07': 30116780.50,
  '2026-08': 73983803.91,
};

// ─── Month-key extraction ───
// Extracts "YYYY-MM" from a date string. Returns null if the date is invalid.
export function extractMonthKey(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const match = String(dateStr).match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}

// ─── Revenue allocation (COS-ratio method) ───
// Allocates revenue to an individual cost line item based on its proportion of
// the project's total COS. This is the standard allocation used across all
// finance tracker endpoints.
//
// Formula: revenueAmount = (lineItemCOS / totalProjectCOS) * totalProjectRevenue
//
// Returns 0 if the project has no COS, or if the line item is flagged noRevenueLinked.
export function allocateRevenue(
  lineItemCOS: number,
  totalProjectCOS: number,
  totalProjectRevenue: number,
  noRevenueLinked: boolean,
): number {
  if (totalProjectCOS <= 0 || noRevenueLinked) return 0;
  return (lineItemCOS / totalProjectCOS) * totalProjectRevenue;
}

// ─── COS realisation check ───
// Determines whether a cost line item should be treated as "realised" for tracker
// purposes. Uses the canonical classifyCosStatus() from stateClassifier.ts,
// PLUS respects manual COS status overrides and the cosRealised boolean.
//
// COS is realised when:
// 1. classifyCosStatus returns 'COS Realised' (has invoice number AND invoice date), OR
// 2. A COS override marks it as 'COS Realised', OR
// 3. The normalizedCostLines.cosRealised boolean is true
export function isCosRealised(exp: {
  expenseInvoiceNumber?: string | null;
  expenseInvoicedDate?: string | null;
  expensePoNumber?: string | null;
  invoiceDateConfirmed?: boolean | null;
  invoiceDateFontColor?: string | null;
  _cosOverrideStatus?: string | null;
  _cosRealisedFlag?: boolean | null;
}): boolean {
  // Manual override takes precedence
  if (exp._cosOverrideStatus === 'COS Realised') return true;
  // Normalized table boolean flag
  if (exp._cosRealisedFlag === true) return true;
  // Classification from invoice data (must include confirmation fields for isDateBlack check)
  const status = classifyCosStatus({
    expenseInvoiceNumber: exp.expenseInvoiceNumber ?? null,
    expenseInvoicedDate: exp.expenseInvoicedDate ?? null,
    expensePoNumber: exp.expensePoNumber ?? null,
    invoiceDateConfirmed: exp.invoiceDateConfirmed ?? null,
    invoiceDateFontColor: exp.invoiceDateFontColor ?? null,
  });
  return status === 'COS Realised';
}

// ─── Project-name normalisation ───
// Strips the "_Tracker" suffix that some project names carry from source data.
export function normalizeProjectName(name: string | null | undefined): string {
  return (name || '').replace(/_Tracker$/i, '');
}

// ─── Map to sorted array ───
// Converts a Map<string, number> into a sorted array of { projectName, value } objects.
// Sorted descending by value.
export function mapToSortedArray(m: Map<string, number>): { projectName: string; value: number }[] {
  const arr: { projectName: string; value: number }[] = [];
  m.forEach((v, k) => arr.push({ projectName: k, value: v }));
  return arr.sort((a, b) => b.value - a.value);
}

// ─── Current month key ───
// Returns the current month as "YYYY-MM" (local time).
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Parse expense amount ───
// Safely parses the actual total from an expense record. Returns 0 for non-item rows
// and invalid/zero amounts.
export function parseExpenseAmount(exp: { rowType?: string | null; expenseActualTotal?: string | number | null }): number {
  if (exp.rowType !== 'item') return 0;
  const amount = exp.expenseActualTotal ? parseFloat(String(exp.expenseActualTotal)) : 0;
  if (isNaN(amount) || amount === 0) return 0;
  return amount;
}
