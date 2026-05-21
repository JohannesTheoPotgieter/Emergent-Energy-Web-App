/**
 * Canonical Revenue Recognition helpers (POC method).
 *
 * SOURCE OF TRUTH for "Revenue" anywhere it is reported as a KPI in the app.
 *
 * Per business rules:
 *   amount = (this_line_actual / project_total_actual) × project_costed_revenue
 *
 * This formula is computed by the smart-import normalizer at write time and
 * persisted on `normalized_cost_lines.revenue_recognition_amount` (col U on
 * the Expenditure Breakdown sheet of each project tracker).
 *
 * Aggregating this field gives the canonical Revenue Recognition figure that
 * matches the FY Revenue Tracker (R230M FY26) and reconciles to the
 * Mondi-style Excel pivots within ~1.4% drift.
 *
 * IMPORTANT — distinction from Cashflow:
 *   - Revenue Recognition (POC, this helper)  = revenue *earned* based on % cost
 *     incurred. Use for ALL "Revenue" KPIs, P&L, dashboards, exec reports.
 *   - Cashflow / Billing (NRL.milestoneAmount) = invoice/cash timing.
 *     Use for AR, weekly inflows, outstanding receivables. NOT revenue.
 *
 * Mondi example: Mar 2026 may bill R5M (milestone/cash) but recognise only
 * R3M of revenue (POC) because construction is 60% complete.
 */

import { isEffectivelyRealised } from "./cos-realisation";

/** Minimum shape this module needs from a normalized cost line row. */
export interface CostLineForRecognition {
  rowType?: string | null;
  projectName?: string | null;
  revenueRecognitionAmount?: string | number | null;
  noRevenueLinked?: boolean | null;
  expenseActualTotal?: string | number | null;
  expenseInvoicedDate?: string | null;
  expenseInvoiceNumber?: string | null;
  expensePoNumber?: string | null;
  expensePaymentDate?: string | null;
  invoiceDateConfirmed?: boolean | null;
  invoiceDateFontColor?: string | null;
  cosStatusOverride?: string | null;
  cosRealised?: boolean | null;
  computedState?: string | null;
}

const stripTrackerSuffix = (s: string | null | undefined): string =>
  (s || "").replace(/_Tracker$/i, "");

const toNum = (v: unknown): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  // Strip thousand separators / currency prefixes that may survive a
  // UI write path. parseFloat silently truncated "1,234.56" to 1 — a
  // ~99% revenue loss. Number() on the same string yields NaN. Cleaning
  // first preserves the intended value for either input shape.
  const cleaned = String(v).replace(/[^\d.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Returns the per-line revenue recognition amount, or 0 if the line is
 * flagged `no_revenue_linked` or has no recognition amount persisted.
 */
export function recognitionAmountFor(line: CostLineForRecognition): number {
  if (line.rowType !== "item") return 0;
  if (line.noRevenueLinked) return 0;
  return toNum(line.revenueRecognitionAmount);
}

/**
 * Sum of revenue recognition across all live cost lines.
 * Use for company-wide "Revenue Planned" / "Revenue Recognised" totals.
 */
export function sumRevenueRecognition(lines: CostLineForRecognition[]): number {
  let total = 0;
  for (const line of lines) total += recognitionAmountFor(line);
  return total;
}

/**
 * Map<projectName (no _Tracker suffix), totalRecognition>.
 * Use for per-project "Revenue" KPI tiles, project headers, project lists.
 */
export function sumRevenueRecognitionByProject(
  lines: CostLineForRecognition[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    const amt = recognitionAmountFor(line);
    if (amt === 0) continue;
    const pName = stripTrackerSuffix(line.projectName);
    if (!pName) continue;
    out.set(pName, (out.get(pName) || 0) + amt);
  }
  return out;
}

/**
 * Realised revenue recognition — only includes lines whose underlying COS is
 * effectively realised (using the same past-month auto-promote rule as the
 * COS Tracker, so revenue and cost stay aligned).
 *
 * Pass the *current* month key (UTC) so realised/committed classification
 * matches `/api/cos-tracker` and `/api/revenue-tracker`.
 */
export function sumRealisedRevenueRecognition(
  lines: CostLineForRecognition[],
  currentMonthKey: string,
  getCosMonthKey: (line: CostLineForRecognition) => string | null,
): number {
  let total = 0;
  for (const line of lines) {
    const amt = recognitionAmountFor(line);
    if (amt === 0) continue;
    const mk = getCosMonthKey(line);
    if (!mk) continue;
    if (!isEffectivelyRealised(line as any, mk, currentMonthKey)) continue;
    total += amt;
  }
  return total;
}

/**
 * Per-project realised revenue recognition.
 * Map<projectName, realisedTotal>.
 */
export function sumRealisedRevenueRecognitionByProject(
  lines: CostLineForRecognition[],
  currentMonthKey: string,
  getCosMonthKey: (line: CostLineForRecognition) => string | null,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    const amt = recognitionAmountFor(line);
    if (amt === 0) continue;
    const mk = getCosMonthKey(line);
    if (!mk) continue;
    if (!isEffectivelyRealised(line as any, mk, currentMonthKey)) continue;
    const pName = stripTrackerSuffix(line.projectName);
    if (!pName) continue;
    out.set(pName, (out.get(pName) || 0) + amt);
  }
  return out;
}

/**
 * Convenience: revenue recognition for a single project, using the live
 * cost-line set already in memory. Returns 0 if the project has no rows.
 */
export function getRevenueRecognitionForProject(
  lines: CostLineForRecognition[],
  projectName: string,
): number {
  const target = stripTrackerSuffix(projectName);
  let total = 0;
  for (const line of lines) {
    if (stripTrackerSuffix(line.projectName) !== target) continue;
    total += recognitionAmountFor(line);
  }
  return total;
}
