export type ExpenseState = 'Planned' | 'Committed' | 'Invoiced' | 'Paid';

export interface ExpenseLineInput {
  expensePaymentDate?: string | null;
  expenseInvoiceNumber?: string | null;
  expenseInvoicedDate?: string | null;
  expensePoNumber?: string | null;
  invoiceDateFontColor?: string | null;
  paymentDateFontColor?: string | null;
  invoiceDateConfirmed?: boolean | null;
}

export function classifyExpenseState(line: ExpenseLineInput): ExpenseState {
  const hasPaymentDate = !!(line.expensePaymentDate && line.expensePaymentDate.trim() !== '');
  const hasInvoiceNumber = !!(line.expenseInvoiceNumber && line.expenseInvoiceNumber.trim() !== '');
  const hasInvoiceDate = !!(line.expenseInvoicedDate && line.expenseInvoicedDate.trim() !== '');
  const hasPO = !!(line.expensePoNumber && line.expensePoNumber.trim() !== '');

  const paymentDateActual = hasPaymentDate && line.paymentDateFontColor !== 'red';

  const invoiceDateActual = hasInvoiceDate && (
    line.invoiceDateConfirmed === true ||
    (line.invoiceDateConfirmed == null && line.invoiceDateFontColor !== 'red')
  );

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
