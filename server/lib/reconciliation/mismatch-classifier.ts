/**
 * Mismatch classification + risk rules for the Excel-vs-App
 * reconciliation system.
 *
 * Classification is pure (no I/O). Call `classifyDriftField` to get a
 * type + risk for a single tracker field drift. Call `classifyFinanceException`
 * to classify rows from the finance exception queue.
 *
 * Risk rules:
 *   HIGH  — finance amount, status, invoice/PO, duplicate, missing entity
 *   MEDIUM — date variance, stale data, unmatched QB, formula drift
 *   LOW   — metadata/label/description fields, minor formatting
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const MISMATCH_TYPES = [
  "value_mismatch",
  "date_mismatch",
  "amount_mismatch",
  "status_mismatch",
  "missing_in_app",
  "missing_in_excel",
  "duplicate_project",
  "duplicate_invoice",
  "invoice_without_po",
  "stale_excel_data",
  "stale_app_data",
  "formula_or_calculation_difference",
  "unmapped_project",
  "unmapped_vendor_or_customer",
] as const;

export type MismatchType = (typeof MISMATCH_TYPES)[number];
export type RiskLevel = "high" | "medium" | "low";
export type DiffSection = "PLAN" | "REVENUE" | "EXPENDITURE";

export interface ClassifiedMismatch {
  type: MismatchType;
  risk: RiskLevel;
  displayLabel: string;
  businessImpact: string;
  suggestedOwner: string;
  /** Allow bulk mark-reviewed only for low-risk items. */
  allowBulkClose: boolean;
  /** High-risk items require an owner + note before closing. */
  requireOwnerNote: boolean;
}

// ---------------------------------------------------------------------------
// Field sets — sourced from shared/excel-vs-app/contract.ts field lists
// ---------------------------------------------------------------------------

const DATE_FIELDS = new Set([
  "startDate", "endDate", "actualStart", "actualEnd",
  "expectedPaymentDate", "invoiceDate", "paidDate", "inBankDate",
  "actualDuration",
]);

const AMOUNT_FIELDS = new Set([
  "amountExVat", "vat", "milestonePercent",
  "budgetQty", "budgetRate", "budgetTotal", "budgetCos",
]);

const STATUS_FIELDS = new Set(["status"]);

// Finance-sensitive sections where amount / date drift carries higher risk.
const FINANCE_SECTIONS = new Set<DiffSection>(["REVENUE", "EXPENDITURE"]);

// ---------------------------------------------------------------------------
// Classifier helpers
// ---------------------------------------------------------------------------

function detectFieldCategory(fieldName: string): "date" | "amount" | "status" | "other" {
  if (DATE_FIELDS.has(fieldName)) return "date";
  if (AMOUNT_FIELDS.has(fieldName)) return "amount";
  if (STATUS_FIELDS.has(fieldName)) return "status";
  return "other";
}

/** Estimate a percentage variance between two numeric-ish values.
 *  Returns null when neither value is parseable as a number. */
function percentVariance(a: unknown, b: unknown): number | null {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return null;
  const ref = Math.abs(na) || Math.abs(nb);
  if (ref === 0) return 0;
  return (Math.abs(na - nb) / ref) * 100;
}

/** Parse date-like values and return the day gap between them. */
function dayDifference(a: unknown, b: unknown): number | null {
  const da = a ? new Date(String(a)).getTime() : NaN;
  const db = b ? new Date(String(b)).getTime() : NaN;
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.abs(da - db) / (1000 * 60 * 60 * 24);
}

// ---------------------------------------------------------------------------
// Public: classify a single tracker field drift
// ---------------------------------------------------------------------------

/**
 * Classify a field-level drift row from the tracker replica system.
 *
 * @param fieldName  The name of the drifted field (from contract tracked lists).
 * @param section    Which tracker section the row belongs to.
 * @param liveValue  Current app value.
 * @param snapshotValue  Last imported Excel value.
 */
export function classifyDriftField(
  fieldName: string,
  section: DiffSection,
  liveValue: unknown,
  snapshotValue: unknown,
): ClassifiedMismatch {
  const cat = detectFieldCategory(fieldName);
  const isFinanceSection = FINANCE_SECTIONS.has(section);

  if (cat === "amount") {
    const pct = percentVariance(liveValue, snapshotValue);
    const isHighRisk = isFinanceSection && (pct === null || pct > 1);
    return {
      type: "amount_mismatch",
      risk: isHighRisk ? "high" : "medium",
      displayLabel: "Amount mismatch",
      businessImpact: isHighRisk
        ? "Finance amount divergence may affect reported revenue, COS, or GP."
        : "Minor amount variance in non-finance section.",
      suggestedOwner: isFinanceSection ? "Finance Manager" : "Programme Manager",
      allowBulkClose: !isHighRisk,
      requireOwnerNote: isHighRisk,
    };
  }

  if (cat === "date") {
    const days = dayDifference(liveValue, snapshotValue);
    const isHighRisk = isFinanceSection && (days === null || days > 30);
    const isMediumRisk = days !== null && days > 7;
    return {
      type: "date_mismatch",
      risk: isHighRisk ? "high" : isMediumRisk ? "medium" : "low",
      displayLabel: "Date mismatch",
      businessImpact: isHighRisk
        ? "Payment/invoice date divergence affects cashflow timing and COS realisation."
        : "Schedule date variance.",
      suggestedOwner: isFinanceSection ? "Finance Manager" : "Project Manager",
      allowBulkClose: !isHighRisk,
      requireOwnerNote: isHighRisk,
    };
  }

  if (cat === "status") {
    return {
      type: "status_mismatch",
      risk: "high",
      displayLabel: "Status mismatch",
      businessImpact:
        "Lifecycle or realisation status divergence affects what is counted as realised revenue or COS.",
      suggestedOwner: isFinanceSection ? "Finance Manager" : "Programme Manager",
      allowBulkClose: false,
      requireOwnerNote: true,
    };
  }

  // "other" — metadata, labels, comments
  return {
    type: "value_mismatch",
    risk: isFinanceSection ? "medium" : "low",
    displayLabel: "Value mismatch",
    businessImpact: isFinanceSection
      ? "Field divergence in a finance record. Verify whether this affects calculations."
      : "Non-financial metadata differs between tracker and app.",
    suggestedOwner: isFinanceSection ? "Finance Manager" : "Project Manager",
    allowBulkClose: !isFinanceSection,
    requireOwnerNote: false,
  };
}

// ---------------------------------------------------------------------------
// Public: classify finance exception queue categories
// ---------------------------------------------------------------------------

type FinanceExceptionCategory =
  | "missing_po"
  | "unmatched_cost_invoice"
  | "unmatched_revenue_payment"
  | "duplicate_link_candidate"
  | "cost_override"
  | "revenue_override";

export function classifyFinanceException(
  category: FinanceExceptionCategory,
): ClassifiedMismatch {
  switch (category) {
    case "missing_po":
      return {
        type: "invoice_without_po",
        risk: "high",
        displayLabel: "Invoice without PO",
        businessImpact:
          "An invoice has been captured without a linked purchase order. This is a procurement compliance red flag and may affect COS approval workflows.",
        suggestedOwner: "Procurement / Finance Manager",
        allowBulkClose: false,
        requireOwnerNote: true,
      };

    case "unmatched_cost_invoice":
      return {
        type: "amount_mismatch",
        risk: "high",
        displayLabel: "Unmatched cost invoice (no QB link)",
        businessImpact:
          "A realised cost invoice in the app has no confirmed QuickBooks bill link. COS figures and payment verification are unreliable until matched.",
        suggestedOwner: "Finance Manager / Accountant",
        allowBulkClose: false,
        requireOwnerNote: true,
      };

    case "unmatched_revenue_payment":
      return {
        type: "amount_mismatch",
        risk: "high",
        displayLabel: "Unmatched revenue payment (no QB link)",
        businessImpact:
          "A received payment in the app has no confirmed QuickBooks invoice link. Revenue realisation figures cannot be verified.",
        suggestedOwner: "Finance Manager / Accountant",
        allowBulkClose: false,
        requireOwnerNote: true,
      };

    case "duplicate_link_candidate":
      return {
        type: "duplicate_invoice",
        risk: "high",
        displayLabel: "Duplicate QB link candidate",
        businessImpact:
          "A record has both active and previously-deleted QuickBooks links, suggesting a bounced reconciliation. Duplicate or incorrect invoice mapping may result in double-counted COS/revenue.",
        suggestedOwner: "Finance Manager",
        allowBulkClose: false,
        requireOwnerNote: true,
      };

    case "cost_override":
      return {
        type: "value_mismatch",
        risk: "medium",
        displayLabel: "Manual cost override in effect",
        businessImpact:
          "A cost line has an active admin override on date or status. The override supersedes the imported tracker value. Verify the override is still intentional.",
        suggestedOwner: "Finance Manager",
        allowBulkClose: false,
        requireOwnerNote: false,
      };

    case "revenue_override":
      return {
        type: "value_mismatch",
        risk: "medium",
        displayLabel: "Manual revenue override in effect",
        businessImpact:
          "A revenue line has an active admin date override. The override supersedes the imported tracker value.",
        suggestedOwner: "Finance Manager",
        allowBulkClose: false,
        requireOwnerNote: false,
      };
  }
}

// ---------------------------------------------------------------------------
// Public: classify a stale tracker / stale app situation
// ---------------------------------------------------------------------------

/** Stale threshold in days. */
export const STALE_EXCEL_THRESHOLD_DAYS = 30;
export const STALE_APP_THRESHOLD_DAYS = 14;

export function classifyStaleData(
  kind: "excel" | "app",
  daysSinceUpdate: number,
): ClassifiedMismatch {
  return {
    type: kind === "excel" ? "stale_excel_data" : "stale_app_data",
    risk: daysSinceUpdate > 60 ? "high" : "medium",
    displayLabel: kind === "excel" ? "Stale tracker data" : "Stale app data",
    businessImpact:
      kind === "excel"
        ? `Tracker workbook has not been imported in ${daysSinceUpdate} days. App data may be ahead of Excel.`
        : `App record has not been updated in ${daysSinceUpdate} days. May not reflect current project state.`,
    suggestedOwner: kind === "excel" ? "Programme Manager" : "Project Manager",
    allowBulkClose: daysSinceUpdate <= 60,
    requireOwnerNote: daysSinceUpdate > 60,
  };
}

// ---------------------------------------------------------------------------
// Public: classify unmapped entity
// ---------------------------------------------------------------------------

export function classifyUnmapped(
  kind: "project" | "vendor_or_customer",
): ClassifiedMismatch {
  return {
    type: kind === "project" ? "unmapped_project" : "unmapped_vendor_or_customer",
    risk: "medium",
    displayLabel: kind === "project" ? "Unmapped project" : "Unmapped vendor / customer",
    businessImpact:
      kind === "project"
        ? "A project code in the tracker has no matching app project. Imports for this project will fail or create duplicates."
        : "A counterparty in the tracker or QB has no app equivalent. Reconciliation cannot proceed.",
    suggestedOwner: "Programme Manager",
    allowBulkClose: false,
    requireOwnerNote: false,
  };
}

// ---------------------------------------------------------------------------
// Public: human-readable risk label
// ---------------------------------------------------------------------------

export function riskLabel(risk: RiskLevel): string {
  switch (risk) {
    case "high": return "High";
    case "medium": return "Medium";
    case "low": return "Low";
  }
}
