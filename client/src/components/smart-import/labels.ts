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

// QuickBooks protections callout (A2) — plain-language strings shown to
// the user while reviewing an import. These describe what the QB precedence
// gate will and will not do, in operator-friendly terms.
export const QB_PROTECTIONS_LABELS = {
  title: "QuickBooks is protecting some of these rows",
  linkedSuffix: "are linked to QuickBooks on this project. Their financial values will be taken from QuickBooks, not from your spreadsheet.",
  lockedHeading: "Locked from spreadsheet changes:",
  preserveMissing: "Linked rows missing from this upload will be kept (not soft-closed).",
  autoRealise: "If QuickBooks shows a cost as paid, it is recognised as cost automatically.",
  auditTrail: "Every difference between your spreadsheet and QuickBooks is logged for audit.",
  compactPrefix: "QuickBooks is protecting",
  compactSuffix: "on this project — locked financial fields will not be overwritten by this upload.",
  armedEmpty: "QuickBooks protection is on, but no rows on this project are linked yet — your spreadsheet values will land as-is.",
  off: "QuickBooks protection is currently off. Your spreadsheet values will land as-is, even on QuickBooks-linked rows.",
} as const;

// Money-impact summary (A1) — labels for the pre-commit financial dry-run
// shown on the Confirm step. Phrased so PMs and finance can read at a
// glance without looking up jargon.
export const MONEY_IMPACT_LABELS = {
  title: "What this import will move (excl. VAT)",
  subtitle: "A pre-commit estimate. Final figures are confirmed once the import lands.",
  revenueTitle: "Revenue / Milestones",
  costTitle: "Costs / Expenses",
  newIn: "New money in",
  netChange: "Net change to existing",
  qbHeld: "Held by QuickBooks (will not move)",
  removed: "Removed (missing from this upload)",
  preserved: "Preserved by QuickBooks link",
  keptByDecision: "Kept by your decision",
  nothing: "No financial movement",
  loading: "Calculating financial impact…",
  noActivity: "This import does not change any financial values.",
} as const;

// Integrity check (B4a) — labels for the invoice / PO data-hygiene report
// shown on the Confirm step. Phrasing assumes a finance / PM audience and
// stays plain-language ("warning", "rows", not "violations" / "tuples").
export const INTEGRITY_LABELS = {
  title: "Invoice & PO checks",
  loading: "Checking invoices and POs…",
  clean: "Invoice and PO checks passed — no issues found.",
  advisoryNote: "These are advisory checks. The import will still run; fix the workbook if any look wrong.",
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

// Upload step labels (UX-1). The upload step is the first thing a
// non-technical user sees. Copy here should be plain English, answer
// "what am I about to do?", and make the reversibility explicit.
export const UPLOAD_LABELS = {
  pageTitle: "Import a project plan",
  singleMode: {
    title: "Import one file",
    subtitle: "For a single project",
    description: "Choose this if you have one spreadsheet covering one project — a plan update, a revenue schedule, or a cost tracker.",
  },
  folderMode: {
    title: "Import a folder of files",
    subtitle: "Many projects or many sections at once",
    description: "Choose this when you have several spreadsheets (for example a SharePoint folder with plans for multiple projects).",
  },
  dropzone: {
    singleHint: "Drop your plan file here, or click to browse.",
    folderHint: "Drop a folder here, or click to browse. Sub-folders are scanned too.",
    accepted: "Accepted: .xlsx · .xlsm",
    singleMaxSize: "Max 25 MB.",
    folderMaxFiles: "Up to 100 files per run.",
    browserNote: "Folder upload works best in Chrome or Edge.",
  },
  howItWorks: {
    single: [
      "We'll read your spreadsheet and tell you what we found.",
      "You review the changes.",
      "We highlight anything that needs your decision.",
      "You confirm — nothing is saved until this step.",
    ],
    folder: [
      "We read every spreadsheet in the folder.",
      "We match each one to a project in the app (you can fix any mismatch).",
      "You review the changes per file in one place.",
      "You pick which files to import. Un-ticked files stay untouched.",
    ],
  },
  safety: "Nothing is saved until you click Commit at the final step — you can go back or cancel any time.",
  templateLink: "Download a sample plan template",
  guideLink: "Watch a 90-second guide",
} as const;

// Review & import labels (UX-6). The manual flow now collapses "What we
// found", "What changed" and "Confirm" into a single Review screen that opens
// with an at-a-glance change summary. Copy lives here so it can be tuned by a
// non-engineer in one place.
export const REVIEW_LABELS = {
  title: "Review & import",
  subtitle: "Here's everything this file will change. Nothing is saved until you press Confirm import.",
  glanceTitle: "At a glance",
  new: "new",
  updated: "updated",
  removed: "removed",
  noChanges: "No changes to import — your spreadsheet matches the app.",
  whatsChanging: "What's changing",
  whatsChangingEmpty: "Everything in this file is brand new — it will all be added.",
  showAllChanges: "Show every changed row",
  moreFields: "more",
  moreItems: "more",
  sectionDetails: "Section details",
  decisionsNeededSuffix: "need your decision before you can import",
  resolveDecisions: "Resolve decisions",
  moneyTitle: "Money impact",
  checksTitle: "Invoice & PO checks",
  whoSeesTitle: "Who will see this",
  fileDetailsTitle: "More about this file",
  sheetsNotUsed: "Sheets not used",
  keyDates: "Key dates",
} as const;

// Short step labels for the simplified 2/3-stop manual flow (Upload →
// [Your decisions] → Review & import). The longer V2_STEP_LABELS above are
// kept for the operator guide / docs vocabulary.
export const FLOW_STEP_LABELS = {
  upload: "Upload",
  decisions: "Your decisions",
  review: "Review & import",
} as const;

// Bulk / folder journey labels (UX-5). Copy for the multi-file bulk
// commit panel, the bulk intro narrative, and the bulk post-commit
// result screen. Phrasing mirrors UX-3's single-file "what happens
// next" so the non-technical user sees the same vocabulary in both
// flows.
export const BULK_LABELS = {
  intro: {
    titleSingular: "We're ready to commit 1 file",
    titlePlural: "We're ready to commit %n files",
    readyPrefix: "%n ready to commit",
    blockedPrefix: "%n need your attention",
    stuckPrefix: "%n still have blockers — fix or skip each before committing",
    grouping: "Files are grouped per project below. Use 'Review' to open a single file, or 'Allow All' to accept a file's warnings in one click.",
  },
  result: {
    titleCommittedOnly: "All files imported",
    titleMixed: "Bulk import finished",
    titleFailedOnly: "Bulk import did not complete",
    perFileHeading: "Per-file result",
    whatNextHeading: "What happens next",
    whatNextItems: [
      "Dashboards for every affected project refresh within about 30 seconds.",
      "Anyone owning a task whose dates or owner changed gets a notification.",
      "Finance revenue will re-sync with QuickBooks on the next automatic run.",
    ],
    viewProjectAction: "View project",
    retryAction: "Try again",
    uploadMoreAction: "Import more files",
    undoHint: "Each committed file is logged and reversible for 7 days via Import History.",
  },
} as const;
