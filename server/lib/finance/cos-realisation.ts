export interface CosLineInput {
  status: string | null;
  cosStatusOverride: string | null;
  cosRealised: boolean | null;
  expenseInvoiceNumber: string | null;
  expenseInvoicedDate: string | null;
  expensePoNumber: string | null;
  paymentDate: string | null;
  today: string;
}

const REALISED_STATUSES = new Set(["COS REALISED", "REALISED", "INVOICED", "PAID"]);
const OVERRIDE_REALISED = new Set(["COS REALISED", "REALISED"]);
const OVERRIDE_NOT_REALISED = new Set(["PLANNED", "COMMITTED", "INVOICED", "APPROVED", "PAID"]);

export function isCanonicalCosRealised(input: CosLineInput): boolean {
  const override = (input.cosStatusOverride ?? "").toUpperCase().trim();
  if (OVERRIDE_REALISED.has(override)) return true;
  if (OVERRIDE_NOT_REALISED.has(override)) return false;

  if (input.cosRealised === true) return true;

  const status = (input.status ?? "").toUpperCase().trim();
  if (REALISED_STATUSES.has(status)) return true;

  if (status === "COMMITTED" && input.expenseInvoicedDate) {
    const invoiceMonth = input.expenseInvoicedDate.slice(0, 7);
    const todayMonth = input.today.slice(0, 7);
    if (invoiceMonth < todayMonth) return true;
  }

  return false;
}
