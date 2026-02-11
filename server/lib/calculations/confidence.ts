export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

export interface ConfidenceInput {
  hasInvoice: boolean;
  hasInvoiceDate: boolean;
  hasPO: boolean;
  hasPlannedDate: boolean;
}

export function scoreConfidence(input: ConfidenceInput): ConfidenceLevel {
  if (input.hasInvoice && input.hasInvoiceDate) return 'High';
  if (input.hasPO || input.hasPlannedDate) return 'Medium';
  return 'Low';
}

export function scoreExpenseConfidence(line: {
  expenseInvoiceNumber?: string | null;
  expenseInvoicedDate?: string | null;
  expensePoNumber?: string | null;
  forecastPaymentDate?: string | null;
}): ConfidenceLevel {
  return scoreConfidence({
    hasInvoice: !!(line.expenseInvoiceNumber && line.expenseInvoiceNumber.trim()),
    hasInvoiceDate: !!(line.expenseInvoicedDate && line.expenseInvoicedDate.trim()),
    hasPO: !!(line.expensePoNumber && line.expensePoNumber.trim()),
    hasPlannedDate: !!(line.forecastPaymentDate && line.forecastPaymentDate.trim()),
  });
}

export function scoreInflowConfidence(line: {
  milestoneInvoiceNumber?: string | null;
  invoiceRaisedDate?: string | null;
  plannedPaymentDate?: string | null;
}): ConfidenceLevel {
  return scoreConfidence({
    hasInvoice: !!(line.milestoneInvoiceNumber && line.milestoneInvoiceNumber.trim()),
    hasInvoiceDate: !!(line.invoiceRaisedDate && line.invoiceRaisedDate.trim()),
    hasPO: false,
    hasPlannedDate: !!(line.plannedPaymentDate && line.plannedPaymentDate.trim()),
  });
}

export function getAssumptionDriver(line: {
  expensePaymentDate?: string | null;
  expenseInvoicedDate?: string | null;
  expensePoNumber?: string | null;
  forecastPaymentDate?: string | null;
}, termsDays: number): string {
  if (line.expensePaymentDate && line.expensePaymentDate.trim()) return 'Actual payment date';
  if (line.expenseInvoicedDate && line.expenseInvoicedDate.trim()) return `invoicedDate + ${termsDays} days`;
  if (line.forecastPaymentDate && line.forecastPaymentDate.trim()) return 'Imported forecast date';
  if (line.expensePoNumber && line.expensePoNumber.trim()) return 'PO-based estimate + terms';
  return 'Linear allocation across construction window';
}
