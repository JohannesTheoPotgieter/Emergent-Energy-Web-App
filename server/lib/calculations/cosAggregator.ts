import type { ExpenseState } from './stateClassifier';

export interface COSLineItem {
  id: number;
  projectName: string;
  expenseCategory: string | null;
  expenseLineItem: string | null;
  amount: number;
  state: ExpenseState;
  invoiceNumber: string | null;
  poNumber: string | null;
  invoicedDate: string | null;
  paymentDate: string | null;
  forecastPaymentDate: string | null;
  supplierName: string | null;
  confidence: 'High' | 'Medium' | 'Low';
  assumptionDriver: string;
}

export interface COSSummary {
  totalPlanned: number;
  totalCommitted: number;
  totalInvoiced: number;
  totalPaid: number;
  totalOutstanding: number;
  forecastNext4w: number;
  forecastNext8w: number;
  forecastNext12w: number;
  lineCount: number;
}

export interface ProjectCOS {
  projectName: string;
  planned: number;
  committed: number;
  invoiced: number;
  paid: number;
  outstanding: number;
  forecastNext4w: number;
  lineCount: number;
}

function addWeeks(from: Date, weeks: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

function isInRange(dateStr: string | null, start: Date, end: Date): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  return d >= start && d < end;
}

export function aggregateCOS(lines: COSLineItem[], referenceDate?: Date): COSSummary {
  const today = referenceDate || new Date();
  const w4 = addWeeks(today, 4);
  const w8 = addWeeks(today, 8);
  const w12 = addWeeks(today, 12);

  let totalPlanned = 0, totalCommitted = 0, totalInvoiced = 0, totalPaid = 0;
  let forecastNext4w = 0, forecastNext8w = 0, forecastNext12w = 0;

  for (const line of lines) {
    switch (line.state) {
      case 'Planned': totalPlanned += line.amount; break;
      case 'Committed': totalCommitted += line.amount; break;
      case 'Invoiced': totalInvoiced += line.amount; break;
      case 'Paid': totalPaid += line.amount; break;
    }

    if (line.state !== 'Paid' && line.forecastPaymentDate) {
      if (isInRange(line.forecastPaymentDate, today, w4)) forecastNext4w += line.amount;
      if (isInRange(line.forecastPaymentDate, today, w8)) forecastNext8w += line.amount;
      if (isInRange(line.forecastPaymentDate, today, w12)) forecastNext12w += line.amount;
    }
  }

  return {
    totalPlanned,
    totalCommitted,
    totalInvoiced,
    totalPaid,
    totalOutstanding: totalCommitted + totalInvoiced,
    forecastNext4w,
    forecastNext8w,
    forecastNext12w,
    lineCount: lines.length,
  };
}

export function aggregateCOSByProject(lines: COSLineItem[], referenceDate?: Date): ProjectCOS[] {
  const today = referenceDate || new Date();
  const w4 = addWeeks(today, 4);

  const byProject = new Map<string, ProjectCOS>();

  for (const line of lines) {
    if (!byProject.has(line.projectName)) {
      byProject.set(line.projectName, {
        projectName: line.projectName,
        planned: 0,
        committed: 0,
        invoiced: 0,
        paid: 0,
        outstanding: 0,
        forecastNext4w: 0,
        lineCount: 0,
      });
    }
    const p = byProject.get(line.projectName)!;
    p.lineCount++;

    switch (line.state) {
      case 'Planned': p.planned += line.amount; break;
      case 'Committed': p.committed += line.amount; break;
      case 'Invoiced': p.invoiced += line.amount; break;
      case 'Paid': p.paid += line.amount; break;
    }

    if (line.state !== 'Paid' && line.forecastPaymentDate) {
      if (isInRange(line.forecastPaymentDate, today, w4)) p.forecastNext4w += line.amount;
    }
  }

  for (const p of byProject.values()) {
    p.outstanding = p.committed + p.invoiced;
  }

  return Array.from(byProject.values()).sort((a, b) => (b.paid + b.outstanding) - (a.paid + a.outstanding));
}
