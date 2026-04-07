/**
 * Shared Margin Calculation
 *
 * Single source of truth for the gross margin percentage formula.
 * All margin calculations across the app MUST use this function.
 *
 * Formula: ((revenue - cost) / revenue) * 100
 *
 * The scope (which rows feed revenue and cost) is the caller's
 * responsibility. This function only applies the formula with
 * explicit rounding and zero-revenue handling.
 *
 * Scopes used in the app:
 *   - FYTD: company-overview-service (all active projects, FY date range)
 *   - LIFETIME: dashboard-metrics, project-header-kpi-service (single project, all time)
 *   - FY_PROJECT: lifecycle-routes, dashboard-routes (single project, FY range)
 *   - PORTFOLIO: portfolio-routes (aggregated across project group)
 *   - PROGRAM_AVG: dashboard-metrics program rollup (average of project margins)
 */

export interface MarginOptions {
  /** Number of decimal places to round to. Default: 2 */
  precision?: number;
  /** Value to return when revenue <= 0. Default: null */
  zeroRevenueValue?: number | null;
}

/**
 * Compute gross margin percentage.
 *
 * @param revenue Total revenue (numerator base)
 * @param cost Total cost (subtracted from revenue)
 * @param options Rounding precision and zero-revenue behavior
 * @returns Margin percentage (0-100 scale) or zeroRevenueValue if revenue <= 0
 */
export function computeMarginPct(
  revenue: number,
  cost: number,
  options?: MarginOptions,
): number | null {
  const precision = options?.precision ?? 2;
  const zeroRevenueValue = options?.zeroRevenueValue !== undefined ? options.zeroRevenueValue : null;

  if (!Number.isFinite(revenue) || revenue <= 0) {
    return zeroRevenueValue;
  }

  const raw = ((revenue - cost) / revenue) * 100;
  const factor = Math.pow(10, precision);
  return Math.round(raw * factor) / factor;
}
