import { createHash } from 'crypto';

export function computeExpenseLineHash(line: {
  projectName: string;
  expenseCategory?: string | null;
  expenseLineItem?: string | null;
  expenseActualTotal?: string | number | null;
  expenseInvoicedDate?: string | null;
  expenseInvoiceNumber?: string | null;
  rowNumber?: number | null;
}): string {
  const parts = [
    line.projectName,
    line.expenseCategory ?? '',
    line.expenseLineItem ?? '',
    String(line.expenseActualTotal ?? ''),
    line.expenseInvoicedDate ?? '',
    line.expenseInvoiceNumber ?? '',
    String(line.rowNumber ?? ''),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').substring(0, 16);
}

export function computeInflowLineHash(line: {
  projectName: string;
  milestoneName?: string | null;
  milestoneAmount?: string | number | null;
  invoiceRaisedDate?: string | null;
  milestoneInvoiceNumber?: string | null;
  rowNumber?: number | null;
}): string {
  const parts = [
    line.projectName,
    line.milestoneName ?? '',
    String(line.milestoneAmount ?? ''),
    line.invoiceRaisedDate ?? '',
    line.milestoneInvoiceNumber ?? '',
    String(line.rowNumber ?? ''),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').substring(0, 16);
}
