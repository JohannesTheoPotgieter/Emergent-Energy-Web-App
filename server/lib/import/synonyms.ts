export const PLAN_SYNONYMS: Record<string, string[]> = {
  task_name: ["high level programme", "programme", "task", "activity", "work item", "description", "milestone"],
  task_no: ["no.", "no", "item", "#", "ref", "task no"],
  start_date: ["actual start", "start date", "start", "planned start"],
  end_date: ["actual end", "end date", "end", "planned end", "finish date"],
  duration: ["duration", "days", "duration (days)"],
  pct_complete: ["status", "% complete", "progress", "completion", "actual %", "actual status"],
  expected_pct: ["expected", "expected %", "planned %", "expected status", "baseline %"],
  owner: ["owner", "responsible", "assigned to", "resource", "person"],
  phase: ["phase", "stage", "section"],
};

export const REVENUE_SYNONYMS: Record<string, string[]> = {
  milestone_name: ["payment milestone", "milestone", "description", "revenue milestone"],
  milestone_no: ["no.", "no", "milestone no", "#"],
  percent: ["%", "percent", "percentage", "milestone %"],
  amount_ex_vat: ["value", "amount", "value (excl. vat)", "excl vat", "value ex vat", "amount ex vat"],
  vat: ["vat", "vat amount"],
  invoice_number: ["invoice number", "invoice no", "inv no", "invoice #"],
  invoice_date: ["invoice raised date", "invoice date", "date invoiced", "inv date"],
  planned_payment_date: ["planned payment date", "planned date", "expected date", "due date"],
  payment_received_date: ["payment received date", "received date", "paid date", "payment date"],
  in_bank_date: ["in bank date", "bank date", "cleared date"],
  requirements: ["requirement", "notes", "conditions", "comments"],
  documents: ["milestone documents received", "documents", "docs received"],
};

export const EXPENDITURE_SYNONYMS: Record<string, string[]> = {
  cost_category: ["product/ service", "product", "category", "cost category", "service category"],
  description: ["description of work", "description", "line item", "item description", "detail"],
  counterparty: ["supplier", "contractor", "vendor", "counterparty", "company", "installer", "sub-contractor"],
  budget_qty: ["qty", "quantity", "budget qty"],
  budget_rate: ["rate / unit", "rate", "unit rate", "budget rate"],
  budget_total: ["budget total", "budget amount", "budgeted"],
  actual_total: ["actual total", "actual amount", "actual cost", "actual"],
  amount_ex_vat: ["amount ex vat", "amount excl vat", "excl vat", "cost ex vat"],
  po_number: ["po number", "po no", "purchase order", "po #"],
  invoice_number: ["invoice number", "invoice no", "inv no", "invoice #"],
  invoice_date: ["invoice raised date", "invoice date", "date invoiced"],
  approved_date: ["approved date", "approval date", "date approved"],
  payment_date: ["finance payment date", "payment date", "paid date", "date paid"],
  forecast_payment_date: ["forecasted payment date", "forecast payment date", "forecast pay date"],
  budget_cos: ["budget cos", "budget cost of sales"],
  actual_cos: ["actual cos", "total cos", "cost of sales"],
};

export const SECTION_ANCHORS: Record<string, { sheetNames: string[]; anchorPhrases: string[]; requiredFields: string[] }> = {
  PLAN: {
    sheetNames: ["project plan", "plan", "programme", "schedule", "project programme", "project schedule"],
    anchorPhrases: ["high level programme", "actual start", "actual end", "programme", "milestone", "planned start", "planned end", "status"],
    requiredFields: ["task_name"],
  },
  REVENUE: {
    sheetNames: ["revenue tracking", "revenue", "inflows", "income", "billing", "sheet1"],
    anchorPhrases: ["payment milestone", "invoice number", "invoice raised", "payment received", "value", "milestone", "planned payment", "excl vat", "ex vat", "project milestone"],
    requiredFields: ["milestone_name"],
  },
  EXPENDITURE: {
    sheetNames: ["expenditure breakdown", "expenditure", "costs", "expenses", "cost breakdown", "expenditure tracking"],
    anchorPhrases: ["product/service", "description of work", "actual total", "po number", "invoice number", "finance payment", "budget total", "rate/unit", "supplier", "counterparty", "qty", "cost category"],
    requiredFields: [],
  },
  CASHFLOW: {
    sheetNames: ["cashflow", "cash flow", "cash-flow"],
    anchorPhrases: ["week", "inflow", "outflow", "balance", "cumulative", "planned revenue", "planned expenditure"],
    requiredFields: [],
  },
};

export function getSynonymsForSection(section: string): Record<string, string[]> {
  switch (section) {
    case "PLAN": return PLAN_SYNONYMS;
    case "REVENUE": return REVENUE_SYNONYMS;
    case "EXPENDITURE": return EXPENDITURE_SYNONYMS;
    default: return {};
  }
}
