import { sql } from "drizzle-orm";
import { db } from "../db";

export type FinanceLayerClass = "canonical" | "derived" | "cache" | "legacy" | "override";

export interface FinanceLayerEntry {
  name: string;
  kind: "table" | "service" | "route";
  classification: FinanceLayerClass;
  notes: string;
}

function asNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

export async function buildFinanceCoreTrustReport() {
  const financeTruthRoutes = [
    "/api/program-expenses",
    "/api/program-inflows",
    "/api/finance/cos",
    "/api/finance/revenue",
    "/api/company-overview",
  ] as const;

  const classifications: FinanceLayerEntry[] = [
    { name: "normalized_cost_lines", kind: "table", classification: "canonical", notes: "Canonical cost line ledger used for COS and cashflow reads." },
    { name: "normalized_revenue_lines", kind: "table", classification: "canonical", notes: "Canonical revenue line ledger used for realised and cash revenue reads." },
    { name: "finance_cos_monthly", kind: "table", classification: "derived", notes: "Monthly COS projection/summary; should reconcile back to canonical cost lines." },
    { name: "finance_revenue_monthly", kind: "table", classification: "derived", notes: "Monthly revenue summary; should reconcile back to canonical revenue lines." },
    { name: "getCanonicalAllCurrentCostLines", kind: "service", classification: "canonical", notes: "Canonical cost-line read service." },
    { name: "getAllRevenueLinesForCashflow", kind: "service", classification: "canonical", notes: "Canonical revenue-line read path for cashflow." },
    { name: "DatabaseStorage._expenseCache", kind: "service", classification: "cache", notes: "Short-TTL cache over expense compatibility view; must not be hidden from trust telemetry." },
    { name: "import_lineage", kind: "table", classification: "canonical", notes: "Smart Import lineage table used to preserve source-system traceability." },
    { name: "/api/program-expenses", kind: "route", classification: "legacy", notes: "Compatibility endpoint; source can vary with feature flag state." },
    { name: "/api/program-inflows", kind: "route", classification: "legacy", notes: "Compatibility endpoint; source can vary with feature flag state." },
    { name: "/api/finance/cos", kind: "route", classification: "derived", notes: "Portfolio COS aggregation endpoint." },
    { name: "/api/finance/revenue", kind: "route", classification: "derived", notes: "Portfolio revenue aggregation endpoint." },
    { name: "normalized_cost_lines.cos_status_override", kind: "table", classification: "override", notes: "Explicit manual override path with audit fields." },
    { name: "normalized_revenue_lines.admin_date_override", kind: "table", classification: "override", notes: "Manual date override path for revenue timing with audit metadata." },
  ];

  const [
    costLineage,
    revenueLineage,
    invoiceWithoutPo,
    cosDerivationDrift,
  ] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE effective_to IS NULL)::int AS active_rows,
        COUNT(*) FILTER (WHERE effective_to IS NULL AND (source_sheet IS NULL OR source_row IS NULL))::int AS missing_source_lineage
      FROM normalized_cost_lines
    `),
    db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE effective_to IS NULL)::int AS active_rows,
        COUNT(*) FILTER (WHERE effective_to IS NULL AND (source_sheet IS NULL OR source_row IS NULL))::int AS missing_source_lineage
      FROM normalized_revenue_lines
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM normalized_cost_lines
      WHERE effective_to IS NULL
        AND NULLIF(TRIM(COALESCE(invoice_number, '')), '') IS NOT NULL
        AND NULLIF(TRIM(COALESCE(po_number, '')), '') IS NULL
    `),
    db.execute(sql`
      WITH realised AS (
        SELECT
          project_id,
          DATE_TRUNC('month', invoice_date)::date AS month_end_date,
          SUM(COALESCE(amount_ex_vat, 0))::numeric AS canonical_value
        FROM normalized_cost_lines
        WHERE effective_to IS NULL
          AND NULLIF(TRIM(COALESCE(invoice_number, '')), '') IS NOT NULL
          AND invoice_date IS NOT NULL
        GROUP BY project_id, DATE_TRUNC('month', invoice_date)::date
      ), monthly AS (
        SELECT
          project_id,
          month_end_date,
          SUM(COALESCE(value, 0))::numeric AS monthly_value
        FROM finance_cos_monthly
        WHERE effective_to IS NULL
        GROUP BY project_id, month_end_date
      )
      SELECT
        COUNT(*)::int AS compared_rows,
        COUNT(*) FILTER (WHERE ABS(COALESCE(r.canonical_value, 0) - COALESCE(m.monthly_value, 0)) > 0.01)::int AS mismatched_rows
      FROM realised r
      FULL OUTER JOIN monthly m
        ON r.project_id = m.project_id
       AND r.month_end_date = m.month_end_date
    `),
  ]);

  const costRow = (costLineage.rows[0] ?? {}) as Record<string, unknown>;
  const revenueRow = (revenueLineage.rows[0] ?? {}) as Record<string, unknown>;
  const invoiceRow = (invoiceWithoutPo.rows[0] ?? {}) as Record<string, unknown>;
  const driftRow = (cosDerivationDrift.rows[0] ?? {}) as Record<string, unknown>;

  const trustGaps = [
    {
      key: "cost_missing_lineage",
      severity: asNumber(costRow.missing_source_lineage) > 0 ? "high" : "none",
      count: asNumber(costRow.missing_source_lineage),
      detail: "Active cost rows missing source_sheet or source_row reduce audit traceability.",
    },
    {
      key: "revenue_missing_lineage",
      severity: asNumber(revenueRow.missing_source_lineage) > 0 ? "high" : "none",
      count: asNumber(revenueRow.missing_source_lineage),
      detail: "Active revenue rows missing source lineage metadata reduce traceability.",
    },
    {
      key: "invoice_without_po",
      severity: asNumber(invoiceRow.count) > 0 ? "high" : "none",
      count: asNumber(invoiceRow.count),
      detail: "Invoice without PO remains a red-flag business rule and must be surfaced.",
    },
    {
      key: "cos_monthly_derivation_drift",
      severity: asNumber(driftRow.mismatched_rows) > 0 ? "medium" : "none",
      count: asNumber(driftRow.mismatched_rows),
      detail: "finance_cos_monthly differs from canonical invoice-based cost aggregation for one or more project-month rows.",
    },
    {
      key: "route_fragmentation",
      severity: financeTruthRoutes.length > 1 ? "medium" : "none",
      count: financeTruthRoutes.length,
      detail: `Multiple finance routes expose similar concepts (${financeTruthRoutes.join(", ")}) and can drift without explicit source labels.`,
    },
  ];

  const reconciliationChecks = {
    canonicalTotals: {
      activeCostRows: asNumber(costRow.active_rows),
      activeRevenueRows: asNumber(revenueRow.active_rows),
    },
    lineageCoverage: {
      costMissingSource: asNumber(costRow.missing_source_lineage),
      revenueMissingSource: asNumber(revenueRow.missing_source_lineage),
    },
    cosMonthlyVsCanonical: {
      comparedRows: asNumber(driftRow.compared_rows),
      mismatchedRows: asNumber(driftRow.mismatched_rows),
    },
    routeSurface: {
      financeTruthRoutes: [...financeTruthRoutes].map(asString),
    },
    businessRules: {
      invoiceWithoutPoRows: asNumber(invoiceRow.count),
      cosRule: "COS realised only from invoiced actuals (invoice_number + invoice_date).",
      revenueRealisationRule: "Payment receipt date remains the cash-realisation date where defined.",
    },
  };

  return {
    generatedAt: new Date().toISOString(),
    classifications,
    trustGaps,
    safeHardeningChanges: [
      "Expose finance layer classifications and trust gaps via one read-only API endpoint.",
      "Add explicit reconciliation metrics linking finance_cos_monthly back to normalized_cost_lines.",
      "Surface invoice-without-PO counts and lineage completeness so trust does not rely on hidden cache behavior.",
    ],
    reconciliationChecks,
    pendingApproval: [
      "Consolidating or removing legacy finance routes requires product + rollout approval.",
      "Any mutation to historical finance_cos_monthly rows should be executed only with approved migration + rollback window.",
    ],
  };
}
