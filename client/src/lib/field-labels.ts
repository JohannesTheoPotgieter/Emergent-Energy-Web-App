/** Human-readable labels for DB column names surfaced in manual_overrides / trust.editedFields. */
export const FIELD_LABELS: Record<string, string> = {
  // Cost lines
  expense_po_number: "PO Number",
  expense_invoice_number: "Invoice Number",
  expense_invoiced_date: "Invoice Date",
  expense_payment_date: "Payment Date",
  expense_actual_total: "Actual Total",
  expense_category: "Expense Category",
  expense_line_item: "Line Item",
  budget_total: "Budget Total",
  budget_qty: "Budget Qty",
  budget_rate_unit: "Budget Rate / Unit",
  forecast_payment_date: "Forecast Payment Date",
  line_status: "Line Status",
  actual_qty: "Actual Qty",
  actual_rate: "Actual Rate",
  comments: "Comments",
  check_flag: "Check Flag",
  saving_overrun: "Saving / Overrun",
  usd_exchange_rate: "USD Exchange Rate",
  price_per_watt: "R/W Price",
  // Revenue lines
  milestone_name: "Milestone Name",
  milestone_amount: "Milestone Amount",
  milestone_percent: "Milestone %",
  milestone_invoice_number: "Invoice Number",
  invoice_raised_date: "Invoice Raised Date",
  in_bank: "In Bank",
  milestone_notes: "Notes",
  date: "Date",
  // Work items
  title: "Task Title",
  start_date: "Start Date",
  end_date: "End Date",
  duration: "Duration",
  percent_complete: "% Complete",
  expected_pct_complete: "% Expected",
  work_days: "Work Days",
  owner_name: "Owner",
  lead: "Lead",
  tracker_comments: "Comments",
  resource1: "Resource 1",
  resource2: "Resource 2",
};

export function humaniseField(fieldName: string): string {
  if (FIELD_LABELS[fieldName]) return FIELD_LABELS[fieldName];
  return fieldName
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}
