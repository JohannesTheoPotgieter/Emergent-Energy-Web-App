export type RevenueSettlementInput = {
  status?: string | null;
  manualInBank?: boolean | number | string | null;
  inBankDate?: string | null;
  paymentReceivedDate?: string | null;
  paidDate?: string | null;
  paidDateConfirmed?: boolean | null;
  paidDateFontColor?: string | null;
};

export type RevenueArEvaluationInput = RevenueSettlementInput & {
  dueDate?: string | null;
  invoiceNumber?: string | null;
  amount?: number | string | null;
  today: string;
};

const SETTLED_STATUS_KEYWORDS = [
  "in_bank",
  "in bank",
  "paid",
  "realised",
  "realized",
  "received",
  "settled",
  "closed",
];

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTruthyFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return false;
}

export function hasIsoDate(value: string | null | undefined): boolean {
  return !!(value && /^\d{4}-\d{2}-\d{2}/.test(value.trim()));
}

function normalizeStatus(status: string | null | undefined): string {
  if (!status) return "";
  return status.trim().toLowerCase().replace(/\s+/g, " ");
}

function isBlack(value: string | null | undefined): boolean {
  const s = String(value || "").toLowerCase();
  return s.includes("000000") || s.includes("black");
}

export function isRevenueSettled(input: RevenueSettlementInput): boolean {
  const status = normalizeStatus(input.status);
  const statusSettled = status.length > 0 && SETTLED_STATUS_KEYWORDS.some((k) => status.includes(k));

  // Payment receipt / in-bank dates are primary source of truth for closed AR.
  const hasReceiptDate = hasIsoDate(input.paymentReceivedDate) || hasIsoDate(input.paidDate);
  const hasInBankDate = hasIsoDate(input.inBankDate);
  const manualInBank = isTruthyFlag(input.manualInBank);

  // Backward-compatible confirmation signal from imported trackers.
  const confirmedPaid = Boolean(input.paidDateConfirmed) || (hasIsoDate(input.paidDate) && isBlack(input.paidDateFontColor));

  return statusSettled || hasReceiptDate || hasInBankDate || manualInBank || confirmedPaid;
}

/**
 * Stricter check: cash confirmed in bank.
 * Uses only hard evidence of money received — inBankDate, manualInBank flag,
 * or status explicitly containing "in_bank" / "in bank".
 * This is the canonical source for the "Cash Collected" KPI.
 */
export function isCashInBank(input: RevenueSettlementInput): boolean {
  const hasInBankDate = hasIsoDate(input.inBankDate);
  const manualInBank = isTruthyFlag(input.manualInBank);

  const status = normalizeStatus(input.status);
  const statusInBank = status.length > 0 && (status.includes("in_bank") || status.includes("in bank"));

  // paidDateConfirmed with a paidDate is also strong evidence of cash receipt.
  const confirmedPaid = Boolean(input.paidDateConfirmed) || (hasIsoDate(input.paidDate) && isBlack(input.paidDateFontColor));

  return hasInBankDate || manualInBank || statusInBank || confirmedPaid;
}

export function evaluateRevenueArStatus(input: RevenueArEvaluationInput): {
  isSettled: boolean;
  isOverdue: boolean;
  hasInvoice: boolean;
} {
  const isSettled = isRevenueSettled(input);
  const hasInvoice = hasText(input.invoiceNumber);
  const hasAmount = Number(input.amount || 0) > 0;
  const dueDate = hasIsoDate(input.dueDate) ? String(input.dueDate).slice(0, 10) : null;
  const today = String(input.today).slice(0, 10);

  const isOverdue = !isSettled && hasInvoice && hasAmount && !!dueDate && dueDate < today;
  return { isSettled, isOverdue, hasInvoice };
}
