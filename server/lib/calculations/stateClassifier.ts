export type ExpenseState = 'Planned' | 'Committed' | 'Invoiced' | 'Paid';

export interface ExpenseLineInput {
  expensePaymentDate?: string | null;
  expenseInvoiceNumber?: string | null;
  expenseInvoicedDate?: string | null;
  expensePoNumber?: string | null;
}

export function classifyExpenseState(line: ExpenseLineInput): ExpenseState {
  if (line.expensePaymentDate && line.expensePaymentDate.trim() !== '') {
    return 'Paid';
  }
  if (line.expenseInvoiceNumber && line.expenseInvoiceNumber.trim() !== '' &&
      line.expenseInvoicedDate && line.expenseInvoicedDate.trim() !== '') {
    return 'Invoiced';
  }
  if (line.expensePoNumber && line.expensePoNumber.trim() !== '') {
    return 'Committed';
  }
  return 'Planned';
}
