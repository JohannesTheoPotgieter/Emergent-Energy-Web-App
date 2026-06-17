/* ───────────────────────────────────────────────────────────────────────────
 * FROZEN — finance computation path (CLAUDE.md FREEZE · AGENT_GUARDRAILS § 3B S10).
 * Formula / number / calculation changes require explicit owner approval.
 * Number-preserving refactors are allowed only while `npm run verify:finance`
 * and the finance unit tests stay green. Do not re-litigate the cash formulas
 * (§ 3.4) here.
 * ───────────────────────────────────────────────────────────────────────────
 */

/**
 * Weekly cashflow engine — THE single source of the weekly cash numbers.
 *
 * One computation, consumed by every surface (Finance Home tile, the Cashflow
 * grid, and Weekly Close) through the one `/api/cashflow-2026` reader. Before
 * this engine, the formula was duplicated in two route handlers that disagreed:
 * the live one returned `opening + inflows` (outflows never subtracted ⇒ a wildly
 * inflated "available"), and a dead twin had `opening + inflows − outflows`.
 *
 * Canonical definitions (AGENT_GUARDRAILS § 3.4 — cash, NEVER revenue):
 *
 *   closingBalance         = openingBalance + inflows − outflows
 *   availablePayment       = manual override ?? closingBalance
 *
 * where, per week:
 *   - openingBalance = the prior week's closingBalance (or a manual override),
 *   - inflows  = Σ revenue-line cash by payment-RECEIPT date in the week,
 *   - outflows = Σ cost-line cash by payment date in the week (+ OPEX).
 *
 * Cash-event date (outflows) is the finance PAYMENT date, never the invoice
 * (recognition) date (§ 3.4): admin schedule-override → actual payment →
 * computed forecast → forecast. A row with only an invoice date is NOT a cash
 * event and falls out of the weekly bucket.
 *
 * Pure — no DB, no I/O. The `/api/cashflow-2026` route loads the rows and calls
 * this; verify:finance and the unit tests call it directly.
 */

export const round2 = (n: number): number => Number(n.toFixed(2));

// ── Cash-event outflow date (§ 3.4) ───────────────────────────────────────────

/** Minimal expense shape the cash-event date needs. */
export interface CashEventExpense {
  adminDateOverride?: string | null;
  expensePaymentDate?: string | null;
  computedForecastPaymentDate?: string | null;
  forecastPaymentDate?: string | null;
  /** Accepted for type-compat but NEVER used for cash bucketing (§ 3.4). */
  expenseInvoicedDate?: string | null;
}

export type CashEventDateSource =
  | "adminDateOverride"
  | "expensePaymentDate"
  | "computedForecastPaymentDate"
  | "forecastPaymentDate"
  | null;

/**
 * The cash-event date for an outflow and which field it came from. Payment date
 * first (admin schedule-override honoured so the planner's moves re-bucket),
 * then computed/forecast. The invoice date is recognition, not cash, so it is
 * deliberately NOT in the fallback chain — including it conflates the two
 * surfaces and pushes invoiced-but-unscheduled rows into the invoice's week.
 */
export function cashEventOutflowDateAndSource(e: CashEventExpense): {
  date: string | null;
  source: CashEventDateSource;
} {
  if (e.adminDateOverride) return { date: e.adminDateOverride, source: "adminDateOverride" };
  if (e.expensePaymentDate) return { date: e.expensePaymentDate, source: "expensePaymentDate" };
  if (e.computedForecastPaymentDate)
    return { date: e.computedForecastPaymentDate, source: "computedForecastPaymentDate" };
  if (e.forecastPaymentDate) return { date: e.forecastPaymentDate, source: "forecastPaymentDate" };
  return { date: null, source: null };
}

/** Cash-event date only (see `cashEventOutflowDateAndSource`). */
export function cashEventOutflowDate(e: CashEventExpense): string | null {
  return cashEventOutflowDateAndSource(e).date;
}

// ── Weekly available payment ──────────────────────────────────────────────────

export interface AvailablePaymentOverride {
  value: number;
  reason?: string | null;
  updatedAt?: string | Date | null;
  updatedBy?: string | null;
}

export interface WeeklyAvailablePaymentArgs {
  openingBalance: number;
  /** Σ inflows landing in the week (cash in). */
  inflows: number;
  /** Σ outflows landing in the week (OPEX + project cost outflows). */
  totalOutflows: number;
  /** Manual "available to pay" override for the week, if any. */
  override?: AvailablePaymentOverride | null;
}

export interface WeeklyAvailablePaymentResult {
  /** opening + inflows − outflows. Carried forward as the next week's opening. */
  closingBalance: number;
  /** Same as closingBalance — the formula value before any manual override. */
  computedAvailablePayment: number;
  /** What the surfaces SHOW: override when set, else the computed value. */
  availablePayment: number;
  hasAvailPayOverride: boolean;
  availPayReason: string | null;
  availPayOverrideAt: string | null;
  availPayOverrideBy: string | null;
}

const toIso = (v: string | Date | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

/**
 * THE weekly cash formula. `closingBalance` (the real position) always equals
 * `opening + inflows − outflows` and is what carries forward; a manual override
 * only changes the DISPLAYED `availablePayment`, never the running balance.
 */
export function resolveWeeklyAvailablePayment(
  a: WeeklyAvailablePaymentArgs,
): WeeklyAvailablePaymentResult {
  const computed = round2(a.openingBalance + a.inflows - a.totalOutflows);
  const ov = a.override;
  const hasOverride = ov != null && Number.isFinite(Number(ov.value));
  return {
    closingBalance: computed,
    computedAvailablePayment: computed,
    availablePayment: hasOverride ? round2(Number(ov!.value)) : computed,
    hasAvailPayOverride: hasOverride,
    availPayReason: hasOverride ? ov!.reason ?? null : null,
    availPayOverrideAt: hasOverride ? toIso(ov!.updatedAt) : null,
    availPayOverrideBy: hasOverride ? ov!.updatedBy ?? null : null,
  };
}

// ── Current-week selection (shared by every surface) ──────────────────────────

export interface WeekLike {
  weekStart: string;
  weekEnd: string;
  availablePayment: number;
}

/**
 * The ONE "which week is this week" rule. Finance Home, the Cashflow grid and
 * Weekly Close all pick the current week this exact way, so they cannot diverge:
 * the week containing `todayIso`, else the latest week that has already started.
 */
export function selectCurrentWeek<T extends WeekLike>(weeks: readonly T[], todayIso: string): T | null {
  return (
    weeks.find((w) => w.weekStart <= todayIso && todayIso < w.weekEnd) ??
    weeks.find((w) => w.weekStart <= todayIso) ??
    null
  );
}
