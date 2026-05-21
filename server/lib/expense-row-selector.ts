export type ExpenseLikeRow = Record<string, any>;

function toMillis(value: unknown): number {
  if (!value) return 0;
  const t = new Date(String(value)).getTime();
  return Number.isFinite(t) ? t : 0;
}

function canonicalProjectName(projectName: unknown): string {
  return String(projectName || "").trim().toLowerCase();
}

export function getExpenseBusinessKey(row: ExpenseLikeRow): string {
  const sourceRow = row._sourceRow ?? row.sourceRow ?? row.rowNumber ?? null;
  const projectId = row.projectId ?? null;

  // Primary key: projectId + sourceRow. This survives project renames and tracker aliases.
  if (projectId != null && sourceRow != null) {
    return `pid:${projectId}::row:${sourceRow}`;
  }

  // Fallback key: projectName + rowNumber/sourceRow for legacy rows where projectId is absent.
  if (sourceRow != null) {
    return `pname:${canonicalProjectName(row.projectName)}::row:${sourceRow}`;
  }

  // Last-resort fallback keeps non-keyed rows addressable without merging unrelated records.
  return `id:${row.id}`;
}

export function isApprovedExpenseRow(row: ExpenseLikeRow): boolean {
  const status = String(row.status ?? row.lineStatus ?? "").trim().toUpperCase();
  return !!row.approvedDate || status === "APPROVED" || status === "PAID";
}

function getRowUpdateTime(row: ExpenseLikeRow): number {
  return Math.max(
    toMillis(row.updatedAt),
    toMillis(row.lastEditedAt),
    toMillis(row.adminDateOverrideAt),
    toMillis(row.effectiveFrom),
    toMillis(row.createdAt),
  );
}

export interface SelectorDiagnostics {
  totalInput: number;
  winners: number;
  duplicatesRemoved: number;
  normalizedInput: number;
  legacyInput: number;
  normalizedWinners: number;
  legacyWinners: number;
}

export interface SelectionResult<T extends ExpenseLikeRow> {
  winners: T[];
  diagnostics: SelectorDiagnostics;
}

export function selectWinningExpenseRows<T extends ExpenseLikeRow>(rows: T[]): SelectionResult<T> {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = getExpenseBusinessKey(row);
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }

  const winners: T[] = [];
  for (const [, bucket] of buckets) {
    bucket.sort((a, b) => {
      const aApproved = isApprovedExpenseRow(a);
      const bApproved = isApprovedExpenseRow(b);
      if (aApproved !== bApproved) return aApproved ? -1 : 1;

      // Approval-aware precedence: among approved rows choose the most recently approved.
      const approvedDelta = toMillis(b.approvedDate) - toMillis(a.approvedDate);
      if (approvedDelta !== 0) return approvedDelta;

      // If approval recency is tied/absent, choose latest edited/imported snapshot.
      const updatedDelta = getRowUpdateTime(b) - getRowUpdateTime(a);
      if (updatedDelta !== 0) return updatedDelta;

      // Deterministic final tie-breaker for identical timestamps.
      return Number(b.id || 0) - Number(a.id || 0);
    });

    winners.push(bucket[0]);
  }

  const normalizedInput = rows.filter((r) => !!r._isNormalized).length;
  const legacyInput = rows.length - normalizedInput;
  const normalizedWinners = winners.filter((r) => !!r._isNormalized).length;
  const legacyWinners = winners.length - normalizedWinners;

  return {
    winners,
    diagnostics: {
      totalInput: rows.length,
      winners: winners.length,
      duplicatesRemoved: rows.length - winners.length,
      normalizedInput,
      legacyInput,
      normalizedWinners,
      legacyWinners,
    },
  };
}

export function getExpenseEffectiveDateAndSource(expense: ExpenseLikeRow): { date: string | null; source: string | null } {
  if (expense.adminDateOverride) return { date: expense.adminDateOverride, source: "adminDateOverride" };
  if (expense.expensePaymentDate) return { date: expense.expensePaymentDate, source: "expensePaymentDate" };
  if (expense.computedForecastPaymentDate) return { date: expense.computedForecastPaymentDate, source: "computedForecastPaymentDate" };
  if (expense.forecastPaymentDate) return { date: expense.forecastPaymentDate, source: "forecastPaymentDate" };
  if (expense.expenseInvoicedDate) return { date: expense.expenseInvoicedDate, source: "expenseInvoicedDate" };
  return { date: null, source: null };
}

/**
 * COS/Revenue/GP month bucketing date resolution.
 * Excel parity rule: COS and REV recognition are bucketed by invoice_date
 * only (Expenditure Breakdown column T). Only cashflow uses payment date or
 * manual scheduling overrides. Rows without invoice_date intentionally return
 * null so they fall out of actual COS/REV month aggregates.
 *
 * Different from getExpenseEffectiveDateAndSource, which is payment-date-first
 * and honours adminDateOverride for cashflow planning.
 */
export function getCosEffectiveDateAndSource(expense: ExpenseLikeRow): { date: string | null; source: string | null } {
  if (expense.expenseInvoicedDate) return { date: expense.expenseInvoicedDate, source: "expenseInvoicedDate" };
  return { date: null, source: null };
}

/**
 * Cash Outflow amount + bucket per the canonical business spec:
 *
 *   - Source amount: ALWAYS NCL.amount_ex_vat (= expenseActualTotal).
 *     The legacy budget_total fallback was over-counting cashflow outflows
 *     by ~R 47M because budget figures on un-approved lines were materially
 *     larger than the actual cost line value. Cashflow tracks money flowing
 *     out of the bank; budget is a planning artefact, not an outflow.
 *
 *   - Bucket type:
 *       - "actual"   = the line has a paid_date AND that paid_date is
 *                      confirmed (paymentDateConfirmed === true OR
 *                      paymentDateFontColor === 'black'). Black font is the
 *                      finance team's signal that the payment has actually
 *                      cleared.
 *       - "forecast" = everything else (paid_date present but red font, or
 *                      only a forecast_payment_date / invoice date).
 *
 *   - amountSource is preserved on the type signature for downstream
 *     diagnostics, but it now always reports "expenseActualTotal".
 */
export function getOutflowAmountBreakdown(expense: ExpenseLikeRow): {
  amount: number;
  type: "actual" | "forecast";
  amountSource: "expenseActualTotal" | "budgetTotal";
} {
  const actualAmount = Number.parseFloat(expense.expenseActualTotal ?? "");
  const amount = Number.isFinite(actualAmount) ? actualAmount : 0;

  const hasPaidDate = !!(expense.expensePaymentDate && String(expense.expensePaymentDate).trim());
  const paidDateConfirmed = expense.paymentDateConfirmed === true
    || String(expense.paymentDateFontColor ?? "").toLowerCase() === "black";
  const isActual = hasPaidDate && paidDateConfirmed;

  return {
    amount,
    type: isActual ? "actual" : "forecast",
    amountSource: "expenseActualTotal",
  };
}
