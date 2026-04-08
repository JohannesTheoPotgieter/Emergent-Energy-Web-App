/**
 * Smart Import v2 — Plain-language labels and constants
 *
 * All user-facing text lives here. No technical jargon by default.
 */

// Step labels for the v2 wizard
export const V2_STEP_LABELS = [
  "Upload",
  "What we found",
  "What changed",
  "Needs your decision",
  "Confirm import",
] as const;

// Import mode labels
export const IMPORT_MODE_LABELS = {
  BASELINE: "First-time import",
  INCREMENTAL: "Update",
} as const;

// Section labels (non-technical)
export const SECTION_LABELS: Record<string, string> = {
  PLAN: "Schedule / Timeline",
  REVENUE: "Revenue / Milestones",
  EXPENDITURE: "Costs / Expenses",
};

// Row classification labels
export const CLASSIFICATION_LABELS: Record<string, string> = {
  NEW: "New data",
  CHANGED: "Updated data",
  UNCHANGED: "No change",
  MISSING_FROM_UPLOAD: "Not in this upload",
  CONFLICT_PLACEHOLDER: "Needs review",
};

// Merge case labels (for conflict decisions)
export const MERGE_CASE_LABELS: Record<string, string> = {
  UNCHANGED: "No change",
  AUTO_ACCEPT_FILE: "Updated from your spreadsheet",
  KEEP_APP: "Keeping current app value",
  CONFLICT: "Needs your decision",
};

// Conflict action labels
export const CONFLICT_ACTIONS = {
  KEEP_APP: "Keep current app value",
  ACCEPT_FILE: "Use uploaded value",
} as const;

// Field display names (plain language)
export const FIELD_DISPLAY_NAMES: Record<string, string> = {
  startDate: "Start date",
  endDate: "End date",
  durationDays: "Duration (days)",
  actualStartDate: "Actual start date",
  actualEndDate: "Actual end date",
  actualDurationDays: "Actual duration (days)",
  owner: "Owner",
  status: "Status",
  pctComplete: "% Complete",
  expectedPctComplete: "Expected % complete",
  comment: "Comment",
  isMilestone: "Milestone",
  parentTaskNo: "Parent task",
  amountExVat: "Amount (excl. VAT)",
  vat: "VAT",
  milestonePercent: "Milestone %",
  invoiceNumber: "Invoice number",
  invoiceDate: "Invoice date",
  expectedPaymentDate: "Expected payment date",
  paidDate: "Payment date",
  inBankDate: "In bank date",
  budgetQty: "Budget quantity",
  budgetRate: "Budget rate",
  budgetTotal: "Budget total",
  budgetCos: "Budget COS",
  approvedDate: "Approved date",
  forecastPaymentDate: "Forecast payment date",
  poNumber: "PO number",
  costCategory: "Cost category",
  counterpartyName: "Supplier / counterparty",
  revenueRecognitionAmount: "Revenue recognition",
};

/** Get a plain-language field name, falling back to the raw name */
export function fieldLabel(fieldName: string): string {
  return FIELD_DISPLAY_NAMES[fieldName] || fieldName.replace(/([A-Z])/g, " $1").toLowerCase().trim();
}

// Confirm step summary labels
export const CONFIRM_LABELS = {
  newRows: "New rows will be added",
  updatedRows: "Existing rows will be updated",
  unchangedRows: "Rows have no change",
  decisionsApplied: "Decisions were applied",
  missingRows: "Rows were not in this upload and will be kept unchanged",
} as const;

// Result screen labels
export const RESULT_LABELS = {
  success: "Import completed",
  newAdded: "New rows added",
  rowsUpdated: "Existing rows updated",
  noChange: "Rows left untouched",
  decisionsApplied: "Decisions applied",
  skippedKept: "Rows kept from previous import",
  dashboardNote: "Dashboard summaries may take a moment to update.",
} as const;
