/**
 * Selected Truth Registry — canonical declaration of every KPI/formula
 * surfaced in reports and dashboards.
 *
 * Each entry declares WHERE the number comes from, WHO owns it, HOW
 * confident we are, and WHERE to drill into it. Reports and dashboards
 * must read KPIs through this registry (or cite it in their trust strip)
 * rather than reading raw tables without attribution.
 *
 * This module is pure metadata — it does NOT change any business formulas.
 * Formulas live in server/lib/calculations/financeUtils.ts and related
 * files. This registry documents them.
 *
 * Usage:
 *   import { KPI_REGISTRY, getKpiEntry } from "./selected-truth-registry";
 */

export type TruthSource =
  | "canonical"       // normalized_cost_lines / normalized_revenue_lines
  | "derived"         // finance_cos_monthly, finance_revenue_monthly
  | "excel_import"    // directly from last Smart Import run
  | "quickbooks"      // QuickBooks invoice/payment data
  | "override"        // admin manual override in effect
  | "app_workflow";   // app execution workflow data (work_items, stages, etc.)

export type Confidence = "high" | "medium" | "low";
export type UpdateFrequency =
  | "real_time"
  | "on_import"
  | "daily"
  | "monthly";

export interface KpiRegistryEntry {
  /** Stable machine key — never rename once deployed. */
  kpiKey: string;
  displayName: string;
  businessDefinition: string;
  /** Human-readable description of how the number is computed. */
  formula: string;
  selectedTruthSource: TruthSource;
  /** Source used when selected truth is unavailable. */
  fallbackSource: TruthSource | null;
  /** Team / role accountable for data correctness. */
  dataOwner: string;
  /** Team / role accountable for the formula logic. */
  formulaOwner: string;
  updateFrequency: UpdateFrequency;
  confidence: Confidence;
  /** Frontend route the KPI card should drill into. */
  drilldownRoute: string;
  /** Primary DB table(s) the number is read from. */
  canonicalTable: string;
  /** DB column / field the value resolves to. */
  resolvedField: string | null;
  /** If true, the KPI has known gaps and should display a low-trust badge. */
  hasKnownGaps: boolean;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const KPI_REGISTRY: KpiRegistryEntry[] = [
  // ── Revenue ──────────────────────────────────────────────────────────────
  {
    kpiKey: "revenue_realised",
    displayName: "Revenue Realised",
    businessDefinition:
      "Total revenue recognised where payment has been received into bank (status = in_bank or realised).",
    formula:
      "SUM(amount_ex_vat) FROM normalized_revenue_lines WHERE effective_to IS NULL AND status IN ('in_bank','realised')",
    selectedTruthSource: "canonical",
    fallbackSource: "derived",
    dataOwner: "Finance Manager",
    formulaOwner: "Finance Manager",
    updateFrequency: "on_import",
    confidence: "high",
    drilldownRoute: "/reports/programme",
    canonicalTable: "normalized_revenue_lines",
    resolvedField: "amount_ex_vat",
    hasKnownGaps: false,
  },
  {
    kpiKey: "revenue_invoiced",
    displayName: "Revenue Invoiced",
    businessDefinition:
      "Total revenue where invoices have been issued (status = invoiced, paid, in_bank, or realised).",
    formula:
      "SUM(amount_ex_vat) FROM normalized_revenue_lines WHERE effective_to IS NULL AND status IN ('invoiced','paid','in_bank','realised')",
    selectedTruthSource: "canonical",
    fallbackSource: "derived",
    dataOwner: "Finance Manager",
    formulaOwner: "Finance Manager",
    updateFrequency: "on_import",
    confidence: "high",
    drilldownRoute: "/revenue-tracker",
    canonicalTable: "normalized_revenue_lines",
    resolvedField: "amount_ex_vat",
    hasKnownGaps: false,
  },
  {
    kpiKey: "revenue_planned",
    displayName: "Revenue Planned (Contract Value)",
    businessDefinition:
      "Total planned revenue across all active milestones regardless of invoice status.",
    formula:
      "SUM(amount_ex_vat) FROM normalized_revenue_lines WHERE effective_to IS NULL",
    selectedTruthSource: "canonical",
    fallbackSource: "excel_import",
    dataOwner: "Programme Manager",
    formulaOwner: "Finance Manager",
    updateFrequency: "on_import",
    confidence: "medium",
    drilldownRoute: "/revenue-tracker",
    canonicalTable: "normalized_revenue_lines",
    resolvedField: "amount_ex_vat",
    hasKnownGaps: false,
  },

  // ── COS ──────────────────────────────────────────────────────────────────
  {
    kpiKey: "cos_realised",
    displayName: "COS Realised",
    businessDefinition:
      "Cost of Sales that has been realised: only rows with a captured invoice number and invoice date (not merely planned or approved).",
    formula:
      "SUM(amount_ex_vat) FROM normalized_cost_lines WHERE effective_to IS NULL AND invoice_number IS NOT NULL AND invoice_date IS NOT NULL",
    selectedTruthSource: "canonical",
    fallbackSource: "derived",
    dataOwner: "Finance Manager",
    formulaOwner: "Finance Manager",
    updateFrequency: "on_import",
    confidence: "high",
    drilldownRoute: "/reports/programme",
    canonicalTable: "normalized_cost_lines",
    resolvedField: "amount_ex_vat",
    hasKnownGaps: false,
  },
  {
    kpiKey: "cos_committed",
    displayName: "COS Committed (Approved/Invoiced)",
    businessDefinition:
      "Total COS for lines in approved or invoiced status, whether or not payment has been made.",
    formula:
      "SUM(amount_ex_vat) FROM normalized_cost_lines WHERE effective_to IS NULL AND status IN ('invoiced','approved','paid')",
    selectedTruthSource: "canonical",
    fallbackSource: "derived",
    dataOwner: "Finance Manager",
    formulaOwner: "Finance Manager",
    updateFrequency: "on_import",
    confidence: "high",
    drilldownRoute: "/reports/programme",
    canonicalTable: "normalized_cost_lines",
    resolvedField: "amount_ex_vat",
    hasKnownGaps: false,
  },
  {
    kpiKey: "cos_budgeted",
    displayName: "COS Budgeted",
    businessDefinition:
      "Total budgeted COS from all active cost lines regardless of status.",
    formula:
      "SUM(amount_ex_vat) FROM normalized_cost_lines WHERE effective_to IS NULL",
    selectedTruthSource: "canonical",
    fallbackSource: "excel_import",
    dataOwner: "Programme Manager",
    formulaOwner: "Finance Manager",
    updateFrequency: "on_import",
    confidence: "medium",
    drilldownRoute: "/reports/programme",
    canonicalTable: "normalized_cost_lines",
    resolvedField: "amount_ex_vat",
    hasKnownGaps: false,
  },

  // ── Gross Profit ──────────────────────────────────────────────────────────
  {
    kpiKey: "gross_profit_realised",
    displayName: "Gross Profit (Realised)",
    businessDefinition:
      "Realised revenue minus realised COS. Uses the COS-ratio allocation formula for project-level revenue recognition.",
    formula:
      "revenue_realised - cos_realised (COS-ratio method via allocateRevenue in financeUtils.ts)",
    selectedTruthSource: "derived",
    fallbackSource: "canonical",
    dataOwner: "Finance Manager",
    formulaOwner: "Finance Manager",
    updateFrequency: "on_import",
    confidence: "high",
    drilldownRoute: "/reports/programme",
    canonicalTable: "normalized_revenue_lines,normalized_cost_lines",
    resolvedField: null,
    hasKnownGaps: false,
  },

  // ── Cashflow ──────────────────────────────────────────────────────────────
  {
    kpiKey: "cashflow_net",
    displayName: "Net Cashflow",
    businessDefinition:
      "Net cashflow = payments received (paid_date) minus payments made (paid cost lines). Uses payment dates, not invoice dates.",
    formula:
      "SUM(revenue in_bank/paid) - SUM(cost paid) using payment dates from canonical tables",
    selectedTruthSource: "canonical",
    fallbackSource: null,
    dataOwner: "Finance Manager",
    formulaOwner: "Finance Manager",
    updateFrequency: "on_import",
    confidence: "medium",
    drilldownRoute: "/cashflow",
    canonicalTable: "normalized_revenue_lines,normalized_cost_lines",
    resolvedField: null,
    hasKnownGaps: true,
  },

  // ── Tracker / Reconciliation ──────────────────────────────────────────────
  {
    kpiKey: "invoice_without_po",
    displayName: "Invoices Without PO",
    businessDefinition:
      "Active cost lines that have an invoice number but no purchase order number. Procurement compliance red flag.",
    formula:
      "COUNT(*) FROM normalized_cost_lines WHERE effective_to IS NULL AND invoice_number IS NOT NULL AND po_number IS NULL",
    selectedTruthSource: "canonical",
    fallbackSource: null,
    dataOwner: "Procurement / Finance Manager",
    formulaOwner: "Finance Manager",
    updateFrequency: "real_time",
    confidence: "high",
    drilldownRoute: "/cos",
    canonicalTable: "normalized_cost_lines",
    resolvedField: "po_number",
    hasKnownGaps: false,
  },
  {
    kpiKey: "unmatched_cost_invoices",
    displayName: "Unmatched Cost Invoices (QB)",
    businessDefinition:
      "Cost lines with invoices that have no confirmed QuickBooks bill link. These cannot be independently verified.",
    formula:
      "COUNT(*) FROM normalized_cost_lines WHERE invoice_number IS NOT NULL AND no active QB link",
    selectedTruthSource: "quickbooks",
    fallbackSource: "canonical",
    dataOwner: "Finance Manager / Accountant",
    formulaOwner: "Finance Manager",
    updateFrequency: "daily",
    confidence: "medium",
    drilldownRoute: "/finance/qb-reconciliation",
    canonicalTable: "normalized_cost_lines,quickbooks_invoice_links",
    resolvedField: null,
    hasKnownGaps: false,
  },

  // ── Project / Programme ───────────────────────────────────────────────────
  {
    kpiKey: "active_projects",
    displayName: "Active Projects",
    businessDefinition:
      "Count of projects in 'active' lifecycle state.",
    formula:
      "COUNT(*) FROM project_info WHERE status = 'active'",
    selectedTruthSource: "app_workflow",
    fallbackSource: null,
    dataOwner: "Programme Manager",
    formulaOwner: "Programme Manager",
    updateFrequency: "real_time",
    confidence: "high",
    drilldownRoute: "/portfolios",
    canonicalTable: "project_info",
    resolvedField: "status",
    hasKnownGaps: false,
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

const _registryByKey = new Map(KPI_REGISTRY.map((e) => [e.kpiKey, e]));

export function getKpiEntry(kpiKey: string): KpiRegistryEntry | undefined {
  return _registryByKey.get(kpiKey);
}

/** Trust level string for display. Entries with known gaps are downgraded. */
export function kpiTrustLabel(entry: KpiRegistryEntry): "High trust" | "Medium trust" | "Low trust" {
  if (entry.hasKnownGaps || entry.confidence === "low") return "Low trust";
  if (entry.confidence === "medium") return "Medium trust";
  return "High trust";
}

/** Whether a KPI should appear in management-level reporting. */
export function isManagementReady(entry: KpiRegistryEntry): boolean {
  return !entry.hasKnownGaps && entry.confidence !== "low";
}
