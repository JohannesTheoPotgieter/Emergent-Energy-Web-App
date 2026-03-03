export type ExpenseState = 'Planned' | 'Committed' | 'Invoiced' | 'Paid';
export type CosStatus = 'Planned' | 'COS Realised' | 'Deferred' | 'Flagged';
export type CashflowStatus = 'Planned' | 'Payment Planned' | 'Out of Bank' | 'Committed';

export interface ExpenseLineInput {
  expensePaymentDate?: string | null;
  expenseInvoiceNumber?: string | null;
  expenseInvoicedDate?: string | null;
  expensePoNumber?: string | null;
  invoiceDateFontColor?: string | null;
  paymentDateFontColor?: string | null;
  invoiceDateConfirmed?: boolean | null;
  paymentDateConfirmed?: boolean | null;
  expenseActualTotal?: string | number | null;
}

export function isDateBlack(confirmed: boolean | null | undefined, fontColor: string | null | undefined): boolean {
  if (confirmed === true) return true;
  if (fontColor === 'black') return true;
  if (confirmed == null && (fontColor == null || fontColor === '')) return true;
  return false;
}

export function classifyExpenseState(line: ExpenseLineInput): ExpenseState {
  const hasPaymentDate = !!(line.expensePaymentDate && line.expensePaymentDate.trim() !== '');
  const hasInvoiceNumber = !!(line.expenseInvoiceNumber && line.expenseInvoiceNumber.trim() !== '');
  const hasInvoiceDate = !!(line.expenseInvoicedDate && line.expenseInvoicedDate.trim() !== '');
  const hasPO = !!(line.expensePoNumber && line.expensePoNumber.trim() !== '');

  const paymentDateActual = hasPaymentDate && isDateBlack(line.paymentDateConfirmed, line.paymentDateFontColor);
  const invoiceDateActual = hasInvoiceDate && isDateBlack(line.invoiceDateConfirmed, line.invoiceDateFontColor);

  if (hasInvoiceNumber && hasPaymentDate && paymentDateActual) {
    return 'Paid';
  }
  if (hasInvoiceNumber && hasInvoiceDate && invoiceDateActual) {
    return 'Invoiced';
  }
  if (hasPO || hasInvoiceNumber) {
    return 'Committed';
  }
  return 'Planned';
}

export function classifyCosStatus(line: ExpenseLineInput): CosStatus {
  const hasInvoiceNumber = !!(line.expenseInvoiceNumber && String(line.expenseInvoiceNumber).trim() !== '');
  const hasInvoiceDate = !!(line.expenseInvoicedDate && String(line.expenseInvoicedDate).trim() !== '');
  const hasPO = !!(line.expensePoNumber && String(line.expensePoNumber).trim() !== '');
  const invoiceDateBlack = hasInvoiceDate && isDateBlack(line.invoiceDateConfirmed, line.invoiceDateFontColor);

  if (hasPO && hasInvoiceNumber && invoiceDateBlack) {
    return 'COS Realised';
  }

  if (hasPO && hasInvoiceNumber && hasInvoiceDate && !invoiceDateBlack) {
    return 'Deferred';
  }

  if (invoiceDateBlack && (!hasPO || !hasInvoiceNumber)) {
    return 'Flagged';
  }

  return 'Planned';
}

export function classifyCashflowStatus(line: ExpenseLineInput): CashflowStatus {
  const hasInvoiceNumber = !!(line.expenseInvoiceNumber && String(line.expenseInvoiceNumber).trim() !== '');
  const hasPaymentDate = !!(line.expensePaymentDate && String(line.expensePaymentDate).trim() !== '');
  const paymentDateBlack = hasPaymentDate && isDateBlack(line.paymentDateConfirmed, line.paymentDateFontColor);

  if (paymentDateBlack && hasInvoiceNumber) {
    return 'Out of Bank';
  }

  if (hasPaymentDate && !paymentDateBlack) {
    return 'Payment Planned';
  }

  return 'Planned';
}
