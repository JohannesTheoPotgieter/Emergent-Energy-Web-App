/**
 * Shared finance utility functions used across Revenue, COS, and GP tracker endpoints.
 *
 * These were extracted from finance-routes.ts to eliminate duplicated logic and ensure
 * consistency across all financial tracker calculations.
 *
 * IMPORTANT: Do not change these formulas without verifying the impact on ALL three
 * tracker endpoints (revenue-tracker, cos-tracker, gp-tracker) and the month-detail views.
 */

import { classifyCosStatus, type CosStatus } from './stateClassifier';
import { isCanonicalCosRealised, getCosRealisationWarnings, type CosLineInput } from '../finance/cos-realisation';
import { computeCostEvidence } from '../finance/qb-allocation';

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

// ─── Revenue allocation (COS-ratio method) — PROJECT-LEVEL ───
// @deprecated This function uses project-level totals. After the re-import campaign
// and S16 formula cutover, all callers should use allocateRevenueByCategory() instead.
// Retained for backward compatibility until S16 replaces all 10 call sites.
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

// ─── Revenue allocation (COS-ratio method) — CATEGORY-LEVEL (S15) ───
// Target allocation formula for category-based revenue recognition.
// Uses per-category COS total (X_cat) and per-category revenue allocation (J_cat)
// instead of project-level aggregates.
//
// Formula: revenueAmount = (lineItemCOS / categoryTotalCOS) * categoryRevenueAllocation
//
// Parameters:
//   lineItemCOS               — Q: actual cost for this individual line item
//   categoryTotalCOS          — X_cat: SUM(actual COS) for all lines in this cost category
//   categoryRevenueAllocation — J_cat: revenue allocated to this category from the costing model
//   noRevenueLinked           — true if the line is explicitly excluded from recognition
//
// Returns 0 if:
//   - The category has no COS (categoryTotalCOS <= 0)
//   - The line is flagged noRevenueLinked
//   - J_cat is zero or negative
export function allocateRevenueByCategory(
  lineItemCOS: number,
  categoryTotalCOS: number,
  categoryRevenueAllocation: number,
  noRevenueLinked: boolean,
): number {
  if (categoryTotalCOS <= 0 || noRevenueLinked || categoryRevenueAllocation <= 0) return 0;
  return (lineItemCOS / categoryTotalCOS) * categoryRevenueAllocation;
}

// ─── Full COS status classification ───
// Returns the full COS status ('Planned' | 'Committed' | 'COS Realised') for a
// cost line item. Respects admin overrides first, then falls back to the canonical
// classifyCosStatus() from stateClassifier.ts.
export function classifyCosStatusFull(exp: {
  expenseInvoiceNumber?: string | null;
  expenseInvoicedDate?: string | null;
  expensePoNumber?: string | null;
  invoiceDateConfirmed?: boolean | null;
  invoiceDateFontColor?: string | null;
  _cosOverrideStatus?: string | null;
}): CosStatus {
  // Admin override takes precedence
  if (exp._cosOverrideStatus === 'COS Realised') return 'COS Realised';
  if (exp._cosOverrideStatus === 'Committed') return 'Committed';
  if (exp._cosOverrideStatus === 'Planned') return 'Planned';
  // Standard classification from invoice data
  return classifyCosStatus({
    expenseInvoiceNumber: exp.expenseInvoiceNumber ?? null,
    expenseInvoicedDate: exp.expenseInvoicedDate ?? null,
    expensePoNumber: exp.expensePoNumber ?? null,
    invoiceDateConfirmed: exp.invoiceDateConfirmed ?? null,
    invoiceDateFontColor: exp.invoiceDateFontColor ?? null,
  });
}

// ─── COS realisation check ───
// Determines whether a cost line item should be treated as "realised" for tracker
// purposes. Delegates to the canonical isCanonicalCosRealised() which uses the
// invoice-only hard rule: if a supplier invoice number is captured AND the line
// has a non-zero amount, COS is realised. Zero-amount lines are NOT realised —
// there is nothing to realise (per business rule, COO 2026-05).
//
// NOTE: classifyCosStatusFull() is a DISPLAY label (Planned/Committed/COS Realised)
// based on data quality (invoice + date + confirmed). The realisation CHECK is
// separate and less strict — invoice number + non-zero amount is sufficient.
export function isCosRealised(exp: {
  expenseInvoiceNumber?: string | null;
  expenseInvoicedDate?: string | null;
  expensePoNumber?: string | null;
  expenseActualTotal?: string | number | null;
  invoiceDateConfirmed?: boolean | null;
  invoiceDateFontColor?: string | null;
  _cosOverrideStatus?: string | null;
  cosRealised?: boolean | null;
  cosStatusOverride?: string | null;
  lineAssignedQbExVat?: number | null;
  lineAmountExVat?: number | null;
  amountExVat?: string | number | null;
}): boolean {
  // Resolve the line amount. Adapted expense rows expose it as
  // `expenseActualTotal` (via `adaptCostToExpense`); raw NCL rows carry
  // `amountExVat`. Forward whichever is supplied so the canonical's
  // zero-amount gate fires — "R0 has nothing to realise".
  const amountForGate = exp.expenseActualTotal ?? exp.amountExVat ?? null;
  return isCanonicalCosRealised({
    status: null, // status labels do NOT independently determine realisation
    cosStatusOverride: exp._cosOverrideStatus ?? exp.cosStatusOverride ?? null,
    cosRealised: exp.cosRealised ?? null,
    expenseInvoiceNumber: exp.expenseInvoiceNumber ?? null,
    expenseInvoicedDate: exp.expenseInvoicedDate ?? null,
    expensePoNumber: exp.expensePoNumber ?? null,
    amountExVat: amountForGate,
    paymentDate: null,
    today: new Date().toISOString().slice(0, 10),
    // Forward the invoice-date-confirmed signals ONLY when the caller
    // actually supplied them. The canonical function uses `undefined` as
    // the "legacy caller — fall back to invoice-only rule" sentinel, so
    // eagerly normalising `undefined → null` would incorrectly engage the
    // strict black-font gate for callers that never opted in.
    ...(exp.invoiceDateFontColor !== undefined
      ? { invoiceDateFontColor: exp.invoiceDateFontColor }
      : {}),
    ...(exp.invoiceDateConfirmed !== undefined
      ? { invoiceDateConfirmed: exp.invoiceDateConfirmed }
      : {}),
    lineAssignedQbExVat: exp.lineAssignedQbExVat ?? null,
    lineAmountExVat: exp.lineAmountExVat ?? null,
  });
}

export function getCosRealisedAmountExVat(exp: {
  expenseActualTotal?: string | number | null;
  amountExVat?: string | number | null;
  expenseInvoiceNumber?: string | null;
  expenseInvoicedDate?: string | null;
  expensePoNumber?: string | null;
  invoiceDateConfirmed?: boolean | null;
  invoiceDateFontColor?: string | null;
  cosRealised?: boolean | null;
  cosStatusOverride?: string | null;
  _cosOverrideStatus?: string | null;
  lineAssignedQbExVat?: number | null;
}): number {
  const lineAmount = Number(exp.amountExVat ?? exp.expenseActualTotal ?? 0);
  if (!Number.isFinite(lineAmount) || lineAmount <= 0) return 0;

  // The invoice-date-confirmed gate decides whether the line is realised.
  // QB evidence refines the AMOUNT (capping at assigned) but never flips
  // a non-gate-realised line into the realised set — that preserves PR
  // #660's "strict finance controls" goal.
  if (!isCosRealised(exp)) return 0;

  const assigned = Number(exp.lineAssignedQbExVat ?? 0);
  if (Number.isFinite(assigned) && assigned > 0) {
    return computeCostEvidence(lineAmount, assigned).lineRealisedAmountExVat;
  }
  return Number(lineAmount.toFixed(2));
}

/**
 * Convenience adapter for callers that hold raw `normalized_cost_lines` rows.
 * Maps the NCL column names into the `getCosRealisedAmountExVat` input shape
 * and folds in the QB evidence total for the row.
 */
export function getCosRealisedAmountForNclRow(
  row: {
    amountExVat?: string | number | null;
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    poNumber?: string | null;
    invoiceDateFontColor?: string | null;
    invoiceDateConfirmed?: boolean | null;
    cosStatusOverride?: string | null;
    cosRealised?: boolean | null;
  },
  assignedQbExVat: number | null,
): number {
  return getCosRealisedAmountExVat({
    amountExVat: row.amountExVat ?? null,
    expenseInvoiceNumber: row.invoiceNumber ?? null,
    expenseInvoicedDate: row.invoiceDate ?? null,
    expensePoNumber: row.poNumber ?? null,
    invoiceDateFontColor: row.invoiceDateFontColor ?? null,
    invoiceDateConfirmed: row.invoiceDateConfirmed ?? null,
    cosStatusOverride: row.cosStatusOverride ?? null,
    cosRealised: row.cosRealised ?? null,
    lineAssignedQbExVat: assignedQbExVat ?? null,
  });
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
