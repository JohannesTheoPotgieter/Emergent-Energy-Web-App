function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function toMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function monthBeforeCurrent(monthKey: string, currentMonthKey: string): boolean {
  return monthKey < currentMonthKey;
}

export type CosLineInput = {
  status?: string | null;
  cosStatusOverride?: string | null;
  cosRealised?: boolean | null;
  expenseInvoiceNumber?: string | null;
  expenseInvoicedDate?: string | null;
  expensePoNumber?: string | null;
  paymentDate?: string | null;
  today: string;
};

/**
 * Canonical COS realised logic:
 * - Explicit realised status/override is realised.
 * - Committed past-month COS counts as realised.
 * - Otherwise committed/planned remain unrealised.
 */
export function isCanonicalCosRealised(input: CosLineInput): boolean {
  const status = String(input.status ?? "").trim().toUpperCase();
  const override = String(input.cosStatusOverride ?? "").trim().toUpperCase();
  const today = toIsoDate(input.today) ?? new Date().toISOString().slice(0, 10);
  const currentMonth = toMonth(today);

  if (override === "COS REALISED" || override === "REALISED") return true;
  // F-04 fix: When an explicit override is set, it takes precedence over status-based checks.
  // "INVOICED" and "PAID" overrides are treated as realised (matching status-based logic).
  // "COMMITTED" falls through to the committed-past-month check below.
  // "PLANNED" and "APPROVED" are explicitly not yet realised.
  if (override === "INVOICED" || override === "PAID") return true;
  if (override === "PLANNED" || override === "APPROVED") return false;
  // "COMMITTED" override falls through to committed-past-month logic below

  if (status === "COS REALISED" || status === "REALISED" || status === "INVOICED" || status === "PAID") {
    return true;
  }

  if (input.cosRealised === true) return true;

  // ADV-09 fix: also check override === "COMMITTED" so that a COMMITTED override
  // with a past-month date correctly resolves to realised even without PO/invoice number.
  const hasCommittedSignal =
    status === "COMMITTED" ||
    override === "COMMITTED" ||
    hasText(input.expensePoNumber) ||
    hasText(input.expenseInvoiceNumber);

  if (!hasCommittedSignal) return false;

  const committedDate = toIsoDate(input.expenseInvoicedDate) ?? toIsoDate(input.paymentDate);
  if (!committedDate) return false;

  return monthBeforeCurrent(toMonth(committedDate), currentMonth);
}
