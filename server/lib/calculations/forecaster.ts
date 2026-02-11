function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function isValidDate(s: string | null | undefined): boolean {
  if (!s || !s.trim()) return false;
  return !isNaN(new Date(s).getTime());
}

export interface ForecastExpenseInput {
  expensePaymentDate?: string | null;
  expenseInvoicedDate?: string | null;
  expensePoNumber?: string | null;
  forecastPaymentDate?: string | null;
  constructionStart?: string | null;
  commissioningDate?: string | null;
}

export interface ForecastInflowInput {
  paymentReceivedDate?: string | null;
  invoiceRaisedDate?: string | null;
  plannedPaymentDate?: string | null;
  commissioningDate?: string | null;
}

export function forecastExpensePaymentDate(
  line: ForecastExpenseInput,
  termsDays: number = 30,
): string | null {
  if (isValidDate(line.expensePaymentDate)) return null;

  if (isValidDate(line.expenseInvoicedDate)) {
    return addDays(line.expenseInvoicedDate!, termsDays);
  }

  if (isValidDate(line.forecastPaymentDate)) {
    return line.forecastPaymentDate!.trim();
  }

  if (line.expensePoNumber && line.expensePoNumber.trim() && isValidDate(line.constructionStart)) {
    return addDays(line.constructionStart!, 60 + termsDays);
  }

  if (isValidDate(line.constructionStart) && isValidDate(line.commissioningDate)) {
    const start = new Date(line.constructionStart!);
    const end = new Date(line.commissioningDate!);
    const mid = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
    return mid.toISOString().split('T')[0];
  }

  return null;
}

export function forecastInflowReceiptDate(
  line: ForecastInflowInput,
  termsDays: number = 30,
): string | null {
  if (isValidDate(line.paymentReceivedDate)) return null;

  if (isValidDate(line.invoiceRaisedDate)) {
    return addDays(line.invoiceRaisedDate!, termsDays);
  }

  if (isValidDate(line.plannedPaymentDate)) {
    return line.plannedPaymentDate!.trim();
  }

  if (isValidDate(line.commissioningDate)) {
    return addDays(line.commissioningDate!, 14);
  }

  return null;
}
