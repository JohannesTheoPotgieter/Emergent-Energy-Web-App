export interface DataQualityIssue {
  ruleId: string;
  severity: 'Error' | 'Warning' | 'Info';
  description: string;
  count: number;
  items: { id: number; projectName: string; detail: string }[];
}

export interface ExpenseDQInput {
  id: number;
  projectName: string;
  expenseCategory: string | null;
  expenseLineItem: string | null;
  expenseActualTotal: string | number | null;
  expenseInvoiceNumber: string | null;
  expenseInvoicedDate: string | null;
  expensePaymentDate: string | null;
  expensePoNumber: string | null;
  supplierName: string | null;
}

export interface InflowDQInput {
  id: number;
  projectName: string;
  milestoneName: string | null;
  milestoneAmount: string | number | null;
  milestoneInvoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  paymentReceivedDate: string | null;
}

export interface ProjectDQInput {
  projectName: string;
  pm: string | null;
  constructionStartDate: string | null;
  commissioningDate: string | null;
}

function parseNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export function runDataQualityChecks(
  expenses: ExpenseDQInput[],
  inflows: InflowDQInput[],
  projects: ProjectDQInput[],
): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];

  const dq1Items: DataQualityIssue['items'] = [];
  for (const e of expenses) {
    if (e.expenseInvoiceNumber && e.expenseInvoiceNumber.trim() &&
        (e.expenseActualTotal == null || parseNum(e.expenseActualTotal) === 0)) {
      dq1Items.push({ id: e.id, projectName: e.projectName, detail: `Invoice ${e.expenseInvoiceNumber} has no amount` });
    }
  }
  issues.push({ ruleId: 'DQ-1', severity: 'Error', description: 'Expense with invoice but no amount', count: dq1Items.length, items: dq1Items });

  const dq2Items: DataQualityIssue['items'] = [];
  for (const e of expenses) {
    if (e.expensePaymentDate && e.expenseInvoicedDate) {
      const payD = new Date(e.expensePaymentDate);
      const invD = new Date(e.expenseInvoicedDate);
      if (!isNaN(payD.getTime()) && !isNaN(invD.getTime()) && payD < invD) {
        dq2Items.push({ id: e.id, projectName: e.projectName, detail: `Payment ${e.expensePaymentDate} before invoice ${e.expenseInvoicedDate}` });
      }
    }
  }
  issues.push({ ruleId: 'DQ-2', severity: 'Warning', description: 'Payment date before invoice date', count: dq2Items.length, items: dq2Items });

  const invoiceMap = new Map<string, { id: number; projectName: string }[]>();
  for (const e of expenses) {
    if (e.expenseInvoiceNumber && e.expenseInvoiceNumber.trim()) {
      const key = e.expenseInvoiceNumber.trim();
      if (!invoiceMap.has(key)) invoiceMap.set(key, []);
      invoiceMap.get(key)!.push({ id: e.id, projectName: e.projectName });
    }
  }
  const dq3Items: DataQualityIssue['items'] = [];
  invoiceMap.forEach((entries, invNum) => {
    const uniqueProjects = new Set(entries.map(e => e.projectName));
    if (uniqueProjects.size > 1) {
      dq3Items.push({ id: entries[0].id, projectName: Array.from(uniqueProjects).join(', '), detail: `Invoice ${invNum} appears across ${uniqueProjects.size} projects` });
    }
  });
  issues.push({ ruleId: 'DQ-3', severity: 'Warning', description: 'Duplicate invoice numbers across projects', count: dq3Items.length, items: dq3Items });

  const dq6Items: DataQualityIssue['items'] = [];
  for (const p of projects) {
    if (!p.pm || !p.pm.trim()) {
      dq6Items.push({ id: 0, projectName: p.projectName, detail: 'Missing PM assignment' });
    }
  }
  issues.push({ ruleId: 'DQ-6', severity: 'Warning', description: 'Project missing PM', count: dq6Items.length, items: dq6Items });

  const dq7Items: DataQualityIssue['items'] = [];
  for (const p of projects) {
    if (!p.constructionStartDate || !p.constructionStartDate.trim()) {
      dq7Items.push({ id: 0, projectName: p.projectName, detail: 'Missing construction start date' });
    }
  }
  issues.push({ ruleId: 'DQ-7', severity: 'Error', description: 'Project missing construction start date', count: dq7Items.length, items: dq7Items });

  const dq8Items: DataQualityIssue['items'] = [];
  for (const p of projects) {
    if (!p.commissioningDate || !p.commissioningDate.trim()) {
      dq8Items.push({ id: 0, projectName: p.projectName, detail: 'Missing commissioning date' });
    }
  }
  issues.push({ ruleId: 'DQ-8', severity: 'Error', description: 'Project missing commissioning date', count: dq8Items.length, items: dq8Items });

  const dq9Items: DataQualityIssue['items'] = [];
  for (const e of expenses) {
    const amt = parseNum(e.expenseActualTotal);
    if (amt < 0) {
      dq9Items.push({ id: e.id, projectName: e.projectName, detail: `Negative amount: R ${amt}` });
    }
  }
  issues.push({ ruleId: 'DQ-9', severity: 'Info', description: 'Negative expense amount', count: dq9Items.length, items: dq9Items });

  const dq10Items: DataQualityIssue['items'] = [];
  for (const e of expenses) {
    if (e.expenseInvoicedDate && e.expenseInvoicedDate.trim() &&
        (!e.expenseInvoiceNumber || !e.expenseInvoiceNumber.trim())) {
      dq10Items.push({ id: e.id, projectName: e.projectName, detail: `Has invoice date ${e.expenseInvoicedDate} but no invoice number` });
    }
  }
  issues.push({ ruleId: 'DQ-10', severity: 'Error', description: 'Invoice date exists but no invoice number', count: dq10Items.length, items: dq10Items });

  const dq11Items: DataQualityIssue['items'] = [];
  for (const e of expenses) {
    if ((e.expensePoNumber && e.expensePoNumber.trim()) || (e.expenseInvoiceNumber && e.expenseInvoiceNumber.trim())) {
      if (!e.supplierName || !e.supplierName.trim()) {
        dq11Items.push({ id: e.id, projectName: e.projectName, detail: `PO/Invoice exists but no supplier mapped` });
      }
    }
  }
  issues.push({ ruleId: 'DQ-11', severity: 'Info', description: 'Missing supplier mapping where PO/invoice exists', count: dq11Items.length, items: dq11Items.slice(0, 100) });

  return issues.filter(i => i.count > 0);
}
