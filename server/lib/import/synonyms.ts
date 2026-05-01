export const PLAN_SYNONYMS: Record<string, string[]> = {
  task_name: ["high level programme", "programme", "task", "activity", "work item", "description", "milestone", "task name", "task description", "programme description", "item description"],
  task_no: ["no.", "no", "item", "#", "ref", "task no", "wbs", "wbs no", "task #", "item no", "item #", "task number", "id"],
  start_date: ["planned start", "start date", "start", "baseline start", "plan start", "planned start date", "target start"],
  end_date: ["planned end", "end date", "end", "finish date", "baseline end", "plan end", "planned end date", "planned finish", "target end", "target finish"],
  duration: ["duration", "days", "duration (days)", "duration (work days)", "planned duration", "total days", "calendar days"],
  actual_start: ["actual start", "actual start date", "act start", "real start"],
  actual_end: ["actual end", "actual end date", "actual finish", "act end", "act finish", "real end"],
  // Tracker col K — "WORK DAYS" — distinct from `duration` (calendar days)
  // and `actual_duration` (number of days elapsed). The Tracker uses this
  // for net working-day count excluding weekends/non-work days.
  work_days: ["work days", "working days", "workdays", "net work days"],
  actual_duration: ["actual duration", "actual days", "act duration"],
  pct_complete: ["status", "% complete", "progress", "completion", "actual %", "actual status", "% done", "done", "complete %", "percentage complete"],
  expected_pct: ["expected", "expected %", "planned %", "expected status", "baseline %", "% forecasted", "forecasted", "target %", "planned progress"],
  // Owner / Lead / Resource 1 / Resource 2 are FOUR distinct columns in the
  // Tracker — previously the synonym map collapsed them onto `owner` so
  // whichever appeared first won and the others were silently dropped.
  owner: ["owner", "responsible", "assigned to", "person", "project manager", "pm", "responsible person"],
  lead: ["lead", "team lead", "task lead"],
  resource_1: ["resource 1", "resource1", "resource one", "primary resource"],
  resource_2: ["resource 2", "resource2", "resource two", "secondary resource"],
  predecessor: ["predecessor", "predecessors", "depends on", "dependency", "dependencies"],
  phase: ["phase", "stage", "section", "work package", "category"],
  // Tracker col D "COMMENTS" — free-text notes against the task. Distinct
  // from the task description (col B "TASK"). Stored on the new
  // work_items.tracker_comments column rather than collapsing onto
  // resource_2 / description.
  tracker_comments: ["comment", "comments", "notes", "remarks", "note", "remark", "task comments", "row comments"],
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
  // Tracker col R "MILESTONE NOTES & COMMENTS" — was previously mapped to
  // `requirements` which had no schema target, so the field was silently
  // dropped on every import. Now lands on
  // normalized_revenue_lines.milestone_notes.
  milestone_notes: ["milestone notes", "milestone notes & comments", "milestone notes and comments", "notes", "notes & comments", "comments", "milestone comments", "requirement", "requirements", "conditions"],
  documents: ["milestone documents received", "documents", "docs received"],
};

export const EXPENDITURE_SYNONYMS: Record<string, string[]> = {
  cost_category: ["product/ service", "product / service", "product", "category", "cost category", "service category"],
  description: ["description of work", "description", "line item", "item description", "detail"],
  counterparty: ["supplier", "contractor", "vendor", "counterparty", "company", "installer", "sub-contractor"],
  // Costed-side QTY and Rate (Tracker cols E, F).
  budget_qty: ["qty", "quantity", "budget qty", "costed qty"],
  budget_rate: ["rate / unit", "rate/unit", "rate", "unit rate", "budget rate", "costed rate"],
  budget_total: ["budget total", "budget amount", "budgeted"],
  // Actual-side QTY and Rate (Tracker cols O, P) — previously mapped to
  // budget_qty/budget_rate via the same synonyms, which clobbered the
  // costed values whenever both sides were present. Now distinct fields
  // on normalized_cost_lines.actual_qty / actual_rate.
  actual_qty: ["actual qty", "actual quantity", "qty actual"],
  actual_rate: ["actual rate", "actual unit rate", "rate actual"],
  actual_total: ["actual total", "actual amount", "actual cost", "actual"],
  amount_ex_vat: ["amount ex vat", "amount excl vat", "excl vat", "cost ex vat"],
  po_number: ["po number", "po no", "purchase order", "po #"],
  invoice_number: ["invoice number", "invoice no", "inv no", "invoice #"],
  invoice_date: ["invoice raised date", "invoice date", "date invoiced"],
  approved_date: ["approved date", "approval date", "date approved"],
  payment_date: ["payment date", "paid date", "date paid", "finance payment date"],
  forecast_payment_date: ["forecasted payment date", "forecast payment date", "forecast pay date"],
  budget_cos: ["budget cos", "budget cost of sales"],
  actual_cos: ["actual cos", "total cos", "cost of sales"],
  revenue_recognition_amount: ["revenue recognition amount", "revenue recognition", "rev recognition"],
  // Budget-pane column for category-level revenue allocation (J_cat).
  // This is the "Total Revenue" column in the costed section, always in the budget pane.
  category_revenue_allocation: ["total revenue", "revenue allocation", "revenue alloc", "category revenue", "rev allocation", "costed revenue"],
  // Budget-pane column for category-level COS total (X_cat costed).
  category_cos_total: ["total cos"],
  // Tracker col V "CHECK" — formula-driven validation flag. Stored verbatim.
  check_flag: ["check", "validation", "check flag"],
  // Tracker col Z "Saving / Overrun" — variance between costed and actual.
  saving_overrun: ["saving / overrun", "saving/overrun", "saving", "overrun", "variance"],
  // Tracker col AA "Comments" — per-line free-text notes.
  comments: ["comments", "comment", "notes", "remarks", "line comments"],
  // Tracker cols AB/AC and AE — header values that apply to all lines below.
  usd_exchange_rate: ["usd exchange rate", "usd rate", "exchange rate", "fx rate"],
  price_per_watt: ["price per watt", "$/w", "r/w", "price/watt", "rate per watt"],
};

export const SECTION_ANCHORS: Record<string, { sheetNames: string[]; anchorPhrases: string[]; requiredFields: string[] }> = {
  PLAN: {
    sheetNames: ["project plan", "plan", "programme", "schedule", "project programme", "project schedule", "construction programme", "master programme", "master plan", "project tracker"],
    anchorPhrases: ["high level programme", "actual start", "actual end", "programme", "milestone", "planned start", "planned end", "status", "% complete", "% done", "% forecasted", "wbs", "task", "task name", "duration", "baseline start", "baseline end", "task no", "owner"],
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
};

export function getSynonymsForSection(section: string): Record<string, string[]> {
  switch (section) {
    case "PLAN": return PLAN_SYNONYMS;
    case "REVENUE": return REVENUE_SYNONYMS;
    case "EXPENDITURE": return EXPENDITURE_SYNONYMS;
    default: return {};
  }
}
