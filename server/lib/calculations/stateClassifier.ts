export type ExpenseState = 'Planned' | 'Committed' | 'Invoiced' | 'Paid';

export interface ExpenseLineInput {
  expensePaymentDate?: string | null;
  expenseInvoiceNumber?: string | null;
  expenseInvoicedDate?: string | null;
  expensePoNumber?: string | null;
  invoiceDateFontColor?: string | null;
  paymentDateFontColor?: string | null;
  invoiceDateConfirmed?: boolean | null;
  paymentDateConfirmed?: boolean | null;
}

function isDateActual(confirmed: boolean | null | undefined, fontColor: string | null | undefined): boolean {
  if (confirmed === true) return true;
  if (fontColor === 'black') return true;
  if (!fontColor || fontColor === '') return true;
  return false;
}

export function classifyExpenseState(line: ExpenseLineInput): ExpenseState {
  const hasPaymentDate = !!(line.expensePaymentDate && line.expensePaymentDate.trim() !== '');
  const hasInvoiceNumber = !!(line.expenseInvoiceNumber && line.expenseInvoiceNumber.trim() !== '');
  const hasInvoiceDate = !!(line.expenseInvoicedDate && line.expenseInvoicedDate.trim() !== '');
  const hasPO = !!(line.expensePoNumber && line.expensePoNumber.trim() !== '');

  const paymentDateActual = hasPaymentDate && isDateActual(line.paymentDateConfirmed, line.paymentDateFontColor);
  const invoiceDateActual = hasInvoiceDate && isDateActual(line.invoiceDateConfirmed, line.invoiceDateFontColor);

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
